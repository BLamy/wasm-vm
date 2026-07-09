//! The NAT flow table — the per-flow state slirp keeps for guest-initiated connections, with idle
//! timeouts and a hard entry bound so a flow flood can't exhaust memory. Deterministic (`BTreeMap`,
//! ordered iteration) and **time-injected** (every method takes `now_ms`) so it is fully
//! unit-testable and reproducible with no clock access of its own.
//!
//! Callers MUST pass a MONOTONIC `now_ms` (milliseconds): the timeout math floors negatives at 0, so
//! a backwards clock never drops a live flow early on `sweep`, but a backwards `touch` would move a
//! flow's activity clock backwards and could expire it too soon. A monotonic source avoids both.

use std::collections::BTreeMap;
use std::net::IpAddr;

/// Transport protocol of a flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Proto {
    Tcp,
    Udp,
}

/// A guest flow, keyed by the full 5-tuple. `Ord` (via derive) gives the table deterministic
/// iteration order.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct FlowKey {
    pub proto: Proto,
    pub guest_ip: IpAddr,
    pub guest_port: u16,
    pub dst_ip: IpAddr,
    pub dst_port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Entry {
    last_activity_ms: u64,
}

/// What a `touch` did — so the caller can react (a new flow → open an outbound socket; an eviction →
/// close the evicted flow's socket).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TouchOutcome {
    /// True if this call CREATED the flow (vs. refreshing an existing one).
    pub created: bool,
    /// A flow evicted to stay under the entry cap (its socket must be torn down). `None` if none.
    pub evicted: Option<FlowKey>,
}

/// Idle timeouts (slirp/QEMU conventions): an established TCP flow lives 2 h idle, a UDP flow 30 s.
pub const TCP_IDLE_MS: u64 = 2 * 60 * 60 * 1000;
pub const UDP_IDLE_MS: u64 = 30 * 1000;

fn idle_ms(proto: Proto) -> u64 {
    match proto {
        Proto::Tcp => TCP_IDLE_MS,
        Proto::Udp => UDP_IDLE_MS,
    }
}

/// The NAT table. `max_entries` bounds total flows; exceeding it evicts the least-recently-active
/// flow (LRU) on the next `touch` that would create a new one.
#[derive(Debug)]
pub struct FlowTable {
    map: BTreeMap<FlowKey, Entry>,
    max_entries: usize,
}

impl FlowTable {
    /// A table bounded to `max_entries` flows (must be ≥ 1).
    pub fn new(max_entries: usize) -> Self {
        FlowTable {
            map: BTreeMap::new(),
            max_entries: max_entries.max(1),
        }
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
    pub fn contains(&self, key: &FlowKey) -> bool {
        self.map.contains_key(key)
    }

    /// Record activity on `key` at `now_ms`: create the flow if new (evicting the LRU flow first if
    /// at capacity), else refresh its last-activity. Refreshing an existing flow never evicts.
    pub fn touch(&mut self, key: FlowKey, now_ms: u64) -> TouchOutcome {
        if let Some(e) = self.map.get_mut(&key) {
            e.last_activity_ms = now_ms;
            return TouchOutcome::default();
        }
        let mut out = TouchOutcome {
            created: true,
            evicted: None,
        };
        if self.map.len() >= self.max_entries {
            // Evict the least-recently-active flow (ties broken by key order for determinism).
            if let Some(victim) = self
                .map
                .iter()
                .min_by(|a, b| {
                    a.1.last_activity_ms
                        .cmp(&b.1.last_activity_ms)
                        .then_with(|| a.0.cmp(b.0))
                })
                .map(|(k, _)| k.clone())
            {
                self.map.remove(&victim);
                out.evicted = Some(victim);
            }
        }
        self.map.insert(
            key,
            Entry {
                last_activity_ms: now_ms,
            },
        );
        out
    }

    /// Remove `key` (e.g. on a clean TCP close). Returns whether it was present.
    pub fn remove(&mut self, key: &FlowKey) -> bool {
        self.map.remove(key).is_some()
    }

    /// Remove every flow idle past its per-protocol timeout as of `now_ms`, returning the expired
    /// keys (so the caller closes their sockets / RSTs the guest). Deterministic order.
    pub fn sweep_expired(&mut self, now_ms: u64) -> Vec<FlowKey> {
        let expired: Vec<FlowKey> = self
            .map
            .iter()
            .filter(|(k, e)| now_ms.saturating_sub(e.last_activity_ms) >= idle_ms(k.proto))
            .map(|(k, _)| k.clone())
            .collect();
        for k in &expired {
            self.map.remove(k);
        }
        expired
    }
}

#[cfg(test)]
mod tests;
