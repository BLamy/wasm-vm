//! UDP service dispatch tests: the right internal service claims each `(dst_ip, dst_port)`, and an
//! external UDP flow (incl. DNS to some other server) is NOT intercepted.

use super::*;
use crate::resolver::Resolution;
use std::future::Future;

const CHADDR: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const MAGIC: [u8; 4] = [0x63, 0x82, 0x53, 0x63];
const EXTERNAL: Ipv4Addr = Ipv4Addr::new(8, 8, 8, 8);

/// A resolver that always resolves to one address (so a routed DNS query yields a real answer).
struct FixedResolver;
impl Resolver for FixedResolver {
    #[allow(clippy::manual_async_fn)] // the trait's contract is `-> impl Future + Send`, not `async fn`
    fn resolve(&self, _name: &str) -> impl Future<Output = Resolution> + Send {
        async {
            Resolution::Resolved {
                ips: vec![Ipv4Addr::new(93, 184, 216, 34)],
                ttl_secs: 60,
            }
        }
    }
}

fn services() -> UdpServices<FixedResolver> {
    UdpServices::new(DhcpServer::new(), DnsForwarder::new(FixedResolver, 16))
}

/// A DHCP message of the given type (option 53).
fn dhcp(msg_type: u8) -> Vec<u8> {
    let mut b = vec![0u8; 236];
    b[0] = 1; // BOOTREQUEST
    b[1] = 1;
    b[2] = 6;
    b[4..8].copy_from_slice(&[0xde, 0xad, 0xbe, 0xef]);
    b[28..34].copy_from_slice(&CHADDR);
    b.extend_from_slice(&MAGIC);
    b.extend_from_slice(&[53, 1, msg_type]); // option 53 = message type
    if msg_type == 3 {
        // a REQUEST for our address (option 50)
        b.extend_from_slice(&[50, 4]);
        b.extend_from_slice(&net::GUEST.octets());
    }
    b.push(255);
    b
}
/// The DHCP message type (option 53) of a reply, if present.
fn dhcp_type(reply: &[u8]) -> Option<u8> {
    let mut i = 240;
    while i + 1 < reply.len() {
        let code = reply[i];
        if code == 255 {
            break;
        }
        if code == 0 {
            i += 1;
            continue;
        }
        let len = reply[i + 1] as usize;
        if code == 53 && len == 1 {
            return reply.get(i + 2).copied();
        }
        i += 2 + len;
    }
    None
}

/// A DNS A query for `name`.
fn dns_query(name: &str) -> Vec<u8> {
    let mut b = 0x1234u16.to_be_bytes().to_vec();
    b.extend_from_slice(&0x0100u16.to_be_bytes());
    b.extend_from_slice(&1u16.to_be_bytes());
    b.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
    for label in name.split('.') {
        b.push(label.len() as u8);
        b.extend_from_slice(label.as_bytes());
    }
    b.push(0);
    b.extend_from_slice(&1u16.to_be_bytes()); // A
    b.extend_from_slice(&1u16.to_be_bytes()); // IN
    b
}

#[tokio::test]
async fn dhcp_discover_broadcast_reaches_the_dhcp_server() {
    let mut s = services();
    let r = s.handle(BROADCAST, 67, &dhcp(1), 0).await.expect("claimed");
    assert_eq!(r.src_port, 67, "reply sent from the DHCP server port");
    assert_eq!(dhcp_type(&r.payload), Some(2), "DISCOVER → OFFER");
}

#[tokio::test]
async fn dhcp_renew_unicast_to_gateway_reaches_the_dhcp_server() {
    let mut s = services();
    let r = s
        .handle(net::GATEWAY, 67, &dhcp(3), 0)
        .await
        .expect("claimed");
    assert_eq!(
        dhcp_type(&r.payload),
        Some(5),
        "REQUEST for our address → ACK"
    );
}

#[tokio::test]
async fn dns_query_to_our_resolver_is_answered() {
    let mut s = services();
    let r = s
        .handle(net::DNS, 53, &dns_query("example.com"), 0)
        .await
        .expect("claimed");
    assert_eq!(r.src_port, 53);
    // Response has QR set and at least one answer.
    assert_eq!(r.payload[2] & 0x80, 0x80, "QR=1 (a response)");
    assert_eq!(
        u16::from_be_bytes([r.payload[6], r.payload[7]]),
        1,
        "one A answer"
    );
}

#[tokio::test]
async fn dns_to_an_external_server_is_not_intercepted() {
    // A query to some OTHER host's :53 is a real outbound flow — the NAT path owns it, not us.
    let mut s = services();
    assert!(
        s.handle(EXTERNAL, 53, &dns_query("example.com"), 0)
            .await
            .is_none(),
        "external DNS is left to NAT, never transparently intercepted"
    );
}

#[tokio::test]
async fn other_ports_and_hosts_are_not_claimed() {
    let mut s = services();
    // NTP to the gateway — not a service we run.
    assert!(s.handle(net::GATEWAY, 123, b"ntp", 0).await.is_none());
    // DHCP-port to a random external host — not broadcast, not the gateway → not ours.
    assert!(s.handle(EXTERNAL, 67, &dhcp(1), 0).await.is_none());
    // A normal outbound UDP flow.
    assert!(s.handle(EXTERNAL, 4433, b"quic", 0).await.is_none());
}
