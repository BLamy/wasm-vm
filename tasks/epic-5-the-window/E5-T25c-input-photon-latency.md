---
id: E5-T25c
epic: 5
title: Measure and calibrate focused-key input-to-photon latency
priority: 525.3
status: pending
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

(empty)
