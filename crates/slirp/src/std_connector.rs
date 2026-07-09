//! `StdConnector` — the native [`SyncConnector`] backed by real `std::net` TCP sockets. It is the
//! test double the browser `WsConnector` (slice 2b) will mirror, and doubles as the outbound path for
//! a native `wvrun`-with-networking run. Pure `std` (no tokio), so it needs no async runtime — the one
//! blocking step, `connect`, runs on a short-lived thread so [`SyncConnector::connect`] itself returns
//! immediately (the contract: non-blocking).
//!
//! `not(target_arch = "wasm32")` gates the whole module: `wasm32-unknown-unknown` provides `std::net`
//! types but every socket call is an unsupported stub, so a real-socket connector is native-only.

use std::collections::BTreeMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, Shutdown, SocketAddr, TcpStream};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::time::Duration;

use crate::connector::ConnectError;
use crate::sync_connector::{ConnId, ConnStatus, SyncConnector};

/// How long a dial may take before it is reported [`ConnectError::TimedOut`]. Bounded so a black-hole
/// destination can't strand a connect thread forever (the charter: connect must resolve, never hang).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// The stage of one connection: dialing on a background thread, live (non-blocking socket), or dead.
enum Dial {
    /// The connect thread hasn't reported yet; the receiver yields the outcome once.
    Pending(Receiver<Result<TcpStream, ConnectError>>),
    /// Connected — the socket is in non-blocking mode; all I/O happens on the caller's thread.
    Live(TcpStream),
    /// The connect failed or the socket erred; the reason is sticky.
    Dead(ConnectError),
}

struct Conn {
    dial: Dial,
    /// A non-blocking read returned `Ok(0)` — the remote half-closed. Sticky.
    remote_closed: bool,
}

/// A [`SyncConnector`] over real `std::net` TCP sockets.
#[derive(Default)]
pub struct StdConnector {
    conns: BTreeMap<ConnId, Conn>,
    next_id: ConnId,
}

impl StdConnector {
    pub fn new() -> Self {
        Self::default()
    }

    /// Map a `std::io` connect/read error to the guest-visible [`ConnectError`].
    fn classify(e: &std::io::Error) -> ConnectError {
        match e.kind() {
            ErrorKind::ConnectionRefused | ErrorKind::ConnectionReset => ConnectError::Refused,
            ErrorKind::TimedOut => ConnectError::TimedOut,
            _ => ConnectError::Unreachable,
        }
    }

    /// Advance a `Pending` dial if its thread has reported; leaves `Live`/`Dead` untouched. Returns a
    /// mutable ref to the conn, or `None` for an unknown id.
    fn advance(&mut self, id: ConnId) -> Option<&mut Conn> {
        let c = self.conns.get_mut(&id)?;
        if let Dial::Pending(rx) = &c.dial {
            match rx.try_recv() {
                Err(TryRecvError::Empty) => {} // still dialing
                // The thread vanished without a value (panicked): treat as unreachable.
                Err(TryRecvError::Disconnected) => c.dial = Dial::Dead(ConnectError::Unreachable),
                Ok(Ok(stream)) => {
                    // Non-blocking from here on, so `recv`/`send` never stall the wasm event loop.
                    let _ = stream.set_nonblocking(true);
                    c.dial = Dial::Live(stream);
                }
                Ok(Err(e)) => c.dial = Dial::Dead(e),
            }
        }
        Some(c)
    }
}

impl SyncConnector for StdConnector {
    fn connect(&mut self, host: Ipv4Addr, port: u16) -> ConnId {
        let id = self.next_id;
        self.next_id += 1;
        let addr = SocketAddr::new(IpAddr::V4(host), port);
        let (tx, rx) = mpsc::channel();
        // The blocking connect runs off-thread so this call returns immediately (contract). The
        // thread ends as soon as it sends — a short-lived worker, not a persistent driver.
        std::thread::spawn(move || {
            let res = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
                .map_err(|e| StdConnector::classify(&e));
            let _ = tx.send(res); // receiver may be gone if the flow was torn down; ignore.
        });
        self.conns.insert(
            id,
            Conn {
                dial: Dial::Pending(rx),
                remote_closed: false,
            },
        );
        id
    }

    fn status(&mut self, id: ConnId) -> ConnStatus {
        match self.advance(id) {
            None => ConnStatus::Failed(ConnectError::Unreachable),
            Some(c) => match &c.dial {
                Dial::Pending(_) => ConnStatus::Connecting,
                Dial::Dead(e) => ConnStatus::Failed(e.clone()),
                Dial::Live(_) => {
                    if c.remote_closed {
                        ConnStatus::Closed
                    } else {
                        ConnStatus::Established
                    }
                }
            },
        }
    }

    fn recv(&mut self, id: ConnId) -> Vec<u8> {
        let Some(c) = self.advance(id) else {
            return Vec::new();
        };
        let Dial::Live(stream) = &mut c.dial else {
            return Vec::new();
        };
        let mut buf = [0u8; 16 * 1024];
        match stream.read(&mut buf) {
            Ok(0) => {
                c.remote_closed = true; // clean half-close from the remote
                Vec::new()
            }
            Ok(n) => buf[..n].to_vec(),
            Err(e) if e.kind() == ErrorKind::WouldBlock => Vec::new(),
            Err(e) => {
                // A hard read error (RST) — surface as failed so the backend RSTs the guest.
                c.dial = Dial::Dead(Self::classify(&e));
                Vec::new()
            }
        }
    }

    fn send(&mut self, id: ConnId, data: &[u8]) -> usize {
        let Some(c) = self.advance(id) else {
            return 0;
        };
        let Dial::Live(stream) = &mut c.dial else {
            return 0;
        };
        match stream.write(data) {
            Ok(n) => n,
            Err(e) if e.kind() == ErrorKind::WouldBlock => 0,
            Err(e) => {
                c.dial = Dial::Dead(Self::classify(&e));
                0
            }
        }
    }

    fn shutdown_write(&mut self, id: ConnId) {
        if let Some(c) = self.advance(id)
            && let Dial::Live(stream) = &c.dial
        {
            let _ = stream.shutdown(Shutdown::Write);
        }
    }

    fn close(&mut self, id: ConnId) {
        // Dropping the stream closes the socket (RST if unread data remains, else FIN). Idempotent.
        self.conns.remove(&id);
    }
}
