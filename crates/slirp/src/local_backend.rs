//! E3-net (browser networking, slice 1): a **synchronous** slirp [`NetBackend`] — the LOCAL stack
//! only (DHCP lease + ARP for the gateway + ICMP echo to `10.0.2.2`), with NO outbound connector and
//! NO async runtime. Because the local stack answers everything from the guest's own frames
//! (`inject` → `poll`/`run_dhcp` → `take_egress`), it runs directly in the browser's wasm event loop
//! with no tokio — unlike the native `cli::SlirpBackend`, which needs a tokio driver thread for the
//! outbound TCP pump. Outbound TCP (guest → real socket over the WebSocket relay) is a later slice;
//! this one gets a booted browser guest a DHCP-configured `eth0` and a reachable gateway.
//!
//! The clock is injected (`Box<dyn Fn() -> i64>` monotonic ms) so the backend stays native-testable
//! (this module is written alloc-only, though the crate around it is std): the browser passes a
//! `js_sys::Date::now`-based closure; tests pass a mock.

extern crate alloc;
use alloc::boxed::Box;
use alloc::collections::VecDeque;
use alloc::vec::Vec;

use wasm_vm_core::dev::virtio::net::NetBackend;

use crate::dhcp::DhcpServer;
use crate::stack::SlirpStack;

/// A [`NetBackend`] backed by the slirp local stack: the guest sees a real gateway (`10.0.2.2`) that
/// answers ARP + ICMP and a DHCP server that hands out `10.0.2.15`. No outbound networking.
pub struct SlirpLocalBackend {
    stack: SlirpStack,
    dhcp: DhcpServer,
    egress: VecDeque<Vec<u8>>,
    clock: Box<dyn Fn() -> i64>,
}

impl SlirpLocalBackend {
    /// `gateway_mac` is the stack's own MAC (distinct from the guest's virtio-net MAC). `clock`
    /// returns monotonic milliseconds (browser: `Date::now`-derived; tests: a mock/counter).
    pub fn new(gateway_mac: [u8; 6], clock: Box<dyn Fn() -> i64>) -> Self {
        Self {
            stack: SlirpStack::new(gateway_mac),
            dhcp: DhcpServer::new(),
            egress: VecDeque::new(),
            clock,
        }
    }

    /// Drive one servicing pass: `poll` (ARP/ICMP; `inject` already diverted any DHCP UDP to the
    /// service queue), then `run_dhcp` (answer diverted DHCP → `device.tx`), then harvest egress for
    /// the guest. (`run_dhcp` writes egress directly, so no second `poll` is needed to flush it.)
    fn service(&mut self) {
        let now = (self.clock)();
        self.stack.poll(now);
        self.stack.run_dhcp(&self.dhcp);
        for f in self.stack.take_egress() {
            self.egress.push_back(f);
        }
    }
}

impl NetBackend for SlirpLocalBackend {
    fn tx(&mut self, frame: &[u8]) {
        self.stack.inject(frame.to_vec());
        self.service();
    }

    fn rx(&mut self) -> Option<Vec<u8>> {
        self.egress.pop_front()
    }

    fn rx_ready(&self) -> bool {
        !self.egress.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use smoltcp::wire::{
        ArpOperation, ArpPacket, ArpRepr, EthernetAddress, EthernetFrame, EthernetProtocol,
        EthernetRepr,
    };

    const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
    const GW_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x02];
    use core::net::Ipv4Addr;
    const GUEST_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 15);
    const GW_IP: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 2);

    fn guest_arp_request() -> Vec<u8> {
        let arp = ArpRepr::EthernetIpv4 {
            operation: ArpOperation::Request,
            source_hardware_addr: EthernetAddress(GUEST_MAC),
            source_protocol_addr: GUEST_IP,
            target_hardware_addr: EthernetAddress([0; 6]),
            target_protocol_addr: GW_IP,
        };
        let eth = EthernetRepr {
            src_addr: EthernetAddress(GUEST_MAC),
            dst_addr: EthernetAddress::BROADCAST,
            ethertype: EthernetProtocol::Arp,
        };
        let mut buf = vec![0u8; eth.buffer_len() + arp.buffer_len()];
        let mut frame = EthernetFrame::new_unchecked(&mut buf);
        eth.emit(&mut frame);
        let mut apkt = ArpPacket::new_unchecked(frame.payload_mut());
        arp.emit(&mut apkt);
        buf
    }

    #[test]
    fn guest_arp_for_gateway_gets_a_reply_through_the_local_backend() {
        let mut be = SlirpLocalBackend::new(GW_MAC, Box::new(|| 0));
        be.tx(&guest_arp_request());
        // The whole synchronous path ran on tx: inject → poll → take_egress → egress queue.
        let mut got = false;
        while let Some(f) = be.rx() {
            let Ok(frame) = EthernetFrame::new_checked(&f) else {
                continue;
            };
            if frame.ethertype() != EthernetProtocol::Arp {
                continue;
            }
            let Ok(pkt) = ArpPacket::new_checked(frame.payload()) else {
                continue;
            };
            if let Ok(ArpRepr::EthernetIpv4 {
                operation,
                source_protocol_addr,
                source_hardware_addr,
                ..
            }) = ArpRepr::parse(&pkt)
                && operation == ArpOperation::Reply
                && source_protocol_addr == GW_IP
                && source_hardware_addr == EthernetAddress(GW_MAC)
            {
                got = true;
            }
        }
        assert!(got, "gateway should ARP-reply through the local backend");
    }
}
