---
id: E6-T12g6j2
epic: 6
title: Admit bounded power evaluation for captured compositor equations
priority: 525.027010579
status: verified
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

### 2026-10-04 — fresh verifier

VERDICT: verified

All ten predictions were written in `predictions.json` before recorded state was
inspected. The implementation was not edited. Runtime and dependency bytes remain
bound to `6fcadd1eaa08f72b3fd7d301ce1df88fca452b1d`; worker submission is
`39ef0d94f2ede843e88b476683de20208babe326`. Independent tests and verification
wiring were promoted at `fcf065acf2397362057ab85b75708212ca09fe29` before the
fresh physical capture, whose recorded `trackedChanges=[]`.

- P1 authentication and isolation — HELD. Predicted all147 archive members,
  exact-source receipts and successful scrubbed cold clone. Authenticated the
  claimed worker archive/index and all members;384 tracked hot/cold sources
  agree, with13 incidental hot-only generated fixtures absent from the passing
  clone. Replayed **each actual sealed sanitizer binary** on its own fixture and
  re-exported **each own original profile**; outputs and coverage match the
  originals. Citation: `authentication.json#/receipts`,
  `native-replays.json#/records`, `carry-forward.json#/coldIncremental`.
- P2 complete static domain — HELD. Predicted rejection of zero-capable joined
  bases with zero/negative exponents, including exponent bit cubes containing
  zero despite positive endpoints. Independent native/Wasm1914-case guards held;
  concrete novel case1091 joins base0/.5 and exponents0x00800000/0x01000000 and
  rejects atomically. The unchanged sealed hot binary supplements the worker's
  unhit rejection: `raw_bits.c:212,column35` true20/false6. Citation:
  `independent-regressions.json#/native/1091`,
  `critic-native-recording.json`, `coverage-audit.json#/domainBranches`.
- P3 source versions, masks and aliases — HELD. Predicted both post-swizzle x
  operands before publication, scalar replication, preserved unwritten words,
  consumed-lane initialization and irrelevant unused special lanes. All15 masks,
  swizzle pairs and both source aliases held in independent guards and
  original-TGSI physical equations. Citation:
  `independent-regressions.json#/native/1857` (base alias), `/native/1861`
  (exponent alias), `fourth-source-guards.json#/physical/points`.
- P4 provenance, modifiers and bank obligations — HELD. Predicted valid saved
  versions survive kills, invalid live/opaque versions reject, modifiers precede
  proof/evaluation, and results grant no exact/range/F2I facts. Saved/invalid
  versions, every result lane, opaque producers and inherited bank constraints
  held. A scratch runtime that forges a known-zero result is refuted. Citation:
  `independent-regressions.json#/native/1853` and `/native/1854`,
  `consumer-boundary-attacks.json#/ownership`,
  `sabotage-regressions.json#/records` (`result-facts`).
- P5 independent primary semantics — HELD. Predicted1167 matching native/Wasm
  singles and pairs per checkout,1106 authentic FLOAT/REPL witnesses, literal
  originals and distinct scalar versus vendor componentwise/constructor packing
  equations. Original vendor GLSL stays unchanged. Independent enumeration finds
  all72 literal sites/14 exact exponent words; four distinct seeds preserve856
  concrete vendor deviations and14496 canonical primary words. Citation:
  `native-replays.json`, `reference-audit.json#/captures`,
  `final-audits.json#/allUniquePhysicalSeeds`.
- P6 numerical truth and budget — HELD. Predicted exact owned +0 and nonzero
  relative error <=2^-14 from original TGSI source and exact binary32 inputs.
  The independent oracle uses outward1040-bit dyadic atanh/exp series with
  proved geometric tails, exact binary range reduction and outward squarings;
  all80 reference equations nest strictly inside both worker160/220-decimal
  intervals. Four unique seeds check49536 feedback words/87040 full RGBA8 pixels.
  Maximum conservative relative errors: owned `1.1862894318599564e-6`, Mesa
  `6.09422101737745e-8`. The owned maximum is fourth vertex180/vector0/lane0,
  base1078410713, exponent1105759987, observed1464186247, raw SHA-256
  `18b3428dd6f3f2fcfc444e26b9808e53a50c3fb00fc38b4f88cfa2178befa783`.
  Citation: `reference-audit.json#/rows`,
  `fourth-source-guards.json#/physical/maximumObservedError`,
  `final-audits.json#/maximumObservedRelativeError`.
