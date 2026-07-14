//! E3-net slice 2b — END-TO-END native proof that the browser outbound path works through the REAL
//! ws-proxy protocol. A [`WsConnector`] (client) exchanges ws-proxy [`Frame`]s over an in-process
//! transport with a REAL [`RelayCore`] (the same server state machine the deployed tokio relay uses);
//! the relay drives real `std::net` sockets to a REAL echo server. The guest's bytes round-trip:
//! `WsConnector → HELLO/OPEN/DATA frames → RelayCore → real TCP socket → echo server → back`.
//!
//! No tokio, no browser, no real WebSocket — the transport is a pair of frame queues — but the ws-proxy
//! codec (handshake, open, bidirectional flow-control windows, data, half-close) and the RelayCore are
//! the REAL production code. The deployed relay's tokio socket driver is proven separately on `main`.

use std::cell::RefCell;
use std::collections::{BTreeMap, VecDeque};
use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::rc::Rc;
use std::time::Duration;

use wasm_vm_slirp::ws_proxy::{Frame, INITIAL_WINDOW, RelayActions, RelayCore, SocketOp};
use wasm_vm_slirp::{ConnStatus, FrameTransport, SyncConnector, WsConnector};

/// The shared frame queues between client and relay (stand-in for a WebSocket's two directions).
struct Shared {
    c2r: VecDeque<Frame>, // client → relay
    r2c: VecDeque<Frame>, // relay → client
    open: bool,
}

/// The client's [`FrameTransport`] over the shared queues.
struct ClientTransport {
    s: Rc<RefCell<Shared>>,
}
impl FrameTransport for ClientTransport {
    fn send(&mut self, f: Frame) {
        self.s.borrow_mut().c2r.push_back(f);
    }
    fn poll(&mut self) -> Vec<Frame> {
        self.s.borrow_mut().r2c.drain(..).collect()
    }
    fn is_open(&self) -> bool {
        self.s.borrow().open
    }
}

/// A minimal synchronous relay: drives a REAL [`RelayCore`] against real `std::net` sockets. Stands in
/// for the deployed tokio `RelayServer` (which is proven on `main`); the point here is that the
/// CLIENT (`WsConnector`) speaks the protocol correctly against the real server state machine.
struct RelayHarness {
    core: RelayCore,
    socks: BTreeMap<u32, TcpStream>,
    s: Rc<RefCell<Shared>>,
    hello_sent: bool,
}

impl RelayHarness {
    fn new(s: Rc<RefCell<Shared>>) -> Self {
        Self {
            core: RelayCore::new(),
            socks: BTreeMap::new(),
            s,
            hello_sent: false,
        }
    }

    fn push(&self, f: Frame) {
        self.s.borrow_mut().r2c.push_back(f);
    }

    fn apply(&mut self, a: RelayActions) {
        for f in a.ws_sends {
            self.push(f);
        }
        for op in a.socket_ops {
            match op {
                SocketOp::Connect { stream, host, port } => {
                    let addr = format!("{host}:{port}");
                    match TcpStream::connect(&addr) {
                        Ok(sock) => {
                            let _ = sock.set_nonblocking(true);
                            self.socks.insert(stream, sock);
                            if let Ok(a) = self.core.on_connect_result(stream, true) {
                                self.apply(a);
                            }
                        }
                        Err(_) => {
                            if let Ok(a) = self.core.on_connect_result(stream, false) {
                                self.apply(a);
                            }
                        }
                    }
                }
                SocketOp::Write { stream, bytes } => {
                    if let Some(sock) = self.socks.get_mut(&stream) {
                        let n = sock.write(&bytes).unwrap_or(0);
                        if let Ok(a) = self.core.on_backend_written(stream, n as u32) {
                            self.apply(a);
                        }
                    }
                }
                SocketOp::ShutdownWrite { stream } => {
                    if let Some(sock) = self.socks.get(&stream) {
                        let _ = sock.shutdown(Shutdown::Write);
                    }
                }
                SocketOp::Close { stream } => {
                    self.socks.remove(&stream);
                }
            }
        }
    }

