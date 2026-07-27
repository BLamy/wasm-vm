---
id: E3-T21b
epic: 3
title: Bounded guest file agent and slirp control endpoint
priority: 321.2
status: pending
depends_on: [E3-T21a]
estimate: S
risk: high
capstone: false
---

## Goal
Implement the guest half of the frozen transfer protocol and the single-purpose slirp endpoint.

## Deliverables
- A static riscv64 guest agent and `vm-download` command integrated into the image pipeline.
- A streaming reserved control endpoint with byte, concurrency, path, and timeout bounds.
- Filename sanitization and atomic `.part` handling with fsync/flush semantics.

## Acceptance criteria
- [ ] Focused native tests stream 0-byte, 100 MiB, hostile-name, interrupted, and two concurrent
  transfers while keeping host buffering below the protocol bound.
- [ ] A port/capability test proves the endpoint exposes only the file protocol.
- [ ] Native and wasm target builds pass for the changed transport boundary.

## Adversarial verification
Send malformed/truncated/oversized frames, traverse names, exhaust concurrency and disk quota, and
disconnect at every state transition. No host capability outside the protocol may be reached.

## Verification log
(empty)
