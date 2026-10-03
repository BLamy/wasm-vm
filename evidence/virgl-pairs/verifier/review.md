VERDICT: verified

Independent critic for E6-T12e2; no implementation work. Reviewed task and diff
before evidence. Initial predictions remain byte-identical (SHA-256
4d2edf5971eafebbf73dfe527077673907252a1ffea56af40b51888107150ba1).
Frozen source:8b7106488b84c256cae7f4eae87eee16a4f09eee;
worker claim:09e923695edd77d2b0500e3e81ce7cabfcc60835.

## Predictions

| Prediction | Result and concrete evidence |
|---|---|
| P01 exact originals | HELD. native.json `original-*` records and binding-audit.json: unchanged19 identities, exactly12 accepted; all7 PRECISE rejected. Both original67c701fa... copies remain unchanged. |
| P02 CONSTANT grammar | HELD. native.json bad-mode/bad-decl/vertex-constant and1,024 independent seeded mutations; structured rejection plus exact recovery. |
| P03 checked interpolation | HELD. native map/mixed/unused-vertex-interface outputs;224 browser pair comparisons; GPU `unused varying remains smooth` exercises unmatched vertex output on actual renderer. |
| P04 semantic rather than register identity | HELD. Independent cross-product/mixed native admission/key oracle and corresponding Wasm parity; worker mixed actual-pixel records independently reconstructed by binding audit. |
| P05 component coverage/duplicates | HELD. Native map-* masks3/7/15 plus missing-producer, duplicate semantic and invalid-later-instruction cases; worker missing/components renderer link rejects before allocation. |
| P06 canonical keys | HELD. Native independently sorted keys for empty/single/multiple semantic interfaces, shuffled physical slots and both modes; actual program keys checked in binding audit. |
| P07 closed request surface | HELD. gpu.json strict12 hostile objects, no getter calls, own symbol/nonenumerable/prototype fields, revoked Proxy/reflective throw and bounded nested reflection with exact inner/outer results. Worker19 negatives also bound. |
| P08 bounds | HELD. Native per-side/both16384accept/16385reject, NULL/SIZE_MAX, byte errors; Wasm same outcome/code; worker frozen instruction/register/token bound regressions and allocation controls retained. |
| P09 response ownership | HELD.8,187 independent sanitized calls:2,729 cases each followed by exact pair and single recovery; no error exposes partial stages. Browser128 alternating calls leave earlier result unchanged. |
| P10 upstream/value ownership | HELD with narrow trusted-defense waivers. Source uses fixed-value fs_info, sequential token/text workspaces, zero-initialized owners and common cleanup. ASan/UBSan clean;19 additional exact-source defensive checks. See coverage-review.md for OOM/upstream diagnostic limits. |
| P11 original flat pixels | HELD. gpu.json `unchanged original fragment direct`, `first flat` at(3,3),(6,3),(3,6) all[0,0,255,255]. Actual translated stages; independent predicted RGBA triangle. |
| P12 actual renderer pair path | HELD. GPU event records show real shader/program allocations, link and indexed draws; bridge gets literal TGSI texts, pair variant used for flat. |
| P13 reuse | HELD. First smooth and flat have distinct native IDs; eight alternating warm phases retain strict object identity and budgets without another pair compile. Each phase checks all three literal pixels. |
| P14 generations/owners | HELD. Independent fresh fragment generation before each fault, same numeric context2 after destruction, subcontext7 versus default, surviving context1. Worker bound public handle replacement/multiple generation records audited. |
| P15 malformed trusted compiler | HELD. Independent wrongkey/fragmentbytes/version/oversizedGLSL/outputname, plus worker missingpair/type/mask/qualifier; each rejection leaves exact snapshot/native counts unchanged and valid recovery draws. |
| P16 allocation/quota unwind | HELD. Independent createShader/compile/createProgram/link/createBuffer/reflection controls unwind; worker exact/one-byte-short variant quotas and program ownership records checked. |
| P17 lifetime | HELD. Worker bound/unbound deletion and renderer-first teardown, independent unbound deletion/subcontext/context destruction and store-first disposal. Independent98 native objects all `is*` false; every budget zero. |
| P18 immutable retained state | HELD. External returned pair source/metadata mutation followed by warm link/pixel checks cannot alter retained program; selector translations are frozen. |
| P19 mixed/constants/samplers | HELD. Independent native mixed permutations and pair source/metadata parity; helper reconstructs all worker direct/mixed/texture/constant anchor bindings and520literal pixel checks; prior single-stage textured oracles retain exact readback hashes. |
| P20 sabotage | HELD. Native isolated fragment-key omission changes flat output qualifier. Hardware stale smooth-program injection executes program11 while requested flat program14 is linked; first-flat pixel(3,3) expects[0,0,255,255], observes[128,64,64,255]. gpu-sabotage.json records intended failure. Shared sources untouched. |
| P21 old oracles/scope | HELD. Frozen same-source nine literal draws/4,336pixels; captured shader phases/768; components10/4,736; prior original210packets/3draws/768 and full unchanged state/resource/decoder controls. No Rust/default web changes; production remains off. |
| P22 provenance/coverage | HELD.26,611 independent binding checks; all156 sources/61 records per receipt and67 cold files match, retained exact-head clone still clean. Native exported counters + actual V8 counters and narrow waivers are in coverage-review.md. |

## Independent execution

- Native2,729 cases,8,187 calls with2,729 pair and2,729 single exact recoveries;
 1,024 mutations with original prediction seeds0x00e612e2/0x47c033a9. ASan/UBSan
 stderr empty. Native source sabotage separately built under ignored target/.
- Actual Chrome154/ANGLE Metal Apple M4 Max:944 assertions,224 selected pair
 native/Wasm comparisons,28draws/84 literal pixel checks (one direct original
 pair and27 actual renderer draws);11 distinct fault controls followed by real
 recovery draws. All console/page/request errors empty. Visually inspected
 gpu.png with smooth and flat frames retained before teardown.
- The native/JS rejection message prose differs for NUL because JS rejects before
 C; the initial independent parity check over-specified prose. The preserved
 harness-calibration.json shows that harness-only correction. Accepted results
 still use exact full-object parity; failures require identical structured code.
 No product failure was reclassified or hidden.
- Source-bound C coverage reports403/416 total lines,168 added lines of which130
 have measured regions and38 are structural/comments/signatures. Defensive
 supplement exercises impossible upstream metadata and escaping. Seven residual
 condition outcomes receive explicit narrow waivers, not a100%branch claim.
 Worker+independent CDP has no unhit changed state/index ranges after supplement.

Commands from repository root:

```sh
python3 evidence/virgl-pairs/verifier/build-native.py
python3 evidence/virgl-pairs/verifier/native-attacks.py
python3 evidence/virgl-pairs/verifier/build-defensive.py
node evidence/virgl-pairs/verifier/run-gpu.mjs
node evidence/virgl-pairs/verifier/run-gpu.mjs stale-flat-program
python3 evidence/virgl-pairs/verifier/coverage-audit.py
python3 evidence/virgl-pairs/verifier/js-coverage.py
python3 evidence/virgl-pairs/verifier/binding-audit.py
python3 evidence/virgl-pairs/verifier/final-audit.py
```

SUITE: retain these deterministic independent fixtures, seeds, browser oracle,
source mutation, and exported coverage as replayable verifier artifacts. Keep
compiled native objects/binaries/profiles under ignored target/. Keep the frozen
permanent make verify-E6-T12e2 target. No semantic gap remains in this bounded
pair/link slice; no compositor/Mesa/guest transport/FPS/PRECISE claim is added.
