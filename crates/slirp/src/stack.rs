//! The smoltcp `Interface` that owns the slirp gateway (`10.0.2.2`) and answers the guest's
//! link-layer world: ARP for the gateway, ICMP echo (`ping 10.0.2.2`), and — the promiscuous-accept
//! mechanism — TCP SYNs to ARBITRARY external IPs (via `any_ip` + a per-flow listening socket). Guest
//! frames go in via [`SlirpStack::inject`]; replies come out via [`SlirpStack::take_egress`]. The
//! async byte-bridge to an `OutboundConnector` is the next slice; this proves the accept path.

use std::net::Ipv4Addr;

use smoltcp::iface::{Config, Interface, SocketHandle, SocketSet};
use smoltcp::socket::tcp;
use smoltcp::time::Instant;
use smoltcp::wire::{EthernetAddress, HardwareAddress, IpAddress, IpCidr, IpListenEndpoint};

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
        self.sockets.add(sock)
    }

    /// The TCP state of a socket opened with [`open_tcp`](Self::open_tcp).
    pub fn tcp_state(&self, handle: SocketHandle) -> tcp::State {
        self.sockets.get::<tcp::Socket>(handle).state()
    }

    /// Queue a guest→gateway ethernet frame for processing on the next [`poll`](Self::poll).
    pub fn inject(&mut self, frame: Vec<u8>) {
        self.device.rx.push_back(frame);
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
