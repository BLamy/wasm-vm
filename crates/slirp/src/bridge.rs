//! `Bridge` — the slirp control plane wired to real outbound connections. It ties [`FlowManager`]
//! (classify + NAT) to [`SlirpStack`] (accept sockets) and an [`OutboundConnector`]: a guest SYN to a
//! new external flow opens a listening socket AND connects the outbound side; retransmits/data feed
//! the existing socket; local frames go to smoltcp; eviction/teardown drops both the socket and the
//! outbound connection together (no leak).
//!
//! The connection LIFECYCLE (open/track/teardown) is generic and unit-tested with a mock connector.
//! The DATA PATH is a native-gated layer ([`Bridge::service`]): it spawns a per-flow byte pump
//! ([`pump_flow`](crate::pump_flow)) for each connected flow and, on each non-blocking pass, shuttles
//! bytes both ways with backpressure, propagates half-close in each direction, and reaps closed flows.
//! Kept behind `feature = "native"` (tokio channels + task) so the browser build never pulls tokio;
//! the guest↔echo round trip through `service` is proven end-to-end in `e2e_pump_stack.rs`.

use std::collections::BTreeMap;
#[cfg(test)]
use std::net::IpAddr;

use smoltcp::iface::SocketHandle;
use smoltcp::wire::EthernetFrame;

use crate::connector::OutboundConnector;
use crate::dhcp::DhcpServer;
use crate::manager::{Action, FlowManager};
use crate::nat::FlowKey;
use crate::stack::SlirpStack;

/// A live flow's resources: its smoltcp socket handle and the outbound byte stream. The stream is
/// held in an `Option` so the native servicing layer can `take` it to hand to a per-flow byte pump
/// (see [`Bridge::service`]); until then it just sits here keeping the connection open.
struct FlowConn<S> {
    handle: SocketHandle,
    guest_mac: [u8; 6],
    // Read only by the native servicing layer (which `take`s it for the pump). Without `native` it
    // just holds the connection open until teardown, so it's legitimately unread there.
    #[cfg_attr(not(feature = "native"), allow(dead_code))]
    stream: Option<S>,
}

/// Drives guest frames → outbound connections over a bounded set of flows.
pub struct Bridge<C: OutboundConnector> {
    stack: SlirpStack,
    manager: FlowManager,
    connector: C,
    last_now_ms: i64,
    flows: BTreeMap<FlowKey, FlowConn<C::Conn>>,
    /// Per-flow byte pumps (native only — tokio channels + task). Populated lazily by
    /// [`Bridge::service`]; empty until then. Feature-gated so the browser build never pulls tokio.
    #[cfg(feature = "native")]
    pumps: BTreeMap<FlowKey, pump::PumpHandle>,
}

#[cfg(feature = "native")]
mod pump {
    use smoltcp::iface::SocketHandle;
    use tokio::sync::mpsc;
    use tokio::task::JoinHandle;

    use crate::pump::{PumpEvent, PumpStats};

    /// A running flow's pump plumbing: the channel we feed guest bytes into (`to_pump`, `None` once
    /// the guest half-closed), the channel we drain outbound bytes from (`from_pump`), a small buffer
    /// for bytes smoltcp couldn't accept yet (`pending_out`), and the pump task handle. `SocketHandle`
    /// is stored so servicing can find the socket without re-borrowing the flow map.
    pub(super) struct PumpHandle {
        pub handle: SocketHandle,
        pub to_pump: Option<mpsc::Sender<Vec<u8>>>,
        pub from_pump: mpsc::Receiver<PumpEvent>,
        pub pending_out: Vec<u8>,
        /// A terminal condition waits here until any preceding data is accepted by smoltcp. Reset
        /// overrides EOF because observing any I/O error invalidates a previously-racing clean FIN.
        pub terminal: Option<PumpEvent>,
        pub terminal_sent: bool,
        pub _join: JoinHandle<PumpStats>,
    }
}

