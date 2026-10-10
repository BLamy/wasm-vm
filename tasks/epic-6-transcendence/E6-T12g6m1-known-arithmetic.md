---
id: E6-T12g6m1
epic: 6
title: Materialize exact known ADD and MUL producer words for bounded consumers
priority: 525.027010585
status: verified
depends_on: [E6-T12g6l]
estimate: S
risk: high
capstone: false
---

## Boundary

The unchanged larger compositor bodies still reject after opcode closure: full
92cb866a first fails at computed SIN (PC38), and c5806d5f at computed POW (PC31).
Neither a numeric origin nor a host floating calculation proves their source
encodings. One prerequisite is exact known ADD/MUL producer facts. On a final
whole-text retry only, fold fully known, already authorized normal-or-zero
post-modifier operands with integer binary32 round-to-nearest/ties-to-even.
Materialize the exact normal-or-zero result word and its matching numeric shadow
before granting that producer version a fact. Preserve masked/aliased reads,
joins, source versions, grammar and bounded IR storage. Dynamic operands,
exceptional results and unproven computed consumers retain existing rejection.

This does not admit the full originals or grant typed uniform/interpolated input
ranges. Full-source acceptance remains E6-T12g6m. Production negotiation and
public imports remain disabled; no FPS or MIPS claim follows.

## Deterministic acceptance

`make verify-E6-T12g6m1`: strict affected C/JS checks, ASan/UBSan recorded native
fixtures with original LLVM binary/profiles, exact native/Wasm single/pair
parity, independent integer binary32 predictions, actual physical hardware
carrier words and RGBA bytes over three seeds, consumer metadata/owned-bank
attacks and zero-error/disposal. Exercise ADD/MUL masks, swizzles, aliasing,
signed zeros, rounding ties, cancellation, overflow/subnormal nonfold cases,
known versus dynamic/overwritten/joined sources, and computed SIN/POW/F2I and
address consumers. Old admitted fixtures must remain byte-identical; explicitly
inventory formerly rejected known-producer extensions without changing old
evidence. Bind both larger full literal source hashes and their continued gate.

Record source-fault sensitivity, complete changed-runtime coverage and one
scrubbed pristine clone at the frozen source. Submit original binaries,
source/index digests and raw captures to a fresh adversarial critic.

## Adversarial verification

Predict rounding, post-modifier source version, masked writes and domain facts
before inspecting reports. Attack integer-manufactured unknown words, unsafe
results, missing source lanes, branch joins, indirect addresses, metadata
forgeries/accessors and source-size/depth/instruction bounds. The exact literal
emission must execute before a fact is used; a host-only result is insufficient.
Run all scoped acceptance angles, one bounded novel attack and sabotage the new
tests. Hold changed hunks against original native/V8 profiles; uncovered behavior
needs evidence or deletion. Preserve predecessor HELD evidence when unchanged.

## Verification log

### 2026-10-04 — worker — activation

Discard predecessor verified at bfd5c97f. Read-only full-body native prechecks
and diagnostic scratch compiler under /tmp locate PC38 SIN and PC31 POW as
the first final-retry failures. The bounded reproducer `ADD TEMP[0], IMM[0],
IMM[1]; SIN OUT[0], TEMP[0]` with normal known operands also rejects. This leaf
adds exact emitted known-producer authority; unknown uniform/geometry facts
remain separate prerequisites. Planning diagnostics are not acceptance evidence.

### 2026-10-04 — worker — exact-source submission

Frozen source: `cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee`, against verified
discard base `bfd5c97f7d71f510fccd2bd120f43b3d8b54159f`. Final commands:

```sh
VIRGL_KNOWN_ARITHMETIC_EVIDENCE_DIR=target/evidence/virgl-known-arithmetic-final make verify-E6-T12g6m1
python3 tools/virgl-known-arithmetic/cold.py --output target/evidence/virgl-known-arithmetic-cold
python3 tools/virgl-known-arithmetic/seal.py --hot target/evidence/virgl-known-arithmetic-final --cold target/evidence/virgl-known-arithmetic-cold --output evidence/virgl-known-arithmetic/worker
```

Both final commands passed at the frozen source; the detached scrubbed clone
was pristine before and after its acceptance. The seal preserves 100 original
members, including each actual sanitizer executable, raw/merged LLVM profiles,
source coverage, generated native/Wasm builds, full browser reports, V8 coverage
and screenshots. Evidence index: `evidence/virgl-known-arithmetic/worker/records.json`;
manifest: `evidence/virgl-known-arithmetic/worker/manifest.json`; recording:
`evidence/virgl-known-arithmetic/worker/recording.tar.gz`.

