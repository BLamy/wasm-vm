---
id: E6-T12e3
epic: 6
title: Bound declaration banks and static budgets for the remaining corpus
priority: 525.0269903
status: in-progress
depends_on: [E6-T12e2]
estimate: S
risk: high
capstone: false
---

## Boundary

Expand only the guarded declaration/storage and static-size boundary needed by
the remaining original inventory: CONST indices through 45, TEMP indices through
117, and a budget of 179 non-END instructions (the original maximum is 178
non-END / 179 including END, leaving one instruction of headroom). Preserve
independent small IN/OUT/IMM/SAMP/SVIEW/GENERIC banks through index7. Keep finite text,
token, line, response and allocation limits; justify each changed bound against
the original inventory. ADDR, indirect operands, new instructions and PRECISE
remain rejected. Do not infer an execution bound from static instruction count.

This is the v5 shader frontend/storage boundary only. Command constant uploads,
active uniform reflection and renderer restoration remain separately gated by
E6-T12e3b. Preserve the 16KiB text/stage, 8192-token, 256-line, 512-byte line,
64KiB GLSL/stage, fixed response, 16MiB Wasm memory and 256KiB stack limits.
Use canonical bounded decimal register indices without widening the independent
small banks. Preserve truthful upstream declared uniform extents, including the
CONST0-after-CONST45 declaration-order case; no text rewriting or false metadata.

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

### 2026-10-03 — worker — activation

E6-T12e2 is independently verified at
`43113616971d026744c377b6bbe8fb58aa7f7d20`. Original inventory inspection found
TEMP declaration117/direct113, CONST declaration45/direct25, 8800 text bytes,
191 nonempty lines, 80 bytes in one line, and 178 non-END instructions. The
acceptance records a fresh inventory and tests actual use of TEMP117/CONST45,
canonical decimal and file-specific rejection edges, 179/180 instruction
neighbors, both-stage fixed-memory pair recovery, and independent hardware
outputs. Exactly12 of19 original bodies remain accepted. Production stays off.
