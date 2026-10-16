---
id: E6-T12g6j1
epic: 6
title: Admit bounded sine evaluation for captured compositor equations
priority: 525.027010578
status: verified
depends_on: [E6-T12g6i]
estimate: S
risk: high
capstone: false
---

## Boundary

Add SIN only with a bounded finite argument domain and stated hardware numerical budget. Preserve private/numeric provenance and use-site/conditional validity. No unbounded range-reduction or POW admission.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

The admitted argument encodings are normal-or-zero in [-8,8], proved from
conservative post-modifier source facts at every use. SIN consumes post-swizzle
x once and replicates its result before masked or aliased publication. Results
retain inherited numerical authority and bank dependence but no static range,
exact word, or F2I facts. Opaque/unbounded sources and unsupported modifiers
remain rejected.

The physical acceptance budget is absolute error <=2^-20 against independently
enclosed real sine values. ESSL 3.00 section 4.5.1 specifies no trigonometric
precision guarantee; this budget is measured on the recorded hardware, and
production integration must establish any supported host guarantee separately.
Record the conservative maximum observed error for each backend.

The pinned TGSI token/documentation requires scalar replication, while the
pinned reference converter emits componentwise sin. Retain its actual sources
and independently predicted componentwise equations, record concrete deviations
for nonbroadcast inputs, and compare canonical broadcasts and the two literal
captured broadcast statements against the same scalar references. Known
initializers isolate those statements; they do not establish either full body
or the bounds of its original computed arguments.

## Deterministic acceptance

`make verify-E6-T12g6j1`: Independent high precision sine values at zeros, quadrants, critical neighbors and varied bounded inputs, aliases/modifiers/lane masks and branch joins. Pinned Mesa differential plus actual WebGL2 outputs and domain/source faults. Record maximum observed error without deriving the expected result from emitted GLSL.

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

### 2026-10-04 — worker — activated

The human requested continued graphics offload implementation. The prerequisite
EX2/LG2 boundary is verified at `322bb56ee95ef9e2fb26b85179d61ae51efbbf5f`;
its fresh critic seal is authenticated. This ordered S/high leaf is next within
that requested scope. Use exact rational alternating-Taylor enclosures at
220/280 bits, original source bindings, and one final pristine clone. The
measured-platform budget and pinned converter discrepancy remain explicit.
No runtime proof or implementation claim is made by this activation.


### 2026-10-04 — worker — implementation / self-validation

Implemented RAW_SIN (slot55) and the v36 wrapper above complete profiles1..35.
Use-site facts must prove normal-or-zero magnitude<=8 after negation. The emitter
snapshots post-swizzle x once before masked publication and inherits numerical
bank dependence without creating output range or conversion facts.

Ephemeral self-validation passed 1,006 native/ASan/UBSan cases and Wasm singles
and pairs, 970 actual pinned FLOAT/REPL parser/converter witnesses, 974 contracts,
580 metadata attacks, 12 owned banks, four simultaneous whole-base compositions,
1,022 inherited EX2/LG2 guards, and 5,861 complete predecessor results. Two sealed
old plain-SIN rejections are explicitly predicted as this new admission extension;
only those unsupported-opcode negative declarations become SIN_PRECISE guards.
Their original source and rejection records remain unchanged in the prior seal.

An initial self-run exposed missing sine-only numeric routing; that runtime fix
restarted the focused gates. A subsequent duplicate reserved temporary in a
combined fixture was corrected to the unused slot505. Final self-native and
Wasm checks pass. The first physical seed passed 8,160 words and 20,352 pixels,
with independently source-derived conservative sine error about6.86e-8 on both
backends (budget2^-20). These are ephemeral checks, not evidence of record.
The next commands record the frozen final submission and single pristine clone;
a fresh critic remains required before this task can become verified.


### 2026-10-04 — worker — implemented / recorded submission

Frozen runtime: `ad31839ebc55e5f853c9d9853a44c9922767e7da`; final evidence head:
`d44d2683941ab4cb32df53d4dcb84f045046caf9`; verified base: `322bb56ee95ef9e2fb26b85179d61ae51efbbf5f`. Commands:
`make verify-E6-T12g6j1`; `python3 tools/virgl-sine/cold.py --output
 target/evidence/virgl-sine-cold-final`; `python3 tools/virgl-sine/receipt.py
 target/evidence/virgl-sine`; `python3 tools/virgl-sine/seal.py --hot
 target/evidence/virgl-sine --cold target/evidence/virgl-sine-cold-final --output
 evidence/virgl-sine/worker`. The archive/index and all 135 actual members plus
727 source bindings are authenticated. No implementer verdict is asserted.

