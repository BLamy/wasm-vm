---
id: E6-T12f5
epic: 6
title: Execute PRECISE ADD and MUL with explicit binary32 rounding
priority: 525.0269915
status: implemented
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
