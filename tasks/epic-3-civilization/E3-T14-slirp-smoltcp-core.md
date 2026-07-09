---
id: E3-T14
epic: 3
title: Slirp-style user-mode network core on smoltcp with NAT
priority: 314
status: pending
depends_on: [E3-T13]
estimate: L
capstone: false
---

## Goal
A user-mode TCP/IP stack — our slirp — that terminates the guest's ethernet world entirely
in Rust: smoltcp parses/answers guest frames, guest-initiated TCP connections are accepted
locally and NATed onto an abstract `OutboundConnector` trait, UDP flows get per-flow NAT
entries, all with no privileged host networking. Architecture documented before code.

## Context
This is the largest networking task; the design doc is a deliverable, not an afterthought.
Adopt slirp conventions: guest subnet 10.0.2.0/24, guest 10.0.2.15 (via T15 DHCP), gateway
10.0.2.2, DNS 10.0.2.3. Architecture: virtio-net frames feed a custom `smoltcp::phy::Device`
impl; the smoltcp `Interface` owns the gateway IPs and answers ARP/ICMP; TCP interception —
any guest SYN to any external IP:port is accepted by a listening smoltcp socket (promiscuous
accept: sockets created on demand keyed by 4-tuple), then bridged byte-for-byte to an
`OutboundConnector::connect(host, port) -> (tx, rx)` future implemented by T16/T17
transports (and by plain `tokio::net::TcpStream` in the native harness — enabling full
native testing against real localhost servers). Flow control is the hard part: transport
backpressure must propagate into smoltcp's window (stop reading from the smoltcp socket →
window closes → guest sender stalls) and vice versa. NAT table with idle timeouts (TCP
established 2h, UDP 30s), RST/FIN propagation in both directions, and bounded per-flow
buffers.

## Deliverables
- `docs/design/slirp.md`: addressing plan, socket-interception design, connector trait
  contract (incl. backpressure and half-close semantics), NAT table lifecycle, buffer
  bounds, what is out of scope (inbound connections, IPv6 — record explicitly).
- `slirp` crate (core, no_std-unfriendly deps avoided; native + wasm): smoltcp device glue,
  TCP interception/bridging, UDP NAT, ICMP echo to 10.0.2.2, flow table + timeouts.
- `NativeConnector` (tokio) for the native harness.
- Native integration tests: guest-side smoltcp test client (or booted Alpine under the
  native harness) doing HTTP GET against a local hyper server; concurrent-connection test;
  half-close (`shutdown(WR)`) test; large-transfer (100 MB) integrity test via sha256.

## Acceptance criteria
- [ ] Native harness: booted Alpine fetches `http://192.0.2.1:8080/file` (a test-net
      address the `NativeConnector` maps to a local hyper server) via `wget`; body sha256
      matches the served file — i.e., guest TCP through slirp to a real socket,
      content-identical.
- [ ] 50 concurrent guest TCP connections complete with correct data (no cross-flow bleed —
      each flow carries a distinct pattern, verified server-side).
- [ ] 100 MB transfer both directions is content-identical and memory stays bounded
      (per-flow buffer cap enforced; assert peak RSS delta in test).
- [ ] Guest `ping 10.0.2.2` gets ICMP replies; NAT entries expire (observe table size
      return to zero after idle timeout with time mocked or shortened).
- [ ] Half-close works: guest `shutdown(WR)` still receives the server's remaining data.

## Adversarial verification
Attack flow control and teardown. Stall the server side of a transfer for 60 s mid-stream —
guest connection must survive and resume, slirp buffers must not grow past their cap. Kill
the outbound socket abruptly (RST) and verify the guest sees ECONNRESET promptly, not a
hang. Open 1000 flows and abandon them — table must shrink via timeouts; leaked sockets or
unbounded memory refutes. SYN to a port the connector refuses: guest must get RST within
the connect-timeout. Run the 100 MB test with a connector that delivers data in 1-byte
chunks (pathological framing) — corruption or quadratic slowdown refutes. Diff `docs/design/
slirp.md` claims against behavior; any contract stated but unimplemented refutes.

## Verification log

**2026-07-07 — pass 1: design + crate scaffold + NAT flow table (the pure core).** This is a large
task landed in passes; pass 1 is the self-contained, deterministic, unit-tested core with NO smoltcp
/ tokio yet (so no guest boot, no async runtime, and the browser build stays clean).
- **`docs/design/slirp.md`** — the full architecture (required deliverable): addressing plan
  (10.0.2.0/24, guest .15, gateway .2, DNS .3), the phy-device/Interface/promiscuous-TCP-accept
  design, the `OutboundConnector` contract (incl. backpressure + half-close semantics), the NAT
  table lifecycle (create/refresh/expire/bound), and explicit OUT-OF-SCOPE (inbound port-forward,
  IPv6, raw ICMP, DHCP/DNS server) — with the pass split written down.
- **`crates/slirp`** (new workspace member): `net` addressing constants + `is_local`/`in_subnet`;
  the `OutboundConnector` trait + `ConnectError` (Refused/TimedOut/Unreachable/Denied) contract; and
  **`FlowTable`** — NAT keyed by the 5-tuple, TIME-INJECTED (`now_ms` on every method, no clock of
  its own → deterministic + reproducible), `BTreeMap` (ordered, no HashMap), idle timeouts (TCP 2 h,
  UDP 30 s), a hard entry bound with **LRU eviction** returning the evicted flow so the caller tears
  down its socket. 7 unit tests: create-then-refresh; UDP-expires-at-30s-while-TCP-survives; refresh
  keeps a flow alive past its timeout; bound evicts the LRU; refresh updates LRU order; remove
  idempotent; sweep is deterministic + only-expired. fmt + clippy + determinism-hazards green.

