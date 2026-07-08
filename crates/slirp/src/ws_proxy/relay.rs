//! Relay-server decision core (E3-T16) — **sans-io**. Encodes the relay *policy* (connect on `OPEN`,
//! grant an initial window, forward guest data to the backend socket under credit, translate
//! half-close/`RST`/reap) as a pure step function over the [`Session`]/[`Mux`]. It performs NO I/O:
//! each `on_*` event returns a [`RelayActions`] listing the WS frames to send and the socket
//! operations to perform, and the async driver (next pass) mechanically executes them and feeds the
//! results back. Being I/O-free makes the relay's branching logic exhaustively unit-testable without
//! tokio or a network — and it has no WebSocket dependency (the WS wire adapter is a separate thin
//! layer). See `docs/design/ws-proxy-protocol.md`.
//!
//! Backpressure is credit-driven and split by direction:
//! - **guest → backend:** the relay grants the guest a window ([`INITIAL_WINDOW`]); each `DATA` the
//!   guest sends is written to the backend and the consumed credit is immediately re-granted with a
//!   `WINDOW`, so the guest may keep sending up to the window.
//! - **backend → guest:** the relay sends the guest `DATA` only under the credit the *guest* granted
//!   us. The driver MUST size each backend read by [`RelayCore::send_credit`] so a read never
//!   exceeds the outstanding credit — that is how a stalled guest reader pauses the backend socket
//!   without head-of-line-blocking the other streams.

use super::{Frame, MuxError, MuxEvent, Role, Session, SessionError};

/// Credit (bytes) the relay grants a freshly-opened stream so the guest can start sending.
pub const INITIAL_WINDOW: u32 = 256 * 1024;

/// `OPEN_FAIL` code the relay reports when a backend connection could not be established.
pub const FAIL_CONNECT: u8 = 1;

/// A socket operation the driver must perform against the real backend socket for `stream`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SocketOp {
    /// Open an outbound TCP connection; report the outcome via [`RelayCore::on_connect_result`].
    Connect {
        stream: u32,
        host: String,
        port: u16,
    },
    /// Write `bytes` to the backend socket.
    Write { stream: u32, bytes: Vec<u8> },
    /// Half-close the backend socket's write side (the guest sent `SHUTDOWN_WR`).
    ShutdownWrite { stream: u32 },
    /// Drop the backend socket — the stream was closed or reset (reaped).
    Close { stream: u32 },
}

/// The frames to send over the WS transport and the socket ops to perform, for one event.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RelayActions {
    pub ws_sends: Vec<Frame>,
    pub socket_ops: Vec<SocketOp>,
}

impl RelayActions {
    fn ws(frames: Vec<Frame>) -> Self {
        Self {
            ws_sends: frames,
            socket_ops: Vec::new(),
        }
    }
    fn socket(ops: Vec<SocketOp>) -> Self {
        Self {
            ws_sends: Vec::new(),
            socket_ops: ops,
        }
    }
}

/// A relay error the driver handles by closing the whole WS connection (a peer that violates the
/// protocol can't be trusted).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayError {
    /// The opening handshake / session ordering was violated.
    Session(SessionError),
    /// The mux rejected a frame for a stream the relay has no record of, or a credit violation, etc.
    Mux(MuxError),
    /// A socket event named a stream the relay is not tracking (driver bug or a late event).
    UnknownStream(u32),
}

impl From<SessionError> for RelayError {
    fn from(e: SessionError) -> Self {
        RelayError::Session(e)
    }
}

/// The relay server's pure decision core for one WS connection.
#[derive(Debug)]
pub struct RelayCore {
    session: Session,
}

impl RelayCore {
    /// A fresh relay core (server role), awaiting the guest's `HELLO`.
    pub fn new() -> Self {
        Self {
            session: Session::new(Role::Server),
        }
    }

    /// The `HELLO` the relay sends first.
    pub fn hello(&self, token: Vec<u8>) -> Frame {
        self.session.hello(token)
    }

    /// Has the handshake completed?
    pub fn is_ready(&self) -> bool {
        self.session.is_ready()
    }

    /// Outstanding credit the guest has granted us to send it `DATA` on `stream`. The driver reads
    /// at most this many bytes from the backend socket before calling [`Self::on_socket_data`].
    pub fn send_credit(&self, stream: u32) -> u32 {
        self.session
            .mux()
            .and_then(|m| m.get(stream))
            .map_or(0, |s| s.send_credit())
    }

    /// Number of live streams (for the driver's bookkeeping / leak checks).
    pub fn live_streams(&self) -> usize {
        self.session.mux().map_or(0, |m| m.live_count())
    }

