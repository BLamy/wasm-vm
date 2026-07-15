//! `Bridge` connection-lifecycle tests with a MOCK connector (records connects; no real sockets).
//! Deterministic; `#[tokio::test]` just drives the async `on_guest_frame`.

use super::*;
use crate::connector::ConnectError;
use crate::net;
use smoltcp::wire::{
    EthernetProtocol, EthernetRepr, IpAddress, IpProtocol, Ipv4Address, Ipv4Packet, Ipv4Repr,
    TcpControl, TcpPacket, TcpRepr, TcpSeqNumber,
};
use std::future::Future;
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};

const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x00, 0x00, 0x02];

/// Records every `connect(host, port)`; optionally fails them all.
#[derive(Clone, Default)]
struct MockConnector {
    calls: Arc<Mutex<Vec<(IpAddr, u16)>>>,
    fail: bool,
}
impl OutboundConnector for MockConnector {
    type Conn = ();
    fn connect(
        &self,
        host: IpAddr,
        port: u16,
    ) -> impl Future<Output = Result<Self::Conn, ConnectError>> + Send {
        let calls = self.calls.clone();
        let fail = self.fail;
        async move {
            calls.lock().unwrap().push((host, port));
            if fail {
                Err(ConnectError::Refused)
            } else {
                Ok(())
            }
        }
    }
}

fn syn(dst: Ipv4Addr, src_port: u16, dst_port: u16) -> Vec<u8> {
    let tcp = TcpRepr {
        src_port,
        dst_port,
        control: TcpControl::Syn,
        seq_number: TcpSeqNumber(1000),
        ack_number: None,
        window_len: 64240,
        window_scale: None,
        max_seg_size: None,
        sack_permitted: false,
        sack_ranges: [None, None, None],
        timestamp: None,
        payload: &[],
    };
    let src: Ipv4Address = net::GUEST;
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
    let mut frame = smoltcp::wire::EthernetFrame::new_unchecked(&mut buf);
    eth.emit(&mut frame);
    let mut ipp = Ipv4Packet::new_unchecked(frame.payload_mut());
    ip.emit(&mut ipp, &caps);
    let mut tp = TcpPacket::new_unchecked(ipp.payload_mut());
    tcp.emit(&mut tp, &IpAddress::Ipv4(src), &IpAddress::Ipv4(dst), &caps);
    buf
}

