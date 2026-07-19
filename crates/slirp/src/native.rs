//! `NativeConnector` — the native-harness [`OutboundConnector`] backed by real `tokio` TCP sockets.
//! This is what actually carries guest-initiated flows to the outside world when running natively
//! (tests + the native CLI); browser transports (E3-T16/T17) implement the same trait. The smoltcp
//! ↔ connector *bridge* that drives it from guest frames is the next slice; this is the connector
//! itself, testable in isolation against a local `tokio::net::TcpListener`.

use std::collections::BTreeMap;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use tokio::net::TcpStream;

use crate::connector::{ConnectError, OutboundConnector};

/// The default connect timeout — a guest SYN to a dead host must fail (→ RST) within this, not hang.
pub const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Connects guest flows to real destinations via tokio. Optionally caps the connect time so a
/// black-holed destination yields [`ConnectError::TimedOut`] promptly.
#[derive(Debug, Clone)]
pub struct NativeConnector {
    connect_timeout: Duration,
    host_map: BTreeMap<IpAddr, IpAddr>,
}

impl Default for NativeConnector {
    fn default() -> Self {
        Self::new()
    }
}

impl NativeConnector {
    pub fn new() -> Self {
        NativeConnector {
            connect_timeout: DEFAULT_CONNECT_TIMEOUT,
            host_map: BTreeMap::new(),
        }
    }

    /// Set the connect timeout (e.g. a short one in tests).
    pub fn with_connect_timeout(mut self, t: Duration) -> Self {
        self.connect_timeout = t;
        self
    }

    /// Deterministically rewrite selected destination IPs before dialing. Acceptance uses this to
    /// keep the guest-visible TEST-NET address (`192.0.2.1`) while the real server binds loopback.
    pub fn with_host_map(mut self, host_map: BTreeMap<IpAddr, IpAddr>) -> Self {
        self.host_map = host_map;
        self
    }
}

/// Map a connect `io::Error` to the typed [`ConnectError`] the stack turns into a guest outcome.
fn map_io(e: io::Error) -> ConnectError {
    use io::ErrorKind::*;
    match e.kind() {
        // Actively rejected by the peer/OS → the guest should see a RST (critic LOW: reset/abort fit
        // Refused better than Unreachable).
        ConnectionRefused | ConnectionReset | ConnectionAborted => ConnectError::Refused,
        TimedOut => ConnectError::TimedOut,
        NetworkUnreachable | HostUnreachable | AddrNotAvailable => ConnectError::Unreachable,
        // A local firewall/policy blocked it → a distinct "denied" (critic LOW).
        PermissionDenied => ConnectError::Denied(e.to_string()),
        _ => ConnectError::Unreachable,
    }
}

impl OutboundConnector for NativeConnector {
    type Conn = TcpStream;

    fn connect(
        &self,
        host: IpAddr,
        port: u16,
    ) -> impl std::future::Future<Output = Result<Self::Conn, ConnectError>> + Send {
        let mapped = self.host_map.get(&host).copied().unwrap_or(host);
        let addr = SocketAddr::new(mapped, port);
        let timeout = self.connect_timeout;
        async move {
            match tokio::time::timeout(timeout, TcpStream::connect(addr)).await {
                Ok(Ok(stream)) => Ok(stream),
                Ok(Err(e)) => Err(map_io(e)),
                Err(_elapsed) => Err(ConnectError::TimedOut),
            }
        }
    }
}

#[cfg(test)]
mod tests;