Both recorded checkouts pass 1,006 native/ASan/UBSan cases and Wasm singles/pairs,
970 actual pinned FLOAT/REPL=2 witnesses, 14,736 inherited native/Wasm guards,
5,861 whole predecessor responses, 974 contracts, 580 metadata attacks, 12 banks,
four simultaneous whole-base obligations, and 67 exact rational predictions.
Each checks 24,480 physical words and 61,056 pixels across seeds389793865,
2135058973 and3399354483, including 12,240 actual primary words, 30,528 primary
pixels and 4,896 canonical primary words. All three actual emitted-source faults
contradict the independent physical oracle. Inherited SAT 39,576 words/26,624
pixels and EX/LG 13,152 words/30,464 pixels still hold their promoted source
oracles and sensitivity. All owned GPU objects, resource budgets and browser
error arrays return to zero. Original complete larger bodies remain rejected;
the two prior plain-SIN fixtures are an explicit new bounded admission extension.

The maximum conservative observed sine error is
6.859461500265203e-8 for each backend (budget2^-20), at vertex records180/181,
condition0, lane0, input0x3fc00000, observed0x3f7f5bd6, seed389793865,
raw capture SHA-256`22eca526aa1a37ea61812b94516f3baa1149a5ae632ddce2cb1409529a20f9b4`.
The exact rational error and all vendor componentwise deviations are in the
receipts. Expected values come from input words, independent TGSI execution and
alternating-Taylor enclosures at220bits with nested280bit checks. Two original
broadcast use sites agree under known isolated initializers, without any full-body
or original computed-domain claim. The precision budget is measured on this
physical host; ESSL supplies no sine precision guarantee.

