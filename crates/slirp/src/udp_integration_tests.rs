//! INTEGRATION: the whole internal-services control plane composed through [`UdpServices`] — the DHCP
//! server, the DNS forwarder, its TTL cache, and a real/counting [`Resolver`] — driven as one guest
//! network session. The per-module tests exercise each piece in isolation; these prove they COMPOSE:
//! a guest acquires its lease and resolves names through the same dispatcher, and the forwarder's
//! cache persists across dispatch calls (a second query is served without re-consulting upstream).
//! Deterministic + offline: the real-resolver leg uses `localhost` (`/etc/hosts`, no DNS traffic).

#![cfg(all(test, feature = "native"))]

use std::future::Future;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::dhcp::DhcpServer;
use crate::net;
use crate::resolver::{DnsForwarder, Resolution, Resolver};
use crate::udp::UdpServices;

const CHADDR: [u8; 6] = [0x52, 0x54, 0x00, 0xaa, 0xbb, 0xcc];
const MAGIC: [u8; 4] = [0x63, 0x82, 0x53, 0x63];
const BROADCAST: Ipv4Addr = Ipv4Addr::new(255, 255, 255, 255);

/// A resolver returning a fixed address and counting how many times upstream was consulted — so the
/// integration test can prove the forwarder's cache (inside `UdpServices`) avoids a second lookup.
#[derive(Clone)]
struct CountingResolver {
    calls: Arc<AtomicUsize>,
    ip: Ipv4Addr,
}
impl Resolver for CountingResolver {
    #[allow(clippy::manual_async_fn)]
    fn resolve(&self, _name: &str) -> impl Future<Output = Resolution> + Send {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let ip = self.ip;
        async move {
            Resolution::Resolved {
                ips: vec![ip],
                ttl_secs: 120,
            }
        }
    }
}

fn dhcp_msg(msg_type: u8) -> Vec<u8> {
    let mut b = vec![0u8; 236];
    b[0] = 1;
    b[1] = 1;
    b[2] = 6;
    b[4..8].copy_from_slice(&[0x11, 0x22, 0x33, 0x44]);
    b[28..34].copy_from_slice(&CHADDR);
    b.extend_from_slice(&MAGIC);
    b.extend_from_slice(&[53, 1, msg_type]);
    if msg_type == 3 {
        b.extend_from_slice(&[50, 4]);
        b.extend_from_slice(&net::GUEST.octets());
    }
    b.push(255);
    b
}
fn dhcp_reply_type(reply: &[u8]) -> Option<u8> {
    let mut i = 240;
    while i + 1 < reply.len() {
        let c = reply[i];
        if c == 255 {
            break;
        }
        if c == 0 {
            i += 1;
            continue;
        }
        let len = reply[i + 1] as usize;
        if c == 53 && len == 1 {
            return reply.get(i + 2).copied();
        }
        i += 2 + len;
    }
    None
}
fn dhcp_yiaddr(reply: &[u8]) -> Ipv4Addr {
    Ipv4Addr::new(reply[16], reply[17], reply[18], reply[19])
}

fn dns_a_query(id: u16, name: &str) -> Vec<u8> {
    crate::dns::build_query(id, name, crate::dns::TYPE_A)
}
/// The first A record `(ip)` in a response, if any.
fn dns_first_a(resp: &[u8]) -> Option<Ipv4Addr> {
    crate::dns::parse_response(resp)?
        .a_records
        .first()
        .map(|(ip, _)| *ip)
}

/// A full zero-config session: DISCOVER→OFFER, REQUEST→ACK, then two DNS queries — the second served
/// from the forwarder's cache WITHOUT a second upstream lookup — all through one `UdpServices`.
#[tokio::test]
async fn full_guest_session_lease_then_resolve_with_cache_reuse() {
    let calls = Arc::new(AtomicUsize::new(0));
    let resolver = CountingResolver {
        calls: calls.clone(),
        ip: Ipv4Addr::new(93, 184, 216, 34),
    };
    let mut svc = UdpServices::new(DhcpServer::new(), DnsForwarder::new(resolver, 16));

    // 1. DHCP DISCOVER (broadcast) → OFFER of the guest address.
    let offer = svc
        .handle(68, BROADCAST, 67, &dhcp_msg(1), 0)
        .await
        .expect("DISCOVER claimed");
    assert_eq!(dhcp_reply_type(&offer.payload), Some(2), "OFFER");
    assert_eq!(dhcp_yiaddr(&offer.payload), net::GUEST);
    assert_eq!(offer.to_port, 68);

    // 2. DHCP REQUEST (unicast to gateway) → ACK.
    let ack = svc
        .handle(68, net::GATEWAY, 67, &dhcp_msg(3), 0)
        .await
        .expect("REQUEST claimed");
    assert_eq!(dhcp_reply_type(&ack.payload), Some(5), "ACK");

    // 3. DNS query for a name → resolved via upstream, answered back to the query port.
    let r1 = svc
        .handle(40000, net::DNS, 53, &dns_a_query(1, "example.com"), 1000)
        .await
        .expect("DNS query claimed");
    assert_eq!(r1.from_port, 53);
    assert_eq!(r1.to_port, 40000);
    assert_eq!(
        dns_first_a(&r1.payload),
        Some(Ipv4Addr::new(93, 184, 216, 34))
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "one upstream lookup so far"
    );

    // 4. Same name again shortly after → served from the forwarder's cache, NO second upstream lookup.
    let r2 = svc
        .handle(40001, net::DNS, 53, &dns_a_query(2, "example.com"), 5000)
        .await
        .expect("second DNS query claimed");
    assert_eq!(
        dns_first_a(&r2.payload),
        Some(Ipv4Addr::new(93, 184, 216, 34))
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "the cache served the repeat — upstream consulted exactly once across the session"
    );
}

/// The same session but with the REAL `NativeResolver` (offline: `localhost` → 127.0.0.1), proving the
/// production resolver composes through the dispatcher + forwarder, not just a mock.
#[tokio::test]
async fn real_native_resolver_composes_through_the_dispatcher() {
    let svc_resolver = crate::native_resolver::NativeResolver::new();
    let mut svc = UdpServices::new(DhcpServer::new(), DnsForwarder::new(svc_resolver, 16));

    // Lease first (same dispatcher).
    let offer = svc
        .handle(68, BROADCAST, 67, &dhcp_msg(1), 0)
        .await
        .expect("DISCOVER claimed");
    assert_eq!(dhcp_reply_type(&offer.payload), Some(2));

    // Resolve `localhost` through the whole control plane → 127.0.0.1, no network.
    let resp = svc
        .handle(40000, net::DNS, 53, &dns_a_query(1, "localhost"), 0)
        .await
        .expect("DNS query claimed");
    assert_eq!(
        dns_first_a(&resp.payload),
        Some(Ipv4Addr::LOCALHOST),
        "the real OS resolver resolved localhost through UdpServices → DnsForwarder → NativeResolver"
    );
}
