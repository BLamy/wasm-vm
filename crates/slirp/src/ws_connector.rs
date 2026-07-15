//! E3-net slice 2b: `WsConnector` — a [`SyncConnector`](crate::SyncConnector) that reaches the
//! network through the [`ws_proxy`](crate::ws_proxy) WebSocket relay instead of a local socket. This
//! is the BROWSER outbound path: the wasm guest has no sockets, so TCP flows are tunnelled as
//! credit-controlled streams and UDP flows as boundary-preserving datagram frames to a relay.
//!
//! It drives the client half of the protocol — a [`Session`] (HELLO handshake) wrapping the client
//! [`Mux`](crate::ws_proxy::WsMux) — over a pluggable [`FrameTransport`]: the browser backs it with a
//! JS `WebSocket` (send = `ws.send(frame.encode())`, receive = decoded `onmessage`); native tests back
//! it with an in-process queue to a [`RelayCore`](crate::ws_proxy::RelayCore). The connector itself is
//! transport-agnostic and holds no sockets, so it compiles for wasm.
//!
//! **Flow control (both directions).** A fresh stream starts with zero credit each way. The relay
//! grants our *send* window when the connect succeeds (guest→remote backpressure). For the reverse
//! (remote→guest) WE must grant the relay credit, so `Opened` grants an initial window and each
//! [`recv`](SyncConnector::recv) refills it by the number of bytes the caller drained — a sliding
//! window that bounds buffering and can't overrun the guest.

extern crate alloc;
use alloc::collections::{BTreeMap, VecDeque};
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::net::Ipv4Addr;

use crate::connector::ConnectError;
use crate::sync_connector::{ConnId, ConnStatus, DatagramId, SyncConnector};
use crate::ws_proxy::relay::INITIAL_WINDOW;
use crate::ws_proxy::{FIRST_UDP_STREAM, Frame, MAX_DATAGRAM_BYTES, MuxEvent, Role, Session};

/// Per-flow guest→relay queue cap. The relay grants this same amount of initial credit; accepting
/// more while that credit is exhausted would merely move an unbounded stalled upload into the wasm
/// heap instead of closing the guest TCP window.
const MAX_PENDING_TX_BYTES: usize = INITIAL_WINDOW as usize;
/// Datagram queues are necessarily lossy under pressure; keep at most four maximum IPv4 datagrams
/// in either direction for one flow, then fail/drop instead of growing the wasm heap.
const MAX_UDP_QUEUE_BYTES: usize = 4 * MAX_DATAGRAM_BYTES;

/// Carries encoded ws-proxy [`Frame`]s over a transport, decoupled from the protocol state machine.
/// The browser implements this with a JS `WebSocket`; native tests with an in-process channel. All
/// methods are non-blocking (the wasm event loop can't block).
pub trait FrameTransport {
    /// Send one frame now (browser: `ws.send(frame.encode())`). Best-effort; a closed transport drops
    /// it (surfaced via [`is_open`](Self::is_open) → the streams fail).
    fn send(&mut self, frame: Frame);
    /// Drain every frame received since the last call (browser: the decoded `onmessage` queue).
    fn poll(&mut self) -> Vec<Frame>;
    /// Is the underlying transport still open? Once this is false the relay is unreachable and all
    /// live streams are failed.
    fn is_open(&self) -> bool;
}

/// One guest flow tunnelled as a ws-proxy stream.
struct Conn {
    /// The mux stream id, once the `OPEN` has been issued (`None` while still awaiting the handshake).
    stream: Option<u32>,
    host: String,
    port: u16,
    status: ConnStatus,
    /// Bytes received from the relay, awaiting the caller's `recv`.
    rx: Vec<u8>,
    /// Guest→remote bytes not yet sent (blocked on the send window). Re-offered each pump.
    pending_tx: VecDeque<u8>,
    /// The caller half-closed (`shutdown_write`); forward a `SHUTDOWN_WR` once `pending_tx` drains.
    want_shutdown: bool,
    /// We already forwarded the shutdown; don't repeat.
    shutdown_done: bool,
}