    /// One servicing pass: send our HELLO once, consume inbound client frames, then read each backend
    /// socket up to the credit the client granted and forward the bytes.
    fn service(&mut self) {
        if !self.hello_sent {
            self.push(self.core.hello(Vec::new()));
            self.hello_sent = true;
        }
        let inbound: Vec<Frame> = self.s.borrow_mut().c2r.drain(..).collect();
        for f in inbound {
            if let Ok(a) = self.core.on_inbound_frame(f) {
                self.apply(a);
            }
        }
        // Backend → guest: read what the client's granted window allows.
        let streams: Vec<u32> = self.socks.keys().copied().collect();
        for st in streams {
            let credit = self.core.send_credit(st);
            if credit == 0 {
                continue;
            }
            let mut buf = vec![0u8; (credit as usize).min(16 * 1024)];
            let res = self.socks.get_mut(&st).map(|s| s.read(&mut buf));
            match res {
                Some(Ok(0)) => {
                    if let Ok(a) = self.core.on_socket_eof(st) {
                        self.apply(a);
                    }
                    self.socks.remove(&st);
                }
                Some(Ok(n)) => {
                    buf.truncate(n);
                    if let Ok(a) = self.core.on_socket_data(st, buf) {
                        self.apply(a);
                    }
                }
                Some(Err(ref e)) if e.kind() == ErrorKind::WouldBlock => {}
                Some(Err(_)) => {
                    if let Ok(a) = self.core.on_socket_error(st) {
                        self.apply(a);
                    }
                    self.socks.remove(&st);
                }
                None => {}
            }
        }
    }
}

/// A real TCP echo server on 127.0.0.1:0; echoes bytes until EOF. Returns the port.
fn spawn_echo_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind echo server");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        if let Ok((mut sock, _)) = listener.accept() {
            let mut buf = [0u8; 8192];
            loop {
                match sock.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if sock.write_all(&buf[..n]).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    });
    port
}

/// A server that reads to EOF then replies — proves the guest's half-close is tunnelled to the relay.
fn spawn_read_then_reply_server(reply: &'static [u8]) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind reply server");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        if let Ok((mut sock, _)) = listener.accept() {
            let mut sink = Vec::new();
            if sock.read_to_end(&mut sink).is_ok() {
                let _ = sock.write_all(reply);
            }
        }
    });
    port
}

fn new_pair(port: u16) -> (WsConnector<ClientTransport>, RelayHarness, u64) {
    let shared = Rc::new(RefCell::new(Shared {
        c2r: VecDeque::new(),
        r2c: VecDeque::new(),
        open: true,
    }));
    let mut client = WsConnector::new(ClientTransport { s: shared.clone() }, Vec::new());
    let relay = RelayHarness::new(shared);
    let conn = client.connect(Ipv4Addr::new(127, 0, 0, 1), port);
    (client, relay, conn)
}

