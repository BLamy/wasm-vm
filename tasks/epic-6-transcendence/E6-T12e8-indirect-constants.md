---
id: E6-T12e8
epic: 6
title: Admit proven-bounded TGSI indirect constant access
priority: 525.0269908
status: in-progress
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

## Execution notes

Start from independently verified dependency
`d3a57934cab34e62a274996c0a5559ed8db52645`. This S/high boundary combines the
compiler's complete address-set proof with the shared renderer's immutable bank
obligation: neither half alone authorizes a safe indirect read.

Admit one scalar ADDR[0].x and raw integer UARL. Use existing known-zero/known-one
facts to establish a complete conservative set at each indirect source use;
require the unsigned maximum below 46, nonconflicting facts, every possible index
declared, and every consumed component available. Carry address initialization
and facts through both structured predecessors. Unknown or stale bounds remain
rejections; no predicate correlation, generic runtime expression evaluator,
loops or PRECISE is added. The address profile requires an actual indirect read;
bare unused address-register forms may remain outside this bounded profile.

Closed profiles raw-bits-v10/v11 require exactly one `constantAccesses` record of
kind `constant-bank-static-indirect-v1`, with stage, slot0, bank name, declared
count and sorted unique union of all possible indices. Version11 also requires
the existing finite-binary32 constant-domain record; version10 forbids that
numeric contract. Older profiles forbid the new access record. Preserve old
successful compiler results and explicitly inventory any newly admitted negative
fixture or changed unknown-profile diagnostic in successor proof adapters.

For either new profile, require the complete `min(count,46)` vec4 bank prefix
before draw allocation or dispatch, own its immutable words, and ensure reflected
uploads cover every proved index. Version11 validates that same full prefix as
finite. The existing array-identity draw-plan check binds validation to uploaded
bytes; replacing the bank between draws must invalidate any prior approval.
Missing words, index clamping and default zero values cannot satisfy this proof.
A declared extent47 does not authorize guest index46.

Keep instruction/source/output bounds, <=32KiB IR, <=8KiB profile, <=53,248-byte
flow arena, and fixed16MiB Wasm memory/256KiB stack. Any minimal scalar address
state growth must be measured explicitly rather than claiming old layout parity.
Use independent first/interior/last word and pixel oracles, actual compiled source
faults, repeated async schedules, recorded native/Wasm recovery, final exact-source
pristine clone and a fresh adversarial verifier. Production negotiation stays off.

The captured loop bodies remain original-byte rejections. Read-only analysis of
their signed-ISGE count/unsigned address recurrence suggests raw CONST9.x in1..18
as a sufficient later loop domain; that is planning context, not E8 admission or
proof. Primary UARL semantics are described by Mesa's TGSI specification:
<https://docs.mesa3d.org/gallium/tgsi.html#opcode-UARL>.

## Verification log

(empty)
