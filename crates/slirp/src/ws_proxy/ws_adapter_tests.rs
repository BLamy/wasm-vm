//! WS adapter tests: a REAL `tokio-tungstenite` WebSocket client speaks the proxy protocol through
//! the adapter to a REAL TCP echo backend — proving the entire chain over an actual WebSocket wire,
//! not the channel shortcut the driver tests use.

use super::{handle_conn, serve, serve_secure_with_limits};
use crate::ws_proxy::{Frame, INITIAL_WINDOW, RelayLimits, hello, issue_relay_token};
use futures_util::{SinkExt, StreamExt};
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::time::timeout;
use tokio_tungstenite::client_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::{Message, http};

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

async fn secure_client(origin: Option<&str>) -> (ClientWs, Vec<u8>) {
    secure_client_with_map(origin, BTreeMap::new()).await
}

async fn secure_client_with_map(
    origin: Option<&str>,
    host_map: BTreeMap<String, String>,
) -> (ClientWs, Vec<u8>) {
    secure_client_with_limits(origin, host_map, RelayLimits::default()).await
}

async fn secure_client_with_limits(
    origin: Option<&str>,
    host_map: BTreeMap<String, String>,
    limits: RelayLimits,
) -> (ClientWs, Vec<u8>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(serve_secure_with_limits(
        listener,
        b"relay test secret".to_vec(),
        ["https://vm.example".to_owned()].into_iter().collect(),
        host_map,
        limits,
    ));
    let tcp = TcpStream::connect(addr).await.unwrap();
    let mut request = format!("ws://{addr}/").into_client_request().unwrap();
    if let Some(origin) = origin {
        request.headers_mut().insert(
            http::header::ORIGIN,
            http::HeaderValue::from_str(origin).unwrap(),
        );
    }
    let (ws, _) = client_async(request, tcp).await.unwrap();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let token = issue_relay_token(
        b"relay test secret",
        now,
        now + 60,
        "https://vm.example",
        "browser-session-1",
    )
    .unwrap();
    (ws, token)
}

/// E5-T43a verifier: a secured connection that never sends HELLO is closed at the deadline.
#[tokio::test]
async fn secure_relay_closes_a_connection_that_never_authenticates() {
    let (mut ws, _token) = secure_client_with_limits(
        Some("https://vm.example"),
        BTreeMap::new(),
        RelayLimits::default(),
    )
    .await;
    let started = std::time::Instant::now();
    let ended = timeout(
        crate::ws_proxy::HELLO_DEADLINE + Duration::from_secs(5),
        async {
            while let Some(msg) = ws.next().await {
                if msg.is_err() || msg.is_ok_and(|m| m.is_close()) {
                    break;
                }
            }
        },
    )
    .await;
    assert!(ended.is_ok(), "closed within the deadline");
    assert!(
        started.elapsed() >= crate::ws_proxy::HELLO_DEADLINE - Duration::from_millis(200),
        "not before it"
    );
}

/// E5-T43a round-2 verifier: the HELLO deadline ends only unauthenticated connections; an
/// authenticated session is served after it (a mutant cutting every session at 10 s survived).
#[tokio::test]
async fn an_authenticated_session_outlives_the_hello_deadline() {
    let echo = spawn_echo().await;
    let (mut ws, token) = secure_client_with_map(
        Some("https://vm.example"),
        [("fixture.test".to_owned(), "127.0.0.1".to_owned())]
            .into_iter()
            .collect(),
    )
    .await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(token)).await;
    tokio::time::sleep(crate::ws_proxy::HELLO_DEADLINE + Duration::from_secs(1)).await;
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 3,
            host: "fixture.test".into(),
            port: echo.port(),
        },
    )
    .await;
    assert_eq!(recv_frame(&mut ws).await, Frame::OpenOk { stream: 3 });
}

