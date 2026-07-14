//! WS adapter tests: a REAL `tokio-tungstenite` WebSocket client speaks the proxy protocol through
//! the adapter to a REAL TCP echo backend — proving the entire chain over an actual WebSocket wire,
//! not the channel shortcut the driver tests use.

use super::{handle_conn, serve};
use crate::ws_proxy::{Frame, INITIAL_WINDOW, hello};
use futures_util::{SinkExt, StreamExt};
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;
use tokio_tungstenite::client_async;
use tokio_tungstenite::tungstenite::Message;

type ClientWs = tokio_tungstenite::WebSocketStream<TcpStream>;

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
                        Ok(n) => {
                            if sock.write_all(&b[..n]).await.is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }
    });
    addr
}

/// Start the WS relay on an ephemeral port; return a connected real WebSocket client.
async fn connect_ws() -> ClientWs {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(serve(listener, vec![]));
    let tcp = TcpStream::connect(addr).await.unwrap();
    let url = format!("ws://{addr}/");
    let (ws, _resp) = client_async(url.as_str(), tcp).await.unwrap();
    ws
}

async fn recv_frame(ws: &mut ClientWs) -> Frame {
    loop {
        let msg = timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("timed out waiting for a WS message")
            .expect("WS stream ended")
            .expect("WS error");
        if let Message::Binary(b) = msg {
            return Frame::decode(&b).expect("a decodable frame");
        }
        // ignore ping/pong/text
    }
}

async fn send_frame(ws: &mut ClientWs, f: Frame) {
    ws.send(Message::Binary(f.encode().unwrap())).await.unwrap();
}

#[tokio::test]
async fn a_real_websocket_round_trips_to_a_real_backend() {
    let echo = spawn_echo().await;
    let mut ws = connect_ws().await;

    // The relay sends its HELLO first; complete the handshake.
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(vec![])).await;

    // Open a flow to the echo backend.
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

    // Grant send credit, push a payload, and read the echo back — all over a real WebSocket.
    send_frame(
        &mut ws,
        Frame::Window {
            stream: 1,
            credit: 1024,
        },
    )
    .await;
    send_frame(
        &mut ws,
        Frame::Data {
            stream: 1,
            bytes: b"over the websocket wire".to_vec(),
        },
    )
    .await;

    let mut got = Vec::new();
    while got.len() < 23 {
        match recv_frame(&mut ws).await {
            Frame::Data { stream: 1, bytes } => got.extend_from_slice(&bytes),
            Frame::Window { .. } => {}
            other => panic!("unexpected frame: {other:?}"),
        }
    }
    assert_eq!(got, b"over the websocket wire");
}

#[tokio::test]
async fn a_refused_backend_reports_open_fail_over_the_websocket() {
    // A dead port (bind then drop) → OPEN_FAIL delivered over the real WS.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let dead = listener.local_addr().unwrap();
    drop(listener);

    let mut ws = connect_ws().await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(vec![])).await;
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 1,
            host: "127.0.0.1".into(),
            port: dead.port(),
        },
    )
    .await;
    assert_eq!(
        recv_frame(&mut ws).await,
        Frame::OpenFail { stream: 1, code: 1 }
    );
}

/// Accept exactly one connection and run `handle_conn` as an observable task, returning its address
/// and the join handle — so a test can assert the per-connection cleanup chain actually completes.
async fn one_shot_conn() -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        handle_conn(tcp, vec![], BTreeMap::new()).await;
    });
    (addr, handle)
}

async fn client_to(addr: SocketAddr) -> ClientWs {
    let tcp = TcpStream::connect(addr).await.unwrap();
    let (ws, _) = client_async(format!("ws://{addr}/").as_str(), tcp)
        .await
        .unwrap();
    ws
}

/// F2 regression: a client disconnect must drive the whole per-connection shutdown chain to
/// completion (inbound close → relay stops → outbound close → writer exits → `handle_conn` returns).
/// Removing the load-bearing `drop(in_tx)` deadlocks this — the join handle never completes.
#[tokio::test]
async fn a_client_disconnect_cleanly_finishes_the_connection_task() {
    let (addr, server) = one_shot_conn().await;
    let mut ws = client_to(addr).await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    drop(ws); // client disconnects

    timeout(Duration::from_secs(5), server)
        .await
        .expect("handle_conn hung after client disconnect (deadlock / task leak)")
        .expect("handle_conn task panicked");
}

/// F2 regression: when the relay dies on a protocol error, the adapter must deliver a proper WS
/// Close to the client (not just drop the TCP). Removing `ws_sink.close()` fails this — the client
/// sees a reset/None instead of a clean Close.
#[tokio::test]
async fn a_relay_protocol_error_delivers_a_clean_close_to_the_client() {
    let (addr, _server) = one_shot_conn().await;
    let mut ws = client_to(addr).await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    // A stream frame before completing the handshake → relay protocol error → run() returns.
    ws.send(Message::Binary(
        Frame::Data {
            stream: 1,
            bytes: vec![1],
        }
        .encode()
        .unwrap(),
    ))
    .await
    .unwrap();

    let saw_clean_close = timeout(Duration::from_secs(5), async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Close(_))) => return true,
                Some(Ok(_)) => continue,
                Some(Err(_)) | None => return false, // TCP reset / drop without a clean Close
            }
        }
    })
    .await
    .expect("timed out waiting for the connection to close");
    assert!(
        saw_clean_close,
        "the client received a proper WS Close frame when the relay died"
    );
}
