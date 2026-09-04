---
id: E5-T09a
epic: 5
title: Core virtio-gpu damage coalescer
priority: 509.1
status: verified
depends_on: [E5-T07d]
estimate: S
risk: high
capstone: false
---

## Goal

Add a deterministic per-scanout damage accumulator so multiple RESOURCE_FLUSH rectangles can be
represented as one bounded present plan without changing guest completion timing.

## Boundary

This slice owns the core rectangle normalization, clipping, union, spill-to-bounding-box policy, and
its unit tests. It does not own dirty tiles, browser scheduling, page metrics, or performance docs.

## Deliverables

- A core `DamageAccumulator` (or equivalent) with a documented maximum of 16 retained rectangles.
- Overlap, adjacency, containment, clipping, drain, and 17th-rectangle bounding-box tests.
- A stable counter/result shape that later tile and browser slices can consume.

## Acceptance criteria

- Overlapping, adjacent, and contained rectangles coalesce deterministically without losing covered
  pixels; disjoint rectangles remain separate up to the configured bound.
- The 17th retained rectangle collapses the plan to one resource-bounded bounding box, and draining
  returns a fresh empty accumulator.
- Exact boundary cases, including `x=63,w=2`, right/bottom edges, zero-sized input, and clipped
  input, have explicit assertions.

## Verification command

`make verify-E5-T09a`

## Adversarial verification

Feed seeded random rectangles, including repeated edge-touching and out-of-bounds inputs, and
compare the accumulator's covered-pixel mask with a simple independent reference mask after every
insert and drain.

## Verification log

### 2026-09-04 — verifier — VERDICT: verified

- P1 rectangle semantics — HELD. Predicted overlap, edge adjacency, containment, clipping, and
  corner-only separation remain deterministic while preserving every reference-covered pixel;
  the five coalescer tests passed, including `seeded_random_rectangles_never_drop_reference_damage`
  over 10,000 seeded sequences with an independent 32x24 reference mask checked after every
  insert and drain.
- P2 bounded spill and drain — HELD. Predicted 16 disjoint rectangles remain retained and the
  17th becomes one resource-bounded box; the explicit spill test observed that behavior, including
  a clipped rectangle reaching the 128x128 resource edge.
- P3 changed-code coverage — HELD. Predicted the resource integration would publish the accumulated
  bound and clear it without regressing the existing transfer/flush contract; the full core library
  suite (256 passed) exercised the resource path and all accumulator methods, and the affected
  `virtio_gpu_machine` integration test passed (2 passed).
- P4 target portability — HELD. Predicted the refactored core would compile for the wasm target;
  `cargo build -p wasm-vm-wasm --target wasm32-unknown-unknown` passed.

Exact final implementation head: `9b067d8db731190399ef9736438b86aedf505e7c`.
Exact acceptance command: `make verify-E5-T09a`.
Evidence: `evidence/e5-t09a/damage-coalescer.json` (SHA-256
`eaa1ab2d1ea52645567c405efb5faf070cce4ea1aa4e5b3de77b9a2e99525939`), whose recorded head,
proof-file digests, and five passing commands match this claim. Scope follows the task policy and
user direction: independent machines, WebKit, and host rr were not required.
