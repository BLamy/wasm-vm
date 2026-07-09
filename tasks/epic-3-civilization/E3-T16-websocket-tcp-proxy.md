---
id: E3-T16
epic: 3
title: WebSocket TCP proxy - framing protocol and Rust relay server
priority: 316
status: pending
depends_on: [E3-T14]
estimate: M
capstone: false
---

## Goal
The general-purpose transport: an `OutboundConnector` that tunnels guest TCP flows through a
single multiplexed WebSocket to a small Rust relay server, which opens real TCP connections
outbound. Any TCP protocol the guest speaks (HTTP, TLS, SSH, git) works through it, with a
designed-and-documented binary framing protocol.

## Context
Browsers cannot open raw sockets; a relay is how webvm-class systems reach arbitrary
TCP. Design the framing protocol first (`docs/design/ws-proxy-protocol.md`): one WebSocket
carries all flows; binary frames `{u32 stream_id, u8 opcode, payload}` with opcodes OPEN
(payload: hostname length-prefixed + u16 port — hostname not IP, so the relay does DNS and
T15 can also route through it), OPEN_OK/OPEN_FAIL(errno-ish code), DATA, SHUTDOWN_WR (maps
half-close), CLOSE, RST, and WINDOW (credit-based flow control: receiver grants byte
credits per stream; sender never exceeds outstanding credit — do not rely on WS
`bufferedAmount` alone, it is global not per-stream). Version byte in a hello frame.
Server: tokio + tokio-tungstenite (or axum ws), per-stream tasks, per-connection and
per-stream buffer caps. Client side implements `OutboundConnector` mapping credits to the
slirp socket window (T14's backpressure seam). Auth/rate limiting/deploy hardening is T19 —
but leave the hello frame's token field in the protocol now.

## Deliverables
- `docs/design/ws-proxy-protocol.md`: wire format, flow-control rules, close/RST state
  machine, version negotiation, token field.
- `proxy/` Rust server crate (tokio): WS endpoint, outbound TCP, credit enforcement,
  structured logs, `--listen`/`--allow-dest` flags, graceful shutdown.
- Client `WsConnector` (wasm: `web-sys` WebSocket; native: tungstenite for harness tests)
  implementing the protocol incl. credits and half-close.
- Protocol conformance tests: a shared test vector suite run against both client and server
  encoders/decoders; end-to-end native test guest→slirp→WsConnector→server→local echo.

## Acceptance criteria
- [ ] Booted guest (native harness and browser) completes `wget http://example-served-
      locally/100mb.bin` through the full chain; sha256 matches; single WebSocket carried
      all traffic (server logs show stream multiplexing for ≥3 concurrent flows).
- [ ] Credit flow control provably works: a guest downloading into a stalled reader (guest
      `sleep`ing mid-`wget` via a rate-limited pipe) causes the server's outstanding-credit
      counter for that stream to hit zero and its TCP read to pause (server metric), while
      a second concurrent stream continues at full speed.
- [ ] Half-close: guest `nc -q` style send-then-shutdown flows deliver the server's late
      response fully.
- [ ] RST from the destination surfaces to the guest as ECONNRESET within 1 s.
- [ ] Encoder/decoder conformance vectors pass identically in the wasm client, native
      client, and server.

## Adversarial verification
Attack the protocol and the flow control. Fuzz the server with malformed frames (unknown
opcodes, stream_id 0, DATA before OPEN, negative-ish lengths) — panic or resource leak
refutes. Violate credits deliberately from a hacked client: server must kill the stream or
connection, not buffer unboundedly (send 100 MB with zero granted credit). Open 500 streams
and drop the WebSocket abruptly: server must reap all TCP sockets within seconds (`lsof`
check). Stall one stream's reader for 5 minutes while 10 others transfer — head-of-line
blocking that stalls the others refutes the multiplexing claim. Byte-diff a 1 GB transfer.
Kill the server mid-transfer: guest must get a connection error, and (with T25 later)
reconnect must be possible — for now, no wasm panic.

## Verification log

### Pass 1a — shared framing codec + spec (PR #144, stacked on #143)
**Delivered:** `docs/design/ws-proxy-protocol.md` (the wire spec — version 1) and
`crates/slirp/src/ws_proxy.rs` — the `Frame` enum with `encode()->Option<Vec<u8>>` and
`decode(&[u8])->Option<Frame>`, shared by the (later) `WsConnector` and relay `proxy/` so
they agree by construction. Pure, no tokio, browser-safe. Frame =
`[stream_id:u32 BE][opcode:u8][payload]`, one frame per WS binary message; opcodes
0=HELLO(ver+token, stream 0)/1=OPEN(host_len+host+port)/2=OPEN_OK/3=OPEN_FAIL(code)/4=DATA/
5=SHUTDOWN_WR/6=CLOSE/7=RST/8=WINDOW(credit:u32). Per-stream credit flow control (not the
WS global `bufferedAmount`).

**Local gate:** `cargo clippy --all-features --tests` clean; `--no-default-features --tests`
clean; full slirp suite 130 passed / 0 failed / 1 ignored; the 5 ws_proxy tests pass.

**Tests (charter-aligned):**
- `every_frame_round_trips` — `decode(encode(F))==Some(F)` for all 11 frame shapes.
- `conformance_vectors_are_byte_exact` — pins HELLO/OPEN/WINDOW/RST byte layouts (the
  client/server contract can't silently drift).
- `a_255_byte_host_is_the_max_a_longer_one_is_rejected` — the u8 host-length boundary.
- `hello_must_be_on_stream_zero_and_others_must_not` — stream-0 reservation, both directions.
- `malformed_frames_never_panic_and_decode_to_none` — targeted bad payloads **plus** every
  truncation + every single-byte corruption of a valid-frame set + 50,000 structured-random
  buffers, all asserting no panic.

**CI:** #144 fmt / clippy / determinism / all feature-matrix legs (std, trace, wasm,
no-default) / perf-smoke — all pass.

**Adversarial cold-clone critic** (fresh clone, reviewed `origin/task/e3-t15n..HEAD`;
brute-forced every opcode 0–9 × stream {0,1} × payload 0–6 bytes, single-byte corruption,
truncation, 50k+ random buffers; mutation-tested the suite): **verdict CLEAN on all
hard-refutation criteria** — no panic, no OOB, no integer overflow (`host_len as usize + 2`
≤ 257), no silent wrong-frame mis-decode, no resource leak; stream-0 gating airtight
(checked before the opcode match); all 4 injected mutations (`host_len..+1`, port
`to_be`→`to_le`, unknown-opcode→DATA, credit `to_be`→`to_le`) were **caught** by the suite.

Found **1 real MAJOR** defect — **FIX-FIRST applied:**
- `OP_OPEN` was the sole opcode that didn't enforce exact payload length: it read host+port
  and silently dropped trailing bytes, so two distinct wire messages decoded to one `Frame`
  and `decode`'s output re-encoded to *different* bytes (non-canonical), violating the doc's
  "a malformed payload is a protocol error → None" and the suite's own `RST takes no
  payload` invariant. Repro: `decode([0,0,0,1, 1,5,'a','.','c','o','m', 0x00,0x50, 0xde,0xad,
  0xbe])` → `Some(Open{host:"a.com",port:80})` (16 in, re-encodes to 13). **Fixed**
  (`ws_proxy.rs`): after reading the port, require `rest.len() == host_len + 2` else `None`,
  matching every sibling opcode. **Regression test added** (`malformed_frames_never_panic…`:
  OPEN + 2 trailing bytes → `None`) — fails on the pre-fix decoder, passes now.
- MINOR doc drift (host_len "≤253" vs code's u8 max 255) — clarified in the spec (benign;
  u8 max 255 comfortably covers a 253-byte DNS name).

Post-fix gate re-run: clippy both configs clean, full slirp suite 130 passed / 0 failed, the
5 ws_proxy tests pass. **CI #144 green** (29 pass / 1 skip).

### Pass 1b — per-stream flow-control + close lifecycle state machine (PR #145, stacked on #144)
**Delivered:** `crates/slirp/src/ws_proxy/stream.rs` — `StreamState`, the pure, I/O-free state
each side keeps for one multiplexed flow (both the client and relay drive an identical copy, so
credit accounting + close rules can't diverge). Credit: `on_window` grows send credit
(`checked_add`→`CreditOverflow`); `reserve_send(len)` refuses *without spending* if
`len > send_credit` / write closed / terminal; `grant`/`on_recv_data` mirror it — a peer that
sends past granted credit gets `RecvCreditExceeded`. Lifecycle: directional half-close
(`local_shutdown`/`peer_shutdown`, idempotent while live); `close`→`Closed`, `reset`→`Reset`;
every op after retirement returns `Terminated` (retired id must not be reused). All illegal
transitions return `StreamError`, never panic.

**Local gate:** clippy `--all-features` + `--no-default-features` clean; full slirp suite
140 passed / 0 failed; 15 ws_proxy tests pass (10 new). **CI #145 green** (28 pass / 1 skip).

**Tests (acceptance-aligned):** nothing-sent-before-grant, drain-to-zero-then-pause,
atomic over-credit refusal, the adversarial *hacked peer blasts 100 MB with 8 bytes granted →
`RecvCreditExceeded`*, directional half-close, idempotent shutdown, close/RST retire + reuse
rejection, zero-length keepalive, u32 overflow rejection, `default==new`.

**Adversarial cold-clone critic** (reviewed `origin/task/e3-t16a..HEAD`): **verdict CLEAN.**
- Credit soundness **property-tested at 2M iterations** each direction with a u128 shadow
  accumulator: `cumulative_sent ≤ cumulative_granted` and `cumulative_recvd ≤ cumulative_granted`
  held for all ops; a refused op leaves the counter byte-for-byte unchanged (no partial spend,
  no wrap); exactly-at-limit accepted (no off-by-one). Subtraction guards (`len > credit` before
  `credit -= len`) provably prevent u32 underflow; all additions are `checked_add`.
- Lifecycle: every one of the 8 mutators calls `check_live()` first → `Terminated` post-retire;
  `write_open`/`read_open` AND-in `terminal.is_none()` (no stale-bool lies); retired-id reuse
  rejected. Matches the spec's close/RST retirement rule.
- **Mutation testing: 15 injected mutants, ALL killed** (incl. all 3 charter-suggested
  `>`→`>=` / drop-spend / drop-`check_live`, plus `checked_add`→`wrapping_add`, guard removals,
  query terminal-check removal, shutdown no-ops, `reset`-writes-`Closed`). Zero surviving mutants.
- Two design notes flagged for the record (not defects): a received `CLOSE` always retires
  regardless of half-close state (correct — the "after both sides finished" clause is send-side
  policy); a late `RST` on an already-`Closed` stream is dropped as `Terminated` (deliberate
  "retired = retired", symmetric on both ends). No FIX-FIRST needed.

**Env-gated later passes:** tokio relay server, `web_sys` `WsConnector`, credit-enforcement
+ 500-stream-reap + 1 GB byte-diff acceptance — need a live browser/boot session.