/// E5-T43a round-2 verifier: one client may hold only so many authenticated sessions at once; a
/// closed one frees its place.
#[tokio::test]
async fn a_client_over_its_session_cap_is_refused_and_a_closed_session_frees_a_place() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(serve_secure_with_limits(
        listener,
        b"relay test secret".to_vec(),
        ["https://vm.example".to_owned()].into_iter().collect(),
        BTreeMap::new(),
        RelayLimits {
            max_sessions_per_client: 1,
            ..RelayLimits::default()
        },
    ));
    let connect = |id: &'static str| async move {
        let tcp = TcpStream::connect(addr).await.unwrap();
        let mut request = format!("ws://{addr}/").into_client_request().unwrap();
        request.headers_mut().insert(
            http::header::ORIGIN,
            http::HeaderValue::from_static("https://vm.example"),
        );
        let (mut ws, _) = client_async(request, tcp).await.unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let token = issue_relay_token(
            b"relay test secret",
            now,
            now + 60,
            "https://vm.example",
            id,
        )
        .unwrap();
        assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
        send_frame(&mut ws, hello(token)).await;
        ws
    };
    // Whether a connection is still served: an OPEN gets an answer (any) or the socket closes.
    async fn served(ws: &mut ClientWs, stream: u32) -> bool {
        send_frame(
            ws,
            Frame::Open {
                stream,
                host: "127.0.0.1".into(),
                port: 9,
            },
        )
        .await;
        matches!(timeout(Duration::from_secs(5), ws.next()).await, Ok(Some(Ok(m))) if m.is_binary())
    }
    let mut first = connect("session-1").await;
    assert!(served(&mut first, 1).await, "the first session is served");
    let mut second = connect("session-2").await;
    assert!(
        !served(&mut second, 1).await,
        "a second session of the same client is refused"
    );
    drop(first);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let mut third = connect("session-3").await;
    assert!(
        served(&mut third, 1).await,
        "the closed session freed its place"
    );
}

/// A WebSocket client written by hand that never answers Close: it upgrades, optionally sends one
/// binary frame, then only reads. Returns how long until the server dropped the TCP connection.
async fn raw_client_until_dropped(
    addr: SocketAddr,
    client: Option<&str>,
    first: Option<Vec<u8>>,
    limit: Duration,
) -> Option<Duration> {
    let mut tcp = TcpStream::connect(addr).await.unwrap();
    let extra = client
        .map(|c| format!("{}: {c}\r\n", super::CLIENT_HEADER))
        .unwrap_or_default();
    let request = format!(
        "GET / HTTP/1.1\r\nHost: {addr}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: https://vm.example\r\n{extra}\r\n"
    );
    tcp.write_all(request.as_bytes()).await.unwrap();
    // Wait for the 101 response, as a real client does, before sending any frame.
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        match timeout(Duration::from_secs(5), tcp.read(&mut byte)).await {
            Ok(Ok(1)) => head.push(byte[0]),
            _ => return Some(Duration::ZERO),
        }
    }
    assert!(
        head.starts_with(b"HTTP/1.1 101"),
        "{}",
        String::from_utf8_lossy(&head)
    );
    if let Some(payload) = first {
        // One masked binary frame (mask key 0); a HELLO with a token needs the 16-bit length.
        let mut frame = if payload.len() < 126 {
            vec![0x82, 0x80 | payload.len() as u8]
        } else {
            vec![
                0x82,
                0x80 | 126,
                (payload.len() >> 8) as u8,
                payload.len() as u8,
            ]
        };
        frame.extend_from_slice(&[0, 0, 0, 0]);
        frame.extend_from_slice(&payload);
        tcp.write_all(&frame).await.unwrap();
    }
    let started = std::time::Instant::now();
    let mut buf = [0u8; 4096];
    loop {
        match timeout(limit.saturating_sub(started.elapsed()), tcp.read(&mut buf)).await {
            Ok(Ok(0)) | Ok(Err(_)) => return Some(started.elapsed()),
            Ok(Ok(_)) => {}
            Err(_) => return None,
        }
    }
}

