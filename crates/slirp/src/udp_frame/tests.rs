//! UDP framing tests: build↔parse round-trip, field extraction from a real frame, rejection of
//! non-UDP / non-IPv4 / malformed frames, and a no-panic fuzz sweep.

use super::*;

const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x00, 0x00, 0x02];
const GUEST_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 15);
const DNS_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 3);

#[test]
fn build_then_parse_round_trips() {
    let payload = b"a dns query or dhcp message";
    let frame = build_udp_frame(GW_MAC, GUEST_MAC, DNS_IP, 53, GUEST_IP, 40000, payload);
    let g = parse_udp(&frame).expect("a built UDP frame parses");
    assert_eq!(g.src_mac, GW_MAC);
    assert_eq!(g.src_ip, DNS_IP);
    assert_eq!(g.src_port, 53);
    assert_eq!(g.dst_ip, GUEST_IP);
    assert_eq!(g.dst_port, 40000);
    assert_eq!(g.payload, payload);
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
    );
    let g = parse_udp(&frame).unwrap();
    assert_eq!(g.src_port, 68);
    assert_eq!(g.dst_ip, Ipv4Addr::new(255, 255, 255, 255));
    assert_eq!(g.dst_port, 67);
    assert_eq!(g.payload, payload);
}

#[test]
fn empty_payload_round_trips() {
    let frame = build_udp_frame(GW_MAC, GUEST_MAC, DNS_IP, 53, GUEST_IP, 40000, &[]);
    let g = parse_udp(&frame).unwrap();
    assert!(g.payload.is_empty());
    assert_eq!(g.dst_port, 40000);
}

#[test]
fn non_udp_and_non_ipv4_are_rejected() {
    // An ARP frame (ethertype 0x0806) → None.
    let mut arp = vec![0u8; 42];
    arp[12] = 0x08;
    arp[13] = 0x06;
    assert!(parse_udp(&arp).is_none(), "ARP is not UDP");

    // An IPv4 TCP frame → None (next_header = TCP=6, not UDP=17). Build a UDP frame then flip the
    // protocol byte and length so it's structurally a non-UDP IPv4 packet.
    let mut tcpish = build_udp_frame(GUEST_MAC, GW_MAC, GUEST_IP, 12345, DNS_IP, 53, b"x");
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
    let valid = build_udp_frame(GW_MAC, GUEST_MAC, DNS_IP, 53, GUEST_IP, 40000, b"hello");
    for cut in 0..valid.len() {
        let _ = parse_udp(&valid[..cut]);
    }
    for i in 0..valid.len() {
        let mut m = valid.clone();
        m[i] ^= 0xff;
        let _ = parse_udp(&m); // any result, just no panic
    }
}
