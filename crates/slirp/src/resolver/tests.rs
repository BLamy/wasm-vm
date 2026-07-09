//! DNS forwarder + TTL cache tests — deterministic (injected `now_ms`, a mock resolver that counts
//! upstream calls). No real clock, no network.

use super::*;
use crate::dns::{CLASS_IN, RCODE_NOERROR, RCODE_NXDOMAIN, RCODE_SERVFAIL, TYPE_A, TYPE_AAAA};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

const IP1: Ipv4Addr = Ipv4Addr::new(93, 184, 216, 34);
const IP2: Ipv4Addr = Ipv4Addr::new(93, 184, 216, 35);

/// A resolver that returns a canned result and counts how many times it was consulted (so tests can
/// prove a cache hit avoided the upstream).
#[derive(Clone)]
struct MockResolver {
    calls: Arc<AtomicUsize>,
    result: Resolution,
}
impl MockResolver {
    fn new(result: Resolution) -> Self {
        MockResolver {
            calls: Arc::new(AtomicUsize::new(0)),
            result,
        }
    }
    fn count(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}
impl Resolver for MockResolver {
    fn resolve(&self, _name: &str) -> impl std::future::Future<Output = Resolution> + Send {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let r = self.result.clone();
        async move { r }
    }
}

fn encode_name(name: &str) -> Vec<u8> {
    let mut v = Vec::new();
    for label in name.split('.').filter(|l| !l.is_empty()) {
        v.push(label.len() as u8);
        v.extend_from_slice(label.as_bytes());
    }
    v.push(0);
    v
}
fn query(id: u16, name: &str, qtype: u16) -> Vec<u8> {
    query_class(id, name, qtype, CLASS_IN)
}
fn query_class(id: u16, name: &str, qtype: u16, qclass: u16) -> Vec<u8> {
    let mut b = id.to_be_bytes().to_vec();
    b.extend_from_slice(&0x0100u16.to_be_bytes()); // RD
    b.extend_from_slice(&1u16.to_be_bytes()); // QDCOUNT
    b.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
    b.extend_from_slice(&encode_name(name));
    b.extend_from_slice(&qtype.to_be_bytes());
    b.extend_from_slice(&qclass.to_be_bytes());
    b
}

fn rcode(r: &[u8]) -> u8 {
    (u16::from_be_bytes([r[2], r[3]]) & 0x000F) as u8
}
fn ancount(r: &[u8]) -> u16 {
    u16::from_be_bytes([r[6], r[7]])
}
/// Extract `(ip, ttl)` from every A answer (each answer: 2-byte name ptr, type, class, ttl, rdlen, rdata).
fn a_answers(r: &[u8], qname: &str) -> Vec<(Ipv4Addr, u32)> {
    let mut out = Vec::new();
    let mut i = 12 + encode_name(qname).len() + 4; // header + echoed question
    for _ in 0..ancount(r) {
        if i + 12 > r.len() {
            break;
        }
        let ttl = u32::from_be_bytes([r[i + 6], r[i + 7], r[i + 8], r[i + 9]]);
        let rdlen = u16::from_be_bytes([r[i + 10], r[i + 11]]) as usize;
        if rdlen == 4 && i + 12 + 4 <= r.len() {
            out.push((
                Ipv4Addr::new(r[i + 12], r[i + 13], r[i + 14], r[i + 15]),
                ttl,
            ));
        }
        i += 12 + rdlen;
    }
    out
}

// ── TtlCache ─────────────────────────────────────────────────────────────────
#[test]
fn cache_clamps_ttl_floor_and_cap() {
    let mut c = TtlCache::new(8);
    c.put("a".into(), vec![IP1], 1, 0); // below floor → 5 s
    c.put("b".into(), vec![IP1], 99_999, 0); // above cap → 300 s
    assert_eq!(c.get("a", 0).unwrap().1, 5);
    assert_eq!(c.get("b", 0).unwrap().1, 300);
}

#[test]
fn cache_hit_counts_down_and_expires() {
    let mut c = TtlCache::new(8);
    c.put("x".into(), vec![IP1, IP2], 100, 0);
    // Remaining counts down as time advances.
    assert_eq!(c.get("x", 0).unwrap().1, 100);
    assert_eq!(c.get("x", 40_000).unwrap().1, 60);
    assert_eq!(
        c.get("x", 99_000).unwrap().1,
        1,
        "never returns 0 while live"
    );
    // Past expiry → miss.
    assert!(c.get("x", 100_000).is_none());
    assert!(c.get("x", 500_000).is_none());
    assert!(c.get("absent", 0).is_none());
}

#[test]
fn cache_is_bounded_evicting_soonest_expiry() {
    let mut c = TtlCache::new(2);
    c.put("short".into(), vec![IP1], 10, 0); // expires at 10 s
    c.put("long".into(), vec![IP1], 300, 0); // expires at 300 s
    c.put("new".into(), vec![IP1], 300, 0); // over capacity → evict the soonest-expiring ("short")
    assert!(
        c.get("short", 0).is_none(),
        "soonest-expiring entry evicted"
    );
    assert!(c.get("long", 0).is_some());
    assert!(c.get("new", 0).is_some());
    assert_eq!(c.len(), 2);
}

// ── DnsForwarder ─────────────────────────────────────────────────────────────
#[tokio::test]
async fn a_query_resolves_caches_and_second_is_a_cache_hit() {
    let r = MockResolver::new(Resolution::Resolved {
        ips: vec![IP1, IP2],
        ttl_secs: 100,
    });
    let mut fwd = DnsForwarder::new(r.clone(), 16);

    let resp = fwd
        .handle(&query(1, "example.com", TYPE_A), 0)
        .await
        .unwrap();
    assert_eq!(rcode(&resp), RCODE_NOERROR);
    assert_eq!(
        a_answers(&resp, "example.com"),
        vec![(IP1, 100), (IP2, 100)],
        "both A records with the clamped TTL"
    );
    assert_eq!(r.count(), 1);
    assert_eq!(fwd.cache_len(), 1);

    // Second identical query 40 s later → served from cache (NO second upstream fetch), TTL counted down.
    let resp2 = fwd
        .handle(&query(2, "example.com", TYPE_A), 40_000)
        .await
        .unwrap();
    assert_eq!(a_answers(&resp2, "example.com"), vec![(IP1, 60), (IP2, 60)]);
    assert_eq!(r.count(), 1, "cache hit did NOT consult the resolver again");
}

#[tokio::test]
async fn cache_re_resolves_after_ttl_expiry() {
    let r = MockResolver::new(Resolution::Resolved {
        ips: vec![IP1],
        ttl_secs: 30,
    });
    let mut fwd = DnsForwarder::new(r.clone(), 16);
    fwd.handle(&query(1, "a.test", TYPE_A), 0).await.unwrap();
    assert_eq!(r.count(), 1);
    // Past the 30 s TTL → the entry expired, so this re-resolves.
    fwd.handle(&query(2, "a.test", TYPE_A), 31_000)
        .await
        .unwrap();
    assert_eq!(r.count(), 2, "expired entry forces a fresh upstream fetch");
}

#[tokio::test]
async fn aaaa_is_empty_noerror_without_touching_the_resolver() {
    let r = MockResolver::new(Resolution::Resolved {
        ips: vec![IP1],
        ttl_secs: 100,
    });
    let mut fwd = DnsForwarder::new(r.clone(), 16);
    let resp = fwd
        .handle(&query(1, "example.com", TYPE_AAAA), 0)
        .await
        .unwrap();
    assert_eq!(rcode(&resp), RCODE_NOERROR);
    assert_eq!(ancount(&resp), 0, "IPv4-only: empty AAAA");
    assert_eq!(r.count(), 0, "AAAA never consults the resolver");
}

#[tokio::test]
async fn nxdomain_and_servfail_are_forwarded() {
    let mut nx = DnsForwarder::new(MockResolver::new(Resolution::NxDomain), 16);
    assert_eq!(
        rcode(
            &nx.handle(&query(1, "nope.invalid", TYPE_A), 0)
                .await
                .unwrap()
        ),
        RCODE_NXDOMAIN
    );

    let mut fail = DnsForwarder::new(MockResolver::new(Resolution::Failed), 16);
    let resp = fail.handle(&query(1, "x.test", TYPE_A), 0).await.unwrap();
    assert_eq!(
        rcode(&resp),
        RCODE_SERVFAIL,
        "resolver failure → fail-fast SERVFAIL"
    );
    assert_eq!(fail.cache_len(), 0, "failures are not cached");
}

#[tokio::test]
async fn empty_a_result_is_not_cached_and_re_resolves() {
    // Critic MAJOR: a Resolved with NO addresses (and ttl=0) must NOT be cached — otherwise the 5 s
    // floor would pin "no A records" and starve retries. Answer empty NOERROR, but re-resolve next time.
    let r = MockResolver::new(Resolution::Resolved {
        ips: vec![],
        ttl_secs: 0,
    });
    let mut fwd = DnsForwarder::new(r.clone(), 16);
    let resp = fwd
        .handle(&query(1, "flaky.test", TYPE_A), 0)
        .await
        .unwrap();
    assert_eq!(rcode(&resp), RCODE_NOERROR);
    assert_eq!(ancount(&resp), 0, "no A records → empty NOERROR");
    assert_eq!(fwd.cache_len(), 0, "an empty answer is NOT cached");
    // A retry 1 s later must consult the resolver again (not pinned by the floor).
    fwd.handle(&query(2, "flaky.test", TYPE_A), 1000)
        .await
        .unwrap();
    assert_eq!(
        r.count(),
        2,
        "empty answer re-resolves, not served from a floor-pinned cache"
    );
}

#[tokio::test]
async fn non_in_class_gets_servfail_without_touching_the_resolver() {
    // A qtype=A but qclass=CHAOS(3) query must not be answered with IN data (critic MINOR).
    let r = MockResolver::new(Resolution::Resolved {
        ips: vec![IP1],
        ttl_secs: 100,
    });
    let mut fwd = DnsForwarder::new(r.clone(), 16);
    let resp = fwd
        .handle(&query_class(1, "example.com", TYPE_A, 3), 0)
        .await
        .unwrap();
    assert_eq!(rcode(&resp), RCODE_SERVFAIL, "non-IN class → SERVFAIL");
    assert_eq!(r.count(), 0, "non-IN never consults the resolver");
}

#[tokio::test]
async fn unsupported_qtype_gets_servfail_and_malformed_is_dropped() {
    let r = MockResolver::new(Resolution::Resolved {
        ips: vec![IP1],
        ttl_secs: 100,
    });
    let mut fwd = DnsForwarder::new(r.clone(), 16);
    // A non-A/AAAA qtype (MX=15) → SERVFAIL, resolver untouched.
    let resp = fwd.handle(&query(1, "example.com", 15), 0).await.unwrap();
    assert_eq!(rcode(&resp), RCODE_SERVFAIL);
    assert_eq!(r.count(), 0);
    // A malformed query is dropped (no reply).
    assert!(fwd.handle(&[0u8; 4], 0).await.is_none());
}
