//! UDP datagram framing (E3-T15) — the pure glue between the frame-level stack and the payload-level
//! internal services ([`crate::udp::UdpServices`]). [`parse_udp`] pulls the fields a service needs
//! (`src_port`, `dst_ip`, `dst_port`, `payload`) plus what's needed to ADDRESS a reply (`src_mac`,
//! `src_ip`) out of a guest ethernet frame; [`build_udp_frame`] frames a service reply (Ethernet +
//! IPv4 + UDP, correct checksums) back to the guest. Both are pure + deterministic (browser-safe — no
//! tokio) and round-trip; the stack wiring that calls them (accept UDP for our services, dispatch,
//! frame the reply) and the booted-guest acceptance are the next legs.

use std::net::Ipv4Addr;

use smoltcp::phy::ChecksumCapabilities;
use smoltcp::wire::{
    EthernetAddress, EthernetFrame, EthernetProtocol, EthernetRepr, IpAddress, IpProtocol,
    Ipv4Packet, Ipv4Repr, UdpPacket, UdpRepr,
};

/// A guest UDP datagram, decomposed into what dispatch + reply-framing need.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GuestUdp {
    pub src_mac: [u8; 6],
    pub src_ip: Ipv4Addr,
    pub src_port: u16,
    pub dst_ip: Ipv4Addr,
    pub dst_port: u16,
    pub payload: Vec<u8>,
}

/// Parse a guest ethernet frame as an IPv4/UDP datagram. Returns `None` if it isn't IPv4/UDP or is
/// malformed (short/oversized/bad length) — never panics; the caller then leaves the frame to the
/// other paths (TCP/ICMP/NAT).
pub fn parse_udp(frame: &[u8]) -> Option<GuestUdp> {
    let eth = EthernetFrame::new_checked(frame).ok()?;
    if eth.ethertype() != EthernetProtocol::Ipv4 {
        return None;
    }
    let src_mac = eth.src_addr().0;
    let ip = Ipv4Packet::new_checked(eth.payload()).ok()?;
    if ip.next_header() != IpProtocol::Udp {
        return None;
    }
    // In this smoltcp version `Ipv4Address` is `std::net::Ipv4Addr`, so these are already our type.
    let src_ip = ip.src_addr();
    let dst_ip = ip.dst_addr();
    let udp = UdpPacket::new_checked(ip.payload()).ok()?;
    Some(GuestUdp {
        src_mac,
        src_ip,
        src_port: udp.src_port(),
        dst_ip,
        dst_port: udp.dst_port(),
        payload: udp.payload().to_vec(),
    })
}

/// Build an Ethernet+IPv4+UDP reply frame carrying `payload`, from `(from_ip, from_port)` to
/// `(to_ip, to_port)`, addressed at the ethernet layer from `src_mac` to `dst_mac`. Checksums are
/// computed. Used to frame a service reply (a DHCP OFFER/ACK to the broadcast MAC/IP or the guest; a
/// DNS answer to the guest's MAC/IP/port).
#[allow(clippy::too_many_arguments)]
pub fn build_udp_frame(
    src_mac: [u8; 6],
    dst_mac: [u8; 6],
    from_ip: Ipv4Addr,
    from_port: u16,
    to_ip: Ipv4Addr,
    to_port: u16,
    payload: &[u8],
) -> Vec<u8> {
    let udp = UdpRepr {
        src_port: from_port,
        dst_port: to_port,
    };
    let ip = Ipv4Repr {
        src_addr: from_ip,
        dst_addr: to_ip,
        next_header: IpProtocol::Udp,
        payload_len: udp.header_len() + payload.len(),
        hop_limit: 64,
    };
    let eth = EthernetRepr {
        src_addr: EthernetAddress(src_mac),
        dst_addr: EthernetAddress(dst_mac),
        ethertype: EthernetProtocol::Ipv4,
    };
    let mut buf = vec![0u8; eth.buffer_len() + ip.buffer_len() + udp.header_len() + payload.len()];
    let caps = ChecksumCapabilities::default();
    let mut frame = EthernetFrame::new_unchecked(&mut buf);
    eth.emit(&mut frame);
    let mut ipp = Ipv4Packet::new_unchecked(frame.payload_mut());
    ip.emit(&mut ipp, &caps);
    let mut up = UdpPacket::new_unchecked(ipp.payload_mut());
    udp.emit(
        &mut up,
        &IpAddress::Ipv4(from_ip),
        &IpAddress::Ipv4(to_ip),
        payload.len(),
        |b| b.copy_from_slice(payload),
        &caps,
    );
    buf
}

#[cfg(test)]
mod tests;
