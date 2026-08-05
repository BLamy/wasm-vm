//! `FlowManager` — the slirp control plane: it turns each guest frame (via [`tcp::classify`]) into a
//! flow-lifecycle [`Action`] and maintains the NAT [`FlowTable`]. The async byte-bridge (next slice)
//! *acts* on these actions — `Connect` opens an `OutboundConnector` + a smoltcp socket for the flow;
//! `Existing` feeds the frame to that flow's socket; `Local` lets smoltcp answer; `Ignore` drops it.
//! Kept pure + time-injected so the whole control plane is deterministically unit-tested (no sockets,
//! no async).

use crate::nat::FlowTable;
use crate::tcp::{self, FrameClass};
use crate::{FlowKey, TouchOutcome};

/// What the bridge should do with a guest frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// A NEW outbound flow — the bridge should `connect` the outbound side and create a smoltcp
    /// socket keyed by this 4-tuple.
    Connect(FlowKey),
    /// A frame for an already-open flow — feed it to that flow's smoltcp socket.
    Existing(FlowKey),
    /// TCP to a slirp-local IP (gateway/DNS) — smoltcp answers it; no NAT.
    Local,
    /// Non-TCP / malformed / in-subnet-non-local — drop.
    Ignore,
}

/// The result of processing one guest frame: the [`Action`], plus any flow the NAT bound evicted to
/// make room (the bridge must tear down its socket + outbound connection).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameOutcome {
    pub action: Action,
    pub evicted: Option<FlowKey>,
}

/// The NAT/flow control plane over a bounded [`FlowTable`].
#[derive(Debug)]
pub struct FlowManager {
    table: FlowTable,
}

impl FlowManager {
    /// A manager bounded to `max_flows` concurrent flows.
    pub fn new(max_flows: usize) -> Self {
        FlowManager {
            table: FlowTable::new(max_flows),
        }
    }

    pub fn flow_count(&self) -> usize {
        self.table.len()
    }

    /// Create or refresh a non-TCP flow in the same bounded NAT table. The caller owns the protocol
    /// classifier (currently external UDP framing) and must tear down any returned eviction.
    pub fn touch_flow(&mut self, key: FlowKey, now_ms: u64) -> TouchOutcome {
        self.table.touch(key, now_ms)
    }

    /// Classify + record one guest→gateway frame at `now_ms`, returning what the bridge should do.
    pub fn on_guest_frame(&mut self, frame: &[u8], now_ms: u64) -> FrameOutcome {
        match tcp::classify(frame) {
            FrameClass::OutboundSyn(key) => {
                if self.table.contains(&key) {
                    // A retransmitted SYN for a flow we're already bringing up — not a new connect.
                    self.table.touch(key.clone(), now_ms);
                    FrameOutcome {
                        action: Action::Existing(key),
                        evicted: None,
                    }
                } else {
                    let TouchOutcome { evicted, .. } = self.table.touch(key.clone(), now_ms);
                    FrameOutcome {
                        action: Action::Connect(key),
                        evicted,
                    }
                }
            }
            FrameClass::ExistingTcp(key) => {
                // Refresh only a flow we actually track; stray data for an unknown flow is passed
                // through as Existing (the bridge finds no socket → smoltcp will RST it) but does NOT
                // create a NAT entry.
                if self.table.contains(&key) {
                    self.table.touch(key.clone(), now_ms);
                }
                FrameOutcome {
                    action: Action::Existing(key),
                    evicted: None,
                }
            }
            FrameClass::LocalTcp => FrameOutcome {
                action: Action::Local,
                evicted: None,
            },
            FrameClass::Other => FrameOutcome {
                action: Action::Ignore,
                evicted: None,
            },
        }
    }

    /// Remove a flow (clean TCP close / teardown). Returns whether it was tracked.
    pub fn remove(&mut self, key: &FlowKey) -> bool {
        self.table.remove(key)
    }

    /// Sweep idle-expired flows at `now_ms`; the bridge tears down each returned flow's socket.
    pub fn expire(&mut self, now_ms: u64) -> Vec<FlowKey> {
        self.table.sweep_expired(now_ms)
    }
}

#[cfg(test)]
mod tests;
