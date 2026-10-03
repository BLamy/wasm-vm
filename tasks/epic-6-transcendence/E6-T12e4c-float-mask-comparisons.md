---
id: E6-T12e4c
epic: 6
title: Preserve ordered float masks and explicit mixed typed use
priority: 525.02699043
status: cancelled
depends_on: [E6-T12e4b]
estimate: S
risk: high
capstone: false
---

## Execution slices

Replaced by ordered S/high tasks E6-T12e4c1 and E6-T12e4c2. Exact ordered
comparison of raw binary32 words and preservation of ordinary computed float
values are different representation boundaries. The first needs no float
bitcasts. The second needs checked use-site provenance and bounded float shadows
so texture and arithmetic chains do not lose their ordinary float values through
raw storage. The combined scope and production activation gates remain unchanged.

## Boundary

Add FSLT/FSGE and the explicit boundary for existing ADD/MUL/MAD/TEX in raw-lane
programs. A lane is raw storage; each opcode determines its interpretation.
FSLT/FSGE produce exact all-ones/zero masks from ordered binary32 comparisons;
classify NaNs as unordered, both signed zeros as equal, and preserve subnormal/
infinity ordering without depending on lossy float NaN/subnormal bitcasts.
Genuine floating operations retain the documented ordinary float contract and
do not promise raw NaN payload, subnormal or PRECISE preservation after numeric
computation. State any restricted domain explicitly and enforce it, including
dynamic operands. Preserve the existing float interface and integer output safety
boundary. No numeric conversion opcode, new float opcode, control flow or PRECISE.

## Deterministic acceptance

`make verify-E6-T12e4c` records native sanitizer/Wasm parity and hardware VS/FS
execution using an independent raw binary32 comparison oracle and full-bit mask
readback. Cover the same raw lane consumed by typed integer and float operations,
all ordered comparison domains, actual ADD/MUL/MAD/TEX mixed with integer masks,
partial writes, dynamic operands and mixed-backend pairs. Preserve prior gates,
all finite bounds and unchanged19 original outcomes. Record exact-head and
pristine-clone evidence. Production stays off.

## Adversarial verification

Attack positive/negative zero, equal/adjacent finite values, both infinities,
positive/negative subnormal encodings and quiet/signalling NaN payloads. Distinguish
USEQ(+0,-0) from floating equality/order, reverse negative magnitude ordering,
and make every unordered comparison false. Attack lost all-ones masks across a
mixed-use chain and unsafe float outputs. Sabotage ordering or mask encoding and
require independent hardware failure. Do not turn unspecified numeric behavior
into a made-up exact oracle. Audit all changed executable paths.

## Verification log

(empty)
