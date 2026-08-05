//! E3-net slice 1a: the load-bearing proof that a booted browser guest gets an IP — a full DHCP
//! handshake driven through `SlirpLocalBackend`'s `NetBackend` API (DISCOVER → OFFER 10.0.2.15 →
//! REQUEST → ACK). Uses `build_udp_frame` (the pub UDP framer) + a hand-built BOOTP/DHCP payload, so
//! it exercises exactly the path a guest's `udhcpc` would. (Adapted from the pass-1a cold-clone
//! critic's probe, which is what confirmed DHCP actually flows through the synchronous backend.)
use std::net::Ipv4Addr;

use wasm_vm_core::dev::virtio::net::{NetBackend, PcapBackend};
use wasm_vm_slirp::{DhcpServer, SlirpLocalBackend, build_udp_frame};

const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x02];

/// A minimal BOOTREQUEST DHCP message with option 53 = `msg_type` (+ option 50 requested-IP for
/// REQUEST). 236-byte BOOTP fixed header, magic cookie, options, END.
fn dhcp_msg(msg_type: u8, requested: Option<Ipv4Addr>) -> Vec<u8> {
    let mut b = vec![0u8; 236];
    b[0] = 1; // op = BOOTREQUEST
    b[1] = 1; // htype = ethernet
    b[2] = 6; // hlen
    b[28..34].copy_from_slice(&GUEST_MAC); // chaddr
    b.extend_from_slice(&[0x63, 0x82, 0x53, 0x63]); // magic cookie
    b.extend_from_slice(&[53, 1, msg_type]); // option 53: DHCP message type
    if let Some(ip) = requested {
        b.extend_from_slice(&[50, 4]); // option 50: requested IP
        b.extend_from_slice(&ip.octets());
    }
    b.push(255); // END
    b
}

fn dhcp_frame(msg_type: u8, requested: Option<Ipv4Addr>) -> Vec<u8> {
    build_udp_frame(
        GUEST_MAC,
        [0xff; 6],
        Ipv4Addr::UNSPECIFIED,
        68,
        Ipv4Addr::new(255, 255, 255, 255),
        67,
        &dhcp_msg(msg_type, requested),
    )
    .expect("build DHCP UDP frame")
}

fn dhcp_renew_frame() -> Vec<u8> {
    let mut message = dhcp_msg(3, None);
    message[12..16].copy_from_slice(&Ipv4Addr::new(10, 0, 2, 15).octets()); // ciaddr at T1
    build_udp_frame(
        GUEST_MAC,
        GW_MAC,
        Ipv4Addr::new(10, 0, 2, 15),
        68,
        Ipv4Addr::new(10, 0, 2, 2),
        67,
        &message,
    )
    .expect("build unicast DHCP RENEW")
}

/// Parse a DHCP reply frame → (dhcp message type, yiaddr). eth(14)+ip(20)+udp(8)=42 header bytes.
fn parse_dhcp_reply(frame: &[u8]) -> Option<(u8, Ipv4Addr)> {
    if frame.len() < 42 + 240 {
        return None;
    }
    let bootp = &frame[42..];
    if bootp[0] != 2 {
        return None; // BOOTREPLY only
    }
    let yiaddr = Ipv4Addr::new(bootp[16], bootp[17], bootp[18], bootp[19]);
    let mut i = 240; // options start after the 236-byte header + 4-byte magic cookie
    let mut mtype = 0;
    while i + 1 < bootp.len() {
        let opt = bootp[i];
        if opt == 255 {
            break;
        }
        if opt == 0 {
            i += 1;
            continue;
        }
        let len = bootp[i + 1] as usize;
        if opt == 53 && len == 1 {
            mtype = bootp[i + 2];
        }
        i += 2 + len;
    }
    Some((mtype, yiaddr))
}

fn drain_dhcp(be: &mut SlirpLocalBackend) -> Option<(u8, Ipv4Addr)> {
    let mut last = None;
    while let Some(f) = be.rx() {
        if let Some(reply) = parse_dhcp_reply(&f) {
            last = Some(reply);
        }
    }
    last
}

