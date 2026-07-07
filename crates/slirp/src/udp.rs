//! UDP service dispatch (E3-T15): routes a guest UDP datagram to the internal service that owns its
//! `(dst_ip, dst_port)` — the in-slirp DHCP server and DNS forwarder — and returns the response
//! payload. This is the composition seam that makes "zero-config networking just works": `udhcpc`'s
//! broadcast reaches [`DhcpServer`], and a query to `10.0.2.3:53` reaches [`DnsForwarder`]. Everything
//! else (a UDP flow to an EXTERNAL host, including DNS to some other server) is NOT claimed here — it
//! belongs to the NAT/outbound path. Pure control logic (no smoltcp); the caller parses the datagram
//! off the wire and frames the reply.

use std::net::Ipv4Addr;

use crate::dhcp::DhcpServer;
use crate::net;
use crate::resolver::{DnsForwarder, Resolver};

/// The well-known ports we own on the slirp link.
const DHCP_SERVER_PORT: u16 = 67;
const DNS_PORT: u16 = 53;
/// The all-ones broadcast a DHCP DISCOVER is sent to.
const BROADCAST: Ipv4Addr = Ipv4Addr::new(255, 255, 255, 255);

/// A service reply, fully addressed so the caller can frame the UDP datagram with no other context:
/// send `payload` from `(service ip, from_port)` to `(guest, to_port)`.
pub struct UdpReply {
    pub payload: Vec<u8>,
    /// The service port the reply is sent FROM (67 for DHCP, 53 for DNS).
    pub from_port: u16,
    /// The guest port the reply is sent TO — the DHCP client port (68) for DHCP, or the query's own
    /// source port for DNS (which the caller passes in as `src_port`).
    pub to_port: u16,
}

/// The BOOTP/DHCP client port a server reply is addressed to.
const DHCP_CLIENT_PORT: u16 = 68;

/// The internal UDP services: the DHCP server and the DNS forwarder.
pub struct UdpServices<R> {
    dhcp: DhcpServer,
    dns: DnsForwarder<R>,
}

impl<R: Resolver> UdpServices<R> {
    pub fn new(dhcp: DhcpServer, dns: DnsForwarder<R>) -> Self {
        UdpServices { dhcp, dns }
    }

    /// Route one guest UDP datagram (from the guest's `src_port` to `(dst_ip, dst_port)`). Returns a
    /// fully-addressed reply, or `None` if no internal service claims this `(dst_ip, dst_port)` — in
    /// which case the datagram is a normal outbound flow for the NAT path.
    pub async fn handle(
        &mut self,
        src_port: u16,
        dst_ip: Ipv4Addr,
        dst_port: u16,
        payload: &[u8],
        now_ms: i64,
    ) -> Option<UdpReply> {
        // DHCP: we are the only server on the link, so we answer :67 whether the client broadcasts
        // (DISCOVER / rebinding) or unicasts to the gateway (RENEW). The reply goes from :67 to :68.
        if dst_port == DHCP_SERVER_PORT && (dst_ip == BROADCAST || dst_ip == net::GATEWAY) {
            return self.dhcp.handle(payload).map(|payload| UdpReply {
                payload,
                from_port: DHCP_SERVER_PORT,
                to_port: DHCP_CLIENT_PORT,
            });
        }
        // DNS: ONLY the address we present as the resolver (10.0.2.3). A query aimed at any other
        // host's :53 is a real outbound flow — left to NAT, never intercepted (no transparent-DNS
        // surprise). The reply goes from :53 back to the query's own source port.
        if dst_port == DNS_PORT && dst_ip == net::DNS {
            return self
                .dns
                .handle(payload, now_ms)
                .await
                .map(|payload| UdpReply {
                    payload,
                    from_port: DNS_PORT,
                    to_port: src_port,
                });
        }
        None
    }
}

#[cfg(test)]
mod tests;
