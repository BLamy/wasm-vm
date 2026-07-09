//! The `OutboundConnector` contract — how bytes leave the process, decoupled from the TCP/IP stack.
//! The native harness backs it with `tokio` sockets (pass 2); browser transports (E3-T16/T17)
//! implement the same trait. Defined here in pass 1 so the stack (and its tests) can be written
//! against a stable contract.

use std::future::Future;
use std::net::IpAddr;

/// Why an outbound connection could not be established. The stack maps each to a guest-visible
/// outcome (typically a TCP RST) — a connector must FAIL within the connect timeout, never hang
/// (the adversarial charter: "SYN to a refused port → guest gets RST within the connect-timeout").
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectError {
    /// The destination refused the connection (RST / ECONNREFUSED).
    Refused,
    /// The connect attempt exceeded the connect timeout.
    TimedOut,
    /// The destination is unreachable (no route / network down).
    Unreachable,
    /// The connector declines this destination by policy (e.g. blocked host/port).
    Denied(String),
}

/// Establishes outbound connections on behalf of guest flows. `connect` yields a duplex byte stream
/// (the concrete `Conn` type is the implementor's — e.g. a split `tokio::net::TcpStream` in pass 2)
/// or a typed [`ConnectError`]. **Contract:** it resolves within the connect timeout — success with
/// a stream, or a typed failure — and never hangs indefinitely.
pub trait OutboundConnector {
    /// The duplex byte stream produced on success.
    type Conn;
    /// Connect to `host:port`. Async (native `async fn` in trait, edition 2024) so a slow connect
    /// doesn't block the stack; the future must complete within the connector's connect timeout.
    fn connect(
        &self,
        host: IpAddr,
        port: u16,
    ) -> impl Future<Output = Result<Self::Conn, ConnectError>> + Send;
}
