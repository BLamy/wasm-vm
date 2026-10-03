---
id: E6-T12e5
epic: 6
title: Preserve the remaining componentwise float operations and negation
priority: 525.0269905
status: pending
depends_on: [E6-T12e4]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit inventoried plain DIV, MAX, FRC and LRP and captured scalar/source negate
syntax. Preserve opcode operand order, TGSI definitions, consumed lane masks and
modifier ordering. Explicitly enumerate the accepted finite/numeric domains and
the pinned TGSI/WebGL guarantees for each operation. Do not add unused absolute,
saturate or other modifiers incidentally. PRECISE remains rejected.

## Deterministic acceptance

`make verify-E6-T12e5` records native sanitizer/Wasm parity and actual ESSL300
execution using independent expected values: unequal LRP endpoints, negative
FRC arguments, distinct per-lane divisors/MAX operands and negated swizzles.
Use exact binary-fraction pixels where possible and documented bit/ULP limits
where the admitted semantics require them. Test every newly admitted operation
and modifier; preserve previous gates and 12/19 original outcomes. Record
exact-head and pristine-clone proof.

## Adversarial verification

Attack operand reversal, negative FRC truncation-versus-floor, signed zero and
denominator/exceptional-value boundaries only according to the explicit admitted
contract, modifier order and partial writes. Sabotage one operator or negate
application and require an independent oracle failure.

## Verification log

(empty)
