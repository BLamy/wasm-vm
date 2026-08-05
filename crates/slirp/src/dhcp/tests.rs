//! DHCP server tests: real wire-format DISCOVER/REQUEST in, assert OFFER/ACK/NAK out, plus
//! malformed-input fuzzing (the adversarial charter: no panic, no bogus reply on garbage).

use super::*;
use crate::net;
use std::net::Ipv4Addr;

const XID: [u8; 4] = [0xde, 0xad, 0xbe, 0xef];
const CHADDR: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];

/// Build a client BOOTREQUEST with the given message type, optional requested-IP (option 50), and
/// ciaddr — mirroring what `udhcpc` puts on the wire.
fn build_req(msg_type: u8, requested_ip: Option<Ipv4Addr>, ciaddr: Ipv4Addr) -> Vec<u8> {
    let mut b = vec![0u8; BOOTP_LEN];
    b[0] = 1; // op = BOOTREQUEST
    b[1] = 1; // htype = Ethernet
    b[2] = 6; // hlen
    b[4..8].copy_from_slice(&XID);
    b[12..16].copy_from_slice(&ciaddr.octets());
    b[28..34].copy_from_slice(&CHADDR);
    b.extend_from_slice(&MAGIC);
    push_opt(&mut b, OPT_MSG_TYPE, &[msg_type]);
    if let Some(ip) = requested_ip {
        push_opt(&mut b, OPT_REQUESTED_IP, &ip.octets());
    }
    b.push(OPT_END);
    b
}

/// Extract an option's value from a reply, walking the TLVs after the magic cookie.
fn reply_opt(reply: &[u8], code: u8) -> Option<Vec<u8>> {
    let mut i = BOOTP_LEN + 4;
    while i < reply.len() {
        let c = reply[i];
        if c == OPT_END {
            break;
        }
        if c == OPT_PAD {
            i += 1;
            continue;
        }
        let len = reply[i + 1] as usize;
        if c == code {
            return Some(reply[i + 2..i + 2 + len].to_vec());
        }
        i += 2 + len;
    }
    None
}

fn reply_type(reply: &[u8]) -> u8 {
    reply_opt(reply, OPT_MSG_TYPE).expect("reply has a message-type option")[0]
}
fn yiaddr(reply: &[u8]) -> Ipv4Addr {
    Ipv4Addr::new(reply[16], reply[17], reply[18], reply[19])
}

#[test]
fn discover_gets_a_correct_offer() {
    let reply = DhcpServer::new()
        .handle(&build_req(DISCOVER, None, Ipv4Addr::UNSPECIFIED))
        .expect("DISCOVER is answered");
    assert_eq!(reply_type(&reply), OFFER);
    assert_eq!(reply[0], 2, "op = BOOTREPLY");
    assert_eq!(yiaddr(&reply), net::GUEST, "offers the guest address");
    assert_eq!(reply[4..8], XID, "xid echoed");
    assert_eq!(reply[28..34], CHADDR, "client MAC echoed");
    assert_eq!(
        reply_opt(&reply, OPT_SERVER_ID).unwrap(),
        net::GATEWAY.octets()
    );
    assert_eq!(
        reply_opt(&reply, OPT_ROUTER).unwrap(),
        net::GATEWAY.octets()
    );
    assert_eq!(reply_opt(&reply, OPT_DNS).unwrap(), net::DNS.octets());
    assert_eq!(
        reply_opt(&reply, OPT_SUBNET_MASK).unwrap(),
        [255, 255, 255, 0],
        "/24 mask"
    );
    assert_eq!(
        reply_opt(&reply, OPT_LEASE_TIME).unwrap(),
        DEFAULT_LEASE_SECS.to_be_bytes()
    );
    assert_eq!(
        reply_opt(&reply, OPT_MTU).unwrap(),
        DEFAULT_MTU.to_be_bytes(),
        "advertises the link MTU"
    );
}

