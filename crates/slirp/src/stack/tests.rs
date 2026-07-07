//! Frame-injection tests for the smoltcp glue: inject a guest ARP request / ICMP echo and assert the
//! gateway (`10.0.2.2`) answers. Deterministic — no async, no boot: pure frame in → frame out.

use super::*;
use crate::net;
use smoltcp::wire::{
    EthernetFrame, EthernetProtocol, EthernetRepr, Icmpv4Packet, Icmpv4Repr, IpAddress, Ipv4Packet,
    Ipv4Repr, TcpControl, TcpPacket, TcpRepr, TcpSeqNumber,
};

const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x00, 0x00, 0x02];

fn guest_ip() -> smoltcp::wire::Ipv4Address {
    let o = net::GUEST.octets();
    smoltcp::wire::Ipv4Address::new(o[0], o[1], o[2], o[3])
}
fn gw_ip() -> smoltcp::wire::Ipv4Address {
    let o = net::GATEWAY.octets();
    smoltcp::wire::Ipv4Address::new(o[0], o[1], o[2], o[3])
}

/// Hand-build a 42-byte ethernet-framed ARP request: "who has 10.0.2.2? tell 10.0.2.15".
fn arp_request() -> Vec<u8> {
    let mut f = vec![0u8; 42];
    // Ethernet: dst broadcast, src guest, ethertype ARP (0x0806).
    f[0..6].copy_from_slice(&[0xff; 6]);
    f[6..12].copy_from_slice(&GUEST_MAC);
    f[12..14].copy_from_slice(&[0x08, 0x06]);
    // ARP: htype=1, ptype=0x0800, hlen=6, plen=4, oper=1 (request).
    f[14..16].copy_from_slice(&[0x00, 0x01]);
    f[16..18].copy_from_slice(&[0x08, 0x00]);
    f[18] = 6;
    f[19] = 4;
    f[20..22].copy_from_slice(&[0x00, 0x01]);
    f[22..28].copy_from_slice(&GUEST_MAC); // sender HW
    f[28..32].copy_from_slice(&net::GUEST.octets()); // sender IP 10.0.2.15
    // target HW = 0, target IP = 10.0.2.2.
    f[38..42].copy_from_slice(&net::GATEWAY.octets());
    f
}

#[test]
fn gateway_answers_arp_for_its_ip() {
    let mut s = SlirpStack::new(GW_MAC);
    s.inject(arp_request());
    s.poll(10);
    let egress = s.take_egress();
    assert_eq!(egress.len(), 1, "exactly one ARP reply");
    let reply = &egress[0];
    // Ethertype ARP, ARP operation = 2 (reply).
    assert_eq!(&reply[12..14], &[0x08, 0x06], "ethertype ARP");
    assert_eq!(&reply[20..22], &[0x00, 0x02], "ARP reply opcode");
    // Sender = the gateway: MAC = GW_MAC, IP = 10.0.2.2; target = the guest.
    assert_eq!(
        &reply[22..28],
        &GW_MAC,
        "reply sender HW is the gateway MAC"
    );
    assert_eq!(
        &reply[28..32],
        &net::GATEWAY.octets(),
        "reply sender IP is 10.0.2.2"
    );
    assert_eq!(&reply[32..38], &GUEST_MAC, "reply target HW is the guest");
    assert_eq!(
        &reply[38..42],
        &net::GUEST.octets(),
        "reply target IP is the guest"
    );
}

