//! WS adapter tests: a REAL `tokio-tungstenite` WebSocket client speaks the proxy protocol through
//! the adapter to a REAL TCP echo backend — proving the entire chain over an actual WebSocket wire,
//! not the channel shortcut the driver tests use.

use super::serve;
use crate::ws_proxy::{Frame, INITIAL_WINDOW, hello};
use futures_util::{SinkExt, StreamExt};
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
