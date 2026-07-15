//! E3-net slice 2a — END-TO-END native proof that a guest's TCP bytes reach a REAL outbound socket
//! through the SYNCHRONOUS backend (no tokio, no browser). A real smoltcp "guest" opens a TCP
//! connection to a REAL `std::net` echo server; every frame is shuttled through
//! [`SlirpLocalBackend::with_connector`] + [`StdConnector`]; the echo comes back out to the guest.
//! This is the sync sibling of `e2e_pump_stack.rs` (which proved the same round trip through the ASYNC
//! `Bridge`) — the path the browser's `WsConnector` (slice 2b) will drive with no code change to the
//! backend.
//!
//! The clock is a shared counter both sides read, advanced each shuttle step; a small real sleep lets
//! the connector's background connect thread + the echo server make progress (this test uses real OS
//! sockets + threads on purpose — it is the real-socket proof, not a mock).

use std::cell::Cell;
use std::collections::{BTreeSet, VecDeque};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, Shutdown, TcpListener};
use std::rc::Rc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::time::Instant as WallInstant;

use smoltcp::iface::{Config, Interface, SocketSet};
use smoltcp::phy::{Device, DeviceCapabilities, Medium, RxToken, TxToken};
use smoltcp::socket::tcp;
use smoltcp::time::Instant;
use smoltcp::wire::{
    EthernetAddress, EthernetFrame, HardwareAddress, IpAddress, IpCidr, Ipv4Address,
};

use wasm_vm_core::dev::virtio::net::NetBackend;
use wasm_vm_slirp::{ConnId, ConnStatus, SlirpLocalBackend, StdConnector, SyncConnector};

/// Delegates to the real socket connector while exposing its live-id set, so expiry tests can prove
/// the guest segment, NAT entry, and outbound resource all disappear together.
struct CountingConnector {
    inner: StdConnector,
    live: Arc<Mutex<BTreeSet<ConnId>>>,
}

impl CountingConnector {
    fn new(live: Arc<Mutex<BTreeSet<ConnId>>>) -> Self {
        Self {
            inner: StdConnector::new(),
            live,
        }
    }
}

impl SyncConnector for CountingConnector {
    fn connect(&mut self, host: Ipv4Addr, port: u16) -> ConnId {
        let id = self.inner.connect(host, port);
        self.live.lock().unwrap().insert(id);
        id
    }

    fn status(&mut self, id: ConnId) -> ConnStatus {
        self.inner.status(id)
    }

    fn recv(&mut self, id: ConnId) -> Vec<u8> {
        self.inner.recv(id)
    }

    fn send(&mut self, id: ConnId, data: &[u8]) -> usize {
        self.inner.send(id, data)
    }

    fn shutdown_write(&mut self, id: ConnId) {
        self.inner.shutdown_write(id);
    }

    fn buffered_bytes(&self) -> usize {
        self.inner.buffered_bytes()
    }

    fn close(&mut self, id: ConnId) {
        self.inner.close(id);
        self.live.lock().unwrap().remove(&id);
    }
}

#[derive(Default)]
struct OneByteProbe {
    upload_exact: Cell<bool>,
    uploaded: Cell<usize>,
    downloaded: Cell<usize>,
    max_delivery: Cell<usize>,
    shutdowns: Cell<usize>,
    closes: Cell<usize>,
}

/// Deterministic adversarial connector: the upload is independently checked byte-for-byte, while
/// every remote→guest delivery contains exactly one byte. It owns no large body buffer.
struct OneBytePatternConnector {
    probe: Rc<OneByteProbe>,
    total: usize,
    upload_offset: usize,
    download_offset: usize,
    connected: bool,
    shutdown: bool,
}

impl OneBytePatternConnector {
    fn new(total: usize, probe: Rc<OneByteProbe>) -> Self {
        probe.upload_exact.set(true);
        Self {
            probe,
            total,
            upload_offset: 0,
            download_offset: 0,
            connected: false,
            shutdown: false,
        }
    }

    fn next_download_byte(&mut self) -> Option<u8> {
        if !self.connected || self.download_offset >= self.total {
            return None;
        }
        let byte = stream_pat(17, self.download_offset);
        self.download_offset += 1;
        self.probe.max_delivery.set(1);
        Some(byte)
    }
}

impl Drop for OneBytePatternConnector {
    fn drop(&mut self) {
        self.probe.uploaded.set(self.upload_offset);
        self.probe.downloaded.set(self.download_offset);
    }
}

impl SyncConnector for OneBytePatternConnector {
    fn connect(&mut self, _host: Ipv4Addr, _port: u16) -> ConnId {
        self.connected = true;
        0
    }

