---
id: E6-T12g6j2
epic: 6
title: Admit bounded power evaluation for captured compositor equations
priority: 525.027010579
status: in-progress
depends_on: [E6-T12g6j1]
estimate: S
risk: high
capstone: false
---

## Boundary

Add POW under explicitly proven/enforced base/exponent domains, including the exact zero-base cases the captured paths require. Preserve inherited arithmetic provenance and conditional initialization. Unsupported negative-base/nonfinite cases cannot reach undefined native pow.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

The proposed static domain is nonnegative normal-or-zero base and finite
normal-or-zero exponent, after both source modifiers. A base that can be zero
requires every possible exponent to be strictly positive; zero-only cases
return explicit +0 without evaluating native pow. Every possible positive base
must have known clear sign. Integer binary-exponent bounds enclose log2(base),
and their largest absolute bound times the largest possible exponent magnitude
must be <=120. This uses integer significand/scale comparisons, keeping nonzero
results within the conservative [2^-120,2^120] margin. Negative bases, nonfinite
or subnormal inputs, opaque numerical origins and unsafe fact overapproximations
remain rejected. Scalar post-swizzle x from each operand is captured before
mask/alias publication. Outputs retain numerical/bank authority and no static
exact, range or F2I facts.

The physical acceptance budget is measured relative error <=2^-14 for nonzero
results, and exact owned +0 for zero-base cases. Independent outward Decimal
ln/exp intervals at160/220digits enclose x^y; mathematically exact identities
are justified separately. Record conservative maximum relative error for both
backends. This is an explicit measured-platform budget: the ESSL3.00 precision
table's inherited pow expression has an apparent argument reversal, so it is
not treated as an unambiguous portable budget for this boundary. Production
host qualification stays downstream.

Pinned TGSI requires scalar replication from src0.x/src1.x, while the pinned
converter emits componentwise pow. Preserve and independently check actual
unmodified reference GLSL, record nonbroadcast deviations and check canonical
broadcasts and literal captured statements against the same scalar equations.
Known initializers isolate original use sites; they do not prove their original
computed base/exponent domains or either full compositor body. Existing plain
POW unsupported-spelling negatives will become explicitly logged bounded
admission extensions; preserve their old sealed sources and rejection records.

## Deterministic acceptance

`make verify-E6-T12g6j2`: Independent high precision power equations at identity/square/root cases and bounded captured exponents/base neighbors, zeros and excluded domains. Pinned Mesa differential, native/wasm and actual GPU outputs, branch/lane/modifier attacks and exponent/base source faults. Bind any new range contract to uniform/cache/async consumers.

Use the narrow affected compiler/consumer gates, record final exact-source native,
wasm and physical hardware proof, numerical source-fault sensitivity, varied
seeds and one pristine clone. Preserve unchanged HELD results. Submit to a fresh
independent critic before any dependent activates.

## Adversarial verification

Predict each stated semantic/domain result before inspecting. Attack signedness,
source and destination versions, liveness, domain ownership/metadata, masks,
boundaries and actual hardware reflection. Run every scoped acceptance angle,
one bounded novel attack and test sabotage; no mock/inverse/self-derived pixel
oracle. Each finding names a report/trace point and digest. Unexecuted runtime
hunks need evidence or deletion; unsupported original paths stay gated.

## Verification log

(empty)


### 2026-10-04 — worker — activated

The human requested continued graphics offload implementation. This is the
earliest eligible task within that ordered compiler chain; SIN is independently
verified at `ff4692e52a3ea52ee75368358b46fed1bd3fce9b`, with all ten predictions
HELD and an authenticated115-member critic seal. Native stack layer
`codex/virgl-bounded-power` starts from that exact prerequisite. Planning from
unchanged literal originals found98 POW use sites:72 literal exponent uses,
14 distinct declared exponents (.0126833133..78.84375), and26 computed/uniform
uses. Captured uniform exponents are2/3, but this inventory is input context
and grants no domain authority. Use the stated integer envelope, independent
outward references, actual physical outputs, final pristine clone and fresh
critic. Production admission and performance claims remain gated.
