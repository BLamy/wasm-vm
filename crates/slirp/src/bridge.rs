//! `Bridge` — the slirp control plane wired to real outbound connections. It ties [`FlowManager`]
//! (classify + NAT) to [`SlirpStack`] (accept sockets) and an [`OutboundConnector`]: a guest SYN to a
//! new external flow opens a listening socket AND connects the outbound side; retransmits/data feed
//! the existing socket; local frames go to smoltcp; eviction/teardown drops both the socket and the
//! outbound connection together (no leak).
//!
//! This slice is the connection LIFECYCLE (open/track/teardown), unit-tested with a mock connector.
//! The byte-PUMP between each smoltcp socket and its outbound stream (with backpressure/half-close)
//! is the final slice; the per-flow stream is already held here ready for it.

use std::collections::BTreeMap;
use std::net::IpAddr;

use smoltcp::iface::SocketHandle;

use crate::connector::OutboundConnector;
use crate::manager::{Action, FlowManager};
use crate::nat::FlowKey;
use crate::stack::SlirpStack;

/// A live flow's resources: its smoltcp socket handle and the outbound byte stream.
struct FlowConn<S> {
    handle: SocketHandle,
    /// The outbound stream (the byte-pump slice reads/writes this). Held so it isn't dropped; the
    /// leading underscore silences dead-code until the pump consumes it.
    _stream: S,
}

/// Drives guest frames → outbound connections over a bounded set of flows.
pub struct Bridge<C: OutboundConnector> {
    stack: SlirpStack,
    manager: FlowManager,
    connector: C,
    flows: BTreeMap<FlowKey, FlowConn<C::Conn>>,
}

impl<C: OutboundConnector> Bridge<C> {
    /// A bridge with gateway MAC `mac`, bounded to `max_flows` concurrent flows.
    pub fn new(mac: [u8; 6], connector: C, max_flows: usize) -> Self {
        Bridge {
            stack: SlirpStack::new(mac),
            manager: FlowManager::new(max_flows),
            connector,
            flows: BTreeMap::new(),
        }
    }

    /// Number of live flows (open smoltcp socket + outbound connection).
    pub fn flow_count(&self) -> usize {
        self.flows.len()
    }

    /// Take frames the stack has queued for the guest (SYN-ACKs, data, RSTs) since the last call.
    pub fn take_egress(&mut self) -> Vec<Vec<u8>> {
        self.stack.take_egress()
    }

    /// Poll the underlying stack (process injected frames, emit replies) at `now_ms`.
    pub fn poll(&mut self, now_ms: i64) {
        self.stack.poll(now_ms);
    }

    /// Process one guest frame: classify it, drive the flow lifecycle, and hand the frame to the
    /// stack (whose `accept_frame` filter is the real gate — it admits ARP/ICMP for the gateway and
    /// TCP for opened endpoints, drops the rest). On a NEW flow (`Connect`) we open a listening socket
    /// and `connect` the outbound side before injecting the SYN (so it passes the filter); on connect
    /// failure we drop the half-open flow so the SYN is then filtered out and the guest times out.
    /// Any flow the NAT evicted to make room is torn down first.
    pub async fn on_guest_frame(&mut self, frame: Vec<u8>, now_ms: u64) {
        let out = self.manager.on_guest_frame(&frame, now_ms);
        if let Some(evicted) = out.evicted {
            self.teardown(&evicted);
        }
        if let Action::Connect(key) = out.action
            && let IpAddr::V4(dst) = key.dst_ip
        {
            let handle = self.stack.open_tcp(dst, key.dst_port);
            match self.connector.connect(key.dst_ip, key.dst_port).await {
                Ok(stream) => {
                    self.flows.insert(
                        key,
                        FlowConn {
                            handle,
                            _stream: stream,
                        },
                    );
                }
                Err(_refused) => {
                    // No outbound → drop the half-open flow (socket + endpoint + NAT entry) so the
                    // SYN below is filtered out; the guest handshake times out. (A prompt RST is a
                    // byte-pump-slice refinement.)
                    self.stack.remove_tcp(handle);
                    self.manager.remove(&key);
                }
            }
        }
        // The stack's `accept_frame` filter decides what smoltcp actually sees.
        self.stack.inject(frame);
    }

    /// Sweep idle-expired flows at `now_ms`, tearing each down.
    pub fn expire(&mut self, now_ms: u64) {
        for key in self.manager.expire(now_ms) {
            if let Some(fc) = self.flows.remove(&key) {
                self.stack.remove_tcp(fc.handle);
            }
        }
    }

    /// Tear down one flow: drop its outbound stream and remove its smoltcp socket. Also drops the
    /// manager's NAT entry so a later SYN for the 4-tuple re-connects cleanly.
    fn teardown(&mut self, key: &FlowKey) {
        if let Some(fc) = self.flows.remove(key) {
            self.stack.remove_tcp(fc.handle);
        }
        self.manager.remove(key);
    }
}

#[cfg(test)]
mod tests;
