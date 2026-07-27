---
id: E3-T21b1
epic: 3
title: Bounded WVFT engine and synthetic slirp endpoint
priority: 321.21
status: implemented
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
