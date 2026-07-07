//! Frame-injection tests for the smoltcp glue: inject a guest ARP request / ICMP echo and assert the
//! gateway (`10.0.2.2`) answers. Deterministic — no async, no boot: pure frame in → frame out.

use super::*;
use crate::net;

const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x00, 0x00, 0x02];

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

#[test]
fn unrelated_arp_for_another_ip_is_ignored() {
    // ARP for 10.0.2.99 (not ours) must NOT be answered.
    let mut s = SlirpStack::new(GW_MAC);
    let mut req = arp_request();
    req[38..42].copy_from_slice(&[10, 0, 2, 99]);
    s.inject(req);
    s.poll(10);
    assert!(
        s.take_egress().is_empty(),
        "we only answer ARP for our own IP"
    );
}
