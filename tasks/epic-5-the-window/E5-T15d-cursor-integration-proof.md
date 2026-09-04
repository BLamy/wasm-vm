---
id: E5-T15d
epic: 5
title: Cursor plane integration and transform-only proof
priority: 515.4
status: implemented
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

### 2026-09-04 — worker — IMPLEMENTED

- Commit: `94c51769153d630377a270a93eaa208708bd43c3`.
- Exact submission gate: `make verify-E5-T15d` — passed JavaScript syntax and route-parity tests,
  Rust formatting/clippy, the native cursorq machine-boundary capture, local wasm build, and the
  Chromium integration proof.
- Native evidence recorded 3 UPDATE callbacks, 500 state-only MOVE callbacks, a 256×256 resource,
  canonical resource-0 hide, checkerboard CRC `29eaa715`, and used-ring progress `503`.
- Chromium evidence recorded an independent all-byte PNG RGBA/alpha comparison for the 64×64
  checkerboard, exact hotspot `(10,3)`, 500 requested relative moves with 500 transform writes and
  zero layout reads, 160 delayed framebuffer deliveries with 140 coalesced frames and one pending
  frame maximum, DPR-2 transform math, oversized overlay fallback, no-traffic default cursor, and
  clean resource-0 teardown. Browser health was clean aside from the allowed favicon 404.
- Evidence: [`evidence/e5-t15d/cursor-integration-2026-09-04.json`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t15d/cursor-integration-2026-09-04.json),
  SHA-256 `95d2e5ca9483246a0aa9287e88df49ed9f89f95b684d20a51c872e0234cafabf`; screenshot
  [`evidence/e5-t15d/cursor-integration-2026-09-04.png`](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t15d/cursor-integration-2026-09-04.png),
  SHA-256 `50344f1689f1a97e57bf2b58507d6b6ddb13425d58e92fcfdd032c197839c341`.
- Claim: the native and Chromium runs exercise the complete T15d browser/native proof boundary;
  source and generated dist files have matching hashes, the final cursor position survives delayed
  framebuffer load, the PNG bytes match an independent decoder/reference, and hide/fallback paths
  leave no stale DOM or host-cursor ownership. Independent-machine, WebKit, and host-rr runs are
  excluded per the user's direction and repository policy.
