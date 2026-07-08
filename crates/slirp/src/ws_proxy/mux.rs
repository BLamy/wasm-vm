//! Connection multiplexer (E3-T16) — composes the frame codec ([`super::Frame`]) and the per-stream
//! state machine ([`super::StreamState`]) into the duplex logic each end runs over one WebSocket:
//! the stream table, client-side id allocation, routing an inbound frame to the right stream, and
//! reaping a stream on `CLOSE`/`RST`. Pure and I/O-free — `on_frame` returns a [`MuxEvent`] telling
//! the caller what to do (connect, deliver bytes, tear a socket down); the caller does the I/O.
//!
//! This is the layer that catches the connection-level protocol violations the lower layers can't
//! see on their own: **`DATA`/`WINDOW`/… for a stream that was never opened (or already reaped)**,
//! an `OPEN` that **reuses a live id**, a frame that **violates the client/server role**, and an
//! unbounded-open DoS (a per-connection stream cap). Every violation is a returned [`MuxError`],
//! never a panic or an unbounded allocation. See `docs/design/ws-proxy-protocol.md`.

use super::{Frame, StreamError, StreamState};
use std::collections::{BTreeMap, BTreeSet};

/// Per-connection cap on concurrent streams — a hacked client that opens without bound is refused
/// (`TooManyStreams`) rather than exhausting the server's sockets/memory.
pub const MAX_STREAMS: usize = 1024;

/// Which end of the WebSocket this mux is. The client *originates* streams (allocates ids, sends
/// `OPEN`); the server *accepts* them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Client,
    Server,
}

/// A rejected mux operation. The caller drops the frame and, for a connection-level violation,
/// SHOULD close the whole WebSocket (a peer sending garbage can't be trusted).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MuxError {
    /// A frame arrived for a stream id not in the table — `DATA`/`WINDOW`/… before `OPEN`, or after
    /// the stream was reaped by `CLOSE`/`RST`.
    UnknownStream(u32),
    /// An `OPEN` reused an id that is already live.
    StreamExists(u32),
    /// A frame that this role must never receive (e.g. a server got `OPEN_OK`, or a client got
    /// `OPEN`), or a local op invalid for this role (a server calling `open`).
    RoleViolation,
    /// The per-stream state machine rejected the op (credit violation, write-after-close, …).
    Stream(u32, StreamError),
    /// Opening would exceed [`MAX_STREAMS`] concurrent streams on this connection.
    TooManyStreams,
    /// The client could not allocate a fresh stream id (id space exhausted — pathological).
    StreamsExhausted,
    /// A `HELLO` reached the mux; version negotiation is a connection-level concern handled before
    /// framing to the mux.
    UnexpectedHello,
    /// A `DATA` frame whose length does not fit the u32 credit accounting (a >4 GiB WS message —
    /// impossible in practice, rejected defensively).
    DataTooLarge(u32),
}

/// What the caller should do after a routed inbound frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MuxEvent {
    /// (server) The peer wants a flow to `host:port`; go connect, then call `open_succeeded`/
    /// `open_failed`.
    OpenRequested {
        stream: u32,
        host: String,
        port: u16,
    },
    /// (client) Our `OPEN` was accepted.
    Opened(u32),
    /// (client) Our `OPEN` was refused; the stream is gone.
    OpenFailed { stream: u32, code: u8 },
    /// Deliver these bytes to the local socket for `stream`.
    Data { stream: u32, bytes: Vec<u8> },
    /// The peer half-closed its write side.
    PeerShutdown(u32),
    /// The peer granted `credit` more send bytes for `stream`.
    WindowGranted { stream: u32, credit: u32 },
    /// The stream closed cleanly and was reaped — tear the socket down (clean EOF).
    Closed(u32),
    /// The stream was reset and reaped — tear the socket down (`ECONNRESET`).
    Reset(u32),
}

/// The multiplexer for one WebSocket connection.
#[derive(Debug)]
pub struct Mux {
    role: Role,
    streams: BTreeMap<u32, StreamState>,
    /// (client) ids we've sent `OPEN` for and are awaiting `OPEN_OK`/`OPEN_FAIL` on.
    pending: BTreeSet<u32>,
    /// (client) next candidate stream id to allocate (never 0).
    next_id: u32,
}

impl Mux {
    pub fn new(role: Role) -> Self {
        Self {
            role,
            streams: BTreeMap::new(),
            pending: BTreeSet::new(),
            next_id: 1,
        }
    }

    pub fn role(&self) -> Role {
        self.role
    }

    /// Number of live streams (for the reap/leak checks).
    pub fn live_count(&self) -> usize {
        self.streams.len()
    }

