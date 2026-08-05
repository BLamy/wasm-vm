---
id: E3-T21b
epic: 3
title: Bounded guest file agent and slirp control endpoint
priority: 321.2
status: cancelled
decomposed_into: [E3-T21b1, E3-T21b2]
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

### 2026-07-27 — planning split

The seam audit found two independently falsifiable high-risk boundaries: the alloc-bounded WVFT
parser/service plus synthetic slirp port, and the static riscv64 filesystem agent plus reproducible
rootfs integration. Combining them would force every protocol refutation to repeat cross-toolchain
and image gates. This container is replaced by E3-T21b1 and E3-T21b2.
