---
id: E6-T12e8
epic: 6
title: Admit proven-bounded TGSI indirect constant access
priority: 525.0269908
status: pending
depends_on: [E6-T12e7]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit the inventoried ADDR[0].x, UARL and CONST[ADDR[0].x] forms. Preserve exact
TGSI unsigned address interpretation and constant-bank identity. Every admitted
address must have a proved bound, either established statically or validated
against the immutable uniform data used by the same draw. A static token count
does not establish an address bound. Do not clamp, wrap, substitute zero, or
silently drop an out-of-profile access. Reject unsupported address forms before
GPU dispatch. Keep loops and PRECISE rejected.

Bind the complete proved dynamic address set and its finite numeric domain to
the same immutable draw snapshot. Address validity is independent of numerical
validity. Missing guest words, zero defaults, index clamping, or checking only
one observed index cannot establish this proof.

## Deterministic acceptance

`make verify-E6-T12e8` records native/Wasm parity and hardware pixel/bit oracles
selecting distinct first, interior and last constant entries. Include negative
admission cases and, if draw-time constraints are used, evidence that validation
and dispatch bind the same uniform bytes/generation across updates. Preserve
12/19 original outcomes; all PRECISE originals remain rejected. Record exact-head
and final pristine-clone proof.

## Adversarial verification

Attack an unwritten ADDR lane, first/last/one-past indices, UINT32 boundary values,
undeclared ranges, wrong constant buffers and mutable-uniform TOCTOU. Any invalid
access must fail before dispatch, with no partly changed draw state. Sabotage the
address bound or uniform-generation check and require rejection/oracle failure.

## Verification log

(empty)
