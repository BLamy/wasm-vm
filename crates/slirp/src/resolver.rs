//! DNS forwarder control layer (E3-T15): a TTL cache, the [`Resolver`] contract (how a name becomes
//! addresses — DoH in the browser, the OS resolver natively — provided in a later slice), and the
//! [`DnsForwarder`] that ties them to the wire layer ([`crate::dns`]). Pure + generic (no tokio here;
//! the `Resolver` future is just `impl Future + Send`, like [`crate::OutboundConnector`]), so it
//! compiles into the browser build. Time is injected (`now_ms`) so the cache is deterministically
//! testable with no real clock.

use std::collections::BTreeMap;
use std::future::Future;
use std::net::Ipv4Addr;

use crate::dns::{self, Answer, Query};

/// TTL clamp bounds (RFC-pragmatic): never cache longer than the cap, nor shorter than the floor
/// (so a hostile/misconfigured `ttl=0` can't defeat caching, and a huge TTL can't pin a stale answer
/// for days).
pub const TTL_CAP_SECS: u32 = 300;
pub const TTL_FLOOR_SECS: u32 = 5;

/// The outcome of resolving a name upstream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    /// Addresses + the upstream TTL (seconds) — clamped by the cache.
    Resolved { ips: Vec<Ipv4Addr>, ttl_secs: u32 },
    /// The name authoritatively does not exist → the guest gets NXDOMAIN.
    NxDomain,
    /// The resolver failed / was unreachable → the guest gets SERVFAIL (fail fast, never hang).
    Failed,
}

/// Turns a name into addresses. The browser impl fetches DoH; the native impl uses the OS resolver.
/// Async (`impl Future + Send`) so a slow upstream doesn't block the stack; it MUST resolve — success,
/// `NxDomain`, or `Failed` — within its own timeout, never hang (mirrors `OutboundConnector`).
pub trait Resolver {
    fn resolve(&self, name: &str) -> impl Future<Output = Resolution> + Send;
}

/// A bounded, TTL-respecting positive cache: `name → (addresses, expiry_ms)`. Deterministic — every
/// operation takes the current time, so tests drive expiry without a real clock.
#[derive(Debug, Default)]
pub struct TtlCache {
    entries: BTreeMap<String, (Vec<Ipv4Addr>, i64)>,
    max: usize,
}

impl TtlCache {
    pub fn new(max: usize) -> Self {
        TtlCache {
            entries: BTreeMap::new(),
            max: max.max(1),
        }
    }

    fn clamp_ttl(ttl_secs: u32) -> u32 {
        ttl_secs.clamp(TTL_FLOOR_SECS, TTL_CAP_SECS)
    }

    /// A live entry for `name`, if present and unexpired, with its REMAINING TTL (seconds, ≥ 1) so
    /// the response counts down like a real caching resolver's would. `None` on miss or expiry.
    pub fn get(&self, name: &str, now_ms: i64) -> Option<(Vec<Ipv4Addr>, u32)> {
        let (ips, expiry) = self.entries.get(name)?;
        if *expiry <= now_ms {
            return None; // expired — treated as a miss (lazily reclaimed on the next `put`)
        }
        let remaining = (((*expiry - now_ms) / 1000).max(1)) as u32;
        Some((ips.clone(), remaining))
    }

    /// Cache `ips` for `name` with a clamped TTL. Bounds size: drop expired entries first, then, if
    /// still at capacity, evict the entry expiring soonest.
    pub fn put(&mut self, name: String, ips: Vec<Ipv4Addr>, ttl_secs: u32, now_ms: i64) {
        let expiry = now_ms + Self::clamp_ttl(ttl_secs) as i64 * 1000;
        if !self.entries.contains_key(&name) && self.entries.len() >= self.max {
            self.entries.retain(|_, (_, e)| *e > now_ms); // reclaim expired
            if self.entries.len() >= self.max
                && let Some(k) = self
                    .entries
                    .iter()
                    .min_by_key(|(_, (_, e))| *e)
                    .map(|(k, _)| k.clone())
            {
                self.entries.remove(&k);
            }
        }
        self.entries.insert(name, (ips, expiry));
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// The DNS forwarder: parse a guest query, answer from cache or the resolver, cache positive answers,
/// and apply the fixed policies (empty-AAAA for the IPv4-only stack; NXDOMAIN / SERVFAIL / fail-fast).
pub struct DnsForwarder<R> {
    resolver: R,
    cache: TtlCache,
}

impl<R: Resolver> DnsForwarder<R> {
    pub fn new(resolver: R, cache_max: usize) -> Self {
        DnsForwarder {
            resolver,
            cache: TtlCache::new(cache_max),
        }
    }

    /// Handle one guest DNS query (the UDP:53 payload) at `now_ms`; returns the response bytes, or
    /// `None` if the query is malformed (drop it). Never hangs: a cache miss consults the resolver,
    /// whose contract is to resolve within its own timeout.
    pub async fn handle(&mut self, msg: &[u8], now_ms: i64) -> Option<Vec<u8>> {
        let q = dns::parse_query(msg)?;
        // We only serve the IN class; a non-IN query (CHAOS/HESIOD) must not be answered with IN data
        // (critic MINOR). Fail fast rather than emit a class-mismatched reply.
        if q.qclass != dns::CLASS_IN {
            return Some(dns::servfail(&q));
        }
        // AAAA policy: honest empty NOERROR (IPv4-only) — never touches the resolver.
        if q.is_aaaa() {
            return Some(dns::empty_aaaa(&q));
        }
        // Only A is forwarded for now; other qtypes get SERVFAIL rather than a wrong/empty answer.
        if !q.is_a() {
            return Some(dns::servfail(&q));
        }
        // Cache hit → answer straight away (no upstream fetch — the de-dup the acceptance test checks).
        if let Some((ips, remaining)) = self.cache.get(&q.name, now_ms) {
            return Some(answer_a(&q, &ips, remaining));
        }
        match self.resolver.resolve(&q.name).await {
            // No A records (name exists but has none, or a transient empty). Answer an honest empty
            // NOERROR but DON'T cache it (critic MAJOR): caching would apply the 5 s floor, pinning
            // "no addresses" for seconds and overriding a `ttl=0` don't-cache hint — so every retry in
            // that window would be starved. Re-resolve next time instead.
            Resolution::Resolved { ips, .. } if ips.is_empty() => Some(answer_a(&q, &[], 0)),
            Resolution::Resolved { ips, ttl_secs } => {
                self.cache
                    .put(q.name.clone(), ips.clone(), ttl_secs, now_ms);
                Some(answer_a(&q, &ips, TtlCache::clamp_ttl(ttl_secs)))
            }
            Resolution::NxDomain => Some(dns::nxdomain(&q)),
            Resolution::Failed => Some(dns::servfail(&q)),
        }
    }

    /// Cached-entry count (introspection for the cache tests).
    pub fn cache_len(&self) -> usize {
        self.cache.len()
    }
}

fn answer_a(q: &Query, ips: &[Ipv4Addr], ttl: u32) -> Vec<u8> {
    let answers: Vec<Answer> = ips.iter().map(|ip| Answer::a(*ip, ttl)).collect();
    dns::build_response(q, dns::RCODE_NOERROR, &answers)
}

#[cfg(test)]
mod tests;