struct UdpConn {
    stream: Option<u32>,
    host: String,
    port: u16,
    status: ConnStatus,
    pending_tx: VecDeque<Vec<u8>>,
    pending_tx_bytes: usize,
    rx: VecDeque<Vec<u8>>,
    rx_bytes: usize,
}

/// A [`SyncConnector`] that tunnels guest TCP flows through the ws-proxy relay over a
/// [`FrameTransport`]. The browser outbound path (native-testable against a real `RelayCore`).
pub struct WsConnector<T: FrameTransport> {
    session: Session,
    transport: T,
    hello_sent: bool,
    /// The opening `HELLO` token, held until the first pump sends it.
    pending_token: Option<Vec<u8>>,
    next_id: ConnId,
    conns: BTreeMap<ConnId, Conn>,
    stream_to_conn: BTreeMap<u32, ConnId>,
    next_udp_id: u64,
    next_udp_stream: u32,
    udp: BTreeMap<DatagramId, UdpConn>,
    stream_to_udp: BTreeMap<u32, DatagramId>,
    /// Frames produced this pump, drained to the transport at the end (keeps mux borrows local).
    outbox: Vec<Frame>,
}

impl<T: FrameTransport> WsConnector<T> {
    /// A fresh client connector. `token` is the (optional) auth token carried in the opening `HELLO`
    /// (auth is a later task; empty is fine). The `HELLO` is sent on the first [`pump`](Self::pump).
    pub fn new(transport: T, token: Vec<u8>) -> Self {
        Self {
            session: Session::new(Role::Client),
            transport,
            hello_sent: false,
            pending_token: Some(token),
            next_id: 0,
            conns: BTreeMap::new(),
            stream_to_conn: BTreeMap::new(),
            next_udp_id: 0,
            next_udp_stream: FIRST_UDP_STREAM,
            udp: BTreeMap::new(),
            stream_to_udp: BTreeMap::new(),
            outbox: Vec::new(),
        }
    }

    fn active_flow_count(&self) -> usize {
        let tcp = self
            .conns
            .values()
            .filter(|conn| !is_terminal(&conn.status))
            .count();
        let udp = self
            .udp
            .values()
            .filter(|conn| !is_terminal(&conn.status))
            .count();
        tcp.saturating_add(udp)
    }

    /// Allocate only from the high-half datagram partition, skipping a still-live id after wrap.
    fn alloc_udp_stream(&mut self) -> Option<u32> {
        for _ in 0..=crate::ws_proxy::MAX_STREAMS {
            if self.next_udp_stream < FIRST_UDP_STREAM {
                self.next_udp_stream = FIRST_UDP_STREAM;
            }
            let stream = self.next_udp_stream;
            self.next_udp_stream = self.next_udp_stream.wrapping_add(1);
            if self.next_udp_stream < FIRST_UDP_STREAM {
                self.next_udp_stream = FIRST_UDP_STREAM;
            }
            let tcp_live = self
                .session
                .mux()
                .is_some_and(|mux| mux.get(stream).is_some());
            if !tcp_live && !self.stream_to_udp.contains_key(&stream) {
                return Some(stream);
            }
        }
        None
    }