async fn secure_server(limits: RelayLimits) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(serve_secure_with_limits(
        listener,
        b"relay test secret".to_vec(),
        ["https://vm.example".to_owned()].into_iter().collect(),
        BTreeMap::new(),
        limits,
    ));
    addr
}

fn hello_frame(id: &str) -> Vec<u8> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let token = issue_relay_token(
        b"relay test secret",
        now,
        now + 60,
        "https://vm.example",
        id,
    )
    .unwrap();
    hello(token).encode().unwrap()
}

/// E5-T43a round-3 verifier: the relay drops a connection it has finished with, even when the
/// client never answers its Close — at the HELLO deadline, and when refused at the session cap.
#[tokio::test]
async fn a_finished_connection_is_dropped_even_if_the_client_never_answers_close() {
    let addr = secure_server(RelayLimits {
        max_sessions_per_client: 1,
        ..RelayLimits::default()
    })
    .await;
    let grace = super::CLOSE_GRACE + Duration::from_secs(2);
    // Never authenticates.
    let silent = raw_client_until_dropped(
        addr,
        Some("c1"),
        None,
        crate::ws_proxy::HELLO_DEADLINE + grace,
    )
    .await;
    assert!(
        silent.is_some_and(|t| t >= crate::ws_proxy::HELLO_DEADLINE - Duration::from_millis(200)),
        "dropped after the deadline: {silent:?}"
    );
    // Holds the client's one place, then a second session of the same client is refused and dropped.
    let holder = tokio::spawn(raw_client_until_dropped(
        addr,
        Some("c2"),
        Some(hello_frame("held")),
        Duration::from_secs(8),
    ));
    tokio::time::sleep(Duration::from_millis(500)).await;
    let refused =
        raw_client_until_dropped(addr, Some("c2"), Some(hello_frame("refused")), grace).await;
    assert!(
        refused.is_some(),
        "the refused session is dropped within the grace"
    );
    assert_eq!(
        holder.await.unwrap(),
        None,
        "the authenticated session is kept"
    );
}

/// The user's idle limit: an authenticated session with no traffic for `session_idle_secs` is
/// closed; traffic keeps it.
#[tokio::test]
async fn an_idle_session_is_closed_and_an_active_one_kept() {
    let limits = RelayLimits {
        session_idle_secs: 1,
        ..RelayLimits::default()
    };
    let addr = secure_server(limits).await;
    let idle = raw_client_until_dropped(
        addr,
        Some("idle"),
        Some(hello_frame("idle")),
        Duration::from_secs(6),
    )
    .await;
    assert!(
        idle.is_some_and(|t| t >= Duration::from_millis(900)),
        "idle session closed after about a second: {idle:?}"
    );

    let echo = spawn_echo().await;
    let (mut ws, token) = secure_client_with_limits(
        Some("https://vm.example"),
        [("fixture.test".to_owned(), "127.0.0.1".to_owned())]
            .into_iter()
            .collect(),
        limits,
    )
    .await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(token)).await;
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 1,
            host: "fixture.test".into(),
            port: echo.port(),
        },
    )
    .await;
    assert_eq!(recv_frame(&mut ws).await, Frame::OpenOk { stream: 1 });
    // Three seconds of frames every 300 ms that carry no bytes (stream opens, each closed again):
    // well past the one-second limit, and only the session's own frames keep it alive.
    let mut next = 3u32;
    for _ in 0..10 {
        send_frame(
            &mut ws,
            Frame::Open {
                stream: next,
                host: "fixture.test".into(),
                port: echo.port(),
            },
        )
        .await;
        send_frame(&mut ws, Frame::Rst { stream: next }).await;
        next += 2;
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    send_frame(
        &mut ws,
        Frame::Open {
            stream: next,
            host: "fixture.test".into(),
            port: echo.port(),
        },
    )
    .await;
    let mut opened = false;
    for _ in 0..60 {
        match timeout(Duration::from_secs(2), ws.next()).await {
            Ok(Some(Ok(m))) if m.is_binary() => {
                if Frame::decode(&m.into_data()) == Some(Frame::OpenOk { stream: next }) {
                    opened = true;
                    break;
                }
            }
            _ => break,
        }
    }
    assert!(opened, "the active session is still served");
}

