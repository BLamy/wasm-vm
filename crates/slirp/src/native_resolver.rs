//! `NativeResolver` — the native-harness [`Resolver`] backed by the OS resolver (E3-T15). This is the
//! `resolve` half of the DNS forwarder when running natively (tests + the native CLI); the browser
//! build uses a DoH resolver over `fetch` instead. Resolves a name via tokio's `lookup_host`, keeps
//! only the IPv4 addresses (the slirp stack is IPv4-only), and maps the outcome to the forwarder's
//! [`Resolution`]: addresses → `Resolved`, an empty/failed lookup → `Failed` (SERVFAIL, fail-fast),
//! bounded by a timeout so a wedged resolver can never hang the stack.
//!
//! NXDOMAIN vs a transient failure: `lookup_host` collapses both into an `Err`, and telling them apart
//! portably would need a raw resolver. We map every lookup error to `Failed` (SERVFAIL) rather than
//! guess `NxDomain` — SERVFAIL makes the guest fail fast and RETRY, which is the safe behavior for a
//! transient upstream blip; a true NXDOMAIN just costs one retry. (The DoH resolver, which sees the
//! real RCODE, will return `NxDomain` precisely.)
//!
//! CAVEAT for the future concurrent-dispatch wiring (critic MINOR): `lookup_host` runs a BLOCKING
//! `getaddrinfo` on tokio's blocking threadpool. Our `timeout` returns `Failed` on schedule, but it
//! only DROPS the future — the underlying getaddrinfo thread stays pinned until the OS resolver
//! returns (up to `/etc/resolv.conf`'s own multi-second timeout). Per-query awaiting (as the forwarder
//! does today) is fine, but a path that dispatches many concurrent queries to a black-holed resolver
//! could pin many of tokio's blocking threads — so the wiring slice should bound resolve concurrency
//! (or move to a raw async resolver so `timeout` truly cancels the in-flight lookup).

use std::net::IpAddr;
use std::time::Duration;

use crate::resolver::{Resolution, Resolver};

/// The default resolve timeout — a name that won't resolve must fail (→ SERVFAIL) within this, so the
/// guest's `wget`/`nslookup` fails fast instead of hanging (the T15 charter).
pub const DEFAULT_RESOLVE_TIMEOUT: Duration = Duration::from_secs(5);

/// Resolves guest DNS queries via the host OS resolver (tokio `lookup_host`).
#[derive(Debug, Clone)]
pub struct NativeResolver {
    timeout: Duration,
}

impl Default for NativeResolver {
    fn default() -> Self {
        Self::new()
    }
}

impl NativeResolver {
    pub fn new() -> Self {
        NativeResolver {
            timeout: DEFAULT_RESOLVE_TIMEOUT,
        }
    }

    /// Set the resolve timeout (e.g. a short one in tests).
    pub fn with_timeout(mut self, t: Duration) -> Self {
        self.timeout = t;
        self
    }
}

impl Resolver for NativeResolver {
    fn resolve(&self, name: &str) -> impl std::future::Future<Output = Resolution> + Send {
        // `lookup_host` wants a `host:port`; the port is irrelevant to A records, so use 0.
        let host = format!("{name}:0");
        let timeout = self.timeout;
        async move {
            match tokio::time::timeout(timeout, tokio::net::lookup_host(host)).await {
                Ok(Ok(addrs)) => {
                    let ips: Vec<_> = addrs
                        .filter_map(|sa| match sa.ip() {
                            IpAddr::V4(v4) => Some(v4),
                            IpAddr::V6(_) => None, // IPv4-only stack
                        })
                        .collect();
                    // A name that resolved to only IPv6 (or nothing) → no A records. `Resolved` with an
                    // empty vec is the honest answer; the forwarder turns it into an un-cached empty
                    // NOERROR, never a bogus record.
                    Resolution::Resolved { ips, ttl_secs: 60 }
                }
                // Lookup failed (NXDOMAIN or transient) or exceeded the timeout → fail fast.
                Ok(Err(_)) | Err(_) => Resolution::Failed,
            }
        }
    }
}

#[cfg(test)]
mod tests;
