//! Slirp — user-mode network for the guest (E3-T14). A Rust TCP/IP stack that gives the guest
//! outbound networking with no privileged host networking (no TUN/TAP, works in a browser). See
//! `docs/design/slirp.md`.
//!
//! **Pass 1 (this crate today):** the pure, deterministic core — addressing constants, the
//! [`OutboundConnector`] contract, and the [`nat::FlowTable`] (NAT with idle timeouts + bounds).
//! The smoltcp `phy::Device`/`Interface` glue, the per-flow bridge, and `NativeConnector` (tokio)
//! arrive in pass 2 behind features (so the browser build never pulls tokio).

use std::net::Ipv4Addr;

pub mod bridge;
pub mod connector;
pub mod device;
pub mod dhcp;
pub mod dns;
pub mod dns_tcp;
pub mod doh;
#[cfg(all(test, feature = "native"))]
mod e2e_pump_stack;
pub mod local_backend;
pub mod manager;
pub mod nat;
#[cfg(feature = "native")]
pub mod native;
#[cfg(feature = "native")]
pub mod native_resolver;
#[cfg(feature = "native")]
pub mod pump;
pub mod resolver;
pub mod stack;
// E3-net slice 2a: the synchronous, poll-driven outbound connector (browser-compatible) + its native
// `std::net` implementation. The trait is always available; `StdConnector` is native-only (real
// sockets don't exist on wasm32).
pub mod sync_connector;
#[cfg(not(target_arch = "wasm32"))]
pub mod std_connector;
pub mod tcp;
pub mod udp;
pub mod udp_frame;
#[cfg(all(test, feature = "native"))]
mod udp_integration_tests;
pub mod ws_proxy;

pub use manager::{Action, FlowManager, FrameOutcome};

pub use bridge::Bridge;
pub use connector::{ConnectError, OutboundConnector};
pub use device::SlirpDevice;
pub use dhcp::DhcpServer;
pub use dns::{Answer, Query, ResponseInfo, build_query, parse_query, parse_response};
pub use dns_tcp::{TcpFrame, frame_message, next_message};
pub use doh::{DohResolver, DohTransport};
pub use local_backend::SlirpLocalBackend;
pub use nat::{FlowKey, FlowTable, Proto, TouchOutcome};
#[cfg(feature = "native")]
pub use native::NativeConnector;
#[cfg(feature = "native")]
pub use native_resolver::NativeResolver;
#[cfg(feature = "native")]
pub use pump::{PumpStats, pump_flow};
pub use resolver::{DnsForwarder, Resolution, Resolver, TtlCache};
pub use stack::SlirpStack;
pub use sync_connector::{ConnId, ConnStatus, SyncConnector};
#[cfg(not(target_arch = "wasm32"))]
pub use std_connector::StdConnector;
pub use udp::{UdpReply, UdpServices};
pub use udp_frame::{GuestUdp, build_udp_frame, parse_udp};
pub use ws_proxy::{
    Frame as WsFrame, HandshakeError as WsHandshakeError, Mux as WsMux, MuxError as WsMuxError,
    MuxEvent as WsMuxEvent, Role as WsRole, Session as WsSession, SessionError as WsSessionError,
    StreamError as WsStreamError, StreamState as WsStreamState, Terminal as WsTerminal,
    VERSION as WS_PROXY_VERSION,
};

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
