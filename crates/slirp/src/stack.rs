//! The smoltcp `Interface` that owns the slirp gateway (`10.0.2.2`) and answers the guest's
//! link-layer world: ARP for the gateway, ICMP echo (`ping 10.0.2.2`), and — the promiscuous-accept
//! mechanism — TCP SYNs to ARBITRARY external IPs (via `any_ip` + a per-flow listening socket). Guest
//! frames go in via [`SlirpStack::inject`]; replies come out via [`SlirpStack::take_egress`]. The
//! async byte-bridge to an `OutboundConnector` is the next slice; this proves the accept path.

use std::collections::BTreeMap;
use std::net::Ipv4Addr;

use smoltcp::iface::{Config, Interface, SocketHandle, SocketSet};
use smoltcp::socket::tcp;
use smoltcp::time::Instant;
use smoltcp::wire::{
    EthernetAddress, EthernetFrame, EthernetProtocol, HardwareAddress, IpAddress, IpCidr,
    IpListenEndpoint, IpProtocol, Ipv4Packet, TcpPacket,
};

use crate::device::SlirpDevice;
use crate::dhcp::DhcpServer;
use crate::nat::FlowKey;
use crate::net;
use crate::udp_frame::{GuestUdp, build_udp_frame, parse_udp};

/// The BOOTP/DHCP client port a server reply is addressed to.
const DHCP_CLIENT_PORT: u16 = 68;
const DHCP_SERVER_PORT: u16 = 67;
const DNS_PORT: u16 = 53;

/// Per-flow smoltcp TCP socket buffer size (64 KiB each way).
const TCP_BUF: usize = 64 * 1024;

/// The all-ones broadcast — the DHCP client sends DISCOVER/rebind to it, and (see `run_dhcp`) we
/// address replies to it as well.
const BROADCAST: Ipv4Addr = Ipv4Addr::new(255, 255, 255, 255);

/// Is a guest UDP datagram to `(dst_ip, dst_port)` bound for one of our INTERNAL services (the DHCP
/// server or the DNS forwarder)? Matches the `UdpServices` routing: DHCP on :67 to the broadcast or
/// the gateway; DNS on :53 to the address we present as the resolver. Everything else is a normal
/// outbound UDP flow (left to the NAT path — not our service).
pub(crate) fn is_service_udp(dst_ip: Ipv4Addr, dst_port: u16) -> bool {
    (dst_port == 67 && (dst_ip == BROADCAST || dst_ip == net::GATEWAY))
        || (dst_port == 53 && dst_ip == net::DNS)
}

/// The slirp network stack: a smoltcp `Interface` over our queue-backed device.
pub struct SlirpStack {
    iface: Interface,
    device: SlirpDevice,
    sockets: SocketSet<'static>,
    mac: [u8; 6],
    /// The active flows: `SocketHandle → (external dst ip, port)`. Single source of truth for BOTH
    /// the frame filter (smoltcp only sees TCP to an opened endpoint — otherwise `any_ip` would forge
    /// replies AS a host we never opened; critic CRITICAL) AND the accessor guard (a handle not in
    /// here is removed/unknown, so accessors return a safe default instead of panicking / touching a
    /// reused slot; critic MAJOR).
    flows: BTreeMap<SocketHandle, TcpFlow>,
    /// Guest UDP datagrams bound for our internal services (DHCP/DNS), DIVERTED out of the smoltcp
    /// path (which drops UDP) for the caller to dispatch via `UdpServices` — sync for DHCP, async for
    /// DNS. Drained by [`take_service_udp`](Self::take_service_udp); replies come back via
    /// [`push_egress`](Self::push_egress).
    service_udp: Vec<GuestUdp>,
}

