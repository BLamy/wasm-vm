---
id: E6-T12f2
epic: 6
title: Prove selected-away interpolation lanes without inventing values
priority: 525.0270002
status: pending
depends_on: [E6-T12f1]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement one bounded observational-definedness family for the captured outer
ELSE/interpolation/final-UCMP forms in 5a243fc7 and a6143f11. On the relevant
predecessor the interpolation operand is unwritten, but the final selector
provably discards its entire result. Preserve predicate/lane versions and
control predecessor identity. Guard or sink the arithmetic so emitted ESSL does
not read the unwritten value on that path. Do not union initialization masks,
zero-initialize missing data, or assume zero times an undefined value is zero.

This does not resolve the separate radial TEMP2.x alternate-root gap. A missing
selected arm or a changed selector must still reject. Preserve runtime/IR/flow
caps and original body identities; PRECISE remains independently gated.

## Deterministic acceptance

`make verify-E6-T12f2` proves independently authored instances of both captured
selection forms with exact words/pixels and checked predecessor traces. Exercise
both defined and discarded predecessors, all destination lanes, aliases and
nested control. Record native/Wasm parity, complete retained outcomes, actual
hardware through the shared renderer and final pristine-clone evidence.

## Adversarial verification

Reverse the final selection, overwrite an aliased selector, change zero to
nonzero, remove one selected lane and insert a NaN intermediate. Sabotage the
demand/certificate check and require an independent poison witness to fail.
Changed arithmetic must execute or have an explicit unreachable-path proof;
no shader-hash allowlist or manufactured initialization is permitted.

## Verification log

(empty)
