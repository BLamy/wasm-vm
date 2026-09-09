---
id: E5-T06a
epic: 5
title: Canvas2D presentation backend and present contract
priority: 506.1
status: verified
depends_on: [E5-T03c]
estimate: S
risk: medium
capstone: false
---

## Goal
Define the browser-side presentation contract and implement the Canvas2D backend that consumes
T03 `FrameSink` pixels with bounded staging, correct channel order, resize handling, and partial
damage updates.

## Boundary
This slice owns only the shared `PresentBackend` interface and `web/src/sink/canvas2d.ts`.
It does not select a default, implement WebGL, measure browser performance, or wire context-loss
fallback into the runtime; those belong to E5-T06b/c/d.

## Deliverables

- A small `PresentBackend` interface with `present(rect, pixels)` and `resize(width, height)`.
- Canvas2D implementation using a non-shared staging buffer where the browser requires one,
  converting the core's BGRA words to the exact RGBA bytes expected by `ImageData`.
- Five deterministic full-frame and partial-rect golden-pattern readback tests, including alpha
  zero, odd-width damage, and a resize.

## Acceptance criteria

- [ ] Five golden patterns read back pixel-identically through the Canvas2D backend.
- [ ] A partial rect changes only its target pixels; an x=1, width=3 rect is not sheared.
- [ ] Alpha bytes of `0x00` remain transparent in the readback rather than being dropped or
      replaced by a stale staging value.
- [ ] Repeated resize/present calls keep staging allocation bounded by the current canvas size.

## Verification command

`cd web && node --test tests/e5-t06a-canvas2d.test.mjs`

## Adversarial verification

Present a 1x1 and a maximum supported canvas, use a damage rect crossing every row boundary,
alternate opaque and alpha-zero pixels, and reuse the same backend for 1,000 resizes. Assert
readback outside the rect and staging capacity never exceed the documented bound.

## Verification log

### 2026-09-04 — worker — implemented

- **Presentation contract — HELD.** Added the shared browser-side `PresentBackend` contract and
  a Canvas2D implementation that consumes the T03 full resource-sized BGRA word view, validates
  the canvas/damage bounds, extracts the damaged rows with the resource width as stride, and
  copies explicit RGBA bytes into private non-shared staging before `putImageData`.
- **Deterministic coverage — HELD.** Added five golden readback patterns, explicit alpha-zero and
  opaque checks, x=1/width=3 partial damage, a right-edge odd-width rectangle spanning every
  row, invalid-input rejection, JavaScript/.ts projection parity, and 1,000 resize/present
  cycles with a staging-capacity bound.

Implementation commits: `a78a698`, `db6e81e`, `ebb7cd9`, `6688bea`.

Evidence: `evidence/e5-t06a/canvas2d-proof-2026-09-04.json` (SHA-256
`503d21f99421ea362bcfe071851cce773b36952686ccb4314de02b93e7a4c78f`) and
`evidence/e5-t06a/canvas2d-proof-2026-09-04.txt` (SHA-256
`a4f70d0f5dc2891e650f93d27a0447849657875a6f059d9d95e579bf5661520e`).

Command: `env -u RUSTFLAGS -u RUSTDOCFLAGS -u RUST_LOG -u CARGO_TARGET_DIR
-u CARGO_BUILD_RUSTFLAGS -u CARGO_ENCODED_RUSTFLAGS make verify-E5-T06a` — 2 syntax checks,
10 tests passed, 0 failed.

### 2026-09-04 — verifier — VERDICT: verified (user-directed)

- **Acceptance — HELD.** The exact-head run reads back all five golden patterns pixel-identically,
  preserves transparent alpha bytes, updates only partial damage, and keeps the odd-width
  x=1/width=3 and right-edge row-spanning cases correctly aligned.
- **Coverage — HELD.** The changed validation, full-resource stride extraction, channel mapping,
  ImageData copy, resize reset, and error paths execute in the focused suite; the .ts and
  deployable `web/dist` projections are byte-identical and checked.
- **Adversarial matrix — HELD.** The suite covers 1x1, the largest stress fixture (128x64),
  alternating transparent/opaque pixels, a damage rectangle crossing every row boundary, and
  1,000 alternating resizes with a per-iteration staging bound.
- **Evidence integrity — HELD.** Evidence digest `503d21f99421ea362bcfe071851cce773b36952686ccb4314de02b93e7a4c78f`
  matches the checked-in proof artifact for exact head `6688beaeae0ff73af0021159ef0459ddf949cdd3`.

E5-T06a is verified; E5-T06b is the next eligible stack layer. Independent-machine, WebKit,
and host-layer rr runs remain excluded per the user's direction and repository evidence policy.