#[test]
fn full_dhcp_handshake_through_local_backend_gives_guest_an_ip() {
    let mut be = SlirpLocalBackend::new(GW_MAC, Box::new(|| 0));

    // DISCOVER → OFFER (type 2) for 10.0.2.15, produced synchronously by tx()'s service().
    be.tx(&dhcp_frame(1, None));
    let (otype, yiaddr) = drain_dhcp(&mut be).expect("DISCOVER produced no DHCP reply");
    assert_eq!(otype, 2, "expected DHCP OFFER (type 2), got {otype}");
    assert_eq!(yiaddr, Ipv4Addr::new(10, 0, 2, 15), "offered wrong IP");

    // REQUEST the offered IP → ACK (type 5): the guest's eth0 is now configured.
    be.tx(&dhcp_frame(3, Some(yiaddr)));
    let (atype, ayiaddr) = drain_dhcp(&mut be).expect("REQUEST produced no DHCP reply");
    assert_eq!(atype, 5, "expected DHCP ACK (type 5), got {atype}");
    assert_eq!(ayiaddr, Ipv4Addr::new(10, 0, 2, 15));
}

#[test]
fn wrong_address_is_naked_then_client_recovers_to_the_static_lease() {
    let mut be = SlirpLocalBackend::new(GW_MAC, Box::new(|| 0));

    be.tx(&dhcp_frame(3, Some(Ipv4Addr::new(10, 0, 2, 99))));
    let (kind, address) = drain_dhcp(&mut be).expect("wrong-address REQUEST produced no reply");
    assert_eq!(
        (kind, address),
        (6, Ipv4Addr::UNSPECIFIED),
        "expected DHCP NAK"
    );

    // BusyBox udhcpc restarts discovery after the NAK and accepts our one static lease.
    be.tx(&dhcp_frame(1, None));
    let (kind, offered) = drain_dhcp(&mut be).expect("recovery DISCOVER produced no OFFER");
    assert_eq!((kind, offered), (2, Ipv4Addr::new(10, 0, 2, 15)));
    be.tx(&dhcp_frame(3, Some(offered)));
    let (kind, leased) = drain_dhcp(&mut be).expect("recovery REQUEST produced no ACK");
    assert_eq!((kind, leased), (5, offered));
}

#[test]
fn short_lease_renew_is_acked_and_the_exchange_is_a_parseable_pcap() {
    let backend = SlirpLocalBackend::new(GW_MAC, Box::new(|| 30_000))
        .with_dhcp_server(DhcpServer::new().with_lease_secs(60));
    let mut capture = PcapBackend::new(backend);

    capture.tx(&dhcp_frame(1, None));
    let (kind, offered) = drain_dhcp_capture(&mut capture).expect("OFFER");
    assert_eq!((kind, offered), (2, Ipv4Addr::new(10, 0, 2, 15)));
    capture.tx(&dhcp_frame(3, Some(offered)));
    assert_eq!(drain_dhcp_capture(&mut capture).unwrap().0, 5);

    // At T1 (half of a 60-second lease), udhcpc unicasts REQUEST with ciaddr and no option 50.
    capture.tx(&dhcp_renew_frame());
    let (kind, renewed) = drain_dhcp_capture(&mut capture).expect("RENEW ACK");
    assert_eq!((kind, renewed), (5, offered));
    assert_eq!(capture.frame_count(), 6, "three requests + three replies");
    assert_eq!(&capture.pcap()[0..4], &0xa1b2c3d4u32.to_le_bytes());
}

fn drain_dhcp_capture(backend: &mut PcapBackend<SlirpLocalBackend>) -> Option<(u8, Ipv4Addr)> {
    let mut last = None;
    while let Some(frame) = backend.rx() {
        if let Some(reply) = parse_dhcp_reply(&frame) {
            last = Some(reply);
        }
    }
    last
}
