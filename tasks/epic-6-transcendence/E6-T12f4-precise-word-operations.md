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

### 2026-10-03 — worker — fixed-heap refutation and semantic repair

The first canonical run at `b8743ae4f6417017fd3f15693ac11d6813ac5787`
passed the pinned token audit, native ASan/UBSan with 1,401,891 calls, and normal
Wasm agreement for all 19 originals, 4,428 cases and 511 pairs. It then failed
the unchanged fixed-memory pressure schedule: `wasm/calls.jsonl` line24440,
index24439, `profile-26-fragment-mixed-pair` returned `ok:true` with four
`(null)` source operands in its ordinary vertex GLSL. The complete call log
SHA-256 is `df4b20b9f9bf4bdadd65959f355d0d20279fd6deec23f29ea14aaa44685f9450`;
the serialized erroneous result digest is
`14ae1b6e8515afac1bc08b5d4e91e82cca71b49827e892c4564016df58d4beeb`.
The raw failed run remains in
`target/evidence/virgl-precise-word-worker-b8743ae4` and is retained with the
final evidence submission. This was a runtime refutation, not a proof-reader
repair; no final cold run has yet been counted.

An owned wrapper now compiles the unchanged pinned translator with checked
nonzero malloc/realloc failure latching. It safely initializes ignored strbuf
failures and reserves lazily grown operand storage before formatting. The
bridge resets and checks the latch around each ordinary conversion, before
another stage can clear it or a partial shader can be published. The pinned
so_info calloc is unreachable with the bridge's zeroed, owned shader-info key;
it is not a new allocation API. Production exposes no fault-injection control.

Strict guard checking and ASan/UBSan smoke preserve every complete healthy
original/case/pair result, exercise 209 existing owned allocation failures plus
all 20 malloc/realloc sites in four ordinary/mixed witnesses, and recover every
58 single/56 paired profile anchor. The selected high-risk submission will be
repeated at the repaired frozen head, including LLVM counters for the wrapper,
the original fixed-heap pressure schedule and the final pristine clone.
