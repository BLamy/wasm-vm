//! DoH resolver tests with a MOCK transport (returns canned response bytes; no network). Verify the
//! query is well-formed and each response shape maps to the right `Resolution`.

use super::*;
use crate::dns::{
    self, CLASS_IN, RCODE_NOERROR, RCODE_NXDOMAIN, RCODE_SERVFAIL, TYPE_A, TYPE_AAAA,
};
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};

/// A transport that records the query it was asked to POST and returns a canned response (or `None`
/// to simulate a transport failure).
#[derive(Clone)]
struct MockTransport {
    response: Option<Vec<u8>>,
    last_query: Arc<Mutex<Vec<u8>>>,
}
impl MockTransport {
    fn ok(response: Vec<u8>) -> Self {
        MockTransport {
            response: Some(response),
            last_query: Arc::new(Mutex::new(Vec::new())),
        }
    }
    fn failing() -> Self {
        MockTransport {
            response: None,
            last_query: Arc::new(Mutex::new(Vec::new())),
        }
    }
}
impl DohTransport for MockTransport {
    #[allow(clippy::manual_async_fn)] // the trait's contract is `-> impl Future + Send`
    fn post(&self, query: &[u8]) -> impl std::future::Future<Output = Option<Vec<u8>>> + Send {
        *self.last_query.lock().unwrap() = query.to_vec();
        let r = self.response.clone();
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
/// A canned DoH response: header (QR=1 + rcode) + one question + `answers` (each an RR body).
fn response(name: &str, rcode: u8, answers: &[Vec<u8>]) -> Vec<u8> {
    let mut b = 0u16.to_be_bytes().to_vec(); // id=0 (matches build_query)
    b.extend_from_slice(&(0x8180u16 | rcode as u16).to_be_bytes()); // QR=1, RD=1, RA=1, rcode
    b.extend_from_slice(&1u16.to_be_bytes()); // QDCOUNT
    b.extend_from_slice(&(answers.len() as u16).to_be_bytes()); // ANCOUNT
    b.extend_from_slice(&[0, 0, 0, 0]); // NS/AR
    b.extend_from_slice(&encode_name(name));
    b.extend_from_slice(&TYPE_A.to_be_bytes());
    b.extend_from_slice(&CLASS_IN.to_be_bytes());
    for a in answers {
        b.extend_from_slice(a);
    }
    b
}
/// An answer RR: compression-pointer name (→ question at 0x0c) + type/ttl/rdata.
fn rr(rtype: u16, ttl: u32, rdata: &[u8]) -> Vec<u8> {
    let mut b = vec![0xC0, 0x0C];
    b.extend_from_slice(&rtype.to_be_bytes());
    b.extend_from_slice(&CLASS_IN.to_be_bytes());
    b.extend_from_slice(&ttl.to_be_bytes());
    b.extend_from_slice(&(rdata.len() as u16).to_be_bytes());
    b.extend_from_slice(rdata);
    b
}

#[tokio::test]
async fn posts_a_wellformed_query_and_maps_a_records() {
    let ip1 = Ipv4Addr::new(93, 184, 216, 34);
    let ip2 = Ipv4Addr::new(93, 184, 216, 35);
    let mock = MockTransport::ok(response(
        "example.com",
        RCODE_NOERROR,
        &[
            rr(TYPE_A, 300, &ip1.octets()),
            rr(TYPE_A, 120, &ip2.octets()),
        ],
    ));
    let r = DohResolver::new(mock.clone());
    let res = r.resolve("example.com").await;

    // The query the resolver POSTed is a valid A/IN query for the name, id=0.
    let q = dns::parse_query(&mock.last_query.lock().unwrap()).expect("posted a valid query");
    assert_eq!(q.id, 0, "DoH query uses id=0");
    assert_eq!(q.name, "example.com");
    assert_eq!(q.qtype, TYPE_A);

    // The answer maps to Resolved with both IPs; TTL = the MIN record TTL (120).
    match res {
        Resolution::Resolved { ips, ttl_secs } => {
            assert_eq!(ips, vec![ip1, ip2]);
            assert_eq!(ttl_secs, 120, "answer-set TTL is the smallest record TTL");
        }
        other => panic!("expected Resolved, got {other:?}"),
    }
}

#[tokio::test]
async fn nxdomain_response_maps_to_nxdomain() {
    let mock = MockTransport::ok(response("nope.invalid", RCODE_NXDOMAIN, &[]));
    assert_eq!(
        DohResolver::new(mock).resolve("nope.invalid").await,
        Resolution::NxDomain
    );
}

#[tokio::test]
async fn servfail_response_maps_to_failed() {
    let mock = MockTransport::ok(response("x.test", RCODE_SERVFAIL, &[]));
    assert_eq!(
        DohResolver::new(mock).resolve("x.test").await,
        Resolution::Failed
    );
}

#[tokio::test]
async fn transport_failure_maps_to_failed() {
    // Network error / non-200 → None → Failed (fail-fast SERVFAIL).
    assert_eq!(
        DohResolver::new(MockTransport::failing())
            .resolve("example.com")
            .await,
        Resolution::Failed
    );
}

#[tokio::test]
async fn malformed_response_bytes_map_to_failed() {
    let mock = MockTransport::ok(vec![0xff; 3]); // garbage, too short for a header
    assert_eq!(
        DohResolver::new(mock).resolve("example.com").await,
        Resolution::Failed
    );
}

#[tokio::test]
async fn noerror_with_only_aaaa_is_an_empty_resolved() {
    // A NOERROR whose only answer is AAAA → no A records → empty Resolved (forwarder emits empty NOERROR).
    let v6 = [0x20u8, 1, 0xd, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    let mock = MockTransport::ok(response(
        "example.com",
        RCODE_NOERROR,
        &[rr(TYPE_AAAA, 300, &v6)],
    ));
    match DohResolver::new(mock).resolve("example.com").await {
        Resolution::Resolved { ips, .. } => assert!(ips.is_empty(), "no A records"),
        other => panic!("expected empty Resolved, got {other:?}"),
    }
}
