//! Internal DHCP server (E3-T15) — hands the guest its lease with zero config, so stock `udhcpc`
//! brings `eth0` up on its own. A single STATIC lease (the guest is always `10.0.2.15`), but the
//! DISCOVER/OFFER/REQUEST/ACK/NAK state machine must be correct because `udhcpc` retries and renews
//! for the tab's lifetime. This module is the pure wire layer: parse a DHCP message off the UDP:67
//! payload and produce the reply bytes; wiring it into the slirp UDP path is a later slice. No tokio,
//! no async — it fits the browser build too.
//!
//! Parsing is defensively bounds-checked: any malformed message (truncated header, no magic cookie,
//! missing/short options, no message-type) yields `None` rather than a panic or a bogus reply.

use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};

use crate::net;

/// The DHCP magic cookie that precedes the options field (RFC 2131).
const MAGIC: [u8; 4] = [0x63, 0x82, 0x53, 0x63];
/// BOOTP fixed header length (op … file), before the magic cookie.
const BOOTP_LEN: usize = 236;

// DHCP message types (option 53).
const DISCOVER: u8 = 1;
const OFFER: u8 = 2;
const REQUEST: u8 = 3;
const ACK: u8 = 5;
const NAK: u8 = 6;

// DHCP option codes we read / write.
const OPT_SUBNET_MASK: u8 = 1;
const OPT_ROUTER: u8 = 3;
const OPT_DNS: u8 = 6;
const OPT_MTU: u8 = 26;
const OPT_REQUESTED_IP: u8 = 50;
const OPT_LEASE_TIME: u8 = 51;
const OPT_MSG_TYPE: u8 = 53;
const OPT_SERVER_ID: u8 = 54;
const OPT_END: u8 = 255;
const OPT_PAD: u8 = 0;

/// Default lease time — 24 h. (RFC-style "infinite-ish" for a single-tenant slirp.)
pub const DEFAULT_LEASE_SECS: u32 = 86_400;
/// Default link MTU we advertise (option 26). Transports that impose a smaller effective MTU should
/// override this so the guest sizes segments correctly instead of hitting fragmentation later.
pub const DEFAULT_MTU: u16 = 1500;

/// The fields we care about from an inbound DHCP message.
struct Msg {
    op: u8,
    xid: [u8; 4],
    flags: u16,
    ciaddr: Ipv4Addr,
    chaddr: [u8; 6],
    msg_type: u8,
    requested_ip: Option<Ipv4Addr>,
    server_id: Option<Ipv4Addr>,
}

/// Monotonic counters for DHCP exchanges observed by the production server.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DhcpStats {
    pub discovers: u32,
    pub offers: u32,
    pub requests: u32,
    pub acks: u32,
    pub renew_requests: u32,
    pub renew_acks: u32,
    pub naks: u32,
}

/// Shared, read-only-from-the-outside DHCP counters. The boot harness keeps a clone so recorded runs
/// can prove that the real guest client sent a RENEW and received an ACK, rather than inferring it
/// from an address that might merely not have expired yet.
#[derive(Debug, Clone, Default)]
pub struct DhcpStatsHandle(Arc<Mutex<DhcpStats>>);

impl DhcpStatsHandle {
    pub fn snapshot(&self) -> DhcpStats {
        *self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn record(&self, update: impl FnOnce(&mut DhcpStats)) {
        let mut stats = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        update(&mut stats);
    }
}

/// A zero-config DHCP server that always leases `net::GUEST` to whoever asks.
#[derive(Debug, Clone)]
pub struct DhcpServer {
    lease_secs: u32,
    mtu: u16,
    stats: DhcpStatsHandle,
}

impl Default for DhcpServer {
    fn default() -> Self {
        Self::new()
    }
}

impl DhcpServer {
    pub fn new() -> Self {
        DhcpServer {
            lease_secs: DEFAULT_LEASE_SECS,
            mtu: DEFAULT_MTU,
            stats: DhcpStatsHandle::default(),
        }
    }

    /// Cloneable diagnostics handle used by native/browser acceptance recordings.
    pub fn stats_handle(&self) -> DhcpStatsHandle {
        self.stats.clone()
    }

    /// Shorten the lease (tests use ~60 s to observe a RENEW→ACK).
    pub fn with_lease_secs(mut self, secs: u32) -> Self {
        self.lease_secs = secs;
        self
    }

    /// Advertise a smaller link MTU (option 26) — e.g. when a transport imposes one.
    pub fn with_mtu(mut self, mtu: u16) -> Self {
        self.mtu = mtu;
        self
    }

