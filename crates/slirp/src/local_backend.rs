//! E3-net (browser networking): a **synchronous** slirp [`NetBackend`] with no async runtime. The
//! local stack answers everything from the guest's own frames (`inject` → `poll`/`run_dhcp` →
//! `take_egress`), so it runs directly in the browser's wasm event loop with no tokio — unlike the
//! native `cli::SlirpBackend`, which needs a tokio driver thread.
//!
//! - **Slice 1** (base): DHCP lease + ARP for the gateway + ICMP echo to `10.0.2.2`. Gets a booted
//!   browser guest a DHCP-configured `eth0` and a reachable gateway. No outbound TCP.
//! - **Slice 2a+**: optional **outbound TCP and UDP** via a synchronous [`SyncConnector`]. When one is
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
use crate::dns;
use crate::dns_service::{DnsRequest, DnsService, MAX_PENDING_DNS};
use crate::dns_tcp::{TcpFrame, frame_message, next_message};
use crate::manager::{Action, FlowManager};
use crate::nat::{FlowKey, Proto};
use crate::stack::{SlirpStack, is_service_udp};
use crate::sync_connector::{ConnId, ConnStatus, DatagramId, SyncConnector};
use crate::udp_frame::{GuestUdp, MAX_UDP_PAYLOAD, build_udp_frame, parse_udp};
use smoltcp::iface::SocketHandle;

/// Upper bound on concurrent NAT flows — matches the native bridge's default. A guest opening more is
/// bounded (the oldest idle flow is evicted), never unbounded memory.
const MAX_FLOWS: usize = 256;
/// At most four maximum-sized datagrams may wait for a browser relay acknowledgement/backpressure
/// per flow. UDP has no sender backpressure, so excess datagrams are intentionally dropped.
const MAX_PENDING_UDP_BYTES: usize = 4 * MAX_UDP_PAYLOAD;
/// Bound for coalescing pathological tiny remote deliveries before offering them to smoltcp. This is
/// no larger than one guest-facing TCP socket buffer, so it improves framing efficiency without
/// weakening backpressure or allowing connector data to grow unbounded.
const MAX_REMOTE_STAGING_BYTES: usize = 64 * 1024;
/// Classic DNS-over-UDP payload ceiling. Larger answers are replaced by a TC=1 response so the
/// guest retries the same query over the permanent internal TCP listener.
const DNS_UDP_PAYLOAD_LIMIT: usize = 512;

/// One live outbound flow: the guest-facing smoltcp socket (`handle`) paired with the connector-side
/// connection (`conn`), plus the guest→remote bytes not yet accepted by the connector.
struct Flow {
    handle: SocketHandle,
    guest_mac: [u8; 6],
    conn: ConnId,
    /// Guest→remote bytes drained from the stack but not yet accepted by the connector (backpressure).
    /// Re-offered each pass; keeps the pump lossless when the connector's send window is momentarily
    /// full.
    pending_out: Vec<u8>,
    /// Remote→guest bytes received from the connector but not yet accepted by the guest-facing socket
    /// (its tx buffer is full because the guest is draining slower than the remote sends). Re-offered
    /// each pass; the mirror of `pending_out` — without it, `tcp_send`'s unaccepted tail is lost on
    /// any bulk download (critic MAJOR: silent truncation).
    pending_in: Vec<u8>,
    /// We've already forwarded the guest's FIN to the connector (`shutdown_write`); don't repeat.
    guest_fin_sent: bool,
}

/// One NATed external UDP five-tuple. A connected socket makes replies unambiguous and prevents a
/// remote sender other than the chosen destination from injecting packets into the guest.
struct UdpFlow {
    conn: DatagramId,
    guest: GuestUdp,
    pending: VecDeque<Vec<u8>>,
    pending_bytes: usize,
}

enum DnsTarget {
    Udp(GuestUdp),
    Tcp { generation: u64 },
}

struct PendingDns {
    target: DnsTarget,
    query: Vec<u8>,
}

struct PendingTcpWrite {
    bytes: Vec<u8>,
    offset: usize,
}

/// A [`NetBackend`] backed by the slirp local stack: the guest sees a real gateway (`10.0.2.2`) that
/// answers ARP + ICMP and a DHCP server that hands out `10.0.2.15`. With a [`SyncConnector`] attached
/// (`with_connector`), guest TCP and UDP flows to non-local IPs are NATed outbound synchronously.
pub struct SlirpLocalBackend {
    stack: SlirpStack,
    gateway_mac: [u8; 6],
    dhcp: DhcpServer,
    dns: Option<Box<dyn DnsService>>,
    next_dns_id: u64,
    pending_dns: BTreeMap<u64, PendingDns>,
    dns_tcp_generation: u64,
    dns_tcp_rx: Vec<u8>,
    dns_tcp_tx: VecDeque<PendingTcpWrite>,
    egress: VecDeque<Vec<u8>>,
    clock: Box<dyn Fn() -> i64>,
    /// `None` → slice-1 behaviour (no outbound; classification is skipped entirely). `Some` → outbound
    /// TCP via this connector.
    connector: Option<Box<dyn SyncConnector>>,
    manager: FlowManager,
    flows: BTreeMap<FlowKey, Flow>,
    udp_flows: BTreeMap<FlowKey, UdpFlow>,
    /// The machine calls `NetBackend::poll` every instruction boundary. Browser WebSocket callbacks
    /// can only run between wasm calls, so servicing more than once per monotonic millisecond is
    /// wasted work; this keeps the idle/run-loop cost bounded without adding a timer/runtime.
    last_background_poll_ms: Option<i64>,
}