- Manifest SHA256: `e211633f326cd8e43e37a1585d9c892f84fa8d1eea5f13ac00bcf98d4104d15f`.
- Archive SHA256: `cde41a7216f85761baf09b9b8646777e8703f1f449b0af270b31daf87a3813aa`
  (9,910,405 bytes); index SHA256:
  `67a4726f63fe00ab9fd9f9c708c26ea89d47dff988aeb53fd6dd169d3fe017b0`.
- Hot receipt SHA256: `dab67a7162be905ae0a0ff19b8f155eeee7f517a9ed4f73724a137b32b709b4f`;
  cold report: `0270e3b238204a6889edb5c6bd8cffac86309a47d19a444a339b7f373eefbab2`;
  cold receipt: `18f778bee0326a068755886fb57fbf8c3fa86e002c69547aa8b049ae765c4a53`.
- Original hot executable SHA256:
  `28bbf65f360d93c674ec2b035d871136e958d42be6f00261820d5f922df606da`;
  original cold executable:
  `c4eeae93534814d9ccc1f2beded36781275946da8fb97dba0499a662150d74f2`.
  Both merged profiles: `abf869666cf3e495ad5e89059cf61f6e235df038d67ed592effdd5709f1cb863`.

The recording checks 11,608 independent rational ADD/MUL predictions in four
host rounding modes, 419 native/Wasm single/pair fixtures, 127 inert metadata
attacks and the inherited owned F2I bank guard. The 10,041 authenticated
predecessor cases retain 10,036 complete byte-identical results; the five
formerly rejected, fully known producer extensions are closed in
`tools/virgl-known-arithmetic/extensions.json`. Three physical Chrome/Metal
seeds each execute all 15 masks, both destination aliases, both operations,
an ADD-to-MUL chain, raw and converted byte outputs, dynamic numeric shadow
consumers and eight computed SIN/POW/EX2/LG2 equations: 7,512 carrier/math words
and 23,424 RGBA pixels per acceptance. Sync/async actual state consumers prove
owned bank replacement/restoration, withholding invalid finite bank uploads,
atomic nonfinite wire rejection and zero remaining objects/budgets. Actual
word and shadow shader-source corruptions each produce the expected independent
hardware contradiction while retaining zero GL/browser errors and disposal.
Numeric highp shadow zero sign is qualified; raw zero sign words remain exact.
IR/instruction storage remains 111,744/112 bytes. The complete original c5806d5f
and 92cb866a bodies still reject; dynamic uniform/geometry and indirect range
obligations, production integration and performance remain unproven. The claim
is submitted for a fresh critic's source, coverage and adversarial review.


### 2026-10-05 — fresh adversarial critic — VERDICT: needs-evidence

VERDICT: needs-evidence. No product contradiction was found. Runtime source
`cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee`, submission `5c6daa5f`, predecessor
`bfd5c97f`. Fourteen predictions were saved before worker-evidence inspection;
`critic/predictions.json` SHA256
`38fe79294e1c3bdb35000ac0c183ba5d6e25100c1101fbd15b5fadec9855f555`.
The sole failing dimension is original-recording coverage sufficiency.

- P0 lineage/pristine — HELD. All 100 original members authenticate, together
  with 334 hot and 310 cold source bindings. The actual hot/cold executables
  reproduce both archived filtered LLVM exports; re-merging the original raw
  profiles reproduces `abf869666cf3e495ad5e89059cf61f6e235df038d67ed592effdd5709f1cb863`.
  The scrubbed clone is pristine before/after at the frozen source. Points:
  `critic/authentication.json`, `critic/original-profile-audit.json`.
- P1–P4, P10 arithmetic/facts/grammar — HELD. Independent Python Fraction/integer
  RN-even calculations match every one of the original 11,608 WORD results and
  complete recorded 419 native/Wasm singles/pairs. Literal raw and shadow caches
  are recomputed from the actual TGSI operands before captured values. Additional
  original-binary attacks pass 4,108 independent words in four rounding modes and
  78 public native/Wasm singles/pairs: masks, aliased negated source versions,
  zero/cancellation/underflow, unsafe nonfolds, killed/missing/joined lanes,
  F2I/address boundaries, depth 16/17, instruction overflow, operand grammar and
  49,153-byte rejection. Original layout remains 111,744/112 bytes. Points:
  `critic/independent-oracle-audit.json`, `critic/native-attacks.json`,
  `critic/wasm-consumer-attacks.json`. Two critic fixture corrections preserve
  their initial failures and explain unchanged unused-ADDR/output-initialization
  rules in `critic/attack-prediction-correction.json`; they are not product faults.