**2026-07-07 — pass 2a: smoltcp phy::Device + Interface answering ARP.** Added `smoltcp = 0.13`
(default-features off + std/medium-ethernet/proto-ipv4/socket-tcp/icmp/udp; the browser build doesn't
pull this crate). `device.rs`: `SlirpDevice` — a `phy::Device` over two `Vec<u8>` frame queues (RX
from guest, TX to guest), the RxToken owning the frame so `receive` can also hand out a tx token.
`stack.rs`: `SlirpStack` — a smoltcp `Interface` owning the gateway `10.0.2.2/24`, with
`inject`/`poll(now_ms)`/`take_egress`. Proven by frame-injection (no async, no boot): a guest ARP
request for 10.0.2.2 → a correct gateway ARP reply (sender MAC/IP + target = guest, opcode 2); an ARP
for another IP (10.0.2.99) is ignored.

**Adversarial cold-clone critic on pass 2a: SOUND, and it PINNED the ICMP root cause.** It proved the
phy::Device TX path is byte-identical to smoltcp's own loopback device (no spurious/empty/wrong-length
frames — smoltcp resolves neighbors + computes total_len BEFORE consuming the token), the ARP test is
non-vacuous, and my "ICMP needs a socket" hypothesis was WRONG: smoltcp 0.13 gates the interface's
auto echo-reply behind the `auto-icmp-echo-reply` feature (in its `default` set, which I'd disabled),
so the reply arm was compiled out and every ping silently dropped. Fixes: added the one feature →
**ICMP echo now works and is IN pass 2a** (`gateway_answers_icmp_echo`: ping 10.0.2.2 → echo reply,
ident/seq echoed). Also (critic MINORs): MTU 1500→**1514** (`Medium::Ethernet` MTU includes the
14-byte header; a bare 1500 would silently cap the guest TCP MSS to 1446 in 2b); the "ICMP now" code
comments now match the honest doc. **10 slirp tests** (7 NAT + ARP + ARP-ignored + ICMP echo). fmt +
clippy + determinism green.

**2026-07-07 — pass 2c: `NativeConnector` (tokio) — the concrete OutboundConnector.** Added tokio
behind a default-on `native` feature (`crates/slirp` verified to still compile `--no-default-features`
without tokio, so a future wasm build can drop it; the browser doesn't depend on this crate anyway).
`native.rs`: `NativeConnector` implements `OutboundConnector` with `Conn = tokio::net::TcpStream`,
`connect(host,port)` wrapped in a connect-timeout (default 10 s) so a black-holed destination fails
promptly instead of hanging; `io::Error` → typed `ConnectError` (ConnectionRefused→Refused,
Timed/Network/Host-unreachable mapped). 3 tokio tests against REAL local sockets: a live listener
round-trips a byte both ways (duplex stream proven); a closed loopback port → `Refused`; an
unroutable TEST-NET-1 address (192.0.2.1) → a typed failure (`TimedOut`/`Unreachable`) within the
300 ms timeout, asserted to NOT hang. 13 slirp tests total. fmt + clippy (all-features) + determinism
green.

**2026-07-07 — pass 2d: TCP flow classifier (front half of promiscuous accept).** `tcp.rs`:
`classify(frame) -> FrameClass` parses a guest ethernet frame with smoltcp wire types and decides
`OutboundSyn(FlowKey)` (a fresh SYN — `syn && !ack` — to an EXTERNAL host: a new flow the bridge will
`connect` + create a smoltcp socket for), `LocalTcp` (TCP to `10.0.2.2`/`.3`, answered locally),
`ExistingTcp(FlowKey)` (non-SYN / SYN+ACK — belongs to an open flow), or `Other` (non-IPv4-TCP /
malformed — never panics). Extracts the guest 4-tuple into a `nat::FlowKey`. 6 unit tests (SYN→ext
OutboundSyn with the exact 4-tuple; SYN→gateway LocalTcp; bare ACK ExistingTcp; SYN+ACK not-fresh;
ARP/UDP/truncated/empty → Other). `smoltcp::wire::Ipv4Address` is `core::net::Ipv4Addr`, so 4-tuples
convert with no glue. **Cold-clone critic: SOUND** (verified IP-options/IHL>5 offset handled, full
flag matrix, 4-tuple not swapped, ZERO panics on 20k random buffers). Adopted MINOR-1: an in-subnet
non-local dst (10.0.2.x != .2/.3, incl the guest's own .15 / .255 broadcast) is NOT NATed out — no
such host on the virtual link — it's dropped (`Other`); added a test. MINOR-2 noted in-code (the
bridge must distinguish FIN/RST from data in pass 2b). 20 slirp tests. fmt + clippy + determinism green.

**Pass 2b (next — the async bridge):** wire `OutboundSyn` → create a smoltcp listening socket for the
4-tuple + `NativeConnector::connect`, pump bytes both ways with backpressure + half-close, and the
native integration tests (HTTP GET through slirp to a local server; 50-concurrent; 100 MB integrity).
The booted-Alpine acceptance leg is later (long boot, env-gated).