    fn status(&mut self, id: ConnId) -> ConnStatus {
        if id != 0 || !self.connected {
            ConnStatus::Failed(wasm_vm_slirp::ConnectError::Unreachable)
        } else if self.download_offset == self.total && self.shutdown {
            ConnStatus::Closed
        } else {
            ConnStatus::Established
        }
    }

    fn recv(&mut self, id: ConnId) -> Vec<u8> {
        if id != 0 {
            return Vec::new();
        }
        self.next_download_byte().into_iter().collect()
    }

    fn recv_into(&mut self, id: ConnId, out: &mut Vec<u8>) -> usize {
        if id != 0 {
            return 0;
        }
        let Some(byte) = self.next_download_byte() else {
            return 0;
        };
        out.push(byte);
        1
    }

    fn send(&mut self, id: ConnId, data: &[u8]) -> usize {
        if id != 0 || !self.connected {
            return 0;
        }
        let accepted = data
            .len()
            .min(self.total.saturating_sub(self.upload_offset));
        if !data[..accepted]
            .iter()
            .enumerate()
            .all(|(i, &byte)| byte == stream_pat(83, self.upload_offset + i))
        {
            self.probe.upload_exact.set(false);
        }
        self.upload_offset += accepted;
        accepted
    }

    fn shutdown_write(&mut self, id: ConnId) {
        if id == 0 && !self.shutdown {
            self.shutdown = true;
            self.probe.shutdowns.set(self.probe.shutdowns.get() + 1);
        }
    }

    fn close(&mut self, id: ConnId) {
        if id == 0 && self.connected {
            self.connected = false;
            self.probe.closes.set(self.probe.closes.get() + 1);
        }
    }
}

/// A queue-backed guest ethernet device (mirrors the crate's `SlirpDevice`, but with public queues so
/// the shuttle loop can move frames): `rx` = frames FROM the backend (guest consumes), `tx` = frames
/// the guest emits (shuttled TO the backend).
struct GuestDevice {
    rx: VecDeque<Vec<u8>>,
    tx: VecDeque<Vec<u8>>,
}
struct GRx(Vec<u8>);
struct GTx<'a>(&'a mut VecDeque<Vec<u8>>);
impl RxToken for GRx {
    fn consume<R, F: FnOnce(&[u8]) -> R>(self, f: F) -> R {
        f(&self.0)
    }
}
impl TxToken for GTx<'_> {
    fn consume<R, F: FnOnce(&mut [u8]) -> R>(self, len: usize, f: F) -> R {
        let mut buf = vec![0u8; len];
        let r = f(&mut buf);
        self.0.push_back(buf);
        r
    }
}
impl Device for GuestDevice {
    type RxToken<'a> = GRx;
    type TxToken<'a> = GTx<'a>;
    fn receive(&mut self, _t: Instant) -> Option<(Self::RxToken<'_>, Self::TxToken<'_>)> {
        let f = self.rx.pop_front()?;
        Some((GRx(f), GTx(&mut self.tx)))
    }
    fn transmit(&mut self, _t: Instant) -> Option<Self::TxToken<'_>> {
        Some(GTx(&mut self.tx))
    }
    fn capabilities(&self) -> DeviceCapabilities {
        let mut c = DeviceCapabilities::default();
        c.medium = Medium::Ethernet;
        c.max_transmission_unit = 1500 + EthernetFrame::<&[u8]>::header_len();
        c
    }
}

const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x02];
const LOCAL_PORT: u16 = 49152;