- P5 predecessor preservation, P11 gate — HELD. Independently replayed all 10,041
  historical complete results from the original sealed Wasm. The same five
  closed source-hash extensions are the only changes; every inherited discard
  pair also compares in full. Both full original literal sources still reject.
  Production negotiation/public imports remain disabled. Point:
  `critic/wasm-consumer-attacks.json`. Unchanged predecessor semantic/attack/suite
  evidence is carried forward; no unrelated older criterion was restarted.
- P6 metadata, P8 ownership — HELD semantically. The 127 original inert policy
  attacks and inherited bank guards survive; 46 additional own-data/accessor/
  array/proxy attacks reject with zero getter calls. Sync/async actual GL captures
  prove copied safe banks, exact restoration uploads, finite out-of-range CPU
  state with no unsafe uniform upload, atomic nonfinite rejection and zero final
  state/resource budgets and GL objects. Points: `critic/consumer-capture-audit.json`,
  `critic/wasm-consumer-attacks.json`. Original V8 provenance gaps are separated below.
- P7/P9 hardware/source sensitivity — HELD. All hot/cold original physical
  words, little-endian RGBA bytes, digests and mathematical SIN/POW/EX2/LG2
  equations recheck independently from literal TGSI sources. Actual word/shadow
  source faults produce the expected contradictions with clean diagnostics and
  disposal. Numeric highp zero signs are expressly qualified (120 differences
  across hot+cold); raw sign carriers and byte outputs remain exact. Novel seed
  `2654435769` adds 2,504 exact carrier/math words and 7,808 RGBA pixels, including
  actual consumers, clean diagnostics and disposal. Points:
  `critic/independent-oracle-audit.json`, `critic/fourth-capture-audit.json`.
- P13 bounded novel attack/actual sabotage — HELD. Only a scratch header was
  mutated to round every tie upward. The actual compiled faulty program makes
  both the worker fixture and independent critic fixture fail on
  `+1 + 2^-24`: `3f800001 != 3f800000`, exits 1. Original runtime and worker seals
  remain byte-identical. Points: `raw/sabotage.stderr:1`,
  `raw/sabotage-worker.stderr:1`, `critic/sabotage.json`.
- P12-C1 coverage — NEEDS EVIDENCE. Predicted both known ADD zero identity returns
  execute; original hot/cold `raw_bits.c:known_add` AND
  `known_arithmetic.c:known_add` regions `raw_known_arithmetic.h:34:13-21` and
  `:35:13-21` each have count 0. The containing conditions execute; the nested
  return bodies do not. Record `supplemental-zero-return-vector` from
  `critic/attack-predictions.json` case 16, plus WORD inputs
  `ADD(0,0x3fc00000)` and `ADD(0x3fc00000,0)` in the corresponding original binary
  to cover both helper instances. Preserve raw/merged profiles and export using
  that exact executable. Point: `critic/coverage-audit.json`, original merged
  profile digest above. This is not an exact-line/segment lookup artifact.
- P12-C2 coverage — NEEDS EVIDENCE. Predicted the new wrapper selects inherited
  coordinate metadata; original hot/cold `bridge.c:stage_result` region
  `bridge.c:1710:115-142` has count 0. Record `supplemental-coordinate-wrapper`
  from `critic/attack-predictions.json` case 54, assert v40/base v38 and retained
  coordinate policy, whole native/Wasm pair parity and Node parser approval, and
  retain the corresponding original LLVM profile. Full literal texts and exact
  text hashes are also in `critic/verdict.json#/findings`.
- P12-J1 coverage — NEEDS EVIDENCE. Predicted canonical two-operation validation
  and inherited-base recursive failure have original V8 execution evidence.
  Every sealed original browser profile instead has count 0 at offsets
  `11519–11565` (`constant-domain.mjs:152`, second operation) and `11978–11987`
  (`:156`, `: checked`). Recorded original Node results exercise them semantically,
  but that Node V8 profile was not captured. Record original-source
  `NODE_V8_COVERAGE` for valid `both-operation-wrapper` metadata (`[ADD,MUL]`) and
  otherwise valid v40/SIN metadata with `sineContract` deleted; bind the script
  source hash and positive counts in both exact nested ranges, including inert
  getter assertions. Point: `critic/coverage-audit.json`. No new GPU proof is
  demanded for these inert metadata branches.