impl SlirpLocalBackend {
    /// Local-stack only (no outbound TCP) — slice-1 behaviour. `gateway_mac` is the stack's own MAC
    /// (distinct from the guest's virtio-net MAC). `clock` returns monotonic milliseconds (browser:
    /// `Date::now`-derived; tests: a mock/counter).
    pub fn new(gateway_mac: [u8; 6], clock: Box<dyn Fn() -> i64>) -> Self {
        Self {
            stack: SlirpStack::new(gateway_mac),
            gateway_mac,
            dhcp: DhcpServer::new(),
            dns: None,
            next_dns_id: 1,
            pending_dns: BTreeMap::new(),
            dns_tcp_generation: 0,
            dns_tcp_rx: Vec::new(),
            dns_tcp_tx: VecDeque::new(),
            egress: VecDeque::new(),
            clock,
            connector: None,
            manager: FlowManager::new(MAX_FLOWS),
            flows: BTreeMap::new(),
            udp_flows: BTreeMap::new(),
            last_background_poll_ms: None,
        }
    }

    /// Local stack **plus outbound TCP/UDP** via `connector`. Guest flows to non-local IPs are dialed
    /// and pumped synchronously each service pass. The browser passes a
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

    /// Attach the asynchronous DNS resolver/cache reactor used by both UDP and DNS-over-TCP.
    pub fn with_dns_service(mut self, dns: Box<dyn DnsService>) -> Self {
        self.dns = Some(dns);
        self
    }

    /// Override DHCP lease/MTU parameters for acceptance tests or transport-specific configuration.
    pub fn with_dhcp_server(mut self, dhcp: DhcpServer) -> Self {
        self.dhcp = dhcp;
        self
    }

    /// User-space bytes waiting on either side of the flow-control boundary. This diagnostic makes
    /// the large-transfer acceptance non-vacuous: a 100 MB stream must not imply a 100 MB queue.
    pub fn buffered_bytes(&self) -> usize {
        let flows = self.flows.values().fold(0usize, |total, flow| {
            total
                .saturating_add(flow.pending_out.len())
                .saturating_add(flow.pending_in.len())
        });
        let udp = self
            .udp_flows
            .values()
            .map(|flow| flow.pending_bytes)
            .sum::<usize>();
        flows.saturating_add(udp).saturating_add(
            self.connector
                .as_ref()
                .map_or(0, |connector| connector.buffered_bytes()),
        )
    }

    /// Number of live NATed TCP + UDP flows, exposed for acceptance/diagnostic assertions.
    pub fn flow_count(&self) -> usize {
        self.manager.flow_count()
    }

