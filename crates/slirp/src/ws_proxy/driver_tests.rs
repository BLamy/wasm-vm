//! Driver integration tests: the async relay driven over channels against a REAL tokio TCP echo
//! server. These exercise the whole chain — guest frames → relay → real outbound TCP → bytes back —
//! not a mock: a full echo round-trip, connect failure, credit backpressure gating the backend
//! read, and two concurrent streams with no cross-talk.

use super::RelayServer;
use crate::ws_proxy::{Frame, INITIAL_WINDOW, hello};
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::time::timeout;

/// A real TCP echo server on an ephemeral port; returns its address.
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

/// The guest side of the WS: feed frames in, read frames out.
struct Guest {
    tx: mpsc::Sender<Vec<u8>>,
    rx: mpsc::Receiver<Vec<u8>>,
}

impl Guest {
    async fn send(&self, frame: Frame) {
        self.tx.send(frame.encode().unwrap()).await.unwrap();
    }
    async fn recv(&mut self) -> Frame {
        let bytes = timeout(Duration::from_secs(5), self.rx.recv())
            .await
            .expect("timed out waiting for a frame")
            .expect("relay closed the transport");
        Frame::decode(&bytes).expect("relay sent a decodable frame")
    }
    /// Collect `len` bytes of `DATA` for `stream`, tolerating interleaved `WINDOW` refills.
    async fn collect_data(&mut self, stream: u32, len: usize) -> Vec<u8> {
        let mut buf = Vec::new();
        while buf.len() < len {
            match self.recv().await {
                Frame::Data { stream: s, bytes } if s == stream => buf.extend_from_slice(&bytes),
                Frame::Window { .. } => {}
                other => panic!("unexpected frame while collecting data: {other:?}"),
            }
        }
        buf
    }
}

/// Spawn a relay wired to a fresh Guest, complete the HELLO handshake.
fn start_relay() -> Guest {
    let (in_tx, in_rx) = mpsc::channel::<Vec<u8>>(64);
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>(64);
    tokio::spawn(RelayServer::new(in_rx, out_tx, vec![]).run());
    Guest {
        tx: in_tx,
        rx: out_rx,
    }
}

async fn handshake(g: &mut Guest) {
    assert!(
        matches!(g.recv().await, Frame::Hello { .. }),
        "server HELLO first"
    );
    g.send(hello(vec![])).await;
}

/// Open `stream` to `addr` and consume the OPEN_OK + initial WINDOW.
async fn open(g: &mut Guest, stream: u32, addr: SocketAddr) {
    g.send(Frame::Open {
        stream,
        host: "127.0.0.1".into(),
        port: addr.port(),
    })
    .await;
    assert_eq!(g.recv().await, Frame::OpenOk { stream });
    assert_eq!(
        g.recv().await,
        Frame::Window {
            stream,
            credit: INITIAL_WINDOW
        }
    );
}

#[tokio::test]
async fn full_echo_round_trip_through_a_real_backend() {
    let addr = spawn_echo().await;
    let mut g = start_relay();
    handshake(&mut g).await;
    open(&mut g, 1, addr).await;

    // Grant the relay send credit, then send a payload; the echo comes back as DATA.
    g.send(Frame::Window {
        stream: 1,
        credit: 1024,
    })
    .await;
    g.send(Frame::Data {
        stream: 1,
        bytes: b"hello relay".to_vec(),
    })
    .await;

    let echoed = g.collect_data(1, 11).await;
    assert_eq!(
        echoed, b"hello relay",
        "guest bytes round-tripped through real TCP"
    );
}

#[tokio::test]
async fn a_connect_to_a_dead_port_fails_the_open() {
    // Bind then drop → the port refuses connects.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let dead = listener.local_addr().unwrap();
    drop(listener);

    let mut g = start_relay();
    handshake(&mut g).await;
    g.send(Frame::Open {
        stream: 1,
        host: "127.0.0.1".into(),
        port: dead.port(),
    })
    .await;
    assert_eq!(
        g.recv().await,
        Frame::OpenFail { stream: 1, code: 1 },
        "a refused connect surfaces as OPEN_FAIL"
    );
}

#[tokio::test]
async fn backend_reads_are_gated_by_the_guests_credit() {
    let addr = spawn_echo().await;
    let mut g = start_relay();
    handshake(&mut g).await;
    open(&mut g, 1, addr).await;

    // Grant only 2 bytes of send credit, then push 5 bytes to the echo.
    g.send(Frame::Window {
        stream: 1,
        credit: 2,
    })
    .await;
    g.send(Frame::Data {
        stream: 1,
        bytes: b"hello".to_vec(),
    })
    .await;

    // Only 2 bytes can come back until we grant more — collect_data blocks past 2 otherwise.
    let first = g.collect_data(1, 2).await;
    assert_eq!(first, b"he", "backend read capped at the granted credit");

    // The remaining 3 bytes must not have arrived yet: a short grant, then the rest flows.
    g.send(Frame::Window {
        stream: 1,
        credit: 3,
    })
    .await;
    let rest = g.collect_data(1, 3).await;
    assert_eq!(rest, b"llo", "the rest flows once more credit is granted");
}

#[tokio::test]
async fn two_concurrent_streams_do_not_cross_talk() {
    let addr = spawn_echo().await;
    let mut g = start_relay();
    handshake(&mut g).await;
    open(&mut g, 1, addr).await;
    open(&mut g, 2, addr).await;

    for s in [1u32, 2] {
        g.send(Frame::Window {
            stream: s,
            credit: 1024,
        })
        .await;
    }
    g.send(Frame::Data {
        stream: 1,
        bytes: b"stream-one".to_vec(),
    })
    .await;
    g.send(Frame::Data {
        stream: 2,
        bytes: b"STREAM-TWO".to_vec(),
    })
    .await;

    // Each stream's echo returns its own payload, uncorrupted.
    let one = g.collect_data(1, 10).await;
    let two = g.collect_data(2, 10).await;
    assert_eq!(one, b"stream-one");
    assert_eq!(two, b"STREAM-TWO");
}

#[tokio::test]
async fn a_guest_close_tears_the_stream_down() {
    let addr = spawn_echo().await;
    let mut g = start_relay();
    handshake(&mut g).await;
    open(&mut g, 1, addr).await;
    // Closing must not panic the relay; a following open on a fresh stream still works.
    g.send(Frame::Close { stream: 1 }).await;
    open(&mut g, 2, addr).await;
    g.send(Frame::Window {
        stream: 2,
        credit: 16,
    })
    .await;
    g.send(Frame::Data {
        stream: 2,
        bytes: b"alive".to_vec(),
    })
    .await;
    assert_eq!(g.collect_data(2, 5).await, b"alive");
}

#[tokio::test]
async fn a_dropped_ws_transport_shuts_the_relay_down() {
    let addr = spawn_echo().await;
    let mut g = start_relay();
    handshake(&mut g).await;
    open(&mut g, 1, addr).await;
    // Dropping the guest's sender closes the inbound channel → run() returns; the out channel closes.
    drop(g.tx);
    // Drain: the relay's task ends, so the outbound receiver eventually reports closed.
    let closed = async { while g.rx.recv().await.is_some() {} };
    timeout(Duration::from_secs(5), closed)
        .await
        .expect("relay did not shut down after the transport dropped");
}