COVERAGE: all 126 changed nonblank native source lines and 23 changed JS lines
are individually classified in `critic/coverage-audit.json`: native 80 HELD,
43 type/config/comment/block waivers, 3 lines needing the named proof; JS
17 HELD, 4 waivers, 2 lines needing original V8 provenance. Earlier broad
zero-count switch regions cannot override the narrower executed ADD/MUL region
(15,312 hits). Shared integer returns exercised in the standalone oracle are
not falsely labeled dead because a duplicate compiler instance lacks that
particular path. Unchanged UCMP and standalone predecessor profile selectors
carry their old source/result proof, with specific reasons recorded.

SUITE: no promotion until these proof gaps clear. Independent exact oracle,
fixtures/seed, metadata attacks and actual source/test sabotage recordings are
sealed promotion candidates. The 4,202 historical untracked paths remain intact.
Worker seal manifest/archive/index retain their submitted digests. Status is
`evidence-needed`; perform only the named supplemental native/Node recordings
and touched harness checks. Carry every HELD result forward while its boundary
source/dependency and worker evidence digests remain unchanged. The accepted
pristine clone, original hardware captures and unrelated gauntlets need no repeat
without a portability finding or runtime change.

Commands and raw outputs: critic `authenticate.py`, `original_profiles.py`
(original `xcrun llvm-profdata merge -sparse`/`llvm-cov export`),
`independent_oracle.py`, `independent_attacks.py`,
`NODE_V8_COVERAGE=... node wasm_consumer_attacks.mjs`,
`consumer_capture_audit.py`, scratch `sabotage.py`, fourth physical
`node tools/virgl-known-arithmetic/browser.mjs --seed 2654435769`,
`coverage_audit.py`, `final_audit.py`, `seal.py`; all retained below.

Critic seal: `evidence/virgl-known-arithmetic/verifier/`, 62 original members
including predictions, complete original coverage exports, actual independent
fixtures/native stdout/profiles, Node V8 coverage, fourth physical capture and
actual sabotage source/binary/output. Digests:
- manifest `c9b4adfe834ac13e6f343ab8048ee059fc67b2d3a6405335d8ed6d6a7aa1502f`
- archive `baf7e9f401baff5e1042f7b826345e6893dfee8e7069bec0e11390470b71f67f`
- index `40afc73663871d44d0da14430e4e1d6bb44a531a77adbbdd241be8a11f3be315`
- verdict `977540db11b82f90f9cdc26254877e575e5b2d07aee25fc1dae13ce0eee878da`


### 2026-10-05 — worker — targeted coverage supplement

Runtime remains byte-identical to `cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee`.
The harness-only repair is frozen at `5353cf8591a94dbd962f92ee69b488ff18b8ebf0`.
No earlier worker/critic seal is overwritten. All HELD arithmetic, hardware,
legacy, ownership, novel/sabotage and pristine-clone claims are carried forward.
No runtime or portability change requires restarting those proofs.

The exact nine command records and their outputs are in supplemental
`commands.json` and `checks.log`. They include affected Node/Python/Bash syntax,
`git diff --check`, task policy, and the following for each corresponding
original executable and Wasm module from the authenticated worker archive:

```sh
node tools/virgl-known-arithmetic/supplement.mjs ORIGINAL_KNOWN_TEST ORIGINAL_WASM_MODULE target/evidence/virgl-known-arithmetic-supplement-final/KIND
python3 tools/virgl-known-arithmetic/receipt.py --supplement target/evidence/virgl-known-arithmetic-supplement-final/KIND/report.json ORIGINAL_NATIVE_REPORT
python3 tools/virgl-known-arithmetic/supplement-seal.py --input target/evidence/virgl-known-arithmetic-supplement-final --output evidence/virgl-known-arithmetic/worker/supplement
```

