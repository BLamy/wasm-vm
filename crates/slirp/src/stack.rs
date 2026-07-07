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
use crate::net;

/// Per-flow smoltcp TCP socket buffer size (64 KiB each way).
const TCP_BUF: usize = 64 * 1024;

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
    flows: BTreeMap<SocketHandle, (Ipv4Addr, u16)>,
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
                    return self.flows.values().any(|f| *f == ep);
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
        let rx = tcp::SocketBuffer::new(vec![0u8; TCP_BUF]);
        let tx = tcp::SocketBuffer::new(vec![0u8; TCP_BUF]);
        let mut sock = tcp::Socket::new(rx, tx);
        sock.listen(IpListenEndpoint {
            addr: Some(IpAddress::Ipv4(dst)),
            port,
        })
        .expect("listen on the flow's destination endpoint");
        let handle = self.sockets.add(sock);
        self.flows.insert(handle, (dst, port));
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

    /// Half-close this flow (send a FIN to the guest) — the outbound side finished writing. No-op if
    /// `handle` is not an active flow.
    pub fn tcp_close(&mut self, handle: SocketHandle) {
        if self.flows.contains_key(&handle) {
            self.sockets.get_mut::<tcp::Socket>(handle).close();
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

    /// Queue a guest ethernet frame for processing on the next [`poll`](Self::poll). Frames that
    /// smoltcp must NOT auto-respond to (external ICMP/UDP, un-opened TCP, non-gateway ARP) are
    /// dropped here so the stack never impersonates a host it hasn't opened a flow for.
    pub fn inject(&mut self, frame: Vec<u8>) {
        if self.accept_frame(&frame) {
            self.device.rx.push_back(frame);
        }
    }

    /// Drive smoltcp once at `now_ms`: process queued guest frames and emit any replies.
    pub fn poll(&mut self, now_ms: i64) {
        let _ = self.iface.poll(
            Instant::from_millis(now_ms),
            &mut self.device,
            &mut self.sockets,
        );
    }

    /// Take all frames smoltcp has queued for the guest since the last call.
    pub fn take_egress(&mut self) -> Vec<Vec<u8>> {
        self.device.tx.drain(..).collect()
    }
}

#[cfg(test)]
mod tests;
