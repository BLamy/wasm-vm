//! Connection handshake + session ordering gate (E3-T16). Before any stream opens, each end sends a
//! `HELLO` (version + optional token) and validates the peer's. A version the peer can't speak is
//! refused **here**, so a mismatched client never reaches the [`Mux`]; and a stream frame that
//! arrives before the handshake completes is rejected rather than routed. Pure — no I/O. Token auth
//! / rate-limiting is E3-T19; the token field is carried now so the wire format is stable. See
//! `docs/design/ws-proxy-protocol.md` §Versioning.

use super::{Frame, Mux, MuxError, MuxEvent, Role, VERSION};

/// Why the peer's opening `HELLO` was rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandshakeError {
    /// The first frame from the peer was not a `HELLO`.
    NotHello,
    /// The peer speaks a protocol version this end cannot.
    VersionMismatch { peer: u8, ours: u8 },
}

/// Build the `HELLO` this end sends first. `token` may be empty (auth is E3-T19).
pub fn hello(token: Vec<u8>) -> Frame {
    Frame::Hello {
        version: VERSION,
        token,
    }
}

/// Validate the peer's opening frame. On success returns the peer's token (for later auth).
pub fn accept_hello(first: &Frame) -> Result<Vec<u8>, HandshakeError> {
    match first {
        Frame::Hello { version, token } => {
            if *version != VERSION {
                Err(HandshakeError::VersionMismatch {
                    peer: *version,
                    ours: VERSION,
                })
            } else {
                Ok(token.clone())
            }
        }
        _ => Err(HandshakeError::NotHello),
    }
}

/// A rejected session operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    /// The opening handshake was invalid (wrong first frame / version mismatch).
    Handshake(HandshakeError),
    /// A stream frame arrived before the handshake completed — streams may not precede `HELLO`.
    NotReady,
    /// A second `HELLO` arrived after the handshake already completed.
    AlreadyReady,
    /// The multiplexer rejected the routed frame.
    Mux(MuxError),
}

/// One end of a proxy connection: it enforces `HELLO`-before-streams, then owns the [`Mux`].
#[derive(Debug)]
pub struct Session {
    role: Role,
    state: State,
}

#[derive(Debug)]
enum State {
    /// Waiting for the peer's `HELLO`.
    AwaitingHello,
    /// Handshake done; streams flow through the mux.
    Ready(Mux),
}

impl Session {
    /// A fresh session that has not yet seen the peer's `HELLO`.
    pub fn new(role: Role) -> Self {
        Self {
            role,
            state: State::AwaitingHello,
        }
    }

    pub fn role(&self) -> Role {
        self.role
    }

    /// The `HELLO` frame this end must send first.
    pub fn hello(&self, token: Vec<u8>) -> Frame {
        hello(token)
    }

    /// Has the handshake completed?
    pub fn is_ready(&self) -> bool {
        matches!(self.state, State::Ready(_))
    }

    /// Feed the peer's opening `HELLO`. On success the session becomes ready (a `Mux` is created)
    /// and the peer's token is returned. A second `HELLO` is rejected.
    pub fn on_hello(&mut self, frame: &Frame) -> Result<Vec<u8>, SessionError> {
        if self.is_ready() {
            return Err(SessionError::AlreadyReady);
        }
        let token = accept_hello(frame).map_err(SessionError::Handshake)?;
        self.state = State::Ready(Mux::new(self.role));
        Ok(token)
    }

    /// Route a post-handshake frame to the mux. Fails with `NotReady` if the handshake hasn't
    /// completed (a stream frame must not precede `HELLO`).
    pub fn on_frame(&mut self, frame: Frame) -> Result<MuxEvent, SessionError> {
        match &mut self.state {
            State::AwaitingHello => Err(SessionError::NotReady),
            State::Ready(mux) => mux.on_frame(frame).map_err(SessionError::Mux),
        }
    }

    /// Borrow the mux once ready (to originate streams / build outbound frames).
    pub fn mux_mut(&mut self) -> Option<&mut Mux> {
        match &mut self.state {
            State::Ready(mux) => Some(mux),
            State::AwaitingHello => None,
        }
    }

    /// Borrow the mux immutably once ready.
    pub fn mux(&self) -> Option<&Mux> {
        match &self.state {
            State::Ready(mux) => Some(mux),
            State::AwaitingHello => None,
        }
    }
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod session_tests;
