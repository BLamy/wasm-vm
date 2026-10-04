---
id: E6-T12f5
epic: 6
title: Execute PRECISE ADD and MUL with explicit binary32 rounding
priority: 525.0269915
status: verified
depends_on: [E6-T12f4, E6-T12f4b]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement a bounded GPU integer binary32 backend for ADD_PRECISE/MUL_PRECISE,
with explicit per-instruction rounding and an audited exceptional-value policy.
Use ESSL300 highp uint operations and bounded shifts/normalization; no missing
browser extension, CPU shader evaluation, 64-bit GLSL arithmetic or unbounded
loop. A two-word product from 16-bit limbs can represent the 48-bit significand.
Round-to-nearest ties-to-even is the chosen reference policy; justify its relation
to TGSI's no-result-changing-optimization requirement.

Keep each result as a raw word through exact consumers. Preserve the existing
ordinary floating output/interpolation contract separately. Do not replace a
multiply by zero plus add in original 3f78a90d with a copy, or treat bitcast/helper
boundaries as guaranteed native-float contraction barriers. Keep all caps.

## Deterministic acceptance

`make verify-E6-T12f5` compares actual GPU words in both stages to an independent
exact-rational/SoftFloat oracle across normal/subnormal transitions, cancellation,
halfway-even/odd, wide exponent gaps, overflow, signed zeros and admitted specials.
Execute the unchanged 3f78a90d original and contraction-sensitive chains, including
0x3f800001 * 0x3f7ffffe + 0xbf800000 with separate rounding. Record native/Wasm
parity, maximum helper/output bounds, prior leaves and final pristine clone.

## Adversarial verification

Sabotage sticky/round bits, carry/normalization, zero signs and intermediate
rounding. Require independent GPU failure; optional driver contraction alone is
not a deterministic sabotage. Attack shift0/31/32+, all product carry paths,
modifier order, aliases, conditional bank/output authority and mixed exact/native
arithmetic. Every changed helper branch needs execution or a bounded proof.

## Verification log

### 2026-10-03 — worker — activation

The owned-bank raster boundary is independently verified at
`b5cfbb33c290f352437b00a2112500d68ee8ae87`. Implement one bounded
binary32 ADD/MUL backend in highp ESSL300 integer operations. Use explicit
nearest-even rounding per instruction, gradual underflow, signed-zero rules and
canonical quiet NaN for NaN inputs and invalid operations. Reject the unsupported
LEGACY_MATH_RULES property. Keep exact internal words separate from existing
numeric access and ordinary output authority; combined finite/indirect/count/
radial/raster/word-PRECISE obligations remain mandatory.

Record actual bits in both GPU stages against an independently rounded rational
reference, including the untouched last original and contraction-sensitive
chains. Test aliases, masks, absolute-then-negate modifiers, all shift classes,
normalization/carry/sticky/rounding paths, output authority, full native/Wasm
retention, bounds, source faults and a final pristine clone at the frozen head.
Use the narrow compiler/reference/consumer/GPU checks while implementing, then
one complete scoped high-risk acceptance recording and fresh independent
verification. No production guest GPU advertisement or desktop MIPS claim is
made by this isolated compiler boundary.

### 2026-10-03 — worker — recorded submission

Runtime implementation `a68be602`, mixed-raster/branch coverage `fefe9b29`, and
final frozen compiler/harness source
`7e444f2e3523b5b46b4aedbff3ace0c409ff6a83`. The final pristine-clone canonical
acceptance is also the worker happy recording. No producer or runtime changed
while it ran. `make verify-E6-T12f5` passed in that scrubbed detached clone, clean
before and after. The direct command was:

```
python3 tools/virgl-precise-arithmetic/cold.py \
  --output target/evidence/virgl-precise-arithmetic-worker-cold-final
```

The clone ran `make verify-E6-T12f5` with the pinned Emscripten 4.0.22 setup, native
ASan/UBSan plus LLVM counters, complete native/Wasm API recordings, independent
rational reference/consumer checks, three real Chrome/Metal hardware schedules,
six compiled GPU-helper source faults, retained mask/word-PRECISE/equality/
selected/radial/raster hardware leaves and their promoted regressions, upstream
allocation checks and the strict receipt reader. `evidence/virgl-precise-arithmetic/
manifest.json` binds the lossless worker/cold archives, complete file inventories,
actual native/Wasm replay artifacts, copied receipts, clean-clone report and
hardware screenshot. Archive members were streamed and compared with every
original file's size and SHA-256, then original inventories rechecked. All files
are preserved, including fault compiler sources/builds and raw pixel arrays.

