//! Slirp — user-mode network for the guest (E3-T14). A Rust TCP/IP stack that gives the guest
//! outbound networking with no privileged host networking (no TUN/TAP, works in a browser). See
//! `docs/design/slirp.md`.
//!
//! **Pass 1 (this crate today):** the pure, deterministic core — addressing constants, the
//! [`OutboundConnector`] contract, and the [`nat::FlowTable`] (NAT with idle timeouts + bounds).
//! The smoltcp `phy::Device`/`Interface` glue, the per-flow bridge, and `NativeConnector` (tokio)
//! arrive in pass 2 behind features (so the browser build never pulls tokio).

use std::net::Ipv4Addr;

pub mod connector;
pub mod nat;

pub use connector::{ConnectError, OutboundConnector};
pub use nat::{FlowKey, FlowTable, Proto, TouchOutcome};

/// The slirp virtual network — QEMU-user conventions so guest images "just work".
pub mod net {
    use super::Ipv4Addr;
    /// Guest subnet `10.0.2.0/24`.
    pub const SUBNET: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 0);
    pub const PREFIX_LEN: u8 = 24;
    /// The guest's own address (assigned via DHCP — E3-T15).
    pub const GUEST: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 15);
    /// The gateway we present (answers ARP + ICMP echo; the NAT egress point).
    pub const GATEWAY: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 2);
    /// The DNS server we present (E3-T15 serves it).
    pub const DNS: Ipv4Addr = Ipv4Addr::new(10, 0, 2, 3);

    /// Is `ip` an address slirp OWNS (answers locally rather than NATing out)?
    pub fn is_local(ip: Ipv4Addr) -> bool {
        ip == GATEWAY || ip == DNS
    }

    /// Is `ip` inside the guest subnet `10.0.2.0/24`?
    pub fn in_subnet(ip: Ipv4Addr) -> bool {
        let o = ip.octets();
        o[0] == 10 && o[1] == 0 && o[2] == 2
    }
}
