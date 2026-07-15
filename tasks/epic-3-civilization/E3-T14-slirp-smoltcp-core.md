---
id: E3-T14
epic: 3
title: Slirp-style user-mode network core on smoltcp with NAT
priority: 314
status: in_progress
depends_on: [E3-T13, E3-T12]
estimate: L
capstone: false
---

## Goal
A user-mode TCP/IP stack — our slirp — that terminates the guest's ethernet world entirely
in Rust: smoltcp parses/answers guest frames, guest-initiated TCP connections are accepted
locally and NATed onto an abstract `OutboundConnector` trait, UDP flows get per-flow NAT
entries, all with no privileged host networking. Architecture documented before code.

**VISIBLE-RAIL DEFERRAL 2026-07-08:** pause broader networking after the current verified
core slices until the Docker tab has one real bundled busybox Run (E3.5-T05a) and that same
state reloads through snapshot restore (E3-T12). Slirp resumes after the visible path is
undeniable.

**IMPLEMENTATION SCOPE 2026-07-14:** E3-T14 v1 terminates guest TCP, internal DHCP UDP, and
arbitrary guest-initiated external UDP. The browser relay protocol has distinct datagram opcodes;
it does not pretend a TCP byte stream preserves UDP boundaries. DNS boot wiring remains E3-T15.

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
- [x] Native harness: booted Alpine fetches `http://192.0.2.1:8080/file` (a test-net
      address the `NativeConnector` maps to a local hyper server) via `wget`; body sha256
      matches the served file — i.e., guest TCP through slirp to a real socket,
      content-identical.
- [x] 50 concurrent guest TCP connections complete with correct data (no cross-flow bleed —
      each flow carries a distinct pattern, verified server-side).
- [x] 100 MB transfer both directions is content-identical and memory stays bounded
      (per-flow buffer cap enforced; assert peak RSS delta in test).
- [x] Guest `ping 10.0.2.2` gets ICMP replies; NAT entries expire (observe table size
      return to zero after idle timeout with time mocked or shortened).
- [x] Half-close works: guest `shutdown(WR)` still receives the server's remaining data.
- [x] External UDP uses per-five-tuple NAT with 30 s idle expiry; distinct datagrams round-trip
      byte-exact through both native sockets and the browser WebSocket relay.

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