/// Spawn a real TCP echo server on `127.0.0.1:0`; returns the bound port. It accepts one connection and
/// echoes bytes until EOF, then echoes-back the remaining and closes.
fn spawn_echo_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind echo server");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        if let Ok((mut sock, _)) = listener.accept() {
            let mut buf = [0u8; 4096];
            loop {
                match sock.read(&mut buf) {
                    Ok(0) => break, // client half-closed
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

/// A real smoltcp guest: an [`Interface`] with a static `10.0.2.15/24` + default route to the gateway,
/// over a [`SlirpDevice`] whose queues we shuttle to/from the backend.
struct Guest {
    iface: Interface,
    dev: GuestDevice,
    sockets: SocketSet<'static>,
    tcp: smoltcp::iface::SocketHandle,
}

impl Guest {
    fn new(clock: &Arc<AtomicI64>) -> Self {
        let mut dev = GuestDevice {
            rx: VecDeque::new(),
            tx: VecDeque::new(),
        };
        let cfg = Config::new(HardwareAddress::Ethernet(EthernetAddress(GUEST_MAC)));
        let mut iface = Interface::new(cfg, &mut dev, now(clock));
        iface.update_ip_addrs(|addrs| {
            addrs
                .push(IpCidr::new(IpAddress::v4(10, 0, 2, 15), 24))
                .unwrap();
        });
        iface
            .routes_mut()
            .add_default_ipv4_route(Ipv4Address::new(10, 0, 2, 2))
            .unwrap();
        let tcp_sock = tcp::Socket::new(
            tcp::SocketBuffer::new(vec![0u8; 64 * 1024]),
            tcp::SocketBuffer::new(vec![0u8; 64 * 1024]),
        );
        let mut sockets = SocketSet::new(vec![]);
        let tcp = sockets.add(tcp_sock);
        Guest {
            iface,
            dev,
            sockets,
            tcp,
        }
    }

    /// Start connecting to `remote:port` (from `LOCAL_PORT`).
    fn connect(&mut self, remote: Ipv4Addr, port: u16) {
        self.connect_socket(self.tcp, remote, port, LOCAL_PORT);
    }

    fn add_tcp_socket(&mut self) -> smoltcp::iface::SocketHandle {
        self.sockets.add(tcp::Socket::new(
            tcp::SocketBuffer::new(vec![0u8; 64 * 1024]),
            tcp::SocketBuffer::new(vec![0u8; 64 * 1024]),
        ))
    }

    fn connect_socket(
        &mut self,
        handle: smoltcp::iface::SocketHandle,
        remote: Ipv4Addr,
        port: u16,
        local_port: u16,
    ) {
        let sock = self.sockets.get_mut::<tcp::Socket>(handle);
        sock.connect(
            self.iface.context(),
            (IpAddress::Ipv4(remote), port),
            local_port,
        )
        .expect("guest connect");
    }

    fn poll(&mut self, clock: &Arc<AtomicI64>) {
        self.iface
            .poll(now(clock), &mut self.dev, &mut self.sockets);
    }

    fn socket(&mut self) -> &mut tcp::Socket<'static> {
        self.sockets.get_mut::<tcp::Socket>(self.tcp)
    }

    fn socket_by(&mut self, handle: smoltcp::iface::SocketHandle) -> &mut tcp::Socket<'static> {
        self.sockets.get_mut::<tcp::Socket>(handle)
    }
}

fn now(clock: &Arc<AtomicI64>) -> Instant {
    Instant::from_millis(clock.load(Ordering::SeqCst))
}

/// Move every frame the guest emitted into the backend, and every frame the backend produced into the
/// guest — one shuttle step.
fn shuttle(guest: &mut Guest, backend: &mut SlirpLocalBackend) {
    while let Some(frame) = guest.dev.tx.pop_front() {
        backend.tx(&frame);
    }
    while let Some(frame) = backend.rx() {
        guest.dev.rx.push_back(frame);
    }
}

#[test]
fn guest_tcp_reaches_a_real_echo_server_through_the_sync_backend() {
    let port = spawn_echo_server();
    let clock = Arc::new(AtomicI64::new(0));
    let clk = clock.clone();
    let mut backend = SlirpLocalBackend::with_connector(
        GW_MAC,
        Box::new(move || clk.load(Ordering::SeqCst)),
        Box::new(StdConnector::new()),
    );
    let mut guest = Guest::new(&clock);

    // The guest dials the (loopback) echo server. Its default route sends the SYN to the gateway MAC;
    // the backend NAT-classifies it as a new outbound flow and dials the real socket.
    guest.connect(Ipv4Addr::new(127, 0, 0, 1), port);

    const MSG: &[u8] = b"hello slirp sync outbound";
    let mut sent = false;
    let mut received: Vec<u8> = Vec::new();

    for step in 0..5000 {
        clock.fetch_add(5, Ordering::SeqCst); // advance the shared clock (ms)
        guest.poll(&clock);
        shuttle(&mut guest, &mut backend);
        guest.poll(&clock);

        // Once established, send the message exactly once.
        if !sent && guest.socket().may_send() && guest.socket().can_send() {
            let n = guest.socket().send_slice(MSG).unwrap();
            assert_eq!(
                n,
                MSG.len(),
                "guest send buffer should accept the whole message"
            );
            sent = true;
        }
        // Drain whatever the echo brought back.
        if guest.socket().can_recv() {
            let chunk = guest
                .socket()
                .recv(|b| {
                    let v = b.to_vec();
                    (v.len(), v)
                })
                .unwrap();
            received.extend_from_slice(&chunk);
        }
        if received.len() >= MSG.len() {
            break;
        }
        // Let the connector's connect thread + the echo server make real progress.
        if step % 4 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    assert_eq!(
        received, MSG,
        "the guest must receive its bytes echoed back through the real outbound socket"
    );
}

fn flow_payload(flow: usize, len: usize) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(len);
    bytes.extend_from_slice(&(flow as u16).to_be_bytes());
    bytes.extend((2..len).map(|offset| ((flow * 37 + offset) % 251) as u8));
    bytes
}