/// Build an ethernet-framed IPv4 ICMP echo request from the guest to the gateway (smoltcp emits the
/// IP/ICMP checksums for us).
fn icmp_echo_request() -> Vec<u8> {
    let icmp = Icmpv4Repr::EchoRequest {
        ident: 0x1234,
        seq_no: 1,
        data: b"slirp-ping",
    };
    let ip = Ipv4Repr {
        src_addr: guest_ip(),
        dst_addr: gw_ip(),
        next_header: smoltcp::wire::IpProtocol::Icmp,
        payload_len: icmp.buffer_len(),
        hop_limit: 64,
    };
    let eth = EthernetRepr {
        src_addr: smoltcp::wire::EthernetAddress(GUEST_MAC),
        dst_addr: smoltcp::wire::EthernetAddress(GW_MAC),
        ethertype: EthernetProtocol::Ipv4,
    };
    // Ipv4Repr::buffer_len() is the HEADER only — add the ICMP payload for the whole frame.
    let total = eth.buffer_len() + ip.buffer_len() + icmp.buffer_len();
    let mut buf = vec![0u8; total];
    let mut frame = EthernetFrame::new_unchecked(&mut buf);
    eth.emit(&mut frame);
    let mut ipp = Ipv4Packet::new_unchecked(frame.payload_mut());
    let caps = smoltcp::phy::ChecksumCapabilities::default();
    ip.emit(&mut ipp, &caps);
    let mut icmpp = Icmpv4Packet::new_unchecked(ipp.payload_mut());
    icmp.emit(&mut icmpp, &caps);
    buf
}

#[test]
fn gateway_answers_icmp_echo() {
    let mut s = SlirpStack::new(GW_MAC);
    // The guest ARPs the gateway first (as it must) — this also teaches smoltcp the guest's neighbor
    // entry so it can address the echo reply directly. (Requires the `auto-icmp-echo-reply` smoltcp
    // feature — without it the interface silently drops the ping; critic-pinned.)
    s.inject(arp_request());
    s.poll(10);
    let _ = s.take_egress();

    s.inject(icmp_echo_request());
    s.poll(20);
    let egress = s.take_egress();
    assert_eq!(egress.len(), 1, "exactly one ICMP echo reply");
    let reply = &egress[0];
    assert_eq!(&reply[12..14], &[0x08, 0x00], "ethertype IPv4");
    let ipp = Ipv4Packet::new_checked(&reply[14..]).expect("valid ipv4 reply");
    assert_eq!(ipp.src_addr(), gw_ip(), "reply from the gateway");
    assert_eq!(ipp.dst_addr(), guest_ip(), "reply to the guest");
    let icmpp = Icmpv4Packet::new_checked(ipp.payload()).expect("valid icmp");
    let caps = smoltcp::phy::ChecksumCapabilities::default();
    let repr = Icmpv4Repr::parse(&icmpp, &caps).expect("parse icmp");
    assert!(
        matches!(
            repr,
            Icmpv4Repr::EchoReply {
                ident: 0x1234,
                seq_no: 1,
                ..
            }
        ),
        "an echo reply echoing our ident/seq"
    );
}

