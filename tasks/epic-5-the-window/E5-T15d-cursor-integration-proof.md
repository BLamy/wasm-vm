---
id: E5-T15d
epic: 5
title: Cursor plane integration and transform-only proof
priority: 515.4
status: pending
depends_on: [E5-T15c]
estimate: S
risk: medium
capstone: false
---

## Goal

Close the cursor-plane slice with one deterministic integration proof covering pixel/alpha conversion,
hotspot placement, mode behavior, hide/lifecycle safety, and high-rate movement under frame load.

## Boundary

This slice owns the browser/native proof and documentation of cursor-plane behavior. It adds no new
cursor protocol or presentation primitive.

## Deliverables

- Deterministic checkerboard/hotspot/oversize/hide/UNREF and 500 Hz MOVE workload.
- Evidence envelope with browser health, transform/layout counters, and exact source/dist identity.
- `docs/perf/cursor-plane.md` describing the CSS/overlay decision and measured move/present rates.

## Acceptance criteria

- Checkerboard RGBA/alpha and hotspot `(10,3)` match the independent reference.
- Resource 0 hides, oversized resources fall back, and fbcon/no-cursorq leaves host cursor state alone.
- 500 Hz relative moves preserve the final position with transform-only updates and no layout reads.
- The proof remains green while framebuffer presents are delayed and reports both rates/counters.

## Verification command

`node tools/verify/e5-t15d-cursor-integration.mjs`

## Adversarial verification

Run the seeded lifecycle sequence 10,000 times, add a delayed framebuffer present, alternate DPR 1/2
math, and sample the final hotspot after visibility resume. Any drift, dropped final move, layout read,
or unbounded data-URL retention refutes the integration claim.

## Verification log

(empty)
