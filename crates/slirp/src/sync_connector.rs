//! E3-net (browser networking, slice 2a): the **synchronous, poll-driven** outbound connector — the
//! browser-compatible sibling of the async [`OutboundConnector`](crate::OutboundConnector).
//!
//! Why a second connector trait? The async `OutboundConnector` returns a `Future` from `connect`, so
//! its consumer (`Bridge`) needs an async runtime (tokio) to `.await` it. The browser has no tokio and
//! the wasm event loop can't block, so a browser dial is inherently event-driven. This trait models
//! that: `connect` returns IMMEDIATELY with an id in the `Connecting` state, and the caller
//! ([`SlirpLocalBackend`](crate::SlirpLocalBackend)) POLLS [`status`](SyncConnector::status) each
//! service pass until it resolves. Every method is non-blocking.
//!
//! Two implementations target the one trait: the native [`StdConnector`] (real `std::net` sockets,
//! for tests + a native `wvrun`-with-net path) lands in this module behind the `native` feature; the
//! browser `WsConnector` (backed by the [`ws_proxy`](crate::ws_proxy) mux over a JS `WebSocket`) is
//! slice 2b. `SlirpLocalBackend` is written against the trait, so it is transport-agnostic.

extern crate alloc;
use alloc::vec::Vec;
use core::net::Ipv4Addr;

use crate::connector::ConnectError;

/// Opaque per-connection id handed back by [`SyncConnector::connect`] and used to address a live
/// connection. A plain integer (not a pointer) so a browser impl can mint ids without `unsafe`, and a
/// stale/unknown id is simply "not found" (handled gracefully, never a panic).
pub type ConnId = u64;

/// The lifecycle state of a connection as the synchronous backend pump observes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnStatus {
    /// The dial is still in flight — the TCP handshake (native) or the WS `OPEN`/`OPEN_OK`
    /// round-trip (browser) has not yet confirmed. No bytes flow yet.
    Connecting,
    /// Established — bytes may flow in both directions.
    Established,
    /// The remote closed its write side (it sent FIN / the relay reported the socket done): no more
    /// bytes will arrive via [`recv`](SyncConnector::recv). The backend half-closes the guest side
    /// (FIN) once the last received bytes are delivered, then tears the flow down.
    Closed,
    /// The connect failed, or the connection was reset by the remote. The backend RSTs the guest side
    /// and tears the flow down.
    Failed(ConnectError),
}

/// A **synchronous, poll-driven** outbound connector. `connect` returns immediately with a fresh id in
/// the [`Connecting`](ConnStatus::Connecting) state; the caller polls [`status`](Self::status) until it
/// resolves. All methods are non-blocking.
///
/// **Stale ids:** a backend may poll or drain an id it has already torn down on its side (the two
/// sides tear down independently). Every method MUST tolerate an unknown id gracefully — `status`
/// returns [`Failed`](ConnStatus::Failed), `recv` returns empty, `send` returns 0, and
/// `shutdown_write`/`close` are no-ops — never a panic (the adversarial charter: garbage in must not
/// crash the stack).
pub trait SyncConnector {
    /// Begin an outbound connection to `host:port`. Returns immediately with a fresh id in the
    /// `Connecting` state; the dial proceeds in the background (OS non-blocking connect / WS `OPEN`
    /// frame). The id is unique for the lifetime of this connector — never reused, so a stale
    /// reference can't alias a live connection.
    fn connect(&mut self, host: Ipv4Addr, port: u16) -> ConnId;

    /// The current lifecycle state of `id`. Returns [`Failed`](ConnStatus::Failed) with
    /// [`ConnectError::Unreachable`] for an unknown id.
    fn status(&mut self, id: ConnId) -> ConnStatus;

    /// Drain the bytes received from the remote so far (remote → guest direction). Empty if none are
    /// buffered or `id` is unknown.
    fn recv(&mut self, id: ConnId) -> Vec<u8>;

    /// Offer `data` to send to the remote (guest → remote direction). Returns the number of bytes
    /// ACCEPTED — may be less than `data.len()` under backpressure, or 0 for an unknown id. The
    /// caller re-offers the unaccepted tail on a later pass.
    fn send(&mut self, id: ConnId, data: &[u8]) -> usize;

    /// The guest half-closed its write side (guest FIN): no more [`send`](Self::send) for this id.
    /// The connector forwards a write-shutdown to the remote (native `shutdown(Write)` / WS
    /// `SHUTDOWN_WR`). No-op for an unknown id.
    fn shutdown_write(&mut self, id: ConnId);

    /// Tear down `id` (guest RST / flow eviction / both sides done). Idempotent; an unknown id is a
    /// no-op. After this the id is dead — `status` reports `Failed`.
    fn close(&mut self, id: ConnId);
}
