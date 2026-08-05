//! END-TO-END data-path proof (native): a hand-driven guest's bytes travel all the way through the
//! real slirp machinery — `SlirpStack` (smoltcp) → the [`pump_flow`](crate::pump_flow) byte-pump → a
//! REAL outbound `tokio` TCP connection to a REAL echo server — and the echo comes back out to the
//! guest as a data segment. No booted guest. The first test drives a hand-inlined servicing loop over
//! a raw `SlirpStack` + pump (proving the pieces compose); the second drives the SAME round trip
//! entirely through the `Bridge` control plane and its `Bridge::service` loop (the servicing lifted
//! into production code). This is the first time a guest frame drives real outbound traffic and gets a
//! real reply back through the whole stack. The remaining leg is the env-gated booted-guest acceptance.

use std::net::Ipv4Addr;
use std::time::Duration;

use smoltcp::socket::tcp::State;
use smoltcp::wire::{
    EthernetFrame, EthernetProtocol, EthernetRepr, IpAddress, IpProtocol, Ipv4Packet, Ipv4Repr,
    TcpControl, TcpPacket, TcpRepr, TcpSeqNumber,
};
use std::future::Future;
use std::io;
use std::net::IpAddr;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpListener;
use tokio::sync::mpsc;

use crate::net;
use crate::{
    Bridge, ConnectError, NativeConnector, OutboundConnector, PumpEvent, SlirpStack, pump_flow,
};

const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x00, 0x00, 0x02];

/// A guest ARP request for the gateway (so smoltcp learns the guest neighbor and can frame replies).
fn arp_request() -> Vec<u8> {
    let mut f = vec![0u8; 42];
    f[0..6].copy_from_slice(&[0xff; 6]);
    f[6..12].copy_from_slice(&GUEST_MAC);
    f[12..14].copy_from_slice(&[0x08, 0x06]);
    f[14..16].copy_from_slice(&[0x00, 0x01]);
    f[16..18].copy_from_slice(&[0x08, 0x00]);
    f[18] = 6;
    f[19] = 4;
    f[20..22].copy_from_slice(&[0x00, 0x01]);
    f[22..28].copy_from_slice(&GUEST_MAC);
    f[28..32].copy_from_slice(&net::GUEST.octets());
    f[38..42].copy_from_slice(&net::GATEWAY.octets());
    f
}

/// A guest→`dst` TCP segment with explicit seq/ack/flags/payload (for hand-driven handshakes + data).
fn tcp_seg(
    dst: Ipv4Addr,
    src_port: u16,
    dst_port: u16,
    seq: i64,
    ack: Option<i64>,
    syn: bool,
    payload: &[u8],
) -> Vec<u8> {
    let tcp = TcpRepr {
        src_port,
        dst_port,
        control: if syn {
            TcpControl::Syn
        } else {
            TcpControl::None
        },
        seq_number: TcpSeqNumber(seq as i32),
        ack_number: ack.map(|a| TcpSeqNumber(a as i32)),
        window_len: 64240,
        window_scale: None,
        max_seg_size: None,
        sack_permitted: false,
        sack_ranges: [None, None, None],
        timestamp: None,
        payload,
    };
    let src = net::GUEST;
    let ip = Ipv4Repr {
        src_addr: src,
        dst_addr: dst,
        next_header: IpProtocol::Tcp,
        payload_len: tcp.buffer_len(),
        hop_limit: 64,
    };
    let eth = EthernetRepr {
        src_addr: smoltcp::wire::EthernetAddress(GUEST_MAC),
        dst_addr: smoltcp::wire::EthernetAddress(GW_MAC),
        ethertype: EthernetProtocol::Ipv4,
    };
    let mut buf = vec![0u8; eth.buffer_len() + ip.buffer_len() + tcp.buffer_len()];
    let caps = smoltcp::phy::ChecksumCapabilities::default();
    let mut frame = EthernetFrame::new_unchecked(&mut buf);
    eth.emit(&mut frame);
    let mut ipp = Ipv4Packet::new_unchecked(frame.payload_mut());
    ip.emit(&mut ipp, &caps);
    let mut tp = TcpPacket::new_unchecked(ipp.payload_mut());
    tcp.emit(&mut tp, &IpAddress::Ipv4(src), &IpAddress::Ipv4(dst), &caps);
    buf
}

/// Does any egress frame carry a TCP payload to `dst_port` containing `needle`?
fn egress_to_guest_contains(frames: &[Vec<u8>], dst_port: u16, needle: &[u8]) -> bool {
    frames.iter().any(|f| {
        let Ok(ipp) = Ipv4Packet::new_checked(&f[14..]) else {
            return false;
        };
        if ipp.next_header() != IpProtocol::Tcp {
            return false;
        }
        let Ok(tp) = TcpPacket::new_checked(ipp.payload()) else {
            return false;
        };
        tp.dst_port() == dst_port && tp.payload().windows(needle.len()).any(|w| w == needle)
    })
}