    /// One servicing pass: send the opening `HELLO` if needed, drain inbound frames, issue any pending
    /// opens once the handshake completes, flush per-stream outbound work, then push all produced
    /// frames to the transport. Called at the top of every `SyncConnector` method so state stays live.
    fn pump(&mut self) {
        if !self.transport.is_open() {
            // The relay is gone — fail every non-terminal stream so the backend RSTs the guest.
            for c in self.conns.values_mut() {
                if !is_terminal(&c.status) {
                    c.status = ConnStatus::Failed(ConnectError::Unreachable);
                }
            }
            for c in self.udp.values_mut() {
                if !is_terminal(&c.status) {
                    c.status = ConnStatus::Failed(ConnectError::Unreachable);
                }
            }
            return;
        }

        if !self.hello_sent {
            let token = self.pending_token.take().unwrap_or_default();
            self.transport.send(self.session.hello(token));
            self.hello_sent = true;
        }

        // 1. Inbound frames: complete the handshake, then route through the mux.
        for frame in self.transport.poll() {
            if !self.session.is_ready() {
                // The relay's HELLO; a bad one (version mismatch / not-hello) means the relay is
                // unusable — fail everything rather than route into a never-ready session.
                if self.session.on_hello(&frame).is_err() {
                    for c in self.conns.values_mut() {
                        c.status = ConnStatus::Failed(ConnectError::Unreachable);
                    }
                    for c in self.udp.values_mut() {
                        c.status = ConnStatus::Failed(ConnectError::Unreachable);
                    }
                }
                continue;
            }
            if matches!(
                frame,
                Frame::UdpOpenOk { .. }
                    | Frame::UdpOpenFail { .. }
                    | Frame::UdpData { .. }
                    | Frame::UdpClose { .. }
            ) {
                self.handle_udp_frame(frame);
                continue;
            }
            // A malformed/out-of-order TCP frame is a defensive drop (garbage never panics).
            if let Ok(ev) = self.session.on_frame(frame) {
                self.handle_event(ev);
            }
        }

        // 2. Once ready, originate any streams still awaiting their OPEN.
        if self.session.is_ready() {
            let pending: Vec<ConnId> = self
                .conns
                .iter()
                .filter(|(_, c)| c.stream.is_none() && c.status == ConnStatus::Connecting)
                .map(|(id, _)| *id)
                .collect();
            for id in pending {
                let (host, port) = {
                    let c = &self.conns[&id];
                    (c.host.clone(), c.port)
                };
                let at_combined_cap = self
                    .session
                    .mux()
                    .map_or(0, |mux| mux.live_count())
                    .saturating_add(self.stream_to_udp.len())
                    >= crate::ws_proxy::MAX_STREAMS;
                let opened = if at_combined_cap {
                    Err(crate::ws_proxy::MuxError::TooManyStreams)
                } else {
                    self.session.mux_mut().unwrap().open(host, port)
                };
                match opened {
                    Ok((sid, frame)) => {
                        self.conns.get_mut(&id).unwrap().stream = Some(sid);
                        self.stream_to_conn.insert(sid, id);
                        self.outbox.push(frame);
                    }
                    // Too many concurrent streams — refuse this flow.
                    Err(_) => {
                        self.conns.get_mut(&id).unwrap().status = ConnStatus::Failed(
                            ConnectError::Denied("ws-proxy stream limit reached".to_string()),
                        )
                    }
                }
            }

            let pending_udp: Vec<DatagramId> = self
                .udp
                .iter()
                .filter(|(_, c)| c.stream.is_none() && c.status == ConnStatus::Connecting)
                .map(|(id, _)| *id)
                .collect();
            for id in pending_udp {
                let at_combined_cap = self
                    .session
                    .mux()
                    .map_or(0, |mux| mux.live_count())
                    .saturating_add(self.stream_to_udp.len())
                    >= crate::ws_proxy::MAX_STREAMS;
                let Some(stream) = (!at_combined_cap)
                    .then(|| self.alloc_udp_stream())
                    .flatten()
                else {
                    self.udp.get_mut(&id).unwrap().status = ConnStatus::Failed(
                        ConnectError::Denied("ws-proxy stream limit reached".to_string()),
                    );
                    continue;
                };
                let c = self.udp.get_mut(&id).unwrap();
                c.stream = Some(stream);
                self.stream_to_udp.insert(stream, id);
                self.outbox.push(Frame::UdpOpen {
                    stream,
                    host: c.host.clone(),
                    port: c.port,
                });
            }
        }

        // 3. Per-stream outbound: flush pending_tx within the send window, then a pending shutdown.
        let ids: Vec<ConnId> = self.conns.keys().copied().collect();
        for id in ids {
            self.flush_stream(id);
        }
        self.flush_udp();

        // 4. Ship everything produced this pass.
        for frame in core::mem::take(&mut self.outbox) {
            self.transport.send(frame);
        }
    }