/// One listener, many simultaneous connections. Each accepted socket verifies a flow-specific body
/// before echoing it, so the server independently detects cross-flow bleed (not merely the guest).
fn spawn_pattern_echo_server(
    flows: usize,
    bytes_per_flow: usize,
) -> (u16, Receiver<(usize, bool)>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind concurrent echo server");
    let port = listener.local_addr().unwrap().port();
    let (result_tx, result_rx) = mpsc::channel();
    std::thread::spawn(move || {
        for _ in 0..flows {
            let Ok((mut sock, _)) = listener.accept() else {
                break;
            };
            let tx = result_tx.clone();
            std::thread::spawn(move || {
                let mut body = vec![0u8; bytes_per_flow];
                let ok = sock.read_exact(&mut body).is_ok();
                let flow = body
                    .get(..2)
                    .and_then(|b| <[u8; 2]>::try_from(b).ok())
                    .map_or(usize::MAX, |b| u16::from_be_bytes(b) as usize);
                let exact = ok && flow < flows && body == flow_payload(flow, bytes_per_flow);
                if exact {
                    let _ = sock.write_all(&body);
                }
                let _ = tx.send((flow, exact));
            });
        }
    });
    (port, result_rx)
}

#[test]
fn fifty_concurrent_guest_connections_complete_without_cross_flow_bleed() {
    const FLOWS: usize = 50;
    const BYTES_PER_FLOW: usize = 4096;
    let (port, server_results) = spawn_pattern_echo_server(FLOWS, BYTES_PER_FLOW);
    let clock = Arc::new(AtomicI64::new(0));
    let clk = clock.clone();
    let mut backend = SlirpLocalBackend::with_connector(
        GW_MAC,
        Box::new(move || clk.load(Ordering::SeqCst)),
        Box::new(StdConnector::new()),
    );
    let mut guest = Guest::new(&clock);

    let mut handles = vec![guest.tcp];
    handles.extend((1..FLOWS).map(|_| guest.add_tcp_socket()));
    for (flow, &handle) in handles.iter().enumerate() {
        guest.connect_socket(
            handle,
            Ipv4Addr::new(127, 0, 0, 1),
            port,
            40_000 + flow as u16,
        );
    }

    let expected: Vec<Vec<u8>> = (0..FLOWS)
        .map(|flow| flow_payload(flow, BYTES_PER_FLOW))
        .collect();
    let mut sent = [false; FLOWS];
    let mut received = vec![Vec::new(); FLOWS];
    let mut peak_flows = 0;

    for step in 0..200_000 {
        clock.fetch_add(2, Ordering::SeqCst);
        guest.poll(&clock);
        shuttle(&mut guest, &mut backend);
        guest.poll(&clock);
        peak_flows = peak_flows.max(backend.flow_count());

        for (flow, &handle) in handles.iter().enumerate() {
            let socket = guest.socket_by(handle);
            if !sent[flow] && socket.may_send() && socket.can_send() {
                let n = socket.send_slice(&expected[flow]).unwrap();
                assert_eq!(n, expected[flow].len());
                sent[flow] = true;
            }
            if socket.can_recv() {
                let chunk = socket
                    .recv(|bytes| {
                        let out = bytes.to_vec();
                        (out.len(), out)
                    })
                    .unwrap();
                received[flow].extend_from_slice(&chunk);
            }
        }

        if received
            .iter()
            .zip(&expected)
            .all(|(actual, expected)| actual.len() >= expected.len())
        {
            break;
        }
        if step % 16 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    assert_eq!(peak_flows, FLOWS, "all {FLOWS} NAT flows must coexist");
    for flow in 0..FLOWS {
        assert_eq!(
            received[flow].len(),
            expected[flow].len(),
            "flow {flow} was truncated"
        );
        assert_eq!(
            received[flow], expected[flow],
            "flow {flow} received another flow's bytes"
        );
    }
    let mut server_seen = vec![false; FLOWS];
    for _ in 0..FLOWS {
        let (flow, exact) = server_results
            .recv_timeout(Duration::from_secs(5))
            .expect("server must verify every concurrent connection");
        assert!(exact, "server saw corrupt/cross-flow bytes for flow {flow}");
        assert!(!server_seen[flow], "server saw flow {flow} twice");
        server_seen[flow] = true;
    }
    assert!(server_seen.into_iter().all(|seen| seen));
}

#[test]
fn guest_syn_to_a_refused_port_gets_reset_not_hung() {
    // A port with nothing listening: the connector's connect fails (ECONNREFUSED). The backend must
    // surface that to the guest as a reset — the guest connection must NOT hang half-open forever.
    let refused_port = {
        // Bind then drop to obtain a port that is (almost certainly) not listening.
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let clock = Arc::new(AtomicI64::new(0));
    let clk = clock.clone();
    let mut backend = SlirpLocalBackend::with_connector(
        GW_MAC,
        Box::new(move || clk.load(Ordering::SeqCst)),
        Box::new(StdConnector::new()),
    );
    let mut guest = Guest::new(&clock);
    guest.connect(Ipv4Addr::new(127, 0, 0, 1), refused_port);

    let mut reset = false;
    for step in 0..5000 {
        clock.fetch_add(5, Ordering::SeqCst);
        guest.poll(&clock);
        shuttle(&mut guest, &mut backend);
        guest.poll(&clock);
        // The guest socket leaves the connection (RST → not active / not open) after the refusal.
        let s = guest.socket();
        if !s.is_active() && !s.is_open() {
            reset = true;
            break;
        }
        if step % 4 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    assert!(
        reset,
        "a guest SYN to a refused destination must be reset, not left hanging half-open"
    );
}

#[test]
fn sync_tcp_idle_expiry_resets_the_guest_and_closes_the_real_connector() {
    let port = spawn_echo_server();
    let clock = Arc::new(AtomicI64::new(0));
    let clk = clock.clone();
    let live = Arc::new(Mutex::new(BTreeSet::new()));
    let mut backend = SlirpLocalBackend::with_connector(
        GW_MAC,
        Box::new(move || clk.load(Ordering::SeqCst)),
        Box::new(CountingConnector::new(live.clone())),
    );
    let mut guest = Guest::new(&clock);
    guest.connect(Ipv4Addr::LOCALHOST, port);

    for step in 0..5000 {
        clock.fetch_add(5, Ordering::SeqCst);
        guest.poll(&clock);
        shuttle(&mut guest, &mut backend);
        guest.poll(&clock);
        if guest.socket().state() == tcp::State::Established {
            break;
        }
        if step % 4 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    assert_eq!(guest.socket().state(), tcp::State::Established);
    assert_eq!(backend.flow_count(), 1);
    assert_eq!(live.lock().unwrap().len(), 1);

    clock.fetch_add(
        i64::try_from(wasm_vm_slirp::nat::TCP_IDLE_MS).unwrap() + 1,
        Ordering::SeqCst,
    );
    backend.poll();
    shuttle(&mut guest, &mut backend);
    guest.poll(&clock);

    assert_eq!(
        guest.socket().state(),
        tcp::State::Closed,
        "the exact idle-deadline segment must reset the guest, not leave it established or FIN-close"
    );
    assert_eq!(backend.flow_count(), 0, "the NAT entry was reaped");
    assert!(
        live.lock().unwrap().is_empty(),
        "the real outbound connector was closed with the expired flow"
    );
}

/// The no-connector constructor keeps slice-1 behaviour: a guest SYN to a non-local IP produces no
/// outbound flow (and no panic) — the frame is simply filtered by the stack.
#[test]
fn no_connector_means_no_outbound_and_no_panic() {
    let clock = Arc::new(AtomicI64::new(0));
    let clk = clock.clone();
    let mut backend = SlirpLocalBackend::new(GW_MAC, Box::new(move || clk.load(Ordering::SeqCst)));
    let mut guest = Guest::new(&clock);
    guest.connect(Ipv4Addr::new(93, 184, 216, 34), 80);
    let mut established_ever = false;
    for _ in 0..200 {
        clock.fetch_add(5, Ordering::SeqCst);
        guest.poll(&clock);
        shuttle(&mut guest, &mut backend);
        guest.poll(&clock);
        // Its SYN is filtered (no listening endpoint was opened), so the guest keeps retransmitting in
        // SynSent — `is_active()` stays true — but it must NEVER reach Established.
        if guest.socket().state() == tcp::State::Established {
            established_ever = true;
        }
    }
    assert!(
        !established_ever,
        "without a connector there is no outbound path, so the flow cannot establish"
    );
}

/// A deterministic byte at stream offset `i` — lets a bulk test verify integrity, not just length.
fn pat(i: usize) -> u8 {
    (i % 251) as u8 // 251 is prime → the pattern doesn't align to any power-of-two buffer boundary.
}

/// Spawn a server that, on connect, floods `n` deterministic bytes then closes. Returns the port.
fn spawn_flood_server(n: usize) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind flood server");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        if let Ok((mut sock, _)) = listener.accept() {
            let payload: Vec<u8> = (0..n).map(pat).collect();
            let _ = sock.write_all(&payload); // blocks until the client drains — real backpressure
        }
    });
    port
}