/// E5-T43a round-3 verifier: the session cap is per client as the front end names it — two names
/// get their own places, the same name shares one.
#[tokio::test]
async fn the_session_cap_is_per_client_name() {
    let addr = secure_server(RelayLimits {
        max_sessions_per_client: 1,
        ..RelayLimits::default()
    })
    .await;
    let keep = |client: &'static str, id: &'static str| {
        tokio::spawn(raw_client_until_dropped(
            addr,
            Some(client),
            Some(hello_frame(id)),
            Duration::from_secs(4),
        ))
    };
    let a = keep("client-a", "a1");
    let b = keep("client-b", "b1");
    tokio::time::sleep(Duration::from_millis(500)).await;
    let a2 = raw_client_until_dropped(
        addr,
        Some("client-a"),
        Some(hello_frame("a2")),
        Duration::from_secs(4),
    )
    .await;
    assert!(a2.is_some(), "a second session of client-a is refused");
    assert_eq!(a.await.unwrap(), None, "client-a's first session is kept");
    assert_eq!(b.await.unwrap(), None, "client-b has its own place");
    // A header longer than 64 bytes is not a name: the TCP peer is the client then.
    let long = "x".repeat(65);
    let p1 = tokio::spawn({
        let long = long.clone();
        async move {
            raw_client_until_dropped(
                addr,
                Some(&long),
                Some(hello_frame("p1")),
                Duration::from_secs(4),
            )
            .await
        }
    });
    tokio::time::sleep(Duration::from_millis(500)).await;
    let p2 =
        raw_client_until_dropped(addr, None, Some(hello_frame("p2")), Duration::from_secs(4)).await;
    assert!(
        p2.is_some(),
        "the overlong name fell back to the peer, which holds its one place"
    );
    let p3 = raw_client_until_dropped(
        addr,
        Some(""),
        Some(hello_frame("p3")),
        Duration::from_secs(4),
    )
    .await;
    assert!(
        p3.is_some(),
        "an empty name is no name either: the peer's place is taken"
    );
    assert_eq!(p1.await.unwrap(), None);
}

#[tokio::test]
async fn secure_relay_closes_absent_wrong_origin_and_forged_hello_before_open() {
    for origin in [None, Some("https://evil.example")] {
        let (mut ws, _) = secure_client(origin).await;
        let ended = timeout(Duration::from_secs(5), ws.next()).await.unwrap();
        assert!(matches!(
            ended,
            None | Some(Ok(Message::Close(_))) | Some(Err(_))
        ));
    }

    let (mut ws, mut token) = secure_client(Some("https://vm.example")).await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    token[8] ^= 1;
    send_frame(&mut ws, hello(token)).await;
    let ended = timeout(Duration::from_secs(5), ws.next()).await.unwrap();
    assert!(matches!(
        ended,
        None | Some(Ok(Message::Close(_))) | Some(Err(_))
    ));
}

#[tokio::test]
async fn secure_relay_accepts_an_origin_bound_hello() {
    let echo = spawn_echo().await;
    let (mut ws, token) = secure_client(Some("https://vm.example")).await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(token)).await;
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 1,
            host: "127.0.0.1".into(),
            port: echo.port(),
        },
    )
    .await;
    assert_eq!(
        recv_frame(&mut ws).await,
        Frame::OpenFail { stream: 1, code: 1 }
    );

    let (mut ws, token) = secure_client_with_map(
        Some("https://vm.example"),
        [("fixture.test".to_owned(), "127.0.0.1".to_owned())]
            .into_iter()
            .collect(),
    )
    .await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(token)).await;
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 2,
            host: "fixture.test".into(),
            port: echo.port(),
        },
    )
    .await;
    assert_eq!(recv_frame(&mut ws).await, Frame::OpenOk { stream: 2 });
}