impl<C: OutboundConnector> Bridge<C> {
    /// A bridge with gateway MAC `mac`, bounded to `max_flows` concurrent flows.
    pub fn new(mac: [u8; 6], connector: C, max_flows: usize) -> Self {
        Bridge {
            stack: SlirpStack::new(mac),
            manager: FlowManager::new(max_flows),
            connector,
            last_now_ms: 0,
            flows: BTreeMap::new(),
            #[cfg(feature = "native")]
            pumps: BTreeMap::new(),
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
        self.last_now_ms = now_ms;
        self.stack.poll(now_ms);
    }

    /// Answer every DHCP datagram diverted by the stack. The native CLI driver calls this beside
    /// `poll` so an actual Alpine guest can configure eth0 without a test-only static address.
    pub fn run_dhcp(&mut self, dhcp: &DhcpServer) -> usize {
        self.stack.run_dhcp(dhcp)
    }

    /// Process one guest frame: classify it, drive the flow lifecycle, and hand the frame to the
    /// stack (whose `accept_frame` filter is the real gate — it admits ARP/ICMP for the gateway and
    /// TCP for opened endpoints, drops the rest). On a NEW flow (`Connect`) we open a listening socket
    /// and `connect` the outbound side before injecting the SYN (so it passes the filter); on connect
    /// failure we briefly accept then abort the half-open flow so the guest gets a prompt RST.
    /// Any flow the NAT evicted to make room is torn down first.
    pub async fn on_guest_frame(&mut self, frame: Vec<u8>, now_ms: u64) {
        let out = self.manager.on_guest_frame(&frame, now_ms);
        if let Some(evicted) = out.evicted {
            self.teardown(&evicted);
        }
        if let Action::Connect(key) = out.action {
            let guest_mac = EthernetFrame::new_checked(&frame)
                .expect("a classified TCP frame is valid Ethernet")
                .src_addr()
                .0;
            let handle = self.stack.open_tcp_flow(&key);
            match self.connector.connect(key.dst_ip, key.dst_port).await {
                Ok(stream) => {
                    self.flows.insert(
                        key,
                        FlowConn {
                            handle,
                            guest_mac,
                            stream: Some(stream),
                        },
                    );
                }
                Err(_refused) => {
                    // Let smoltcp consume the SYN through the listener, then abort and poll BEFORE
                    // removing the socket. `abort` only queues the RST; removing first would erase it
                    // and leave the guest half-open until its own timeout.
                    self.stack.inject(frame);
                    self.stack.poll(now_ms as i64);
                    self.stack.tcp_abort(handle);
                    self.stack.poll(now_ms as i64);
                    self.stack.remove_tcp(handle);
                    self.manager.remove(&key);
                    self.last_now_ms = now_ms as i64;
                    return;
                }
            }
        }
        // The stack's `accept_frame` filter decides what smoltcp actually sees.
        self.stack.inject(frame);
        // CRITICAL (critic pass-2h): consume the frame IMMEDIATELY, under the socket topology it was
        // admitted through. `inject` admits now but `poll` consumes later; if we defer, a SYN admitted
        // under flow A's endpoint can outlive A's eviction and be swallowed by flow B's freshly-opened
        // listener that `(dst,port)`-aliases it (smoltcp reuses the handle slot) — a forged SYN-ACK to
        // the torn-down flow AND B's listener bound to the wrong guest 4-tuple. Polling here makes
        // "process each admitted frame before any topology change" an invariant: no frame survives a
        // later `open_tcp`/`remove_tcp`. (The full-4-tuple accept guard for concurrent same-endpoint
        // flows is a byte-pump-slice refinement — see the accept_frame note in `stack.rs`.)
        self.stack.poll(now_ms as i64);
        self.last_now_ms = now_ms as i64;
    }

    /// Sweep idle-expired flows at `now_ms`, tearing each down.
    pub fn expire(&mut self, now_ms: u64) {
        for key in self.manager.expire(now_ms) {
            if let Some((handle, guest_mac)) =
                self.flows.get(&key).map(|fc| (fc.handle, fc.guest_mac))
            {
                // Expiry is an abort, not a clean half-close. Keep the socket installed until
                // smoltcp has turned the abort into a guest-visible RST; removing it first erases
                // the queued segment and leaves the guest hanging until its own timeout.
                if let std::net::IpAddr::V4(guest_ip) = key.guest_ip {
                    self.stack.remember_guest_neighbor(guest_ip, guest_mac);
                    self.stack.poll(now_ms as i64);
                }
                self.stack.tcp_abort(handle);
                self.stack.poll(now_ms as i64);
            }
            if let Some(fc) = self.flows.remove(&key) {
                self.stack.remove_tcp(fc.handle);
            }
            // Dropping the pump handle closes both channels, so the pump task's copy of the stream is
            // dropped and it finishes; the join handle is detached (no await here).
            #[cfg(feature = "native")]
            self.pumps.remove(&key);
        }
    }

    /// Tear down one flow: drop its outbound stream and remove its smoltcp socket. Also drops the
    /// manager's NAT entry so a later SYN for the 4-tuple re-connects cleanly.
    fn teardown(&mut self, key: &FlowKey) {
        if let Some(fc) = self.flows.remove(key) {
            self.stack.remove_tcp(fc.handle);
        }
        #[cfg(feature = "native")]
        self.pumps.remove(key);
        self.manager.remove(key);
    }
}

/// Per-flow pump channel depth: bounds buffering each way so a slow peer backpressures the other
/// side (via smoltcp's window / the pump's `write_all`) instead of growing memory unbounded.
#[cfg(feature = "native")]
const PUMP_DEPTH: usize = 16;

/// Has the guest finished sending (sent FIN)? True once our socket can no longer receive — the peer
/// has closed its write side. Used to half-close the outbound direction.
#[cfg(feature = "native")]
fn guest_finished_sending(state: Option<smoltcp::socket::tcp::State>) -> bool {
    use smoltcp::socket::tcp::State::*;
    matches!(
        state,
        Some(CloseWait | Closing | LastAck | TimeWait | Closed) | None
    )
}

#[cfg(feature = "native")]
impl<C: OutboundConnector> Bridge<C>
where
    C::Conn: tokio::io::AsyncRead + tokio::io::AsyncWrite + Send + 'static,
{
    /// Spawn a byte pump for every connected flow that doesn't have one yet: take the flow's outbound
    /// stream and hand it to [`pump_flow`](crate::pump_flow), wiring the two channels `service` drives.
    fn start_pumps(&mut self) {
        let fresh: Vec<FlowKey> = self
            .flows
            .iter()
            .filter(|(k, fc)| fc.stream.is_some() && !self.pumps.contains_key(k))
            .map(|(k, _)| k.clone())
            .collect();
        for key in fresh {
            let Some(fc) = self.flows.get_mut(&key) else {
                continue;
            };
            let Some(stream) = fc.stream.take() else {
                continue;
            };
            let handle = fc.handle;
            let (to_pump, to_pump_rx) = tokio::sync::mpsc::channel(PUMP_DEPTH);
            let (from_pump_tx, from_pump) = tokio::sync::mpsc::channel(PUMP_DEPTH);
            let join = tokio::spawn(crate::pump_flow(stream, to_pump_rx, from_pump_tx));
            self.pumps.insert(
                key,
                pump::PumpHandle {
                    handle,
                    to_pump: Some(to_pump),
                    from_pump,
                    pending_out: Vec::new(),
                    terminal: None,
                    terminal_sent: false,
                    _join: join,
                },
            );
        }
    }

    /// One non-blocking servicing pass across all flows: spawn pumps for freshly-connected flows,
    /// shuttle bytes both ways with backpressure, propagate half-close in each direction, and reap
    /// flows whose socket has fully closed. Drive this after each `poll`/`on_guest_frame` and whenever
    /// the runtime nudges progress (this is the seam the eventual event loop / booted-guest wiring
    /// calls). The heavy byte-copy is on the pump tasks; this pass is cheap, non-blocking, and never
    /// awaits — so it can't stall the stack.
    pub fn service(&mut self) {
        self.start_pumps();
        // Take the pump map out so we can freely borrow `self.stack`/`self.flows` while iterating
        // (they're disjoint fields, but the borrow checker can't see that through `self`).
        let mut pumps = std::mem::take(&mut self.pumps);
        let mut finished: Vec<(FlowKey, SocketHandle)> = Vec::new();

        for (key, ph) in pumps.iter_mut() {
            let h = ph.handle;

            // guest → outbound: drain smoltcp only while the channel has room. An exhausted reserve
            // leaves bytes in the socket's rx buffer, so smoltcp closes the guest's window — real
            // backpressure, no unbounded growth.
            let mut fully_drained = true;
            if let Some(tx) = ph.to_pump.as_ref() {
                loop {
                    match tx.try_reserve() {
                        Ok(permit) => {
                            let d = self.stack.tcp_recv(h);
                            if d.is_empty() {
                                break;
                            }
                            permit.send(d);
                        }
                        Err(_) => {
                            fully_drained = false; // channel full — more guest bytes may be pending
                            break;
                        }
                    }
                }
            }

            // Guest half-close: once the guest has FIN'd AND we've forwarded everything it sent, drop
            // our sender so the pump FINs the outbound write side (the server may still send).
            if fully_drained
                && ph.to_pump.is_some()
                && guest_finished_sending(self.stack.tcp_state(h))
            {
                ph.to_pump = None;
            }

            // outbound → guest: pull served bytes, noting when the pump has closed its side (server
            // FIN/EOF), then feed the socket (partial-accept safe — the remainder retries next pass).
            // BACKPRESSURE (critic MAJOR): only pull the NEXT batch once the previous one has fully
            // reached the socket. If we drained `from_pump` unconditionally, a fast server + a stalled
            // guest (its window shut, so `tcp_send` accepts 0) would inflate `pending_out` — an
            // unbounded plain `Vec` — without limit → remote OOM from a single flow. Leaving bytes in
            // the BOUNDED `from_pump` channel instead blocks the pump's `guest_tx.send`, which
            // backpressures the real server. (The FIN guard below already requires `pending_out`
            // empty, so deferring `Disconnected` detection until the buffer flushes loses nothing.)
            if ph.pending_out.is_empty() {
                loop {
                    match ph.from_pump.try_recv() {
                        Ok(crate::pump::PumpEvent::Data(chunk)) => {
                            ph.pending_out.extend_from_slice(&chunk)
                        }
                        Ok(crate::pump::PumpEvent::Eof) => {
                            if ph.terminal.is_none() {
                                ph.terminal = Some(crate::pump::PumpEvent::Eof);
                            }
                            break;
                        }
                        Ok(crate::pump::PumpEvent::Reset) => {
                            ph.terminal = Some(crate::pump::PumpEvent::Reset);
                            break;
                        }
                        Err(tokio::sync::mpsc::error::TryRecvError::Empty) => break,
                        Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => {
                            // The pump contract always sends an explicit terminal event. A task that
                            // disappears without one is therefore abnormal and must fail closed.
                            if ph.terminal.is_none() && !ph.terminal_sent {
                                ph.terminal = Some(crate::pump::PumpEvent::Reset);
                            }
                            break;
                        }
                    }
                }
            }
            if !ph.pending_out.is_empty() {
                let n = self.stack.tcp_send(h, &ph.pending_out);
                ph.pending_out.drain(..n);
            }

            // Preserve the outbound terminal condition. A clean EOF half-closes with FIN; an I/O
            // error aborts with RST. Poll before reap so the terminal segment reaches egress.
            // Reset is not ordered behind buffered application data: a reset discards unacknowledged
            // bytes. Clean EOF, by contrast, must wait until all preceding bytes reach the socket.
            if matches!(ph.terminal, Some(crate::pump::PumpEvent::Reset)) {
                ph.pending_out.clear();
            }
            if ph.pending_out.is_empty() && !ph.terminal_sent && ph.terminal.is_some() {
                let terminal = ph.terminal.take().expect("checked above");
                match terminal {
                    crate::pump::PumpEvent::Eof => self.stack.tcp_close(h),
                    crate::pump::PumpEvent::Reset => self.stack.tcp_abort(h),
                    crate::pump::PumpEvent::Data(_) => unreachable!(),
                }
                self.stack.poll(self.last_now_ms);
                ph.terminal_sent = true;
            }

            // Reap when the socket is fully closed (or already gone): drop the pump + flow together.
            if matches!(
                self.stack.tcp_state(h),
                None | Some(smoltcp::socket::tcp::State::Closed)
            ) {
                finished.push((key.clone(), h));
            }
        }

        for (key, h) in finished {
            pumps.remove(&key);
            self.flows.remove(&key);
            self.stack.remove_tcp(h);
            self.manager.remove(&key);
        }
        self.pumps = pumps;
    }

    /// Total bytes buffered in the outbound→guest direction across all flows. Introspection hook for
    /// the backpressure regression test (it must stay bounded even against a flooding server).
    #[cfg(test)]
    pub(crate) fn pending_out_bytes(&self) -> usize {
        self.pumps.values().map(|p| p.pending_out.len()).sum()
    }
}

#[cfg(test)]
mod tests;
