//! E3-T19c — relay token rejection (deterministic, no live tailnet). Spawns the ACTUAL compiled
//! `wvrelay` binary with security enabled (HMAC secret + exact Origin allowlist) and drives it with a
//! REAL `tokio-tungstenite` client, proving REJECTION IS ENFORCED SERVER-SIDE — a direct WebSocket
//! attempt with an absent, expired, wrong-origin, or wrong-handshake-Origin credential is closed
//! before any OPEN succeeds, while a valid token opens the protected path. No tailnet, no wall-clock
//! flakiness: expiry is driven by a bounded token TTL, everything else is instantaneous.

use std::io::{BufRead, BufReader};
use std::net::SocketAddr;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;
use tokio_tungstenite::client_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use wasm_vm_slirp::ws_proxy::{Frame, hello, issue_relay_token};

type ClientWs = tokio_tungstenite::WebSocketStream<TcpStream>;

const SECRET: &[u8] = b"deterministic-relay-secret-32byte";
const ORIGIN: &str = "https://vm.example";

/// Kills the spawned relay on drop so a panicking assertion never leaks the process.
struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// A real TCP echo backend (tokio); returns its address. The secured relay only reaches it because
/// the test host-maps a name to it (development_allow), bypassing the public-destination gate.
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

/// Spawn the real `wvrelay` binary with security enabled (HMAC secret + Origin allowlist), an
/// ephemeral loopback bind, and a host map that lets the authenticated path reach `echo`. Blocks
/// until the readiness line, returns `(guard, addr)`.
fn spawn_secured_relay(echo: SocketAddr) -> (ChildGuard, SocketAddr) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_wvrelay"))
        .arg("127.0.0.1:0")
        .env("WVRELAY_HMAC_SECRET", std::str::from_utf8(SECRET).unwrap())
        .env("WVRELAY_ALLOWED_ORIGINS", ORIGIN)
        .env("WVRELAY_HOST_MAP", format!("echo={}", echo.ip()))
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn wvrelay");
    let stdout = child.stdout.take().expect("piped stdout");
    let mut reader = BufReader::new(stdout);
    // With security on, wvrelay prints the listening line then a "security enabled" line; read until
    // we see the address.
    let mut addr = None;
    let mut line = String::new();
    while reader.read_line(&mut line).unwrap_or(0) > 0 {
        if let Some(rest) = line.split("ws://").nth(1)
            && let Ok(a) = rest.trim().parse::<SocketAddr>()
        {
            addr = Some(a);
            break;
        }
        line.clear();
    }
    (
        ChildGuard(child),
        addr.expect("wvrelay never announced a listening address"),
    )
}

/// Open a WebSocket to the relay with a chosen `Origin` request header (what a browser sends and what
/// the server allowlists). Returns the upgraded stream, or the handshake error.
async fn connect_with_origin(
    relay: SocketAddr,
    origin: &str,
) -> Result<ClientWs, Box<dyn std::error::Error>> {
    let tcp = TcpStream::connect(relay).await?;
    let mut req = format!("ws://{relay}/").into_client_request()?;
    req.headers_mut().insert("origin", origin.parse()?);
    let (ws, _resp) = timeout(Duration::from_secs(10), client_async(req, tcp)).await??;
    Ok(ws)
}

async fn send_frame(ws: &mut ClientWs, f: Frame) {
    ws.send(Message::Binary(f.encode().unwrap())).await.unwrap();
}

/// Read the next decodable relay frame, or `None` if the stream closed/errored first (the server
/// dropping the connection). Bounded so a regression fails fast instead of hanging.
async fn next_frame(ws: &mut ClientWs) -> Option<Frame> {
    loop {
        match timeout(Duration::from_secs(5), ws.next()).await {
            Ok(Some(Ok(Message::Binary(b)))) => return Frame::decode(&b),
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) => return None,
            Ok(Some(Ok(_))) => continue, // ping/pong/text — ignore
            Err(_) => panic!("relay neither answered nor closed within the deadline"),
        }
    }
}

/// After a rejected credential, assert the server CLOSES the connection and NEVER grants an OPEN:
/// send a bad HELLO, then attempt an OPEN, and confirm no `OpenOk` is ever seen before EOF/close.
async fn assert_closed_before_open(mut ws: ClientWs) {
    // The server sends its own HELLO first (or, on a handshake-origin rejection, closes immediately).
    let _server_hello = next_frame(&mut ws).await; // Some(Hello) or None (already closed)
    // Try to open a protected stream anyway. If the send itself fails, the server has already closed
    // the connection — which is exactly the rejection we are proving.
    if ws
        .send(Message::Binary(
            Frame::Open {
                stream: 1,
                host: "echo".into(),
                port: 1,
            }
            .encode()
            .unwrap(),
        ))
        .await
        .is_err()
    {
        return; // connection already closed → no protected path
    }
    while let Some(frame) = next_frame(&mut ws).await {
        assert!(
            !matches!(frame, Frame::OpenOk { .. }),
            "server granted OPEN to an unauthenticated connection: {frame:?}"
        );
    }
    // next_frame returned None → the connection closed with no OpenOk. Server-side rejection proven.
}