#[tokio::test]
async fn secure_relay_caps_streams_and_bytes_without_disturbing_an_existing_stream() {
    let echo = spawn_echo().await;
    let (mut ws, token) = secure_client_with_limits(
        Some("https://vm.example"),
        [("fixture.test".to_owned(), "127.0.0.1".to_owned())]
            .into_iter()
            .collect(),
        RelayLimits {
            max_concurrent_streams: 1,
            max_connects_per_minute: 4,
            max_bytes_per_token: 10,
            ..RelayLimits::default()
        },
    )
    .await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(token)).await;
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 1,
            host: "fixture.test".into(),
            port: echo.port(),
        },
    )
    .await;
    assert_eq!(recv_frame(&mut ws).await, Frame::OpenOk { stream: 1 });
    assert!(matches!(
        recv_frame(&mut ws).await,
        Frame::Window { stream: 1, .. }
    ));
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 2,
            host: "fixture.test".into(),
            port: echo.port(),
        },
    )
    .await;
    assert_eq!(
        recv_frame(&mut ws).await,
        Frame::OpenFail { stream: 2, code: 2 }
    );

    // The refused second stream does not disturb stream 1. Five bytes outbound plus five echoed
    // bytes consume the exact token budget and still round-trip.
    send_frame(
        &mut ws,
        Frame::Window {
            stream: 1,
            credit: 5,
        },
    )
    .await;
    send_frame(
        &mut ws,
        Frame::Data {
            stream: 1,
            bytes: b"alive".to_vec(),
        },
    )
    .await;
    let mut saw_echo = false;
    for _ in 0..3 {
        if recv_frame(&mut ws).await
            == (Frame::Data {
                stream: 1,
                bytes: b"alive".to_vec(),
            })
        {
            saw_echo = true;
            break;
        }
    }
    assert!(saw_echo);

    // One additional byte exceeds the shared token budget and produces a typed stream reset.
    send_frame(
        &mut ws,
        Frame::Data {
            stream: 1,
            bytes: vec![1],
        },
    )
    .await;
    assert_eq!(recv_frame(&mut ws).await, Frame::Rst { stream: 1 });
}

/// E3-T19 verifier attack: a duplicate OPEN must not consume a second quota reservation for the
/// same live wire stream. Otherwise one malformed frame leaves a phantom active stream and can
/// deny unrelated, valid streams until the token expires.
#[tokio::test]
async fn secure_relay_duplicate_open_does_not_leak_shared_concurrency() {
    let echo = spawn_echo().await;
    let (mut ws, token) = secure_client_with_limits(
        Some("https://vm.example"),
        [("fixture.test".to_owned(), "127.0.0.1".to_owned())]
            .into_iter()
            .collect(),
        RelayLimits {
            max_concurrent_streams: 2,
            max_connects_per_minute: 8,
            max_bytes_per_token: 1024,
            ..RelayLimits::default()
        },
    )
    .await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(token)).await;

    for stream in [1, 1, 2] {
        send_frame(
            &mut ws,
            Frame::Open {
                stream,
                host: "fixture.test".into(),
                port: echo.port(),
            },
        )
        .await;
        let response = recv_frame(&mut ws).await;
        match stream {
            1 if response == (Frame::OpenOk { stream: 1 }) => {
                assert!(matches!(
                    recv_frame(&mut ws).await,
                    Frame::Window { stream: 1, .. }
                ));
            }
            1 => assert_eq!(response, Frame::OpenFail { stream: 1, code: 2 }),
            2 => assert_eq!(response, Frame::OpenOk { stream: 2 }),
            _ => unreachable!(),
        }
    }
}