    /// Borrow a stream's state (tests / metrics).
    pub fn get(&self, stream: u32) -> Option<&StreamState> {
        self.streams.get(&stream)
    }

    // ── Client: originate a stream ───────────────────────────────────────────

    /// (client) Allocate a fresh id and produce the `OPEN` frame for `host:port`. The stream enters
    /// the table immediately (credit 0, so nothing flows until the peer's `WINDOW`) and is marked
    /// pending until `OPEN_OK`/`OPEN_FAIL`.
    pub fn open(&mut self, host: String, port: u16) -> Result<(u32, Frame), MuxError> {
        if self.role != Role::Client {
            return Err(MuxError::RoleViolation);
        }
        if self.streams.len() >= MAX_STREAMS {
            return Err(MuxError::TooManyStreams);
        }
        let id = self.alloc_id().ok_or(MuxError::StreamsExhausted)?;
        self.streams.insert(id, StreamState::new());
        self.pending.insert(id);
        Ok((
            id,
            Frame::Open {
                stream: id,
                host,
                port,
            },
        ))
    }

    /// Find a free nonzero id. The `len < MAX_STREAMS` guard above guarantees a free id exists within
    /// `MAX_STREAMS + 1` candidates, so this terminates.
    fn alloc_id(&mut self) -> Option<u32> {
        for _ in 0..=MAX_STREAMS {
            let id = self.next_id;
            self.next_id = self.next_id.wrapping_add(1);
            if self.next_id == 0 {
                self.next_id = 1;
            }
            if id != 0 && !self.streams.contains_key(&id) {
                return Some(id);
            }
        }
        None
    }

    /// Test-only: seed the id allocator so a test can force `alloc_id` onto an already-occupied slot
    /// (the collision path otherwise only triggers after a full u32 wrap).
    #[cfg(test)]
    fn force_next_id(&mut self, id: u32) {
        self.next_id = id;
    }

    // ── Server: answer an OPEN ───────────────────────────────────────────────

    /// (server) The flow connected — produce the `OPEN_OK`.
    pub fn open_succeeded(&mut self, stream: u32) -> Result<Frame, MuxError> {
        if self.role != Role::Server {
            return Err(MuxError::RoleViolation);
        }
        if !self.streams.contains_key(&stream) {
            return Err(MuxError::UnknownStream(stream));
        }
        Ok(Frame::OpenOk { stream })
    }

    /// (server) The flow could not connect — reap the stream and produce the `OPEN_FAIL`.
    pub fn open_failed(&mut self, stream: u32, code: u8) -> Result<Frame, MuxError> {
        if self.role != Role::Server {
            return Err(MuxError::RoleViolation);
        }
        if self.streams.remove(&stream).is_none() {
            return Err(MuxError::UnknownStream(stream));
        }
        Ok(Frame::OpenFail { stream, code })
    }

    // ── Inbound: route a decoded frame ───────────────────────────────────────

    /// Route one decoded inbound frame, updating the addressed stream and returning what the caller
    /// must act on. A frame for an unknown stream, an id reuse, or a role violation is an error.
    pub fn on_frame(&mut self, frame: Frame) -> Result<MuxEvent, MuxError> {
        match frame {
            Frame::Hello { .. } => Err(MuxError::UnexpectedHello),

            Frame::Open { stream, host, port } => {
                if self.role != Role::Server {
                    return Err(MuxError::RoleViolation);
                }
                if self.streams.contains_key(&stream) {
                    return Err(MuxError::StreamExists(stream));
                }
                if self.streams.len() >= MAX_STREAMS {
                    return Err(MuxError::TooManyStreams);
                }
                self.streams.insert(stream, StreamState::new());
                Ok(MuxEvent::OpenRequested { stream, host, port })
            }

            Frame::OpenOk { stream } => {
                if self.role != Role::Client {
                    return Err(MuxError::RoleViolation);
                }
                if !self.pending.remove(&stream) {
                    return Err(MuxError::UnknownStream(stream));
                }
                Ok(MuxEvent::Opened(stream))
            }

            Frame::OpenFail { stream, code } => {
                if self.role != Role::Client {
                    return Err(MuxError::RoleViolation);
                }
                if !self.pending.remove(&stream) {
                    return Err(MuxError::UnknownStream(stream));
                }
                self.streams.remove(&stream);
                Ok(MuxEvent::OpenFailed { stream, code })
            }

            Frame::Data { stream, bytes } => {
                let len: u32 = bytes
                    .len()
                    .try_into()
                    .map_err(|_| MuxError::DataTooLarge(stream))?;
                let st = self
                    .streams
                    .get_mut(&stream)
                    .ok_or(MuxError::UnknownStream(stream))?;
                st.on_recv_data(len)
                    .map_err(|e| MuxError::Stream(stream, e))?;
                Ok(MuxEvent::Data { stream, bytes })
            }

            Frame::Window { stream, credit } => {
                let st = self
                    .streams
                    .get_mut(&stream)
                    .ok_or(MuxError::UnknownStream(stream))?;
                st.on_window(credit)
                    .map_err(|e| MuxError::Stream(stream, e))?;
                Ok(MuxEvent::WindowGranted { stream, credit })
            }

            Frame::ShutdownWr { stream } => {
                let st = self
                    .streams
                    .get_mut(&stream)
                    .ok_or(MuxError::UnknownStream(stream))?;
                st.peer_shutdown()
                    .map_err(|e| MuxError::Stream(stream, e))?;
                Ok(MuxEvent::PeerShutdown(stream))
            }

            Frame::Close { stream } => {
                let st = self
                    .streams
                    .get_mut(&stream)
                    .ok_or(MuxError::UnknownStream(stream))?;
                st.close().map_err(|e| MuxError::Stream(stream, e))?;
                self.reap(stream);
                Ok(MuxEvent::Closed(stream))
            }

            Frame::Rst { stream } => {
                let st = self
                    .streams
                    .get_mut(&stream)
                    .ok_or(MuxError::UnknownStream(stream))?;
                st.reset().map_err(|e| MuxError::Stream(stream, e))?;
                self.reap(stream);
                Ok(MuxEvent::Reset(stream))
            }
        }
    }

