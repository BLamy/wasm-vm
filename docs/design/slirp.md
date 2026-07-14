# Slirp — user-mode network for the guest (E3-T14)

A user-mode TCP/IP stack that terminates the guest's ethernet world entirely in Rust, so the guest
gets outbound networking (DNS, HTTP, `apk`, pulling OCI images from inside the guest) with **no
privileged host networking** — no TUN/TAP, no root, works in a browser tab. smoltcp parses and
answers the guest's frames; guest-initiated TCP flows are NATed onto abstract connector traits. The
native harness backs them with real sockets, while the browser tunnels them over a multiplexed
WebSocket to `wvrelay`. Internal UDP is implemented for DHCP and DNS; arbitrary external UDP is
explicitly deferred (see Out of scope).

This is the largest networking task; it lands in passes. **This doc is a deliverable and is kept in
sync with the code** — a contract stated here but not implemented is a bug.

## Addressing (slirp conventions, matching QEMU's user net)

| Role | Address |
|---|---|
| Guest subnet | `10.0.2.0/24` |
| Guest host | `10.0.2.15` (assigned by the in-stack DHCP server) |
| Gateway (us) | `10.0.2.2` |
| DNS (us) | `10.0.2.3` |

The slirp stack owns `10.0.2.2` and `10.0.2.3`: it answers ARP, replies to ICMP echo at
`10.0.2.2`, and serves DHCP. The DNS parser/forwarder/DoH and OS-resolver cores exist under E3-T15;
the remaining work there is wiring the browser resolver into the synchronous backend and proving
name resolution in booted Alpine. External TCP destinations are NATed outbound.

## Architecture

```
 guest ── virtio-net frames ──▶ ┌──────────────── slirp crate ────────────────┐
                                │  phy::Device  ⇄  smoltcp Interface           │
   (Vec<u8> ethernet frames,    │      │              │ owns 10.0.2.2/.3,      │
    the E3-T13 NetBackend seam) │      │              │ answers ARP/ICMP,      │
                                │      │              │ promiscuous TCP accept │
                                │      ▼              ▼                        │
                                │   FlowTable ◀──▶ bounded per-flow pump     │
                                │  (NAT, timeouts)     │                       │
                                └──────────────────────┼───────────────────────┘
                                                       ▼
                                        connector(host, port)
                                          → NativeConnector (tokio)
                                          → StdConnector (sync tests)
                                          → WsConnector → wvrelay [browser]
```

- **phy::Device glue** *(pass 2a — implemented, `device.rs`)* — a `smoltcp::phy::Device` impl over
  two `Vec<u8>` frame queues: RX = frames from the guest (the E3-T13 `NetBackend` seam), TX = replies
  for the guest. No copies beyond smoltcp's token model.
- **Interface** *(pass 2a/2f, `stack.rs`)* — a smoltcp `Interface` configured with the gateway IP
  `10.0.2.2/24`; answers **ARP** and **ICMP echo** for it (pass 2a). **Promiscuous TCP accept**
  (pass 2f): `Interface::set_any_ip(true)` makes it process guest packets to ANY dst IP, and
  `SlirpStack::open_tcp_flow(key)` adds a smoltcp TCP socket LISTENING on that external endpoint —
  so a guest SYN to an arbitrary external `IP:port` completes the handshake (SYN → SYN-ACK, verified
  by frame injection). **`any_ip` is GATED by a frame filter** (`accept_frame` in `inject`): smoltcp
  only ever sees ARP-for-the-gateway, IPv4-to-the-gateway (ICMP echo / local TCP), and TCP to an
  endpoint we've opened. Everything else — external ICMP, external UDP, un-opened-flow TCP,
  non-gateway ARP — is dropped BEFORE smoltcp, so the stack never forges a reply *as* an external
  host it hasn't opened a flow for (without the filter, `any_ip` made smoltcp answer `ping 8.8.8.8`,
  RST an un-opened SYN, and ICMP-unreachable external UDP — all as the impersonated host; critic
  CRITICAL). Concurrent connections to the same external `IP:port` are demultiplexed by a unique
  smoltcp-local port alias per full guest 4-tuple; ingress/egress TCP ports and checksums are rewritten
  at the stack boundary, so guest and real server still see the original port. This is load-bearing:
  50 simultaneous same-endpoint flows are byte-distinct in the acceptance suite.
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
  `NativeConnector` = `tokio::net::TcpStream` (tests + native CLI). The browser uses the synchronous
  sibling trait `SyncConnector`: `WsConnector` multiplexes flow-control-aware streams over a browser
  `WebSocket` to `wvrelay`, which owns the real sockets. **Contract:** connect either yields a duplex
  stream or fails
  within the connect timeout with a typed error the stack maps to a guest RST.
