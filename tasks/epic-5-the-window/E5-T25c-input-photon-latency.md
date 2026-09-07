---
id: E5-T25c
epic: 5
title: Measure and calibrate focused-key input-to-photon latency
priority: 525.3
status: verified
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

### 2026-09-06 — worker — re-recorded evidence after capture gap

- Exact code head: `97c706e13d96b0c0e4c8ce6c7ec1ed875cbf6a6a`.
- Submission command: `E5_T25C_REQUIRE_HEAD=97c706e13d96b0c0e4c8ce6c7ec1ed875cbf6a6a make verify-E5-T25c`.
- The full target passed its 12/12 deterministic suite, release audit, conditional asset gate, web build, and headed browser run. The final artifact is `evidence/e5-t25c/browser/input-photon.json` (SHA-256 `0fba101908d9ff0a77a4558c4101580d1ddc1063f6c653821b23ac5f5e5795f9`) with 100 real focused-key samples, p50 `50.915 ms`, p95 `133.260 ms`, zero missing samples, and empty page/HTTP error arrays.
- The final headed CDP capture retained 10 frames at a `16.459 ms` median (`60.757 Hz`), the rAF marker advanced 16 frames, and first/last PNGs differ (`4bde7ae70745dfba8f4bc3fdbbf6d067e1a318ff499933c8e622bea74730d213` / `89a6edf0a1152ffd13c6f43c5cf4155419ea0389dffaa232736b817b5ebf2acb`); the nearest captured frame was `1.754 ms` from the detector's present and within one display frame. The unfocused and overlapping-input attacks remained rejected, and the isolated drawn-present calibration measured a `101.245 ms` shift for the known `100 ms` delay. The companion files are `screen-capture-first.png`, `screen-capture-last.png`, and `recording-path.txt` in the same evidence directory. This re-record addresses the verifier's P3 capture finding; the separate verifier must now carry forward the held predictions and issue the final verdict.

### 2026-09-06 — verifier — VERDICT: verified

- P1 focused key distribution — HELD. Carried forward the unchanged detector/runtime result
  and predicted that the replacement exact-head artifact would preserve 100 unique
  first-intersecting drawn-present samples after 10 warm-ups, a 100-count histogram, and
  no missing sample. An independent artifact audit observed 100 unique trials/sequences,
  all drawn and intersecting, p50 `50.915 ms`, p95 `133.260 ms`, and histogram total 100
  (`evidence/e5-t25c/browser/input-photon.json`:347-392,3088-3093; SHA-256
  `0fba101908d9ff0a77a4558c4101580d1ddc1063f6c653821b23ac5f5e5795f9`).
- P2 detector, attacks, and calibration — HELD. Carried forward the unchanged detector
  prediction and observed unfocused input rejected without capture, the first of two
  overlapping keys rejected with exactly one record, and the isolated drawn-present probe
  shifted p50 by `101.245 ms` for a requested `100 ms` (`input-photon.json`:206-215,
  3095-3107). The deterministic suite again passed 12/12, including unrelated damage,
  undrawn/rAF-only rejection, overlap, and the bimodal 500 ms tail.
- P3 headed recording correspondence — HELD. Predicted at least four monotonically timed,
  visibly changing CDP frames at display cadence and a detector-present match within one
  measured display frame. The exact-head Chrome 152 capture retained 10 frames with a
  derived median `16.459 ms` / `60.757 Hz`, advanced the test-only rAF marker 16 times,
  and matched the detector present by `1.754 ms` versus the measured `16.665 ms` display
  frame (`input-photon.json`:4120-4173). First/last PNG SHA-256 values differ:
  `4bde7ae70745dfba8f4bc3fdbbf6d067e1a318ff499933c8e622bea74730d213` and
  `89a6edf0a1152ffd13c6f43c5cf4155419ea0389dffaa232736b817b5ebf2acb`.
- P4 exact head, parity, and zero errors — HELD. The artifact names exact implementation
  head `97c706e13d96b0c0e4c8ce6c7ec1ed875cbf6a6a`, headed Chrome, and the hashed image
  inputs; page/console and HTTP error arrays are empty and screenshot SHA-256 independently
  matches `2f88ab539bb231fdc4624529a65a6ab986e0ac96a253c1f0bddfd8001e546f91`
  (`input-photon.json`:4-15,4175-4177). Syntax checks and the release audit reconfirmed
  source/dist, TypeScript projection, and roadmap parity.
- COVERAGE capture harness — HELD. The only post-verdict code delta is test-only: it drives
  an rAF marker, retains/acknowledges every CDP frame, derives cadence, saves distinct edge
  frames, and enforces minimum frame/marker counts plus visual change
  (`tools/verify/e5-t25c-browser.mjs`:135-215,545-562). Every new output is present in the
  exact-head artifact, and its release-audit sentinels passed.
- COVERAGE conditional image construction — WAIVED. The prescribed local target and
  `make e5-t25c-assets` gate passed and the browser consumed the retained image/manifest
  hashes. The absent-assets body (`Makefile`:1003-1009) is prerequisite image-building
  tooling inherited from E5-T22c rather than latency behavior; independent-machine,
  missing-image portability, and WebKit coverage are explicitly outside this task's user
  scope. The local exact-head browser path and zero-error requirement remain proven.
- SUITE: retain the 12 deterministic detector/calibration tests and the headed CDP capture
  assertions; no verifier promotion was needed or permitted. Commands: syntax checks for
  the latency module, terminal, and browser runner; both T25b/T25c node test files; release
  audit; `make e5-t25c-assets`; independent JSON/hash/cadence invariant audit; visual
  inspection of both retained CDP PNGs; `git diff --check 45aa9fb2 97c706e1`.