#[derive(Clone, Copy)]
struct TcpFlow {
    dst_ip: Ipv4Addr,
    /// Port the real guest believes it connected to (and the outbound connector actually dials).
    external_port: u16,
    /// Unique smoltcp-local listening port. Concurrent guest flows to the same external endpoint get
    /// distinct aliases so the socket demultiplexer cannot bind every SYN to one listener.
    listen_port: u16,
    /// Exact guest endpoint for production NAT flows. Legacy stack-only tests use `None` and do no
    /// port rewriting because they open only one listener per external endpoint.
    guest: Option<(Ipv4Addr, u16)>,
}

impl SlirpStack {
    /// A stack whose gateway MAC is `mac` and whose gateway IP is `net::GATEWAY` (`10.0.2.2/24`).
    pub fn new(mac: [u8; 6]) -> Self {
        let mut device = SlirpDevice::new();
        let hw = HardwareAddress::Ethernet(EthernetAddress(mac));
        let config = Config::new(hw);
        let mut iface = Interface::new(config, &mut device, Instant::from_millis(0));
        let gw = net::GATEWAY.octets();
        iface.update_ip_addrs(|addrs| {
            addrs
                .push(IpCidr::new(
                    IpAddress::v4(gw[0], gw[1], gw[2], gw[3]),
                    net::PREFIX_LEN,
                ))
                .expect("one ip fits");
        });
        // Promiscuous accept: process guest packets destined to ANY IP (not just 10.0.2.2), so a
        // per-flow listening socket can accept a guest SYN to an arbitrary external host.
        iface.set_any_ip(true);
        SlirpStack {
            iface,
            device,
            sockets: SocketSet::new(vec![]),
            mac,
            flows: BTreeMap::new(),
            service_udp: Vec::new(),
        }
    }

    /// Whether a guest frame may reach smoltcp. Gates `any_ip` so smoltcp never impersonates a host:
    /// allow ARP for the gateway only, IPv4 to the gateway (ARP/ICMP-echo/local TCP), and TCP to an
    /// endpoint we've explicitly opened; drop everything else (external ICMP/UDP/un-opened TCP).
    fn accept_frame(&self, frame: &[u8]) -> bool {
        let Ok(eth) = EthernetFrame::new_checked(frame) else {
            return false;
        };
        match eth.ethertype() {
            // ARP only for the gateway — don't claim the whole subnet.
            EthernetProtocol::Arp => frame.len() >= 42 && frame[38..42] == net::GATEWAY.octets(),
            EthernetProtocol::Ipv4 => {
                let Ok(ip) = Ipv4Packet::new_checked(eth.payload()) else {
                    return false;
                };
                let dst = ip.dst_addr();
                if dst == net::GATEWAY {
                    return true; // ICMP echo / local TCP addressed to us
                }
                // TCP to an endpoint we've opened a listening socket for.
                if ip.next_header() == IpProtocol::Tcp
                    && let Ok(tcp) = TcpPacket::new_checked(ip.payload())
                {
                    let ep = (dst, tcp.dst_port());
                    return self.flows.values().any(|f| (f.dst_ip, f.listen_port) == ep);
                }
                false // external ICMP/UDP/un-opened-TCP → drop (no impersonation)
            }
            _ => false,
        }
    }

    /// The gateway MAC this stack answers as.
    pub fn mac(&self) -> [u8; 6] {
        self.mac
    }

    /// Open a per-flow smoltcp TCP socket that LISTENS on `dst:port` — so an incoming guest SYN to
    /// that external endpoint (accepted via `any_ip`) completes the handshake locally. Returns the
    /// socket handle; the async bridge (next slice) pumps its bytes to/from an `OutboundConnector`.
    pub fn open_tcp(&mut self, dst: Ipv4Addr, port: u16) -> SocketHandle {
        self.open_tcp_inner(dst, port, port, None)
    }

