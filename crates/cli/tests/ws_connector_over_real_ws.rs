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
use sha2::{Digest, Sha256};
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
        // E3-T14's acceptance target is TEST-NET-1. The relay rewrites it explicitly to the local
        // server so the proof is deterministic and needs no privileged route/loopback alias.
        .env("WVRELAY_HOST_MAP", "192.0.2.1=127.0.0.1")
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
    let conn = client.connect(Ipv4Addr::new(192, 0, 2, 1), echo.port());

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

/// E3-T16 acceptance: one real WebSocket multiplexes three live TCP streams. The first stream's
/// guest reader is deliberately stalled, exhausting its relay-to-guest credit; the other two must
/// still finish. Once the first reader resumes, a full 100 MiB transfer must be byte-identical and
/// SHA-256-identical to what was sent.
#[tokio::test]
async fn one_websocket_multiplexes_a_stalled_stream_and_a_100mib_transfer() {
    const LARGE: usize = 100 * 1024 * 1024;
    const SMALL: usize = 2 * 1024 * 1024;
    const OFFER: usize = 32 * 1024;

    let echo = spawn_echo().await;
    let (_relay, relay_addr) = spawn_relay();
    // One transport means one actual WebSocket; all three logical connections below share it.
    let transport = connect_transport(relay_addr).await;
    let mut client = WsConnector::new(transport, Vec::new());
    let conns = [
        client.connect(Ipv4Addr::new(192, 0, 2, 1), echo.port()),
        client.connect(Ipv4Addr::new(192, 0, 2, 1), echo.port()),
        client.connect(Ipv4Addr::new(192, 0, 2, 1), echo.port()),
    ];
    let totals = [LARGE, SMALL, SMALL];
    let mut sent = [0usize; 3];
    let mut received = [0usize; 3];
    let mut sent_hashes = [Sha256::new(), Sha256::new(), Sha256::new()];
    let mut recv_hashes = [Sha256::new(), Sha256::new(), Sha256::new()];
    let started = std::time::Instant::now();
    let mut stalled_reader_released = false;

    tokio::time::timeout(Duration::from_secs(240), async {
        loop {
            for i in 0..3 {
                if sent[i] < totals[i] && client.status(conns[i]) == ConnStatus::Established {
                    let end = (sent[i] + OFFER).min(totals[i]);
                    let bytes: Vec<u8> = (sent[i]..end)
                        .map(|offset| ((offset + i * 67) % 251) as u8)
                        .collect();
                    let accepted = client.send(conns[i], &bytes);
                    sent_hashes[i].update(&bytes[..accepted]);
                    sent[i] += accepted;
                }
            }

            // Hold stream 0's guest reader closed until both siblings have completed. Its initial
            // receive window therefore drains to zero at the relay, while the shared WS continues
            // carrying streams 1 and 2.
            for i in 1..3 {
                let bytes = client.recv(conns[i]);
                for (j, &byte) in bytes.iter().enumerate() {
                    assert_eq!(
                        byte,
                        ((received[i] + j + i * 67) % 251) as u8,
                        "stream {i} byte mismatch at {}",
                        received[i] + j
                    );
                }
                recv_hashes[i].update(&bytes);
                received[i] += bytes.len();
            }

            if !stalled_reader_released && received[1] == SMALL && received[2] == SMALL {
                assert_eq!(
                    received[0], 0,
                    "the adversarial reader stayed fully stalled"
                );
                assert!(
                    started.elapsed() < Duration::from_secs(60),
                    "two sibling streams must finish while stream 0 is stalled"
                );
                stalled_reader_released = true;
            }

            if stalled_reader_released {
                let bytes = client.recv(conns[0]);
                for (j, &byte) in bytes.iter().enumerate() {
                    assert_eq!(
                        byte,
                        ((received[0] + j) % 251) as u8,
                        "large stream byte mismatch at {}",
                        received[0] + j
                    );
                }
                recv_hashes[0].update(&bytes);
                received[0] += bytes.len();
            }

            if received == totals {
                break;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .expect("three-flow real-WebSocket acceptance exceeded 240 seconds");

    assert!(
        stalled_reader_released,
        "sibling streams never escaped the stall"
    );
    assert_eq!(sent, totals, "every source byte entered the connector");
    assert_eq!(received, totals, "every echoed byte returned to the guest");
    for i in 0..3 {
        assert_eq!(
            sent_hashes[i].clone().finalize(),
            recv_hashes[i].clone().finalize(),
            "stream {i} SHA-256 mismatch"
        );
    }
}
