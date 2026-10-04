---
id: E6-T12f5
epic: 6
title: Execute PRECISE ADD and MUL with explicit binary32 rounding
priority: 525.0269915
status: in-progress
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