    /// Open a production NAT flow keyed by the full guest/external 4-tuple. smoltcp listeners bind
    /// only their local `(dst, port)`, so two guest source ports dialing the same server would
    /// otherwise collide. Allocate a unique local port and transparently rewrite TCP ports at the
    /// stack boundary; the guest and connector continue to see the real external port.
    pub fn open_tcp_flow(&mut self, key: &FlowKey) -> SocketHandle {
        let (std::net::IpAddr::V4(guest_ip), std::net::IpAddr::V4(dst_ip)) =
            (key.guest_ip, key.dst_ip)
        else {
            panic!("slirp TCP flow must be IPv4");
        };
        let listen_port = (0..=u16::MAX)
            .map(|offset| key.dst_port.wrapping_add(offset))
            .find(|&candidate| {
                candidate != 0
                    && !self
                        .flows
                        .values()
                        .any(|flow| flow.dst_ip == dst_ip && flow.listen_port == candidate)
            })
            .expect("MAX_FLOWS leaves a free TCP port alias");
        self.open_tcp_inner(
            dst_ip,
            key.dst_port,
            listen_port,
            Some((guest_ip, key.guest_port)),
        )
    }

    fn open_tcp_inner(
        &mut self,
        dst: Ipv4Addr,
        external_port: u16,
        listen_port: u16,
        guest: Option<(Ipv4Addr, u16)>,
    ) -> SocketHandle {
        let rx = tcp::SocketBuffer::new(vec![0u8; TCP_BUF]);
        let tx = tcp::SocketBuffer::new(vec![0u8; TCP_BUF]);
        let mut sock = tcp::Socket::new(rx, tx);
        sock.listen(IpListenEndpoint {
            addr: Some(IpAddress::Ipv4(dst)),
            port: listen_port,
        })
        .expect("listen on the flow's destination endpoint");
        let handle = self.sockets.add(sock);
        self.flows.insert(
            handle,
            TcpFlow {
                dst_ip: dst,
                external_port,
                listen_port,
                guest,
            },
        );
        handle
    }

    /// The TCP state of a flow, or `None` if `handle` is not an active flow (removed / never opened)
    /// — never panics on a stale handle (critic MAJOR).
    pub fn tcp_state(&self, handle: SocketHandle) -> Option<tcp::State> {
        self.flows
            .contains_key(&handle)
            .then(|| self.sockets.get::<tcp::Socket>(handle).state())
    }

    /// Drain all bytes the guest has sent on this flow (guest → outbound direction). Empty if none
    /// or if `handle` is not an active flow.
    pub fn tcp_recv(&mut self, handle: SocketHandle) -> Vec<u8> {
        if !self.flows.contains_key(&handle) {
            return Vec::new();
        }
        let sock = self.sockets.get_mut::<tcp::Socket>(handle);
        let mut out = Vec::new();
        while sock.can_recv() {
            let got = sock
                .recv(|buf| {
                    out.extend_from_slice(buf);
                    (buf.len(), buf.len())
                })
                .unwrap_or(0);
            if got == 0 {
                break;
            }
        }
        out
    }

    /// Enqueue bytes to send to the guest on this flow (outbound → guest direction). Returns the
    /// number accepted into the send buffer (may be < `data.len()` under backpressure); 0 if `handle`
    /// is not an active flow.
    pub fn tcp_send(&mut self, handle: SocketHandle, data: &[u8]) -> usize {
        if !self.flows.contains_key(&handle) {
            return 0;
        }
        self.sockets
            .get_mut::<tcp::Socket>(handle)
            .send_slice(data)
            .unwrap_or(0)
    }

    /// Whether this flow's socket can currently accept more send bytes (its window is open). `false`
    /// if `handle` is not an active flow.
    pub fn tcp_can_send(&self, handle: SocketHandle) -> bool {
        self.flows.contains_key(&handle) && self.sockets.get::<tcp::Socket>(handle).can_send()
    }

