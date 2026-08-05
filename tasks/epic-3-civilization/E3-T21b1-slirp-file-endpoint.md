---
id: E3-T21b1
epic: 3
title: Bounded WVFT engine and synthetic slirp endpoint
priority: 321.21
status: verified
depends_on: [E3-T21a]
estimate: S
risk: high
capstone: false
---

## Goal
Implement the frozen WVFT framing/state engine and terminate it only on the synthetic
`10.0.2.2:10021` slirp service.

## Deliverables
- An alloc-bounded WVFT parser and service state machine shared by native and wasm builds.
- A permanent slirp-local TCP listener that never opens an outbound connector or host listener.
- Streaming source/sink hooks with byte, concurrency, credit, quota, and timeout bounds.

## Acceptance criteria
- [ ] `cargo test -p wasm-vm-slirp --lib file_transfer` streams 0 bytes and 100 MiB, rejects
  malformed/truncated/oversized frames and a third concurrent stream, and keeps owned buffering
  within the protocol bound.
- [ ] A stack test proves only `10.0.2.2:10021` reaches WVFT and no input can select a destination.
- [ ] `cargo build -p wasm-vm-slirp --target wasm32-unknown-unknown --no-default-features` passes.

## Adversarial verification
Mutate every header/type length, offset, credit, stream state, timeout, and direction; attempt to
encode a URL, host path, destination, or unknown opcode. Inspect every allocation and terminal
transition. Any outbound connector call or unbounded queue refutes.

## Verification log

### 2026-07-27 — worker — implemented

Commit `8dc2387` implements the WVFT v1 engine and terminates it on two bounded permanent
`10.0.2.2:10021` slirp sockets. The parser validates the frozen envelope and exact payload shapes
before copying payload bytes; transfer state streams through source/sink traits with incremental
SHA-256, a 1 GiB limit, four-frame credit, two-transfer concurrency, non-reusable stream IDs,
source-mutation detection, 30-second idle cancellation, and bounded owned-byte diagnostics. The
local backend routes the reserved endpoint internally and a connector probe proves that WVFT bytes
never become a destination dial. Fatal replies use an ordered TCP close so the typed error is not
discarded by an abort.

Exact-head evidence:

- `cargo fmt --all --check` — passed.
- `cargo clippy -p wasm-vm-slirp --all-targets -- -D warnings` — passed.
- `cargo test -p wasm-vm-slirp --lib file_transfer -- --nocapture` — 8 passed, including empty and
  100 MiB streaming, both directions, exact-length/header/offset/name attacks, concurrency,
  timeout, stream reuse, source mutation, and the real slirp endpoint.
- `cargo test -p wasm-vm-slirp --lib
  file_transfer_is_only_on_gateway_10021_and_never_dials_a_destination -- --nocapture` — passed.
- `cargo test -p wasm-vm-slirp --lib` — 238 passed, 0 failed, 1 pre-existing network-resolver test
  ignored.
- `cargo build -p wasm-vm-slirp --target wasm32-unknown-unknown --no-default-features` — passed.
- `git diff 8dc2387^..8dc2387 --check` — passed.

The deterministic test transcript is the applicable evidence layer: this task changes a host-side
protocol engine and synthetic socket termination, not guest architectural execution or a
concurrency boundary, so there is no meaningful guest instruction trace and host rr is not
required. The browser demo cannot exercise this internal endpoint until E3-T21b2 supplies the guest
peer; the end-to-end demo gate remains on that dependent task.

### 2026-07-27 — verifier — VERDICT: refuted

- P2 receiver credit enforcement — **FAILED**. Predicted that after ACCEPT advertised four DATA
  frames, a fifth DATA frame pipelined in the same socket read before any ACK could reach the sender
  would produce `ERROR(FLOW_CONTROL)` and would not reach the sink. Observed the fifth reply was
  another ACK (`type = 6`), so the receiver has no inbound outstanding-frame accounting and the
  local backend can accumulate an ACK queue proportional to attacker-supplied tiny DATA frames.
  Repro: `cargo test -p wasm-vm-slirp --lib
  receiver_rejects_data_beyond_advertised_credit -- --nocapture`, failing at
  `crates/slirp/src/file_transfer.rs:1106`. Enforce the advertised four-frame receive window before
  accepting/writing DATA.