- **FlowTable** — the NAT table (this pass): entries keyed by `(proto, guest_ip, guest_port,
  dst_ip, dst_port)`, each with a last-activity timestamp and a per-protocol idle timeout (TCP
  **2 h**, UDP **30 s**). A shorter tier for TCP handshaking/closing states needs per-flow TCP state,
  which the bridge tracks in **pass 2** — pass 1 keys the timeout on the protocol only. Bounded total
  entries (LRU eviction); per-flow buffers and WebSocket queues have explicit hard caps.
  Deterministic iteration (`BTreeMap`, not `HashMap`). **Time is injected** (`now_ms` per call);
  callers must pass a monotonic clock (a backwards `now` would shorten a flow's life).

## Flow control

Transport backpressure must propagate into smoltcp's window and back: when the outbound side stalls,
we stop reading from the smoltcp socket → its receive window closes → the guest sender stalls; when
the guest stalls, we stop reading the outbound socket. Per-flow buffers are capped, so a 60 s server
stall mid-stream must not grow memory past the cap, and the flow must resume. The local backend only
drains another smoltcp window when its previous tail is empty; `WsConnector` accepts at most one
256 KiB pending window per flow. RST/FIN propagate in both directions, including guest half-close.
The permanent acceptance streams 100 MiB each way and asserts byte identity, connector/backend queue
bounds, and peak-RSS delta.

## NAT table lifecycle

- **Create** on the guest's first packet of a flow (TCP SYN / first UDP datagram).
- **Refresh** last-activity on guest packets for the tracked flow.
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
- **Arbitrary external UDP NAT** — v1 exposes only internal UDP services (DHCP and DNS). Browser UDP
  needs a datagram-aware relay protocol rather than pretending a TCP stream preserves datagrams.
- **Complete DNS wiring/boot proof** — E3-T15. DHCP is wired and proven in native + browser Alpine;
  DNS core modules exist, but the browser DoH transport is not yet attached to `SlirpLocalBackend`.

## Passes

1. **Pass 1 (done):** the addressing constants, the `OutboundConnector`/`ConnectError` trait
   contract, and the **`FlowTable`** (NAT table with idle timeouts + bounds + deterministic
   iteration), fully unit-tested — the self-contained core, no smoltcp.
2. **Pass 2a (done):** the smoltcp `phy::Device` (`device.rs`) + the `Interface` (`stack.rs`) owning
   `10.0.2.2`, answering **ARP** and **ICMP echo** — proven by frame-injection tests (ARP
   request→reply; ping→echo reply). No async, no boot. (Pass 2f's `any_ip` later broadened ARP to
   the whole subnet — see below.)
3. **Pass 2c–2f (done):** `NativeConnector` (tokio, `native.rs`); the TCP flow classifier
   (`tcp.rs`); the `FlowManager` control plane (`manager.rs`); and **promiscuous TCP accept**
   (`any_ip` + `open_tcp`, `stack.rs`) — a guest SYN to an arbitrary external host handshakes
   (SYN → SYN-ACK).
4. **Data paths (done):** async `Bridge` + `NativeConnector` for the CLI, synchronous
   `SlirpLocalBackend` + `StdConnector` for native acceptance, and `WsConnector` + browser
   `WebSocket` + `wvrelay` for wasm. DHCP is driven in both native and browser backends. Evidence:
   real browser Alpine DHCP/ping/wget with a host-matching SHA-256; 50 concurrent distinct flows;
   100 MiB byte-exact each direction with bounded memory; half-close/refusal/backpressure suites.
