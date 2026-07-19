---
id: E3-T16
epic: 3
title: WebSocket TCP/UDP transport provider and public relay fallback
priority: 316
status: verified
depends_on: [E3-T14]
estimate: M
capstone: false
---

## Goal
The fallback general-purpose transport: an `OutboundConnector` that tunnels guest TCP/UDP
flows through a single multiplexed WebSocket to a small Rust relay server. It remains the
portable no-tailnet path and defines the framing, flow-control, close/reset, and datagram
semantics reused by transport providers. T17 makes a browser Tailscale node the shipped
primary provider; this task still has to stand on its own and pass every relay acceptance.

## Context
Browsers cannot open raw sockets; a relay is the universal fallback when Tailscale is not
configured or cannot connect. Design the framing protocol first
(`docs/design/ws-proxy-protocol.md`): one WebSocket
carries all flows; binary frames `{u32 stream_id, u8 opcode, payload}` with opcodes OPEN
(payload: hostname length-prefixed + u16 port — hostname not IP, so the relay does DNS and
T15 can also route through it), OPEN_OK/OPEN_FAIL(errno-ish code), DATA, SHUTDOWN_WR (maps
half-close), CLOSE, RST, and WINDOW (credit-based flow control: receiver grants byte
credits per stream; sender never exceeds outstanding credit — do not rely on WS
`bufferedAmount` alone, it is global not per-stream). Version byte in a hello frame.
Server: tokio + tokio-tungstenite (or axum ws), per-stream tasks, per-connection and
per-stream buffer caps. Client side implements `OutboundConnector` mapping credits to the
slirp socket window (T14's backpressure seam). Auth/rate limiting/deploy hardening is T19 —
but leave the hello frame's token field in the protocol now. Provider selection belongs
outside `WsConnector`: T17 plugs a Worker-backed Tailscale provider into the same slirp seam,
while T19 owns production policy and lifecycle for both paths.

## Deliverables
- `docs/design/ws-proxy-protocol.md`: wire format, flow-control rules, close/RST state
  machine, version negotiation, token field.
- `proxy/` Rust server crate (tokio): WS endpoint, outbound TCP, credit enforcement,
  structured logs, `--listen`/`--allow-dest` flags, graceful shutdown.
- Client `WsConnector` (wasm: `web-sys` WebSocket; native: tungstenite for harness tests)
  implementing the protocol incl. credits and half-close.
- TCP and UDP relay paths share one bounded connection while preserving TCP byte-stream
  semantics and UDP datagram boundaries, with typed refusal/reset/unreachable outcomes.
- Protocol conformance tests: a shared test vector suite run against both client and server
  encoders/decoders; end-to-end native test guest→slirp→WsConnector→server→local echo.

## Acceptance criteria
- [x] Booted guest (native harness and browser) completes `wget http://example-served-
      locally/100mb.bin` through the full chain; sha256 matches; single WebSocket carried
      all traffic (server logs show stream multiplexing for ≥3 concurrent flows).
- [x] Credit flow control provably works: a guest downloading into a stalled reader (guest
      `sleep`ing mid-`wget` via a rate-limited pipe) causes the server's outstanding-credit
      counter for that stream to hit zero and its TCP read to pause (server metric), while
      a second concurrent stream continues at full speed.
- [x] Half-close: guest `nc -q` style send-then-shutdown flows deliver the server's late
      response fully.
- [x] RST from the destination surfaces to the guest as ECONNRESET within 1 s.
- [x] Encoder/decoder conformance vectors pass identically in the wasm client, native
      client, and server.
- [x] Two concurrent UDP flows preserve zero-length, maximum-supported, and back-to-back
      differently-sized datagrams without cross-flow contamination or TCP head-of-line stalls.

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

### Pass 1c — connection multiplexer (PR #146, stacked on #145)
**Delivered:** `crates/slirp/src/ws_proxy/mux.rs` — `Mux`, the pure I/O-free duplex logic each end
runs over one WebSocket, composing the frame codec (1a) + state machine (1b). Stream table
(`BTreeMap`, deterministic) + client-side id allocation; role-aware (`open`→id+OPEN pending until
OK/FAIL; server `on_frame(OPEN)`→`OpenRequested`, `open_succeeded`/`open_failed`);
`on_frame` routes DATA/WINDOW/SHUTDOWN_WR/CLOSE/RST to the addressed stream, CLOSE/RST reap;
`reap_all` empties the table on WS drop. Catches the connection-level violations the lower layers
can't: `UnknownStream` (DATA-before-OPEN / reaped), `StreamExists` (id reuse), `RoleViolation`,
`TooManyStreams` (cap 1024), `DataTooLarge` — every one a returned `MuxError`, never a panic or
unbounded alloc.

**Local gate:** clippy both configs + fmt clean; full slirp suite **156 passed** / 0 failed;
16 mux tests. **CI #146 green** (fails=0). Serves acceptance: DATA-before-OPEN rejected,
500-stream reap, hacked-client credit violation → `Stream(id, RecvCreditExceeded)`, half-close
keeps the stream live for the late reply.

**Adversarial cold-clone critic** (reviewed `origin/task/e3-t16b..HEAD`): **verdict REFUTED on
test coverage — production logic CLEAN.** The critic could not produce a leak, panic, overwrite,
mis-route, cap bypass, or credit bypass under direct adversarial exercise (500-stream reap, every
per-stream opcode for an unknown id → `UnknownStream` with no side effect, roles enforced both
directions, `alloc_id` terminating + 0-skipping + wrap-correct, `pending ⊆ streams` bounded).
But **2 of the 4 charter mutants SURVIVED the shipped suite** — real coverage gaps in a PR whose
job is adversarial coverage:
- **MAJOR** — `reap()` clearing `pending` was untested: a `CLOSE`/`RST` for a *still-pending*
  client stream is a reachable path, and under the mutant a later `OPEN_OK` spuriously returns
  `Opened` for a dead stream (phantom-open + pending leak).
- **MAJOR** — `alloc_id`'s `!contains_key` collision guard was untested, and the test named
  `…reuses_freed_ones` never asserted reuse (name overstated coverage; the guard is load-bearing
  only after a u32 wrap).

**FIX-FIRST applied (test-only; production code was already correct):** added
`closing_a_still_pending_client_stream_clears_it_from_pending` (CLOSE *and* RST paths) and
`alloc_id_skips_an_occupied_slot_and_never_clobbers_a_live_stream` (via a `#[cfg(test)]`
`force_next_id` seeding the allocator onto an occupied slot, since the collision path otherwise
only triggers on wrap); renamed the misleading test to `client_allocates_distinct_nonzero_ids`.
**Both new tests were verified to KILL their mutant** — each FAILS under the injected mutation and
PASSES on restored code — so the two invariants are now genuinely pinned. Suite 154→156.
**CI #146 green** (fails=0, incl. the fold repush).

### Pass 1d — connection handshake + session ordering gate (PR #147, stacked on #146)
**Delivered:** `crates/slirp/src/ws_proxy/session.rs` — the connection-level gate that nothing
previously enforced. `hello(token)` builds the opening `HELLO`; `accept_hello(frame)` returns the
peer token or `VersionMismatch{peer,ours}`/`NotHello`. `Session { AwaitingHello | Ready(Mux) }`:
`on_hello` validates + transitions to Ready (creating the role's `Mux`), refusing a version
mismatch **before any Mux exists**; `on_frame` routes to the mux once ready, else `NotReady`; a
replayed `HELLO` after Ready is `AlreadyReady` (and must not reset the live mux). Pure. Serves the
spec's §Versioning acceptance ("a mismatch the peer can't speak is refused before any stream
opens"). Token plumbed now for E3-T19; wire stays stable.

**Local gate:** clippy both configs + fmt clean; full slirp suite **164 passed** / 0 failed;
8 session tests. **CI #147 green** (fails=0).

**Adversarial cold-clone critic** (reviewed `origin/task/e3-t16c..HEAD`): **verdict CLEAN.**
Every charter vector reproduced and defended: no ordering bypass (`on_frame` in `AwaitingHello`
→ `NotReady`; `is_ready`/`mux`/`on_frame` all agree on the same `State::Ready` match); the version
gate mutates no state until `accept_hello` succeeds (`?` precedes `self.state =`), so a mismatch
(tried v0/v255/v+7) leaves the session `AwaitingHello` with no mux; the second-HELLO reset attack
is blocked by the `AlreadyReady` early-return (the live mux is never replaced); role plumbed
Client/Server; all 8 non-HELLO variants → `NotHello`; token cloned, no aliasing. **All 3 injected
mutants** (transition-before-check, AwaitingHello-routes-to-fresh-mux, Ready-replaces-mux) were
**caught** by the suite.
- **MINOR test-coverage note (fixed):** the critic observed `a_second_hello_after_ready_is_rejected`
  asserted the `AlreadyReady` error but not that the live mux *survives*. Strengthened to
  `a_second_hello_after_ready_does_not_reset_a_live_mux` — opens a live stream, replays HELLO,
  asserts `live_count()` unchanged; **verified to KILL** the reset-mutant (removing the
  `AlreadyReady` guard now FAILS the test). Production code was already correct.

### Pass 1e — relay-server decision core, sans-io (PR #148, stacked on #147)
**Delivered:** `crates/slirp/src/ws_proxy/relay.rs` — `RelayCore`, the relay server's *policy* as a
pure step function over Session/Mux. **No I/O, no WS dependency** (builds under
`--no-default-features` — wasm-safe); each `on_*` event returns `RelayActions { ws_sends, socket_ops }`
and the async driver (next pass) executes them. Correction to the earlier plan: the relay's testable
substance is dep-free — only the final WS-wire adapter needs `tokio-tungstenite`, so this pass forces
**no** dependency decision. Policy: handshake-gate; OPEN→Connect, connect-ok→OPEN_OK+initial WINDOW
(256 KiB), connect-fail→OPEN_FAIL; guest DATA→Write+re-grant window; backend DATA→DATA under the
guest's credit (driver sizes reads by `send_credit()` — the backpressure seam, no HOL blocking);
half-close both ways; error→RST; close/rst→socket drop; WS-drop→reap every socket.

**Local gate:** clippy both configs + fmt clean; full slirp suite **180 passed** / 0 failed;
16 relay tests. **CI #148 green** (fails=0).

**Adversarial cold-clone critic** (reviewed `origin/task/e3-t16d..HEAD`): **REFUTED — 1 MAJOR +
minors, all FIX-FIRST.** Credit invariant holds under normal flow (guest DATA of N consumes N +
re-grants N → window pinned at INITIAL_WINDOW; concurrent streams independent; reap-all closes
every socket; clean errors, no panics).
- **MAJOR:** duplicate `on_connect_result(true)` was re-entrant (`open_succeeded` only checked
  existence, `grant` accumulates) → a second success **doubled the guest's window** (2×256 KiB)
  and re-emitted OPEN_OK. **Fixed:** a `connecting` set records each outstanding Connect;
  `on_connect_result` requires-and-removes it → a duplicate/unopened-stream result →
  `UnknownStream`. New test **verified to KILL** the guard-removal mutant, and proves the window
  stays exactly INITIAL_WINDOW (INITIAL_WINDOW+1 guest bytes → violation).
- **MINOR (fixed):** the guest-DATA refill grant was silently swallowed (`if let Ok(win)`) → now
  `.map_err(?)`; the server never emitted its own HELLO → documented the driver-sends-`hello()`
  contract + test; `on_hello` error mapping made consistent via `map_session_err`.

### Pass 1f — native async relay driver (PR #149, stacked on #148)
**Delivered:** `crates/slirp/src/ws_proxy/driver.rs` — `RelayServer`, the tokio driver that executes
`RelayCore`'s decisions against **real sockets** (behind the `native` feature; wasm build gates it
out). Carries WS messages over two `mpsc` channels → **no WS dependency**; the tests drive them
against a **real TCP echo server**, proving the whole chain guest→relay→real TCP→back. Actor model:
one main task owns `RelayCore` exclusively; per-stream reader + writer tasks.

**THE RELAY NOW WORKS END TO END against real TCP.**

**Local gate:** clippy both configs + fmt clean; full slirp suite **188 passed**; 8 driver
integration tests 3× no flake. **CI #149 green.**

**Adversarial cold-clone critic** (aimed at the concurrency — the highest-risk kind): **REFUTED —
2 reproducible CRITICALs, both FIX-FIRST + regression tests mutation-VERIFIED to bite.**
- **CRITICAL 1 — credit over-read → silent stream drop.** `refresh_credit` published gross credit
  via a `watch`, which COALESCES; a guest pipelining WINDOWs made the reader out-read the grant →
  `on_socket_data` reserve failed → stream silently killed (no RST, data lost). **Fixed:** replaced
  the watch with a per-stream **Semaphore** (permits accumulate, no coalescing); the reader acquires
  permits *before* reading, so it can't out-read the grant. Regression
  `pipelined_windows_under_a_flood_deliver_every_byte` — **mutation-verified** (reader-ignores-credit
  → FAILS).
- **CRITICAL 2 — head-of-line deadlock.** The main loop `.await`ed a bounded `writer_tx.send()`, so
  one stalled backend froze the whole WS connection. **Fixed:** (a) unbounded write hand-off (main
  loop never blocks); (b) window refill tied to backend **drain** not receipt (new
  `RelayCore::on_backend_written`), bounding a stalled stream's queue to the 256 KiB window.
  Regression `a_stalled_backend_does_not_freeze_other_streams` — **mutation-verified** (bounded
  blocking writer → the test HANGS = the deadlock).
- Also: on a now-unreachable `on_socket_data` error, emit RST to the guest instead of silent drop.

- Also: on a now-unreachable `on_socket_data` error, emit RST to the guest instead of silent drop.

### Pass 1g — WebSocket-wire adapter (PR #150, stacked on #149)
**Delivered:** `crates/slirp/src/ws_proxy/ws_adapter.rs` — the thin layer bridging a **real**
WebSocket to the `RelayServer`. `serve(listener, token)` accepts WS connections (one relay each);
`handle_conn` upgrades via `accept_async`, splits, and pumps WS binary msgs ↔ the relay's channels.
**DEP TAKEN** (Brett's call, proceeded on the repeated keep-stacking directive; one-line revert):
`tokio-tungstenite` 0.24 + `futures-util`, both behind `native`, `default-features=false`, **no TLS**
(relay terminates plaintext ws://). Browser/wasm build pulls none of it. **This closes the server
side: guest → real WebSocket → relay → real outbound TCP → back.**

**Local gate:** clippy both configs + fmt clean; full slirp suite **192 passed**; 4 ws_adapter tests
(real `tokio-tungstenite` client) 3× no flake; `cargo build --features native --lib` compiles. **CI
#150 green.**

**Adversarial cold-clone critic** (aimed at WS hazards): **REFUTED — 2 MAJOR + a latent build issue,
all FIX-FIRST.** Bridge logic held (keepalive works — the auto-pong rides the adapter's own read
loop, not the split sink; backpressure per-connection; no half-open leak; deps correct).
- **F1 (MAJOR):** the accept loop `while let Ok(..)` died on any transient error (EMFILE/aborted) —
  a permanent DoS on new connections. **Fixed:** loop+match, back off 10ms on Err and keep serving.
- **F2 (MAJOR, test gap):** cleanup/shutdown chain untested; 2 mutations survived. Added
  `a_client_disconnect_cleanly_finishes_the_connection_task` (kills the `drop(in_tx)`-removal mutant
  — a real triple-task deadlock) and `a_relay_protocol_error_delivers_a_clean_close_to_the_client`
  (kills the `ws_sink.close()`-removal mutant). **Both mutation-VERIFIED** to FAIL (self-time-out at
  5s) under the reintroduced bug.
- **Latent build (real, fixed):** the `native` lib couldn't `cargo build` standalone —
  `tokio::select!` needs tokio's `"macros"` feature (masked by dev-deps under `cargo test`). Added
  `"macros"`; the lib now compiles standalone.

### E3-T16 status — SERVER SIDE COMPLETE over a real WebSocket
Full server stack critic-verified: **codec (#144) → stream state (#145) → mux (#146) → session
(#147) → relay core (#148) → async driver (#149) → WS adapter (#150).** The relay carries real guest
TCP over a real WebSocket end to end. **Only browser/boot-gated legs remain:**
- **`web_sys` `WsConnector`** — the guest-side client in the browser (needs wasm-bindgen + a browser).
- **Booted acceptance** — a real Alpine guest doing `wget` through the chain; 1 GB byte-diff; 500-
  stream `lsof` reap (needs a boot session).

### 2026-07-17 — planning reconciliation
The two bullets above are historical. E3-T14 later landed and verifier-proved the production
`web_sys` connector plus booted browser Alpine TCP/UDP through `wvrelay`. E3-T16 now retains the
larger protocol-specific acceptance still not independently closed here: multiplexed large-transfer
and stall/backpressure evidence, half-close/RST, malformed/credit attacks, and 500-stream reap. T17
uses the same connector seam for Tailscale; it does not replace or weaken this fallback proof.

### 2026-07-19 — worker — implemented

Commits `58e7c5b`, `85971db`, and `bfeea1d`. Native real-WebSocket acceptance passes three logical
flows with a 100 MiB digest match; the recorded full attack scales the same test to one 1 GiB flow
stalled unread for five minutes plus ten concurrent 2 MiB siblings, all byte- and SHA-identical in
533.39 s. A separate recorded transport-drop run reaps 500 real backend sockets. The full slirp
suite passes 215 unit tests (one resolver-only ignore) and 19 integration tests, including malformed
frames, credit violations, half-close, RST, UDP boundaries, 100 MiB transfers, one-byte delivery,
and the 60-second stalled upload. Strict fmt/clippy, wasm32 build, and `make web-build` pass.

The first stock-Alpine browser run refuted the close path at 104,791,922 / 104,857,600 bytes with
`wget: connection closed prematurely`. The trace exposed a bridge race: after a staged tail drained,
guest FIN could be emitted while `WsConnector` retained one final DATA delivery. `85971db` adds a
close-time connector drain and a mutation-proven regression (old behavior: 65,536 / 131,072; fixed:
131,072 / 131,072). The rebuilt browser rerun then passed in 3,440.1 s: wget exit 0, exact
104,857,600 bytes, SHA-256 `20492a4d0d84f8beb1767f6616229f85d44c2827b64bdbfb260ee12fa1109e0e`,
and zero console errors. The demo rerun passed 126 / 0 and displayed the E3-T16 evidence. Evidence
manifest and artifact digests: `evidence/e3-t16/README.md`.

### 2026-07-19 — verifier

VERDICT: verified

- **P1 — booted browser transfer survives the close boundary.** Predicted the stock Alpine guest
  would report exit 0, exactly 104,857,600 bytes, and the fixture SHA-256 after traversing
  `BrowserWebSocketTransport -> WsConnector -> wvrelay`. Observed exactly those values with no
  console errors in `evidence/e3-t16/alpine-relay-summary.json:3-9` and the guest command/result at
  `evidence/e3-t16/alpine-relay-terminal.txt:233-236`. All seven submitted artifact SHA-256 values
  match `evidence/e3-t16/README.md`, and commits `58e7c5b -> 85971db -> bfeea1d -> 7deb8a0` are a
  direct ancestry chain from the verified E3-T10 parent.
- **P2 — stalled-stream multiplexing is independent and byte-exact.** Predicted one unread stream
  would not block sibling streams, and the large stream would remain byte- and SHA-identical after
  release. An independent scrubbed-env rerun of the real-WebSocket 100 MiB / three-flow test passed
  in 34.67 s. The recorded full attack uses the same assertions with a one GiB stream, ten siblings,
  and a five-minute minimum stall (`crates/cli/tests/ws_connector_over_real_ws.rs:226-345`) and passed
  in 533.39 s (`evidence/e3-t16/full-attack.typescript:4-8`).
- **P3 — transport drop reaps every real backend.** Predicted all 500 peer sockets would observe EOF
  and the relay channel would close within five seconds. The independently run full slirp suite hit
  `dropping_one_transport_reaps_500_real_backend_sockets` and passed; its direct-peer EOF oracle and
  deadlines are at `crates/slirp/src/ws_proxy/driver_tests.rs:397-439`. This is stronger than an
  `lsof` sampling check.
- **P4 — malformed, credit, half-close/RST, and UDP attacks remain closed.** Predicted malformed
  frames and DATA-before-OPEN would return errors without panic, over-credit would be rejected,
  late half-close responses would arrive, destination reset would become guest RST, and UDP
  datagrams would not coalesce. The independent full slirp run passed 215 / 0 (one resolver-only
  ignore) plus 19 / 0 integration tests, including those named attack paths, the 60-second bounded
  stalled-upload test, 100 MiB each-way byte checks, and production-relay UDP.
- **P5 — close-time drain regression is load-bearing.** Predicted replacing the connector drain at
  `crates/slirp/src/local_backend.rs:623-627` with `appended = 0` would truncate the staged 128 KiB
  response. In a detached scratch worktree the mutant failed
  `remote_fin_waits_for_connector_bytes_buffered_behind_a_staged_tail` at 65,536 / 131,072 bytes;
  restored source passed in a fresh target and again after clearing the mutant build artifact. The
  production browser rerun exercises the same close path at 100 MiB.
- **COVERAGE.** Production hunk `local_backend.rs:617-633` is covered by the mutation-killing
  regression and browser run. The real-WS acceptance hunk is covered by both recorded scales and an
  independent rerun; the 500-socket hunk by recorded and independent suite runs; Playwright specs
  and roadmap text by the two browser artifacts. Evidence files, task/queue metadata, imports, and
  comments are waived as non-runtime data. No changed behavior is unexecuted.
- **SUITE.** Keep the deterministic close-drain, real-WebSocket multiplexing, and 500-socket reap
  tests. They are stable acceptance oracles and the close-drain test demonstrably kills the observed
  regression. Browser and terminal artifacts remain task evidence; no new verifier fixture needed.

Commands: `cargo fmt --check`; `cargo clippy -p wasm-vm-slirp --all-targets --all-features -- -D
warnings`; scrubbed-env `cargo test -p wasm-vm-slirp`; scrubbed-env `cargo test -p wasm-vm-cli
--test ws_connector_over_real_ws one_websocket_multiplexes_a_stalled_stream_and_a_100mib_transfer
-- --exact`; isolated mutant and restored-source runs of `cargo test -p wasm-vm-slirp --test
outbound_sync remote_fin_waits_for_connector_bytes_buffered_behind_a_staged_tail -- --exact`;
artifact `shasum -a 256` and commit-ancestry checks.