    fn handle_udp_frame(&mut self, frame: Frame) {
        let stream = match &frame {
            Frame::UdpOpenOk { stream }
            | Frame::UdpOpenFail { stream, .. }
            | Frame::UdpData { stream, .. }
            | Frame::UdpClose { stream } => *stream,
            _ => return,
        };
        let Some(&id) = self.stream_to_udp.get(&stream) else {
            return;
        };
        let c = self
            .udp
            .get_mut(&id)
            .expect("stream map points to live UDP flow");
        match frame {
            Frame::UdpOpenOk { .. } => c.status = ConnStatus::Established,
            Frame::UdpOpenFail { .. } => {
                c.status = ConnStatus::Failed(ConnectError::Refused);
                self.stream_to_udp.remove(&stream);
            }
            Frame::UdpData { bytes, .. } => {
                if c.rx_bytes.saturating_add(bytes.len()) > MAX_UDP_QUEUE_BYTES {
                    c.status = ConnStatus::Failed(ConnectError::Denied(
                        "ws-proxy UDP receive queue exceeded".to_string(),
                    ));
                    self.outbox.push(Frame::UdpClose { stream });
                    self.stream_to_udp.remove(&stream);
                } else {
                    c.rx_bytes += bytes.len();
                    c.rx.push_back(bytes);
                }
            }
            Frame::UdpClose { .. } => {
                c.status = ConnStatus::Closed;
                self.stream_to_udp.remove(&stream);
            }
            _ => {}
        }
    }

    fn flush_udp(&mut self) {
        let ids: Vec<DatagramId> = self.udp.keys().copied().collect();
        for id in ids {
            let c = self.udp.get_mut(&id).unwrap();
            if c.status != ConnStatus::Established {
                continue;
            }
            let Some(stream) = c.stream else {
                continue;
            };
            while let Some(bytes) = c.pending_tx.pop_front() {
                c.pending_tx_bytes -= bytes.len();
                self.outbox.push(Frame::UdpData { stream, bytes });
            }
        }
    }

    /// Apply one decoded mux event to the addressed connection.
    fn handle_event(&mut self, ev: MuxEvent) {
        match ev {
            MuxEvent::Opened(stream) => {
                if let Some(&id) = self.stream_to_conn.get(&stream) {
                    self.conns.get_mut(&id).unwrap().status = ConnStatus::Established;
                    // Grant the relay an initial window so it can send us the remote's bytes.
                    if let Some(mux) = self.session.mux_mut()
                        && let Ok(win) = mux.grant(stream, INITIAL_WINDOW)
                    {
                        self.outbox.push(win);
                    }
                }
            }
            MuxEvent::OpenFailed { stream, .. } => {
                if let Some(&id) = self.stream_to_conn.get(&stream) {
                    self.conns.get_mut(&id).unwrap().status =
                        ConnStatus::Failed(ConnectError::Refused);
                }
                self.stream_to_conn.remove(&stream);
            }
            MuxEvent::Data { stream, bytes } => {
                if let Some(&id) = self.stream_to_conn.get(&stream) {
                    self.conns
                        .get_mut(&id)
                        .unwrap()
                        .rx
                        .extend_from_slice(&bytes);
                }
            }
            MuxEvent::PeerShutdown(stream) => {
                // The relay's backend hit EOF — no more remote→guest bytes. Mark Closed once the
                // buffered rx is drained (surfaced by `status`).
                if let Some(&id) = self.stream_to_conn.get(&stream) {
                    let c = self.conns.get_mut(&id).unwrap();
                    if c.status == ConnStatus::Established {
                        c.status = ConnStatus::Closed;
                    }
                }
            }
            MuxEvent::Closed(stream) => {
                if let Some(&id) = self.stream_to_conn.get(&stream) {
                    let c = self.conns.get_mut(&id).unwrap();
                    if !matches!(c.status, ConnStatus::Failed(_)) {
                        c.status = ConnStatus::Closed;
                    }
                }
                self.stream_to_conn.remove(&stream);
            }
            MuxEvent::Reset(stream) => {
                if let Some(&id) = self.stream_to_conn.get(&stream) {
                    self.conns.get_mut(&id).unwrap().status =
                        ConnStatus::Failed(ConnectError::Refused);
                }
                self.stream_to_conn.remove(&stream);
            }
            // The relay never asks a client to open, and window grants need no local action here
            // (the send path reads the live credit before sending).
            MuxEvent::OpenRequested { .. } | MuxEvent::WindowGranted { .. } => {}
        }
    }

