---
id: E6-T12g6m5a
epic: 6
title: Prove the unchanged c580 compositor pair on physical WebGL2
priority: 525.027010581
status: implemented
depends_on: [E6-T12g6m4c]
estimate: S
risk: high
capstone: false
---

## Boundary

Prove the complete literal 403b0529/c5806d5f vertex/fragment pair under all three authenticated paired slot-zero banks observed across 2,271 draws. Bind exact source and packet identities. Exercise full-source branch, polynomial, coordinate, and discard paths with a handwritten independent pixel oracle. This is private compiler/physical GPU evidence, not guest DRAW replay, live GPU negotiation, or a speed claim. Do not widen source admission or default caps.

## Deterministic acceptance

`make verify-E6-T12g6m5a` records native/Wasm byte-identical full-pair translations, complete metadata/reflection, and physical WebGL2 rendered pixels for all three banks at both near and far discard edges. It checks branch/discard and mathematical output against independent equations and proves source-fault sensitivity. The unchanged nineteen plus G6a corpus and existing HELD assertions hold. Record one final exact-source run and one pristine clone; submit sealed evidence to a fresh critic.

## Adversarial verification

Predict actual constant-bank words, active uniform layout, survivor pixels, discarded pixels, and resulting color before inspecting the recording. Attack bank/source identity, signed viewport or interpolation, wrong coordinates, branch and output faults, cancellation/disposal, and stale build results. Compare native/Wasm complete results and faulted hardware output. Every changed runtime hunk must execute or be justified; no generated GLSL or self-derived pixel oracle.

## Verification log

### 2026-10-05 — worker — activation

The prerequisite E6-T12g6m4c is independently verified at `379c8707d792cffbfd9dbd326adbe093aee8f0dd`. Initial read-only exact-bank replay found 2,271 original draws and three paired banks (12 vertex and 136 fragment words); the unchanged pair translated and linked on hardware under each. The exploratory draw is not the final acceptance proof.

### 2026-10-05 — worker — implemented claim, awaiting independent critic

Frozen source head `3d79918858975d1f44f6da2145930acc1660f23e`. `make verify-E6-T12g6m5a` passed at that exact head, then `make verify-E6-T12g6m4c` and `make verify-E6-T12g6m3c` passed as predecessor and paired-interface regressions. The final pristine-clone command `python3 tools/virgl-original-c580/cold.py target/evidence/virgl-original-c580-cold` passed on the same head. Evidence is sealed in `evidence/virgl-original-c580/worker/recording.tar.gz` (SHA-256 `b0e6a1d568612aa9befbe53c5cb3130d246018ad4778b5ca5eb4926ed4e9ba99`) with `records.json` (SHA-256 `e6962f9217d359f2339ce107ca3144b228d9346e49ed7f252b492f1285379517`) and `manifest.json`. The archive carries exact-head source/binary receipts, complete native/Wasm pair JSON, three source-authenticated banks from 2,271 original DRAWs, physical ANGLE Metal WebGL2 logs/reflection, 96 raw float pixels across near/far edge cases (42 survivors, 54 discards), full-source handwritten color/coordinate oracle comparisons, and two deliberate GLSL source faults that contradict the pixels. Default pair admission and positive-cap/partial-bank/altered-source negatives remain rejected. This proves the private complete c580 pair for the tested authenticated banks and constructed geometry; it does not prove all possible live guest DRAW state or MIPS improvement. `make ci` was attempted and fails before this path on existing macOS-incompatible `crates/wvseccomp` syscall constants and existing `clippy::items_after_test_module` in untouched `crates/core/src/dev/virtio/gpu/mod.rs`; its log is included in the archive.
