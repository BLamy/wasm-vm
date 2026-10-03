---
id: E6-T12e6b
epic: 6
title: Derive conditional finite constant authority in the owned compiler
priority: 525.02699062
status: in-progress
depends_on: [E6-T12e6a]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit numeric use of raw CONST-derived finite values only with a compiler-derived
constant-bank contract enforced by E6-T12e6a. Cover direct CONST, exact MOV/swizzles
and permitted raw UCMP provenance across the complete ordinary arithmetic family.
Keep PRECISE, indirect addressing and control flow gated. No caller flag, asserted
domain or source rewrite may select or suppress the contract.

Distinguish numeric access, ordinary-output authority and finite-bank dependency
in compact facts. Conditional CONST is not an original-IN shortcut, a computed
float shadow or a raw-output proof. Mixed UCMP must preserve synchronized raw
payload and numeric snapshots; any possibly selected conditional-only arm blocks
ordinary output authority until an actual numeric operation computes a result.
Known selectors retain only the selected fact. Bitwise/integer writes invalidate
stale numeric authority unless existing known-bit proof independently suffices.
Preserve pre-write aliases and partial-lane distinctions.

Keep every old successful full result exact by trying unconditional validation
first. An internal retry may follow only the typed missing-numeric-authority
failure, must establish actual CONST-dependent numeric consumption, and must
revalidate the entire immutable shader. Failed retries retain the original
public error; no partial IR, metadata or response-buffer state may leak. Preserve
112-byte instructions, 12-byte facts, bounded IR/storage and fixed Wasm limits.
Single/pair translation must emit identical applicable stage obligations.

## Numerical contract

Use GLSL ES3.00 rev6 section8.3's finite bit reinterpretation guarantee and
section4.5.1's ordinary-operation latitude. Finite includes subnormal encodings;
raw-u32 storage and selection preserve their bits. Numeric operations may flush
subnormals where the specification permits, but no arbitrary result or raw payload
loss is allowed. Do not claim NaN/Inf reinterpretation, payload preservation after
arithmetic, exact computed zero signs or PRECISE authority. Ordinary source
admission gains no invented magnitude, divisor or interpolation-weight guards.

## Deterministic acceptance

`make verify-E6-T12e6b` requires native ASan/UBSan, full native/Wasm results and real
compiler -> decoded SET_CONSTANT_BUFFER -> shared sync/async renderer draws.
Positive integration cases use no metadata or GLSL injection. Independently
check exact normal arithmetic, documented reciprocal/root enclosures, and finite
subnormal controls whose allowed flush/preserved outcomes are derived explicitly.
Export original raw constant byte planes in the same programs.

Cover CONST0/45, consumed masks, swizzles, all numeric source positions, typed
negation, scalar replication, aliases, MOV chains and known/dynamic UCMP arms.
Bind every intentional historical admission to an exact promoted body and adjacent
negative replacement; preserve other full results and all19 originals (12 accepted,
7 rejected). Reuse predecessor oracles with explicit compatibility adapters as
needed, without weakening them or fabricating old full-gate receipts. Record
exact-head evidence, current-bank async schedules, one final pristine clone and
fresh adversarial verification.

## Adversarial verification

Attack IN/CONST confusion, unknown raw TEMP, raw subnormal output, unsafe synthesized
encodings, stale shadows after partial overwrites, mixed UCMP chains, unsafe
unselected arms, missing/stripped contract, wrong constant index, shortened/current
banks and async-yield reuse. Preserve existing raw-only UCMP and known-selector
full GLSL/metadata without added shadows or restrictions. Sabotage contract
emission or a numeric constant index and require an independent guard or GPU
oracle failure. A malformed/PRECISE suffix after a retry-triggering instruction
must still fail and recover cleanly.

## Execution notes

The consumer dependency was independently verified at
`9497f3da026092db1eb53e8d6187bceff214656a`. This slice changes only the owned
compiler's conditional authority boundary; TEX remains fragment-only and the
existing renderer/decoder contracts remain intact. Runtime authority fits the
existing fact/instruction/IR layouts. An ordinary first attempt preserves every
existing successful stage result; only an internally typed missing-numeric-
authority failure permits one complete conditional retry.

The exact historical migration inventory predicts 105 distinct formerly rejected
bodies across five case files. Preserve those exact bodies as new positives and
replace their historical negative positions with explicitly recorded adjacent
absolute-modifier rejections; two generated numeric rejection-pair references
follow those replacements. All other full results, recovery anchors and original
captured bodies remain fixed. Successor compatibility receipts independently
account for this boundary without changing old validators' historical claims.

New positive hardware proof uses actual compiler-produced contracts through
ordinary decoded packets and the shared sync/async renderer, with no injected
metadata or GLSL. Compact indexed bitplane atlases reconstruct all numeric and
raw constant words; independent per-pixel geometry/orientation checks bind the
atlas itself. E6a's broader consumer workload runs once as an explicitly named
regression. Fault runs are separate, narrowly scoped recordings. Production guest
negotiation and original Mesa workload execution remain gated.

## Verification log

(empty)
