---
id: E6-T12e4
epic: 6
title: Preserve straight-line TGSI 32-bit integer and mask semantics
priority: 525.0269904
status: cancelled
depends_on: [E6-T12e3b]
estimate: S
risk: high
capstone: false
---

## Execution slices

Replaced by ordered S/high boundaries E6-T12e4a, E6-T12e4b and E6-T12e4c.
The pinned converter stores integer results in float TEMP registers, which cannot
promise every raw32-bit value under ESSL300. An owned raw representation and
explicit float-IO policy must be proven before arithmetic/masks and mixed use.
The original opcode family remains the combined scope of these replacements.

## Boundary

Admit the inventoried straight-line operations AND, OR, NOT, ISGE, USEQ, USNE,
UCMP, UADD, SHL and USHR, plus the float-to-mask comparisons FSLT and FSGE.
Preserve per-opcode signed/unsigned/untyped interpretation of raw 32-bit register
lanes and UINT32 immediates. Integer bit patterns must not pass through numeric
float conversion or the current finite-float immediate predicate. Comparison
results and UCMP tests must follow pinned TGSI semantics, including all-ones
masks and per-component selection. No UIF, loop, ADDR, indirect or PRECISE yet.

## Deterministic acceptance

`make verify-E6-T12e4` uses independently authored shaders and an independent
integer reference oracle, preserving expected raw bits through RGBA byte encoding
or another lossless browser readback. Require native/Wasm parity and hardware
execution for every admitted opcode, including the same raw lane interpreted by
different typed operations. Preserve the 12 accepted originals and seven
PRECISE rejections. Do not create test inputs by stripping PRECISE from originals.
Record exact-head and pristine-clone evidence.

## Adversarial verification

Attack 0, 1, 0x7fffffff, 0x80000000 and 0xffffffff; wrapping add; specified shift
boundaries; signed versus unsigned comparisons; noncanonical true masks;
per-lane UCMP and source swizzles; initialized-lane accounting and mixed float/
integer use. Audit undefined/out-of-profile operand domains before claiming an
oracle. Sabotage a bitcast, mask or signed comparison and require failure.

## Verification log

### 2026-10-03 — worker — decomposed before activation

Read-only source/spec audit identified independent storage, arithmetic and mixed
comparison boundaries. This planning container never entered the active lane.
See the replacement task files for independent acceptance commands and scopes.