/// REGRESSION (critic DEFECT 1): a bulk download must not be silently truncated when the guest drains
/// slower than the remote floods. Before the `pending_in` fix, `tcp_send`'s unaccepted tail was
/// dropped once the guest-facing 64 KiB tx buffer filled, so the guest received only ~128 KiB of a
/// 512 KiB stream.
#[test]
fn bulk_download_is_not_truncated_under_backpressure() {
    const N: usize = 512 * 1024;
    let port = spawn_flood_server(N);
    let clock = Arc::new(AtomicI64::new(0));
    let clk = clock.clone();
    let mut backend = SlirpLocalBackend::with_connector(
        GW_MAC,
        Box::new(move || clk.load(Ordering::SeqCst)),
        Box::new(StdConnector::new()),
    );
    let mut guest = Guest::new(&clock);
    guest.connect(Ipv4Addr::new(127, 0, 0, 1), port);

    let mut received: Vec<u8> = Vec::new();
    for step in 0..200_000 {
        clock.fetch_add(5, Ordering::SeqCst);
        guest.poll(&clock);
        shuttle(&mut guest, &mut backend);
        guest.poll(&clock);
        // Drain a bounded amount per pass so the guest rx window fills and backpressure is real.
        if guest.socket().can_recv() {
            let chunk = guest
                .socket()
                .recv(|b| {
                    let take = b.len().min(4096);
                    (take, b[..take].to_vec())
                })
                .unwrap();
            received.extend_from_slice(&chunk);
        }
        if received.len() >= N {
            break;
        }
        if step % 8 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    assert_eq!(
        received.len(),
        N,
        "the whole stream must arrive — no silent truncation"
    );
    assert!(
        received.iter().enumerate().all(|(i, &b)| b == pat(i)),
        "the received bytes must match the sent pattern exactly (no corruption/reorder)"
    );
}

/// Spawn a server that reads until EOF, then replies `REPLY` and closes. It only replies AFTER it sees
/// the client's half-close — so the reply proves the guest's FIN was forwarded to the remote.
fn spawn_read_then_reply_server(reply: &'static [u8]) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind reply server");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        if let Ok((mut sock, _)) = listener.accept() {
            let mut sink = Vec::new();
            // read_to_end returns only once the peer's write side closes (FIN → EOF).
            if sock.read_to_end(&mut sink).is_ok() {
                let _ = sock.write_all(reply);
            }
        }
    });
    port
}

