# Slirp — user-mode network for the guest (E3-T14)

A user-mode TCP/IP stack that terminates the guest's ethernet world entirely in Rust, so the guest
gets outbound networking (DNS, HTTP, `apk`, pulling OCI images from inside the guest) with **no
privileged host networking** — no TUN/TAP, no root, works in a browser tab. smoltcp parses and
answers the guest's frames; guest-initiated TCP/UDP flows are NATed onto an abstract
`OutboundConnector`, which the native harness backs with real `tokio` sockets (so the whole thing is
testable against real localhost servers without a guest boot).

This is the largest networking task; it lands in passes. **This doc is a deliverable and is kept in
sync with the code** — a contract stated here but not implemented is a bug.

## Addressing (slirp conventions, matching QEMU's user net)

| Role | Address |
|---|---|
| Guest subnet | `10.0.2.0/24` |
| Guest host | `10.0.2.15` (assigned by DHCP — E3-T15) |
| Gateway (us) | `10.0.2.2` |
| DNS (us) | `10.0.2.3` |

The slirp stack owns `10.0.2.2` and `10.0.2.3`: it answers ARP for them, replies to ICMP echo at
`10.0.2.2`, and (E3-T15) serves DHCP + DNS. Everything else the guest sends to is treated as an
external destination and NATed outbound.

## Architecture

```
 guest ── virtio-net frames ──▶ ┌──────────────── slirp crate ────────────────┐
                                │  phy::Device  ⇄  smoltcp Interface           │
   (Vec<u8> ethernet frames,    │      │              │ owns 10.0.2.2/.3,      │
    the E3-T13 NetBackend seam) │      │              │ answers ARP/ICMP,      │
                                │      │              │ promiscuous TCP accept │
                                │      ▼              ▼                        │
                                │   FlowTable ◀──▶ per-flow bridge task        │
                                │  (NAT, timeouts)     │                       │
                                └──────────────────────┼───────────────────────┘
                                                       ▼
                                        OutboundConnector::connect(host,port)
                                          → NativeConnector (tokio)  [tests]
                                          → E3-T16/T17 transports    [browser]
```

- **phy::Device glue** — a `smoltcp::phy::Device` impl whose TX enqueues frames back to the guest
  (via the E3-T13 `NetBackend` seam, plain `Vec<u8>` ethernet frames) and whose RX dequeues guest
  frames. No copies beyond smoltcp's token model.
- **Interface** — a smoltcp `Interface` configured with the gateway IPs; it answers ARP and ICMP
  echo to `10.0.2.2` itself. TCP interception is *promiscuous*: any guest SYN to any external
  `IP:port` is accepted by a listening smoltcp socket created on demand and keyed by the guest
  4-tuple; the accepted socket is then bridged byte-for-byte to `OutboundConnector::connect`.
- **OutboundConnector** — the trait that decouples the stack from *how* bytes leave the process:
  ```rust
  trait OutboundConnector {
      // Establish an outbound TCP connection; returns split byte streams or a typed refusal.
      async fn connect(&self, host: IpAddr, port: u16) -> Result<Conn, ConnectError>;
  }
  ```
  `NativeConnector` = `tokio::net::TcpStream` (tests + native CLI). Browser transports (E3-T16/T17)
  implement the same trait. **Contract:** `connect` either yields a duplex byte stream or fails
  within the connect timeout with a typed error the stack maps to a guest RST.
- **FlowTable** — the NAT table (this pass): entries keyed by `(proto, guest_ip, guest_port,
  dst_ip, dst_port)`, each with a last-activity timestamp and idle timeout (TCP established **2 h**,
  UDP **30 s**, TCP handshaking/closing **short**). Bounded total entries; per-flow buffers bounded
  (backpressure, not unbounded growth). Deterministic iteration (`BTreeMap`, not `HashMap`).

## Flow control (the hard part — pass 2)

Transport backpressure must propagate into smoltcp's window and back: when the outbound side stalls,
we stop reading from the smoltcp socket → its receive window closes → the guest sender stalls; when
the guest stalls, we stop reading the outbound socket. Per-flow buffers are capped, so a 60 s server
stall mid-stream must not grow memory past the cap, and the flow must resume. RST/FIN propagate in
both directions; an abrupt outbound RST surfaces to the guest as `ECONNRESET` promptly, not a hang.

## NAT table lifecycle

- **Create** on the guest's first packet of a flow (TCP SYN / first UDP datagram).
- **Refresh** last-activity on every packet in either direction.
- **Expire** by idle timeout (swept lazily on access + on a periodic tick); on expiry the outbound
  socket is closed and, for TCP, a RST is sent to the guest if still open.
- **Bound**: a hard cap on total entries; past the cap, the oldest idle entry is evicted (its socket
  closed). This makes "open 1000 flows and abandon them" shrink back to zero, and prevents a flow
  flood from exhausting memory.

## Out of scope (explicit)

- **Inbound connections** (host→guest port-forward) — a later task (E6-T25); slirp is
  guest-initiated-outbound only.
- **IPv6** — v1 is IPv4 only.
- **Raw sockets / ICMP beyond echo-to-gateway** — `ping` to the gateway works; arbitrary ICMP
  passthrough does not.
- **DHCP / DNS server** — E3-T15 (this crate provides the hooks; the servers land there).

## Passes

1. **This pass:** the design (this doc), the `slirp` crate scaffold, the addressing constants, the
   `OutboundConnector`/`ConnectError` trait contract, and the **`FlowTable`** (NAT table with idle
   timeouts + bounds + deterministic iteration), fully unit-tested — the self-contained core, no
   guest boot, no smoltcp integration yet.
2. **Next:** the smoltcp `phy::Device` + `Interface` glue (ARP/ICMP/TCP promiscuous accept), the
   per-flow bridge with backpressure, `NativeConnector` (tokio), and the native integration tests
   (HTTP GET through slirp to a local hyper server; concurrency; half-close; 100 MB integrity).
