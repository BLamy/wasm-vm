---
id: E6-T12e3
epic: 6
title: Bound declaration banks and static budgets for the remaining corpus
priority: 525.0269903
status: pending
depends_on: [E6-T12e2]
estimate: S
risk: high
capstone: false
---

## Boundary

Expand only the guarded declaration/storage and static-size boundary needed by
the remaining original inventory: CONST indices through 45, TEMP indices through
117, and a documented instruction budget covering the longest 179-instruction
body. Preserve independent small IN/OUT/SAMP/SVIEW banks. Keep finite text,
token, line, response and allocation limits; justify each changed bound against
the original inventory. ADDR, indirect operands, new instructions and PRECISE
remain rejected. Do not infer an execution bound from static instruction count.

## Deterministic acceptance

`make verify-E6-T12e3` records original inventory maxima and exercises each newly
addressable bank edge with independently authored straight-line shaders, through
native sanitizers, Wasm parity and real ESSL300 compile/link/pixels. Test the
declared final static budget and its first rejected neighbor. Preserve the
12/19 original result; the seven PRECISE-bearing bodies remain rejected.
Record exact-head and pristine-clone evidence.

## Adversarial verification

Attack overflow, aliases between file-specific banks, overlapping ranges,
uninitialized high registers, one-past boundaries, maximum output serialization
and recovery after rejection. A small numeric grammar must not silently widen
every register class.

## Verification log

(empty)