    /// Flush a stream's queued send bytes (bounded by the granted window) and a pending shutdown.
    fn flush_stream(&mut self, id: ConnId) {
        let Some(stream) = self.conns.get(&id).and_then(|c| c.stream) else {
            return;
        };
        // Send as much of pending_tx as the current send window allows.
        loop {
            let credit = self
                .session
                .mux()
                .and_then(|m| m.get(stream))
                .map_or(0, |s| s.send_credit());
            let c = self.conns.get_mut(&id).unwrap();
            if credit == 0 || c.pending_tx.is_empty() {
                break;
            }
            let n = (credit as usize).min(c.pending_tx.len());
            let chunk: Vec<u8> = c.pending_tx.drain(..n).collect();
            match self.session.mux_mut().unwrap().send_data(stream, chunk) {
                Ok(frame) => self.outbox.push(frame),
                Err(_) => break, // credit raced to 0 — retry next pump
            }
        }
        // Forward a half-close once everything queued has been sent.
        let c = self.conns.get_mut(&id).unwrap();
        if c.want_shutdown
            && !c.shutdown_done
            && c.pending_tx.is_empty()
            && let Some(mux) = self.session.mux_mut()
            && let Ok(frame) = mux.local_shutdown(stream)
        {
            self.outbox.push(frame);
            self.conns.get_mut(&id).unwrap().shutdown_done = true;
        }
    }
}

/// Whether a status is terminal (won't change further on its own).
fn is_terminal(s: &ConnStatus) -> bool {
    matches!(s, ConnStatus::Closed | ConnStatus::Failed(_))
}

impl<T: FrameTransport> SyncConnector for WsConnector<T> {
    fn connect(&mut self, host: Ipv4Addr, port: u16) -> ConnId {
        let id = self.next_id;
        self.next_id += 1;
        let status = if self.active_flow_count() >= crate::ws_proxy::MAX_STREAMS {
            ConnStatus::Failed(ConnectError::Denied(
                "ws-proxy stream limit reached".to_string(),
            ))
        } else {
            ConnStatus::Connecting
        };
        self.conns.insert(
            id,
            Conn {
                stream: None,
                host: host.to_string(),
                port,
                status,
                rx: Vec::new(),
                pending_tx: VecDeque::new(),
                want_shutdown: false,
                shutdown_done: false,
            },
        );
        self.pump(); // may already handshake + issue the OPEN this pass
        id
    }

    fn status(&mut self, id: ConnId) -> ConnStatus {
        self.pump();
        self.conns
            .get(&id)
            .map(|c| c.status.clone())
            .unwrap_or(ConnStatus::Failed(ConnectError::Unreachable))
    }

    fn recv(&mut self, id: ConnId) -> Vec<u8> {
        self.pump();
        let Some(c) = self.conns.get_mut(&id) else {
            return Vec::new();
        };
        let out = core::mem::take(&mut c.rx);
        // Refill the relay's send window by what we just handed the caller — sliding-window
        // backpressure so the relay can't overrun us, and the download keeps flowing.
        if !out.is_empty()
            && let Some(stream) = c.stream
            && let Ok(n) = u32::try_from(out.len())
            && let Some(mux) = self.session.mux_mut()
            && let Ok(win) = mux.grant(stream, n)
        {
            self.transport.send(win);
        }
        out
    }

    fn send(&mut self, id: ConnId, data: &[u8]) -> usize {
        self.pump();
        let accepted = {
            let Some(c) = self.conns.get_mut(&id) else {
                return 0;
            };
            // Only a hard failure refuses new sends. `Closed` here means the REMOTE half-closed
            // (`PeerShutdown` — no more remote→guest bytes); TCP leaves the guest→remote direction
            // open, so the guest may still write (critic MINOR).
            if matches!(c.status, ConnStatus::Failed(_)) {
                return 0;
            }
            let room = MAX_PENDING_TX_BYTES.saturating_sub(c.pending_tx.len());
            let accepted = room.min(data.len());
            c.pending_tx.extend(data[..accepted].iter().copied());
            accepted
        };
        self.pump();
        accepted
    }