#[tokio::test]
async fn secure_relay_connect_rate_is_typed_and_released_streams_stay_released() {
    let echo = spawn_echo().await;
    let (mut ws, token) = secure_client_with_limits(
        Some("https://vm.example"),
        [("fixture.test".to_owned(), "127.0.0.1".to_owned())]
            .into_iter()
            .collect(),
        RelayLimits {
            max_concurrent_streams: 1,
            max_connects_per_minute: 2,
            max_bytes_per_token: 1024,
            ..RelayLimits::default()
        },
    )
    .await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(token)).await;

    for stream in [1, 2] {
        send_frame(
            &mut ws,
            Frame::Open {
                stream,
                host: "fixture.test".into(),
                port: echo.port(),
            },
        )
        .await;
        assert_eq!(recv_frame(&mut ws).await, Frame::OpenOk { stream });
        assert!(matches!(recv_frame(&mut ws).await, Frame::Window { .. }));
        send_frame(&mut ws, Frame::Close { stream }).await;
    }

    send_frame(
        &mut ws,
        Frame::Open {
            stream: 3,
            host: "fixture.test".into(),
            port: echo.port(),
        },
    )
    .await;
    assert_eq!(
        recv_frame(&mut ws).await,
        Frame::OpenFail { stream: 3, code: 2 }
    );
}

#[tokio::test]
async fn secure_relay_bounds_a_500_open_attack_and_reaps_every_accepted_socket() {
    const ATTEMPTS: u32 = 500;
    const ACCEPTED: u32 = 64;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let backend = listener.local_addr().unwrap();
    let (reaped_tx, mut reaped_rx) = tokio::sync::mpsc::channel(ACCEPTED as usize);
    tokio::spawn(async move {
        for _ in 0..ACCEPTED {
            let (mut socket, _) = listener.accept().await.unwrap();
            let tx = reaped_tx.clone();
            tokio::spawn(async move {
                let mut byte = [0u8; 1];
                let _ = socket.read(&mut byte).await;
                let _ = tx.send(()).await;
            });
        }
    });
    let (mut ws, token) = secure_client_with_limits(
        Some("https://vm.example"),
        [("fixture.test".to_owned(), "127.0.0.1".to_owned())]
            .into_iter()
            .collect(),
        RelayLimits {
            max_concurrent_streams: ACCEPTED as usize,
            max_connects_per_minute: ATTEMPTS as usize,
            max_bytes_per_token: 1024,
            ..RelayLimits::default()
        },
    )
    .await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(token)).await;

    let mut accepted = 0;
    let mut refused = 0;
    for stream in 1..=ATTEMPTS {
        send_frame(
            &mut ws,
            Frame::Open {
                stream,
                host: "fixture.test".into(),
                port: backend.port(),
            },
        )
        .await;
        match recv_frame(&mut ws).await {
            Frame::OpenOk { stream: opened } => {
                assert_eq!(opened, stream);
                assert!(matches!(recv_frame(&mut ws).await, Frame::Window { .. }));
                accepted += 1;
            }
            Frame::OpenFail {
                stream: denied,
                code: 2,
            } => {
                assert_eq!(denied, stream);
                refused += 1;
            }
            frame => panic!("unexpected response to stream {stream}: {frame:?}"),
        }
    }
    assert_eq!(accepted, ACCEPTED);
    assert_eq!(refused, ATTEMPTS - ACCEPTED);

    drop(ws);
    timeout(Duration::from_secs(5), async {
        for observed in 1..=ACCEPTED {
            reaped_rx.recv().await.unwrap_or_else(|| {
                panic!(
                    "secure relay reaped only {} of {ACCEPTED} sockets",
                    observed - 1
                )
            });
        }
    })
    .await
    .expect("secure relay did not reap accepted sockets after abrupt disconnect");
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

