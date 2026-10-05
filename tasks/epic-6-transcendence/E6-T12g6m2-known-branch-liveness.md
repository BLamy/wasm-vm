---
id: E6-T12g6m2
epic: 6
title: Exclude proved unreachable raw UIF edges after complete validation
priority: 525.027010587
status: in-progress
depends_on: [E6-T12g6m1]
estimate: S
risk: high
capstone: false
---

## Boundary

A live raw UIF condition with exact zero or a proved one bit can exclude one
edge without granting dynamic numeric authority. On one final whole-text retry,
first validate every declaration, opcode, operand, modifier, label/target and
size/depth/loop bound in the unmodified source, then omit only operations on
proved unreachable predecessors. UIF is integer/raw-word nonzero; raw negative
zero and nonzero NaN encodings are true. Preserve source swizzles/versions,
masked writes, joins, address initialization, nested parent liveness, terminating
discard and live output obligations. Unknown, overwritten and conflicting joins
retain both edges. No fake lane facts, captured CONST values or IN ranges follow.
Dead data/indirect reads retain declaration and grammar checking; unused ADDR
remains rejected unless an actual proved dead indirect use accounts for it.
Keep original instruction indexes and bounded IR sizes. Complete old successes
win byte-identically, with a strict owned wrapper for genuinely new admission.

This is one private compiler control-flow boundary. Full literal compositor
admission remains E6-T12g6m with all its numerical, uniform ownership, indirect,
reflection and hardware criteria. Public imports/negotiation stay disabled;
there is no live offload, FPS or MIPS claim.

## Deterministic acceptance

`make verify-E6-T12g6m2`: strict affected C/JS gates, ASan/UBSan original native
binary/profiles, exact complete native/Wasm singles/pairs, handwritten raw-UIF
branch predictions, actual physical raw words/RGBA pixels over three seeds,
owned strict metadata and consumer guards, zero errors/objects/budgets.
Cover known true/false with/without ELSE, +0/-0/NaN raw truth, swizzles and
masked producers, partial proved-one and exact-zero facts, overwritten and
unknown/joined controls, nested dead parents, live discard and fallthrough,
missing live TEMP/output/address writes, actual dead indirect uses, and every
complete dead-text opcode/operand/target/depth/instruction/source-size boundary.
Unrecognized loops remain unsupported, including within pruned arms. Preserve
all old admitted results and close every previously rejected extension with
complete source hashes; bind both larger unchanged original bodies and their
continued rejection. Record word/control source-fault sensitivity, complete
changed native/Node/browser source coverage, exact frozen source receipts and
one scrubbed pristine clone. Fresh critic must inspect the actual recording.

## Adversarial verification

Predict every liveness/word/initialization/metadata result before inspection.
Attack raw signed-zero truth, wrong source lane or source version, nested parent
liveness, terminating-discard joins, forged constants from observations,
unknown-bit controls, missing live output/address authority, unsupported or
malformed dead tails, loop certificates, complete target/size/depth bounds and
strict policy/accessor ownership. Execute all scoped angles and one bounded
novel attack; sabotage new tests. Interrogate original native/V8 coverage
against every changed runtime hunk; unexecuted behavior requires evidence or
deletion. Carry unchanged predecessor HELD evidence with explicit boundary and
recording digests. Full original requirements remain gated.

## Verification log

### 2026-10-05 — worker — activation

Known arithmetic predecessor verified at `97dc44d2fbc9284705ad81630998bb533186c9a1`;
its runtime and complete original evidence remain bound to `cba5ae02`. Three
read-only frozen-native diagnostics in `/tmp/wasm-vm-known-branch-prerequisite-plan.json`
show known-false, known-true and dynamic UIF bodies currently reject at an
unsafe SIN despite the first two having a provably unreachable edge. The
17 handwritten planning fixtures and implementation design under /tmp are
not acceptance evidence. This leaf proves raw known-predicate liveness;
full original uniform/geometry/address obligations stay with E6-T12g6m.

Primary UIF definition:
https://docs.mesa3d.org/gallium/tgsi.html#uif-bitwise-if (consulted 2026-10-05).
