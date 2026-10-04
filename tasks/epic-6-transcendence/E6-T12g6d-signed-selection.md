---
id: E6-T12g6d
epic: 6
title: Admit bounded signed integer comparison and maximum
priority: 525.027010571
status: in-progress
depends_on: [E6-T12g6c]
estimate: S
risk: high
capstone: false
---

## Boundary

Add private raw-word ISLT and IMAX for two’s-complement signed32 semantics. Preserve uint arithmetic, canonical mask words and separate ordinary numeric/raster authority. No float casts or transcendental operations.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6d`: Predict literal masks and selected signed words at INT_MIN/INT_MAX/negative/zero/positive boundaries, lane masks/swizzles/conditional joins and constant-bank ownership. Differential against pinned Mesa integer semantics, native/wasm and independent actual transform-feedback/readback words. Test wrong signedness and winner-source faults; arbitrary raw words must not gain numeric/output authority.

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

Continued the user's guest graphics offload request above independently verified
G6c `04885468`, rather than unrelated E5.5 publication work. Only this S/high
compiler boundary occupies the active lane. The captured compositor uses ISLT
and IMAX on count words in its existing raw constant banks. Add these private
integer operations to the existing v2 integer profile, preserving metadata for
all prior programs and adding no numeric/raster domain grant. Explicit opcode
bits 41/42 avoid feature bit40 and preserve the fixed IR layout. Scope proof to
signed endpoints, masks/swizzles, aliased versions, joins, constant bank ownership,
pinned Mesa semantics and actual physical feedback/pixels. Production imports,
caps and negotiation stay disabled until their own integration acceptance.

### 2026-10-04 — worker — implementation and proof scope

Added the two bounded raw opcodes, portable unsigned sign-bit ordering, exact
source selection and conservative unknown-bit intersections. IMAX drops IN
float locators/domain origin; canonical zero/normal bit facts still supply the
preexisting safe-use policy. No allocation, IR layout, capacity, fixed heap/
stack, numerical contract or production consumer code changed.

Self-validation passes 432 public sanitized native cases, 392 actual pinned
TGSI signed-type/converter witnesses and 432 matching Wasm singles/pairs.
The first physical run passes 31,128 exact carrier words and 9,984 pixels,
including actual bank reflection, masks, aliases and both join predecessors.
The real shared renderer passes both stages' A/B/A replacement/restoration,
caller-byte mutation, sync/async submission ownership, unchanged nonfinite
packet rejection and zero disposal budgets. Wrong-signedness and wrong-winner
emitted-source faults both contradict actual feedback bytes.

The pinned reference has an independently observed limitation: its all-ones
ISLT mask passes through float TEMP and becomes canonical NaN `0x7fc00000`
on this GPU. Original word carriers predicted lower mantissa carrier1065353215
and observed1061158912 at vertex lane5 in the ephemeral Mesa comparison.
The owned emitter preserved the full mask. This is outside the changed owned
boundary: reference programs now explicitly use finite UCMP predicates for
ISLT and normal/zero IMAX selections; alias/masked references also require
normal/zero source words. No emitted reference source is rewritten. All owned
raw results still face the independent full-word BigInt oracle, including
NaN/subnormal encodings interpreted as signed integers. This limitation and
the unchanged guest constant-packet restriction are explicit in the proof README.

Final prescribed gates are the affected C syntax/guard checks, sanitized native
and fixed-memory Wasm compiler paths, prior literal/original/join guards,
three physical seeds and two actual source faults, authenticated receipt and
one pristine scrubbed exact-source clone. Unchanged prior renderer/resource/
capacity proofs remain HELD. No Rust or live web source/import changed.
