//! The smoltcp `Interface` that owns the slirp gateway (`10.0.2.2`) and answers the guest's
//! link-layer world: ARP for the gateway, ICMP echo (`ping 10.0.2.2`). Guest frames go in via
//! [`SlirpStack::inject`]; replies come out via [`SlirpStack::take_egress`]. TCP interception + the
//! outbound bridge are the next pass; this pass proves the device/interface glue.

use smoltcp::iface::{Config, Interface, SocketSet};
use smoltcp::time::Instant;
use smoltcp::wire::{EthernetAddress, HardwareAddress, IpAddress, IpCidr};

use crate::device::SlirpDevice;
use crate::net;

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