    /// Feed one decoded inbound WS frame. Before the handshake, the frame must be the guest's
    /// `HELLO`; afterwards it is routed through the mux and translated to relay actions.
    pub fn on_inbound_frame(&mut self, frame: Frame) -> Result<RelayActions, RelayError> {
        if !self.session.is_ready() {
            // The first frame must complete the handshake; a mismatch/NotHello closes the WS.
            self.session.on_hello(&frame)?;
            return Ok(RelayActions::default());
        }

        let mux_event = self.session.on_frame(frame).map_err(map_session_err)?;
        let actions = match mux_event {
            // Connect the backend; OPEN_OK / initial window wait for the connect result.
            MuxEvent::OpenRequested { stream, host, port } => {
                RelayActions::socket(vec![SocketOp::Connect { stream, host, port }])
            }
            // Guest → backend: write it, and re-grant the consumed credit so the guest keeps flowing.
            MuxEvent::Data { stream, bytes } => {
                let refill = bytes.len() as u32;
                let mut ws = Vec::new();
                if let Some(mux) = self.session.mux_mut()
                    && let Ok(win) = mux.grant(stream, refill)
                {
                    ws.push(win);
                }
                RelayActions {
                    ws_sends: ws,
                    socket_ops: vec![SocketOp::Write { stream, bytes }],
                }
            }
            // Guest half-closed → half-close the backend's write side.
            MuxEvent::PeerShutdown(stream) => {
                RelayActions::socket(vec![SocketOp::ShutdownWrite { stream }])
            }
            // Guest closed / reset → drop the backend socket (mux already reaped the stream).
            MuxEvent::Closed(stream) | MuxEvent::Reset(stream) => {
                RelayActions::socket(vec![SocketOp::Close { stream }])
            }
            // The guest granting us more send credit needs no immediate action — the driver resumes
            // reading the backend socket once `send_credit` is positive again.
            MuxEvent::WindowGranted { .. } => RelayActions::default(),
            // A well-behaved guest never sends these to the server; the mux would already have
            // rejected them as a RoleViolation, so reaching here means nothing to translate.
            MuxEvent::Opened(_) | MuxEvent::OpenFailed { .. } => RelayActions::default(),
        };
        Ok(actions)
    }

    /// Report the outcome of a [`SocketOp::Connect`]. On success the relay accepts the stream and
    /// grants the guest its initial window; on failure it refuses the open.
    pub fn on_connect_result(
        &mut self,
        stream: u32,
        connected: bool,
    ) -> Result<RelayActions, RelayError> {
        let mux = self
            .session
            .mux_mut()
            .ok_or(RelayError::UnknownStream(stream))?;
        if connected {
            let ok = mux.open_succeeded(stream).map_err(RelayError::Mux)?;
            let win = mux.grant(stream, INITIAL_WINDOW).map_err(RelayError::Mux)?;
            Ok(RelayActions::ws(vec![ok, win]))
        } else {
            let fail = mux
                .open_failed(stream, FAIL_CONNECT)
                .map_err(RelayError::Mux)?;
            Ok(RelayActions::ws(vec![fail]))
        }
    }

    /// Backend → guest: deliver `bytes` read from the backend socket. The driver MUST have sized the
    /// read by [`Self::send_credit`]; this reserves that credit and emits a `DATA` frame.
    pub fn on_socket_data(
        &mut self,
        stream: u32,
        bytes: Vec<u8>,
    ) -> Result<RelayActions, RelayError> {
        let mux = self
            .session
            .mux_mut()
            .ok_or(RelayError::UnknownStream(stream))?;
        let data = mux.send_data(stream, bytes).map_err(RelayError::Mux)?;
        Ok(RelayActions::ws(vec![data]))
    }

    /// The backend socket reached EOF on read → half-close toward the guest (`SHUTDOWN_WR`).
    pub fn on_socket_eof(&mut self, stream: u32) -> Result<RelayActions, RelayError> {
        let mux = self
            .session
            .mux_mut()
            .ok_or(RelayError::UnknownStream(stream))?;
        let sh = mux.local_shutdown(stream).map_err(RelayError::Mux)?;
        Ok(RelayActions::ws(vec![sh]))
    }

    /// The backend socket errored → abort the stream toward the guest (`RST`, reaping it).
    pub fn on_socket_error(&mut self, stream: u32) -> Result<RelayActions, RelayError> {
        let mux = self
            .session
            .mux_mut()
            .ok_or(RelayError::UnknownStream(stream))?;
        let rst = mux.local_reset(stream).map_err(RelayError::Mux)?;
        Ok(RelayActions::ws(vec![rst]))
    }

    /// The WS transport dropped → tear down every backend socket (no leak).
    pub fn on_ws_closed(&mut self) -> RelayActions {
        let ids = match self.session.mux_mut() {
            Some(mux) => mux.reap_all(),
            None => Vec::new(),
        };
        RelayActions::socket(
            ids.into_iter()
                .map(|stream| SocketOp::Close { stream })
                .collect(),
        )
    }
}

impl Default for RelayCore {
    fn default() -> Self {
        Self::new()
    }
}

/// A `SessionError::Mux(_)` is flattened to [`RelayError::Mux`] so callers see one error surface.
fn map_session_err(e: SessionError) -> RelayError {
    match e {
        SessionError::Mux(m) => RelayError::Mux(m),
        other => RelayError::Session(other),
    }
}

#[cfg(test)]
#[path = "relay_tests.rs"]
mod relay_tests;
