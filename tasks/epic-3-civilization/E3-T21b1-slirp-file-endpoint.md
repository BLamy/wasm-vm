---
id: E3-T21b1
epic: 3
title: Bounded WVFT engine and synthetic slirp endpoint
priority: 321.21
status: pending
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
(empty)
