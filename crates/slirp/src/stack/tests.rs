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

/// A general guest→dst TCP segment with explicit seq/ack/flags/payload (for hand-driven handshakes).
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
fn tcp_data_path_and_teardown() {
    // Drive a full handshake by hand, exchange bytes both ways, and tear the flow down — the
    // data-path methods (`tcp_recv`/`tcp_send`/`remove_tcp`) the async bridge will use. No boot.
    use smoltcp::socket::tcp::State;
    let ext = Ipv4Addr::new(93, 184, 216, 34);
    let mut s = SlirpStack::new(GW_MAC);
    s.inject(arp_request());
    s.poll(1);
    let _ = s.take_egress();
    let h = s.open_tcp(ext, 80);

    // Guest SYN (seq=1000) → slirp SYN-ACK; read slirp's ISN.
    s.inject(tcp_seg(ext, 40000, 80, 1000, None, true, &[]));
    s.poll(2);
    let sa = s.take_egress();
    assert_eq!(sa.len(), 1, "SYN-ACK");
    let ipp = Ipv4Packet::new_checked(&sa[0][14..]).unwrap();
    let tp = TcpPacket::new_checked(ipp.payload()).unwrap();
    assert!(tp.syn() && tp.ack());
    let isn = tp.seq_number().0 as i64;

    // Guest ACK (seq=1001, ack=ISN+1) → Established.
    s.inject(tcp_seg(ext, 40000, 80, 1001, Some(isn + 1), false, &[]));
    s.poll(3);
    let _ = s.take_egress();
    assert_eq!(
        s.tcp_state(h),
        Some(State::Established),
        "handshake completed"
    );

    // Guest → outbound: send "hello"; slirp buffers it, readable via tcp_recv.
    s.inject(tcp_seg(
        ext,
        40000,
        80,
        1001,
        Some(isn + 1),
        false,
        b"hello",
    ));
    s.poll(4);
    let _ = s.take_egress();
    assert_eq!(s.tcp_recv(h), b"hello", "guest bytes reach the flow socket");

    // Outbound → guest: tcp_send enqueues; a data segment carrying it egresses to the guest.
    assert_eq!(s.tcp_send(h, b"world"), 5);
    s.poll(5);
    let out = s.take_egress();
    assert!(
        out.iter().any(|f| f.windows(5).any(|w| w == b"world")),
        "slirp→guest data segment carries the bytes"
    );

    // Teardown frees the endpoint: a fresh SYN to it is now filtered (dropped).
    s.remove_tcp(h);
    s.inject(tcp_seg(ext, 40001, 80, 2000, None, true, &[]));
    s.poll(6);
    assert!(
        s.take_egress().is_empty(),
        "endpoint torn down → SYN dropped by the filter"
    );

    // Use-after-remove is SAFE, not a panic (critic MAJOR): the stale handle reads as no active flow.
    assert_eq!(s.tcp_state(h), None, "removed handle has no state");
    assert!(
        s.tcp_recv(h).is_empty(),
        "recv on a removed handle is empty"
    );
    assert_eq!(s.tcp_send(h, b"x"), 0, "send on a removed handle is 0");
    assert!(!s.tcp_can_send(h), "can_send on a removed handle is false");
    s.tcp_close(h); // no-op, must not panic
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
    assert_ne!(s.tcp_state(h), Some(smoltcp::socket::tcp::State::Listen));
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

// ── Internal-service UDP diversion (E3-T15 stack wiring) ─────────────────────
use crate::udp_frame::build_udp_frame;
use std::net::Ipv4Addr;

/// A tiny DHCP DISCOVER payload (option 53 = 1), enough for DhcpServer to answer.
fn dhcp_discover() -> Vec<u8> {
    let mut b = vec![0u8; 236];
    b[0] = 1;
    b[1] = 1;
    b[2] = 6;
    b[28..34].copy_from_slice(&GUEST_MAC);
    b.extend_from_slice(&[0x63, 0x82, 0x53, 0x63]); // magic cookie
    b.extend_from_slice(&[53, 1, 1]); // DISCOVER
    b.push(255);
    b
}

#[test]
fn dhcp_broadcast_frame_is_diverted_to_the_service_queue() {
    let mut s = SlirpStack::new(GW_MAC);
    // Guest DHCP DISCOVER: 0.0.0.0:68 → 255.255.255.255:67.
    let frame = build_udp_frame(
        GUEST_MAC,
        [0xff; 6],
        Ipv4Addr::UNSPECIFIED,
        68,
        Ipv4Addr::new(255, 255, 255, 255),
        67,
        &dhcp_discover(),
    )
    .unwrap();
    s.inject(frame);

    let diverted = s.take_service_udp();
    assert_eq!(
        diverted.len(),
        1,
        "the DHCP frame was diverted, not dropped"
    );
    assert_eq!(diverted[0].dst_port, 67);
    assert_eq!(diverted[0].src_port, 68);
    // It must NOT have gone to smoltcp (no auto-reply on poll).
    s.poll(1);
    assert!(
        s.take_egress().is_empty(),
        "smoltcp did not see the diverted UDP"
    );
}

#[test]
fn dns_query_to_our_resolver_is_diverted_external_dns_is_not() {
    let mut s = SlirpStack::new(GW_MAC);
    // DNS to 10.0.2.3:53 → diverted.
    let ours =
        build_udp_frame(GUEST_MAC, GW_MAC, net::GUEST, 40000, net::DNS, 53, b"query").unwrap();
    s.inject(ours);
    assert_eq!(
        s.take_service_udp().len(),
        1,
        "DNS to our resolver is diverted"
    );

    // DNS to an EXTERNAL server (8.8.8.8:53) → NOT diverted (a normal outbound flow), and dropped by
    // the filter (not injected as a forged reply) — nothing in the service queue OR egress.
    let ext = build_udp_frame(
        GUEST_MAC,
        GW_MAC,
        net::GUEST,
        40001,
        Ipv4Addr::new(8, 8, 8, 8),
        53,
        b"query",
    )
    .unwrap();
    s.inject(ext);
    assert!(
        s.take_service_udp().is_empty(),
        "external DNS is not intercepted"
    );
    s.poll(1);
    assert!(
        s.take_egress().is_empty(),
        "external UDP is not answered by the stack"
    );
}

#[test]
fn full_dhcp_path_through_the_stack_offer_egresses_to_the_guest() {
    use crate::dhcp::DhcpServer;
    let mut s = SlirpStack::new(GW_MAC);
    let dhcp = DhcpServer::new();

    // Inject a DISCOVER, dispatch it via DhcpServer, frame the OFFER back, and confirm it egresses.
    let frame = build_udp_frame(
        GUEST_MAC,
        [0xff; 6],
        Ipv4Addr::UNSPECIFIED,
        68,
        Ipv4Addr::new(255, 255, 255, 255),
        67,
        &dhcp_discover(),
    )
    .unwrap();
    s.inject(frame);

    for g in s.take_service_udp() {
        if let Some(reply) = dhcp.handle(&g.payload) {
            // A DHCP reply is broadcast from the gateway:67 to the client:68.
            let out = build_udp_frame(
                GW_MAC,
                g.src_mac,
                net::GATEWAY,
                67,
                Ipv4Addr::new(255, 255, 255, 255),
                68,
                &reply,
            )
            .unwrap();
            s.push_egress(out);
        }
    }

    let egress = s.take_egress();
    assert_eq!(egress.len(), 1, "the OFFER frame egressed to the guest");
    // It parses back as a UDP datagram from :67 to :68 carrying a DHCP OFFER (option 53 = 2).
    let g = parse_udp(&egress[0]).expect("egress is a valid UDP frame");
    assert_eq!(g.src_port, 67);
    assert_eq!(g.dst_port, 68);
    // yiaddr (offset 16..20 of the BOOTP payload) is the guest address.
    assert_eq!(&g.payload[16..20], &net::GUEST.octets());
}

#[test]
fn unicast_renew_to_gateway_is_diverted_not_double_handled() {
    // A DHCP RENEW unicast to the gateway (10.0.2.2:67) is the ONE case where `inject`'s divert-`return`
    // matters: without it, the frame would ALSO reach smoltcp (which owns 10.0.2.2 but has no UDP:67
    // socket) and emit a spurious ICMP port-unreachable to the guest. Prove the divert claims it AND
    // smoltcp never sees it (critic MINOR: this path was previously untested).
    let mut s = SlirpStack::new(GW_MAC);
    let frame = build_udp_frame(
        GUEST_MAC,
        GW_MAC,
        net::GUEST,
        68,
        net::GATEWAY, // unicast to the gateway, not broadcast
        67,
        &dhcp_discover(),
    )
    .unwrap();
    s.inject(frame);

    assert_eq!(
        s.take_service_udp().len(),
        1,
        "the unicast RENEW is diverted"
    );
    s.poll(1);
    assert!(
        s.take_egress().is_empty(),
        "smoltcp never saw it — no spurious ICMP port-unreachable"
    );
}

// ── run_dhcp: synchronous DHCP servicing through the stack ───────────────────
use crate::dhcp::DhcpServer;

/// A DHCP message of the given type (option 53), REQUEST also carrying option 50 = the wanted address.
fn dhcp_msg(msg_type: u8, requested: Option<Ipv4Addr>) -> Vec<u8> {
    let mut b = vec![0u8; 236];
    b[0] = 1;
    b[1] = 1;
    b[2] = 6;
    b[28..34].copy_from_slice(&GUEST_MAC);
    b.extend_from_slice(&[0x63, 0x82, 0x53, 0x63]);
    b.extend_from_slice(&[53, 1, msg_type]);
    if let Some(ip) = requested {
        b.extend_from_slice(&[50, 4]);
        b.extend_from_slice(&ip.octets());
    }
    b.push(255);
    b
}
fn inject_dhcp(s: &mut SlirpStack, msg: &[u8]) {
    let frame = build_udp_frame(
        GUEST_MAC,
        [0xff; 6],
        Ipv4Addr::UNSPECIFIED,
        68,
        Ipv4Addr::new(255, 255, 255, 255),
        67,
        msg,
    )
    .unwrap();
    s.inject(frame);
}
/// The DHCP message type of a reply frame's payload.
fn reply_dhcp_type(frame: &[u8]) -> Option<u8> {
    let g = parse_udp(frame)?;
    let p = &g.payload;
    let mut i = 240;
    while i + 1 < p.len() {
        if p[i] == 255 {
            break;
        }
        if p[i] == 0 {
            i += 1;
            continue;
        }
        let len = p[i + 1] as usize;
        if p[i] == 53 && len == 1 {
            return p.get(i + 2).copied();
        }
        i += 2 + len;
    }
    None
}

#[test]
fn run_dhcp_services_a_full_discover_request_handshake() {
    let mut s = SlirpStack::new(GW_MAC);
    let dhcp = DhcpServer::new();

    // DISCOVER → OFFER (broadcast reply from :67 to :68, yiaddr = guest).
    inject_dhcp(&mut s, &dhcp_msg(1, None));
    assert_eq!(s.run_dhcp(&dhcp), 1, "one OFFER sent");
    let eg = s.take_egress();
    assert_eq!(eg.len(), 1);
    assert_eq!(reply_dhcp_type(&eg[0]), Some(2), "OFFER");
    let g = parse_udp(&eg[0]).unwrap();
    assert_eq!(g.src_port, 67);
    assert_eq!(g.dst_port, 68);
    assert_eq!(
        g.dst_ip,
        Ipv4Addr::new(255, 255, 255, 255),
        "broadcast L3 (client has no IP)"
    );
    assert_eq!(g.src_mac, GW_MAC, "from the gateway MAC");
    assert_eq!(&g.payload[16..20], &net::GUEST.octets(), "yiaddr = guest");

    // REQUEST for our address → ACK.
    inject_dhcp(&mut s, &dhcp_msg(3, Some(net::GUEST)));
    assert_eq!(s.run_dhcp(&dhcp), 1, "one ACK sent");
    assert_eq!(reply_dhcp_type(&s.take_egress()[0]), Some(5), "ACK");
}

#[test]
fn run_dhcp_naks_a_wrong_address_request() {
    let mut s = SlirpStack::new(GW_MAC);
    let dhcp = DhcpServer::new();
    inject_dhcp(&mut s, &dhcp_msg(3, Some(Ipv4Addr::new(10, 0, 2, 99))));
    assert_eq!(s.run_dhcp(&dhcp), 1);
    assert_eq!(
        reply_dhcp_type(&s.take_egress()[0]),
        Some(6),
        "NAK for the wrong address"
    );
}

#[test]
fn run_dhcp_leaves_dns_datagrams_queued_for_the_async_layer() {
    let mut s = SlirpStack::new(GW_MAC);
    let dhcp = DhcpServer::new();
    // A DNS datagram to our resolver + a DHCP DISCOVER.
    let dns =
        build_udp_frame(GUEST_MAC, GW_MAC, net::GUEST, 40000, net::DNS, 53, b"query").unwrap();
    s.inject(dns);
    inject_dhcp(&mut s, &dhcp_msg(1, None));

    let sent = s.run_dhcp(&dhcp);
    assert_eq!(sent, 1, "the DHCP frame was serviced");
    // The DNS datagram is UNTOUCHED — still queued, addressing AND payload intact — for the async loop.
    let left = s.take_service_udp();
    assert_eq!(left.len(), 1, "the DNS datagram remains queued");
    assert_eq!(left[0].dst_ip, net::DNS);
    assert_eq!(left[0].dst_port, 53);
    assert_eq!(left[0].src_port, 40000);
    assert_eq!(left[0].payload, b"query", "payload not mutated");
}

// ── run_dns: asynchronous DNS servicing through the stack ────────────────────
use crate::resolver::{DnsForwarder, Resolution, Resolver};
use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

/// A resolver returning a fixed A record, counting upstream lookups (to prove the cache hit).
#[derive(Clone)]
struct FixedResolver {
    ip: Ipv4Addr,
    calls: Arc<AtomicUsize>,
}
impl Resolver for FixedResolver {
    #[allow(clippy::manual_async_fn)]
    fn resolve(&self, _name: &str) -> impl Future<Output = Resolution> + Send {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let ip = self.ip;
        async move {
            Resolution::Resolved {
                ips: vec![ip],
                ttl_secs: 120,
            }
        }
    }
}

/// The DNS transaction ID the test queries use — nonzero so the answer's echoed id is verifiable.
const DNS_TXID: u16 = 0xBEEF;

/// Inject a guest DNS A query for `name` from `src_port` to 10.0.2.3:53.
fn inject_dns(s: &mut SlirpStack, src_port: u16, name: &str) {
    let query = crate::dns::build_query(DNS_TXID, name, crate::dns::TYPE_A);
    let frame = build_udp_frame(
        GUEST_MAC,
        GW_MAC,
        net::GUEST,
        src_port,
        net::DNS,
        53,
        &query,
    )
    .unwrap();
    s.inject(frame);
}
/// The first A record IP in a DNS answer frame's payload.
fn answer_first_a(frame: &[u8]) -> Option<Ipv4Addr> {
    let g = parse_udp(frame)?;
    crate::dns::parse_response(&g.payload)?
        .a_records
        .first()
        .map(|(ip, _)| *ip)
}

#[tokio::test]
async fn run_dns_answers_a_query_back_to_the_guest() {
    let mut s = SlirpStack::new(GW_MAC);
    let calls = Arc::new(AtomicUsize::new(0));
    let mut fwd = DnsForwarder::new(
        FixedResolver {
            ip: Ipv4Addr::new(93, 184, 216, 34),
            calls: calls.clone(),
        },
        16,
    );

    inject_dns(&mut s, 40000, "example.com");
    assert_eq!(s.run_dns(&mut fwd, 0).await, 1, "one answer sent");

    let eg = s.take_egress();
    assert_eq!(eg.len(), 1);
    let g = parse_udp(&eg[0]).unwrap();
    assert_eq!(g.src_ip, net::DNS, "answer from the resolver");
    assert_eq!(g.src_port, 53);
    assert_eq!(
        g.dst_ip,
        net::GUEST,
        "unicast to the guest (it has its IP now)"
    );
    assert_eq!(g.dst_port, 40000, "back to the query's source port");
    assert_eq!(g.src_mac, GW_MAC);
    assert_eq!(
        answer_first_a(&eg[0]),
        Some(Ipv4Addr::new(93, 184, 216, 34))
    );
    // The answer echoes the query's transaction id (a resolver mismatching it would be dropped).
    assert_eq!(
        u16::from_be_bytes([g.payload[0], g.payload[1]]),
        DNS_TXID,
        "txid echoed"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn run_dns_serves_a_repeat_from_cache_without_re_resolving() {
    let mut s = SlirpStack::new(GW_MAC);
    let calls = Arc::new(AtomicUsize::new(0));
    let mut fwd = DnsForwarder::new(
        FixedResolver {
            ip: Ipv4Addr::new(1, 2, 3, 4),
            calls: calls.clone(),
        },
        16,
    );

    inject_dns(&mut s, 40000, "a.test");
    s.run_dns(&mut fwd, 1000).await;
    let _ = s.take_egress();
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    // A second query for the same name, a few seconds later → served from cache, no new lookup.
    inject_dns(&mut s, 40001, "a.test");
    assert_eq!(s.run_dns(&mut fwd, 5000).await, 1);
    assert_eq!(
        answer_first_a(&s.take_egress()[0]),
        Some(Ipv4Addr::new(1, 2, 3, 4))
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "the cache served the repeat"
    );
}

#[tokio::test]
async fn run_dns_leaves_dhcp_datagrams_queued_for_run_dhcp() {
    let mut s = SlirpStack::new(GW_MAC);
    let mut fwd = DnsForwarder::new(
        FixedResolver {
            ip: Ipv4Addr::new(1, 2, 3, 4),
            calls: Arc::new(AtomicUsize::new(0)),
        },
        16,
    );
    // A DHCP DISCOVER + a DNS query in the queue.
    inject_dhcp(&mut s, &dhcp_msg(1, None));
    inject_dns(&mut s, 40000, "example.com");

    assert_eq!(
        s.run_dns(&mut fwd, 0).await,
        1,
        "the DNS query was answered"
    );
    // The DHCP datagram is untouched — still queued for run_dhcp.
    let left = s.take_service_udp();
    assert_eq!(left.len(), 1, "the DHCP datagram remains queued");
    assert_eq!(left[0].dst_port, 67);
}

// ── service(): the unified event-loop entry point (full guest session) ───────
#[tokio::test]
async fn service_drives_a_full_guest_network_session_through_the_stack() {
    let mut s = SlirpStack::new(GW_MAC);
    let dhcp = DhcpServer::new();
    let calls = Arc::new(AtomicUsize::new(0));
    let mut fwd = DnsForwarder::new(
        FixedResolver {
            ip: Ipv4Addr::new(93, 184, 216, 34),
            calls: calls.clone(),
        },
        16,
    );

    // 1. The guest ARPs the gateway (smoltcp path, via poll) — this also teaches the neighbor entry.
    s.inject(arp_request());
    s.poll(0);
    assert_eq!(s.take_egress().len(), 1, "ARP reply");

    // 2. DHCP DISCOVER → service → OFFER.
    inject_dhcp(&mut s, &dhcp_msg(1, None));
    assert_eq!(s.service(&dhcp, &mut fwd, 1).await, 1);
    assert_eq!(reply_dhcp_type(&s.take_egress()[0]), Some(2), "OFFER");

    // 3. DHCP REQUEST → service → ACK.
    inject_dhcp(&mut s, &dhcp_msg(3, Some(net::GUEST)));
    assert_eq!(s.service(&dhcp, &mut fwd, 2).await, 1);
    assert_eq!(reply_dhcp_type(&s.take_egress()[0]), Some(5), "ACK");

    // 4. Now leased, the guest resolves a name → service → DNS answer to the guest.
    inject_dns(&mut s, 40000, "example.com");
    assert_eq!(s.service(&dhcp, &mut fwd, 3).await, 1);
    let ans = s.take_egress();
    let g = parse_udp(&ans[0]).unwrap();
    assert_eq!(g.dst_ip, net::GUEST);
    assert_eq!(g.dst_port, 40000);
    assert_eq!(
        answer_first_a(&ans[0]),
        Some(Ipv4Addr::new(93, 184, 216, 34))
    );
    assert_eq!(
        calls.load(Ordering::SeqCst),
        1,
        "one upstream lookup for the whole session"
    );
}

#[tokio::test]
async fn service_handles_dhcp_and_dns_in_one_tick() {
    let mut s = SlirpStack::new(GW_MAC);
    let dhcp = DhcpServer::new();
    let mut fwd = DnsForwarder::new(
        FixedResolver {
            ip: Ipv4Addr::new(1, 2, 3, 4),
            calls: Arc::new(AtomicUsize::new(0)),
        },
        16,
    );
    // Both a DHCP DISCOVER and a DNS query arrive in the same tick.
    inject_dhcp(&mut s, &dhcp_msg(1, None));
    inject_dns(&mut s, 40000, "example.com");

    assert_eq!(
        s.service(&dhcp, &mut fwd, 0).await,
        2,
        "both serviced in one call"
    );
    // Nothing left in the queue — both partitions drained.
    assert!(s.take_service_udp().is_empty(), "queue fully drained");

    // One OFFER + one DNS answer egressed (order-independent check).
    let eg = s.take_egress();
    assert_eq!(eg.len(), 2);
    let types: Vec<u16> = eg.iter().map(|f| parse_udp(f).unwrap().src_port).collect();
    assert!(types.contains(&67), "a DHCP reply (from :67)");
    assert!(types.contains(&53), "a DNS answer (from :53)");
}
