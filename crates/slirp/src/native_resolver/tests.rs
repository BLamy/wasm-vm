//! `NativeResolver` tests. The happy path uses `localhost`, which every OS resolves to `127.0.0.1`
//! (and/or `::1`) from `/etc/hosts` — deterministic and OFFLINE, so no network flakiness. Cases that
//! would require real DNS traffic are `#[ignore]`d (run explicitly with `--ignored`).

use super::*;
use crate::resolver::Resolution;
use std::net::Ipv4Addr;
use std::time::Duration;

#[tokio::test]
async fn resolves_localhost_to_the_ipv4_loopback_offline() {
    let r = NativeResolver::new();
    match r.resolve("localhost").await {
        Resolution::Resolved { ips, ttl_secs } => {
            assert!(
                ips.contains(&Ipv4Addr::LOCALHOST),
                "localhost resolves to 127.0.0.1 via the OS resolver (got {ips:?})"
            );
            // Every returned address is IPv4 (the v6 loopback ::1 must be filtered out).
            assert!(ips.iter().all(|ip| !ip.is_unspecified()));
            assert_eq!(ttl_secs, 60);
        }
        other => panic!("expected Resolved for localhost, got {other:?}"),
    }
}

#[tokio::test]
async fn ipv6_only_addresses_are_filtered_out() {
    // `::1` is IPv6-only; resolving it must yield an empty IPv4 set (Resolved, not a bogus record).
    // (This is a literal, so it's offline and never a real DNS query.)
    let r = NativeResolver::new();
    match r.resolve("::1").await {
        Resolution::Resolved { ips, .. } => {
            assert!(
                ips.is_empty(),
                "an IPv6-only name yields no A records (got {ips:?})"
            );
        }
        // Some platforms reject a bare `::1` as a host in lookup_host → Failed is also acceptable here.
        Resolution::Failed => {}
        Resolution::NxDomain => panic!("native resolver never fabricates NxDomain"),
    }
}

#[tokio::test]
async fn an_ipv4_literal_resolves_to_itself_offline() {
    // A dotted-quad literal resolves to itself without any DNS traffic.
    let r = NativeResolver::new();
    match r.resolve("93.184.216.34").await {
        Resolution::Resolved { ips, .. } => {
            assert_eq!(ips, vec![Ipv4Addr::new(93, 184, 216, 34)]);
        }
        other => panic!("expected the literal back, got {other:?}"),
    }
}

#[tokio::test]
async fn a_malformed_host_fails_fast_not_hangs() {
    // An empty/garbage host must resolve to Failed quickly (fail-fast contract), never hang.
    let r = NativeResolver::new().with_timeout(Duration::from_secs(2));
    let out = tokio::time::timeout(Duration::from_secs(3), r.resolve("")).await;
    assert!(
        out.is_ok(),
        "resolve returned within the deadline (no hang)"
    );
    assert_eq!(
        out.unwrap(),
        Resolution::Failed,
        "a malformed host → SERVFAIL"
    );
}

/// Requires real DNS — run with `cargo test -- --ignored`. A guaranteed-nonexistent `.invalid` name
/// (RFC 2606) must fail fast (we map NXDOMAIN → Failed/SERVFAIL, never hang).
#[tokio::test]
#[ignore = "needs network / a real resolver"]
async fn nonexistent_name_fails_fast() {
    let r = NativeResolver::new().with_timeout(Duration::from_secs(3));
    let out = tokio::time::timeout(Duration::from_secs(4), r.resolve("no-such-host.invalid")).await;
    assert!(out.is_ok(), "did not hang");
    assert_eq!(out.unwrap(), Resolution::Failed);
}
