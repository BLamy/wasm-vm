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
fn promiscuous_accept_makes_arp_claim_the_subnet() {
    // Documented behavior change from pass 2a: enabling `any_ip` for promiscuous TCP accept also
    // makes smoltcp answer ARP for in-subnet addresses (not just 10.0.2.2). This is HARMLESS — a real
    // guest routes all non-local traffic through the gateway and only ARPs 10.0.2.2; a stray ARP for
    // a nonexistent 10.0.2.99 getting the gateway MAC just means the guest's packet reaches us and is
    // dropped (in-subnet-non-local → `tcp::classify` returns Other).
    let mut s = SlirpStack::new(GW_MAC);
    let mut req = arp_request();
    req[38..42].copy_from_slice(&[10, 0, 2, 99]);
    s.inject(req);
    s.poll(10);
    assert_eq!(
        s.take_egress().len(),
        1,
        "any_ip claims the subnet for ARP (was ignored pre-promiscuous-accept)"
    );
}