fn egress_to_guest_has_rst(frames: &[Vec<u8>], dst_port: u16) -> bool {
    frames.iter().any(|f| {
        let Ok(ipp) = Ipv4Packet::new_checked(&f[14..]) else {
            return false;
        };
        let Ok(tp) = TcpPacket::new_checked(ipp.payload()) else {
            return false;
        };
        tp.dst_port() == dst_port && tp.rst()
    })
}

/// Guest sends a request through the whole stack to a real echo server, and the echoed reply comes
/// back out to the guest — the complete slirp data path, proven natively with no booted guest.
#[tokio::test]
async fn guest_bytes_round_trip_through_pump_to_a_real_echo_server() {
    // A real echo server on an ephemeral loopback port.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let dst = match addr.ip() {
        std::net::IpAddr::V4(v4) => v4,
        _ => unreachable!(),
    };
    let port = addr.port();
    tokio::spawn(async move {
        let (mut sock, _) = listener.accept().await.unwrap();
        let mut b = [0u8; 2048];
        loop {
            match sock.read(&mut b).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if sock.write_all(&b[..n]).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Stand up the stack and hand-drive the guest handshake to the echo server's real endpoint.
    let mut s = SlirpStack::new(GW_MAC);
    let mut t: i64 = 1;
    s.inject(arp_request());
    s.poll(t);
    let _ = s.take_egress();
    t += 1;

    let h = s.open_tcp(dst, port);
    s.inject(tcp_seg(dst, 40000, port, 1000, None, true, &[])); // guest SYN
    s.poll(t);
    t += 1;
    // Pull slirp's ISN from the SYN-ACK. Scan for it rather than assuming egress[0] is IPv4/TCP
    // (robust if an ARP or other frame ever precedes it — critic NIT).
    let isn = s
        .take_egress()
        .iter()
        .find_map(|f| {
            let ipp = Ipv4Packet::new_checked(&f[14..]).ok()?;
            if ipp.next_header() != IpProtocol::Tcp {
                return None;
            }
            let tp = TcpPacket::new_checked(ipp.payload()).ok()?;
            (tp.dst_port() == 40000 && tp.syn() && tp.ack()).then(|| tp.seq_number().0 as i64)
        })
        .expect("a SYN-ACK egressed to the guest");
    s.inject(tcp_seg(dst, 40000, port, 1001, Some(isn + 1), false, &[])); // guest ACK → Established
    s.poll(t);
    t += 1;
    let _ = s.take_egress();
    assert_eq!(s.tcp_state(h), Some(State::Established), "handshake done");

    // Wire the flow's smoltcp socket to a REAL outbound connection via the pump.
    let stream = match NativeConnector::new()
        .connect(std::net::IpAddr::V4(dst), port)
        .await
    {
        Ok(st) => st,
        Err(e) => panic!("connect to the echo server failed: {e:?}"),
    };
    let (to_pump_tx, to_pump_rx) = mpsc::channel::<Vec<u8>>(8); // guest → outbound
    let (from_pump_tx, mut from_pump_rx) = mpsc::channel::<PumpEvent>(8); // outbound → guest
    tokio::spawn(pump_flow(stream, to_pump_rx, from_pump_tx));

    // Guest sends a request as a data segment.
    const REQ: &[u8] = b"hello slirp world";
    s.inject(tcp_seg(dst, 40000, port, 1001, Some(isn + 1), false, REQ));
    s.poll(t);
    t += 1;
    let _ = s.take_egress();

    // Inline servicing loop: shuttle guest→outbound and outbound→guest until the echo egresses to the
    // guest, bounded by a hard deadline so a wiring regression fails cleanly instead of hanging.
    let mut pending_out: Vec<u8> = Vec::new();
    let found = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            // guest → outbound: hand any buffered guest bytes to the pump.
            let d = s.tcp_recv(h);
            if !d.is_empty() && to_pump_tx.send(d).await.is_err() {
                return false; // the pump task died — fail cleanly (not a panic, not a false pass)
            }
            // outbound → guest: pull echoed bytes from the pump and enqueue to the guest socket.
            while let Ok(event) = from_pump_rx.try_recv() {
                match event {
                    PumpEvent::Data(chunk) => pending_out.extend_from_slice(&chunk),
                    PumpEvent::Eof => s.tcp_close(h),
                    PumpEvent::Reset => s.tcp_abort(h),
                }
            }
            if !pending_out.is_empty() {
                let n = s.tcp_send(h, &pending_out);
                pending_out.drain(..n);
            }
            s.poll(t);
            t += 1;
            if egress_to_guest_contains(&s.take_egress(), 40000, REQ) {
                return true; // the echo reached the guest
            }
            tokio::time::sleep(Duration::from_millis(5)).await; // let the pump + echo server run
        }
    })
    .await;

    // Ok(true) = round trip proven. Ok(false) = the pump died. Err = 5 s timeout (never round-tripped).
    // All three of the "didn't work" cases fail the assertion — no false pass on a broken data path.
    assert!(
        matches!(found, Ok(true)),
        "the echoed reply travelled guest → stack → pump → real echo server → back to the guest \
         (got {found:?})",
    );
}

