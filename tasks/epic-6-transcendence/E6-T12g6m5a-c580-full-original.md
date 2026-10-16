---
id: E6-T12g6m5a
epic: 6
title: Prove the unchanged c580 compositor pair on physical WebGL2
priority: 525.027010581
status: verified
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

### 2026-10-05 — verifier — VERDICT: verified

- SOURCE/BANK — HELD. Predicted literal 403b/c580 packets and three paired banks across 2,271 draws; independently decoded CREATE_SHADER packets at event 5328, offsets 48424/48868, and tracked handles 444/445 through destruction at event 52683. The recorded bank digests, first SET_CONSTANT_BUFFER packet hashes, draw counts 42/2084/145, and complete 12/136-word arrays match the independent packet parse (`evidence/virgl-original-c580/verifier/predictions.json`; `audit.json:22-38`; sealed `hot/banks.json` and `hot/banks.bin`).
- PAIR/REFLECTION — HELD. Predicted complete native/Wasm/browser result identity, 3/34 active `uvec4` uniforms and exact uploaded words. All three JSON pairs match byte-for-byte native/Wasm output and browser results; each of six ANGLE Metal frames reflects `vsconst0[0]`/`fsconst0[0]` as `UNSIGNED_INT_VEC4` of sizes 3/34, with clean compile/link logs (`audit.json:11-12`; sealed `hot/native.out`, `hot/wasm.out`, `hot/browser/report.json` frame reflection). Default admission, positive cap, partial bank, and changed source all reject.
- PIXELS/FAULTS — HELD. Predicted the near-edge top row and left column, far-edge bottom row and right column, 42 white survivors and 54 blue clears, with physical color approximately `[1.00000027, 0.99999986, 0.99999991, 1]`. All 96 RGBA32F pixels agree within `2.71e-7`; discard and output mutations first contradict bank 0 near at `(1,1)` and `(0,0)` (`audit.json:13-20`; sealed `hot/browser/report.json` and `hot/browser-fault-{discard,output}/report.json`). A novel live `vso_g0.x`→`vso_g0.y` GLSL mutation first contradicts `(0,1)` while both shaders link, the browser has zero errors, and resources dispose (`coordinate-report.json:1563`, `coordinate-source.mjs`; SHA-256 of report `6548bdd95963c370b9d721d50e95b898dcd95a128bb37b66a73208e1536d7573`). The recorded vertex transform and `winsys_adjust_y=1` agree with the predicted clip positions.
- COVERAGE/ENV — HELD. The original C harness has 5/5 functions and 60/60 lines covered; the browser oracle ran 96 pixel checks and 42 survivor calculations, while both fault branches and the cleanup path ran across the three browser captures. Uncovered C branch regions are defensive failure exits; the task adds no compiler runtime hunk. Source and generated-binary receipts match the frozen `3d799188` head, and the scrubbed pristine clone passed at that head (`audit.json:39-65`; sealed `cold/report.json`). Existing predecessor HELD results carry forward unchanged. `make ci` stops in unrelated pre-existing macOS seccomp and clippy errors recorded in sealed `hot/ci.log`.
- SUITE: retain `make verify-E6-T12g6m5a` as the recurring physical acceptance target and the verifier's coordinate source fault/report as an adversarial seed. No additional runtime test is needed after the three fault-sensitive physical checks.

Commands: independent capture packet parse and sealed-archive SHA-256/member audit; independent native/Wasm/browser/pixel/receipt audit (summarized in `evidence/virgl-original-c580/verifier/audit.json`); `node target/evidence/virgl-original-c580-verifier/coordinate-browser.mjs` with the recorded live-coordinate mutation; `python3 tools/check_task_policy.py`; `python3 tools/build_queue.py`.