/// Build a guest→dst ethernet-framed TCP SYN.
fn tcp_syn(dst: Ipv4Addr, src_port: u16, dst_port: u16) -> Vec<u8> {
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
    let src = net::GUEST;
    let ip = Ipv4Repr {
        src_addr: src,
        dst_addr: dst,
        next_header: smoltcp::wire::IpProtocol::Tcp,
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

#[test]
fn promiscuous_accept_answers_a_syn_to_an_external_host() {
    // The promiscuous-accept core: a per-flow listening socket + `any_ip` lets a guest SYN to an
    // ARBITRARY external IP complete the handshake in slirp (SYN → SYN-ACK), with NO guest boot.
    let ext = Ipv4Addr::new(93, 184, 216, 34);
    let mut s = SlirpStack::new(GW_MAC);
    // Prime the guest neighbor (as with ICMP) so slirp can address the SYN-ACK back.
    s.inject(arp_request());
    s.poll(10);
    let _ = s.take_egress();

    let h = s.open_tcp(ext, 80);
    s.inject(tcp_syn(ext, 40000, 80));
    s.poll(20);
    let egress = s.take_egress();
    assert_eq!(egress.len(), 1, "exactly one SYN-ACK");
    let reply = &egress[0];
    assert_eq!(&reply[12..14], &[0x08, 0x00], "ethertype IPv4");
    let ipp = Ipv4Packet::new_checked(&reply[14..]).expect("ipv4");
    assert_eq!(
        ipp.src_addr(),
        ext,
        "SYN-ACK from the external endpoint we accepted for"
    );
    assert_eq!(ipp.dst_addr(), net::GUEST, "to the guest");
    let tp = TcpPacket::new_checked(ipp.payload()).expect("tcp");
    assert!(tp.syn() && tp.ack(), "a SYN-ACK");
    assert_eq!(tp.dst_port(), 40000, "back to the guest's source port");
    assert_eq!(tp.src_port(), 80, "from the destination port");
    // The listening socket has advanced past LISTEN (received the SYN).
    assert_ne!(s.tcp_state(h), smoltcp::socket::tcp::State::Listen);
}

#[test]
fn unrelated_arp_for_another_ip_is_ignored() {
    // The frame filter allows ARP only for the gateway, so even with `any_ip` on, an ARP for
    // 10.0.2.99 is dropped before smoltcp sees it — no subnet-wide ARP claim.
    let mut s = SlirpStack::new(GW_MAC);
    let mut req = arp_request();
    req[38..42].copy_from_slice(&[10, 0, 2, 99]);
    s.inject(req);
    s.poll(10);
    assert!(s.take_egress().is_empty(), "ARP only for the gateway");
}

#[test]
fn does_not_impersonate_external_hosts() {
    // The critic CRITICALs: `any_ip` alone made smoltcp forge replies AS an external host for flows
    // we never opened. The frame filter must drop all three so slirp stays silent (0 egress):
    let ext = Ipv4Addr::new(8, 8, 8, 8);
    let mut s = SlirpStack::new(GW_MAC);
    s.inject(arp_request());
    s.poll(1);
    let _ = s.take_egress();

    // C1: guest ping to 8.8.8.8 must NOT get a forged echo reply.
    let mut ping = icmp_echo_request();
    // retarget the echo request's dst IP (bytes 14+16..14+20 = IP dst) to 8.8.8.8.
    ping[30..34].copy_from_slice(&ext.octets());
    s.inject(ping);
    s.poll(2);
    assert!(
        s.take_egress().is_empty(),
        "no forged ICMP echo reply as 8.8.8.8"
    );

    // C2: guest SYN to an external port we did NOT open_tcp must NOT get a forged RST.
    s.inject(tcp_syn(Ipv4Addr::new(93, 184, 216, 34), 41000, 80));
    s.poll(3);
    assert!(
        s.take_egress().is_empty(),
        "no forged RST for an un-opened flow"
    );

    // C3: guest UDP to 8.8.8.8:53 must NOT get a forged ICMP port-unreachable.
    s.inject(udp_to(ext, 40000, 53));
    s.poll(4);
    assert!(
        s.take_egress().is_empty(),
        "no forged ICMP unreachable as 8.8.8.8"
    );
}

/// A minimal guest→dst IPv4 UDP datagram (8-byte payload).
fn udp_to(dst: Ipv4Addr, src_port: u16, dst_port: u16) -> Vec<u8> {
    use smoltcp::wire::{UdpPacket, UdpRepr};
    let udp = UdpRepr { src_port, dst_port };
    let payload = [0u8; 8];
    let ip = Ipv4Repr {
        src_addr: net::GUEST,
        dst_addr: dst,
        next_header: smoltcp::wire::IpProtocol::Udp,
        payload_len: udp.header_len() + payload.len(),
        hop_limit: 64,
    };
    let eth = EthernetRepr {
        src_addr: smoltcp::wire::EthernetAddress(GUEST_MAC),
        dst_addr: smoltcp::wire::EthernetAddress(GW_MAC),
        ethertype: EthernetProtocol::Ipv4,
    };
    let mut buf = vec![0u8; eth.buffer_len() + ip.buffer_len() + udp.header_len() + payload.len()];
    let caps = smoltcp::phy::ChecksumCapabilities::default();
    let mut frame = EthernetFrame::new_unchecked(&mut buf);
    eth.emit(&mut frame);
    let mut ipp = Ipv4Packet::new_unchecked(frame.payload_mut());
    ip.emit(&mut ipp, &caps);
    let mut up = UdpPacket::new_unchecked(ipp.payload_mut());
    udp.emit(
        &mut up,
        &IpAddress::Ipv4(net::GUEST),
        &IpAddress::Ipv4(dst),
        payload.len(),
        |b| b.copy_from_slice(&payload),
        &caps,
    );
    buf
}