    fn shutdown_write(&mut self, id: ConnId) {
        if let Some(c) = self.conns.get_mut(&id) {
            c.want_shutdown = true;
        }
        self.pump();
    }

    fn buffered_bytes(&self) -> usize {
        let tcp = self
            .conns
            .values()
            .map(|c| c.rx.len().saturating_add(c.pending_tx.len()))
            .sum::<usize>();
        let udp = self
            .udp
            .values()
            .map(|c| c.rx_bytes.saturating_add(c.pending_tx_bytes))
            .sum::<usize>();
        tcp.saturating_add(udp)
    }

    fn close(&mut self, id: ConnId) {
        if let Some(c) = self.conns.get(&id)
            && let Some(stream) = c.stream
            && let Some(mux) = self.session.mux_mut()
            && let Ok(frame) = mux.local_close(stream)
        {
            self.transport.send(frame);
            self.stream_to_conn.remove(&stream);
        }
        self.conns.remove(&id);
    }

    fn udp_open(&mut self, host: Ipv4Addr, port: u16) -> DatagramId {
        let id = DatagramId(self.next_udp_id);
        self.next_udp_id = self.next_udp_id.wrapping_add(1);
        let status = if self.active_flow_count() >= crate::ws_proxy::MAX_STREAMS {
            ConnStatus::Failed(ConnectError::Denied(
                "ws-proxy stream limit reached".to_string(),
            ))
        } else {
            ConnStatus::Connecting
        };
        self.udp.insert(
            id,
            UdpConn {
                stream: None,
                host: host.to_string(),
                port,
                status,
                pending_tx: VecDeque::new(),
                pending_tx_bytes: 0,
                rx: VecDeque::new(),
                rx_bytes: 0,
            },
        );
        self.pump();
        id
    }

    fn udp_status(&mut self, id: DatagramId) -> ConnStatus {
        self.pump();
        self.udp
            .get(&id)
            .map(|c| c.status.clone())
            .unwrap_or(ConnStatus::Failed(ConnectError::Unreachable))
    }

    fn udp_send(&mut self, id: DatagramId, payload: &[u8]) -> bool {
        self.pump();
        let Some(c) = self.udp.get_mut(&id) else {
            return false;
        };
        if is_terminal(&c.status)
            || payload.len() > MAX_DATAGRAM_BYTES
            || c.pending_tx_bytes.saturating_add(payload.len()) > MAX_UDP_QUEUE_BYTES
        {
            return false;
        }
        c.pending_tx_bytes += payload.len();
        c.pending_tx.push_back(payload.to_vec());
        self.pump();
        true
    }

    fn udp_recv(&mut self, id: DatagramId) -> Vec<Vec<u8>> {
        self.pump();
        let Some(c) = self.udp.get_mut(&id) else {
            return Vec::new();
        };
        c.rx_bytes = 0;
        c.rx.drain(..).collect()
    }

