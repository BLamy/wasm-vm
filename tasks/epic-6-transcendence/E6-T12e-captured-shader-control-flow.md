---
id: E6-T12e
epic: 6
title: Preserve captured TGSI integer and structured control-flow semantics
priority: 525.02699
status: cancelled
depends_on: [E6-T11c]
estimate: S
risk: high
capstone: false
---

## Boundary

Extend the bounded VS/FS bridge only for the captured non-PRECISE integer,
comparison and structured IF/LOOP syntax/features still missing after T10d.
Inventory exact original shader hashes and syntax before changing the grammar;
bound nesting, tokens, registers and execution-sensitive loop forms. Preserve
integer/float bit interpretation, modifiers, component masks and initialization
rules. Do not silently remove instructions, normalize recorded bodies or allow
unsupported features through merely because an opcode is recognized.
PRECISE remains explicitly rejected for E6-T12f.

## Deterministic acceptance

`make verify-E6-T12e` runs affected native sanitizer/Wasm/browser bridge gates,
original-hash corpus outcomes and independent integer/branch/loop pixel oracles
through actual ESSL300 compilation and linking. Require all original non-PRECISE
shader bodies within this enumerated syntax boundary to translate unchanged;
record every remaining rejection by reason and hash. Preserve earlier exact
shader/pixel regressions and current production capabilities. Run final clean
clone and record source/toolchain/output identities.

## Adversarial verification

Attack malformed/mismatched control flow, excessive nesting, nonterminating or
out-of-budget loops, integer overflow/shift/comparison edges, uninitialized lanes
and signed/unsigned confusion. Sabotage a branch or integer comparison and demand
oracle failure. Neither translation nor a literal shader test proves whole
compositor compatibility; missing corpus semantics remain a dependency.

## Verification log

### 2026-10-03 — worker — decomposed after original-hash inventory

All captured integer/control-flow bodies also contain PRECISE. The five rejected
non-PRECISE originals need declaration/lane support and flat pair linkage first;
the old boundary therefore conflated independent work and misstated the corpus.
Replaced by ordered S tasks E6-T12e1 through E6-T12e9, followed by the narrowed
E6-T12f PRECISE/full-corpus closure. Each prerequisite names one acceptance command.
The inventory also identifies DIV/MAX/FRC/LRP and DP3/RCP/RSQ as explicit float
families. No original shader bytes are changed; accepting a stripped derivative
never counts toward the 19 originals. See the exact source/hash inventory in
`docs/virgl-shader-prerequisites.md` and `docs/virgl-shader-original-inventory.json`.