/// REGRESSION (critic DEFECT 2): a guest half-close (FIN) must be forwarded to the remote. Before the
/// `status == Established` guard fix, the FIN-forward branch latched during the optimistic-accept
/// window (socket in SynReceived → `may_recv()` already false) and no-op'd on the still-connecting
/// conn, so the guest's real FIN never reached the server and a read-then-reply server hung.
#[test]
fn guest_half_close_is_forwarded_so_a_read_then_reply_server_answers() {
    const REPLY: &[u8] = b"SERVER-SAW-EOF";
    let port = spawn_read_then_reply_server(REPLY);
    let clock = Arc::new(AtomicI64::new(0));
    let clk = clock.clone();
    let mut backend = SlirpLocalBackend::with_connector(
        GW_MAC,
        Box::new(move || clk.load(Ordering::SeqCst)),
        Box::new(StdConnector::new()),
    );
    let mut guest = Guest::new(&clock);
    guest.connect(Ipv4Addr::new(127, 0, 0, 1), port);

    let mut sent_and_closed = false;
    let mut received: Vec<u8> = Vec::new();
    for step in 0..20_000 {
        clock.fetch_add(5, Ordering::SeqCst);
        guest.poll(&clock);
        shuttle(&mut guest, &mut backend);
        guest.poll(&clock);

        // Once established: send a request, then half-close (guest FIN).
        if !sent_and_closed && guest.socket().may_send() {
            guest.socket().send_slice(b"please").unwrap();
            guest.socket().close(); // active close → FIN on the guest's write side
            sent_and_closed = true;
        }
        if guest.socket().can_recv() {
            let chunk = guest
                .socket()
                .recv(|b| {
                    let v = b.to_vec();
                    (v.len(), v)
                })
                .unwrap();
            received.extend_from_slice(&chunk);
        }
        if received.len() >= REPLY.len() {
            break;
        }
        if step % 4 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    assert_eq!(
        received, REPLY,
        "the server only replies after EOF — receiving the reply proves the guest FIN was forwarded"
    );
}

fn stream_pat(seed: usize, offset: usize) -> u8 {
    ((seed + offset * 131) % 251) as u8
}

fn spawn_full_duplex_pattern_server(bytes_each_way: usize) -> (u16, Receiver<bool>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind full-duplex server");
    let port = listener.local_addr().unwrap().port();
    let (result_tx, result_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let Ok((mut reader, _)) = listener.accept() else {
            let _ = result_tx.send(false);
            return;
        };
        let mut writer = reader.try_clone().expect("clone full-duplex socket");
        let writer_thread = std::thread::spawn(move || {
            let mut offset = 0usize;
            let mut chunk = vec![0u8; 64 * 1024];
            while offset < bytes_each_way {
                let n = chunk.len().min(bytes_each_way - offset);
                for (i, byte) in chunk[..n].iter_mut().enumerate() {
                    *byte = stream_pat(17, offset + i);
                }
                if writer.write_all(&chunk[..n]).is_err() {
                    return false;
                }
                offset += n;
            }
            writer.shutdown(Shutdown::Write).is_ok()
        });

        let mut exact = true;
        let mut offset = 0usize;
        let mut chunk = vec![0u8; 64 * 1024];
        while offset < bytes_each_way {
            match reader.read(&mut chunk) {
                Ok(0) => {
                    exact = false;
                    break;
                }
                Ok(n) => {
                    exact &= chunk[..n]
                        .iter()
                        .enumerate()
                        .all(|(i, &byte)| byte == stream_pat(83, offset + i));
                    offset += n;
                }
                Err(_) => {
                    exact = false;
                    break;
                }
            }
        }
        exact &= offset == bytes_each_way;
        exact &= writer_thread.join().unwrap_or(false);
        let _ = result_tx.send(exact);
    });
    (port, result_rx)
}