#[test]
fn request_for_our_address_gets_ack() {
    let reply = DhcpServer::new()
        .handle(&build_req(REQUEST, Some(net::GUEST), Ipv4Addr::UNSPECIFIED))
        .expect("REQUEST is answered");
    assert_eq!(reply_type(&reply), ACK);
    assert_eq!(yiaddr(&reply), net::GUEST);
    assert_eq!(
        reply_opt(&reply, OPT_LEASE_TIME).unwrap(),
        DEFAULT_LEASE_SECS.to_be_bytes()
    );
}

#[test]
fn renew_via_ciaddr_gets_ack() {
    // A unicast RENEW carries the address in ciaddr, not option 50.
    let reply = DhcpServer::new()
        .handle(&build_req(REQUEST, None, net::GUEST))
        .expect("RENEW is answered");
    assert_eq!(reply_type(&reply), ACK);
    assert_eq!(yiaddr(&reply), net::GUEST);
}

#[test]
fn diagnostics_distinguish_initial_request_from_renew_ack() {
    let server = DhcpServer::new();
    let stats = server.stats_handle();

    server
        .handle(&build_req(DISCOVER, None, Ipv4Addr::UNSPECIFIED))
        .unwrap();
    server
        .handle(&build_req(REQUEST, Some(net::GUEST), Ipv4Addr::UNSPECIFIED))
        .unwrap();
    server
        .handle(&build_req(REQUEST, None, net::GUEST))
        .unwrap();
    server
        .handle(&build_req(
            REQUEST,
            Some(Ipv4Addr::new(10, 0, 2, 99)),
            Ipv4Addr::UNSPECIFIED,
        ))
        .unwrap();

    assert_eq!(
        stats.snapshot(),
        DhcpStats {
            discovers: 1,
            offers: 1,
            requests: 3,
            acks: 2,
            renew_requests: 1,
            renew_acks: 1,
            naks: 1,
        }
    );
}

#[test]
fn request_for_wrong_address_gets_nak() {
    let wrong = Ipv4Addr::new(10, 0, 2, 99);
    let reply = DhcpServer::new()
        .handle(&build_req(REQUEST, Some(wrong), Ipv4Addr::UNSPECIFIED))
        .expect("a wrong-address REQUEST is answered");
    assert_eq!(
        reply_type(&reply),
        NAK,
        "wrong address → NAK so udhcpc restarts"
    );
    assert_eq!(
        yiaddr(&reply),
        Ipv4Addr::UNSPECIFIED,
        "a NAK carries no address"
    );
    assert_eq!(
        reply_opt(&reply, OPT_SERVER_ID).unwrap(),
        net::GATEWAY.octets()
    );
    assert!(
        reply_opt(&reply, OPT_LEASE_TIME).is_none(),
        "NAK offers no lease"
    );
}

#[test]
fn request_selecting_a_different_server_is_ignored() {
    // A SELECTING REQUEST (option 54) naming another DHCP server must NOT be answered by us.
    let mut other = build_req(REQUEST, Some(net::GUEST), Ipv4Addr::UNSPECIFIED);
    assert_eq!(other.pop(), Some(OPT_END));
    push_opt(
        &mut other,
        OPT_SERVER_ID,
        &Ipv4Addr::new(10, 0, 2, 200).octets(),
    );
    other.push(OPT_END);
    assert!(
        DhcpServer::new().handle(&other).is_none(),
        "REQUEST selecting a different server is ignored"
    );

    // The same REQUEST naming US (the gateway) is ACKed.
    let mut ours = build_req(REQUEST, Some(net::GUEST), Ipv4Addr::UNSPECIFIED);
    ours.pop();
    push_opt(&mut ours, OPT_SERVER_ID, &net::GATEWAY.octets());
    ours.push(OPT_END);
    assert_eq!(reply_type(&DhcpServer::new().handle(&ours).unwrap()), ACK);
}