`KIND` is hot or cold; the archived commands contain the exact paths. The binary
bytes equal the respective original hot/cold artifacts, rather than a rebuild.
Both runs execute the critic's exact zero-return and coordinate fixture texts,
two literal ADD zero identities in all four rounding modes, a complete ADD/MUL
wrapper and the original ADD/SIN fixture. All four complete singles/pairs match
original Wasm. Specific LLVM kind-0 regions now have counts `[8,4,4,4,4]` in both
runs: both raw_bits.c returns, both standalone oracle returns and the known
coordinate selector. Original-source Node startup V8 coverage gives counts
`[1,2]` at exact offsets `11519–11565` and `11978–11987`. Coordinate metadata is
v40/base v38 with its inherited policy, valid two-operation metadata approves,
and deleting inherited sineContract rejects. Three accessor attacks invoke
zero getters; native and Node stderr are empty. Layout stays 111744/112.
The new replay guard is part of the future canonical acceptance recipe.

Separate supplemental seal: `evidence/virgl-known-arithmetic/worker/supplement/`,
42 authenticated members including both actual original executables, original
Wasm modules, fixtures, complete native/Wasm/consumer results, raw/merged LLVM
profiles, full original coverage exports, Node V8 profiles, command logs and
frozen harness sources. Manifest SHA256
`eafc73232ac1d2d807bde62ad21c8a11473b985c3ad06ee85ce3194d9c7a4841`;
archive `987800d6a1d94ab0527b406f88236bf818c6f19374c701e68f940edcc3e04c5c`
(3808404 bytes); index
`7784a22b0ab540b159241182c0281dad8c2ac534204f7653138219f63e681d97`.
The runtime head and harness head are bound separately, and original worker and
critic digests are retained in the manifest. This is a worker coverage claim,
submitted to the existing independent critic for incremental review. Full
original compositor admission, live offload, and performance remain unproven.

### 2026-10-05 — incremental fresh critic — VERDICT: verified

VERDICT: verified. Runtime remains `cba5ae02ba16dc15b7b51d5dcdd808f88fcaf1ee`;
harness source `5353cf8591a94dbd962f92ee69b488ff18b8ebf0`, submission
`3b55b8b6685885024cafe6d384cd45405a08547e`. This closes only C1/C2/J1 from the
`a8dfaf55` critique. Six incremental predictions were saved before inspecting
the supplement: `evidence/virgl-known-arithmetic/verifier/supplement/predictions.json`,
SHA256 `6e2897ead7da34b19bdf3ca10809532e5133a85fea712932f88e4b7754135680`.

- I0 lineage — HELD. All 42 supplemental members authenticate. The six harness
  sources equal their frozen Git bytes; all five runtime bindings and the entire
  compiler/consumer dependency boundary are unchanged. Each hot/cold native and
  Wasm artifact equals its corresponding original worker archive member. Both
  earlier seals retain their exact manifest/archive/index digests. Point:
  `verifier/supplement/authentication.json`; worker supplement manifest
  `eafc73232ac1d2d807bde62ad21c8a11473b985c3ad06ee85ce3194d9c7a4841`.
- C1 zero identities — HELD. Re-merging each original supplemental raw profile
  reproduces `e1b22983ce2dba1f0bcc1f7127f31ac87696a57275cef9e641e6ebc80311d9d9`;
  exporting it with that recording's corresponding original executable reproduces
  its complete archived LLVM export byte-for-byte. The exact kind-0 returns
  `raw_known_arithmetic.h:34:13–34:21` and `:35:13–35:21` have counts 8/4 in
  `raw_bits.c:known_add` and counts 4/4 in `known_arithmetic.c:known_add`, in both
  recordings. Two literal ADD zero identities return `0x3fc00000` in four host
  rounding modes. Exact prior case16, text SHA256
  `b0909ad597f132fa4662444c8172098183fb694c2859aff2d6a9047e7e5d4db3`,
  exercises the compiler returns and complete native/Wasm singles/pairs. Point:
  `verifier/supplement/recording-audit.json:variants[*].llvm[0..3]`, original
  supplemental native.log lines1–4. Independent rational predictions also check
  every emitted word/shadow cache across all four fixtures, including 3/4 and 3/8.
- C2 coordinate wrapper — HELD. Exact `bridge.c:stage_result` region
  `1710:115–1710:142` has count 4 in each corresponding original executable.
  Exact prior case54, text SHA256
  `c4b060eb6d1914bfb388991e1e3a6895398c42b9e675c525c9e08f557ab5b312`,
  produces v40/basev38 and inherited lower-left/half-integer coordinate metadata.
  Full native/Wasm single/pair results match and the original-source consumer
  approves. Points: `recording-audit.json:variants[*].llvm[4]`, original
  supplemental native.log lines5–6 and consumer.json results[1].
