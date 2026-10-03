---
id: E6-T12e4c1
epic: 6
title: Preserve ordered binary32 comparison masks over raw words
priority: 525.026990431
status: in-progress
depends_on: [E6-T12e4b]
estimate: S
risk: high
capstone: false
---

## Boundary

Add FSLT/FSGE to the owned raw-lane backend using only integer classification and
ordering of binary32 encodings. Both operations produce exactly all-ones or zero.
Every signed quiet/signalling NaN is unordered; both signed zeros compare equal;
negative magnitude ordering reverses; all infinity and subnormal encodings retain
their order. Do not implement these operations with lossy float bitcasts.

Select a new v3 stage profile only after a new opcode passes full validation.
Preserve the existing IR allocation, instruction, bank, input/output and fixed
Wasm bounds; existing v1/v2/v5 results remain exact for inputs without a newly
admitted opcode. Preserve lane initialization, masked/swizzled aliases and the
raw-to-float output guard. An IN operand means the bits actually delivered by the
float interface, not a new raw payload guarantee across that interface. Numeric
ADD/MUL/MAD/TEX mixed use, PRECISE and control flow remain gated.

## Deterministic acceptance

`make verify-E6-T12e4c1` records native sanitizer/Wasm parity and actual hardware
VS/FS execution with an independent raw binary32 oracle and complete 32-bit mask
readback. Cover every ordered domain, same bits consumed by integer and floating
comparisons, dynamic operands, partial writes, aliases and mixed v5/v1/v2/v3
smooth/flat full and partial interfaces. Retain all unaffected earlier results
and browser gates; explicitly bind any newly supported historical input and its
adjacent unsupported replacement instead of weakening old receipts. All 19
originals stay unchanged. Record source coverage, bounded failure/recovery,
exact-head evidence and a pristine-clone run. Production stays off.

## Adversarial verification

Attack positive/negative zero, equal/adjacent positive and negative normals,
smallest/largest subnormals and the normal boundary, both infinities, and signed
quiet/signalling NaNs with varied payloads. Contrast USEQ on signed zeros with
ordered comparisons, and ensure FSGE is not a bare complement of FSLT on NaNs.
Require exact all-ones masks through integer operations and selection. Attack
missing consumed initialization, source aliasing, unsafe raw float outputs,
profile contamination and output bounds. Corrupt unordered handling, signed-zero
handling or negative ordering and require independent actual GPU failures. Audit
all changed executable paths and preserve applicable prior verifier results.

## Verification log

(empty)
