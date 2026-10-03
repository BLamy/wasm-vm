---
id: E6-T12e4c2
epic: 6
title: Preserve ordinary numeric shader chains with bounded float shadows
priority: 525.026990432
status: pending
depends_on: [E6-T12e4c1]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit existing ADD/MUL/MAD and fragment 2D FLOAT TEX in owned raw-lane programs
with explicit per-lane ordinary float provenance and bounded float shadows.
Snapshot numeric RHS values and their captured raw representations before writes.
Numeric consumers and final float outputs use an authorized original float input
or computed/sample shadow directly. Integer consumers retain raw word semantics;
integer writes invalidate float authority. MOV and UCMP must preserve the correct
views under partial/swizzled aliases. Broader float-origin joins belong only to
the new mixed profile; earlier profiles retain exact outputs and rejections.

Raw numeric inputs need a stated, enforced domain proof at each use, including
dynamic values. Arbitrary raw CONST/TEMP words are not ordinary float authority.
Do not assume standalone shader calls inherit the guest constant decoder's
finite-value check, which also admits subnormals. Keep unknown raw numeric
constants rejected unless this task explicitly adds and proves an enforceable
runtime-domain boundary; otherwise record that limitation before Mesa activation.

Genuine floating computations retain the documented ordinary float contract:
no raw NaN-payload, signed-zero, subnormal or PRECISE preservation promise after
numeric computation. Do not replace undefined numeric behavior with an invented
exact result. Sample TEX once per instruction and publish truthful owned sampler
metadata. Preserve existing float interfaces, raw output safety and finite memory,
text, instruction, register and generated-output bounds. No new numeric opcode,
conversion opcode, modifier, control flow or PRECISE support.

## Deterministic acceptance

`make verify-E6-T12e4c2` records native sanitizer/Wasm parity and actual hardware
numeric and raw consumers. Prove real TEX-to-MUL-to-ADD/MAD-to-output chains with
safe inputs, the same captured lane consumed as integer and float, MOV/UCMP
shadow propagation, invalidation, partial writes, aliases, dynamic operands,
sampler validation and mixed-backend interfaces. Exact small dyadic values and
texture endpoints provide independent finite oracles; non-exact MAD tests use
only justified permitted outcomes. Keep raw comparison tests exact across all
encodings. Preserve unaffected prior gates and all 19 original outcomes. Record
source coverage, fixed-memory failure/recovery, exact-head and pristine-clone
evidence. Production stays off.

## Adversarial verification

Attack stale shadows, lost all-ones masks, aliasing across source and destination,
selected/unselected arm initialization, differing float origins, one authorized
arm mixed with unknown raw data, unsafe dynamic raw inputs, output safety and
sampler metadata. Corrupt shadow propagation or numeric interpretation and
require a real independent hardware mismatch. Audit captured instruction-time
facts rather than trusting final register state. Every changed executable path
needs evidence; arbitrary raw constant admission and PRECISE are not inferred.

## Verification log

(empty)