    /// Handle one DHCP message (the raw BOOTP+options payload of a UDP:67 datagram). Returns the
    /// reply payload to send back to the client, or `None` if the message is malformed, not a
    /// request we answer, or otherwise needs no reply.
    pub fn handle(&self, payload: &[u8]) -> Option<Vec<u8>> {
        let m = parse(payload)?;
        if m.op != 1 {
            return None; // only BOOTREQUEST (op=1) is a client asking us
        }
        match m.msg_type {
            DISCOVER => {
                self.stats.record(|stats| {
                    stats.discovers = stats.discovers.saturating_add(1);
                    stats.offers = stats.offers.saturating_add(1);
                });
                Some(self.reply(&m, OFFER))
            }
            REQUEST => {
                let is_renew = m.requested_ip.is_none() && !m.ciaddr.is_unspecified();
                self.stats.record(|stats| {
                    stats.requests = stats.requests.saturating_add(1);
                    if is_renew {
                        stats.renew_requests = stats.renew_requests.saturating_add(1);
                    }
                });
                // If the client is SELECTING a specific server (option 54) and it isn't us, this
                // REQUEST is meant for another DHCP server — stay silent (don't NAK a peer's lease).
                if let Some(sid) = m.server_id
                    && sid != net::GATEWAY
                {
                    return None;
                }
                // The address the client is committing to: option 50 (SELECTING/REBINDING) or, on a
                // RENEW/unicast REQUEST, ciaddr. If it isn't the address we lease, NAK so udhcpc
                // restarts cleanly instead of using a wrong address.
                let wants = m.requested_ip.unwrap_or(m.ciaddr);
                if wants == net::GUEST {
                    self.stats.record(|stats| {
                        stats.acks = stats.acks.saturating_add(1);
                        if is_renew {
                            stats.renew_acks = stats.renew_acks.saturating_add(1);
                        }
                    });
                    Some(self.reply(&m, ACK))
                } else {
                    self.stats
                        .record(|stats| stats.naks = stats.naks.saturating_add(1));
                    Some(self.reply(&m, NAK))
                }
            }
            // DECLINE/RELEASE/INFORM and anything else: nothing to send for a static single lease.
            _ => None,
        }
    }

    /// Build an OFFER/ACK/NAK reply for `req`.
    fn reply(&self, req: &Msg, kind: u8) -> Vec<u8> {
        let mut b = vec![0u8; BOOTP_LEN];
        b[0] = 2; // op = BOOTREPLY
        b[1] = 1; // htype = Ethernet
        b[2] = 6; // hlen
        b[4..8].copy_from_slice(&req.xid);
        b[10..12].copy_from_slice(&req.flags.to_be_bytes());
        // A NAK carries no address; OFFER/ACK put the lease in yiaddr.
        if kind != NAK {
            b[16..20].copy_from_slice(&net::GUEST.octets()); // yiaddr
            b[20..24].copy_from_slice(&net::GATEWAY.octets()); // siaddr (next server = us)
        }
        b[28..34].copy_from_slice(&req.chaddr); // chaddr (client MAC)
        b.extend_from_slice(&MAGIC);

        // Options.
        push_opt(&mut b, OPT_MSG_TYPE, &[kind]);
        push_opt(&mut b, OPT_SERVER_ID, &net::GATEWAY.octets());
        if kind == NAK {
            b.push(OPT_END);
            return b;
        }
        push_opt(&mut b, OPT_LEASE_TIME, &self.lease_secs.to_be_bytes());
        push_opt(&mut b, OPT_SUBNET_MASK, &subnet_mask(net::PREFIX_LEN));
        push_opt(&mut b, OPT_ROUTER, &net::GATEWAY.octets());
        push_opt(&mut b, OPT_DNS, &net::DNS.octets());
        push_opt(&mut b, OPT_MTU, &self.mtu.to_be_bytes());
        b.push(OPT_END);
        b
    }
}

/// Append a TLV option (code, len, value). Values here are all ≤ 255 bytes.
fn push_opt(buf: &mut Vec<u8>, code: u8, val: &[u8]) {
    buf.push(code);
    buf.push(val.len() as u8);
    buf.extend_from_slice(val);
}

/// The 4-byte subnet mask for a prefix length (e.g. 24 → 255.255.255.0).
fn subnet_mask(prefix: u8) -> [u8; 4] {
    let bits: u32 = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix.min(32) as u32)
    };
    bits.to_be_bytes()
}

/// Defensively parse the fields we need. Returns `None` on any structural problem.
fn parse(p: &[u8]) -> Option<Msg> {
    if p.len() < BOOTP_LEN + 4 {
        return None; // too short for header + magic cookie
    }
    if p[BOOTP_LEN..BOOTP_LEN + 4] != MAGIC {
        return None;
    }
    let op = p[0];
    let xid: [u8; 4] = p[4..8].try_into().ok()?;
    let flags = u16::from_be_bytes([p[10], p[11]]);
    let ciaddr = Ipv4Addr::new(p[12], p[13], p[14], p[15]);
    let chaddr: [u8; 6] = p[28..34].try_into().ok()?;

    let mut msg_type = 0u8;
    let mut requested_ip = None;
    let mut server_id = None;

    // Walk the options TLVs after the magic cookie, bounds-checked; stop at END or truncation.
    let mut i = BOOTP_LEN + 4;
    while i < p.len() {
        let code = p[i];
        if code == OPT_END {
            break;
        }
        if code == OPT_PAD {
            i += 1;
            continue;
        }
        // Every non-pad/end option needs a length byte and that many value bytes.
        let len = *p.get(i + 1)? as usize;
        let val_start = i + 2;
        let val_end = val_start.checked_add(len)?;
        let val = p.get(val_start..val_end)?;
        match code {
            OPT_MSG_TYPE if len == 1 => msg_type = val[0],
            OPT_REQUESTED_IP if len == 4 => {
                requested_ip = Some(Ipv4Addr::new(val[0], val[1], val[2], val[3]))
            }
            OPT_SERVER_ID if len == 4 => {
                server_id = Some(Ipv4Addr::new(val[0], val[1], val[2], val[3]))
            }
            _ => {}
        }
        i = val_end;
    }

    if msg_type == 0 {
        return None; // a DHCP message must carry a message-type option
    }
    Some(Msg {
        op,
        xid,
        flags,
        ciaddr,
        chaddr,
        msg_type,
        requested_ip,
        server_id,
    })
}

#[cfg(test)]
mod tests;
