---
id: E6-T12f1
epic: 6
title: Implement raw FSEQ and FSNE masks without changing precision semantics
priority: 525.0270001
status: pending
depends_on: [E6-T12e9]
estimate: S
risk: high
capstone: false
---

## Boundary

Add only undecorated FSEQ/FSNE. Compare raw binary32 encodings with ordered equality
and unordered inequality: both zero signs are equal; any NaN makes FSEQ false and
FSNE true. Results are exactly zero or all-ones. Preserve consumed-lane checks,
RHS snapshots, unknown NaN self-comparisons and computed numeric raw snapshots.
No lazy input, PRECISE, source-modifier or output-authority relaxation.

Use explicit 64-bit opcode masks. Pure equality may use closed unconditional
profile13 only after the existing loop, indirect, structured and finite-bank
obligations have selected their profiles. Raw comparisons never manufacture a
numeric-bank dependency. The consumer recognizes the exact new profile and
forbids every domain/access/count record on its unconditional shape.

Keep all original bodies/results at 12/19. Exactly eight former negative integer/
float fixture cases named still-unsupported-FSEQ/FSNE in both stages now succeed;
bind each unchanged body hash and old/new full result explicitly. The two raw
reject-mixed-FSEQ cases remain unsafe direct-output rejections. Other retained
full results remain exact. Historical fixtures/validators stay unchanged; use
explicit successor recorders for the two old leaves whose obsolete expectations
would stop before GPU probes. Keep their independent GPU probe bodies/oracles
source-bound, and never claim those historical whole gates passed.

## Deterministic acceptance

`make verify-E6-T12f1` records native sanitizer/Wasm parity, raw equality hardware
words in both stages, all eight unchanged migrated bodies as GPU positives,
computed-shadow/alias/partial-lane cases, mixed profile7–13 obligations and
immutable-bank behavior. Independently classify exceptional words without
floating conversion. Preserve measured storage/runtime caps, recover after
errors/allocation pressure, run exact-source recording and final pristine clone.

## Adversarial verification

Attack signed-zero order, signaling/quiet NaNs and payloads, same-word NaN,
subnormal versus zero, infinities, source aliases and unwritten selected lanes.
Sabotage NaN handling, zero equivalence, FSNE complement and all-ones masks in
actual compiler source; require independent GPU failures. A known-fact admission
fault must be caught before unsafe GPU submission. Audit the eight expectation
migrations and genuine unknown-v14/forbidden metadata cases.

## Execution notes

Begin after verified E9 `80813f4e45202cec3769d51b4f7d2b421034df01`.
Use its final cold native report as the bound full-result baseline. Add opcodes
33/34 and a separate raw integer equality helper; retain the old ordered-mask
helper and all old successful emitted GLSL verbatim. Fold only fully known
operands; never fold unknown self-comparisons without a non-NaN proof. Computed
float shadows already publish a raw snapshot, which the predicates consume.

The only expected retained-result migrations are the integerCases/floatCases
`still-unsupported-{FSEQ,FSNE}-{vertex,fragment}` entries (eight). Pin their body
hashes and old results in an explicit migration manifest, then prove the new
results independently. Every other one of the 4,012 stages and all 264 pairs
must remain exact, as must all original 12/19 outcomes. Historical integer/float
browser modules assert the old negative expectations, so successor leaf recorders
must name the migrations while retaining the unchanged independent GPU probes;
no historical fixture rewrite or guard monkeypatch is permitted.

Keep IR/profile/flow at the measured E9 26,352/7,616/52,644 bytes unless a justified
measured change remains within the caps. New equality anchors should be small.
Record 179-instruction and 16KiB stress separately, typed LLVM/V8 counters and
strict receipts. Final source freezes before the complete recorded submission.

## Verification log

(empty)
