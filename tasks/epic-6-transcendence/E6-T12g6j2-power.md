---
id: E6-T12g6j2
epic: 6
title: Admit bounded power evaluation for captured compositor equations
priority: 525.027010579
status: implemented
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

### 2026-10-04 — worker — implemented, fresh critic required

Frozen source: `6fcadd1eaa08f72b3fd7d301ce1df88fca452b1d`, predecessor
`ff4692e52a3ea52ee75368358b46fed1bd3fce9b`. Commands recorded once at the frozen head:
`make verify-E6-T12g6j2` (C guard compilation and pinned sources, ASan/UBSan,
native coverage, pinned TGSI conversion, Wasm, all inherited narrow guards,
whole legacy responses, mathematical predictions, ownership consumers,
three actual GPU seeds and three numerical source faults);
`python3 tools/virgl-power/cold.py --output target/evidence/virgl-power-cold-final`
(the single final pristine clone `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-power-cold-7c20pvzx/wasm-vm`, scrubbed build/runtime variables,
exact head, exit0, empty before/after status);
`python3 tools/virgl-power/seal.py --hot target/evidence/virgl-power --cold
 target/evidence/virgl-power-cold-final --output evidence/virgl-power/worker`.
Evidence: `evidence/virgl-power/worker/{manifest.json,records.json,recording.tar.gz}`.
The147-member archive SHA-256 is `5630a4ff3fcc271a812096b602d04c73b31bb3691fc6f39e1b6b9a653f02f3a2`;
index `3043e4458999f7a0f6024348ea2e2e18251c505c1bdfbfb6da43bcedb30e3363`; hot receipt `e02ad44fc5473da72b8f99308c3dd7f5cfe30d5806039a715272f92cb2c42f0f`;
cold report `99ab9a9128b1f7b37809d6ba06e1fbc35e634fabb6640be1decb38312521f9e7`; cold receipt `9b48f5d7434576de3fe10bce24990ace3e94a41a4b661939a2317785fdb95251`.
Both actual sanitizer binaries and original profiles are sealed. Hot/cold
tracked sources agree;13 incidental old generated files are bound only in hot,
and the clean clone passed without them. No recorded runtime repair occurred.

The recordings demonstrate the conservative integer bit-cube domain, both
post-swizzle scalar reads before publication, explicit zero handling and no
new static result/range/F2I authority. Each checkout has1167 matching native/
Wasm singles and1167 pairs,1106 pinned FLOAT/REPL witnesses,6867 complete
predecessor responses,15256 promoted native/Wasm guards,1110 owned policies,
516 metadata attacks (zero accessor calls),10 immutable banks and4 compound
base obligations. Actual synchronous/asynchronous consumers poison caller
storage, restore A/B/A banks, reject atomically and dispose all objects.
Three seeds608135816/2242054355/320440878 check37152 physical feedback words
and65280 full RGBA8 pixels, including72 unchanged literal-exponent statements.
Independent outward160/220-digit references enforce relative <=2^-14 or exact
owned +0. Maximum conservative relative errors: owned
1.125381678622123e-06, Mesa
6.09422101737745e-08 (identical hot/cold).
Owned maximum is hot/cold `gpu-608135816/report.json`, vertex168/lane0,
base1076450002, exponent1103063417, observed1346364585, raw SHA
`250ba73a0f4c2db94c8ce967686d228c1712ac97abc793acca80d5c53c5f4abb`.
The pinned converter's componentwise pow and float/vecN destination packing
are preserved and independently evaluated:642 concrete scalar deviations,
10872 canonical primary words,18576 total primary words and32640 primary
pixels per checkout. Actual base/exponent/broadcast source faults fail on
owned physical words. Earlier SAT39576/EX13152/SIN8160-word captures pass
unchanged promoted source oracles; three old plain-POW spelling rejections
are declared new bounded admissions, and two prior SIN admissions preserve
complete results. Earlier sealed fixtures stay unchanged; only current
unsupported spellings migrate to POW_PRECISE with binary arity preserved.

Qualification: this is a measured physical-host budget, not an unambiguous
portable ESSL pow accuracy guarantee. The26 original computed/uniform exponent
sites and both full larger bodies remain gated. Known initializers isolate
literal statements; they grant no original computed bounds. Production caps,
negotiation, live imports and guest execution remain disabled. No offload,
FPS or300MIPS claim follows. The fresh critic must independently attack
all task criteria and audit changed-line coverage before setting verified.
