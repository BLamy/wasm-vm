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

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener};
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use smoltcp::iface::{Config, Interface, SocketSet};
use smoltcp::phy::{Device, DeviceCapabilities, Medium, RxToken, TxToken};
use smoltcp::socket::tcp;
use smoltcp::time::Instant;
use smoltcp::wire::{
    EthernetAddress, EthernetFrame, HardwareAddress, IpAddress, IpCidr, Ipv4Address,
};

use wasm_vm_core::dev::virtio::net::NetBackend;
use wasm_vm_slirp::{SlirpLocalBackend, StdConnector};

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
        let sock = self.sockets.get_mut::<tcp::Socket>(self.tcp);
        sock.connect(
            self.iface.context(),
            (IpAddress::Ipv4(remote), port),
            LOCAL_PORT,
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
