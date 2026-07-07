//! END-TO-END data-path proof (native): a hand-driven guest's bytes travel all the way through the
//! real slirp machinery — `SlirpStack` (smoltcp) → the [`pump_flow`](crate::pump_flow) byte-pump → a
//! REAL outbound `tokio` TCP connection to a REAL echo server — and the echo comes back out to the
//! guest as a data segment. No booted guest and no `Bridge` ownership model yet: the servicing loop
//! that shuttles bytes between the stack's `tcp_recv`/`tcp_send` and the pump's channels is inlined
//! here, proving the pieces compose before that loop is lifted into `Bridge` (which needs a spawn /
//! ownership refactor — the next slice). This is the first time a guest frame drives real outbound
//! traffic and gets a real reply back through the whole stack.

use std::net::Ipv4Addr;
use std::time::Duration;

use smoltcp::socket::tcp::State;
use smoltcp::wire::{
    EthernetFrame, EthernetProtocol, EthernetRepr, IpAddress, IpProtocol, Ipv4Packet, Ipv4Repr,
    TcpControl, TcpPacket, TcpRepr, TcpSeqNumber,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc;

use crate::net;
use crate::{NativeConnector, OutboundConnector, SlirpStack, pump_flow};

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
    let sa = s.take_egress();
    let ipp = Ipv4Packet::new_checked(&sa[0][14..]).unwrap();
    let isn = TcpPacket::new_checked(ipp.payload())
        .unwrap()
        .seq_number()
        .0 as i64;
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
    let (from_pump_tx, mut from_pump_rx) = mpsc::channel::<Vec<u8>>(8); // outbound → guest
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
    let round_trip = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            // guest → outbound: hand any buffered guest bytes to the pump.
            let d = s.tcp_recv(h);
            if !d.is_empty() {
                to_pump_tx.send(d).await.unwrap();
            }
            // outbound → guest: pull echoed bytes from the pump and enqueue to the guest socket.
            while let Ok(chunk) = from_pump_rx.try_recv() {
                pending_out.extend_from_slice(&chunk);
            }
            if !pending_out.is_empty() {
                let n = s.tcp_send(h, &pending_out);
                pending_out.drain(..n);
            }
            s.poll(t);
            t += 1;
            if egress_to_guest_contains(&s.take_egress(), 40000, REQ) {
                return; // the echo reached the guest
            }
            tokio::time::sleep(Duration::from_millis(5)).await; // let the pump + echo server run
        }
    })
    .await;

    assert!(
        round_trip.is_ok(),
        "the echoed reply travelled guest → stack → pump → real echo server → back to the guest"
    );
}
