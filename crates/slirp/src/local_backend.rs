//! E3-net (browser networking): a **synchronous** slirp [`NetBackend`] with no async runtime. The
//! local stack answers everything from the guest's own frames (`inject` → `poll`/`run_dhcp` →
//! `take_egress`), so it runs directly in the browser's wasm event loop with no tokio — unlike the
//! native `cli::SlirpBackend`, which needs a tokio driver thread.
//!
//! - **Slice 1** (base): DHCP lease + ARP for the gateway + ICMP echo to `10.0.2.2`. Gets a booted
//!   browser guest a DHCP-configured `eth0` and a reachable gateway. No outbound TCP.
//! - **Slice 2a** (this): optional **outbound TCP** via a synchronous [`SyncConnector`]. When one is
//!   attached (`with_connector`), a guest SYN to a non-local IP is classified by the [`FlowManager`],
//!   an outbound dial is started, and the flow's bytes are pumped both ways each service pass — all
//!   synchronously, so the browser needs no tokio. `new` (no connector) keeps slice-1 behaviour
//!   verbatim (Action::Connect is never produced because classification only runs with a connector).
//!
//! **Optimistic accept (honest non-claim):** because a synchronous `connect` can't block, the guest
//! handshake completes locally as soon as the SYN arrives — before the outbound dial confirms. If the
//! dial then fails, the backend sends the guest a RST (`tcp_abort`). So a refused destination surfaces
//! as *briefly-open-then-reset* rather than *never-open*; the guest still gets a reset, just after a
//! moment. Deferring the SYN-ACK until the dial confirms (exact refused-port timing) is a later
//! refinement. This does not affect the common path (a reachable destination).
//!
//! The clock is injected (`Box<dyn Fn() -> i64>` monotonic ms) so the backend stays native-testable
//! (this module is written alloc-only, though the crate around it is std): the browser passes a
//! `js_sys::Date::now`-based closure; tests pass a mock.

extern crate alloc;
use alloc::boxed::Box;
use alloc::collections::{BTreeMap, VecDeque};
use alloc::vec::Vec;
use core::net::IpAddr;

use wasm_vm_core::dev::virtio::net::NetBackend;

use crate::dhcp::DhcpServer;
use crate::manager::{Action, FlowManager};
use crate::nat::FlowKey;
use crate::stack::SlirpStack;
use crate::sync_connector::{ConnId, ConnStatus, SyncConnector};
use smoltcp::iface::SocketHandle;

/// Upper bound on concurrent NAT flows — matches the native bridge's default. A guest opening more is
/// bounded (the oldest idle flow is evicted), never unbounded memory.
const MAX_FLOWS: usize = 256;

/// One live outbound flow: the guest-facing smoltcp socket (`handle`) paired with the connector-side
/// connection (`conn`), plus the guest→remote bytes not yet accepted by the connector.
struct Flow {
    handle: SocketHandle,
    conn: ConnId,
    /// Guest→remote bytes drained from the stack but not yet accepted by the connector (backpressure).
    /// Re-offered each pass; keeps the pump lossless when the connector's send window is momentarily
    /// full.
    pending_out: Vec<u8>,
    /// We've already forwarded the guest's FIN to the connector (`shutdown_write`); don't repeat.
    guest_fin_sent: bool,
}

/// A [`NetBackend`] backed by the slirp local stack: the guest sees a real gateway (`10.0.2.2`) that
/// answers ARP + ICMP and a DHCP server that hands out `10.0.2.15`. With a [`SyncConnector`] attached
/// (`with_connector`), guest TCP flows to non-local IPs are dialed outbound and pumped synchronously.
pub struct SlirpLocalBackend {
    stack: SlirpStack,
    dhcp: DhcpServer,
    egress: VecDeque<Vec<u8>>,
    clock: Box<dyn Fn() -> i64>,
    /// `None` → slice-1 behaviour (no outbound; classification is skipped entirely). `Some` → outbound
    /// TCP via this connector.
    connector: Option<Box<dyn SyncConnector>>,
    manager: FlowManager,
    flows: BTreeMap<FlowKey, Flow>,
}

impl SlirpLocalBackend {
    /// Local-stack only (no outbound TCP) — slice-1 behaviour. `gateway_mac` is the stack's own MAC
    /// (distinct from the guest's virtio-net MAC). `clock` returns monotonic milliseconds (browser:
    /// `Date::now`-derived; tests: a mock/counter).
    pub fn new(gateway_mac: [u8; 6], clock: Box<dyn Fn() -> i64>) -> Self {
        Self {
            stack: SlirpStack::new(gateway_mac),
            dhcp: DhcpServer::new(),
            egress: VecDeque::new(),
            clock,
            connector: None,
            manager: FlowManager::new(MAX_FLOWS),
            flows: BTreeMap::new(),
        }
    }

