//! E3-net slice 2d — the capstone integration proof: the REAL `WsConnector` (slice 2b) driven over a
//! REAL `tokio-tungstenite` WebSocket, through the REAL spawned `wvrelay` binary (slice 2c), to a REAL
//! echo backend. Slice 2b proved the connector against an in-process frame transport; this closes the
//! last gap — it works over an ACTUAL WebSocket wire.
//!
//! It also establishes the async↔sync bridge the browser will use: `WsConnector` is synchronous, a
//! WebSocket is event-driven, so a `FrameTransport` bridges them with two shared frame queues pumped
//! by background tasks (browser: the JS `WebSocket` `onmessage` fills the inbound queue; a timer drains
//! the outbound queue). Here those pumps are tokio tasks; the shape is identical.

use std::collections::VecDeque;
use std::net::{Ipv4Addr, SocketAddr};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::client_async;
use tokio_tungstenite::tungstenite::Message;
use wasm_vm_slirp::ws_proxy::Frame;
use wasm_vm_slirp::{ConnStatus, FrameTransport, SyncConnector, WsConnector};

/// A `FrameTransport` over a real WebSocket: two shared queues bridge the synchronous connector to the
/// async WS pumps. `send`/`poll` are non-blocking queue ops (as the trait requires); the actual WS I/O
/// happens on the spawned reader/writer tasks. This is the native mirror of the browser's JS-WebSocket
/// transport.
#[derive(Clone)]
struct WsWireTransport {
    inbound: Arc<Mutex<VecDeque<Frame>>>,
    outbound: Arc<Mutex<VecDeque<Frame>>>,
    open: Arc<AtomicBool>,
}
impl FrameTransport for WsWireTransport {
    fn send(&mut self, f: Frame) {
        self.outbound.lock().unwrap().push_back(f);
    }
    fn poll(&mut self) -> Vec<Frame> {
        self.inbound.lock().unwrap().drain(..).collect()
    }
    fn is_open(&self) -> bool {
        self.open.load(Ordering::SeqCst)
    }
}

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn spawn_echo() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut b = [0u8; 4096];
                loop {
                    match sock.read(&mut b).await {
                        Ok(0) => break,
                        Ok(n) if sock.write_all(&b[..n]).await.is_ok() => {}
                        _ => break,
                    }
                }
            });
        }
    });
    addr
}

/// Spawn the real `wvrelay` binary; block on its readiness line and return `(guard, bound_addr)`.
fn spawn_relay() -> (ChildGuard, SocketAddr) {
    use std::io::{BufRead, BufReader};
    let mut child = Command::new(env!("CARGO_BIN_EXE_wvrelay"))
        .arg("127.0.0.1:0")
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn wvrelay");
    let stdout = child.stdout.take().unwrap();
    let mut line = String::new();
    BufReader::new(stdout).read_line(&mut line).unwrap();
    let addr: SocketAddr = line
        .split("ws://")
        .nth(1)
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or_else(|| panic!("bad readiness line: {line:?}"));
    (ChildGuard(child), addr)
}

/// Connect a real WS to `relay_addr` and wire it into a [`WsWireTransport`] with reader + writer pumps.
async fn connect_transport(relay_addr: SocketAddr) -> WsWireTransport {
    let tcp = TcpStream::connect(relay_addr).await.expect("connect relay");
    let (ws, _resp) = tokio::time::timeout(
        Duration::from_secs(10),
        client_async(format!("ws://{relay_addr}/"), tcp),
    )
    .await
    .expect("ws handshake timed out")
    .expect("ws handshake");
    let (mut sink, mut stream) = ws.split();

    let inbound = Arc::new(Mutex::new(VecDeque::new()));
    let outbound: Arc<Mutex<VecDeque<Frame>>> = Arc::new(Mutex::new(VecDeque::new()));
    let open = Arc::new(AtomicBool::new(true));

    // Reader: WS binary messages → decoded frames → inbound queue.
    {
        let inbound = inbound.clone();
        let open = open.clone();
        tokio::spawn(async move {
            while let Some(msg) = stream.next().await {
                match msg {
                    Ok(Message::Binary(b)) => {
                        if let Some(f) = Frame::decode(&b) {
                            inbound.lock().unwrap().push_back(f);
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
            }
            open.store(false, Ordering::SeqCst);
        });
    }
    // Writer: outbound queue → encoded WS binary messages (drains on a 1ms tick).
    {
        let outbound = outbound.clone();
        let open = open.clone();
        tokio::spawn(async move {
            loop {
                let frames: Vec<Frame> = outbound.lock().unwrap().drain(..).collect();
                for f in frames {
                    if let Some(b) = f.encode()
                        && sink.send(Message::Binary(b)).await.is_err()
                    {
                        open.store(false, Ordering::SeqCst);
                        return;
                    }
                }
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });
    }

    WsWireTransport {
        inbound,
        outbound,
        open,
    }
}

#[tokio::test]
async fn ws_connector_round_trips_over_a_real_websocket_through_wvrelay() {
    let echo = spawn_echo().await;
    let (_relay, relay_addr) = spawn_relay();
    let transport = connect_transport(relay_addr).await;

    let mut client = WsConnector::new(transport, Vec::new());
    let conn = client.connect(Ipv4Addr::new(127, 0, 0, 1), echo.port());

    const MSG: &[u8] = b"WsConnector over a real websocket wire";
    let mut sent = false;
    let mut received: Vec<u8> = Vec::new();
    for _ in 0..10_000 {
        if !sent && client.status(conn) == ConnStatus::Established {
            assert_eq!(client.send(conn, MSG), MSG.len());
            sent = true;
        }
        received.extend_from_slice(&client.recv(conn));
        if received.len() >= MSG.len() {
            break;
        }
        // Yield to the WS reader/writer pumps between synchronous connector passes.
        tokio::time::sleep(Duration::from_millis(1)).await;
    }

    assert_eq!(
        received, MSG,
        "the real WsConnector must round-trip bytes over a real WebSocket through the real wvrelay"
    );
}

#[tokio::test]
async fn ws_connector_refused_backend_fails_over_a_real_websocket() {
    // Nothing listening on this port → the relay's connect fails → OPEN_FAIL → the client stream fails.
    let refused = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let (_relay, relay_addr) = spawn_relay();
    let transport = connect_transport(relay_addr).await;
    let mut client = WsConnector::new(transport, Vec::new());
    let conn = client.connect(Ipv4Addr::new(127, 0, 0, 1), refused);

    let mut failed = false;
    for _ in 0..10_000 {
        if matches!(client.status(conn), ConnStatus::Failed(_)) {
            failed = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    assert!(
        failed,
        "a refused backend must surface as a failed stream over the real WebSocket"
    );
}