- P7 fresh physical state — HELD. Predicted an independently seeded physical
  run with unchanged served sources, complete reflection/capture bytes, no
  errors, clean tracked state and zero live objects. Seed2654435769 passes on
  headed ANGLE Metal Apple M4 Max WebGL2:12384 words/21760 pixels,80 fresh pinned
  native witnesses and equations fixed before observation. All source, served
  bytes, screenshot and V8 bindings held; generated worker files were restored.
  Citation: `fourth-command.json`, `fourth-plan.json`,
  `gpu-2654435769/report.json#/trackedChanges` (report SHA-256
  `be687024737603ed3f22b66e9f1d232dabdf4e1a0a779827a9e03e939790333b`),
  `final-audits.json#/fourthCoverage`.
- P8 ownership and actual consumers — HELD. Predicted immutable recursive
  delegation, closed forged/accessor policies, bank preservation and actual
  sync/async poison/restore behavior.298 additional policy/bank attacks held
  with zero getters; both physical consumers poison caller storage, restore
  A/B/A banks, reject with no applied commands and dispose every object.
  Citation: `consumer-boundary-attacks.json`,
  `gpu-2654435769/report.json#/acceptance/consumers/0` and `/1`.
- P9 source and test sensitivity — HELD. Predicted actual source faults and
  sabotaged expectations fail the independent oracle. All six sealed hot/cold
  base/exponent/broadcast faults fail original-source predictions, even with a
  forged cached oracle around the faulty observation. Four actual scratch
  runtime mutations (zero-capable admission, exponent snapshot, zero bypass,
  result facts) and two test-source mutations fail promoted guards. Actual
  mutations/binaries and counterexamples are sealed. The exact promoted receipt
  statements pass authenticated records and reject four tampered records.
  Citation: `sensitivity.json#/records`, `sabotage-regressions.json#/records`,
  `wiring-checks.json#/tamperChecks`.
- P10 sufficiency and carried authority — HELD. Predicted every changed runtime
  hunk/selector arm exercised or explicitly justified, and unchanged HELD proofs
  preserved.77 runtime lines and all11 selector arms execute.17 nonexecuting
  declarations/documentation lines are waived individually. The only waived
  branch outcome is `raw_bits.c:232,column40` comparison true: when scale>=0,
  significand>=2^23 and nonunit integer log_size>=1 force product>=2^23>120;
  unit/zero-product identities return earlier. Both scale<7 outcomes and the
  comparison false outcome execute. SAT/EX/SIN source oracles/seals,15256 prior
  promoted guards,6867 complete prior responses,3 declared old POW admissions
  and2 carried SIN admissions retain their authority.26 computed/uniform
  original sites and both full larger bodies stay gated. Citation:
  `coverage-audit.json#/waivers` and `/selectorArms`, `carry-forward.json`,
  `final-audits.json#/unchangedTrackedSources`.

SUITE: promoted1914 independent native/Wasm guards and the independent
original-source capture oracle into `make verify-E6-T12g6j2`; receipt wiring binds
positive/fault records and oracle sources. Commands included archived
`authenticate.py`, `replay.py`, `supplement.py`, `consumer_attacks.mjs`,
`fourth.py`, `coverage_audit.py`, `sabotage.py`, `sensitivity.py`,
`reference_audit.py`, `carry_forward.py`, `final_audits.py`, `wiring_checks.py`,
the promoted capture CLI on the fourth report, `write_verdict.py` and `seal.py`.
Syntax checks and `git diff --check` passed. The single final scrubbed clone proof
at the frozen runtime head is carried forward incrementally; the later promotion
changes tests and verification wiring only, so no new clone or unrelated gauntlet
was run. After status update: `python3 tools/check_task_policy.py`, then
`python3 tools/build_queue.py`, then commit.

Critic evidence: `evidence/virgl-power/verifier/{README.md,manifest.json,
records.json,recording.tar.gz}`. The118-member archive SHA-256 is
`587e4a7e29d643d241a8db44f9021ad7d79dfe9f05ec8cfa0888871efb026394`;
index `ef1c1c9cfab71f19a73c38d838685f205946b59f686dbaa15ae7470896fad894`;
verdict `85b542ec19517a5bf265563ccd69412219e81987e41b37b3cb9b41714b133717`;
before-inspection predictions
`ee3bf783fecdabad3734faa699f9885c8b1d26460aa4516fa20a6e47145c072c`.
Every cited member has its own byte length and SHA-256 in the authenticated index;
`verdict.json` records all ten predictions, observations and point bindings.

Scope qualification held: the budget is measured on the physical host, not a
portable ESSL pow guarantee. Original computed domains and full compositor
bodies acquire no new authority. Production caps/negotiation/live imports/guest
execution remain disabled. No offload, FPS or MIPS claim follows. All PRs remain
open; verification does not authorize a merge.