    fn udp_close(&mut self, id: DatagramId) {
        if let Some(c) = self.udp.remove(&id)
            && let Some(stream) = c.stream
        {
            self.transport.send(Frame::UdpClose { stream });
            self.stream_to_udp.remove(&stream);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[derive(Default)]
    struct Wire {
        sent: Vec<Frame>,
        incoming: Vec<Frame>,
    }

    struct TestTransport(Rc<RefCell<Wire>>);
    impl FrameTransport for TestTransport {
        fn send(&mut self, frame: Frame) {
            self.0.borrow_mut().sent.push(frame);
        }
        fn poll(&mut self) -> Vec<Frame> {
            std::mem::take(&mut self.0.borrow_mut().incoming)
        }
        fn is_open(&self) -> bool {
            true
        }
    }

    #[test]
    fn udp_allocator_wrap_stays_in_its_high_half_and_skips_live_ids() {
        let wire = Rc::new(RefCell::new(Wire::default()));
        let mut connector = WsConnector::new(TestTransport(wire), Vec::new());
        connector.next_udp_stream = u32::MAX;
        assert_eq!(connector.alloc_udp_stream(), Some(u32::MAX));
        assert_eq!(connector.alloc_udp_stream(), Some(FIRST_UDP_STREAM));

        connector
            .stream_to_udp
            .insert(FIRST_UDP_STREAM, DatagramId(99));
        connector.next_udp_stream = FIRST_UDP_STREAM;
        assert_eq!(
            connector.alloc_udp_stream(),
            Some(FIRST_UDP_STREAM + 1),
            "wrap must skip a still-live datagram id"
        );
    }

    #[test]
    fn tcp_and_udp_share_one_client_side_stream_cap() {
        let wire = Rc::new(RefCell::new(Wire::default()));
        let mut connector = WsConnector::new(TestTransport(wire), Vec::new());
        for i in 0..crate::ws_proxy::MAX_STREAMS {
            if i % 2 == 0 {
                let id = connector.connect(Ipv4Addr::LOCALHOST, 80);
                assert_eq!(connector.conns[&id].status, ConnStatus::Connecting);
            } else {
                let id = connector.udp_open(Ipv4Addr::LOCALHOST, 53);
                assert_eq!(connector.udp[&id].status, ConnStatus::Connecting);
            }
        }
        assert_eq!(connector.active_flow_count(), crate::ws_proxy::MAX_STREAMS);

        let rejected_tcp = connector.connect(Ipv4Addr::LOCALHOST, 81);
        assert!(matches!(
            connector.conns[&rejected_tcp].status,
            ConnStatus::Failed(ConnectError::Denied(_))
        ));
        let rejected_udp = connector.udp_open(Ipv4Addr::LOCALHOST, 54);
        assert!(matches!(
            connector.udp[&rejected_udp].status,
            ConnStatus::Failed(ConnectError::Denied(_))
        ));
        assert_eq!(
            connector.active_flow_count(),
            crate::ws_proxy::MAX_STREAMS,
            "rejected opens do not consume capacity"
        );
    }

    #[test]
    fn udp_connector_preserves_each_datagram_over_the_frame_transport() {
        let wire = Rc::new(RefCell::new(Wire::default()));
        let mut connector = WsConnector::new(TestTransport(wire.clone()), Vec::new());
        let id = connector.udp_open(Ipv4Addr::new(198, 51, 100, 7), 9000);
        assert!(matches!(wire.borrow().sent[0], Frame::Hello { .. }));

        wire.borrow_mut()
            .incoming
            .push(crate::ws_proxy::hello(Vec::new()));
        assert_eq!(connector.udp_status(id), ConnStatus::Connecting);
        let stream = wire
            .borrow()
            .sent
            .iter()
            .find_map(|frame| match frame {
                Frame::UdpOpen { stream, host, port }
                    if host == "198.51.100.7" && *port == 9000 =>
                {
                    Some(*stream)
                }
                _ => None,
            })
            .expect("handshake completion emits UDP_OPEN");

        wire.borrow_mut().incoming.extend([
            Frame::UdpOpenOk { stream },
            Frame::UdpData {
                stream,
                bytes: b"one".to_vec(),
            },
            Frame::UdpData {
                stream,
                bytes: b"two-two".to_vec(),
            },
        ]);
        assert_eq!(connector.udp_status(id), ConnStatus::Established);
        assert_eq!(
            connector.udp_recv(id),
            vec![b"one".to_vec(), b"two-two".to_vec()],
            "two relay messages remain two guest UDP datagrams"
        );

        assert!(connector.udp_send(id, b"request"));
        assert!(wire.borrow().sent.iter().any(|frame| {
            matches!(frame, Frame::UdpData { stream: s, bytes } if *s == stream && bytes == b"request")
        }));
        assert!(
            !connector.udp_send(id, &vec![0; MAX_DATAGRAM_BYTES + 1]),
            "an oversized datagram is rejected, never split"
        );
    }
}
