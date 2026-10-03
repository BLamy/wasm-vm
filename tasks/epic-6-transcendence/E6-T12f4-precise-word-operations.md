---
id: E6-T12f4
epic: 6
title: Preserve PRECISE comparison selection and copy semantics on the GPU
priority: 525.0269914
status: in-progress
depends_on: [E6-T12f1]
estimate: S
risk: high
capstone: false
---

## Boundary

Audit the pinned per-instruction TGSI PRECISE meaning and implement only
FSEQ_PRECISE, FSNE_PRECISE, MAX_PRECISE and MOV_PRECISE as checked exact word
operations. Retain the modifier in IR; do not strip it or assume an unavailable
ESSL300 precise qualifier. Preserve source order, consumed lanes, selected word
identity, signed-zero ties and required NaN behavior under an explicit contract.
Audit MAX against the pinned TGSI definition rather than inheriting GLSL max's
tie behavior. Preserve numeric/output authority and all bank/control obligations.

Instruction-local flags do not automatically create an exact backward RSQ/DP3
cone; justify the scope from pinned tokens and Mesa conversion behavior. Keep
ADD_PRECISE/MUL_PRECISE rejected until their separate arithmetic boundary. Any
newly accepted original must retain its original SHA and its domain contracts.

## Deterministic acceptance

`make verify-E6-T12f4` records the semantic audit, both-stage exact word oracles
for predicate/select/copy paths, signed-zero and NaN position witnesses, source
aliases, computed operands and newly supported original compile/link paths.
Require native sanitizer/Wasm parity, previous independent leaf regressions,
actual shared-renderer GPU proof, bounded output/storage and final cold clone.

## Adversarial verification

Swap MAX operands on equal/unordered inputs, conflate signed zeros with raw
integer equality, lose FSNE's unordered result, drop a PRECISE flag or erase an
obligation from a combined result. Actual compiler-source faults must fail the
independent word oracle. Do not promise NaN payloads/subnormals through raster
boundaries that only have the existing floating-output contract.

## Verification log

### 2026-10-03 — worker — activation

E6-T12f1 is verified at `2a0d0359de37452d5a78bb9ab6fbf8583c69cb7c`;
the preceding radial boundary is verified at
`220c2640d8c75df4decae10a3aa12a7be150897f`. Audit the pinned virglrenderer
1.3.0 instruction Precise bit, text suffix parser and upstream destination
qualifier behavior against the stable Mesa 24.2.8 TGSI definition. Retain a
per-instruction flag in checked IR and implement only the four exact word
operations named by this task. MAX selects the second source on equal or
unordered comparisons, preserving the selected word including its zero sign
or NaN payload. Do not infer exact upstream RSQ/DP3 arithmetic from a marked
copy or comparison. ADD_PRECISE and MUL_PRECISE remain separately gated.

Preserve every numeric/output and owned-bank/control obligation under a closed
precision contract. Record independent both-stage word oracles, consumed
swizzles and aliases, actual shared-renderer GPU results, real compiler-source
sabotage, sanitizer/Wasm parity, retained independent leaves, caps and a final
pristine clone. Original bodies retain their capture hashes. This isolated
compiler/shared-renderer slice neither enables guest negotiation nor claims
desktop 300 MIPS; original radial output authority remains its own boundary.