- P3 terminal CANCEL idempotence — **FAILED**. Predicted a duplicate CANCEL for stream 43 would be
  ignored and a later unused stream ID on the same framed connection would remain usable. Observed
  the duplicate is reclassified as `ERROR(BAD_STATE)` and `fail_stream` changes the whole
  connection to `Terminal`; the next OFFER yields no response and closes. Repro:
  `cargo test -p wasm-vm-slirp --lib
  duplicate_cancel_is_idempotent_and_connection_remains_usable -- --nocapture`, failing at
  `crates/slirp/src/file_transfer.rs:1138`. Track terminal stream IDs separately from connection
  framing and make duplicate cancellation idempotent.
- P4 timeout correlation — **FAILED**. Predicted the timeout ERROR would carry active stream ID 45.
  Observed stream ID 1 because `poll` always calls `error_frame(0, Timeout)` and `error_frame`
  substitutes 1. Repro: `cargo test -p wasm-vm-slirp --lib
  timeout_error_identifies_the_affected_stream -- --nocapture`, failing at
  `crates/slirp/src/file_transfer.rs:1158` with `left: 1`, `right: 45`. Preserve the affected stream
  ID in timeout output.
- P1/P5/P6/P7 — **HELD for the exercised boundaries**. The worker's eight focused tests passed
  independently (including 0/100 MiB streaming, malformed envelope/type lengths, offset rejection,
  two-transfer admission, source-side credit, source mutation, and timeout cancellation);
  `file_transfer_is_only_on_gateway_10021_and_never_dials_a_destination` passed with the connector
  probe empty and port 10022 unable to reach WVFT; and the no-default-features wasm build passed.
  Carry these results forward only while their code/dependency boundary is unchanged.
- COVERAGE endpoint lifecycle — **INSUFFICIENT**. The scoped diff adds the real-socket error,
  timeout-close, disconnect/relisten, second-slot, and custom-store paths in
  `crates/slirp/src/local_backend.rs:466-536`, but the only stack-level test stops after HELLO_ACK.
  After the semantic repairs, exercise a real TCP OFFER/DATA/COMMIT transfer, typed fatal close,
  timeout close, relisten, and both slots through `SlirpLocalBackend`; direct engine tests do not
  execute these integration hunks.
- SUITE: promoted the three deterministic failing regressions above. Sabotage and pristine-clone
  proof are deferred until correctness holds and the implementation head is frozen again, per the
  incremental re-verification rule.

Commands: `cargo test -p wasm-vm-slirp --lib file_transfer -- --nocapture` (worker suite: 8 passed);
the three focused regression commands above (failed as cited);
`cargo test -p wasm-vm-slirp --lib
file_transfer_is_only_on_gateway_10021_and_never_dials_a_destination -- --nocapture` (passed);
`cargo build -p wasm-vm-slirp --target wasm32-unknown-unknown --no-default-features` (passed).

### 2026-07-27 — worker — reworked after refutation

Commit `d28a0a7` repairs only the three semantic refutations and the named integration-coverage
gap. Receiver DATA now consumes a four-frame per-delivery window, so a fifth frame pipelined before
the returned ACK batch is rejected before the sink write. Completed/cancelled stream IDs remain
terminal and late frames are ignored without poisoning the connection. Timeout output now carries
the active stream ID. The promoted regressions remain in the focused suite.

The added real-TCP test establishes both bounded `10.0.2.2:10021` listeners simultaneously, drives
HELLO/OFFER/DATA/COMMIT through `SlirpLocalBackend` and a custom store, observes typed timeout and
malformed-frame errors, resets both sockets, and proves a closed slot relistens for a new
negotiation. This directly executes the previously uncovered queue, close, disconnect, second-slot,
custom-store, and relisten hunks.

Exact-head commands:

- `cargo fmt --all --check` — passed.
- `cargo clippy -p wasm-vm-slirp --all-targets -- -D warnings` — passed.
- `cargo test -p wasm-vm-slirp --lib file_transfer -- --nocapture` — 12 passed, 0 failed, including
  all three verifier-promoted regressions and the real-TCP lifecycle.
- `cargo test -p wasm-vm-slirp --lib` — 242 passed, 0 failed, 1 pre-existing resolver test ignored.
- `cargo build -p wasm-vm-slirp --target wasm32-unknown-unknown --no-default-features` — passed.
- `git diff d28a0a7^..d28a0a7 --check` — passed.

Per incremental re-verification, the verifier's P1/P5/P6/P7 results can carry forward because their
code and dependency boundary are unchanged. Re-verification should focus on P2/P3/P4 and the
endpoint lifecycle hunks added in `d28a0a7`.

### 2026-07-27 — verifier — VERDICT: verified

- P2 receiver credit enforcement — **HELD**. Predicted a fifth DATA frame pipelined behind the
  four-frame ACCEPT grant would produce `ERROR(FLOW_CONTROL)` before the fifth sink write. The
  promoted `receiver_rejects_data_beyond_advertised_credit` regression passed with four bytes
  written. Sabotage raised the reset window to five; the same test failed with an ACK (`type = 6`)
  where it predicted ERROR, then passed again after the mutation was reverted.
- P3 terminal CANCEL idempotence — **HELD**. Predicted a duplicate CANCEL for stream 43 would emit
  no frame, leave the connection open, and permit unused stream 44. The promoted
  `duplicate_cancel_is_idempotent_and_connection_remains_usable` regression passed.
- P4 timeout correlation — **HELD**. Predicted receiving stream 45 and host-upload stream 46 in
  `AwaitAccept` would each retain their own ID in `ERROR(TIMEOUT)`. The promoted receiving
  regression and verifier-added `timeout_error_identifies_a_host_upload_awaiting_accept` bounded
  attack both passed.
- P1/P5/P6/P7 — **CARRIED HELD**. Their implementation and dependency boundary are unchanged from
  `d5914dc`: malformed/oversized/offset/name attacks, two-transfer admission, source-side credit
  and mutation, the gateway-only connector probe, and the wasm build remain covered. The focused
  suite and wasm build passed again at the frozen verification head.
- COVERAGE endpoint lifecycle — **HELD**. Predicted both permanent sockets could negotiate
  simultaneously; slot one could OFFER/DATA/COMMIT through the custom store; slot two would emit a
  typed, stream-correlated timeout and close; reset sockets would disconnect and relisten; and a
  new malformed session would emit typed `BAD_FRAME`. The real-TCP lifecycle regression passed,
  exercising the queue, close, disconnect, custom-store, second-slot, timeout, and relisten hunks
  in `crates/slirp/src/local_backend.rs:469-536`.
- SUITE: retained the three promoted refutation regressions and added the host-upload timeout
  correlation regression. The initial full-suite run inside the restricted sandbox failed only
  where tests attempted local socket binds (`Operation not permitted`); the identical rerun with
  local socket access passed 243 tests, with one pre-existing resolver test ignored.
- PRISTINE: exact head `af8c29e` cloned without hardlinks to
  `/private/tmp/e3-t21b1-pristine.KmJlBU/repo` under scrubbed `RUSTFLAGS`/`RUST_LOG`. The 13-test
  focused WVFT suite, including 0/100 MiB and both real-TCP endpoint tests, passed; the
  no-default-features wasm build passed.

Commands: `cargo fmt --all --check`;
`cargo clippy -p wasm-vm-slirp --all-targets -- -D warnings`; the three promoted focused
regressions; `cargo test -p wasm-vm-slirp --lib
file_transfer_real_tcp_transfer_timeout_close_two_slots_and_relisten -- --nocapture`;
`cargo test -p wasm-vm-slirp --lib file_transfer -- --nocapture` (13 passed);
`cargo test -p wasm-vm-slirp --lib` (243 passed, 1 ignored, with local socket access);
`cargo build -p wasm-vm-slirp --target wasm32-unknown-unknown --no-default-features`;
`git diff --check`; pristine-clone focused test and wasm build at `af8c29e`.
