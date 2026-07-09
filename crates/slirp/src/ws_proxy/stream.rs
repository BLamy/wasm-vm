//! Per-stream flow-control + close lifecycle (E3-T16) — the pure, deterministic state each side
//! keeps for one multiplexed flow. Both the browser client and the relay server drive an identical
//! `StreamState`, so credit accounting and the half-close/close/RST rules can't diverge between
//! ends. See `docs/design/ws-proxy-protocol.md` (§Close / RST state, §WINDOW).
//!
//! It is I/O-free: it decides whether an op is *allowed* and updates the bookkeeping; the caller
//! performs the actual socket read/write. Every illegal transition returns a [`StreamError`] instead
//! of panicking, so a hacked peer (100 MB with zero granted credit, DATA after CLOSE, a stream
//! reused after RST) is *rejected*, never crashes or silently buffers.

/// How a stream was retired. Both mean "tear down the socket"; the distinction surfaces to the guest
/// (`CLOSE` → clean EOF, `RST` → `ECONNRESET`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Terminal {
    /// Clean bidirectional close (`CLOSE`).
    Closed,
    /// Aborted (`RST`).
    Reset,
}

/// A rejected stream operation — the caller should drop the frame and (for a credit/terminal
/// violation) kill the stream or connection, never buffer unboundedly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamError {
    /// The stream was already retired by `CLOSE`/`RST`; any further frame is a protocol error.
    Terminated,
    /// Tried to send `DATA` after our own `SHUTDOWN_WR`.
    WriteClosed,
    /// Received `DATA` after the peer's `SHUTDOWN_WR` (their write side is done).
    PeerWriteClosed,
    /// Tried to send more `DATA` bytes than the peer has granted us credit for.
    SendCreditExceeded,
    /// The peer sent more `DATA` than we granted it — a credit violation; kill the stream.
    RecvCreditExceeded,
    /// A `WINDOW`/grant that would overflow the u32 credit counter — a protocol error.
    CreditOverflow,
}

/// The flow-control + lifecycle state for one stream. `new()` starts both directions open with zero
/// credit each way (nothing may be sent until a `WINDOW` is granted).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamState {
    /// Bytes we may still send — granted by the peer's `WINDOW` frames, spent by our `DATA`.
    send_credit: u32,
    /// Bytes the peer may still send us — granted by our `WINDOW` frames, spent by their `DATA`.
    recv_credit: u32,
    /// Our write side is open (until we send `SHUTDOWN_WR`).
    local_wr_open: bool,
    /// The peer's write side is open (until we receive their `SHUTDOWN_WR`).
    peer_wr_open: bool,
    /// `Some` once `CLOSE`/`RST` retires the stream.
    terminal: Option<Terminal>,
}

impl Default for StreamState {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamState {
    /// A fresh stream: both directions open, zero credit each way, not retired.
    pub const fn new() -> Self {
        Self {
            send_credit: 0,
            recv_credit: 0,
            local_wr_open: true,
            peer_wr_open: true,
            terminal: None,
        }
    }

    // ── Credit (flow control) ────────────────────────────────────────────────

    /// Apply a `WINDOW` the peer sent us — grow our send credit. Saturating add would silently lose
    /// a grant, so an overflow is reported as a protocol error instead.
    pub fn on_window(&mut self, credit: u32) -> Result<(), StreamError> {
        self.check_live()?;
        self.send_credit = self
            .send_credit
            .checked_add(credit)
            .ok_or(StreamError::CreditOverflow)?;
        Ok(())
    }

    /// Reserve credit to send `len` `DATA` bytes. Fails (without spending) if the stream is retired,
    /// our write side is closed, or `len` exceeds the outstanding credit — so a sender provably
    /// cannot outrun the credit the receiver granted.
    pub fn reserve_send(&mut self, len: u32) -> Result<(), StreamError> {
        self.check_live()?;
        if !self.local_wr_open {
            return Err(StreamError::WriteClosed);
        }
        if len > self.send_credit {
            return Err(StreamError::SendCreditExceeded);
        }
        self.send_credit -= len;
        Ok(())
    }

    /// Record that we are granting the peer `credit` more bytes (we will emit a `WINDOW`). Overflow
    /// of the counter is a protocol error.
    pub fn grant(&mut self, credit: u32) -> Result<(), StreamError> {
        self.check_live()?;
        self.recv_credit = self
            .recv_credit
            .checked_add(credit)
            .ok_or(StreamError::CreditOverflow)?;
        Ok(())
    }

    /// Account for `len` `DATA` bytes received from the peer. Fails if the stream is retired, the
    /// peer already half-closed its write side, or the peer exceeded the credit we granted (a
    /// credit violation the caller must treat as fatal to the stream).
    pub fn on_recv_data(&mut self, len: u32) -> Result<(), StreamError> {
        self.check_live()?;
        if !self.peer_wr_open {
            return Err(StreamError::PeerWriteClosed);
        }
        if len > self.recv_credit {
            return Err(StreamError::RecvCreditExceeded);
        }
        self.recv_credit -= len;
        Ok(())
    }

    // ── Half-close / close / reset ───────────────────────────────────────────

    /// We send `SHUTDOWN_WR`: our write side is done (the peer may keep sending). Idempotent while
    /// live; an error only if the stream was already retired.
    pub fn local_shutdown(&mut self) -> Result<(), StreamError> {
        self.check_live()?;
        self.local_wr_open = false;
        Ok(())
    }

    /// We receive the peer's `SHUTDOWN_WR`: their write side is done (we may keep sending).
    /// Idempotent while live.
    pub fn peer_shutdown(&mut self) -> Result<(), StreamError> {
        self.check_live()?;
        self.peer_wr_open = false;
        Ok(())
    }

    /// Retire the stream with a clean `CLOSE`. A second terminal transition is a protocol error
    /// (the id is already retired — reusing it is illegal).
    pub fn close(&mut self) -> Result<(), StreamError> {
        self.check_live()?;
        self.terminal = Some(Terminal::Closed);
        Ok(())
    }

    /// Retire the stream with `RST` (abort). Like `close`, a second terminal transition is illegal.
    pub fn reset(&mut self) -> Result<(), StreamError> {
        self.check_live()?;
        self.terminal = Some(Terminal::Reset);
        Ok(())
    }

    // ── Queries ──────────────────────────────────────────────────────────────

    /// Outstanding credit we may still send.
    pub fn send_credit(&self) -> u32 {
        self.send_credit
    }
    /// Outstanding credit we have granted the peer.
    pub fn recv_credit(&self) -> u32 {
        self.recv_credit
    }
    /// Has `CLOSE`/`RST` retired this stream?
    pub fn is_terminal(&self) -> bool {
        self.terminal.is_some()
    }
    /// The terminal state, if any.
    pub fn terminal(&self) -> Option<Terminal> {
        self.terminal
    }
    /// Is our write side still open (no `SHUTDOWN_WR` sent, not retired)?
    pub fn write_open(&self) -> bool {
        self.local_wr_open && self.terminal.is_none()
    }
    /// Is the peer's write side still open (no `SHUTDOWN_WR` received, not retired)?
    pub fn read_open(&self) -> bool {
        self.peer_wr_open && self.terminal.is_none()
    }

    fn check_live(&self) -> Result<(), StreamError> {
        if self.terminal.is_some() {
            Err(StreamError::Terminated)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
#[path = "stream_tests.rs"]
mod stream_tests;