fn arp() -> Vec<u8> {
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

const EXT: Ipv4Addr = Ipv4Addr::new(93, 184, 216, 34);

#[tokio::test]
async fn new_flow_connects_opens_socket_and_syn_acks() {
    let mock = MockConnector::default();
    let calls = mock.calls.clone();
    let mut b = Bridge::new(GW_MAC, mock, 16);
    // Guest ARPs the gateway first (so slirp learns the neighbor to reply); the bridge must inject it.
    b.on_guest_frame(arp(), 1).await;
    b.poll(1);
    let _ = b.take_egress();

    b.on_guest_frame(syn(EXT, 40000, 80), 2).await;
    assert_eq!(
        *calls.lock().unwrap(),
        vec![(IpAddr::V4(EXT), 80)],
        "connected the outbound side once"
    );
    assert_eq!(b.flow_count(), 1, "flow tracked");
    // The SYN reached the opened socket → slirp SYN-ACKs the guest.
    b.poll(2);
    let eg = b.take_egress();
    assert_eq!(eg.len(), 1, "a SYN-ACK egresses to the guest");
    let ipp = Ipv4Packet::new_checked(&eg[0][14..]).unwrap();
    let tp = TcpPacket::new_checked(ipp.payload()).unwrap();
    assert!(tp.syn() && tp.ack(), "SYN-ACK");
}

#[tokio::test]
async fn connect_failure_tears_the_flow_down() {
    let mock = MockConnector {
        fail: true,
        ..Default::default()
    };
    let calls = mock.calls.clone();
    let mut b = Bridge::new(GW_MAC, mock, 16);
    b.on_guest_frame(arp(), 1).await;
    b.poll(1);
    let _ = b.take_egress();

    b.on_guest_frame(syn(EXT, 40000, 80), 2).await;
    assert_eq!(calls.lock().unwrap().len(), 1, "connect was attempted");
    assert_eq!(
        b.flow_count(),
        0,
        "half-open flow torn down on connect failure"
    );
    // The failed dial must terminate the guest promptly. The bridge briefly lets smoltcp consume the
    // SYN so it knows the peer sequence number, then aborts; the final segment is therefore RST.
    b.poll(2);
    let egress = b.take_egress();
    assert!(
        egress.iter().any(|frame| {
            let Ok(ip) = Ipv4Packet::new_checked(&frame[14..]) else {
                return false;
            };
            let Ok(tcp) = TcpPacket::new_checked(ip.payload()) else {
                return false;
            };
            tcp.dst_port() == 40000 && tcp.rst()
        }),
        "a refused outbound must RST the guest immediately, not leave it to time out: {egress:?}"
    );
}

#[tokio::test]
async fn retransmitted_syn_does_not_reconnect() {
    let mock = MockConnector::default();
    let calls = mock.calls.clone();
    let mut b = Bridge::new(GW_MAC, mock, 16);
    b.on_guest_frame(syn(EXT, 40000, 80), 1).await;
    b.on_guest_frame(syn(EXT, 40000, 80), 2).await; // retransmit
    assert_eq!(calls.lock().unwrap().len(), 1, "connected only once");
    assert_eq!(b.flow_count(), 1);
}

#[tokio::test]
async fn a_new_flow_at_capacity_evicts_and_tears_down() {
    let mock = MockConnector::default();
    let calls = mock.calls.clone();
    let mut b = Bridge::new(GW_MAC, mock, 1);
    b.on_guest_frame(syn(EXT, 40001, 80), 1).await;
    b.on_guest_frame(syn(Ipv4Addr::new(1, 1, 1, 1), 40002, 80), 2)
        .await; // evicts the first
    assert_eq!(calls.lock().unwrap().len(), 2, "each new flow connects");
    assert_eq!(
        b.flow_count(),
        1,
        "bounded — the evicted flow was torn down"
    );
}

#[tokio::test]
async fn local_and_non_tcp_do_not_connect() {
    let mock = MockConnector::default();
    let calls = mock.calls.clone();
    let mut b = Bridge::new(GW_MAC, mock, 16);
    // SYN to the gateway (Local) and an ARP (non-TCP) must NOT open an outbound flow.
    b.on_guest_frame(syn(net::GATEWAY, 40003, 53), 1).await;
    b.on_guest_frame(arp(), 2).await;
    assert!(
        calls.lock().unwrap().is_empty(),
        "no outbound connect for local/non-TCP"
    );
    assert_eq!(b.flow_count(), 0);
}

/// Regression (critic pass-2h CRITICAL): at capacity, a new flow that shares the LRU victim's exact
/// `(dst,port)` must NOT let the victim's still-queued SYN hijack the new flow's freshly-opened,
/// slot-reused listener. Pre-fix (inject-now / poll-later) the victim's SYN was swallowed by the new
/// listener → the LIVE flow (guest 40002) received a RST while a forged SYN-ACK went to the evicted
/// guest 40001. The fix polls each admitted frame immediately, so no SYN outlives the eviction.
#[tokio::test]
async fn stale_syn_cannot_hijack_reused_listener_after_same_endpoint_eviction() {
    let mock = MockConnector::default();
    let mut b = Bridge::new(GW_MAC, mock, 1); // capacity 1 → the second flow evicts the first
    b.on_guest_frame(arp(), 1).await; // learn the guest neighbor so SYN-ACKs aren't ARP-deferred
    let _ = b.take_egress();
    b.on_guest_frame(syn(EXT, 40001, 80), 2).await; // flow A
    b.on_guest_frame(syn(EXT, 40002, 80), 3).await; // flow B — SAME endpoint, evicts A
    b.poll(3); // pre-fix: drains the two queued SYNs → hijack; post-fix: already consumed, no-op
    let eg = b.take_egress();

    // The LIVE flow (guest 40002) must get a real SYN-ACK — never a RST from a mis-bound listener.
    let mut b_got_synack = false;
    for f in &eg {
        let Ok(ipp) = Ipv4Packet::new_checked(&f[14..]) else {
            continue;
        };
        if ipp.next_header() != IpProtocol::Tcp {
            continue;
        }
        let Ok(tp) = TcpPacket::new_checked(ipp.payload()) else {
            continue;
        };
        if tp.dst_port() == 40002 {
            assert!(
                !tp.rst(),
                "live flow B must not be RST by a hijacked listener"
            );
            if tp.syn() && tp.ack() {
                b_got_synack = true;
            }
        }
    }
    assert!(
        b_got_synack,
        "the live flow B completes its handshake (SYN-ACK to 40002)"
    );
    assert_eq!(b.flow_count(), 1, "only the surviving flow is tracked");
}

/// Integration: the FIRST test against the REAL `NativeConnector` (not the mock). A guest SYN to a
/// live `tokio::net::TcpListener`'s actual `(ip,port)` must drive an ACTUAL outbound TCP connection —
/// proving `on_guest_frame` → `open_tcp` → `NativeConnector::connect().await` reaches a real server
/// (and the guest gets its SYN-ACK). The byte-PUMP that then carries payload over that connection is
/// the final slice; this proves the connect leg end-to-end against a real socket.
#[cfg(feature = "native")]
#[tokio::test]
async fn real_native_connector_dials_an_actual_tcp_connection() {
    use crate::native::NativeConnector;
    use std::time::Duration;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind an ephemeral local listener");
    let addr = listener.local_addr().unwrap();
    let IpAddr::V4(dst) = addr.ip() else {
        unreachable!("bound to an IPv4 loopback address")
    };
    let port = addr.port();

    let mut b = Bridge::new(GW_MAC, NativeConnector::new(), 16);
    b.on_guest_frame(arp(), 1).await; // learn the guest neighbor so the SYN-ACK isn't ARP-deferred
    let _ = b.take_egress();

    // Guest SYN to the listener's REAL endpoint → open a listening socket AND dial the real server.
    b.on_guest_frame(syn(dst, 40000, port), 2).await;

    // The server side must observe a genuine accepted TCP connection.
    let accepted = tokio::time::timeout(Duration::from_secs(2), listener.accept()).await;
    assert!(
        accepted.is_ok(),
        "NativeConnector established a real outbound TCP connection to the listener"
    );
    assert_eq!(
        b.flow_count(),
        1,
        "the flow is tracked (socket + live outbound stream)"
    );

    // And the guest's half of the handshake completes: a SYN-ACK egresses to it.
    let got_synack = b.take_egress().iter().any(|f| {
        Ipv4Packet::new_checked(&f[14..])
            .ok()
            .filter(|ipp| ipp.next_header() == IpProtocol::Tcp)
            .and_then(|ipp| TcpPacket::new_checked(ipp.payload()).ok())
            .is_some_and(|tp| tp.dst_port() == 40000 && tp.syn() && tp.ack())
    });
    assert!(
        got_synack,
        "the guest receives its SYN-ACK for the real flow"
    );
}