#[test]
fn short_lease_is_reflected() {
    let reply = DhcpServer::new()
        .with_lease_secs(60)
        .handle(&build_req(REQUEST, Some(net::GUEST), Ipv4Addr::UNSPECIFIED))
        .unwrap();
    assert_eq!(
        reply_opt(&reply, OPT_LEASE_TIME).unwrap(),
        60u32.to_be_bytes()
    );
}

#[test]
fn custom_mtu_is_advertised() {
    let reply = DhcpServer::new()
        .with_mtu(1400)
        .handle(&build_req(DISCOVER, None, Ipv4Addr::UNSPECIFIED))
        .unwrap();
    assert_eq!(reply_opt(&reply, OPT_MTU).unwrap(), 1400u16.to_be_bytes());
}

#[test]
fn non_request_types_get_no_reply() {
    // RELEASE (7) / DECLINE (4) / INFORM (8) need no reply for a static single lease.
    for ty in [4u8, 7, 8] {
        assert!(
            DhcpServer::new()
                .handle(&build_req(ty, None, net::GUEST))
                .is_none(),
            "message type {ty} should get no reply"
        );
    }
}

#[test]
fn bootreply_op_is_ignored() {
    // A message with op=BOOTREPLY (2) isn't a client request; ignore it.
    let mut req = build_req(DISCOVER, None, Ipv4Addr::UNSPECIFIED);
    req[0] = 2;
    assert!(DhcpServer::new().handle(&req).is_none());
}

#[test]
fn malformed_messages_never_panic_and_yield_no_reply() {
    let s = DhcpServer::new();
    // Empty / too short for the BOOTP header + cookie.
    assert!(s.handle(&[]).is_none());
    assert!(s.handle(&[0u8; 100]).is_none());
    assert!(s.handle(&[0u8; BOOTP_LEN]).is_none(), "no magic cookie");

    // Right length but wrong magic cookie.
    let mut bad_magic = vec![0u8; BOOTP_LEN + 4];
    bad_magic[0] = 1;
    assert!(s.handle(&bad_magic).is_none());

    // Valid header + cookie but NO message-type option → not a DHCP message.
    let mut no_type = vec![0u8; BOOTP_LEN];
    no_type[0] = 1;
    no_type.extend_from_slice(&MAGIC);
    no_type.push(OPT_END);
    assert!(s.handle(&no_type).is_none());

    // Option claims a length that runs past the buffer end — must not panic.
    let mut bad_len = vec![0u8; BOOTP_LEN];
    bad_len[0] = 1;
    bad_len.extend_from_slice(&MAGIC);
    bad_len.push(OPT_MSG_TYPE);
    bad_len.push(200); // claims 200 bytes of value...
    bad_len.push(DISCOVER); // ...but only 1 present
    assert!(s.handle(&bad_len).is_none());

    // Option code with no length byte at all (truncated mid-option).
    let mut trunc = vec![0u8; BOOTP_LEN];
    trunc[0] = 1;
    trunc.extend_from_slice(&MAGIC);
    trunc.push(OPT_REQUESTED_IP); // dangling code, no len
    assert!(s.handle(&trunc).is_none());

    // Fuzz: every truncation of a valid DISCOVER must be handled without panicking.
    let full = build_req(DISCOVER, Some(net::GUEST), net::GUEST);
    for cut in 0..full.len() {
        let _ = s.handle(&full[..cut]); // just must not panic
    }
    // Fuzz: single-byte corruptions across a valid packet.
    for i in 0..full.len() {
        let mut m = full.clone();
        m[i] ^= 0xff;
        let _ = s.handle(&m); // must not panic; any reply is fine as long as it's well-formed
    }
}

#[test]
fn subnet_mask_prefixes() {
    assert_eq!(subnet_mask(24), [255, 255, 255, 0]);
    assert_eq!(subnet_mask(8), [255, 0, 0, 0]);
    assert_eq!(subnet_mask(0), [0, 0, 0, 0]);
    assert_eq!(subnet_mask(32), [255, 255, 255, 255]);
}