The recording demonstrates explicit GPU integer ADD/MUL rounding in both stages,
including specials, signed zeros, gradual underflow, cancellation, ties, all
exponent-gap classes and all 23 subnormal leading-bit positions. Each schedule
executes 25 rigs/2,955 ordinary or exact-observer draws, checks 11,760 exact private
words and 378,240 physical pixels. Its separate unchanged-input branch observer
adds 1,544 draws / 197,632 pixels and observes all 39 helper markers in each stage.
The unchanged exact-word run is never replaced by the instrumented observer.
The independent BigInt rational oracle brackets adjacent binary32 values and
rounds by distance/parity, rather than repeating GPU jam/alignment/limb logic.
The contraction witness separately rounds to 0 while a fused evaluation gives
0xa8800000. Six isolated actual helper changes independently fail a physical
word/pixel oracle: sticky, halfway-even, limb carry, normalization, zero sign and
intermediate rounding. Partial writes, aliases, swizzles, absolute-before-minus,
conditional paths, all 27 combined base profiles and mixed xy arithmetic/guarded
zw raster copies retain their certificates. The consumer rejects 6,461 forgeries,
owns 265 contract snapshots and checks 65 combined obligations without evaluating
caller getters.

Native records 1,589,060 calls over 5,101 singles, 1,116 pairs and all 19 original
bodies: 800,358 single/774,540 pair recoveries, 3,128 truncations, 324 hostile inputs,
4,096 seeded mutations and 260 total allocation failures, including 240 owned
and 20 upstream failures. All 19 originals translate unchanged. Wasm records 74,716 calls, including
full native single/pair/original equality, 64 maximal-input calls, 82 actual fixed-
heap pressure calls and complete recovery with the same 16 MiB backing memory.
IR 26,480/profile 7,616/flow 52,644 byte bounds are unchanged. The helper strings
measure 4,107 bytes below 8,192; maximum stage GLSL remains 58,201 below 65,536.
The explicit migration ledger changes 10 retained singles, 4 pairs and 1 original;
all unrelated 4,816 prior singles / 851 prior pairs retain their exact results.

The initial fefe9b29 warm/cold recordings passed runtime checks but their receipt
reader omitted the existing complete upstream allocation-error response for a
paired pressure attempt. The one-line reader repair changes no production code.
The final exact-source clone above proves the corrected reader and full accepted
recording. Its diagnostic is retained at
`evidence/virgl-precise-arithmetic/diagnostics/initial-receipt-gap.log`; ephemeral
in-memory reader replays are not submitted as exact-head evidence.

This slice executes original 3f78a90d with its MUL_PRECISE-by-zero and ADD_PRECISE
intact; no source substitution or copy shortcut. Full 19-body hardware closure
remains E6-T12f6. Exact private words do not grant numerical/raster authority;
ordinary float outputs/interpolation retain their existing narrower promise.
No production guest 3D negotiation, full desktop offload, MIPS/FPS or deployment
claim is made. Fresh independent verification is required before `verified`.

Archive SHA-256: worker `969c7d275f2cfdb3375fac1768f26a2cb7d8285628b3a4e73bb10d6a82e4d559`; cold `11a17d13128501bd809665619db32bc6c3d8264a1814534b0828b2fc46761c07`. Final receipt SHA-256: `43485e0d1874ba1ba225eac7ec840672d4104cd79e68b24fdae64ad12e2f848f`.


### 2026-10-03 — fresh verifier — VERDICT: verified

VERDICT: verified