- J1 JavaScript proof — HELD. Original-source Node V8 profiles have exact nested
  range counts 1/2 at 11519–11565 and 11978–11987 in `constant-domain.mjs:152,156`.
  Source SHA256 remains
  `0be4e058dc23250a3116ac9360613a404739d807b858b926ee4d84205126b40b`.
  Valid `[ADD,MUL]` approves; deleting only inherited sineContract from original
  otherwise-valid ADD/SIN metadata rejects. Three accessor attacks invoke zero
  getters. Points: `recording-audit.json:variants[*].v8`, original supplemental
  consumer.json results[2] and attacks[0]; full Node profiles are retained.
- H1/H2 touched harness — HELD. A direct replay with the original hot executable
  and original Wasm passes. Actual native-output word/shadow corruption fails
  the literal assertions at `supplement.mjs:82,83`; reversed policy operations
  fail consumer approval at `:22`. Sixteen missing/zero coverage, executable,
  count/rounding and provenance receipt attacks reject. Node/Python/Bash syntax,
  diff and task-policy checks pass. Points: `guard-attacks.json`,
  `final-checks.json`, actual outputs in the incremental archive. Critic source-line
  and duplicate-shadow injection corrections preserve their initial attempts in
  `guard-attack-correction.json`; no faulty report was accepted. Canonical shell
  invocation and receipt call are declarative wiring to these directly exercised
  implementations, individually waived without restarting unrelated acceptance.

P0–P11 and P13 remain HELD from the original critique: integer arithmetic,
literal authority, unsafe/unknown facts, joins/address/grammar/storage, all old
results and the closed extension inventory, metadata/bank ownership, actual
physical GPU words/RGBA/math and source faults, novel attacks/sabotage and the
accepted scrubbed pristine clone. Their runtime, dependency and evidence bytes
are unchanged. P12 is now HELD: all 126 changed native nonblank lines classify
as 83 HELD/43 prior waivers; all 23 JS lines as 19 HELD/4 prior waivers; zero
remaining executable proof gaps. LLVM containing/nested region semantics are
retained, rather than guessed exact-line counts. No full, cold-clone or GPU
repeat was needed. Full original compositor sources, dynamic uniform/geometry/
indirect ranges, production negotiation/imports and performance remain gated.

SUITE: adopt the already committed `supplement-cases.json` literal zero identity
and coordinate texts from the independent critic, plus the two policy fixtures,
as permanent deterministic regressions through `supplement.mjs` in the canonical
`make verify-E6-T12g6m1` recipe. Complete results, literal caches, inherited policy,
inert getters and specific original coverage points are asserted. Promoted
fixture/guard/receipt/recipe source hashes are sealed in `final-checks.json` and
the incremental manifest. The broader independent oracle, novel seed and real
sabotage evidence remain preserved in the first critic archive.

Incremental critic seal: `evidence/virgl-known-arithmetic/verifier/supplement/`,
137 indexed members, 6,423,178 archive bytes: authenticated original binaries,
raw/merged original profiles, complete independently re-exported LLVM coverage,
original Node V8, complete results, positive replay, actual guard fault outputs,
receipt attacks and promoted-source bytes. Previous worker/critic seals are
immutable; all 4,202 historical untracked paths retain filename-list SHA256
`17fd92fd454a14a44fddc4db0beadc4246a92f4ff749e57a8e2762aca638f8ac`.

- Manifest `b09541da5a384c3b1edf283e6ec25725616e865cfd55eb29bc9f516192ffe532`.
- Archive `97c4e8b32de9631b7951731dfe9b1e41674a3b5fbb859b62136afd7826735dd7`.
- Index `3aa4773e5e701eaf743ddcdd6c91ef3d1969297f491ac3054dedec19561bfb51`.
- Verdict `f7f1bde9f1d31559e8427d7d5acad6305896797af83e3ccfd93bd11b7dfac114`.

Commands: incremental critic `authenticate.py`, `audit_recording.py` (original
`xcrun llvm-profdata merge -sparse`/`llvm-cov export`), original-hot-binary
`supplement.mjs` replay with Node V8, `receipt.py --supplement`, `attack_guard.py`,
`final_checks.py`, `write_verdict.py`, `seal.py`; policy and queue regenerated
before committing verified status. No runtime implementation was edited.