#[cfg(unix)]
fn peak_rss_bytes() -> u64 {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: `usage` points to writable storage for exactly one `rusage`; getrusage initializes it
    // on success, which is asserted before assume_init.
    let rc = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    assert_eq!(rc, 0, "getrusage must succeed for the RSS acceptance");
    // SAFETY: the successful getrusage call initialized the structure.
    let usage = unsafe { usage.assume_init() };
    #[cfg(target_os = "macos")]
    {
        usage.ru_maxrss as u64 // bytes on macOS
    }
    #[cfg(not(target_os = "macos"))]
    {
        (usage.ru_maxrss as u64).saturating_mul(1024) // KiB on Linux/BSD
    }
}

#[cfg(not(unix))]
fn peak_rss_bytes() -> u64 {
    0
}

#[test]
fn hundred_mebibytes_each_way_are_exact_with_bounded_memory() {
    const N: usize = 100 * 1024 * 1024;
    const MAX_USER_QUEUES: usize = 512 * 1024;
    const MAX_RSS_DELTA: u64 = 64 * 1024 * 1024;

    let rss_before = peak_rss_bytes();
    let (port, server_result) = spawn_full_duplex_pattern_server(N);
    let clock = Arc::new(AtomicI64::new(0));
    let clk = clock.clone();
    let mut backend = SlirpLocalBackend::with_connector(
        GW_MAC,
        Box::new(move || clk.load(Ordering::SeqCst)),
        Box::new(StdConnector::new()),
    );
    let mut guest = Guest::new(&clock);
    guest.connect(Ipv4Addr::new(127, 0, 0, 1), port);

    let mut upload_offset = 0usize;
    let mut download_offset = 0usize;
    let mut guest_half_closed = false;
    let mut peak_buffered = 0usize;
    let mut server_exact = None;

    for step in 0..2_000_000 {
        clock.fetch_add(1, Ordering::SeqCst);
        guest.poll(&clock);
        shuttle(&mut guest, &mut backend);
        guest.poll(&clock);
        peak_buffered = peak_buffered.max(backend.buffered_bytes());

        let socket = guest.socket();
        if upload_offset < N && socket.may_send() && socket.can_send() {
            let want = (16 * 1024).min(N - upload_offset);
            let chunk: Vec<u8> = (0..want)
                .map(|i| stream_pat(83, upload_offset + i))
                .collect();
            let accepted = socket.send_slice(&chunk).unwrap();
            upload_offset += accepted;
        }
        if upload_offset == N && !guest_half_closed {
            socket.close();
            guest_half_closed = true;
        }
        if socket.can_recv() {
            let chunk = socket
                .recv(|bytes| {
                    let out = bytes.to_vec();
                    (out.len(), out)
                })
                .unwrap();
            assert!(
                chunk
                    .iter()
                    .enumerate()
                    .all(|(i, &byte)| byte == stream_pat(17, download_offset + i)),
                "download bytes diverged at offset {download_offset}"
            );
            download_offset += chunk.len();
        }

        if server_exact.is_none() {
            server_exact = server_result.try_recv().ok();
        }
        if upload_offset == N && download_offset == N && server_exact.is_some() {
            break;
        }
        if step % 128 == 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    assert_eq!(upload_offset, N, "guest→server transfer was truncated");
    assert_eq!(download_offset, N, "server→guest transfer was truncated");
    assert_eq!(
        server_exact,
        Some(true),
        "the server must independently verify every uploaded byte"
    );
    assert!(
        peak_buffered <= MAX_USER_QUEUES,
        "100 MiB transfer queued {peak_buffered} bytes in user space (cap {MAX_USER_QUEUES})"
    );
    let rss_delta = peak_rss_bytes().saturating_sub(rss_before);
    assert!(
        rss_delta <= MAX_RSS_DELTA,
        "streaming 200 MiB raised peak RSS by {rss_delta} bytes (budget {MAX_RSS_DELTA})"
    );
}

#[test]
fn hundred_mebibytes_each_way_survive_one_byte_connector_deliveries_in_linear_time() {
    const N: usize = 100 * 1024 * 1024;
    const MAX_USER_QUEUES: usize = 128 * 1024;
    // Focused debug run: ~84 s on the worker Mac. `cargo test --workspace` runs this beside the
    // original real-socket 200 MiB test and measured ~127 s under that CPU contention, so keep a
    // deterministic 180 s ceiling: comfortably linear, but still tight enough to catch quadratic
    // staging/copy behavior.
    const MAX_ELAPSED: Duration = Duration::from_secs(180);

    let probe = Rc::new(OneByteProbe::default());
    let clock = Arc::new(AtomicI64::new(0));
    let clk = clock.clone();
    let mut backend = SlirpLocalBackend::with_connector(
        GW_MAC,
        Box::new(move || clk.load(Ordering::SeqCst)),
        Box::new(OneBytePatternConnector::new(N, probe.clone())),
    );
    let mut guest = Guest::new(&clock);
    guest.connect(Ipv4Addr::new(192, 0, 2, 1), 8080);

    let started = WallInstant::now();
    let mut upload_offset = 0usize;
    let mut download_offset = 0usize;
    let mut guest_half_closed = false;
    let mut peak_buffered = 0usize;

    for _ in 0..2_000_000 {
        clock.fetch_add(1, Ordering::SeqCst);
        guest.poll(&clock);
        shuttle(&mut guest, &mut backend);
        guest.poll(&clock);
        peak_buffered = peak_buffered.max(backend.buffered_bytes());

        let socket = guest.socket();
        if upload_offset < N && socket.may_send() && socket.can_send() {
            let want = (16 * 1024).min(N - upload_offset);
            let chunk: Vec<u8> = (0..want)
                .map(|i| stream_pat(83, upload_offset + i))
                .collect();
            upload_offset += socket.send_slice(&chunk).unwrap();
        }
        if upload_offset == N && !guest_half_closed {
            socket.close();
            guest_half_closed = true;
        }
        if socket.can_recv() {
            let chunk = socket
                .recv(|bytes| {
                    let out = bytes.to_vec();
                    (out.len(), out)
                })
                .unwrap();
            assert!(
                chunk
                    .iter()
                    .enumerate()
                    .all(|(i, &byte)| byte == stream_pat(17, download_offset + i)),
                "one-byte-framed download diverged at offset {download_offset}"
            );
            download_offset += chunk.len();
        }
        if upload_offset == N && download_offset == N && backend.flow_count() == 0 {
            break;
        }
    }

    let elapsed = started.elapsed();
    assert_eq!(upload_offset, N, "one-byte attack truncated the upload");
    assert_eq!(download_offset, N, "one-byte attack truncated the download");
    assert!(
        peak_buffered <= MAX_USER_QUEUES,
        "one-byte framing queued {peak_buffered} bytes (cap {MAX_USER_QUEUES})"
    );
    assert!(
        elapsed < MAX_ELAPSED,
        "200 MiB through 100 MiB of one-byte deliveries took {elapsed:?}; linear-time budget is {MAX_ELAPSED:?}"
    );

    drop(backend);
    assert!(
        probe.upload_exact.get(),
        "the connector independently observed corrupt upload bytes"
    );
    assert_eq!(probe.uploaded.get(), N);
    assert_eq!(probe.downloaded.get(), N);
    assert_eq!(
        probe.max_delivery.get(),
        1,
        "every connector delivery must be exactly one byte"
    );
    assert_eq!(
        probe.shutdowns.get(),
        1,
        "guest half-close reached connector"
    );
    assert_eq!(probe.closes.get(), 1, "the connector resource was reaped");
}
