//! TCP flow classification — the front half of the promiscuous-accept path. Given a guest ethernet
//! frame, decide whether it opens a NEW outbound TCP flow (a SYN to an external host — the bridge
//! should `connect` a [`crate::OutboundConnector`] and create a smoltcp socket for the 4-tuple), is
//! part of an existing flow, is TCP to a slirp-local IP (handled by smoltcp itself), or isn't IPv4
//! TCP at all. Pure + unit-tested; the async bridge that acts on `OutboundSyn` is the next slice.

use std::net::IpAddr;

use smoltcp::wire::{EthernetFrame, EthernetProtocol, IpProtocol, Ipv4Packet, TcpPacket};

use crate::nat::{FlowKey, Proto};
use crate::net;

/// How a guest frame relates to outbound TCP.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameClass {
    /// A fresh guest SYN (SYN set, ACK clear) to an EXTERNAL host — a new outbound flow to bridge.
    OutboundSyn(FlowKey),
    /// TCP to a slirp-local IP (`10.0.2.2`/`.3`) — smoltcp answers it locally, not NATed out.
    LocalTcp,
    /// TCP that isn't a fresh SYN (handshake ACK, data, FIN/RST) — belongs to an existing flow.
    ExistingTcp(FlowKey),
    /// Not IPv4 TCP (ARP, ICMP, UDP, IPv6, or malformed/truncated).
    Other,
}

/// Classify one guest→gateway ethernet frame. Never panics on malformed input (returns `Other`).
pub fn classify(frame: &[u8]) -> FrameClass {
    let Ok(eth) = EthernetFrame::new_checked(frame) else {
        return FrameClass::Other;
    };
    if eth.ethertype() != EthernetProtocol::Ipv4 {
        return FrameClass::Other;
    }
    let Ok(ip) = Ipv4Packet::new_checked(eth.payload()) else {
        return FrameClass::Other;
    };
    if ip.next_header() != IpProtocol::Tcp {
        return FrameClass::Other;
    }
    let Ok(tcp) = TcpPacket::new_checked(ip.payload()) else {
        return FrameClass::Other;
    };
    let dst = ip.dst_addr();
    let key = FlowKey {
        proto: Proto::Tcp,
        guest_ip: IpAddr::V4(ip.src_addr()),
        guest_port: tcp.src_port(),
        dst_ip: IpAddr::V4(dst),
        dst_port: tcp.dst_port(),
    };
    if net::is_local(dst) {
        return FrameClass::LocalTcp;
    }
    // In-subnet but NOT the gateway/DNS (e.g. 10.0.2.99, the guest's own .15, or .255 broadcast):
    // there is no such host on the virtual link, and NATing a private 10.0.2.x address out to the
    // real internet would be wrong — so it's not an outbound flow. Drop it (the guest just times
    // out, which is accurate). (critic MINOR: use the existing `in_subnet` guard.)
    if net::in_subnet(dst) {
        return FrameClass::Other;
    }
    // NOTE (pass 2b): `ExistingTcp` currently lumps data/ACK with FIN/RST. The async bridge will need
    // to distinguish teardown (FIN/RST) to close the smoltcp socket + free the FlowKey.
    if tcp.syn() && !tcp.ack() {
        FrameClass::OutboundSyn(key)
    } else {
        FrameClass::ExistingTcp(key)
    }
}

#[cfg(test)]
mod tests;