- P1/P2 exact rounding and exceptional policy — HELD. Before inspecting the recording, predicted separate contraction result 00000000 versus one-round a8800000, signed-zero/tie/subnormal/overflow/canonical-NaN behavior and exact private words in both stages. A separately written Python integer-ratio quotient/remainder oracle (bit-length quantum, no GPU jam/limbs or worker neighbor search) agrees with 13,896 final reference words and every 35,280 physical word / 1,134,720 pixel across all three final hardware schedules. Citation: verifier `final-cold-audit.json`, `recording.tar.gz:audit.py`, and worker `gpu*/report.json#/acceptance/rigs/*/draws`; receipt digest `43485e0d1874ba1ba225eac7ec840672d4104cd79e68b24fdae64ad12e2f848f`.
- P3/P8 helper coverage and bounded arithmetic — HELD. All 61 executable changed C lines have positive LLVM counts; the other 10 are comments/include/declaration/whitespace and are waived. Actual GPU flags hit all 39 source markers in each stage. Fresh seed 0xd6316ac7 plus 165 new limb/cancellation/underflow/gap vectors checks 26,448 words / 846,336 pixels; right-only infinity, same-sign infinity, swapped zero, overflow-midpoint and half-subnormal neighbor inputs add 13,368 / 427,776. Citation: `recording.tar.gz:novel-gpu/report.json`, `condition-gpu/report.json`, `changed-c-lines.json`, `evidence-points.json`; `coverage.md` provides explicit uint32 limb/shift/exponent bounds and waives only unreachable jam-zero-value and ADD-26-cap edges by bounded call-graph proofs.
- P4 asymmetric authority and combined domains — HELD with supplemental proof. The worker recording lacked float_mode(a)=true / float_mode(b)=false at raw_bits.c:255. Fourteen fresh instrumented native calls match exact Wasm results and cover left true/false 48/48 and right 16/32. Private output, multiplication/addition-by-zero shortcuts and derived private-bank raster lanes are rejected. v28/v27 erasure/getters fail; numerical xy and certified copied zw retain separate masks. Citation: verifier `native-authority-report.json#/branchPoint`, archive TGSI/stdout/profiles/binary/source/tool bindings, `authority.json`, `consumer-coverage-audit.json`. All new consumer executable lines have V8 counts; 265 contracts/6,461 forgeries/265 owned snapshots/65 combined checks preserve zero getter calls. Prior unchanged F4b guard/explicit-link outcomes are carried forward.
- P5 unchanged original, retention and caps — HELD. All 19 source hashes agree; only the explicit 10 singles/4 pairs/1 original admission migrations differ. Actual 3f78a90d compiler/GPU source retains four lane calls each to raw_precise_mul by zero and raw_precise_add; no copy shortcut. The strict reader reconstructs native/Wasm parity, fixed 16 MiB memory, 179-instruction/text/output limits and prior leaves. Helper 4,107 <= 8,192 bytes; IR 26,480, profile 7,616, flow 52,644 and maximum stage GLSL 58,201 remain within unchanged caps. Citation: `recording.tar.gz:original-source-point.json`, worker native/wasm transcripts, `receipt-replay-audit.json` and submitted receipt. Full 19-body hardware closure belongs to E6-T12f6.
- P6 actual faults and regression sensitivity — HELD. Each of six compiled helper faults has a literal physical pixel mismatch, not a generic browser failure; source/header/Wasm/build/report bindings agree. A seventh isolated source fault unconditionally grants precise-arithmetic output authority and the promoted regression fails at `private output/vertex` (actual true, expected false). A one-bit expectation sabotage fails at actual pixel (0,0). Citation: `evidence-points.json` names each worker fault point; archive `authority-source-fault/manifest.json`, `promoted-sabotage.log` and `expectation-sabotage/report.json#/acceptance/rigs/0/draws/0/failure`.
- P7 recording sufficiency and pristine source — HELD. Independently streamed every 1,096 worker / 1,098 cold archive member and checked all 1,096 final acceptance file digests, original bodies, source/tool/browser/pixel identities and clean clone states. Unmodified exact-clone receipt assertions replay to byte-identical submitted receipt; only the output destination was redirected, without waiving a check. Citation: verifier `archive-audit.json`, `final-cold-audit.json`, `receipt-replay-audit.json`; frozen source `7e444f2e3523b5b46b4aedbff3ace0c409ff6a83`. No runtime or recording changed during review.
- Submission accounting — corrected, HELD. The initial prose claimed 260 owned faults plus 20 upstream; final native `allocationFaults` contains 260 total = 240 owned + 20 upstream. The worker corrected only task/evidence prose at `187b432e204f3230545235cc1ea4b4ccf5dd6b56`; runtime, recording, reader equations and HELD predictions are unchanged. Citation: archive `count-correction.json` and final `native/native-report.json#/allocationFaults` / `#/stats`.
- SUITE — promote `renderer/virgl-command/tests/precise-arithmetic-verifier-regressions.mjs`; direct execution passes and a real authority source fault fails it. Preserve the independent lattice/oracle/physical recordings as a golden evidence fixture. Configuration, documentation, lifecycle fields and bounded diagnostic/error-only producer controls are waived as non-runtime; every changed runtime hunk is exercised or bounded in `coverage.md`. No outstanding refutation or proof gap remains in this task's scoped claim. Guest negotiation, desktop offload, MIPS/FPS and deployment remain unproven here.

Commands: independent `audit.py` and `audit-archives.py`; two fresh `browser*.mjs` hardware captures; independent authority/consumer V8 checks; fresh ASan/UBSan CLI compilation and `audit-native.py`; source-fault Wasm compilation and promoted regression/sabotage; exact-clone receipt assertion replay. Full source/commands/results/counters are in the 290-file verifier recording; no unrelated full-gauntlet rerun. Verifier archive SHA-256 `e4e95dd6b1ae7f84b9c2b3dc4de6292a459914ccc47318e6c992e96b6356ac7d`, manifest `evidence/virgl-precise-arithmetic/verifier/manifest.json`.
