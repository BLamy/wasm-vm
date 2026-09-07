---
id: E5-T25c
epic: 5
title: Measure and calibrate focused-key input-to-photon latency
priority: 525.3
status: evidence-needed
depends_on: [E5-T25a]
estimate: S
risk: medium
capstone: false
---

## Goal

Measure the elapsed time from a real injected keypress into a focused terminal to the
first drawn present whose damage rectangle intersects the resulting cursor cell.
Report the distribution, not only a mean, and bound rAF/vsync quantization as an
explicit error bar.

## Boundary

Own the latency detector, 100-trial scenario, histogram, and calibration evidence.
Do not change the guest input protocol, window manager, display timing, or drag-FPS
aggregation.

## Deliverables

- `web/bench/desktop-perf.ts` key-latency scenario and machine-readable p50/p95,
  full histogram, warm-up discard count, and rAF/vsync error bound.
- A known 100 ms present-delay calibration mode with measured shift and tolerance.
- One headed high-frame-rate screen recording/cross-check with the frame count and
  timing correspondence documented.

## Acceptance criteria

- [ ] At least 100 focused keypress trials complete unattended after warm-up, with a
      p50/p95 distribution and no missing-damage samples.
- [ ] The detector reports the first post-input intersecting damage rect, not merely
      the next animation callback, and a known 100 ms delay shifts p50 by 100 +/- 10
      ms.
- [ ] The screen-recording cross-check agrees with the detector within one recorded
      display frame, with browser version, refresh rate, and capture setup retained.
- [ ] The result is reproducible from `make verify-E5-T25c` with zero page/console/
      HTTP errors and a clean environment.

## Verification command

make verify-E5-T25c

## Adversarial verification

Inject a keypress while the terminal is unfocused, issue two keys before the first
present, and force an unrelated damage rectangle. The harness must not attribute the
wrong frame or silently drop a trial. Feed it a bimodal distribution containing a
500 ms mode and verify the histogram and p95 expose it. The 100 ms delay calibration
must fail if the detector watches rAF alone.

## Verification log

### 2026-09-06 — verifier — VERDICT: needs-evidence

- P1 focused key distribution — HELD. Predicted 100 post-warm-up focused `ArrowRight`
  trials, one unique first-intersecting drawn-present sample per trial, no missing values,
  and a histogram totaling 100. The exact-head artifact records head
  `45aa9fb28fb61601d37a2e16e07e15ed0345d5fb`, 100/100 unique ordered samples,
  p50 50.495 ms, p95 119.525 ms, and histogram count 100
  (`evidence/e5-t25c/browser/input-photon.json`:4,351-356; SHA-256
  `866ec5e6fa787f6b09ab3f08ed731ebd3cdffff27c1192e140e67ae2214436da`).
- P2 first-damage detector and 100 ms calibration — HELD. Predicted the detector would
  reject pre-input, undrawn, non-intersecting, unfocused, and superseded-key records and
  that the isolated drawn-present probe would shift p50 by 90-110 ms without delaying the
  page's global rAF. The deterministic adversarial suite passed 20/20; the headed artifact
  records unfocused rejection, overlapping-first-key rejection, and a 101.465 ms shift
  with `shiftHeld: true` (`input-photon.json`:206-215,3096-3102).
- P3 screen-recording correspondence — NEEDS EVIDENCE. Predicted a retained headed
  high-frame-rate capture with enough frames to establish its cadence and identify the
  post-input cursor frame within one recorded display frame. The timestamp comparison is
  numerically within one 60.006 Hz display frame (6.442 ms), but CDP retained only two
  frames 161.354 ms apart (6.198 Hz), and the first/last PNGs are byte-identical
  (`input-photon.json`:4124-4139; both PNG SHA-256
  `20387e559d680c7404774fa96d083c2f30a20cdff29dd225f2931f863180ab76`).
  The companion WebM is 25 fps, not the measured 60 Hz display cadence (SHA-256
  `131f7a9f3cf496e1ca74828f0a7149dcecbdd06f97fd12533231ad7a756628b7`).
  Record and retain a capture with a demonstrated high-frame-rate cadence and a visually
  distinguishable post-input frame, then bind the detector timestamp to that frame.
- P4 exact head, parity, and zero-error run — HELD in the supplied workspace. Predicted
  headed Chrome, exact-head JSON, source/dist byte parity, and empty page/console/HTTP
  error sets. Chrome 152.0.7977.76 was headed, parity audit passed, screenshot SHA-256
  matched `8e6d39ce17d5a9ef31597990c2a88c218e709dfddf9f2ebc0878c09bb2d30a57`,
  and both error arrays are empty (`input-photon.json`:4-6,4155-4156).
- COVERAGE clean-environment branch — NEEDS EVIDENCE. The exact-head run reused ignored
  `target/e5-t22c` image/chunk artifacts, so the new `e5-t25c-assets` branch in `Makefile`
  was not executed. Run `make verify-E5-T25c` from a pristine checkout on this machine
  with `RUSTFLAGS`, `RUST_LOG`, and `CARGO_*` scrubbed, retaining the asset-build and final
  browser outputs. No independent-machine claim is required.
- COVERAGE generated deploy projections — WAIVED. `web/dist/**` and the service-worker
  version are generated projections; byte parity for the changed terminal, performance,
  presentation, TypeScript, and roadmap surfaces passed the release audit. The roadmap
  row itself still needs the normal built-demo browser proof when this evidence gap closes.
- SUITE: retained the worker's deterministic detector/calibration tests; no new promotion
  was needed. Commands: `node --check web/bench/desktop-perf.js`; `node --check
  web/desktop-terminal.js`; `node --check tools/verify/e5-t25c-browser.mjs`; `node --test
  web/tests/e5-t25c-desktop-perf.test.mjs web/tests/e5-t25b-desktop-perf.test.mjs
  web/tests/e5-t06d-presentation.test.mjs web/tests/e5-t09d-hidden-present.test.mjs`;
  `node tools/verify/e5-t25c-release-audit.mjs`; artifact invariant/hash audit; bundled
  ffmpeg metadata inspection; `git diff --check 18246000^ 45aa9fb2`.