    /// Local stack **plus outbound TCP** via `connector`. A guest SYN to a non-local IP is dialed out
    /// and its bytes pumped both ways synchronously each service pass. The browser passes a
    /// `WsConnector` (slice 2b); native tests pass a `StdConnector`.
    pub fn with_connector(
        gateway_mac: [u8; 6],
        clock: Box<dyn Fn() -> i64>,
        connector: Box<dyn SyncConnector>,
    ) -> Self {
        let mut be = Self::new(gateway_mac, clock);
        be.connector = Some(connector);
        be
    }

    /// Classify a guest frame (only when a connector is attached) and start any new outbound dial. On
    /// a NAT eviction, tear the evicted flow down first. Mirrors the async `Bridge::on_guest_frame`
    /// control plane, minus the `.await` (the sync connect returns an id immediately).
    fn classify_and_connect(&mut self, frame: &[u8]) {
        if self.connector.is_none() {
            return;
        }
        let now = (self.clock)().max(0) as u64;
        let out = self.manager.on_guest_frame(frame, now);
        if let Some(evicted) = out.evicted {
            self.teardown(&evicted);
        }
        if let Action::Connect(key) = out.action
            && let IpAddr::V4(dst) = key.dst_ip
        {
            // Optimistic accept: open the listening socket so the guest handshake completes locally,
            // and start the outbound dial in parallel. A dial failure is surfaced as a RST in `pump`.
            let handle = self.stack.open_tcp(dst, key.dst_port);
            let conn = self.connector.as_mut().unwrap().connect(dst, key.dst_port);
            self.flows.insert(
                key,
                Flow {
                    handle,
                    conn,
                    pending_out: Vec::new(),
                    guest_fin_sent: false,
                },
            );
        }
    }

    /// Tear a flow down completely: the connector connection, the smoltcp socket + NAT endpoint, and
    /// the NAT table entry. Idempotent (each removal is a no-op if already gone). The `handle` is dead
    /// after `remove_tcp`; dropping the `Flow` here means it is never reused (smoltcp recycles slots).
    fn teardown(&mut self, key: &FlowKey) {
        if let Some(flow) = self.flows.remove(key) {
            if let Some(c) = self.connector.as_mut() {
                c.close(flow.conn);
            }
            self.stack.remove_tcp(flow.handle);
        }
        self.manager.remove(key);
    }

    /// Pump every live flow one step: advance its connect state, move guest→remote and remote→guest
    /// bytes, forward a guest FIN, and tear down on failure or full close. Runs each service pass.
    fn pump(&mut self) {
        if self.connector.is_none() {
            return;
        }
        let now = (self.clock)();
        let keys: Vec<FlowKey> = self.flows.keys().cloned().collect();
        for key in keys {
            let (handle, conn) = {
                let f = &self.flows[&key];
                (f.handle, f.conn)
            };
            let status = self.connector.as_mut().unwrap().status(conn);
            if let ConnStatus::Failed(_) = status {
                // Outbound dial failed or the remote reset → RST the guest and drop the flow. The
                // `poll` between `tcp_abort` and `remove_tcp` is REQUIRED: `abort` only queues the RST
                // segment; without a poll to emit it into egress, `remove_tcp` deletes the socket first
                // and the RST is never sent — the guest hangs half-open (caught by the refused-port
                // e2e test). `poll` here flushes it; `service`'s `take_egress` then delivers it.
                self.stack.tcp_abort(handle);
                self.stack.poll(now);
                self.teardown(&key);
                continue;
            }

            // guest → remote: drain what the guest sent into the flow's pending buffer, then offer it.
            let from_guest = self.stack.tcp_recv(handle);
            if !from_guest.is_empty() {
                self.flows
                    .get_mut(&key)
                    .unwrap()
                    .pending_out
                    .extend_from_slice(&from_guest);
            }
            let pending = core::mem::take(&mut self.flows.get_mut(&key).unwrap().pending_out);
            if !pending.is_empty() {
                let accepted = self.connector.as_mut().unwrap().send(conn, &pending);
                // Keep the unaccepted tail for next pass (lossless under backpressure).
                self.flows.get_mut(&key).unwrap().pending_out = pending[accepted..].to_vec();
            }

            // Guest FIN → forward a write-shutdown to the remote, once, after the pending drained.
            if !self.stack.tcp_may_recv(handle)
                && self.flows[&key].pending_out.is_empty()
                && !self.flows[&key].guest_fin_sent
            {
                self.connector.as_mut().unwrap().shutdown_write(conn);
                self.flows.get_mut(&key).unwrap().guest_fin_sent = true;
            }

            // remote → guest: deliver whatever the remote sent (tcp_send buffers; poll flushes it).
            let from_remote = self.connector.as_mut().unwrap().recv(conn);
            if !from_remote.is_empty() {
                self.stack.tcp_send(handle, &from_remote);
            }

            // Remote half-closed and everything delivered → FIN the guest. Teardown waits until the
            // guest has also finished (its socket leaves the connection) so the FIN is acknowledged.
            if status == ConnStatus::Closed && from_remote.is_empty() {
                self.stack.tcp_close(handle);
                if self.stack.tcp_state(handle).is_none_or(is_terminal) {
                    self.teardown(&key);
                }
            }
        }
    }

