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

- **phy::Device glue** *(pass 2a — implemented, `device.rs`)* — a `smoltcp::phy::Device` impl over
  two `Vec<u8>` frame queues: RX = frames from the guest (the E3-T13 `NetBackend` seam), TX = replies
  for the guest. No copies beyond smoltcp's token model.
- **Interface** *(pass 2a/2f, `stack.rs`)* — a smoltcp `Interface` configured with the gateway IP
  `10.0.2.2/24`; answers **ARP** and **ICMP echo** for it (pass 2a). **Promiscuous TCP accept**
  (pass 2f): `Interface::set_any_ip(true)` makes it process guest packets to ANY dst IP, and
  `SlirpStack::open_tcp(dst, port)` adds a smoltcp TCP socket LISTENING on that external endpoint —
  so a guest SYN to an arbitrary external `IP:port` completes the handshake (SYN → SYN-ACK, verified
  by frame injection). NOTE: `any_ip` also makes the interface answer ARP for any in-subnet address
  (not just `.2`); harmless — the guest routes non-local traffic through the gateway and only ARPs
  `.2`. The async **byte-bridge** from an accepted socket to `OutboundConnector::connect` (with
  backpressure/half-close) is the next slice.
- **OutboundConnector** — the trait that decouples the stack from *how* bytes leave the process.
  The real signature uses the explicit `-> impl Future + Send` form (not `async fn`) so the returned
  future is `Send`-bound without tripping the `async_fn_in_trait` lint:
  ```rust
  trait OutboundConnector {
      type Conn;
      // Establish an outbound TCP connection; yields a duplex byte stream or a typed refusal.
      fn connect(&self, host: IpAddr, port: u16)
          -> impl Future<Output = Result<Self::Conn, ConnectError>> + Send;
  }
  ```
  `NativeConnector` = `tokio::net::TcpStream` (tests + native CLI). Browser transports (E3-T16/T17)
  implement the same trait. **Contract:** `connect` either yields a duplex byte stream or fails
  within the connect timeout with a typed error the stack maps to a guest RST.
- **FlowTable** — the NAT table (this pass): entries keyed by `(proto, guest_ip, guest_port,
  dst_ip, dst_port)`, each with a last-activity timestamp and a per-protocol idle timeout (TCP
  **2 h**, UDP **30 s**). A shorter tier for TCP handshaking/closing states needs per-flow TCP state,
  which the bridge tracks in **pass 2** — pass 1 keys the timeout on the protocol only. Bounded total
  entries (LRU eviction); per-flow buffers bounded in pass 2 (backpressure, not unbounded growth).
  Deterministic iteration (`BTreeMap`, not `HashMap`). **Time is injected** (`now_ms` per call);
  callers must pass a monotonic clock (a backwards `now` would shorten a flow's life).

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
- **Raw sockets / ICMP beyond echo-to-gateway** — `ping` to the gateway works (pass 2a); arbitrary
  ICMP passthrough is out of scope.
- **DHCP / DNS server** — E3-T15 (this crate provides the hooks; the servers land there).

## Passes

1. **Pass 1 (done):** the addressing constants, the `OutboundConnector`/`ConnectError` trait
   contract, and the **`FlowTable`** (NAT table with idle timeouts + bounds + deterministic
   iteration), fully unit-tested — the self-contained core, no smoltcp.
2. **Pass 2a (done):** the smoltcp `phy::Device` (`device.rs`) + the `Interface` (`stack.rs`) owning
   `10.0.2.2`, answering **ARP** and **ICMP echo** — proven by frame-injection tests (ARP
   request→reply; other-IP ignored; ping→echo reply). No async, no boot.
3. **Pass 2c–2f (done):** `NativeConnector` (tokio, `native.rs`); the TCP flow classifier
   (`tcp.rs`); the `FlowManager` control plane (`manager.rs`); and **promiscuous TCP accept**
   (`any_ip` + `open_tcp`, `stack.rs`) — a guest SYN to an arbitrary external host handshakes
   (SYN → SYN-ACK).
4. **Pass 2b (next — the async byte-bridge):** wire the accepted smoltcp socket ⇄
   `NativeConnector` with backpressure/half-close, driven by the `FlowManager` actions, then the
   native integration tests (HTTP GET through slirp to a local server; 50-concurrent; 100 MB
   integrity). The booted-Alpine acceptance leg is later still (long boot, env-gated).