#[tokio::test]
async fn udp_datagrams_round_trip_over_a_real_websocket_without_coalescing() {
    let echo = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let echo_addr = echo.local_addr().unwrap();
    tokio::spawn(async move {
        let mut buf = [0u8; 65_507];
        while let Ok((n, peer)) = echo.recv_from(&mut buf).await {
            if echo.send_to(&buf[..n], peer).await.is_err() {
                break;
            }
        }
    });

    let mut ws = connect_ws().await;
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    send_frame(&mut ws, hello(vec![])).await;
    let stream = 0x8000_0001;
    send_frame(
        &mut ws,
        Frame::UdpOpen {
            stream,
            host: "127.0.0.1".into(),
            port: echo_addr.port(),
        },
    )
    .await;
    assert_eq!(recv_frame(&mut ws).await, Frame::UdpOpenOk { stream });

    send_frame(
        &mut ws,
        Frame::UdpData {
            stream,
            bytes: b"first".to_vec(),
        },
    )
    .await;
    send_frame(
        &mut ws,
        Frame::UdpData {
            stream,
            bytes: b"second-is-longer".to_vec(),
        },
    )
    .await;
    assert_eq!(
        recv_frame(&mut ws).await,
        Frame::UdpData {
            stream,
            bytes: b"first".to_vec()
        }
    );
    assert_eq!(
        recv_frame(&mut ws).await,
        Frame::UdpData {
            stream,
            bytes: b"second-is-longer".to_vec()
        },
        "WebSocket framing preserves two distinct UDP datagrams"
    );
    send_frame(&mut ws, Frame::UdpClose { stream }).await;
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

async fn verifier_server(limits: RelayLimits) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(serve_secure_with_limits(
        listener,
        b"relay test secret".to_vec(),
        ["https://vm.example".to_owned()].into_iter().collect(),
        [("fixture.test".to_owned(), "127.0.0.1".to_owned())]
            .into_iter()
            .collect(),
        limits,
    ));
    addr
}

async fn verifier_session(addr: SocketAddr, client: &str, id: &str) -> ClientWs {
    let tcp = TcpStream::connect(addr).await.unwrap();
    let mut request = format!("ws://{addr}/").into_client_request().unwrap();
    request.headers_mut().insert(
        http::header::ORIGIN,
        http::HeaderValue::from_static("https://vm.example"),
    );
    request.headers_mut().insert(
        super::CLIENT_HEADER,
        http::HeaderValue::from_str(client).unwrap(),
    );
    let (mut ws, _) = client_async(request, tcp).await.unwrap();
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    ws.send(Message::Binary(hello_frame(id))).await.unwrap();
    ws
}

/// Echo `n` bytes on a fresh stream (credit granted); returns the bytes echoed before a RST/close/timeout.
async fn verifier_echo(ws: &mut ClientWs, stream: u32, port: u16, n: usize) -> (usize, bool) {
    send_frame(
        ws,
        Frame::Open {
            stream,
            host: "fixture.test".into(),
            port,
        },
    )
    .await;
    assert_eq!(recv_frame(ws).await, Frame::OpenOk { stream });
    send_frame(
        ws,
        Frame::Window {
            stream,
            credit: 1 << 16,
        },
    )
    .await;
    send_frame(
        ws,
        Frame::Data {
            stream,
            bytes: vec![b'x'; n],
        },
    )
    .await;
    let (mut echoed, mut reset) = (0usize, false);
    while echoed < n {
        match timeout(Duration::from_secs(2), ws.next()).await {
            Ok(Some(Ok(m))) if m.is_binary() => match Frame::decode(&m.into_data()) {
                Some(Frame::Data { bytes, .. }) => echoed += bytes.len(),
                Some(Frame::Rst { .. }) => {
                    reset = true;
                    break;
                }
                _ => {}
            },
            _ => break,
        }
    }
    (echoed, reset)
}