    /// Sweep NAT-idle flows (no activity within the flow-table idle timeout) at the current clock, so a
    /// guest that opens flows and walks away doesn't strand sockets. Torn down like any other flow.
    fn expire(&mut self) {
        if self.connector.is_none() {
            return;
        }
        let now = (self.clock)().max(0) as u64;
        for key in self.manager.expire(now) {
            self.teardown(&key);
        }
    }

    /// Drive one servicing pass: `poll` (ARP/ICMP; `inject` already diverted any DHCP UDP to the
    /// service queue), then `run_dhcp` (answer diverted DHCP → `device.tx`), then the outbound-TCP
    /// pump, then harvest egress for the guest. A second `poll` after the pump flushes the segments
    /// `tcp_send`/`tcp_close` queued (they only leave the interface on a poll). (`run_dhcp` writes
    /// egress directly, so it needs no extra poll.)
    fn service(&mut self) {
        let now = (self.clock)();
        self.stack.poll(now);
        self.stack.run_dhcp(&self.dhcp);
        self.pump();
        self.expire();
        // Flush any TCP segments the pump enqueued (data to the guest, FIN/RST) onto the wire.
        self.stack.poll(now);
        for f in self.stack.take_egress() {
            self.egress.push_back(f);
        }
    }
}

/// Whether a smoltcp TCP state means the socket has fully left the connection (safe to reap).
fn is_terminal(state: smoltcp::socket::tcp::State) -> bool {
    use smoltcp::socket::tcp::State;
    matches!(state, State::Closed | State::TimeWait | State::Closing)
}

impl NetBackend for SlirpLocalBackend {
    fn tx(&mut self, frame: &[u8]) {
        self.classify_and_connect(frame);
        self.stack.inject(frame.to_vec());
        self.service();
    }

    fn rx(&mut self) -> Option<Vec<u8>> {
        // With outbound flows, the remote can produce bytes with no guest frame to trigger `service`.
        // When the caller polls for a frame and nothing is queued, run a servicing pass so
        // remote→guest data (and connect-state transitions) are picked up. (No connector → nothing to
        // pump; the branch is skipped, so slice-1 behaviour is byte-identical.)
        if self.egress.is_empty() && self.connector.is_some() {
            self.service();
        }
        self.egress.pop_front()
    }

    fn rx_ready(&self) -> bool {
        // A pure predicate (`&self`, no servicing): the trait forbids re-entering the machine here, and
        // servicing needs `&mut`. Outbound data is pumped by `tx` (on a guest frame) and `rx` (on a
        // poll). NOTE (slice 2a → 2c): the *device's* receiveq only calls `rx` when this returns true,
        // so async remote→guest delivery through the booted device needs a periodic pump / kick — the
        // browser wiring (slice 2c). Slice 2a proves the sync pump by driving `tx`/`rx` directly.
        !self.egress.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use smoltcp::wire::{
        ArpOperation, ArpPacket, ArpRepr, EthernetAddress, EthernetFrame, EthernetProtocol,
        EthernetRepr,
    };

    const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
    const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x02];
    use core::net::Ipv4Addr;
    const GUEST_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 15);
    const GW_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 2);

    fn guest_arp_request() -> Vec<u8> {
        let arp = ArpRepr::EthernetIpv4 {
            operation: ArpOperation::Request,
            source_hardware_addr: EthernetAddress(GUEST_MAC),
            source_protocol_addr: GUEST_IP,
            target_hardware_addr: EthernetAddress([0; 6]),
            target_protocol_addr: GW_IP,
        };
        let eth = EthernetRepr {
            src_addr: EthernetAddress(GUEST_MAC),
            dst_addr: EthernetAddress::BROADCAST,
            ethertype: EthernetProtocol::Arp,
        };
        let mut buf = vec![0u8; eth.buffer_len() + arp.buffer_len()];
        let mut frame = EthernetFrame::new_unchecked(&mut buf);
        eth.emit(&mut frame);
        let mut apkt = ArpPacket::new_unchecked(frame.payload_mut());
        arp.emit(&mut apkt);
        buf
    }

    #[test]
    fn guest_arp_for_gateway_gets_a_reply_through_the_local_backend() {
        let mut be = SlirpLocalBackend::new(GW_MAC, Box::new(|| 0));
        be.tx(&guest_arp_request());
        // The whole synchronous path ran on tx: inject → poll → take_egress → egress queue.
        let mut got = false;
        while let Some(f) = be.rx() {
            let Ok(frame) = EthernetFrame::new_checked(&f) else {
                continue;
            };
            if frame.ethertype() != EthernetProtocol::Arp {
                continue;
            }
            let Ok(pkt) = ArpPacket::new_checked(frame.payload()) else {
                continue;
            };
            if let Ok(ArpRepr::EthernetIpv4 {
                operation,
                source_protocol_addr,
                source_hardware_addr,
                ..
            }) = ArpRepr::parse(&pkt)
                && operation == ArpOperation::Reply
                && source_protocol_addr == GW_IP
                && source_hardware_addr == EthernetAddress(GW_MAC)
            {
                got = true;
            }
        }
        assert!(got, "gateway should ARP-reply through the local backend");
    }
}