    /// Intercept one external UDP datagram before `SlirpStack::inject` drops it as an unowned
    /// address. Returns true when the frame was an external UDP datagram (including a deliberately
    /// dropped oversize/backpressured datagram), so it must not also enter smoltcp.
    fn classify_udp(&mut self, frame: &[u8]) -> bool {
        let Some(guest) = parse_udp(frame) else {
            return false;
        };
        if is_service_udp(guest.dst_ip, guest.dst_port) || crate::net::in_subnet(guest.dst_ip) {
            return false;
        }
        if self.connector.is_none() {
            return true;
        }

        let key = FlowKey {
            proto: Proto::Udp,
            guest_ip: IpAddr::V4(guest.src_ip),
            guest_port: guest.src_port,
            dst_ip: IpAddr::V4(guest.dst_ip),
            dst_port: guest.dst_port,
        };
        let now = (self.clock)().max(0) as u64;
        let touched = self.manager.touch_flow(key.clone(), now);
        if let Some(evicted) = touched.evicted {
            self.teardown(&evicted);
        }
        if touched.created {
            let conn = self
                .connector
                .as_mut()
                .expect("checked above")
                .udp_open(guest.dst_ip, guest.dst_port);
            self.udp_flows.insert(
                key.clone(),
                UdpFlow {
                    conn,
                    guest: guest.clone(),
                    pending: VecDeque::new(),
                    pending_bytes: 0,
                },
            );
        }

        let Some(flow) = self.udp_flows.get_mut(&key) else {
            return true;
        };
        // Refresh the L2 source in case the guest NIC changed while retaining its IP/port tuple.
        flow.guest = guest.clone();
        if guest.payload.len() <= MAX_UDP_PAYLOAD
            && flow.pending_bytes.saturating_add(guest.payload.len()) <= MAX_PENDING_UDP_BYTES
        {
            flow.pending_bytes += guest.payload.len();
            flow.pending.push_back(guest.payload);
        }
        true
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
            let guest_mac = smoltcp::wire::EthernetFrame::new_checked(frame)
                .expect("a classified TCP frame is valid Ethernet")
                .src_addr()
                .0;
            // Optimistic accept: open the listening socket so the guest handshake completes locally,
            // and start the outbound dial in parallel. A dial failure is surfaced as a RST in `pump`.
            let handle = self.stack.open_tcp_flow(&key);
            let conn = self.connector.as_mut().unwrap().connect(dst, key.dst_port);
            self.flows.insert(
                key,
                Flow {
                    handle,
                    guest_mac,
                    conn,
                    pending_out: Vec::new(),
                    pending_in: Vec::new(),
                    guest_fin_sent: false,
                },
            );
        }
    }

    fn allocate_dns_id(&mut self) -> u64 {
        loop {
            let id = self.next_dns_id;
            self.next_dns_id = self.next_dns_id.wrapping_add(1);
            if !self.pending_dns.contains_key(&id) {
                return id;
            }
        }
    }

    fn submit_dns(&mut self, query: Vec<u8>, target: DnsTarget, now_ms: i64) {
        let Some(parsed) = dns::parse_query(&query) else {
            return; // malformed DNS is dropped, matching DnsForwarder::handle
        };
        if self.pending_dns.len() >= MAX_PENDING_DNS || self.dns.is_none() {
            self.deliver_dns(target, &query, dns::servfail(&parsed));
            return;
        }

        let id = self.allocate_dns_id();
        let request = DnsRequest {
            id,
            message: query.clone(),
            now_ms,
        };
        match self.dns.as_mut().unwrap().submit(request) {
            Ok(()) => {
                self.pending_dns.insert(id, PendingDns { target, query });
            }
            Err(_) => self.deliver_dns(target, &query, dns::servfail(&parsed)),
        }
    }

    fn deliver_dns(&mut self, target: DnsTarget, query: &[u8], mut answer: Vec<u8>) {
        match target {
            DnsTarget::Udp(guest) => {
                if answer.len() > DNS_UDP_PAYLOAD_LIMIT {
                    let Some(parsed) = dns::parse_query(query) else {
                        return;
                    };
                    answer = dns::truncated(&parsed);
                }
                if let Some(frame) = build_udp_frame(
                    self.gateway_mac,
                    guest.src_mac,
                    crate::net::DNS,
                    53,
                    guest.src_ip,
                    guest.src_port,
                    &answer,
                ) {
                    self.stack.push_egress(frame);
                }
            }
            DnsTarget::Tcp { generation } if generation == self.dns_tcp_generation => {
                if let Some(bytes) = frame_message(&answer) {
                    self.dns_tcp_tx
                        .push_back(PendingTcpWrite { bytes, offset: 0 });
                }
            }
            DnsTarget::Tcp { .. } => {} // the guest closed/replaced this connection while resolving
        }
    }

    fn submit_udp_dns(&mut self, now_ms: i64) {
        // `run_dhcp` partitioned the queue first, so only DNS datagrams remain here.
        for guest in self.stack.take_service_udp() {
            let query = guest.payload.clone();
            self.submit_dns(query, DnsTarget::Udp(guest), now_ms);
        }
    }

    fn poll_dns_completions(&mut self) {
        let completions = self.dns.as_mut().map_or_else(Vec::new, |dns| dns.poll());
        for completion in completions {
            let Some(pending) = self.pending_dns.remove(&completion.id) else {
                continue; // stale/unknown completion cannot be delivered to an arbitrary guest flow
            };
            if let Some(answer) = completion.message {
                self.deliver_dns(pending.target, &pending.query, answer);
            }
        }
    }

    fn reset_dns_tcp_connection(&mut self) {
        let old = self.dns_tcp_generation;
        self.dns_tcp_generation = self.dns_tcp_generation.wrapping_add(1);
        self.dns_tcp_rx.clear();
        self.dns_tcp_tx.clear();
        self.pending_dns.retain(|_, pending| {
            !matches!(pending.target, DnsTarget::Tcp { generation } if generation == old)
        });
    }

    fn pump_dns_tcp(&mut self, now_ms: i64) {
        use smoltcp::socket::tcp::State;

        if self.stack.dns_tcp_state() == State::Closed && self.stack.dns_tcp_relisten() {
            self.reset_dns_tcp_connection();
        }

        if matches!(
            self.stack.dns_tcp_state(),
            State::Established | State::CloseWait
        ) {
            let received = self.stack.dns_tcp_recv();
            if !received.is_empty() {
                self.dns_tcp_rx.extend_from_slice(&received);
            }

            loop {
                if self.pending_dns.len() >= MAX_PENDING_DNS {
                    break;
                }
                let (message, consumed) = match next_message(&self.dns_tcp_rx) {
                    TcpFrame::Message { msg, consumed } => (msg.to_vec(), consumed),
                    TcpFrame::NeedMore { .. } => break,
                };
                self.dns_tcp_rx.drain(..consumed);
                self.submit_dns(
                    message,
                    DnsTarget::Tcp {
                        generation: self.dns_tcp_generation,
                    },
                    now_ms,
                );
            }

            while let Some(write) = self.dns_tcp_tx.front_mut() {
                let accepted = self.stack.dns_tcp_send(&write.bytes[write.offset..]);
                if accepted == 0 {
                    break;
                }
                write.offset += accepted;
                if write.offset == write.bytes.len() {
                    self.dns_tcp_tx.pop_front();
                }
            }

            let generation = self.dns_tcp_generation;
            let unresolved = self.pending_dns.values().any(
                |pending| matches!(pending.target, DnsTarget::Tcp { generation: g } if g == generation),
            );
            if self.stack.dns_tcp_state() == State::CloseWait
                && !unresolved
                && self.dns_tcp_tx.is_empty()
            {
                self.stack.dns_tcp_close();
            }
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
        if let Some(flow) = self.udp_flows.remove(key)
            && let Some(c) = self.connector.as_mut()
        {
            c.udp_close(flow.conn);
        }
        self.manager.remove(key);
    }

    /// Pump connected UDP sockets without coalescing or splitting application datagrams.
    fn pump_udp(&mut self) {
        if self.connector.is_none() {
            return;
        }
        let keys: Vec<FlowKey> = self.udp_flows.keys().cloned().collect();
        for key in keys {
            let Some(flow) = self.udp_flows.get(&key) else {
                continue;
            };
            let conn = flow.conn;
            match self
                .connector
                .as_mut()
                .expect("checked above")
                .udp_status(conn)
            {
                ConnStatus::Failed(_) | ConnStatus::Closed => {
                    self.teardown(&key);
                    continue;
                }
                ConnStatus::Connecting => continue,
                ConnStatus::Established => {}
            }

            while let Some(payload) = self.udp_flows[&key].pending.front() {
                if !self
                    .connector
                    .as_mut()
                    .expect("checked above")
                    .udp_send(conn, payload)
                {
                    break;
                }
                let payload = self
                    .udp_flows
                    .get_mut(&key)
                    .unwrap()
                    .pending
                    .pop_front()
                    .unwrap();
                self.udp_flows.get_mut(&key).unwrap().pending_bytes -= payload.len();
            }

            let datagrams = self
                .connector
                .as_mut()
                .expect("checked above")
                .udp_recv(conn);
            let guest = self.udp_flows[&key].guest.clone();
            for payload in datagrams {
                if let Some(frame) = build_udp_frame(
                    self.gateway_mac,
                    guest.src_mac,
                    guest.dst_ip,
                    guest.dst_port,
                    guest.src_ip,
                    guest.src_port,
                    &payload,
                ) {
                    self.stack.push_egress(frame);
                }
            }
        }
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
            // Do not drain another smoltcp receive window until the previous connector tail has
            // cleared. Leaving bytes in the fixed-size socket buffer is how TCP backpressure reaches
            // the guest; repeatedly draining into `pending_out` would make a stalled upload unbounded.
            if self.flows[&key].pending_out.is_empty() {
                let from_guest = self.stack.tcp_recv(handle);
                if !from_guest.is_empty() {
                    self.flows
                        .get_mut(&key)
                        .unwrap()
                        .pending_out
                        .extend_from_slice(&from_guest);
                }
            }
            let pending = core::mem::take(&mut self.flows.get_mut(&key).unwrap().pending_out);
            if !pending.is_empty() {
                let accepted = self.connector.as_mut().unwrap().send(conn, &pending);
                // Keep the unaccepted tail for next pass (lossless under backpressure).
                self.flows.get_mut(&key).unwrap().pending_out = pending[accepted..].to_vec();
            }

            // Guest FIN → forward a write-shutdown to the remote, once, after the pending drained.
            // The exact stack state matters: `may_recv()` is ALSO false in `SynReceived`, and a fast
            // connector can become Established before the guest ACK reaches this listener. Treating
            // that optimistic-accept window as a FIN silently half-closes early under concurrency.
            // `CloseWait` is the unambiguous state after the guest (our TCP peer) actually sent FIN.
            if status == ConnStatus::Established
                && self.stack.tcp_state(handle) == Some(smoltcp::socket::tcp::State::CloseWait)
                && self.flows[&key].pending_out.is_empty()
                && !self.flows[&key].guest_fin_sent
            {
                self.connector.as_mut().unwrap().shutdown_write(conn);
                self.flows.get_mut(&key).unwrap().guest_fin_sent = true;
            }

            // remote → guest: buffer whatever the remote sent, then flush as much as the guest-facing
            // socket's tx window accepts — keeping the unaccepted tail for next pass. `tcp_send` returns
            // < len when the guest drains slower than the remote sends; discarding that tail silently
            // truncates any bulk download (critic MAJOR). This mirrors the guest→remote `pending_out`.
            // Mirror the outbound rule: while a tail is waiting for the guest-facing socket, leave
            // new bytes in the connector's bounded queue so its credit/window backpressures the
            // remote. Tiny connector deliveries may be coalesced only up to one fixed socket-buffer
            // cap; this keeps a 1-byte-framed 100 MiB transfer linear without weakening bounds.
            if self.flows[&key].pending_in.is_empty() {
                while self.flows[&key].pending_in.len() < MAX_REMOTE_STAGING_BYTES {
                    let appended = self
                        .connector
                        .as_mut()
                        .unwrap()
                        .recv_into(conn, &mut self.flows.get_mut(&key).unwrap().pending_in);
                    if appended == 0 {
                        break;
                    }
                }
            }
            let pending_in = core::mem::take(&mut self.flows.get_mut(&key).unwrap().pending_in);
            if !pending_in.is_empty() {
                let accepted = self.stack.tcp_send(handle, &pending_in);
                self.flows.get_mut(&key).unwrap().pending_in = pending_in[accepted..].to_vec();
            }

            // Remote half-closed and everything delivered (nothing left buffered inbound) → FIN the
            // guest. Teardown waits until the guest has also finished (its socket leaves the connection)
            // so the FIN is acknowledged.
            if status == ConnStatus::Closed && self.flows[&key].pending_in.is_empty() {
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
            if let Some((handle, guest_mac)) = self
                .flows
                .get(&key)
                .map(|flow| (flow.handle, flow.guest_mac))
            {
                // Idle expiry aborts a live guest connection. Poll while the socket and its flow
                // mapping still exist so smoltcp emits the RST before teardown removes the socket.
                if let IpAddr::V4(guest_ip) = key.guest_ip {
                    self.stack.remember_guest_neighbor(guest_ip, guest_mac);
                    self.stack.poll(now as i64);
                }
                self.stack.tcp_abort(handle);
                self.stack.poll(now as i64);
            }
            self.teardown(&key);
        }
    }

    /// Drive one servicing pass: poll smoltcp, answer DHCP, submit/poll UDP and TCP DNS work, pump
    /// outbound TCP/UDP, then harvest egress. The second stack poll flushes segments queued by both
    /// the external pump and the internal DNS-over-TCP listener.
    fn service(&mut self) {
        let now = (self.clock)();
        self.stack.poll(now);
        self.stack.run_dhcp(&self.dhcp);
        self.submit_udp_dns(now);
        self.pump_dns_tcp(now);
        self.poll_dns_completions();
        self.pump_dns_tcp(now);
        self.pump();
        self.pump_udp();
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
    fn external_io_pending(&self) -> bool {
        // Browser WebSocket callbacks can run only between wasm `runChunk` calls. Once a NAT flow
        // exists, a remote TCP/UDP reply may therefore be waiting in the host event loop even when
        // no guest-bound ethernet frame is staged yet. Tell the machine not to WFI-fast-forward a
        // guest socket timeout past that delivery opportunity.
        (self.connector.is_some() && self.manager.flow_count() > 0)
            || !self.pending_dns.is_empty()
            || self.dns.as_ref().is_some_and(|dns| dns.pending())
    }

    fn poll(&mut self) {
        if self.connector.is_none() && self.dns.is_none() {
            return;
        }
        let now = (self.clock)();
        if self.last_background_poll_ms == Some(now) {
            return;
        }
        self.last_background_poll_ms = Some(now);
        self.service();
    }

    fn tx(&mut self, frame: &[u8]) {
        if !self.classify_udp(frame) {
            self.classify_and_connect(frame);
            self.stack.inject(frame.to_vec());
        }
        self.service();
    }

    fn rx(&mut self) -> Option<Vec<u8>> {
        // With outbound flows, the remote can produce bytes with no guest frame to trigger `service`.
        // When the caller polls for a frame and nothing is queued, run a servicing pass so
        // remote→guest data (and connect-state transitions) are picked up. (No connector → nothing to
        // pump; the branch is skipped, so slice-1 behaviour is byte-identical.)
        if self.egress.is_empty() && (self.connector.is_some() || self.dns.is_some()) {
            self.service();
        }
        self.egress.pop_front()
    }

    fn rx_ready(&self) -> bool {
        // Pure readiness predicate. Event-driven connector work is advanced by `NetBackend::poll`
        // before the device asks this question, so remote data can wake a booted guest even when the
        // guest is waiting and emits no further frames.
        !self.egress.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use smoltcp::wire::{
        ArpOperation, ArpPacket, ArpRepr, EthernetAddress, EthernetFrame, EthernetProtocol,
        EthernetRepr, IpAddress, IpProtocol, Ipv4Packet, Ipv4Repr, TcpControl, TcpPacket, TcpRepr,
        TcpSeqNumber,
    };
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
    const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x02];
    use core::net::Ipv4Addr;
    const GUEST_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 15);
    const GW_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 2);

    struct ImmediateDns {
        answer_count: usize,
        completions: VecDeque<crate::DnsCompletion>,
        submissions: Rc<Cell<usize>>,
    }

    impl ImmediateDns {
        fn new(answer_count: usize, submissions: Rc<Cell<usize>>) -> Self {
            Self {
                answer_count,
                completions: VecDeque::new(),
                submissions,
            }
        }
    }

    impl DnsService for ImmediateDns {
        fn submit(&mut self, request: DnsRequest) -> Result<(), DnsRequest> {
            self.submissions.set(self.submissions.get() + 1);
            let query = dns::parse_query(&request.message).unwrap();
            let answers: Vec<_> = (0..self.answer_count)
                .map(|index| dns::Answer::a(Ipv4Addr::new(192, 0, 2, (index % 250 + 1) as u8), 60))
                .collect();
            self.completions.push_back(crate::DnsCompletion {
                id: request.id,
                message: Some(dns::build_response(&query, dns::RCODE_NOERROR, &answers)),
            });
            Ok(())
        }

        fn poll(&mut self) -> Vec<crate::DnsCompletion> {
            self.completions.drain(..).collect()
        }

        fn pending(&self) -> bool {
            !self.completions.is_empty()
        }
    }

    struct StalledDns;

    impl DnsService for StalledDns {
        fn submit(&mut self, _request: DnsRequest) -> Result<(), DnsRequest> {
            Ok(())
        }

        fn poll(&mut self) -> Vec<crate::DnsCompletion> {
            Vec::new()
        }

        fn pending(&self) -> bool {
            true
        }
    }

    fn guest_tcp_segment(
        dst: Ipv4Addr,
        src_port: u16,
        dst_port: u16,
        seq: i32,
        ack: Option<i32>,
        control: TcpControl,
        payload: &[u8],
    ) -> Vec<u8> {
        let tcp = TcpRepr {
            src_port,
            dst_port,
            control,
            seq_number: TcpSeqNumber(seq),
            ack_number: ack.map(TcpSeqNumber),
            window_len: 64240,
            window_scale: None,
            max_seg_size: None,
            sack_permitted: false,
            sack_ranges: [None, None, None],
            timestamp: None,
            payload,
        };
        let ip = Ipv4Repr {
            src_addr: GUEST_IP,
            dst_addr: dst,
            next_header: IpProtocol::Tcp,
            payload_len: tcp.buffer_len(),
            hop_limit: 64,
        };
        let eth = EthernetRepr {
            src_addr: EthernetAddress(GUEST_MAC),
            dst_addr: EthernetAddress(GW_MAC),
            ethertype: EthernetProtocol::Ipv4,
        };
        let mut bytes = vec![0; eth.buffer_len() + ip.buffer_len() + tcp.buffer_len()];
        let caps = smoltcp::phy::ChecksumCapabilities::default();
        let mut frame = EthernetFrame::new_unchecked(&mut bytes);
        eth.emit(&mut frame);
        let mut ip_packet = Ipv4Packet::new_unchecked(frame.payload_mut());
        ip.emit(&mut ip_packet, &caps);
        let mut tcp_packet = TcpPacket::new_unchecked(ip_packet.payload_mut());
        tcp.emit(
            &mut tcp_packet,
            &IpAddress::Ipv4(GUEST_IP),
            &IpAddress::Ipv4(dst),
            &caps,
        );
        bytes
    }

    #[derive(Default)]
    struct UdpProbeState {
        opened: Vec<(Ipv4Addr, u16)>,
        sent: Vec<Vec<u8>>,
        replies: Vec<Vec<u8>>,
        closed: usize,
    }

    struct UdpProbe(Rc<RefCell<UdpProbeState>>);

    impl SyncConnector for UdpProbe {
        fn connect(&mut self, _host: Ipv4Addr, _port: u16) -> ConnId {
            0
        }
        fn status(&mut self, _id: ConnId) -> ConnStatus {
            ConnStatus::Failed(crate::ConnectError::Unreachable)
        }
        fn recv(&mut self, _id: ConnId) -> Vec<u8> {
            Vec::new()
        }
        fn send(&mut self, _id: ConnId, _data: &[u8]) -> usize {
            0
        }
        fn shutdown_write(&mut self, _id: ConnId) {}
        fn close(&mut self, _id: ConnId) {}

        fn udp_open(&mut self, host: Ipv4Addr, port: u16) -> DatagramId {
            self.0.borrow_mut().opened.push((host, port));
            DatagramId(7)
        }
        fn udp_status(&mut self, id: DatagramId) -> ConnStatus {
            assert_eq!(id, DatagramId(7));
            ConnStatus::Established
        }
        fn udp_send(&mut self, id: DatagramId, payload: &[u8]) -> bool {
            assert_eq!(id, DatagramId(7));
            self.0.borrow_mut().sent.push(payload.to_vec());
            true
        }
        fn udp_recv(&mut self, id: DatagramId) -> Vec<Vec<u8>> {
            assert_eq!(id, DatagramId(7));
            std::mem::take(&mut self.0.borrow_mut().replies)
        }
        fn udp_close(&mut self, id: DatagramId) {
            assert_eq!(id, DatagramId(7));
            self.0.borrow_mut().closed += 1;
        }
    }

    #[derive(Default)]
    struct FloodProbeState {
        next: u64,
        closed: usize,
    }

    struct FloodProbe(Rc<RefCell<FloodProbeState>>);

    impl SyncConnector for FloodProbe {
        fn connect(&mut self, _host: Ipv4Addr, _port: u16) -> ConnId {
            0
        }
        fn status(&mut self, _id: ConnId) -> ConnStatus {
            ConnStatus::Failed(crate::ConnectError::Unreachable)
        }
        fn recv(&mut self, _id: ConnId) -> Vec<u8> {
            Vec::new()
        }
        fn send(&mut self, _id: ConnId, _data: &[u8]) -> usize {
            0
        }
        fn shutdown_write(&mut self, _id: ConnId) {}
        fn close(&mut self, _id: ConnId) {}

        fn udp_open(&mut self, _host: Ipv4Addr, _port: u16) -> DatagramId {
            let mut state = self.0.borrow_mut();
            let id = DatagramId(state.next);
            state.next += 1;
            id
        }
        fn udp_status(&mut self, _id: DatagramId) -> ConnStatus {
            ConnStatus::Established
        }
        fn udp_send(&mut self, _id: DatagramId, _payload: &[u8]) -> bool {
            true
        }
        fn udp_recv(&mut self, _id: DatagramId) -> Vec<Vec<u8>> {
            Vec::new()
        }
        fn udp_close(&mut self, _id: DatagramId) {
            self.0.borrow_mut().closed += 1;
        }
    }

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

    #[test]
    fn oversized_udp_dns_answer_sets_tc_then_full_answer_succeeds_over_tcp() {
        let submissions = Rc::new(Cell::new(0));
        let mut be = SlirpLocalBackend::new(GW_MAC, Box::new(|| 1))
            .with_dns_service(Box::new(ImmediateDns::new(40, submissions.clone())));

        let query = dns::build_query(0xD15A, "many.test", dns::TYPE_A);
        let udp_query = build_udp_frame(
            GUEST_MAC,
            GW_MAC,
            GUEST_IP,
            40530,
            crate::net::DNS,
            53,
            &query,
        )
        .unwrap();
        be.tx(&udp_query);
        let truncated = loop {
            let frame = be.rx().expect("UDP DNS answer");
            if let Some(udp) = parse_udp(&frame)
                && udp.src_ip == crate::net::DNS
                && udp.src_port == 53
            {
                break udp.payload;
            }
        };
        assert_ne!(truncated[2] & 0x02, 0, "oversized UDP answer sets TC=1");
        assert_eq!(u16::from_be_bytes([truncated[6], truncated[7]]), 0);

        // Prime the guest neighbor, then perform the resolver's TCP retry against 10.0.2.3:53.
        be.tx(&guest_arp_request());
        while be.rx().is_some() {}
        let client_port = 40531;
        be.tx(&guest_tcp_segment(
            crate::net::DNS,
            client_port,
            53,
            1000,
            None,
            TcpControl::Syn,
            &[],
        ));
        let server_isn = loop {
            let frame = be.rx().expect("DNS TCP SYN-ACK");
            let Ok(eth) = EthernetFrame::new_checked(&frame) else {
                continue;
            };
            let Ok(ip) = Ipv4Packet::new_checked(eth.payload()) else {
                continue;
            };
            let Ok(tcp) = TcpPacket::new_checked(ip.payload()) else {
                continue;
            };
            if tcp.src_port() == 53 && tcp.dst_port() == client_port && tcp.syn() && tcp.ack() {
                break tcp.seq_number().0;
            }
        };
        be.tx(&guest_tcp_segment(
            crate::net::DNS,
            client_port,
            53,
            1001,
            Some(server_isn.wrapping_add(1)),
            TcpControl::None,
            &[],
        ));
        while be.rx().is_some() {}
        let framed_query = frame_message(&query).unwrap();
        be.tx(&guest_tcp_segment(
            crate::net::DNS,
            client_port,
            53,
            1001,
            Some(server_isn.wrapping_add(1)),
            TcpControl::Psh,
            &framed_query,
        ));

        let mut stream = Vec::new();
        let mut expected_server_seq = server_isn.wrapping_add(1);
        let client_seq = 1001i32.wrapping_add(framed_query.len() as i32);
        for _ in 0..8 {
            let Some(frame) = be.rx() else {
                break;
            };
            let Ok(eth) = EthernetFrame::new_checked(&frame) else {
                continue;
            };
            let Ok(ip) = Ipv4Packet::new_checked(eth.payload()) else {
                continue;
            };
            let Ok(tcp) = TcpPacket::new_checked(ip.payload()) else {
                continue;
            };
            if tcp.src_port() == 53
                && tcp.dst_port() == client_port
                && !tcp.payload().is_empty()
                && tcp.seq_number().0 == expected_server_seq
            {
                stream.extend_from_slice(tcp.payload());
                expected_server_seq = expected_server_seq.wrapping_add(tcp.payload().len() as i32);
                // A real resolver ACKs each TCP segment; doing so here lets smoltcp emit the rest of
                // an answer larger than its conservative 536-byte initial segment.
                be.tx(&guest_tcp_segment(
                    crate::net::DNS,
                    client_port,
                    53,
                    client_seq,
                    Some(expected_server_seq),
                    TcpControl::None,
                    &[],
                ));
                if matches!(next_message(&stream), TcpFrame::Message { .. }) {
                    break;
                }
            }
        }
        let TcpFrame::Message { msg, consumed } = next_message(&stream) else {
            panic!(
                "full length-prefixed DNS answer must arrive over TCP ({} bytes, prefix {:?})",
                stream.len(),
                &stream[..stream.len().min(8)]
            );
        };
        assert_eq!(consumed, stream.len());
        let answer = dns::parse_response(&msg).unwrap();
        assert_eq!(answer.a_records.len(), 40);
        assert_eq!(submissions.get(), 2, "one UDP resolve plus the TCP retry");
    }

    #[test]
    fn full_dns_queue_returns_immediate_servfail_over_tcp() {
        let mut be =
            SlirpLocalBackend::new(GW_MAC, Box::new(|| 1)).with_dns_service(Box::new(StalledDns));

        // Establish the permanent DNS-over-TCP listener through the real guest-facing stack.
        be.tx(&guest_arp_request());
        while be.rx().is_some() {}
        let client_port = 40532;
        be.tx(&guest_tcp_segment(
            crate::net::DNS,
            client_port,
            53,
            1000,
            None,
            TcpControl::Syn,
            &[],
        ));
        let server_isn = loop {
            let frame = be.rx().expect("DNS TCP SYN-ACK");
            let Ok(eth) = EthernetFrame::new_checked(&frame) else {
                continue;
            };
            let Ok(ip) = Ipv4Packet::new_checked(eth.payload()) else {
                continue;
            };
            let Ok(tcp) = TcpPacket::new_checked(ip.payload()) else {
                continue;
            };
            if tcp.src_port() == 53 && tcp.dst_port() == client_port && tcp.syn() && tcp.ack() {
                break tcp.seq_number().0;
            }
        };
        be.tx(&guest_tcp_segment(
            crate::net::DNS,
            client_port,
            53,
            1001,
            Some(server_isn.wrapping_add(1)),
            TcpControl::None,
            &[],
        ));
        while be.rx().is_some() {}

        // Saturate the bounded resolver queue with accepted work that deliberately never completes.
        let stalled = dns::build_query(0x5100, "stalled.test", dns::TYPE_A);
        for _ in 0..MAX_PENDING_DNS {
            be.submit_dns(
                stalled.clone(),
                DnsTarget::Tcp {
                    generation: u64::MAX,
                },
                1,
            );
        }
        assert_eq!(be.pending_dns.len(), MAX_PENDING_DNS);

        // The next complete, valid message must be consumed and rejected with a framed SERVFAIL.
        let query = dns::build_query(0x5151, "queue-full.test", dns::TYPE_A);
        let framed_query = frame_message(&query).unwrap();
        be.tx(&guest_tcp_segment(
            crate::net::DNS,
            client_port,
            53,
            1001,
            Some(server_isn.wrapping_add(1)),
            TcpControl::Psh,
            &framed_query,
        ));

        let mut stream = Vec::new();
        for frame in &be.egress {
            let Ok(eth) = EthernetFrame::new_checked(frame) else {
                continue;
            };
            let Ok(ip) = Ipv4Packet::new_checked(eth.payload()) else {
                continue;
            };
            let Ok(tcp) = TcpPacket::new_checked(ip.payload()) else {
                continue;
            };
            if tcp.src_port() == 53 && tcp.dst_port() == client_port {
                stream.extend_from_slice(tcp.payload());
            }
        }
        let parsed = dns::parse_query(&query).unwrap();
        let expected = frame_message(&dns::servfail(&parsed)).unwrap();
        assert_eq!(
            stream,
            expected,
            "a full DNS work queue must produce immediate framed SERVFAIL; pending={}, buffered={}",
            be.pending_dns.len(),
            be.dns_tcp_rx.len()
        );
        assert!(
            be.dns_tcp_rx.is_empty(),
            "complete query must not remain buffered"
        );
    }

    #[test]
    fn external_udp_preserves_datagrams_and_expires_its_nat_flow() {
        const REMOTE: Ipv4Addr = Ipv4Addr::new(198, 51, 100, 9);
        let state = Rc::new(RefCell::new(UdpProbeState {
            replies: vec![b"response-datagram".to_vec()],
            ..Default::default()
        }));
        let now = Rc::new(Cell::new(1i64));
        let clock = {
            let now = now.clone();
            Box::new(move || now.get())
        };
        let mut be =
            SlirpLocalBackend::with_connector(GW_MAC, clock, Box::new(UdpProbe(state.clone())));
        let request = build_udp_frame(
            GUEST_MAC,
            GW_MAC,
            GUEST_IP,
            41000,
            REMOTE,
            9999,
            b"request-datagram",
        )
        .unwrap();
        be.tx(&request);

        assert_eq!(state.borrow().opened, vec![(REMOTE, 9999)]);
        assert_eq!(state.borrow().sent, vec![b"request-datagram".to_vec()]);
        assert_eq!(be.flow_count(), 1, "one UDP five-tuple owns one NAT entry");

        let response = be
            .rx()
            .expect("the remote datagram was framed to the guest");
        let parsed = parse_udp(&response).expect("guest-bound response is valid IPv4/UDP");
        assert_eq!(parsed.src_ip, REMOTE);
        assert_eq!(parsed.src_port, 9999);
        assert_eq!(parsed.dst_ip, GUEST_IP);
        assert_eq!(parsed.dst_port, 41000);
        assert_eq!(parsed.payload, b"response-datagram");

        now.set(crate::nat::UDP_IDLE_MS as i64 + 1);
        be.poll();
        assert_eq!(be.flow_count(), 0, "UDP NAT expires after 30 seconds idle");
        assert_eq!(
            state.borrow().closed,
            1,
            "expiry closes the connector socket"
        );
    }

    /// Verifier-promoted attack from E3-T14: opening 1000 flows must stay bounded, and abandoning
    /// every survivor must let the timeout sweep close every connector resource and return the NAT
    /// table to zero.
    #[test]
    fn thousand_abandoned_udp_flows_are_bounded_then_fully_reaped() {
        const REMOTE: Ipv4Addr = Ipv4Addr::new(198, 51, 100, 29);
        let state = Rc::new(RefCell::new(FloodProbeState::default()));
        let now = Rc::new(Cell::new(1i64));
        let clock = {
            let now = now.clone();
            Box::new(move || now.get())
        };
        let mut be =
            SlirpLocalBackend::with_connector(GW_MAC, clock, Box::new(FloodProbe(state.clone())));

        for flow in 0..1000u16 {
            let request = build_udp_frame(
                GUEST_MAC,
                GW_MAC,
                GUEST_IP,
                40_000 + flow,
                REMOTE,
                9000,
                &[flow as u8],
            )
            .unwrap();
            be.tx(&request);
        }

        assert_eq!(be.flow_count(), MAX_FLOWS, "the NAT hard cap must hold");
        assert_eq!(
            state.borrow().closed,
            1000 - MAX_FLOWS,
            "each LRU eviction closes its connector socket"
        );

        now.set(crate::nat::UDP_IDLE_MS as i64 + 1);
        be.poll();
        assert_eq!(be.flow_count(), 0, "the timeout sweep reaps every survivor");
        assert_eq!(
            state.borrow().closed,
            1000,
            "eviction plus expiry closes every opened socket exactly once"
        );
    }
}
