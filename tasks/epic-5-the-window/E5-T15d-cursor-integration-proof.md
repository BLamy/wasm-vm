---
id: E5-T15d
epic: 5
title: Cursor plane integration and transform-only proof
priority: 515.4
status: verified
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

### 2026-09-04 — verifier — VERDICT: verified

- P1 native cursorq integration — HELD. Predicted one UPDATE with the 64×64 payload, 500
  state-only MOVE callbacks, one 256×256 update, canonical resource-0 hide, and used-ring progress
  503. The checked-in marker records exactly `updates=3 moves=500 final_x=600 final_y=580
  checker_crc=29eaa715 oversized_pixels=65536 hidden_resource=0 used=503`
  (`evidence/e5-t15d/cursor-integration-2026-09-04.json:48-51`); the fresh targeted machine-boundary
  test passed and its assertions cover the changed test body (`crates/core/tests/virtio_gpu_machine.rs:530-657`).
- P2 pixels, alpha, hotspot, fallback, hide — HELD. Predicted the independent all-byte RGBA
  reference would have zero mismatches, hotspot `(10,3)`, CSS selection for 64×64, bounded overlay
  fallback for 256×256, and a clean resource-0 state. Observed `mismatchBytes=0`, the expected
  samples, and the exact CSS/overlay/hide descriptors (`evidence/e5-t15d/cursor-integration-2026-09-04.json:193-229`),
  with source/dist hashes matching for all six proof inputs (`evidence/e5-t15d/cursor-integration-2026-09-04.json:13-47`). The fresh T15b/T15c
  regression tests passed 11/11, including every-byte conversion, hotspot placement, 256×256
  bounds, mode transitions, hide/reset, and 1,000 alternating transitions.
- P3 delayed frame load and transform-only movement — HELD. Predicted all 500 requested moves
  would complete with zero layout reads and exactly 500 transform writes while delayed framebuffer
  work coalesces safely and drains. Observed final position `(619,579)`, transform
  `translate3d(609px, 576px, 0px)`, `layoutReads=0`, `transformWrites=500`, 160/160 delayed
  deliveries, 140 coalesced frames, scheduler `maxPending=1`, no pending/scheduled work, and no
  presentation errors (`evidence/e5-t15d/cursor-integration-2026-09-04.json:94-192`).
- P4 adversarial lifecycle and ownership — HELD. A fresh Chromium attack ran the seeded lifecycle
  10,000 times, alternating DPR 1/2, with 9,900 small CSS transitions and 100 oversized overlay
  transitions: zero move failures, one overlay maximum, maximum data URL 350,006 chars, delayed
  presentation visibility pause/resume drained successfully, final hotspot transform
  `translate3d(1299px, 855px, 0px)`, stale-resource MOVE was rejected without changing the active
  image/transform, and disposal left no overlay or host-cursor ownership. This directly exercises
  the cursor move/cleanup paths (`web/src/sink/cursor-controller.js:249-360,377-430`) and visibility
  scheduler paths (`web/src/sink/visibility-scheduler.js:34-154`); Chromium reported no non-favicon
  console/page/request errors. The checked-in proof independently records clean browser health,
  DPR-2 math, and resource-0 teardown (`evidence/e5-t15d/cursor-integration-2026-09-04.json:203-263`).
- P5 evidence digest, head, and scope — HELD. The checked-in envelope SHA-256 is
  `95d2e5ca9483246a0aa9287e88df49ed9f89f95b684d20a51c872e0234cafabf` and the screenshot SHA-256 is
  `50344f1689f1a97e57bf2b58507d6b6ddb13425d58e92fcfdd032c197839c341`; both recomputed exactly,
  and the PNG was visually inspected. The envelope records `gitHead=94c5176` while current HEAD
  is `73ce19f`; inspection of `git diff 94c5176 73ce19f` found only the envelope/PNG, task
  status/log/queue, generated task manifests, and generated `web/dist/sw.js`—no acceptance-bearing
  runtime source changed after recording. The recorded implementation-head evidence therefore
  remains applicable to current HEAD; independent machines, WebKit, and host rr remain waived as
  authorized (`evidence/e5-t15d/cursor-integration-2026-09-04.json:259-264`).
- COVERAGE: HELD. The native proof assertions, browser verifier success path, route contract tests,
  source/dist parity, generated route, and screenshot were exercised or hash-checked. The verifier's
  error branches and cleanup-on-failure branches are defensive harness/diagnostic paths, not
  acceptance behavior, and are waived; docs, Makefile/manifest metadata, generated SW version, and
  evidence files are non-runtime bookkeeping or directly inspected artifacts. No changed
  acceptance-bearing hunk remained unexercised.
- Commands: `node --check web/cursor-integration.js && node --check tools/verify/e5-t15d-cursor-integration.mjs`;
  `node --test web/tests/e5-t15d-cursor-integration.test.mjs`;
  `node --test web/tests/e5-t15b-cursor-sink.test.mjs web/tests/e5-t15c-cursor-mode.test.mjs`;
  `cargo fmt --check -p wasm-vm-core`;
  `cargo clippy -p wasm-vm-core --test virtio_gpu_machine -- -D warnings`;
  `cargo test -p wasm-vm-core --test virtio_gpu_machine gpu_cursor_plane_integration_preserves_pixels_and_transform_only_moves -- --nocapture`;
  checked-in SHA/parity checks; and the fresh Chromium 10,000-iteration bounded attack described
  above. No implementation code or checked-in evidence envelope was modified by verification.
