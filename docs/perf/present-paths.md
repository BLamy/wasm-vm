# Presentation path measurements

This document is the T06c benchmark record for choosing the first presentation backend. The
benchmark measures the T06a Canvas2D backend and the T06b WebGL2 backend against the same
full-resource `Uint32Array` containing BGRA words. It does not change runtime selection; T06d
owns that integration.

## Method and result schema

The repeatable command is:

```text
node tools/verify/e5-t06c-present-bench.mjs
```

The page emits `present-path-benchmark-v1` JSON. Each run has a browser identity, device-pixel
ratio, visibility state, warm-up count, sample count, and eight cells:

| Dimension | Values |
| --- | --- |
| Resolution | 1280x800, 2560x1600 |
| Backend | `canvas2d`, `webgl2` |
| Workload | `full-frame`, `damage-64x64` |
| Damage rectangle | x=1, y=1, width=64, height=64 |
| Warm-up | 30 frames per cell |
| Measured samples | 300 frames per cell |
| Timer | `performance.now()` around `present`; WebGL also calls `gl.finish()` inside the timed region |

The frame is generated once per cell with a deterministic color pattern. Damage mutation happens
before the timer starts. `copiesPerFrame` is two for both backends: source words to private
staging, then staging into the browser presentation API. Canvas2D's second step is the
`ImageData`/`putImageData` handoff; WebGL2's second step is `texSubImage2D`, with the `.bgra`
channel conversion performed in the fragment shader. Setup, canvas allocation, texture
allocation, shader compilation, and warm-up are excluded from the measured samples.

## Supported local Chromium matrix

The committed run was made on this Mac in Playwright Chromium 131.0.6778.33 at DPR 1. Values are
milliseconds, shown as `p50 / p95` with the mean and standard deviation in parentheses. Every
cell has 300 samples.

| Resolution | Workload | Canvas2D | WebGL2 |
| --- | --- | ---: | ---: |
| 1280x800 | full-frame | 1.740 / 3.025 (mean 1.898, σ 0.442) | 1.275 / 1.545 (mean 1.296, σ 0.126) |
| 1280x800 | damage-64x64 | **0.010 / 0.015 (mean 0.010, σ 0.003)** | 0.060 / 0.070 (mean 0.062, σ 0.046) |
| 2560x1600 | full-frame | 7.205 / 8.940 (mean 7.549, σ 1.359) | 5.075 / 5.685 (mean 5.054, σ 0.470) |
| 2560x1600 | damage-64x64 | 0.010 / 0.015 (mean 0.009, σ 0.003) | 0.220 / 0.250 (mean 0.224, σ 0.013) |

For the acceptance workload, 1280x800 damage, Canvas2D is the measured default: p50 is 0.050
ms lower than WebGL2 (0.010 ms versus 0.060 ms), an 83.333% margin relative to the slower
path. The p50 standard deviations are 0.003 ms and 0.046 ms respectively. Full-frame work at
both resolutions favors WebGL2, so this decision is specifically for the small-damage default
and must not be generalized to full-frame presentation.

T06d should therefore use this measured order for the default workload:

```text
Canvas2D -> WebGL2
```

The fallback is required when Canvas2D context creation is unavailable or fails, or when a
context-loss/upload failure makes the active backend unusable. The failed backend must be
disposed before trying the fallback. This benchmark does not claim that WebGL2 is always faster;
the full-frame measurements show the opposite policy would be wrong for that workload.

## Adversarial profiles

The verifier repeats all eight cells with 300 samples under each profile. The measured default
for the 1280x800 damage pair remained Canvas2D in every profile that completed:

| Profile | Observed state | Canvas2D p50 / p95 | WebGL2 p50 / p95 | Ranking |
| --- | --- | ---: | ---: | --- |
| DPR 2 | DPR=2, visible | 0.010 / 0.015 | 0.060 / 0.070 | unchanged |
| Backgrounded tab | requested, but Chromium headless reported `visible` | 0.010 / 0.015 | 0.060 / 0.065 | not a hidden-tab result |
| CPU throttled | 4x CPU throttle, visible | 0.010 / 0.265 | 0.065 / 0.835 | unchanged |

The background profile is retained as an honest harness result, but it is not evidence about a
hidden document: this headless Chromium session kept the benchmark page's
`document.visibilityState` at `visible` after another page was brought to the front. No hidden
state was faked or substituted. WebKit and independent-machine measurements are outside the
scope of this task. If a future Chromium runner can observe `hidden`, rerun the same command and
append that result before changing the runtime policy.

The machine-readable evidence envelope records the full cells, browser fields, errors, sample
counts, profile observations, ranking comparisons, and the baseline screenshot. The verifier
rejects missing fields, fewer than 300 samples, non-finite timings, and browser errors.