    /// Whether the guest may still send us more bytes on this flow. Goes `false` once the guest sends
    /// a FIN (its write side closed) — the signal for the backend to `shutdown_write` the outbound
    /// side. `false` if `handle` is not an active flow.
    pub fn tcp_may_recv(&self, handle: SocketHandle) -> bool {
        self.flows.contains_key(&handle) && self.sockets.get::<tcp::Socket>(handle).may_recv()
    }

    /// Half-close this flow (send a FIN to the guest) — the outbound side finished writing. No-op if
    /// `handle` is not an active flow.
    pub fn tcp_close(&mut self, handle: SocketHandle) {
        if self.flows.contains_key(&handle) {
            self.sockets.get_mut::<tcp::Socket>(handle).close();
        }
    }

    /// Abort this flow (send a RST to the guest) — the outbound connect failed or the remote reset.
    /// Unlike [`tcp_close`](Self::tcp_close) (a graceful FIN), this tears the guest connection down
    /// hard so the guest sees `ECONNRESET`, not a clean EOF. No-op if `handle` is not an active flow.
    pub fn tcp_abort(&mut self, handle: SocketHandle) {
        if self.flows.contains_key(&handle) {
            self.sockets.get_mut::<tcp::Socket>(handle).abort();
        }
    }

    /// Tear down a flow by handle: remove its smoltcp socket (frees the 128 KiB buffers) and its
    /// filter endpoint together (looked up from `flows`, so socket + endpoint can never desync —
    /// critic MINOR). No-op if already removed. **After this the `handle` is INVALID; smoltcp reuses
    /// slots, so a later `open_tcp` may return the SAME handle for a different flow — the caller MUST
    /// drop its copy of the handle on teardown, never reuse it (critic MAJOR).**
    pub fn remove_tcp(&mut self, handle: SocketHandle) {
        if self.flows.remove(&handle).is_some() {
            self.sockets.remove(handle);
        }
    }

    /// Queue a guest ethernet frame for processing on the next [`poll`](Self::poll). A UDP datagram
    /// bound for an internal service (DHCP/DNS) is DIVERTED into the service queue (smoltcp would drop
    /// it — it's not a flow it opened), for the caller to dispatch. Everything else goes through the
    /// `accept_frame` filter: frames smoltcp must NOT auto-respond to (external ICMP/UDP, un-opened
    /// TCP, non-gateway ARP) are dropped so the stack never impersonates a host it hasn't opened.
    pub fn inject(&mut self, frame: Vec<u8>) {
        let mut frame = frame;
        if let Some(g) = parse_udp(&frame)
            && is_service_udp(g.dst_ip, g.dst_port)
        {
            self.service_udp.push(g);
            return; // handled by the service path, not smoltcp
        }
        self.rewrite_guest_tcp_port(&mut frame);
        if self.accept_frame(&frame) {
            self.device.rx.push_back(frame);
        }
    }

    fn rewrite_guest_tcp_port(&self, frame: &mut [u8]) {
        let Ok(mut eth) = EthernetFrame::new_checked(frame) else {
            return;
        };
        if eth.ethertype() != EthernetProtocol::Ipv4 {
            return;
        }
        let Ok(mut ip) = Ipv4Packet::new_checked(eth.payload_mut()) else {
            return;
        };
        if ip.next_header() != IpProtocol::Tcp {
            return;
        }
        let src_ip = ip.src_addr();
        let dst_ip = ip.dst_addr();
        let Ok(mut packet) = TcpPacket::new_checked(ip.payload_mut()) else {
            return;
        };
        let src_port = packet.src_port();
        let external_port = packet.dst_port();
        let Some(flow) = self.flows.values().find(|flow| {
            flow.dst_ip == dst_ip
                && flow.external_port == external_port
                && flow.guest == Some((src_ip, src_port))
        }) else {
            return;
        };
        if flow.listen_port != external_port {
            packet.set_dst_port(flow.listen_port);
            packet.fill_checksum(&IpAddress::Ipv4(src_ip), &IpAddress::Ipv4(dst_ip));
        }
    }