    // ── Outbound: local-initiated frames (both roles) ────────────────────────

    /// Reserve credit for and build a `DATA` frame carrying `bytes`. Fails (spending nothing) if the
    /// stream is unknown, our write side is closed, or `bytes` exceeds the granted credit.
    pub fn send_data(&mut self, stream: u32, bytes: Vec<u8>) -> Result<Frame, MuxError> {
        let len: u32 = bytes
            .len()
            .try_into()
            .map_err(|_| MuxError::DataTooLarge(stream))?;
        let st = self
            .streams
            .get_mut(&stream)
            .ok_or(MuxError::UnknownStream(stream))?;
        st.reserve_send(len)
            .map_err(|e| MuxError::Stream(stream, e))?;
        Ok(Frame::Data { stream, bytes })
    }

    /// Grant the peer `credit` more send bytes and build the `WINDOW` frame.
    pub fn grant(&mut self, stream: u32, credit: u32) -> Result<Frame, MuxError> {
        let st = self
            .streams
            .get_mut(&stream)
            .ok_or(MuxError::UnknownStream(stream))?;
        st.grant(credit).map_err(|e| MuxError::Stream(stream, e))?;
        Ok(Frame::Window { stream, credit })
    }

    /// Half-close our write side and build the `SHUTDOWN_WR` frame.
    pub fn local_shutdown(&mut self, stream: u32) -> Result<Frame, MuxError> {
        let st = self
            .streams
            .get_mut(&stream)
            .ok_or(MuxError::UnknownStream(stream))?;
        st.local_shutdown()
            .map_err(|e| MuxError::Stream(stream, e))?;
        Ok(Frame::ShutdownWr { stream })
    }

    /// Cleanly close the stream (reaping it) and build the `CLOSE` frame.
    pub fn local_close(&mut self, stream: u32) -> Result<Frame, MuxError> {
        let st = self
            .streams
            .get_mut(&stream)
            .ok_or(MuxError::UnknownStream(stream))?;
        st.close().map_err(|e| MuxError::Stream(stream, e))?;
        self.reap(stream);
        Ok(Frame::Close { stream })
    }

    /// Abort the stream (reaping it) and build the `RST` frame.
    pub fn local_reset(&mut self, stream: u32) -> Result<Frame, MuxError> {
        let st = self
            .streams
            .get_mut(&stream)
            .ok_or(MuxError::UnknownStream(stream))?;
        st.reset().map_err(|e| MuxError::Stream(stream, e))?;
        self.reap(stream);
        Ok(Frame::Rst { stream })
    }

    /// The WebSocket dropped — return every live stream id and clear the table so the caller can
    /// tear down all their sockets (no leak). The mux is empty afterwards.
    pub fn reap_all(&mut self) -> Vec<u32> {
        let ids: Vec<u32> = self.streams.keys().copied().collect();
        self.streams.clear();
        self.pending.clear();
        ids
    }

    /// Retire a stream from the table + pending set. `Terminal` is already recorded on the state; we
    /// simply drop it (a fresh `OPEN` may reuse the id later — the table no longer holds it).
    fn reap(&mut self, stream: u32) {
        self.streams.remove(&stream);
        self.pending.remove(&stream);
    }
}

#[cfg(test)]
#[path = "mux_tests.rs"]
mod mux_tests;
