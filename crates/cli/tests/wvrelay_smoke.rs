//! E3-net slice 2c — deployable-artifact proof for the `wvrelay` binary. Spawns the ACTUAL compiled
//! `wvrelay` process on an ephemeral port, then drives a REAL `tokio-tungstenite` WebSocket client
//! through it to a REAL TCP echo backend and round-trips bytes. The ws-proxy protocol + per-connection
//! bridge are proven at the library level in `wasm_vm_slirp`'s `ws_adapter_tests`; this proves the
//! runnable wrapper — argv bind parsing, the readiness announcement on stdout, and `serve_ws` actually
//! running under `main` — i.e. that the relay can be DEPLOYED and reached, which slice 2c needs.

use std::io::{BufRead, BufReader};
use std::net::SocketAddr;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;
use tokio_tungstenite::client_async;
use tokio_tungstenite::tungstenite::Message;
use wasm_vm_slirp::ws_proxy::{Frame, INITIAL_WINDOW, hello};

type ClientWs = tokio_tungstenite::WebSocketStream<TcpStream>;

/// Kills the spawned relay on drop so a panicking assertion never leaks the process.
struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// A real TCP echo backend (tokio); returns its address.
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

/// Spawn the real `wvrelay` binary bound to an ephemeral port; block until it announces readiness on
/// stdout and return `(guard, bound_addr)`.
fn spawn_relay() -> (ChildGuard, SocketAddr) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_wvrelay"))
        .arg("127.0.0.1:0")
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn wvrelay");
    let stdout = child.stdout.take().expect("piped stdout");
    let mut line = String::new();
    BufReader::new(stdout)
        .read_line(&mut line)
        .expect("read wvrelay readiness line");
    // Line shape: "wvrelay listening on ws://127.0.0.1:PORT"
    let addr: SocketAddr = line
        .split("ws://")
        .nth(1)
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or_else(|| panic!("could not parse relay address from: {line:?}"));
    (ChildGuard(child), addr)
}

async fn recv_frame(ws: &mut ClientWs) -> Frame {
    loop {
        let msg = timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("timed out")
            .expect("stream ended")
            .expect("ws error");
        if let Message::Binary(b) = msg {
            return Frame::decode(&b).expect("decodable frame");
        }
    }
}

async fn send_frame(ws: &mut ClientWs, f: Frame) {
    ws.send(Message::Binary(f.encode().unwrap())).await.unwrap();
}

#[tokio::test]
async fn the_deployed_wvrelay_binary_round_trips_a_real_websocket_to_a_real_backend() {
    let echo = spawn_echo().await;
    let (_relay, relay_addr) = spawn_relay(); // real process; killed on drop

    let tcp = TcpStream::connect(relay_addr).await.expect("connect relay");
    // Bound the WS upgrade: if the binary bound the port but isn't actually serving (a broken relay),
    // `client_async` would await a handshake response that never comes and HANG the test — so a
    // regression must fail fast and clean, not stall until the CI job timeout.
    let (mut ws, _resp) = timeout(
        Duration::from_secs(10),
        client_async(format!("ws://{relay_addr}/"), tcp),
    )
    .await
    .expect("ws handshake timed out — the spawned relay bound the port but isn't serving")
    .expect("ws handshake with the spawned relay");

    // Relay sends HELLO first; complete the handshake.
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(vec![])).await;

    // Open a flow to the real echo backend through the spawned relay.
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 1,
            host: "127.0.0.1".into(),
            port: echo.port(),
        },
    )
    .await;
    assert_eq!(recv_frame(&mut ws).await, Frame::OpenOk { stream: 1 });
    assert_eq!(
        recv_frame(&mut ws).await,
        Frame::Window {
            stream: 1,
            credit: INITIAL_WINDOW
        }
    );

    // Grant credit, push a payload, read the echo back — all through the spawned relay process.
    send_frame(
        &mut ws,
        Frame::Window {
            stream: 1,
            credit: 1024,
        },
    )
    .await;
    const MSG: &[u8] = b"through the deployed wvrelay";
    send_frame(
        &mut ws,
        Frame::Data {
            stream: 1,
            bytes: MSG.to_vec(),
        },
    )
    .await;

    let mut got = Vec::new();
    while got.len() < MSG.len() {
        match recv_frame(&mut ws).await {
            Frame::Data { stream: 1, bytes } => got.extend_from_slice(&bytes),
            Frame::Window { .. } => {}
            other => panic!("unexpected frame: {other:?}"),
        }
    }
    assert_eq!(
        got, MSG,
        "bytes must round-trip through the real deployed relay process to a real socket"
    );
}
