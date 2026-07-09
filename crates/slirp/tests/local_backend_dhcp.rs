//! E3-net slice 1a: the load-bearing proof that a booted browser guest gets an IP — a full DHCP
//! handshake driven through `SlirpLocalBackend`'s `NetBackend` API (DISCOVER → OFFER 10.0.2.15 →
//! REQUEST → ACK). Uses `build_udp_frame` (the pub UDP framer) + a hand-built BOOTP/DHCP payload, so
//! it exercises exactly the path a guest's `udhcpc` would. (Adapted from the pass-1a cold-clone
//! critic's probe, which is what confirmed DHCP actually flows through the synchronous backend.)
use std::net::Ipv4Addr;

use wasm_vm_core::dev::virtio::net::NetBackend;
use wasm_vm_slirp::{SlirpLocalBackend, build_udp_frame};

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