/// AC2: a valid token is accepted and the protected path succeeds (OPEN → OPEN_OK through the relay).
#[tokio::test]
async fn valid_token_opens_the_protected_path() {
    let echo = spawn_echo().await;
    let (_relay, addr) = spawn_secured_relay(echo);
    let token = issue_relay_token(SECRET, now(), now() + 300, ORIGIN, "valid-id").unwrap();

    let mut ws = connect_with_origin(addr, ORIGIN).await.expect("handshake");
    assert!(
        matches!(next_frame(&mut ws).await, Some(Frame::Hello { .. })),
        "server HELLO"
    );
    send_frame(&mut ws, hello(token)).await;
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 1,
            host: "echo".into(),
            port: echo.port(),
        },
    )
    .await;
    assert_eq!(
        next_frame(&mut ws).await,
        Some(Frame::OpenOk { stream: 1 }),
        "a valid token must open the protected path"
    );
}

/// AC1 + AC3: an ABSENT token (empty HELLO) is closed server-side before OPEN.
#[tokio::test]
async fn absent_token_is_closed_before_open() {
    let echo = spawn_echo().await;
    let (_relay, addr) = spawn_secured_relay(echo);
    let mut ws = connect_with_origin(addr, ORIGIN).await.expect("handshake");
    let _ = next_frame(&mut ws).await; // server HELLO
    send_frame(&mut ws, hello(Vec::new())).await; // absent token
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 1,
            host: "echo".into(),
            port: echo.port(),
        },
    )
    .await;
    while let Some(frame) = next_frame(&mut ws).await {
        assert!(
            !matches!(frame, Frame::OpenOk { .. }),
            "absent token granted OPEN: {frame:?}"
        );
    }
}

/// AC1 + AC3: a WRONG-ORIGIN token (validly signed, but bound to a different origin than the
/// handshake presented) is closed server-side before OPEN.
#[tokio::test]
async fn wrong_origin_token_is_closed_before_open() {
    let echo = spawn_echo().await;
    let (_relay, addr) = spawn_secured_relay(echo);
    // Signed for evil.example, but the handshake Origin is the allowlisted vm.example → WrongOrigin.
    let token = issue_relay_token(SECRET, now(), now() + 300, "https://evil.example", "x").unwrap();
    let mut ws = connect_with_origin(addr, ORIGIN).await.expect("handshake");
    let _ = next_frame(&mut ws).await; // server HELLO
    send_frame(&mut ws, hello(token)).await;
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 1,
            host: "echo".into(),
            port: echo.port(),
        },
    )
    .await;
    while let Some(frame) = next_frame(&mut ws).await {
        assert!(
            !matches!(frame, Frame::OpenOk { .. }),
            "wrong-origin token granted OPEN: {frame:?}"
        );
    }
}

/// AC1 + AC3: an EXPIRED token is closed server-side before OPEN. Deterministic via a 1-second TTL
/// plus a short sleep — no live tailnet, no unbounded wait.
#[tokio::test]
async fn expired_token_is_closed_before_open() {
    let echo = spawn_echo().await;
    let (_relay, addr) = spawn_secured_relay(echo);
    // Minimum future expiry so issue succeeds, then let it lapse against the server's clock.
    let token = issue_relay_token(SECRET, now(), now() + 1, ORIGIN, "expiring").unwrap();
    tokio::time::sleep(Duration::from_secs(2)).await;
    let mut ws = connect_with_origin(addr, ORIGIN).await.expect("handshake");
    let _ = next_frame(&mut ws).await; // server HELLO
    send_frame(&mut ws, hello(token)).await;
    send_frame(
        &mut ws,
        Frame::Open {
            stream: 1,
            host: "echo".into(),
            port: echo.port(),
        },
    )
    .await;
    while let Some(frame) = next_frame(&mut ws).await {
        assert!(
            !matches!(frame, Frame::OpenOk { .. }),
            "expired token granted OPEN: {frame:?}"
        );
    }
}

/// AC1 + AC3: a disallowed HANDSHAKE Origin is rejected at the upgrade boundary — the server never
/// even sends its HELLO, and no OPEN is possible. (Origin-allowlist enforcement, server-side.)
#[tokio::test]
async fn disallowed_handshake_origin_is_rejected() {
    let echo = spawn_echo().await;
    let (_relay, addr) = spawn_secured_relay(echo);
    // A valid token would not help: the wrong handshake Origin is dropped before any frame.
    let ws = connect_with_origin(addr, "https://evil.example").await;
    // The upgrade may complete (101) but the server drops the connection immediately after; either a
    // handshake error or an immediately-closed stream is acceptable — what matters is NO protected path.
    if let Ok(ws) = ws {
        assert_closed_before_open(ws).await;
    }
}