/// The same round trip, but driven entirely through the `Bridge` control plane + its `service()` loop
/// (not a hand-inlined shuttle): a guest SYN/ACK/data go in via `on_guest_frame`, `service()` spawns
/// the per-flow pump and moves bytes both ways, and the echo egresses to the guest. Proves the
/// servicing loop lifted into `Bridge` composes end-to-end against a real socket.
#[tokio::test]
async fn bridge_service_round_trips_guest_bytes_to_a_real_echo_server() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let std::net::IpAddr::V4(dst) = addr.ip() else {
        unreachable!("ipv4 loopback")
    };
    let port = addr.port();
    tokio::spawn(async move {
        let (mut sock, _) = listener.accept().await.unwrap();
        let mut b = [0u8; 2048];
        loop {
            match sock.read(&mut b).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if sock.write_all(&b[..n]).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    let mut br = Bridge::new(GW_MAC, NativeConnector::new(), 16);
    let mut t: u64 = 1;
    br.on_guest_frame(arp_request(), t).await; // learn the neighbor
    t += 1;
    let _ = br.take_egress();

    br.on_guest_frame(tcp_seg(dst, 40000, port, 1000, None, true, &[]), t)
        .await; // SYN → connect + SYN-ACK
    t += 1;
    let isn = br
        .take_egress()
        .iter()
        .find_map(|f| {
            let ipp = Ipv4Packet::new_checked(&f[14..]).ok()?;
            if ipp.next_header() != IpProtocol::Tcp {
                return None;
            }
            let tp = TcpPacket::new_checked(ipp.payload()).ok()?;
            (tp.dst_port() == 40000 && tp.syn() && tp.ack()).then(|| tp.seq_number().0 as i64)
        })
        .expect("a SYN-ACK egressed to the guest");

    br.on_guest_frame(
        tcp_seg(dst, 40000, port, 1001, Some(isn + 1), false, &[]),
        t,
    )
    .await; // ACK → Established
    t += 1;
    let _ = br.take_egress();

    const REQ: &[u8] = b"hello via bridge";
    br.on_guest_frame(
        tcp_seg(dst, 40000, port, 1001, Some(isn + 1), false, REQ),
        t,
    )
    .await; // data
    t += 1;
    let _ = br.take_egress();

    let found = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            br.service(); // spawn pump + shuttle bytes both ways
            br.poll(t as i64); // emit any queued guest-bound segments
            t += 1;
            if egress_to_guest_contains(&br.take_egress(), 40000, REQ) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await;

    assert!(
        matches!(found, Ok(true)),
        "guest bytes round-tripped through Bridge::service to the echo server and back (got {found:?})",
    );
    assert_eq!(
        br.flow_count(),
        1,
        "the flow is still live after the round trip"
    );
}

/// Outbound read failure after a completed guest handshake must abort the guest socket. This holds
/// the pump's explicit Reset event against the Bridge integration; mapping it to EOF would emit FIN
/// and fail the RST assertion.
struct ResetStream;
impl AsyncRead for ResetStream {
    fn poll_read(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        _: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Poll::Ready(Err(io::Error::from(io::ErrorKind::ConnectionReset)))
    }
}
impl AsyncWrite for ResetStream {
    fn poll_write(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Poll::Ready(Ok(buf.len()))
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

#[derive(Clone)]
struct ResetConnector;
impl OutboundConnector for ResetConnector {
    type Conn = ResetStream;
    #[allow(clippy::manual_async_fn)]
    fn connect(
        &self,
        _host: IpAddr,
        _port: u16,
    ) -> impl Future<Output = Result<Self::Conn, ConnectError>> + Send {
        async { Ok(ResetStream) }
    }
}

#[tokio::test]
async fn outbound_connection_reset_becomes_guest_rst_not_fin() {
    let dst = Ipv4Addr::new(198, 51, 100, 20);
    let port = 443;
    let mut br = Bridge::new(GW_MAC, ResetConnector, 16);
    let mut t = 1u64;
    br.on_guest_frame(arp_request(), t).await;
    t += 1;
    let _ = br.take_egress();
    br.on_guest_frame(tcp_seg(dst, 40011, port, 1000, None, true, &[]), t)
        .await;
    t += 1;
    let isn = br
        .take_egress()
        .iter()
        .find_map(|f| {
            let ip = Ipv4Packet::new_checked(&f[14..]).ok()?;
            let tcp = TcpPacket::new_checked(ip.payload()).ok()?;
            (tcp.dst_port() == 40011 && tcp.syn() && tcp.ack()).then(|| tcp.seq_number().0 as i64)
        })
        .expect("guest handshake gets SYN-ACK");
    br.on_guest_frame(
        tcp_seg(dst, 40011, port, 1001, Some(isn + 1), false, &[]),
        t,
    )
    .await;
    t += 1;
    let _ = br.take_egress();

    let got_rst = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            br.service();
            br.poll(t as i64);
            t += 1;
            if egress_to_guest_has_rst(&br.take_egress(), 40011) {
                return true;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap_or(false);
    assert!(got_rst, "outbound ConnectionReset must emit guest TCP RST");
}

/// A stream that FLOODS: every read yields a full buffer of bytes forever; writes are sunk. Models a
/// server firehosing data faster than a stalled guest can accept it.
struct FloodStream;
impl AsyncRead for FloodStream {
    fn poll_read(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let n = buf.remaining().min(16 * 1024);
        buf.put_slice(&vec![b'x'; n]);
        Poll::Ready(Ok(()))
    }
}
impl AsyncWrite for FloodStream {
    fn poll_write(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Poll::Ready(Ok(buf.len())) // sink everything
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

#[derive(Clone)]
struct FloodConnector;
impl OutboundConnector for FloodConnector {
    type Conn = FloodStream;
    // The trait requires `-> impl Future + Send` (not `async fn`), matching the real connectors.
    #[allow(clippy::manual_async_fn)]
    fn connect(
        &self,
        _host: IpAddr,
        _port: u16,
    ) -> impl Future<Output = Result<Self::Conn, ConnectError>> + Send {
        async { Ok(FloodStream) }
    }
}

/// Regression (critic MAJOR): the outbound→guest path must be BOUNDED. With a server flooding bytes
/// and a guest whose receive window is shut (it never ACKs), `Bridge`'s `pending_out` must NOT grow
/// without limit — otherwise a single flow OOMs the host. Pre-fix this climbed ~100 MiB in 400 passes;
/// post-fix it holds ~one channel drain because leaving bytes in the bounded `from_pump` blocks the
/// pump (and thus the server).
#[tokio::test]
async fn outbound_to_guest_stays_bounded_when_the_server_floods_and_the_guest_stalls() {
    let dst = Ipv4Addr::new(93, 184, 216, 34);
    let port = 80;
    let mut br = Bridge::new(GW_MAC, FloodConnector, 16);
    let mut t: u64 = 1;
    br.on_guest_frame(arp_request(), t).await;
    t += 1;
    let _ = br.take_egress();

    br.on_guest_frame(tcp_seg(dst, 40000, port, 1000, None, true, &[]), t)
        .await; // SYN
    t += 1;
    let isn = br
        .take_egress()
        .iter()
        .find_map(|f| {
            let ipp = Ipv4Packet::new_checked(&f[14..]).ok()?;
            if ipp.next_header() != IpProtocol::Tcp {
                return None;
            }
            let tp = TcpPacket::new_checked(ipp.payload()).ok()?;
            (tp.dst_port() == 40000 && tp.syn() && tp.ack()).then(|| tp.seq_number().0 as i64)
        })
        .expect("a SYN-ACK egressed to the guest");
    br.on_guest_frame(
        tcp_seg(dst, 40000, port, 1001, Some(isn + 1), false, &[]),
        t,
    )
    .await; // ACK
    t += 1;
    let _ = br.take_egress();

    // The guest now STALLS — we drop every guest-bound frame and never ACK, so smoltcp's send buffer
    // fills and `tcp_send` accepts 0. Drive many passes; the outbound buffer must stay bounded.
    let mut max = 0usize;
    for _ in 0..300 {
        br.service();
        br.poll(t as i64);
        t += 1;
        let _ = br.take_egress(); // never ACK → the guest window stays shut
        max = max.max(br.pending_out_bytes());
        tokio::task::yield_now().await; // let the flood pump run between passes
    }
    assert!(
        max < 4 * 1024 * 1024,
        "outbound buffering stayed bounded (max={max} bytes); unbounded growth = remote OOM",
    );
}
