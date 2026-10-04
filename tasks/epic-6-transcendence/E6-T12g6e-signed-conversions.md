---
id: E6-T12g6e
epic: 6
title: Admit bounded signed integer and float conversions
priority: 525.027010572
status: in-progress
depends_on: [E6-T12g6d]
estimate: S
risk: high
capstone: false
---

## Boundary

Add I2F/F2I with explicit binary32 rounding and a documented TGSI-defined conversion domain. Preserve typed private/raw shadows and numeric/output provenance. Implement or reject out-of-domain values before any undefined GLSL conversion; no SIN/POW/TRUNC opcode.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6e`: Independent word equations and pinned Mesa differentials for signed endpoints, representable neighbors, ties, fractional truncation, both zero signs and forbidden/nonfinite inputs. Native/wasm and physical GPU source/modifier/lane cases. Bind any required range/typed-bank contract through all synchronous/async consumers; unsafe runtime banks must not issue draws.

Use the narrow affected compiler/consumer gates, record final exact-source native,
wasm and physical hardware proof, numerical source-fault sensitivity, varied
seeds and one pristine clone. Preserve unchanged HELD results. Submit to a fresh
independent critic before any dependent activates.

## Adversarial verification

Predict each stated semantic/domain result before inspecting. Attack signedness,
source and destination versions, liveness, domain ownership/metadata, masks,
boundaries and actual hardware reflection. Run every scoped acceptance angle,
one bounded novel attack and test sabotage; no mock/inverse/self-derived pixel
oracle. Each finding names a report/trace point and digest. Unexecuted runtime
hunks need evidence or deletion; unsupported original paths stay gated.

## Verification log

### 2026-10-04 — worker — activation

Continued the user's guest graphics offload work above independently verified
G6d `7f2cdec8`. Only this S/high conversion boundary occupies the active lane.
Pinned TGSI I2F suggests nearest-even while leaving rounding unspecified; this
profile chooses explicit binary32 nearest-even. F2I truncates toward zero only
for finite encodings below positive2^31 or at most negative2^31. Use bounded
unsigned word helpers and static known-bit range proofs; unknown direct,
unmodified constant operands require exact component-bank range guards before
all sync/async uploads, restorations and draws. Reject other unproven computed,
input or indirect sources. Float source modifiers apply only to range-proven
F2I encodings; integer I2F modifiers remain unsupported. Preserve the fixed IR
layout and all preexisting profile obligations in bounded conversion wrappers.
Integer outputs stay private; explicit I2F results receive normal/zero numeric
and output authority. Record endpoints, rounding ties, fractional truncation,
subnormals/zero signs, masked/swizzled aliases, source versions, joins, physical
words/pixels, changing banks and deliberate rounding/range/source faults. The
complete captured compositors remain gated until their own full-shape range
proof and remaining opcodes. No production imports/caps or MIPS/FPS claim.

### 2026-10-04 — worker — implementation freeze

Added unsigned C/GLSL conversion helpers, static bit-range proofs and direct
constant component obligations without enlarging the fixed IR. Conversion
profiles v29/v30 preserve their entire v1..v28 base metadata. The state renderer
uses one owned complete prefix for base and conversion checks before sync/async
uploads, restoration, index access and draws. Synthetic private browser paths
exercise source modifiers, input words, aliases, joins, masks, changing banks,
actual indexed draws, reflection pruning, held async plans and zero budgets.
The final recording target is `make verify-E6-T12g6e`; its source-only rational
oracle and independent Python binary32 receipt never derive expected pixels
from emitted GLSL. Deliberate rounding/truncation/helper and real range-guard
faults are rejected by those oracles. Pinned Mesa word differentials exclude
float-TEMP NaN/subnormal payload cases; owned evidence retains all defined
words. No production/demo import changes, so the public demo gate is not yet
applicable. Final exact-source evidence and independent verification follow.
