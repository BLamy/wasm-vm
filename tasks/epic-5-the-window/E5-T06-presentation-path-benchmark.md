---
id: E5-T06
epic: 5
title: Canvas presentation path — measure putImageData vs WebGL upload, pick by data
priority: 506
status: cancelled
depends_on: [E5-T03]
estimate: M
risk: medium
capstone: false
decomposed_into: [E5-T06a, E5-T06b, E5-T06c, E5-T06d]
---

## Goal
A `CanvasSink` implementing the T03 `FrameSink` trait with two presentation backends —
2D-context `putImageData` and WebGL2 `texSubImage2D` + textured quad — plus a benchmark
page that measures both, and a recorded, data-backed decision on the default path.

> **DECOMPOSED 2026-09-04.** This M-sized presentation container is cancelled before
> implementation as required by task policy. E5-T06a owns the Canvas2D backend and shared
> present contract, E5-T06b owns the WebGL2 backend, E5-T06c owns the reproducible benchmark
> and measured decision, and E5-T06d owns runtime selection, context-loss fallback, and final
> browser integration.

## Execution slices

1. **E5-T06a — Canvas2D backend and contract.** Define the browser-side `PresentBackend` shape,
   implement bounded BGRA/RGBA staging plus `putImageData`, and prove full-frame/partial-rect
   readback against five golden patterns.
2. **E5-T06b — WebGL2 backend.** Implement texture upload and fullscreen-quad presentation behind
   the same contract, with odd-rect, alpha, partial-update, and readback tests.
3. **E5-T06c — Benchmark and decision.** Add the machine-readable 1280x800/2560x1600 full-frame
   and 64x64-damage benchmark, collect the supported browser/backend matrix, and record the
   measured default plus fallback order in `docs/perf/present-paths.md`.
4. **E5-T06d — Runtime integration and fallback.** Feature-detect the selected backend, handle
   WebGL context loss with at most one dropped frame, wire the sink into the display path, and
   finish the browser proof of the chosen default and fallback.

## Context
This is the only hop where our pixels cross the JS boundary, and the wrong choice costs
milliseconds per frame forever. Candidate paths: (a) `ctx2d.putImageData` from an
`ImageData` — but `ImageData` cannot wrap a SharedArrayBuffer view (E4 moved guest RAM to
SAB + worker), so this path pays an explicit copy into a non-shared staging buffer;
(b) WebGL2 `texSubImage2D` from a `Uint8Array` view + fullscreen quad — engines differ on
accepting SAB-backed views (Chrome allows, Firefox has historically thrown), so the
staging copy may be needed here too — measure, don't assume; (c) `OffscreenCanvas` in the
VM worker vs posting to the main thread — measure both topologies. BGRA→RGBA swizzle:
free in the GL shader (swizzle in fragment shader or `texParameter`), a real per-pixel
cost for putImageData. Format note: prefer emitting straight into the staging buffer in
the sink, single copy total.

## Deliverables
- `web/src/sink/canvas2d.ts` and `web/src/sink/webgl.ts` behind one `PresentBackend`
  interface: `present(rect, pixels)`, `resize(w, h)`.
- `web/bench/present-bench.html`: synthetic frame generator (full-frame and 64x64
  damage-rect workloads at 1280x800 and 2560x1600) reporting p50/p95 ms per present over
  ≥ 300 frames, plus copies-per-frame count.
- Numbers from Chrome and Firefox on the dev machine recorded in
  `docs/perf/present-paths.md` with the decision and the fallback order.
- Runtime feature-detect + fallback (WebGL context loss → 2D path) wired into the sink.

## Acceptance criteria
- [ ] Both backends render 5 golden test patterns pixel-identically (readback via
      `getImageData` compared to expected RGBA, catching swizzle bugs).
- [ ] Bench page outputs machine-readable JSON results; results for 2 browsers x 2
      backends x 2 workloads are committed in the doc.
- [ ] The chosen default is the measured-faster path for the damage-rect workload at
      1280x800, and the doc says by how much.
- [ ] WebGL context-loss event triggers fallback with no more than one dropped frame
      (simulated via `WEBGL_lose_context`).
- [ ] Partial-rect present updates only the rect (verified by readback outside the rect).

## Adversarial verification
Refute the measurement itself: re-run the bench with the tab backgrounded, DPR=2, and a
throttled CPU (DevTools 4x) — if the committed ranking inverts under any of these and the
doc doesn't note it, that's a refutation of the decision's validity. Refute correctness:
present a frame whose alpha bytes are 0x00 — canvas must not show through (premultiplied
alpha bug); present odd-width rects (x=1, w=3) on the GL path (UNPACK_ROW_LENGTH /
UNPACK_SKIP_PIXELS misuse shows as shearing). Verify the SAB claim empirically in both
browsers and record which engine required the staging copy.

## Verification log
### 2026-09-04 — coordinator — decomposed

This M-sized presentation container is cancelled before implementation as required by task
policy and replaced by four ordered S tickets with one browser boundary and one deterministic
acceptance command each. The dependency chain is Canvas2D contract → WebGL2 backend → measured
decision → runtime fallback/integration. E5-T07 and E5-T09 are rewired to the final integration
slice so neither can bypass the presentation decision.
