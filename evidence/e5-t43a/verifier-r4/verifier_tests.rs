// E5-T43a round-4 verifier: proposed tests, appended to crates/slirp/src/ws_proxy/ws_adapter_tests.rs in a
// SCRATCH clone only (never in the repository tree). They kill mutants W5, V6 and V1 (mutants.log).

async fn verifier_server(limits: RelayLimits) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(serve_secure_with_limits(
        listener,
        b"relay test secret".to_vec(),
        ["https://vm.example".to_owned()].into_iter().collect(),
        [("fixture.test".to_owned(), "127.0.0.1".to_owned())].into_iter().collect(),
        limits,
    ));
    addr
}

async fn verifier_session(addr: SocketAddr, client: &str, id: &str) -> ClientWs {
    let tcp = TcpStream::connect(addr).await.unwrap();
    let mut request = format!("ws://{addr}/").into_client_request().unwrap();
    request.headers_mut().insert(http::header::ORIGIN, http::HeaderValue::from_static("https://vm.example"));
    request.headers_mut().insert(super::CLIENT_HEADER, http::HeaderValue::from_str(client).unwrap());
    let (mut ws, _) = client_async(request, tcp).await.unwrap();
    assert!(matches!(recv_frame(&mut ws).await, Frame::Hello { .. }));
    ws.send(Message::Binary(hello_frame(id))).await.unwrap();
    ws
}

/// Echo `n` bytes on a fresh stream (credit granted); returns the bytes echoed before a RST/close/timeout.
async fn verifier_echo(ws: &mut ClientWs, stream: u32, port: u16, n: usize) -> (usize, bool) {
    send_frame(ws, Frame::Open { stream, host: "fixture.test".into(), port }).await;
    assert_eq!(recv_frame(ws).await, Frame::OpenOk { stream });
    send_frame(ws, Frame::Window { stream, credit: 1 << 16 }).await;
    send_frame(ws, Frame::Data { stream, bytes: vec![b'x'; n] }).await;
    let (mut echoed, mut reset) = (0usize, false);
    while echoed < n {
        match timeout(Duration::from_secs(2), ws.next()).await {
            Ok(Some(Ok(m))) if m.is_binary() => match Frame::decode(&m.into_data()) {
                Some(Frame::Data { bytes, .. }) => echoed += bytes.len(),
                Some(Frame::Rst { .. }) => { reset = true; break; }
                _ => {}
            },
            _ => break,
        }
    }
    (echoed, reset)
}

/// The hourly budget is the CLIENT's, shared by its tokens and sessions, and enforced on the wire.
#[tokio::test]
async fn verifier_hourly_bytes_are_per_client_across_tokens() {
    let echo = spawn_echo().await;
    let addr = verifier_server(RelayLimits { max_bytes_per_client_per_hour: 100, ..RelayLimits::default() }).await;
    let mut s1 = verifier_session(addr, "c1", "t1").await;
    assert_eq!(verifier_echo(&mut s1, 1, echo.port(), 40).await, (40, false), "40 out + 40 back fits 100");
    let mut s2 = verifier_session(addr, "c1", "t2").await;
    let (echoed, reset) = verifier_echo(&mut s2, 1, echo.port(), 40).await;
    assert!(echoed == 0 && reset, "a second token of the same client shares its spent budget: echoed {echoed}, reset {reset}");
    let mut s3 = verifier_session(addr, "c2", "t3").await;
    assert_eq!(verifier_echo(&mut s3, 1, echo.port(), 40).await, (40, false), "another client has its own budget");
}

/// An idle close frees the client's place (the same exit path as a disconnect).
#[tokio::test]
async fn verifier_idle_close_frees_the_place() {
    let echo = spawn_echo().await;
    let addr = verifier_server(RelayLimits { session_idle_secs: 1, max_sessions_per_client: 1, ..RelayLimits::default() }).await;
    let mut a = verifier_session(addr, "c", "a").await;
    send_frame(&mut a, Frame::Open { stream: 1, host: "fixture.test".into(), port: echo.port() }).await;
    assert_eq!(recv_frame(&mut a).await, Frame::OpenOk { stream: 1 });
    let closed = timeout(Duration::from_secs(5), async {
        while let Some(m) = a.next().await { if m.is_err() || m.is_ok_and(|m| m.is_close()) { break; } }
    }).await;
    assert!(closed.is_ok(), "the idle session is closed");
    let mut b = verifier_session(addr, "c", "b").await;
    send_frame(&mut b, Frame::Open { stream: 1, host: "fixture.test".into(), port: echo.port() }).await;
    let got = timeout(Duration::from_secs(3), recv_frame(&mut b)).await;
    assert_eq!(got.ok(), Some(Frame::OpenOk { stream: 1 }), "the idle-closed session's place is free again");
}