    fn rewrite_egress_tcp_ports(&mut self) {
        for frame in &mut self.device.tx {
            let Ok(mut eth) = EthernetFrame::new_checked(frame.as_mut_slice()) else {
                continue;
            };
            if eth.ethertype() != EthernetProtocol::Ipv4 {
                continue;
            }
            let Ok(mut ip) = Ipv4Packet::new_checked(eth.payload_mut()) else {
                continue;
            };
            if ip.next_header() != IpProtocol::Tcp {
                continue;
            }
            let src_ip = ip.src_addr();
            let dst_ip = ip.dst_addr();
            let Ok(mut packet) = TcpPacket::new_checked(ip.payload_mut()) else {
                continue;
            };
            let listen_port = packet.src_port();
            let guest_port = packet.dst_port();
            let Some(flow) = self.flows.values().find(|flow| {
                flow.dst_ip == src_ip
                    && flow.listen_port == listen_port
                    && flow.guest == Some((dst_ip, guest_port))
            }) else {
                continue;
            };
            if flow.listen_port != flow.external_port {
                packet.set_src_port(flow.external_port);
                packet.fill_checksum(&IpAddress::Ipv4(src_ip), &IpAddress::Ipv4(dst_ip));
            }
        }
    }

    /// Take the guest UDP datagrams diverted to the internal services since the last call, for the
    /// caller to dispatch via `UdpServices` and frame the replies back with [`push_egress`].
    pub fn take_service_udp(&mut self) -> Vec<GuestUdp> {
        std::mem::take(&mut self.service_udp)
    }

    /// Enqueue a caller-framed ethernet frame (a service reply) for delivery to the guest — it appears
    /// in the next [`take_egress`](Self::take_egress) alongside smoltcp's own output.
    pub fn push_egress(&mut self, frame: Vec<u8>) {
        self.device.tx.push_back(frame);
    }

    /// Service every DIVERTED DHCP datagram (dst port 67) with `dhcp`, framing each reply back to the
    /// guest and egressing it. DHCP is fully SYNCHRONOUS (no resolver), so it's serviced end-to-end
    /// here; DNS datagrams (dst port 53) are LEFT in the service queue for the async layer.
    ///
    /// Reply addressing: the reply is sent with a BROADCAST L3 destination (`255.255.255.255:68`) from
    /// the gateway server (`10.0.2.2:67`), unicast at L2 back to the requesting guest's MAC (which
    /// accepts a broadcast-IP frame addressed to its own MAC without flooding the link). Broadcasting
    /// UNCONDITIONALLY is safe for every state a busybox `udhcpc` is in when it receives it (critic-
    /// verified against the client source): pre-lease it reads a RAW socket filtered only on UDP:68 +
    /// checksum (L2/L3 dst ignored, so the unicast-MAC frame is received); during RENEW it binds
    /// `INADDR_ANY:68` with `SO_BROADCAST`, so the `255.255.255.255:68` datagram still reaches it. (A
    /// strictly-conformant RENEW ACK would unicast to `ciaddr`; broadcasting is harmless in a
    /// single-tenant slirp — no other host is on the link.) Returns the number of replies sent.
    pub fn run_dhcp(&mut self, dhcp: &DhcpServer) -> usize {
        // Partition: take DHCP datagrams, leave the rest (DNS) queued for the async layer.
        let pending = std::mem::take(&mut self.service_udp);
        let mut sent = 0;
        for g in pending {
            if g.dst_port != DHCP_SERVER_PORT {
                self.service_udp.push(g); // not DHCP (DNS) — keep it for the async servicing loop
                continue;
            }
            if let Some(reply) = dhcp.handle(&g.payload) {
                let frame = build_udp_frame(
                    self.mac,     // from the gateway MAC
                    g.src_mac,    // L2-unicast back to the requesting guest
                    net::GATEWAY, // from the DHCP server (10.0.2.2)
                    DHCP_SERVER_PORT,
                    BROADCAST, // L3 broadcast — the client has no IP yet
                    DHCP_CLIENT_PORT,
                    &reply,
                );
                if let Some(frame) = frame {
                    self.device.tx.push_back(frame);
                    sent += 1;
                }
            }
        }
        sent
    }

