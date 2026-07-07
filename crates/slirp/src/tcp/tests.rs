use super::*;
use smoltcp::phy::ChecksumCapabilities;
use smoltcp::wire::{
    EthernetProtocol, EthernetRepr, IpAddress, IpProtocol, Ipv4Address, Ipv4Repr, TcpControl,
    TcpPacket, TcpRepr, TcpSeqNumber,
};
use std::net::{IpAddr, Ipv4Addr};

const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x00, 0x00, 0x02];
const GUEST_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 15);
const EXT_IP: Ipv4Addr = Ipv4Addr::new(93, 184, 216, 34);

/// Build a guest→dst ethernet-framed IPv4 TCP segment with explicit SYN/ACK flags.
fn tcp_frame(dst: Ipv4Addr, src_port: u16, dst_port: u16, syn: bool, ack: bool) -> Vec<u8> {
    let tcp = TcpRepr {
        src_port,
        dst_port,
        control: if syn {
            TcpControl::Syn
        } else {
            TcpControl::None
        },
        seq_number: TcpSeqNumber(0),
        ack_number: if ack { Some(TcpSeqNumber(1)) } else { None },
        window_len: 64240,
        window_scale: None,
        max_seg_size: None,
        sack_permitted: false,
        sack_ranges: [None, None, None],
        timestamp: None,
        payload: &[],
    };
    let src: Ipv4Address = GUEST_IP;
    let dst_a: Ipv4Address = dst;
    let ip = Ipv4Repr {
        src_addr: src,
        dst_addr: dst_a,
        next_header: IpProtocol::Tcp,
        payload_len: tcp.buffer_len(),
        hop_limit: 64,
    };
    let eth = EthernetRepr {
        src_addr: smoltcp::wire::EthernetAddress(GUEST_MAC),
        dst_addr: smoltcp::wire::EthernetAddress(GW_MAC),
        ethertype: EthernetProtocol::Ipv4,
    };
    let total = eth.buffer_len() + ip.buffer_len() + tcp.buffer_len();
    let mut buf = vec![0u8; total];
    let caps = ChecksumCapabilities::default();
    let mut frame = smoltcp::wire::EthernetFrame::new_unchecked(&mut buf);
    eth.emit(&mut frame);
    let mut ipp = Ipv4Packet::new_unchecked(frame.payload_mut());
    ip.emit(&mut ipp, &caps);
    let mut tp = TcpPacket::new_unchecked(ipp.payload_mut());
    tcp.emit(
        &mut tp,
        &IpAddress::Ipv4(src),
        &IpAddress::Ipv4(dst_a),
        &caps,
    );
    buf
}

#[test]
fn syn_to_external_host_is_an_outbound_flow() {
    let f = tcp_frame(EXT_IP, 40000, 443, true, false);
    match classify(&f) {
        FrameClass::OutboundSyn(k) => {
            assert_eq!(k.proto, Proto::Tcp);
            assert_eq!(k.guest_ip, IpAddr::V4(GUEST_IP));
            assert_eq!(k.guest_port, 40000);
            assert_eq!(k.dst_ip, IpAddr::V4(EXT_IP));
            assert_eq!(k.dst_port, 443);
        }
        other => panic!("expected OutboundSyn, got {other:?}"),
    }
}

#[test]
fn syn_to_the_gateway_is_local_not_nated() {
    // A SYN to 10.0.2.2 (the gateway) is handled by smoltcp locally, not bridged out.
    let f = tcp_frame(net::GATEWAY, 40001, 53, true, false);
    assert_eq!(classify(&f), FrameClass::LocalTcp);
}

#[test]
fn non_syn_tcp_is_an_existing_flow() {
    // A bare ACK to an external host belongs to an already-open flow, not a new one.
    let f = tcp_frame(EXT_IP, 40002, 443, false, true);
    match classify(&f) {
        FrameClass::ExistingTcp(k) => assert_eq!(k.dst_port, 443),
        other => panic!("expected ExistingTcp, got {other:?}"),
    }
}

#[test]
fn syn_ack_is_not_a_fresh_syn() {
    // SYN+ACK (both bits set) is NOT a guest-opening SYN — the `syn && !ack` guard must classify it
    // as an existing flow, not a new outbound one.
    let f = tcp_frame(EXT_IP, 40003, 443, true, true);
    assert!(
        matches!(classify(&f), FrameClass::ExistingTcp(_)),
        "SYN+ACK must not be OutboundSyn"
    );
}

#[test]
fn non_tcp_and_malformed_frames_are_other() {
    // An ARP frame (ethertype 0x0806) → Other.
    let mut arp = vec![0u8; 42];
    arp[12..14].copy_from_slice(&[0x08, 0x06]);
    assert_eq!(classify(&arp), FrameClass::Other);
    // A truncated frame → Other, no panic.
    assert_eq!(classify(&[0u8; 4]), FrameClass::Other);
    assert_eq!(classify(&[]), FrameClass::Other);
    // A UDP frame (IPv4, proto 17) → Other. Build a minimal one.
    let ip = Ipv4Repr {
        src_addr: GUEST_IP,
        dst_addr: EXT_IP,
        next_header: IpProtocol::Udp,
        payload_len: 8,
        hop_limit: 64,
    };
    let eth = EthernetRepr {
        src_addr: smoltcp::wire::EthernetAddress(GUEST_MAC),
        dst_addr: smoltcp::wire::EthernetAddress(GW_MAC),
        ethertype: EthernetProtocol::Ipv4,
    };
    let mut buf = vec![0u8; eth.buffer_len() + ip.buffer_len() + 8];
    let caps = ChecksumCapabilities::default();
    let mut frame = smoltcp::wire::EthernetFrame::new_unchecked(&mut buf);
    eth.emit(&mut frame);
    let mut ipp = Ipv4Packet::new_unchecked(frame.payload_mut());
    ip.emit(&mut ipp, &caps);
    assert_eq!(classify(&buf), FrameClass::Other);
}