The initial pristine clone at ad31839e completed the full acceptance command
(exit0, clean before/after) but its wrapper passed the old EX/LG output variable,
then failed collecting a nonexistent receipt path. This is a recording-path
failure, not a runtime refutation. Original failed report/log and completed
acceptance receipt remain sealed in hot/cold-output-path-failure. The only repair
at d44d2683 is cold.py plus receipt.py's explicit harness-repair set. The hot
source/byte bindings were reauthenticated without repeating unchanged runtime
checks; its first receipt remains sealed. The corrected wrapper passed one
uninterrupted final pristine clone at d44d2683:
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-sine-cold-zlomsbxc/wasm-vm`.
The final cold run and all original profiles/binaries are preserved separately.

Evidence: `evidence/virgl-sine/worker/recording.tar.gz` (135 members,
32171106 bytes), SHA-256`184d0cbf61b1fe7d3d0c01f1c20d786afceed06a1fa2600bbc4259e38011dc2c`;
index`451cf3abf287a254f83773bd3ab1963de8aeb09db555ecf5d969d1269481e0b3`;
manifest`901e0d3afe92649e133065e9d5cb2574cd968494f9e7e4a365ddae143d82ab2b`;
hot receipt`543ca9744fffdf50d1d40a43bdd75648138ef4769b037dd980786700bc1ad9a0`;
final cold report`d3de1df0400cbf06258a167c9c602735530fe36cd836d0888973b9c5e64d0a59`;
final cold receipt`c687ef5cad483d70a79249f4aba3e87762cc75e1e2143bb25dc1b71675d8f8f2`.
Production caps, negotiation, live imports, guest execution and measured FPS/MIPS
remain gated. A fresh adversarial verifier must now interrogate this exact diff
and archive before any dependent activates.

### 2026-10-04 — fresh independent verifier — VERDICT: verified

VERDICT: verified

Frozen runtime `ad31839ebc55e5f853c9d9853a44c9922767e7da`; worker submission
`c6e56fa8`; final worker evidence `d44d2683941ab4cb32df53d4dcb84f045046caf9`.
The critic did not implement or edit runtime code. Ten falsifiable predictions
were recorded before inspecting outputs; all are HELD, with no findings.

- P1 authentication — HELD. Every actual unique regular worker member135 and
  every source binding727 matches its seal, index, archive and recorded head.
  `authentication.json` authenticates the original collector failure and the
  corrected uninterrupted pristine final clone, not a replacement happy story.
- P2 domain/signedness — HELD.520 independently predicted native/Wasm guards
  cover normal/zero/special and outward +/-8 neighbors, negation, enumerated
  partial encoding cubes, joins, versions and closed rejections. The original
  sanitizer binary records all520 again without diagnostics in
  `critic-native-recording.json`; native/Wasm guard results are in
  `independent-regressions-final.json`.
- P3 scalar/masks/aliases — HELD. Independent original-TGSI execution holds all
  words/pixels of six worker hardware runs and the critic seed; source snapshots
  precede masked/aliased publication and untouched lanes retain earlier words.
  `source-semantics.json` and `fourth-seed-semantics.json` bind every point. The
  original92cb866a… file statements76/175 remain literal isolated broadcasts.
- P4 numerical budget — HELD. A separate Machin-pi enclosure, rational quadrant
  reduction and reduced sin/cos Taylor tails recompute expectations solely from
  original input words. The conservative maximum error is
  `6.859461500265203e-8` on both backends, below measured2^-20. Fourth capture
  vertex180/181, vector0/lane0/condition0, input`0x3fc00000`, observed
  `0x3f7f5bd6`, captureSHA`d45092409741ac8d046d48f8b0ca3aef4b16d84db875359388ee8b275e6876bf`
  is a concrete bound point. Literal vendor GLSL stays unchanged;204 concrete
  nonbroadcast component deviations per worker run remain explicit, alongside
  canonical scalar/broadcast agreement. The host budget is measured;
  [ESSL3.00 section4.5.1](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
  provides no trigonometric precision guarantee.
- P5 authority/liveness — HELD. Even SIN(0) creates no F2I or subsequent bounded
  SIN/EX2/LG2 facts. Known old/repaired lanes remain usable while new computed or
  poisoned sibling versions do not. All ten wrapper-selector arms preserve their
  complete prior policies (`critic-native-recording.json`).
- P6 consumer ownership — HELD.974 contracts,580 recorded plus274 independent
  metadata/ownership/bank attacks and12 banks hold with0 getters. The fourth
  actual sync/async A→B→A/restore run, poisoned caller bytes, atomic rejection,
  physical reflection and zero GPU/resource budgets hold (`consumer-attacks.json`,
  `consumer-boundary-attacks.json`, `fourth-seed-semantics.json`).
- P7 heritage — HELD. `carry-forward.json` authenticates unchanged SAT/EX actual
  capture/fault members and source-oracle digests; FRC seal/4469 guards carry.
  Complete5861 predecessor results/adjacent obligations hold. Exactly two original
  bounded plain-SIN rejections extend this admission; their original sealed
  records remain intact and SIN_PRECISE remains unsupported. Original unsupported
  complete workload paths stay gated.
- P8 coverage — HELD. Both actual archived ASan/UBSan binaries reproduce the
  original1006-case outputSHA`35c13f225f45827df2037f2c4a55db369b3872008d32027bf4f6c0d2ff31cedc`
  with empty stderr. ORIGINAL profiles re-export identically.50 runtime diff
  lines have original C/V8 or Node source-bound counts;12 individual declarations,
  signatures and comments have sound waivers (`native-replays.json`,
  `coverage-audit.json`). The critic520-case run additionally covers every new
  metadata selector arm; no rebuilt substitute supplies original coverage.
- P9 fourth physical seed — HELD. Decimal seed1834637033 at clean critic guard
  head `f6facf82163965c5018abc054f50247f9f0928e2` checks8160 complete feedback words
  and20352 whole RGBA8 pixels on headed ANGLE Metal Apple M4 Max, including80
  fresh actual pinned converter witnesses. Every source, served byte, original
  primary GLSL, V8 script and screenshot binding holds (`final-checks.json`).
- P10 novel attack/sabotage — HELD. Aliased lane-locality and single repaired-lane
  attacks hold. Scratch-only removed-domain, component-broadcast and fabricated
  result-fact changes all fail the520 guards. All six actual archived shader
  faults fail the independent source oracle. A fully rehashed capture with a
  poisoned cached oracle still fails original-source mathematics
  (`sabotage-regressions.json`, `sensitivity.json`).

SUITE: promoted `sine-regressions.mjs` and `sine-capture-regressions.py`, wired
into `make verify-E6-T12g6j1`, at critic guard commit
`f6facf82163965c5018abc054f50247f9f0928e2`. Exact commands are recorded in the
critic README and sealed scripts/logs. Checks include relevant node/python/bash
syntax, diff hygiene, source/coverage authentication, actual original-binary
replay, independently recorded guards and physical fourth seed; unrelated Rust
regression walls were not restarted for this isolated unchanged compiler runtime.

Qualifications: the initial worker pristine acceptance succeeded, but its first
collector used the previous task's output variable and failed collection. Original
failure/log/receipt remain sealed; the corrected final pristine clone passes.
The critic's first fourth GPU run passed, then its freeze guard rejected the two
new untracked guard files; its original capture/error remains archived, and the
final fourth run at clean critic head passes. Mechanical artifact-script and seed
label corrections are recorded separately. Only tests/acceptance wiring changed
in critic work, so the final original cold runtime proof carries incrementally.
No product refutation or evidence gap survives these qualifications.

Critic evidence: `evidence/virgl-sine/verifier/recording.tar.gz` (115 actual members,
20170281 bytes), SHA-256`904cb8b3a6cd3b8b6003458afa70aba854f4430d315242e304283e952f678525`;
indexSHA`8cc8109602bf48d9fc449e9981e96d3f9622cb17f152c7d8046fdcecdac330cb`;
verdictSHA`367b25f3d29ca10192f48a2d6d561abc2497c4a59bbf62515db18dad00a455dc`.
ManifestSHA`4e7cb2eee168a686ff96e91b2f41260bb61cce160c819749e3e82ccc72e86e21`.
Every citation above is relative to that seal and is digest-bound in
`verdict.json`. The original135-member worker archive remains independently
bound by SHA`184d0cbf61b1fe7d3d0c01f1c20d786afceed06a1fa2600bbc4259e38011dc2c`.
Production caps, negotiation, live imports, guest execution, FPS/MIPS and original
full-body computed argument bounds remain outside this private compiler proof.
