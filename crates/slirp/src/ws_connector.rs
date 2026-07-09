//! E3-net slice 2b: `WsConnector` — a [`SyncConnector`](crate::SyncConnector) that reaches the
//! network through the [`ws_proxy`](crate::ws_proxy) WebSocket relay instead of a local socket. This
//! is the BROWSER outbound path: the wasm guest has no sockets, so its TCP flows are tunnelled as
//! ws-proxy streams to a relay server that owns the real sockets.
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
use alloc::collections::BTreeMap;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::net::Ipv4Addr;

use crate::connector::ConnectError;
use crate::sync_connector::{ConnId, ConnStatus, SyncConnector};
use crate::ws_proxy::relay::INITIAL_WINDOW;
use crate::ws_proxy::{Frame, MuxEvent, Role, Session};

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
    pending_tx: Vec<u8>,
    /// The caller half-closed (`shutdown_write`); forward a `SHUTDOWN_WR` once `pending_tx` drains.
    want_shutdown: bool,
    /// We already forwarded the shutdown; don't repeat.
    shutdown_done: bool,
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
            outbox: Vec::new(),
        }
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
                }
                continue;
            }
            // A malformed/out-of-order frame is a defensive drop (the charter: garbage never panics).
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
                let mux = self.session.mux_mut().unwrap();
                match mux.open(host, port) {
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
        }

        // 3. Per-stream outbound: flush pending_tx within the send window, then a pending shutdown.
        let ids: Vec<ConnId> = self.conns.keys().copied().collect();
        for id in ids {
            self.flush_stream(id);
        }

        // 4. Ship everything produced this pass.
        for frame in core::mem::take(&mut self.outbox) {
            self.transport.send(frame);
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
        self.conns.insert(
            id,
            Conn {
                stream: None,
                host: host.to_string(),
                port,
                status: ConnStatus::Connecting,
                rx: Vec::new(),
                pending_tx: Vec::new(),
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
        let Some(c) = self.conns.get_mut(&id) else {
            return 0;
        };
        if matches!(c.status, ConnStatus::Failed(_) | ConnStatus::Closed) {
            return 0;
        }
        // Queue it all; `flush_stream` sends what the window allows now and keeps the rest. Returning
        // the full length is correct — the connector owns the buffered tail (lossless), like the
        // native StdConnector's caller contract.
        c.pending_tx.extend_from_slice(data);
        self.pump();
        data.len()
    }

    fn shutdown_write(&mut self, id: ConnId) {
        if let Some(c) = self.conns.get_mut(&id) {
            c.want_shutdown = true;
        }
        self.pump();
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
}
