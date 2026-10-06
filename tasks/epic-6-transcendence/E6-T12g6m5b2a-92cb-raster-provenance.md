---
id: E6-T12g6m5b2a
epic: 6
title: Authenticate original 92cb viewport and raster power-base domain
priority: 525.02701058221
status: evidence-needed
depends_on: [E6-T12g6m5b1]
estimate: S
risk: high
capstone: false
---

## Boundary

Independently bind every original 7bf4/92cb draw's active viewport, framebuffer extent, sample count, and quad geometry to the captured command/resource state. Determine the exact *ideal pixel-center* envelope for the two first pc221/222 `POW` bases, and explicitly reject a portable numeric lower bound without a stated interpolation and arithmetic error budget. This is capture evidence only; neither the translator nor a future renderer DRAW may assume it.

## Deterministic acceptance

`make verify-E6-T12g6m5b2a` replays all 1,957 selected draws and packet/snapshot citations, emits per-bank ideal pixel-center bounds with independently checked original packet bytes, and rejects viewport, sample-count, and bank substitutions. Native/Wasm numerical auditors agree byte-for-byte for all covered framebuffer pixel centers; an independent rational oracle checks their complete output and report fields. Record exact-head command-capture evidence and a pristine clone; submit to a fresh critic. Existing full-original rejection remains unchanged.

## Adversarial verification

Attack signed viewport, clipped edges, multisampling, half-pixel assumptions, center crossings, resource and bank lifetimes, and any ideal center that makes a zero or subnormal base. Verify that the artifact denies numeric compiler authority: an ideal geometric gap does not establish a portable hardware interpolation/error budget. Every cited state must be live at the draw.

## Verification log

### 2026-10-05 — worker — activation

E6-T12g6m5b1's complete quad/bank provenance is verified at `d7e091c9b90a97bb2f4417d29193d372a4e5b3a0`. The original viewport observed at the three first draws is event 648/offset 4844, but that observation alone does not prove its live identity at every selected draw or a half-pixel lower bound. This task will replay that state and either prove the raster domain under a documented precision budget or reject the lower-bound claim.

### 2026-10-05 — worker — implemented

Source head `165dd48e7fc1c63cbac2f5ac917c61a6b10b6a45`. `make verify-E6-T12g6m5b2a` passed at that head; it reran the E6-T12g6m5b1 original quad/bank gate, independently replayed all 1,957 7bf4/92cb draws from authenticated packet bytes and live resource state, matched native and Wasm auditor output byte-for-byte, and checked all six bank/axis envelopes against rational pixel-center arithmetic. The original viewport is event 648/offset 4844 on all draws; all bound color surfaces are ordinary single-sample 1024×768, across 400 framebuffer packets. The ideal-center base minima are approximately 0.5 in banks 0 and 2 and 2.5 in bank 1; bank 1 has no first-power branch centers. Viewport, multisample-resource, and self-hash-adjusted bank substitutions failed their named checks. This is an ideal geometric fact only: the report explicitly denies numeric compiler and production DRAW authority until interpolation/arithmetic precision and draw-time state enforcement are proven in E6-T12g6m5b2b. The full original shader pair remains gated.

Evidence: `evidence/virgl-92cb-raster/worker/recording.tar.gz` SHA-256 `f1ba852a1ae1a6cab12c2ca334da6e174d6976b8410b81750d8007f9bd73dcbb`; `evidence/virgl-92cb-raster/worker/manifest.json` and `records.json` (34 sealed records); hot receipt `target/evidence/virgl-92cb-raster/receipt.json`; scrubbed pristine-clone command `python3 tools/virgl-92cb-raster/cold.py target/evidence/virgl-92cb-raster/cold-exact` passed with empty before/after status at the same head. `make ci` was attempted at this head and stopped in pre-existing macOS `wvseccomp` libc syscall bindings and `clippy::items_after_test_module` in the GPU module; see `target/evidence/virgl-92cb-raster/make-ci.log`. No production runtime or browser code changed.

### 2026-10-05 — verifier — VERDICT: needs-evidence

- PREDICTION original live raster state — HELD. Independently decoded the authenticated `events.jsonl` and packet blobs, compared every `hot/raster.json` draw citation to live state: 1,957 draws, viewport event 648/offset 4844 throughout, 400 framebuffer citations, color resources 21/72 for 1,953/4 draws, depth resource 20 for 1,953 draws, all ordinary 1024×768 `nrSamples=0`. The archive SHA-256 is `f1ba852a1ae1a6cab12c2ca334da6e174d6976b8410b81750d8007f9bd73dcbb`; all 34 indexed records, hot/cold source digests at `165dd48e7fc1c63cbac2f5ac917c61a6b10b6a45`, and pristine cold-clone receipt matched. `make verify-E6-T12g6m5b2a` also passed independently at verifier checkout `02b17470`.
- PREDICTION ideal-center separation — HELD. Independent `Fraction` enumeration of all covered x/y centers from `hot/geometry.bin` reproduced the six `hot/native.out` lines. Minimum bases were bank 0 `(0.5, 0.49999988925072725)`, bank 1 `(2.5, 2.4999997450330977)`, bank 2 `(0.5, 0.49999218401733964)`; all exceed 0.49, with zero branch centers in bank 1. A bank-0 x translation making the zero crossing exactly pixel center 359.5 was rejected by the sealed native auditor (`ideal single-sample center envelope`). A signed x viewport scale was rejected by packet replay, and replacing draw 11's live framebuffer citation (event 5328/offset 4160) with the future event 5431/offset 4160 was rejected. `hot/native-coverage.json` reports 80/80 C lines and 4/4 functions. These results carry forward if the capture, geometry, numerical code and sealed evidence digest do not change.
- SUFFICIENCY complete-bank report — NEEDS EVIDENCE. Predicted an independent checker would reject an incomplete `raster.json` bank inventory. Removing only `banks` from the sealed hot report (`banks: []`, mutated SHA-256 `d7be595623fa5291ccd72af54597689399452bd7cdab13072c8485f6087ad27f`) left the six native/Wasm output lines and all 1,957 packet citations unchanged, yet `python3 tools/virgl-92cb-raster/receipt.py target/evidence/virgl-92cb-raster/verifier-missing-bank` exited 0 and wrote `status: passed`; see `target/evidence/virgl-92cb-raster/verifier-missing-bank/attack.json`. `tools/virgl-92cb-raster/receipt.py:158` iterates whatever bank list is supplied, so zero iterations evade all six rational comparisons. Require exactly three ordered banks and two axes per bank, add a permanent omitted-bank fault, then rerun the touched harness and reseal at its final exact head. The original captured raster claim was not contradicted; this is a proof gap in the claimed complete-output check.
- COVERAGE/SUITE: All changed runtime code is private test tooling; the core packet, numeric, native/Wasm, fault and cold-clone paths executed. Documentation and task metadata are non-runtime. No promoted test until the missing-bank guard and its negative test pass.
