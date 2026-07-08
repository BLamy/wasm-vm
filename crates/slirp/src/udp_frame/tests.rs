//! UDP framing tests: build↔parse round-trip, valid checksums, field extraction from a real frame,
//! rejection of non-UDP / non-IPv4 / malformed frames, the oversized-payload guard, and a no-panic
//! fuzz sweep.

use super::*;
use smoltcp::wire::{IpAddress, Ipv4Packet, UdpPacket};

const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x00, 0x00, 0x02];
const GUEST_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 15);
const DNS_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 3);

/// Build a frame, asserting the helper accepted the payload.
fn build(payload: &[u8]) -> Vec<u8> {
    build_udp_frame(GW_MAC, GUEST_MAC, DNS_IP, 53, GUEST_IP, 40000, payload).expect("payload fits")
}

#[test]
fn build_then_parse_round_trips() {
    let payload = b"a dns query or dhcp message";
    let frame = build(payload);
    let g = parse_udp(&frame).expect("a built UDP frame parses");
    assert_eq!(g.src_mac, GW_MAC);
    assert_eq!(g.src_ip, DNS_IP);
    assert_eq!(g.src_port, 53);
    assert_eq!(g.dst_ip, GUEST_IP);
    assert_eq!(g.dst_port, 40000);
    assert_eq!(g.payload, payload);
}

#[test]
fn built_frame_has_valid_ip_and_udp_checksums() {
    // `parse_udp`'s `new_checked` validates lengths only, NOT checksums — so verify explicitly that a
    // real guest would accept the frame (critic: the round-trip is otherwise checksum-blind).
    for payload in [&b""[..], &b"x"[..], &b"a 27-byte example payload!!"[..]] {
        let frame = build(payload);
        let ip = Ipv4Packet::new_checked(&frame[14..]).unwrap();
        assert!(ip.verify_checksum(), "IP checksum valid");
        let udp = UdpPacket::new_checked(ip.payload()).unwrap();
        assert!(
            udp.verify_checksum(&IpAddress::Ipv4(DNS_IP), &IpAddress::Ipv4(GUEST_IP)),
            "UDP checksum valid"
        );
    }
}

#[test]
fn parses_a_guest_dhcp_broadcast() {
    // A guest DHCP DISCOVER: from the guest (0.0.0.0:68) to the broadcast (255.255.255.255:67).
    let payload = vec![1u8, 2, 3, 4];
    let frame = build_udp_frame(
        GUEST_MAC,
        [0xff; 6],
        Ipv4Addr::UNSPECIFIED,
        68,
        Ipv4Addr::new(255, 255, 255, 255),
        67,
        &payload,
    )
    .unwrap();
    let g = parse_udp(&frame).unwrap();
    assert_eq!(g.src_port, 68);
    assert_eq!(g.dst_ip, Ipv4Addr::new(255, 255, 255, 255));
    assert_eq!(g.dst_port, 67);
    assert_eq!(g.payload, payload);
}

#[test]
fn empty_payload_round_trips() {
    let frame = build(&[]);
    let g = parse_udp(&frame).unwrap();
    assert!(g.payload.is_empty());
    assert_eq!(g.dst_port, 40000);
}

#[test]
fn max_payload_frames_but_oversized_is_rejected() {
    // The largest legal UDP-over-IPv4 payload frames fine...
    let max = vec![0xabu8; MAX_UDP_PAYLOAD];
    let frame = build_udp_frame(GW_MAC, GUEST_MAC, DNS_IP, 53, GUEST_IP, 40000, &max)
        .expect("MAX_UDP_PAYLOAD fits");
    assert_eq!(parse_udp(&frame).unwrap().payload.len(), MAX_UDP_PAYLOAD);

    // ...one byte more would overflow the u16 IPv4 total_length → rejected, NOT a panic (critic MINOR).
    let too_big = vec![0u8; MAX_UDP_PAYLOAD + 1];
    assert!(
        build_udp_frame(GW_MAC, GUEST_MAC, DNS_IP, 53, GUEST_IP, 40000, &too_big).is_none(),
        "an oversized payload is rejected, not framed (no total_length overflow / panic)"
    );
}

#[test]
fn non_udp_and_non_ipv4_are_rejected() {
    // An ARP frame (ethertype 0x0806) → None.
    let mut arp = vec![0u8; 42];
    arp[12] = 0x08;
    arp[13] = 0x06;
    assert!(parse_udp(&arp).is_none(), "ARP is not UDP");

    // An IPv4 TCP frame → None (next_header = TCP=6, not UDP=17). Build a UDP frame then flip the
    // protocol byte so it's structurally a non-UDP IPv4 packet.
    let mut tcpish = build(b"x");
    // IPv4 protocol field is at ethernet(14) + 9 = 23.
    tcpish[23] = 6; // TCP
    assert!(
        parse_udp(&tcpish).is_none(),
        "a TCP-protocol IPv4 packet is not UDP"
    );
}

#[test]
fn malformed_frames_never_panic() {
    assert!(parse_udp(&[]).is_none());
    assert!(
        parse_udp(&[0u8; 10]).is_none(),
        "shorter than an ethernet header"
    );
    assert!(parse_udp(&[0u8; 20]).is_none(), "no room for IPv4 + UDP");

    // Every truncation + single-byte corruption of a valid UDP frame must be handled without panic.
    let valid = build(b"hello");
    for cut in 0..valid.len() {
        let _ = parse_udp(&valid[..cut]);
    }
    for i in 0..valid.len() {
        let mut m = valid.clone();
        m[i] ^= 0xff;
        let _ = parse_udp(&m); // any result, just no panic
    }
}