/// (E5-T43a round-4 verifier's test.) The hourly budget is the CLIENT's, shared by its tokens and sessions, and enforced on the wire.
#[tokio::test]
async fn verifier_hourly_bytes_are_per_client_across_tokens() {
    let echo = spawn_echo().await;
    let addr = verifier_server(RelayLimits {
        max_bytes_per_client_per_hour: 100,
        ..RelayLimits::default()
    })
    .await;
    let mut s1 = verifier_session(addr, "c1", "t1").await;
    assert_eq!(
        verifier_echo(&mut s1, 1, echo.port(), 40).await,
        (40, false),
        "40 out + 40 back fits 100"
    );
    let mut s2 = verifier_session(addr, "c1", "t2").await;
    let (echoed, reset) = verifier_echo(&mut s2, 1, echo.port(), 40).await;
    assert!(
        echoed == 0 && reset,
        "a second token of the same client shares its spent budget: echoed {echoed}, reset {reset}"
    );
    let mut s3 = verifier_session(addr, "c2", "t3").await;
    assert_eq!(
        verifier_echo(&mut s3, 1, echo.port(), 40).await,
        (40, false),
        "another client has its own budget"
    );
}

/// (E5-T43a round-4 verifier's test.) An idle close frees the client's place (the same exit path as a disconnect).
#[tokio::test]
async fn verifier_idle_close_frees_the_place() {
    let echo = spawn_echo().await;
    let addr = verifier_server(RelayLimits {
        session_idle_secs: 1,
        max_sessions_per_client: 1,
        ..RelayLimits::default()
    })
    .await;
    let mut a = verifier_session(addr, "c", "a").await;
    send_frame(
        &mut a,
        Frame::Open {
            stream: 1,
            host: "fixture.test".into(),
            port: echo.port(),
        },
    )
    .await;
    assert_eq!(recv_frame(&mut a).await, Frame::OpenOk { stream: 1 });
    let closed = timeout(Duration::from_secs(5), async {
        while let Some(m) = a.next().await {
            if m.is_err() || m.is_ok_and(|m| m.is_close()) {
                break;
            }
        }
    })
    .await;
    assert!(closed.is_ok(), "the idle session is closed");
    let mut b = verifier_session(addr, "c", "b").await;
    send_frame(
        &mut b,
        Frame::Open {
            stream: 1,
            host: "fixture.test".into(),
            port: echo.port(),
        },
    )
    .await;
    let got = timeout(Duration::from_secs(3), recv_frame(&mut b)).await;
    assert_eq!(
        got.ok(),
        Some(Frame::OpenOk { stream: 1 }),
        "the idle-closed session's place is free again"
    );
}

/// Traffic from the remote end alone keeps a session active: the idle limit counts both
/// directions (a mutant counting only the client's frames survived round 4).
#[tokio::test]
async fn outbound_traffic_alone_keeps_a_session_active() {
    // A backend that sends a byte every 250 ms for three seconds and never reads.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        if let Ok((mut sock, _)) = listener.accept().await {
            for _ in 0..12 {
                if sock.write_all(b"t").await.is_err() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
    let addr = verifier_server(RelayLimits {
        session_idle_secs: 1,
        ..RelayLimits::default()
    })
    .await;
    let mut s = verifier_session(addr, "c", "t").await;
    send_frame(
        &mut s,
        Frame::Open {
            stream: 1,
            host: "fixture.test".into(),
            port,
        },
    )
    .await;
    assert_eq!(recv_frame(&mut s).await, Frame::OpenOk { stream: 1 });
    send_frame(
        &mut s,
        Frame::Window {
            stream: 1,
            credit: 1 << 16,
        },
    )
    .await;
    // The client now only reads, for three seconds: the remote's bytes are the only traffic.
    let mut got = 0usize;
    let until = tokio::time::Instant::now() + Duration::from_secs(3);
    while tokio::time::Instant::now() < until {
        match timeout(Duration::from_millis(600), s.next()).await {
            Ok(Some(Ok(m))) if m.is_binary() => {
                if let Some(Frame::Data { bytes, .. }) = Frame::decode(&m.into_data()) {
                    got += bytes.len();
                }
            }
            Ok(Some(Ok(m))) if m.is_close() => {
                panic!("closed as idle while the remote was sending ({got} bytes in)")
            }
            Ok(None) | Ok(Some(Err(_))) => {
                panic!("dropped while the remote was sending ({got} bytes in)")
            }
            _ => {}
        }
    }
    assert!(got >= 8, "the remote's bytes arrived: {got}");
}
