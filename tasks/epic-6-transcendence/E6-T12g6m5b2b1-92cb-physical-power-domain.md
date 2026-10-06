---
id: E6-T12g6m5b2b1
epic: 6
title: Measure and bound original 92cb first-power inputs on physical WebGL2
priority: 525.027010582221
status: implemented
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

### 2026-10-05 — worker — implemented; awaiting fresh critic

Source head `f9cc0ac20d2f837e8b68c560957f04e82ea8956f`. Commands: `make verify-E6-T12g6m5b2b1`; `python3 tools/virgl-92cb-power-domain/cold.py target/evidence/virgl-92cb-power-domain/cold-f9cc0ac2`; `python3 tools/virgl-92cb-power-domain/seal.py target/evidence/virgl-92cb-power-domain target/evidence/virgl-92cb-power-domain/cold-f9cc0ac2 evidence/virgl-92cb-power-domain/worker`; `make ci` (fails in pre-existing, unrelated Rust workspace Clippy/build errors, including `jit_execution` missing `enable_builtin_sbi`, CLI dead `OsEntropy`, and core GPU `items_after_test_module`). The 100-record sealed archive is `evidence/virgl-92cb-power-domain/worker/recording.tar.gz`, SHA-256 `5d63d9a32cb74ad4d5533a46fb37b1980e3a9c5fbd10f7815ad27a611db7cdf0`; `manifest.json`, `records.json`, and `make-ci.log` (SHA-256 `8f995781700de5869eb4dacaea00d7fb93ea454d9c46ddc4dfa5380fbac22553`) accompany it. Hot receipt `target/evidence/virgl-92cb-power-domain/receipt.json` and cold receipt in `cold-f9cc0ac2/acceptance/receipt.json` name the same source head; the cold report records empty before/after Git status. The browser report stores all four float output words for each of the 1024×768 pixels of all three banks in SHA-bound compressed readbacks; the independent receipt checks all 1,612,644 covered pixels. Branch counts are 16/0/16; observed minimum bases are 0.4999964/2.4999995/0.4999852; maximum rational-to-readback delta gap is 0.0001221, below the stated 0.1 observational budget. Native and Wasm ideal-center outputs match byte for byte; merged C coverage is 84/84 lines and 5/5 functions. Source, bank, negative, nonfinite, geometry, viewport and zero-crossing browser faults and five native faults all reject. This proves the domain for the recorded physical Apple M4 Max draw only; it grants neither a portable future-renderer bound, full original fragment compilation, nor production DRAW authority.
