---
id: E6-T12f4
epic: 6
title: Preserve PRECISE comparison selection and copy semantics on the GPU
priority: 525.0269914
status: pending
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

(empty)
