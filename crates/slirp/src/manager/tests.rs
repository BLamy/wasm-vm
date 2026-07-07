use super::*;
use crate::nat::Proto;
use crate::net;
use smoltcp::phy::ChecksumCapabilities;
use smoltcp::wire::{
    EthernetProtocol, EthernetRepr, IpAddress, IpProtocol, Ipv4Address, Ipv4Packet, Ipv4Repr,
    TcpControl, TcpPacket, TcpRepr, TcpSeqNumber,
};
use std::net::{IpAddr, Ipv4Addr};

const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x00, 0x00, 0x02];
const GUEST_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 15);

/// Build a guest→dst ethernet-framed TCP segment with explicit SYN/ACK flags.
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
    let mut buf = vec![0u8; eth.buffer_len() + ip.buffer_len() + tcp.buffer_len()];
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

fn ext(d: u8) -> Ipv4Addr {
    Ipv4Addr::new(93, 184, 216, d)
}
fn ext_key(d: u8, sport: u16) -> FlowKey {
    FlowKey {
        proto: Proto::Tcp,
        guest_ip: IpAddr::V4(GUEST_IP),
        guest_port: sport,
        dst_ip: IpAddr::V4(ext(d)),
        dst_port: 443,
    }
}

#[test]
fn new_syn_is_a_connect_and_creates_a_flow() {
    let mut m = FlowManager::new(16);
    let out = m.on_guest_frame(&tcp_frame(ext(34), 40000, 443, true, false), 1000);
    assert_eq!(out.action, Action::Connect(ext_key(34, 40000)));
    assert_eq!(out.evicted, None);
    assert_eq!(m.flow_count(), 1);
}

#[test]
fn retransmitted_syn_is_not_a_second_connect() {
    let mut m = FlowManager::new(16);
    m.on_guest_frame(&tcp_frame(ext(34), 40000, 443, true, false), 1000);
    // The same SYN again (retransmit) must NOT re-connect — it's an existing flow.
    let out = m.on_guest_frame(&tcp_frame(ext(34), 40000, 443, true, false), 1100);
    assert_eq!(out.action, Action::Existing(ext_key(34, 40000)));
    assert_eq!(m.flow_count(), 1, "still one flow");
}

#[test]
fn data_for_a_tracked_flow_refreshes_it() {
    let mut m = FlowManager::new(16);
    m.on_guest_frame(&tcp_frame(ext(34), 40000, 443, true, false), 1000);
    let out = m.on_guest_frame(&tcp_frame(ext(34), 40000, 443, false, true), 2000);
    assert_eq!(out.action, Action::Existing(ext_key(34, 40000)));
    assert_eq!(m.flow_count(), 1);
}

#[test]
fn stray_data_for_an_unknown_flow_does_not_create_a_nat_entry() {
    let mut m = FlowManager::new(16);
    // An ACK with no prior SYN: Existing action (bridge finds no socket → RST), but NO NAT entry.
    let out = m.on_guest_frame(&tcp_frame(ext(34), 40000, 443, false, true), 1000);
    assert_eq!(out.action, Action::Existing(ext_key(34, 40000)));
    assert_eq!(m.flow_count(), 0, "stray data must not create a flow");
}

#[test]
fn a_new_flow_at_capacity_evicts_the_lru() {
    let mut m = FlowManager::new(1);
    m.on_guest_frame(&tcp_frame(ext(1), 40001, 443, true, false), 100);
    // A second new flow at capacity evicts the first (LRU) — the bridge tears down its socket.
    let out = m.on_guest_frame(&tcp_frame(ext(2), 40002, 443, true, false), 200);
    assert_eq!(out.action, Action::Connect(ext_key(2, 40002)));
    assert_eq!(out.evicted, Some(ext_key(1, 40001)));
    assert_eq!(m.flow_count(), 1);
}

#[test]
fn local_and_ignore_actions() {
    let mut m = FlowManager::new(16);
    // SYN to the gateway → Local.
    assert_eq!(
        m.on_guest_frame(&tcp_frame(net::GATEWAY, 40003, 53, true, false), 1)
            .action,
        Action::Local
    );
    // An ARP frame → Ignore.
    let mut arp = vec![0u8; 42];
    arp[12..14].copy_from_slice(&[0x08, 0x06]);
    assert_eq!(m.on_guest_frame(&arp, 1).action, Action::Ignore);
    assert_eq!(m.flow_count(), 0, "neither creates a flow");
}

#[test]
fn expire_and_remove() {
    let mut m = FlowManager::new(16);
    m.on_guest_frame(&tcp_frame(ext(34), 40000, 443, true, false), 0);
    // TCP idle is 2h; not expired at 1h.
    assert!(m.expire(60 * 60 * 1000).is_empty());
    // Expired at 2h → swept, count back to 0.
    let gone = m.expire(2 * 60 * 60 * 1000);
    assert_eq!(gone, vec![ext_key(34, 40000)]);
    assert_eq!(m.flow_count(), 0);
    // remove is idempotent.
    assert!(!m.remove(&ext_key(34, 40000)));
}
