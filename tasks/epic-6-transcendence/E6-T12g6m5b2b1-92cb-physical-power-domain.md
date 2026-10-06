---
id: E6-T12g6m5b2b1
epic: 6
title: Measure and bound original 92cb first-power inputs on physical WebGL2
priority: 525.027010582221
status: in-progress
depends_on: [E6-T12g6m5b2a]
estimate: S
risk: high
capstone: false
---

## Boundary

For the authenticated original 7bf4/92cb quad, three paired banks and single-sample viewport, prove or soundly reject a quantitative finite positive-normal-or-zero input domain for pc221/222. The proof must account for interpolation and highp arithmetic error, and compare actual physical WebGL2 values at adversarial center and boundary probes with an independent numeric oracle. This is a private numeric certificate only; it grants no compiler or production DRAW authority.

## Deterministic acceptance

`make verify-E6-T12g6m5b2b1` authenticates the full predecessor capture; runs native/Wasm-identical checks and physical WebGL2 draws for original vertex pc0..8 and fragment pc2,208,215,218..222 arithmetic with complete original bank words; records all input/output words, shader reflection, pixels, renderer identity, source and draw-state digests; independently bounds every covered center under a documented highp/interpolation budget or records a sound rejection. Exercise both active and inactive first-power branches, viewport/edge variants, nonfinite and negative mutations, and source/bank/geometry faults. Record exact-head and pristine-clone evidence and submit to a fresh critic. Ordinary/full original shader rejection remains unchanged.

## Adversarial verification

Attack the interpolation error budget, half-pixel location, viewport sign and extent, quad W and UV, bank/source lifetime, zero crossings, positive subnormals, branch reachability, GPU precision and framebuffer readback. Samples cannot substitute for a bound over every covered pixel center; an ideal-center gap alone fails.

## Verification log

### 2026-10-05 — worker — activation

E6-T12g6m5b2a is verified and proves original draw-state identity plus exact ideal pixel-center envelopes. This task will quantify interpolation and arithmetic uncertainty on the physical WebGL2 path before any compiler exception is attempted. The dependent draw-bound compiler task remains gated.