    /// Service every DIVERTED DNS datagram (dst port 53) with `fwd`, framing each answer back to the
    /// guest and egressing it. DNS is ASYNC (a cache miss consults the resolver), so this is the
    /// `async` counterpart to [`run_dhcp`](Self::run_dhcp); DHCP datagrams (dst 67) are LEFT in the
    /// service queue for [`run_dhcp`]. The answer is unicast to the guest (which HAS its IP by now):
    /// from the resolver (`10.0.2.3:53`) to the query's own `(src_ip, src_port)`, L2 to its MAC. A
    /// response too large to frame (`> MAX_UDP_PAYLOAD`) is dropped — a real forwarder would set TC=1
    /// to trigger the guest's TCP retry (a later leg); our A-record answers are always small. Returns
    /// the number of answers sent.
    pub async fn run_dns<R: crate::resolver::Resolver>(
        &mut self,
        fwd: &mut crate::resolver::DnsForwarder<R>,
        now_ms: i64,
    ) -> usize {
        let pending = std::mem::take(&mut self.service_udp);
        let mut sent = 0;
        for g in pending {
            if g.dst_port != DNS_PORT {
                self.service_udp.push(g); // not DNS (DHCP) — keep it for run_dhcp
                continue;
            }
            if let Some(answer) = fwd.handle(&g.payload, now_ms).await
                && let Some(frame) = build_udp_frame(
                    self.mac,  // from the gateway MAC
                    g.src_mac, // L2-unicast back to the guest
                    net::DNS,  // from the resolver (10.0.2.3)
                    DNS_PORT,
                    g.src_ip,   // to the guest's own address...
                    g.src_port, // ...and the query's source port
                    &answer,
                )
            {
                self.device.tx.push_back(frame);
                sent += 1;
            }
        }
        sent
    }

    /// Service ALL diverted internal-service datagrams in one call — the event loop's single entry
    /// point for DHCP + DNS. Runs the async DNS pass then the sync DHCP pass; they partition the queue
    /// by dst port, so every diverted datagram is serviced exactly once regardless of order. Returns
    /// the total number of replies egressed. Drive this each tick alongside [`poll`](Self::poll) (which
    /// handles ARP/ICMP/TCP): a typical loop is `inject` guest frames → `service(...).await` → `poll` →
    /// `take_egress`.
    pub async fn service<R: crate::resolver::Resolver>(
        &mut self,
        dhcp: &DhcpServer,
        fwd: &mut crate::resolver::DnsForwarder<R>,
        now_ms: i64,
    ) -> usize {
        // DNS first (it leaves the DHCP datagrams queued), then DHCP drains what's left.
        let dns = self.run_dns(fwd, now_ms).await;
        let dhcp = self.run_dhcp(dhcp);
        dns + dhcp
    }

    /// Drive smoltcp once at `now_ms`: process queued guest frames and emit any replies.
    pub fn poll(&mut self, now_ms: i64) {
        let _ = self.iface.poll(
            Instant::from_millis(now_ms),
            &mut self.device,
            &mut self.sockets,
        );
        // Rewrite while the flow mapping is still live. Failure/RST paths may remove the socket
        // before the caller drains egress; delaying this until `take_egress` would leak alias ports.
        self.rewrite_egress_tcp_ports();
    }

    /// Take all frames smoltcp has queued for the guest since the last call.
    pub fn take_egress(&mut self) -> Vec<Vec<u8>> {
        self.device.tx.drain(..).collect()
    }
}

#[cfg(test)]
mod tests;
