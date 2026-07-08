//! DoH resolver (E3-T15) — the browser's [`Resolver`]: it resolves a name by POSTing a DNS query to a
//! DoH endpoint (RFC 8484 `application/dns-message` wire format) and parsing the response. Raw UDP/53
//! is impossible from a web page, so DoH over `fetch` is how the guest gets real name resolution.
//!
//! This module is PURE + generic over a [`DohTransport`] (the thing that actually does the HTTP POST),
//! so the query-build + response-map logic is unit-tested natively with a mock transport; the concrete
//! `fetch`-backed transport lives in the browser crate (it needs `web_sys`, not tokio). No async
//! runtime here — the transport future is just `impl Future + Send`, like [`crate::OutboundConnector`].

use crate::dns::{self, TYPE_A};
use crate::resolver::{Resolution, Resolver};

/// A minimal TTL floor applied to the answer set so a `ttl=0` upstream record can't defeat the cache
/// downstream. (The `TtlCache` clamps again; this just avoids handing back a literal 0.)
const MIN_ANSWER_TTL: u32 = 1;

/// Performs the DoH HTTP POST: send the DNS query wire bytes to the configured endpoint, return the
/// response wire bytes, or `None` on any transport failure (network error, non-200, timeout). The
/// implementor owns the endpoint URL, the `application/dns-message` content type, and the timeout —
/// its contract, like the OS resolver's, is to resolve (bytes or `None`) within a bounded time, never
/// hang. The browser impl is `fetch`; tests use a mock.
pub trait DohTransport {
    fn post(&self, query: &[u8]) -> impl std::future::Future<Output = Option<Vec<u8>>> + Send;
}

/// Resolves guest DNS queries via DoH. Generic over the transport so it's browser-safe and testable.
pub struct DohResolver<T> {
    transport: T,
}

impl<T: DohTransport + Sync> DohResolver<T> {
    pub fn new(transport: T) -> Self {
        DohResolver { transport }
    }
}

impl<T: DohTransport + Sync> Resolver for DohResolver<T> {
    fn resolve(&self, name: &str) -> impl std::future::Future<Output = Resolution> + Send {
        // DoH recommends id=0 (the endpoint doesn't need our txid, and 0 is cache-friendly).
        let query = dns::build_query(0, name, TYPE_A);
        async move {
            let Some(bytes) = self.transport.post(&query).await else {
                return Resolution::Failed; // transport failed / timed out → SERVFAIL, fail-fast
            };
            let Some(info) = dns::parse_response(&bytes) else {
                return Resolution::Failed; // malformed response → SERVFAIL, never trust garbage
            };
            match info.rcode {
                dns::RCODE_NXDOMAIN => Resolution::NxDomain,
                dns::RCODE_NOERROR => {
                    let ips: Vec<_> = info.a_records.iter().map(|(ip, _)| *ip).collect();
                    // The answer set's TTL = the smallest record TTL (a set is only as fresh as its
                    // soonest-to-expire member), floored at 1. Empty A set → the forwarder emits an
                    // un-cached empty NOERROR.
                    let ttl_secs = info
                        .a_records
                        .iter()
                        .map(|(_, ttl)| *ttl)
                        .min()
                        .unwrap_or(0)
                        .max(MIN_ANSWER_TTL);
                    Resolution::Resolved { ips, ttl_secs }
                }
                // SERVFAIL / REFUSED / anything else → fail-fast (the guest retries).
                _ => Resolution::Failed,
            }
        }
    }
}

#[cfg(test)]
mod tests;