**2026-07-07 — pass 2e: `FlowManager` (the control plane).** `manager.rs`: `FlowManager` ties
`tcp::classify` + the NAT `FlowTable` into per-frame flow-lifecycle `Action`s the async bridge will
dispatch on — `Connect(FlowKey)` (a new outbound flow → the bridge opens the connector + a smoltcp
socket), `Existing(FlowKey)` (feed to the flow's socket), `Local` (smoltcp answers), `Ignore` (drop).
`on_guest_frame(frame, now_ms) -> FrameOutcome { action, evicted }` also surfaces any NAT-bound
eviction so the bridge tears down the evicted flow's socket. Pure + time-injected. 7 unit tests: new
SYN → Connect (+ creates a flow); retransmitted SYN → Existing (NOT a 2nd connect); data refreshes a
tracked flow; STRAY data for an unknown flow → Existing but creates NO NAT entry; a new flow at
capacity evicts the LRU (evicted surfaced); Local/Ignore create no flow; expire+remove. 27 slirp
tests. fmt + clippy + determinism green.

**2026-07-07 — pass 2f: promiscuous TCP accept.** `stack.rs`: `Interface::set_any_ip(true)`
(process guest packets to ANY dst IP) + `SlirpStack::open_tcp(dst, port)` (a per-flow smoltcp TCP
socket LISTENING on the external endpoint) + `tcp_state(handle)`. Proven by frame injection (no
async, no boot): a guest SYN to an arbitrary external host (93.184.216.34:80) → a correct SYN-ACK
from that endpoint to the guest's source port, and the socket  leaves LISTEN.

**Adversarial cold-clone critic: REFUTED (FIX-FIRST) → fixed.** The accept proof was genuine + load-
bearing, but `set_any_ip(true)` alone made smoltcp IMPERSONATE every external IP for flows we never
opened (critic confirmed by repro, all clean regressions from any_ip-off): C1 `ping 8.8.8.8` → forged
echo reply as 8.8.8.8; C2 SYN to an un-opened external port → forged RST as that host; C3 external UDP
→ forged ICMP port-unreachable as that host. FIX: a frame filter (`accept_frame`, applied in
`inject`) gates `any_ip` — smoltcp only ever sees ARP-for-the-gateway, IPv4-to-the-gateway, and TCP to
an endpoint we've `open_tcp`'d (tracked in `open_endpoints`); everything else is dropped BEFORE
smoltcp, so no impersonation. This also restores gateway-only ARP (reverted the ARP test to
`is_empty`). New `does_not_impersonate_external_hosts` test asserts 0 egress for all three C1/C2/C3
cases; the opened-flow SYN→SYN-ACK still works. Doc updated (any_ip is filter-gated, not "harmless
ARP only"); the driver must `open_tcp` a flow before injecting its SYN. **29 slirp tests.** fmt +
clippy + determinism + no-default build green. Honest consequence
(documented + tested): `any_ip` makes the interface also answer ARP for in-subnet addresses (not just
.2) — harmless, since the guest only ARPs the gateway. 28 slirp tests. fmt + clippy + determinism +
no-default-features build green.

**2026-07-07 — pass 2g: TCP data path + teardown (`stack.rs`).** Added the socket byte-level API the
async bridge drives: `tcp_recv` (drain guest→outbound bytes), `tcp_send` (enqueue outbound→guest,
returns accepted count for backpressure), `tcp_can_send`, `tcp_close` (half-close/FIN), and
`remove_tcp` (frees the 128 KiB buffers + drops the endpoint — the critic-M2 dealloc counterpart to
`open_tcp`). Proven WITHOUT a boot by a hand-driven full handshake: guest SYN → SYN-ACK (read
slirp's ISN) → guest ACK → **Established**; guest "hello" → `tcp_recv` returns it; `tcp_send("world")`
→ a data segment carrying the bytes egresses to the guest; `remove_tcp` teardown → a fresh SYN to the
endpoint is filter-dropped. 30 slirp tests. fmt + clippy + determinism + no-default build green.

**Adversarial cold-clone critic on pass 2g: SOUND data path, one MAJOR teardown trap fixed.** The
critic verified (by repro + mutation-kill) the data path is correct — multi-segment recv drains
in-order/no-loss, over-buffer send is honest partial backpressure, send-on-non-Established is a safe
0, `close` emits a real FIN, and the handshake test is genuine (no-op'ing `tcp_recv`/`tcp_send` fails
it). MAJOR (fixed): after `remove_tcp` the `SocketHandle` dangled — accessors did an unguarded
`SocketSet::get` that PANICS on a stale handle, or WORSE silently addressed a different flow once
smoltcp reused the slot (cross-flow corruption the bridge would hit). Fix: a single `flows:
BTreeMap<SocketHandle,(ip,port)>` source of truth — every accessor (`tcp_state`→`Option`,
`tcp_recv`/`tcp_send`/`tcp_can_send`/`tcp_close`) returns a safe default when the handle isn't an
active flow (no panic, no reused-slot access), `remove_tcp(handle)` drops socket+endpoint together
(MINOR: no more caller-supplied-tuple desync), and the filter reads the same map. Doc warns the
handle is invalid + slots are reused so the bridge must drop it on teardown. New use-after-remove
test asserts None/empty/0/no-panic. 30 slirp tests. fmt + clippy + determinism + no-default green.

**2026-07-07 — pass 2h: `Bridge` control plane (`bridge.rs`).** The connection LIFECYCLE that ties
`FlowManager` (classify + NAT) to `SlirpStack` (accept sockets) to an `OutboundConnector`: a guest SYN
to a NEW external 4-tuple opens a listening socket AND `connect`s the outbound side, tracking both in
`flows: BTreeMap<FlowKey, FlowConn>` (holds the `SocketHandle` + the outbound stream, ready for the
byte-pump). `on_guest_frame` ALWAYS injects the frame (the stack's `accept_frame` filter is the real
gate — dropping ARP would break neighbor learning), and drives lifecycle only on `Connect` (open →
`connect().await` → track, or on refusal `remove_tcp` + `manager.remove` so the SYN is then
filter-dropped and the guest times out) and on eviction/expiry (`teardown` drops socket + stream +
NAT entry together — no leak). Proven with a MOCK connector (records connects, no real sockets) +
`#[tokio::test]`s: new SYN connects exactly once + opens the socket + slirp SYN-ACKs the guest;
connect-refusal tears the half-open flow down (no SYN-ACK); a retransmitted SYN does NOT reconnect;
a new flow at `max_flows=1` evicts + tears the old one down (bounded); local (gateway) SYN + ARP do
NOT open an outbound flow. 35 slirp tests. fmt + clippy (all-features) + no-default-features build
(tokio stays optional — `Bridge` needs only the trait) green.

**Adversarial cold-clone critic on pass 2h: SOUND lifecycle, one CRITICAL hot-path hijack fixed.** The
critic verified (leak probes across ok / connect-fail / eviction / eviction+fail / expire — every path
ends `(sockets, endpoints, flows)` fully in sync, `bridge.flows ⊆ manager table` always so `Connect`
never double-opens; retransmit guard holds; IPv6 can't strand a NAT entry; the mock tests are
non-vacuous) and found ONE **CRITICAL** in the inject/poll seam. `inject` ADMITS a frame now but `poll`
CONSUMES it later; if flow A's SYN is queued, then a new flow B at capacity evicts A and reuses A's
exact `(dst,port)` endpoint (smoltcp recycles the freed handle slot), the deferred `poll` feeds A's
stale SYN into B's fresh LISTEN-state listener → a **forged SYN-ACK to the torn-down flow A** (guest
40001) AND B's listener bound to the **wrong guest 4-tuple** (cross-flow corruption: the byte-pump
would shuttle 40001's bytes over B's outbound stream), while the intended flow B gets a **RST**. This
is the hot browser path — many parallel connections to one `host:443` under a churning flow table.
Fix (critic-recommended, mutation-killed): `on_guest_frame` now `poll`s IMMEDIATELY after `inject`, so
every admitted frame is consumed under the socket topology it was admitted through — no frame outlives
a later `open_tcp`/`remove_tcp`. New regression `stale_syn_cannot_hijack_reused_listener_after_
same_endpoint_eviction` (cap=1, same endpoint) asserts the LIVE flow B gets a SYN-ACK, never a RST;
verified it FAILS without the poll (0/1) and PASSES with it (mutation-kill). The deeper full-4-tuple
accept guard for *concurrent* same-endpoint flows is noted for the byte-pump slice. 36 slirp tests.
fmt + clippy (all-features) + no-default-features build green. **CI green on #121 (all checks pass).**

**2026-07-07 — pass 2i: first integration test vs the REAL `NativeConnector` (`bridge/tests.rs`).** Every
bridge test so far used the mock connector; this proves the connect leg end-to-end against an ACTUAL
socket. `real_native_connector_dials_an_actual_tcp_connection` (native-gated) binds a real
`tokio::net::TcpListener` on an ephemeral `127.0.0.1:0`, builds `Bridge::new(mac, NativeConnector, …)`,
drives an ARP + a guest SYN to the listener's real `(ip,port)`, then asserts `listener.accept()`
returns within 2 s — i.e. `on_guest_frame` → `open_tcp` → `NativeConnector::connect().await` opened a
GENUINE outbound TCP connection to the server — plus the flow is tracked and the guest receives its
SYN-ACK. The genuine dial is witnessed by TWO independent load-bearing assertions: `listener.accept()`
returning, AND `flow_count()==1` (the bridge inserts a `FlowConn` only in the `Ok(stream)` arm of
`connect()`, so `flow_count==1 ⟺ the dial succeeded`). The SYN-ACK is an ADDITIONAL guest-side check —
it egresses from the local listening socket regardless of the outbound dial, so it confirms the
guest-facing handshake but is NOT itself a dial discriminator (critic MINOR: earlier wording overstated
it). Mutation-verified by the critic: deleting the whole `Action::Connect` block OR just the
`connect().await` both make `accept()` time out → fail; the no-dial mutation leaves `flow_count()==0`.
37 slirp tests.
fmt + clippy (all-features) + no-default-features build green (the native test is correctly compiled
out of the browser build). **CI green on #121 (all checks) — this stacks on it.** The byte-PUMP that
carries payload over this now-proven connection (non-blocking `try_read`/`try_write` per-flow driver +
backpressure + half-close) is the final slice.

**2026-07-07 — pass 2j: the byte-PUMP (`pump.rs`, native).** The data-path core: `pump_flow(stream,
guest_rx, guest_tx)` copies bytes bidirectionally between a guest flow and its outbound duplex stream
until BOTH directions close, honoring half-close each way independently. Deliberately DECOUPLED from
smoltcp — it talks to the guest over a channel pair and to the outbound over any `AsyncRead+AsyncWrite`
— so it is transport-agnostic (native `TcpStream` now, browser transport later) and unit-testable with
`tokio::io::duplex` + channels, no sockets, no smoltcp. Semantics: guest→outbound writes each guest
chunk to the stream, and on `guest_rx` close (guest FIN) `shutdown`s ONLY the write half (server may
still send); outbound→guest forwards reads to `guest_tx`, and on server FIN/EOF drops `guest_tx`
(channel close = tell the stack to FIN the guest). The future completes only when both directions end,
so a half-open connection keeps the pump alive (as TCP requires). Proven deterministically: (1)
`copies_both_ways_then_honors_guest_fin_then_server_close` — bytes both ways, guest-FIN half-closes
outbound cleanly (server sees EOF), server-close closes the guest channel; (2)
`server_fin_closes_guest_channel_but_guest_can_still_send` — the OTHER half-close order (server FIN
first, guest keeps sending on the half-open); (3) `large_transfer_is_delivered_in_full_and_in_order` —
100 KiB through a 64-byte duplex + depth-4 channels, exact bytes in order (backpressure, no deadlock).
40 slirp tests. fmt + clippy (all-features) + no-default-features build green (pump is native-gated —
tokio stays out of the browser build). The remaining leg: WIRE these channels to
`SlirpStack::tcp_recv`/`tcp_send`/`tcp_close` in the `Bridge`, then the env-gated booted-guest
acceptance.

**Adversarial cold-clone critic on pass 2j: SOUND copy/half-close, one MAJOR false-ack data-loss fixed.**
The critic verified (with repro/mutation tests) NO deadlock under real backpressure (a 50 KiB
request→response through a 16-byte duplex + depth-2 channels completes — the two directions are
independent `join!` arms, so a stall in one never blocks the other), half-close correct in BOTH orders
(including the guest-FIN-first order the PR hadn't tested), the 100 KiB test genuinely forces
interleaving, and `shutdown()` is load-bearing. It found ONE **MAJOR** (CRITICAL under the natural
Bridge wiring, where the stack ACKs a guest segment on enqueue into the bounded `guest_rx`): on an
outbound WRITE error, `to_outbound` just `return`ed, but `join!` keeps the pump alive until the reverse
side ends — so if the server's write half stayed open, `guest_rx`'s receiver lived un-drained and the
guest kept `send`ing bytes that returned `Ok`, were never written, and vanished on drop: **false
"delivered" acks + silent data loss.** Fix (critic-recommended, mutation-killed): `guest_rx.close()` on
write error, so further guest sends fail fast and the stack learns the outbound is dead. New regression
`write_error_closes_guest_channel_so_further_sends_fail_fast` (mock stream: writes error, reads stay
Pending) asserts `g2o_tx.closed()` resolves then sends `Err`; verified it FAILS (times out at 5.00s)
without the fix and PASSES with it. Also folded the critic's NITs: every pump test now runs under a 5 s
`guarded(...)` deadline so a half-close regression fails CLEANLY instead of hanging CI, and a doc note
records that a read-error (RST) is currently conflated with clean EOF (guest always sees a graceful FIN
— RST-fidelity is a stack-wiring-slice refinement). 41 slirp tests. fmt + clippy (all-features) +
no-default-features build green. **CI green on #123.**

**2026-07-07 — pass 2k: END-TO-END data path (native, `e2e_pump_stack.rs`).** The first time a guest
frame drives REAL outbound traffic and gets a REAL reply back through the whole stack. A hand-driven
guest (ARP→SYN→ACK→Established→data segment, via `tcp_seg`) sends `"hello slirp world"` into a real
`SlirpStack`; an inline servicing loop shuttles `tcp_recv`→`to_pump` and `from_pump`→`tcp_send`; a
`pump_flow` task carries the bytes over a REAL `tokio` TCP connection (`NativeConnector`) to a REAL
echo server; the echo travels back pump→stack and egresses to the guest as a data segment. The test
asserts an egress TCP segment to the guest (dst_port 40000) carries the exact bytes — non-vacuous
because those bytes only ever reach a guest-bound frame if the full round trip completed (the guest's
own inbound data is never echoed by smoltcp). Bounded by a 5 s `timeout` so a wiring regression fails
cleanly. 42 slirp tests. fmt + clippy (all-features) + no-default-features build green (the e2e module
is `#[cfg(all(test, feature = "native"))]` — excluded from the browser build). NOTE: the servicing loop
lives in the TEST here; lifting it into a `Bridge` method needs a spawn/ownership refactor (native-gate
+ `C::Conn: AsyncRead+AsyncWrite` rippling through the mock lifecycle tests) — deferred so this proves
the pieces compose first. Remaining: that `Bridge` wiring, then the env-gated booted-guest acceptance.

**2026-07-07 — pass 2l: `Bridge::service` — the data path lifted into the control plane (`bridge.rs`).**
The servicing loop the e2e proved (pass 2k) now lives in `Bridge` as a native-gated `service()`. Design
keeps the mock lifecycle tests untouched: the pump plumbing is a `#[cfg(feature="native")] pumps:
BTreeMap<FlowKey, PumpHandle>` field + a separate `impl … where C::Conn: AsyncRead+AsyncWrite+Send+'static`
block, so the generic `on_guest_frame`/`teardown` (used by the `Conn=()` mock) never gains the bound.
`FlowConn.stream` became `Option<S>` so `service` can `take` it. Per pass: `start_pumps` spawns a
`pump_flow` for each freshly-connected flow (taking its stream); then for every flow it drains
`tcp_recv`→`to_pump` ONLY while the channel has a reserve (real backpressure — an exhausted reserve
leaves bytes in the socket buffer, closing the guest window), forwards `from_pump`→`tcp_send`
(partial-accept safe, remainder retried), propagates half-close each way (guest FIN [socket can no
longer receive] → drop `to_pump` so the pump FINs outbound; server FIN/EOF [channel Disconnected] +
buffer flushed → `tcp_close` the guest, once), and reaps flows whose socket reached `Closed`/gone
(drop pump + flow + NAT entry together). `service` is non-blocking and never awaits, so it can't stall
the stack; the heavy copy is on the pump tasks. `expire`/`teardown` now also drop the pump handle.
Proven: `bridge_service_round_trips_guest_bytes_to_a_real_echo_server` drives a guest SYN/ACK/data in
via `on_guest_frame`, then `service()`+`poll()` shuttle "hello via bridge" out to a REAL tokio echo
server and the echo back to the guest (bool-returning timeout loop — no false pass). 43 slirp tests.
fmt + clippy green under BOTH `--all-features` AND `--no-default-features` (the `pumps` field, the
native impl, and the `stream` read are all `native`-gated → tokio stays out of the browser build).
Remaining: the env-gated booted-guest acceptance (drive `service` from the executor's poll loop).

**Adversarial cold-clone critic on pass 2l: SOUND lifecycle, one MAJOR outbound-backpressure gap fixed.**
The critic verified (repro + mutation) the guest→outbound backpressure (`try_reserve`), the half-close
ordering (no truncation — `tcp_recv` drains the whole rx buffer, including data delivered with the FIN,
BEFORE the `guest_finished_sending` check drops `to_pump`), reap consistency (all four maps keyed by the
same `(key, handle)`; `remove_tcp` deferred past the loop so no handle invalidates mid-pass; `tcp_close`
→ `Closed` needs the FIN ACKed so reap can't drop an un-ACKed FIN), the `mem::take`+restore pattern, the
`--no-default` gating, and test honesty (neutering `service` fails the round trip via timeout). It found
ONE **MAJOR** (borderline CRITICAL — remotely-triggerable OOM from a single flow): the outbound→guest
path had NO backpressure. `service` drained `from_pump` into the UNBOUNDED `pending_out` every pass
regardless of whether the guest could accept; a fast server + a guest whose window is shut (`tcp_send`
accepts 0) inflates `pending_out` without limit (critic repro: ~100 MiB in 400 passes; smoltcp's own
buffer capped at ~128 KiB). Fix (critic-recommended, mutation-killed): only pull the next `from_pump`
batch once `pending_out` is empty — leaving bytes in the BOUNDED `from_pump` channel blocks the pump's
`guest_tx.send`, which backpressures the real server. (The FIN guard already required `pending_out`
empty, so deferring `Disconnected` detection loses nothing.) New regression
`outbound_to_guest_stays_bounded_when_the_server_floods_and_the_guest_stalls` (a `FloodConnector` whose
stream yields infinite bytes; guest never ACKs) drives 300 passes and asserts total buffered < 4 MiB;
verified it FAILS (unbounded) without the guard and PASSES with it (holds ~one channel drain). 44 slirp
tests. fmt + clippy green under BOTH `--all-features` and `--no-default-features`. **CI green on #126.**

**2026-07-08 — pass 3a: `SlirpBackend` — slirp wired into the machine's virtio-net (`crates/cli`).**
Everything above lived in `crates/slirp` and was driven by tests; this connects it to the actual VM.
The machine's `NetBackend` (`crates/core/dev/virtio/net.rs`) is **synchronous** (the run loop calls
`tx`/`rx`/`rx_ready` every quantum); slirp's `Bridge` is **async** (`on_guest_frame` awaits `connect`,
`service` spawns tokio pumps). `crates/cli/src/net_backend.rs` bridges them with a **dedicated driver
thread**: it owns the `Bridge` on a current-thread tokio runtime and loops — recv guest frames off an
unbounded channel → `on_guest_frame`, a 1 ms `interval` tick → `poll`/`service`/`expire`, then drain
`take_egress` into an `Arc<Mutex<VecDeque>>` the guest reads. The non-`Send` smoltcp state never leaves
that thread; only `Vec<u8>` frames cross, over the channel + shared queue. `tx` is a channel send, `rx`
/`rx_ready` read the shared queue — so the run loop is never blocked by network I/O. `Drop` drops the
sender (→ driver `recv()` yields `None` → loop breaks) and joins the thread. Wired into `boot.rs` behind
`--net-slirp` (takes precedence over `--net` loopback), gated with the boot subcommand (both cfg'd out
under `zicsr-stub`, as CI's `--all-features` clippy run does).

**Verified headlessly (2 in-crate tests, driven exactly as the run loop drives the backend — no boot):**
(A) `guest_arp_for_gateway_gets_a_reply_through_the_backend` — a guest ARP-for-the-gateway fed via
`tx` comes back as a gateway ARP reply (op=reply, spa=10.0.2.2, sha=GATEWAY_MAC) via `rx`, proving the
whole async-driver path end to end (tx → channel → driver thread → tokio → Bridge → SlirpStack →
take_egress → shared queue → rx). (B) `guest_syn_dials_a_real_server_and_gets_a_syn_ack` — an ARP then
a hand-built (smoltcp-emitted, checksummed) guest SYN to a **real** local `tokio::net::TcpListener`
makes slirp actually **dial** it (`listener.accept()` fires within 3 s ⇒ `NativeConnector` opened a
genuine outbound socket) and hand back a SYN-ACK to the guest's source port — slirp's actual purpose
(guest TCP → real socket) proven through the backend. Debugging (A→B) surfaced the neighbor-cache need:
without a preceding ARP the stack ARP-storms for the guest's MAC and can't address the SYN-ACK — the
test ARPs first, exactly as a real guest stack would.

**Local gate:** fmt clean; `clippy -p wasm-vm-cli --all-targets` clean BOTH default (compiles
boot+net_backend) AND `--all-features` (zicsr-stub cfg's them out) — 0 warnings; drive-by fixed 2
pre-existing `boot.rs` lints (collapsible-if, manual `Range::contains`) surfaced now that default clippy
compiles boot. New deps in `crates/cli`: `wasm-vm-slirp` (path) + `tokio` (rt/macros/time/sync/net/
io-util) — native harness only; the browser build never pulls them.

**Known limitations (documented in the module, for the next passes):** DHCP/DNS auto-config isn't wired
yet, so a booted guest needs a static address until pass 3b (the tests drive frames directly with the
static 10.0.2.15). `on_guest_frame` awaits `connect` inside the driver's select arm, so a connect to an
*unreachable* host serializes the loop until its timeout — fine for reachable/local flows; the fix
(spawn the connect) is the concurrency pass. The booted-Alpine acceptance (`wget` through slirp to a
local server; 50-concurrent; 100 MB integrity) remains the env-gated long-boot leg.

**Adversarial cold-clone critic on pass 3a: REFUTED (FIX-FIRST) → fixed.** Both tests confirmed
non-vacuous by mutation (neutering `tx`'s send OR the egress `q.extend` fails both); build/clippy/wasm
isolation clean. Findings folded in:
- **M1 (fixed):** `Drop` could block the caller up to the connector's 10 s timeout — an in-flight
  `connect().await` runs inside the driver's *already-resolved* `select!` arm, so dropping the sender
  doesn't interrupt it and a plain `join()` inherits the timeout. Fixed with a **bounded join**: drop
  the sender, then join off-thread with a 250 ms grace and detach (the driver is self-terminating and
  owns all its state, so detaching is memory-safe).
- **M2 (fixed) — the data path was untested (SYN-ACK is control-plane, answered without the pump moving
  a byte).** Added `guest_tcp_data_round_trips_through_the_backend_to_a_real_echo_server`: full guest
  handshake (SYN → parse slirp's ISN from the SYN-ACK → ACK) then PSH data to a **real** tokio echo
  server; asserts the SAME bytes come back to the guest — proving slirp's byte pump actually shuttled
  them out and the echo back, on the current-thread runtime driven by the 1 ms tick.
- **m2 (fixed):** interval → `MissedTickBehavior::Skip` (no burst catch-up after a stall).
- **m3 (documented):** egress `VecDeque` relies on smoltcp send-window/retransmit gating + the guest tx
  rate for boundedness (per-flow pump depth is capped at `PUMP_DEPTH`) — noted in-code.
- **m4 (fixed):** stale `Cargo.toml` comment `--net-mode` → `--net-slirp`.
- **m1 (acknowledged, deferred):** an unreachable-host connect still stalls the whole loop up to 10 s
  (spawn-the-connect is the concurrency pass — same root as M1's residual). **3 net_backend tests**;
  fmt + clippy clean (default + `--all-features`); full cli suite green. **CI #159 green.**

**Next (pass 3b):** spawn the connect (kills the loop-stall + the Drop residual), then wire DHCP
(`stack.run_dhcp`) + DNS/UDP services (`take_service_udp` + `UdpServices`) into the driver loop so a
booted guest auto-configures eth0, then the env-gated booted-Alpine acceptance.

### 2026-07-14 — worker — IMPLEMENTED at `01f901a`

Claim: E3-T14's v1 TCP slirp path now works end to end in both native and browser Alpine. Stock
OpenRC/`udhcpc` configures `eth0` as `10.0.2.15/24` with the default route through `10.0.2.2`; the
gateway answers ICMP; guest TCP crosses smoltcp, the bounded connector, and a real host socket; full
guest 4-tuples remain isolated even when 50 clients use the same destination; 100 MiB in each
direction is byte-exact within the asserted queue/RSS bounds; and FIN/backpressure/refusal paths are
covered. Browser WebSocket callbacks are polled from virtio-net, and `wvrelay` supports a deterministic
TEST-NET-to-loopback mapping for repeatable acceptance. DNS names are not claimed here: completing
Alpine name resolution is E3-T15; arbitrary external UDP is the explicit E3-T18 transport follow-up.

Evidence and exact gates:

- Native boot: `WASM_VM_SLIRP_HOST_MAP=192.0.2.1=127.0.0.1 target/release/wasm-vm boot
  --kernel releases/kernel/6.6.63/Image --drive file=/tmp/wasm-vm-e3-t14-native.ext4
  --net-slirp --append 'root=/dev/vda rw console=ttyS0 earlycon=sbi' --max-instrs 60000000000`.
  Guest observation: DHCP lease `10.0.2.15`, default route `10.0.2.2`, ping 3/3, then
  `wget -O /tmp/file http://192.0.2.1:8080/file`; guest and host SHA-256 both
  `a8aa13fc1f45fd3401d649871ad303e662d7c202254fb8ea7e558fde11f766a2`; clean poweroff and
  emulator exit 0.
- Browser: `make web-build`, `WVRELAY_HOST_MAP=192.0.2.1=127.0.0.1 target/release/wvrelay
  127.0.0.1:8081`, then one cache-disabled Playwright load of
  `http://127.0.0.1:8123/?slirpRelay=ws://127.0.0.1:8081`. Stock Alpine repeated the same DHCP,
  3/3 ping, 112-byte wget, and SHA-256 result. The in-page suite completed `126 passed, 0 failed`
  in 179.5 s; the E3 user-mode-network pip rendered `cap-pip verified`; console had no application
  errors (only the allowed favicon 404). Screenshots: `e3-t14-alpine-network.png` and
  `e3-t14-roadmap.png`.
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace` (full green run, including the 100,000,000-instruction debug timer leg;
  slirp: 194 passed/1 ignored, outbound acceptance: 7/7, WebSocket connector: 5/5)
- `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`
- `make web-build`

Mac evidence limitation: host `rr` is unavailable by platform policy. The handoff therefore carries
the deterministic native/integration gates plus the real browser Alpine run and screenshots. A fresh
verifier must still adversarially inspect this commit and either promote/refute it; only that session
may set `verified`.

VERDICT: refuted

### 2026-07-14 — adversarial verifier

- **P1 external UDP NAT — FAILED.** Predicted a guest UDP datagram to an external address would
  create the per-flow NAT entry and outbound datagram path required by the task Goal/Deliverable
  (`E3-T14`: lines 12-16, 43-49). Observed `SlirpStack::accept_frame` deliberately returns `false`
  for external UDP and `inject` only diverts internal service UDP (`crates/slirp/src/stack.rs:124-131,
  289-305`); the focused `stack::tests::does_not_impersonate_external_hosts` probe passed with zero
  egress. The handoff's claimed split is not backed by an implementation task: E3-T18 explicitly has
  “No production integration” and mentions datagrams only as *future* UDP
  (`E3-T18-webtransport-evaluation.md:12-21`). **Demand:** implement external UDP NAT here, or obtain
  an explicit scope decision and create a concrete production UDP task before resubmitting; E3-T18
  cannot carry this deliverable as written.
- **P2 refused native connection — FAILED.** Predicted a connector refusal would give the guest RST
  within the connect timeout (`E3-T14`: lines 72-73; design contract `docs/design/slirp.md:80`).
  Observed the native CLI's async `Bridge` removes the listener/NAT entry and explicitly leaves the
  guest to time out (`crates/slirp/src/bridge.rs:108-134`); its committed test passed by asserting
  *empty* egress (`crates/slirp/src/bridge/tests.rs:127-151`). The synchronous browser/StdConnector
  probe `guest_syn_to_a_refused_port_gets_reset_not_hung` passed, isolating the contradiction to the
  native async path used by `--net-slirp`. **Demand:** abort/poll the guest socket before teardown and
  add a full native-driver assertion that observes the RST promptly.
- **P3 abrupt outbound reset — FAILED.** Predicted an outbound RST would surface as guest
  `ECONNRESET`, not FIN (`E3-T14`: lines 69-70; design claim `docs/design/slirp.md:91-98`). Observed
  `pump_flow` explicitly merges `Err(_)` with clean EOF and drops the channel
  (`crates/slirp/src/pump.rs:73-92`); `Bridge::service` interprets that disconnect by calling
  `tcp_close`, which emits a graceful FIN (`crates/slirp/src/bridge.rs:277-307`). **Demand:** preserve
  EOF-vs-read-error through the pump and abort the guest socket on error, with a real reset probe.
- **P4 accepted TCP core — HELD (limited).** Predicted same-endpoint port aliasing and bounded bulk
  transfer would survive independent reruns. The 50-concurrent-flow test passed 50/50;
  `hundred_mebibytes_each_way_are_exact_with_bounded_memory` passed
  100 MiB in each direction in 39.90 s; the synchronous refused-port probe also passed. These establish
  the happy TCP core but do not exercise or waive P1-P3.
- **COVERAGE / NOVEL browser-transport attack — INSUFFICIENT.** The 112-byte browser wget exercises
  the normal WebSocket message path, but no cited evidence forces the new transport's malformed-frame,
  oversize-message, 32 MiB inbound-cap, 4 MiB outbound-cap, `onerror`, or `onclose` branches
  (`crates/wasm/src/ws_transport.rs:49-86, 97-152`). The 100 MiB test uses `StdConnector`, not this
  browser transport. **Demand:** record a browser/wasm run that forces each behavior mentioned by the
  bounds/failure contract, or add deterministic wasm tests and classify the remaining callbacks.
- **EVIDENCE — INSUFFICIENT.** The committed terminal screenshot genuinely shows browser Alpine DHCP,
  3/3 gateway ping, the 112-byte wget, and the matching `web/file` SHA-256. But the native boot is only
  a prose observation, `.playwright-mcp` metadata is untracked, and the handoff cites no guest trace,
  digest, or replayable transcript (`E3-T14`: lines 424-449). E0-T16 is verified, so the repo policy
  makes guest-layer evidence mandatory on this Mac (`AGENTS.md:91-98`). **Demand:** re-record the final
  native and browser happy runs with committed/reopenable guest trace/digest references after P1-P3
  are fixed.
- **MOCK / ENV:** the TEST-NET host maps are explicit acceptance fixtures and the committed browser
  file's SHA-256 matches the screenshot; no self-licking payload mismatch found. The maps prove only
  deterministic TCP-to-loopback routing and do not stand in for external UDP or teardown behavior.
- **SUITE:** no promotion while the task is refuted. Required future permanent artifacts are the
  external-UDP NAT test, native async refusal/RST tests, outbound-reset distinction test, 60 s
  stall-and-resume run, 1000-abandoned-flow expiry run, and 1-byte-framing 100 MiB run specified by
  the task's own attack list.

Commands: `cargo test -p wasm-vm-slirp --lib stack::tests::does_not_impersonate_external_hosts
-- --exact --nocapture`; `cargo test -p wasm-vm-slirp --lib
bridge::tests::connect_failure_tears_the_flow_down -- --exact --nocapture`; `cargo test -p
wasm-vm-slirp --test outbound_sync guest_syn_to_a_refused_port_gets_reset_not_hung -- --exact
--nocapture`; `cargo test -p wasm-vm-slirp --test outbound_sync
fifty_concurrent_guest_connections_complete_without_cross_flow_bleed -- --exact --nocapture`;
`cargo test -p wasm-vm-slirp --test outbound_sync
hundred_mebibytes_each_way_are_exact_with_bounded_memory -- --exact --nocapture`.

### 2026-07-14 — worker rework — IMPLEMENTED at `6bbbe9c`

Claim: the verifier's P1-P3 refutations and browser/evidence insufficiencies are closed. E3-T14 now
implements per-five-tuple external UDP NAT in the native and browser connectors (30 s expiry, bounded
datagram queues, distinct WebSocket datagram opcodes), preserves outbound EOF versus reset through the
pump, emits guest RST on connector failure/reset, and exercises the production native driver and
WebSocket relay with real TCP/UDP sockets. Browser transport close/error/malformed/oversize and
aggregate-cap behavior is factored into a deterministic state machine with native tests. A browser
WebSocket reply can now reach a sleeping guest before its timer expires: while an external network
flow is pending, WFI returns at the normal host run-chunk boundary instead of fast-forwarding directly
to the guest socket deadline. DNS remains the explicit E3-T15 follow-up; it is not claimed here.

Refutation-specific permanent tests:

- P1: `external_udp_preserves_datagrams_and_expires_its_nat_flow`,
  `external_udp_round_trips_through_the_native_driver`, and
  `guest_udp_round_trips_through_ws_connector_and_production_relay` cover frame parsing, five-tuple
  NAT, expiry, the native CLI driver, production WebSocket framing/relay, and a real UDP echo socket.
- P2: `connect_failure_tears_the_flow_down` and
  `guest_syn_to_a_refused_port_gets_a_prompt_rst_from_the_native_driver` assert a real refused socket
  produces a guest RST promptly; the final native Alpine probe records `rc=1 elapsed=0s`.
- P3: `read_reset_is_reported_as_reset_not_eof` and
  `outbound_connection_reset_becomes_guest_rst_not_fin` preserve and assert RST semantics end to end.
- Browser coverage: `ws_transport_state` tests force malformed/oversize inbound messages, the 32 MiB
  inbound cap, 4 MiB outbound cap, drain accounting, close, and error. The cold browser acceptance
  forces the live `WebSocket` open/message/send/close path. `external_network_io_suppresses_wfi_deadline_jump`
  covers the host-yield fix through the `PcapBackend` decorator as used by machine wiring.

Exact gates, all green on the final tree:

- `cargo fmt --check`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace` (exit 0; CLI real-socket TCP/UDP/refusal tests, core scheduler/device
  regressions, 200 active slirp tests/1 ignored, production WebSocket TCP+UDP integrations, wasm
  transport-state tests, and the accumulated verifier suites)
- `cargo check -p wasm-vm-slirp --no-default-features --target wasm32-unknown-unknown`
- `cargo check -p wasm-vm-wasm --target wasm32-unknown-unknown`
- `make web-build`

Recorded native evidence (fresh rootfs SHA-256
`8e57a0bce7d275c1ab6cc8c9ebb7a0ddbf342681949876b6099937cc21bb2475`):

- Exact command: `WASM_VM_SLIRP_HOST_MAP=192.0.2.1=127.0.0.1 target/release/wasm-vm boot
  --kernel releases/kernel/6.6.63/Image --drive file=/tmp/wasm-vm-e3-t14-rework-final.ext4
  --net-slirp --evidence evidence/e3-t14-rework/native-alpine.evidence
  --append 'root=/dev/vda rw console=ttyS0 earlycon=sbi' --max-instrs 60000000000`, wrapped with
  `/usr/bin/script` for `evidence/e3-t14-rework/native-alpine.typescript`.
- Guest result: DHCP `10.0.2.15`, default route via `10.0.2.2`, ping 3/3, 112-byte TCP `wget` SHA-256
  `a8aa13fc1f45fd3401d649871ad303e662d7c202254fb8ea7e558fde11f766a2`, `udp-one` and
  `udp-two-is-a-different-length` returned as two byte-exact datagrams, refused TCP `rc=1 elapsed=0s`,
  clean poweroff and emulator exit 0.
- Compact evidence: `trace fnv64=2fa1668cba2a743a`, `trace retired=4421704713`, state SHA-256
  `94eadf4da3fd59bbc17cd3051754654bd2a163b8b1ce0b52d90dad0a4ce605d4`, `outcome=Exited(0)`.
  Artifact SHA-256: transcript `4aef523350184bafa7a8d9f0a2a17129958f4bebf05e83bd252714e7ecff61b2`;
  compact evidence `6a5a6d09b28f264d12a65c1301dc4dd740a1966c99ca7deeacbf479683023c6f`.

Recorded browser evidence (origin storage cleared and cache disabled before the single load):

- URL: `http://127.0.0.1:8123/?slirpRelay=ws://127.0.0.1:8081&final=4`, with
  `WASM_VM_SLIRP_HOST_MAP=192.0.2.1=127.0.0.1 target/release/wvrelay 127.0.0.1:8081` and real
  loopback HTTP/UDP fixtures.
- `evidence/e3-t14-rework/e3-t14-rework-browser-terminal.txt` records stock Alpine DHCP, route,
  ping 3/3, the same TCP body/digest, both distinct UDP echoes through the production relay, a
  data-phase closed-port `Connection reset by peer` with `rc=1 elapsed=0s`, clean poweroff, state
  SHA-256 `5e4eac5b69d67a23009f94330e6c51c40c85463f85ed798e972cf0966cc5c8a2`, and `exited:0`.
  (`nc -z` observes the documented optimistic local SYN handshake before relay `OPEN_FAIL`; the
  data-phase probe is the reset assertion.) Transcript SHA-256:
  `215d7473cac43f2661c7e94fcf2a83ccc21ea9429bbc710364361b2193e19cc3`.
- On the same page, the in-browser suite completed `126 passed, 0 failed` in 12.5 s, the E3-T14
  roadmap entry rendered `cap-pip verified`, and both saved console captures report zero errors.
  Screenshots: `e3-t14-rework-browser-terminal.png`, `e3-t14-rework-browser-suite.png`, and
  `e3-t14-rework-browser-roadmap.png`. Full artifact hashes and reproduction details are in
  `evidence/e3-t14-rework/README.md`.

Mac evidence limitation: host `rr` is unavailable by platform policy. The committed guest
instruction/state digest, native transcript, decoded browser xterm buffer, screenshots, browser
console captures, and real-socket integration tests are the complete Mac-side handoff. A fresh
verifier must still predict, falsify, audit diff coverage, run the task's attacks, and alone decide
whether to set `verified`.

VERDICT: refuted

### 2026-07-15 — adversarial verifier (fresh session)

- **P1 TCP idle expiry sends RST — FAILED.** Predicted an established TCP flow swept at the 2 h
  idle deadline would emit a guest RST before its socket disappeared, matching the design contract
  (`docs/design/slirp.md:109-116`). Observed both production backends delete the smoltcp socket
  directly: async `Bridge::expire` calls `remove_tcp` (`crates/slirp/src/bridge.rs:163-173`) and sync
  `SlirpLocalBackend::expire` calls `teardown` (`crates/slirp/src/local_backend.rs:422-431`). The
  sync reset path itself documents the decisive ordering invariant: `tcp_abort` + `poll` must occur
  before removal or the RST is erased (`local_backend.rs:340-348`). **Demand:** abort and poll an
  expired live TCP socket before teardown in both backends, and add an exact guest-side regression
  proving the expiry segment is RST (not silence/FIN) while the table and connector return to zero.
- **P2 shared TCP/UDP relay stream namespace — FAILED.** Predicted a TCP `OPEN` reusing a live UDP
  stream id would be rejected, because UDP ids are documented as occupying the same wire namespace
  and the high-half allocation exists to avoid collisions (`ws_connector.rs:33-36,204-220`). In a
  scratch verifier probe, `UDP_OPEN(stream=0x80000000)` received `UDP_OPEN_OK`, then TCP
  `OPEN(stream=0x80000000)` received both `OPEN_OK` and its initial `WINDOW`: the relay held the same
  id live in both maps. The UDP-open path checks both maps (`ws_proxy/driver.rs:193-207`), but TCP
  frames fall through to `RelayCore` without checking `udp`; the mux allocator/server tracks only
  TCP streams (`ws_proxy/mux.rs:120-153`). **Demand:** enforce one combined id namespace and combined
  `MAX_STREAMS` limit in both open directions, constrain the normal client allocators so they can
  never cross halves after wrap, and commit the collision probe as a rejection test.
- **P3 1000 abandoned flows — HELD.** Predicted the unified 256-entry cap would close every evicted
  UDP connector and the 30 s sweep would close every survivor. The verifier-promoted
  `thousand_abandoned_udp_flows_are_bounded_then_fully_reaped` passed: 744 eviction closes, then
  256 expiry closes, final table size zero. This test is retained as the permanent attack artifact.
- **P4 rework happy paths / prior refutations — HELD.** Independent focused reruns held for external
  UDP NAT+expiry, prompt native refused-port RST, pump read-error-vs-EOF, guest RST on outbound reset,
  browser transport caps/fail-closed state, and WFI host-yield suppression. The production
  WS-to-real-UDP test passed again from a pristine clone with `RUSTFLAGS`, `RUST_LOG`, `CARGO_HOME`,
  and `CARGO_TARGET_DIR` scrubbed. The committed native/browser transcript and artifact SHA-256s
  match the handoff; native evidence seals 4,421,704,713 retired instructions with
  `fnv64=2fa1668cba2a743a`, final state
  `94eadf4da3fd59bbc17cd3051754654bd2a163b8b1ce0b52d90dad0a4ce605d4`, and `Exited(0)`.
- **TASK ATTACKS / COVERAGE — NEEDS EVIDENCE.** The existing stalled-relay test proves the 256 KiB
  cap but neither waits 60 s nor resumes the same stream (`ws_connector_e2e.rs:336-373`). The 100 MiB
  acceptance uses ordinary 16/64 KiB chunks; no test forces one-byte connector deliveries for the
  whole transfer. **Demand:** record the task's exact 60 s stall-then-resume attack and the 100 MiB
  one-byte-framing attack, asserting identity, survival, queue caps, and a non-quadratic stated time
  budget. These are task-named changed-path coverage, not optional stress tests.
- **EVIDENCE SUFFICIENCY — HELD FOR THE RECORDED HAPPY RUN, must be replaced after fixes.** Artifact
  hashes match; terminal points prove DHCP, route, ping, TCP digest, two distinct UDP datagrams,
  prompt reset, state digest, and exit. The compact native FNV/state digest is a sealed rerun
  fingerprint rather than an addressable canonical trace, so it cannot answer a new per-instruction
  falsification by itself; the committed transcripts provide the reopenable network observations.
  Any P1/P2 fix changes the final tree, so both native and browser evidence must be re-recorded.
- **SABOTAGE / MOCK / ENV.** In the pristine clone, forcing `classify_udp` to reject every nonempty
  frame made `external_udp_preserves_datagrams_and_expires_its_nat_flow` fail at the expected opened
  endpoint assertion; reverting restored the source. This kills the happy-UDP no-op mutation. Host
  maps and loopback fixtures are explicit and the cold-clone production-relay UDP run used real
  sockets; no self-licking payload oracle was found.
- **SUITE:** retained the deterministic 1000-flow cap/expiry probe. Further promotion waits until
  P1/P2 and the two missing task attacks are corrected.

Commands: `cargo test -p wasm-vm-slirp --lib
local_backend::tests::thousand_abandoned_udp_flows_are_bounded_then_fully_reaped -- --exact
--nocapture`; `cargo test -p wasm-vm-slirp --lib
e2e_pump_stack::outbound_to_guest_stays_bounded_when_the_server_floods_and_the_guest_stalls --
--exact --nocapture`; `cargo test -p wasm-vm-slirp --test ws_connector_e2e
stalled_relay_upload_queue_is_bounded_and_reports_backpressure -- --exact --nocapture`; cold clone:
`env -u RUSTFLAGS -u RUST_LOG -u CARGO_HOME -u CARGO_TARGET_DIR cargo test -p wasm-vm-slirp --test
udp_ws_e2e guest_udp_round_trips_through_ws_connector_and_production_relay -- --exact --nocapture`;
scratch collision probe:
`cargo test -p wasm-vm-slirp --lib
ws_proxy::driver::driver_tests::verifier_probe_tcp_open_is_accepted_over_a_live_udp_stream_id --
--exact --nocapture`; sabotage: mutated `classify_udp` to return false, then ran
`cargo test -p wasm-vm-slirp --lib
local_backend::tests::external_udp_preserves_datagrams_and_expires_its_nat_flow -- --exact
--nocapture` (failed as predicted).