#[test]
fn guest_tcp_round_trips_through_the_real_ws_proxy_relay() {
    let port = spawn_echo_server();
    let (mut client, mut relay, conn) = new_pair(port);

    const MSG: &[u8] = b"hello through the ws-proxy relay";
    let mut sent = false;
    let mut received: Vec<u8> = Vec::new();

    for step in 0..5000 {
        relay.service();
        if !sent && client.status(conn) == ConnStatus::Established {
            assert_eq!(client.send(conn, MSG), MSG.len());
            sent = true;
        }
        received.extend_from_slice(&client.recv(conn));
        if received.len() >= MSG.len() {
            break;
        }
        if step % 4 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    assert_eq!(
        received, MSG,
        "the guest's bytes must round-trip through the real RelayCore + a real echo socket"
    );
}

#[test]
fn refused_destination_fails_the_stream_through_the_relay() {
    // A port with nothing listening → the relay's connect fails → OPEN_FAIL → the client stream fails.
    let refused = {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let (mut client, mut relay, conn) = new_pair(refused);
    let mut failed = false;
    for step in 0..5000 {
        relay.service();
        if matches!(client.status(conn), ConnStatus::Failed(_)) {
            failed = true;
            break;
        }
        if step % 4 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    assert!(
        failed,
        "a refused outbound must surface to the client as a failed stream (OPEN_FAIL)"
    );
}

#[test]
fn bulk_download_flows_within_the_sliding_window() {
    // The relay→guest window is granted by the client and refilled as it drains — a larger-than-window
    // stream must arrive intact, exercising the client's `recv`-time window refill. `n` MUST exceed
    // INITIAL_WINDOW (critic MAJOR: at n == INITIAL_WINDOW the single initial grant covers the whole
    // download, so a broken refill passes vacuously — proven by mutation). 3× forces ≥2 refills.
    let n: usize = 3 * INITIAL_WINDOW as usize;
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind flood server");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        if let Ok((mut sock, _)) = listener.accept() {
            let payload: Vec<u8> = (0..n).map(|i| (i % 251) as u8).collect();
            let _ = sock.write_all(&payload);
        }
    });

    let (mut client, mut relay, conn) = new_pair(port);
    let mut received: Vec<u8> = Vec::new();
    for step in 0..1_000_000 {
        relay.service();
        let _ = client.status(conn);
        received.extend_from_slice(&client.recv(conn));
        if received.len() >= n {
            break;
        }
        if step % 8 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    assert_eq!(
        received.len(),
        n,
        "the whole stream must arrive (sliding window, no truncation)"
    );
    assert!(
        received
            .iter()
            .enumerate()
            .all(|(i, &b)| b == (i % 251) as u8),
        "the downloaded bytes must match the sent pattern exactly"
    );
}

#[test]
fn guest_half_close_is_tunnelled_so_a_read_then_reply_server_answers() {
    const REPLY: &[u8] = b"RELAY-SAW-EOF";
    let port = spawn_read_then_reply_server(REPLY);
    let (mut client, mut relay, conn) = new_pair(port);

    let mut done = false;
    let mut received: Vec<u8> = Vec::new();
    for step in 0..20_000 {
        relay.service();
        if !done && client.status(conn) == ConnStatus::Established {
            client.send(conn, b"request");
            client.shutdown_write(conn); // guest half-close → must reach the backend as EOF
            done = true;
        }
        received.extend_from_slice(&client.recv(conn));
        if received.len() >= REPLY.len() {
            break;
        }
        if step % 4 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    assert_eq!(
        received, REPLY,
        "the server replies only after EOF — receiving it proves the half-close was tunnelled"
    );
}

#[test]
fn stalled_relay_upload_queue_is_bounded_and_reports_backpressure() {
    let port = spawn_echo_server();
    let (mut client, mut relay, conn) = new_pair(port);

    // Complete HELLO + OPEN, including the relay's one INITIAL_WINDOW grant, then deliberately stop
    // servicing the relay. The first window can leave immediately; only one additional window may be
    // owned by the connector while the relay is stalled.
    for _ in 0..20 {
        relay.service();
        if client.status(conn) == ConnStatus::Established {
            break;
        }
    }
    assert_eq!(client.status(conn), ConnStatus::Established);

    let two_windows = vec![0x5a; 2 * INITIAL_WINDOW as usize];
    assert_eq!(
        client.send(conn, &two_windows),
        INITIAL_WINDOW as usize,
        "one bounded window is accepted per offer"
    );
    assert_eq!(
        client.send(conn, &two_windows),
        INITIAL_WINDOW as usize,
        "after the granted window leaves, one bounded pending window is accepted"
    );
    assert_eq!(
        client.send(conn, b"must backpressure"),
        0,
        "a stalled relay must close the caller-side window instead of growing the heap"
    );
    assert_eq!(
        client.buffered_bytes(),
        INITIAL_WINDOW as usize,
        "connector-owned bytes stay at the explicit per-flow cap"
    );
}
