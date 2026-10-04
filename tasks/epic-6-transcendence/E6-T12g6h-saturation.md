---
id: E6-T12g6h
epic: 6
title: Admit bounded MOV and DIV saturation modifiers
priority: 525.027010576
status: verified
depends_on: [E6-T12g6g2]
estimate: S
risk: high
capstone: false
---

## Boundary

Add only captured MOV_SAT/DIV_SAT spellings and apply the TGSI-defined clamp after the underlying numeric operation. Preserve modifier locality, masks, source authority and existing plain MOV/DIV semantics. Other unproved saturation/opcode combinations remain rejected.

Production GPU negotiation, live demo imports and caps remain disabled. No FPS
or MIPS claim follows from this isolated compiler boundary.

## Deterministic acceptance

`make verify-E6-T12g6h`: Independent clamp equations and actual words/pixels below0, at0/1, between, above1 and near rounding/divisor boundaries. Test numeric domain exclusions, all lanes, aliases, adjacent saturated/plain instructions and clamp order faults through native/wasm and WebGL2. No undefined division or raw-word authority shortcut.

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

### 2026-10-04 — worker — implemented

Frozen source `81dfb7c010eb117d93335bc3a7c91878546449f8`; runtime
`31641b3fb5fa4e09256531df67dfaaadf651b0ea`; verified predecessor
`bad92bfdaba16295b064a78c0767652da09be158`. The later two commits repair only
evidence: the ESSL-permitted interchange of numerical signed zeros and byte-set
comparison order. Raw ordinary MOV/copy predictions remain exact. No runtime
changed after the native/Wasm recording.

Commands: `make verify-E6-T12g6h` at the runtime head; after the evidence repair,
`node tools/virgl-saturation/browser.mjs --output target/evidence/virgl-saturation/gpu-$seed --seed $seed`
for seeds `1640573655`, `3073696041`, `3798507267`, and the same command with
`--output target/evidence/virgl-saturation/fault-$fault --fault $fault` for
`lower`, `upper`, `order` (all must fail); then
`python3 tools/virgl-saturation/receipt.py target/evidence/virgl-saturation`.
The acceptance target records syntax/guard checks, ASan/UBSan native and pinned
parser/converter witnesses, Wasm singles/pairs, retained originals, promoted
critic guards, consumer ownership, legacy responses and physical GPU results.

Cold command: `python3 tools/virgl-saturation/cold.py --output target/evidence/virgl-saturation-cold`.
One pristine clone at the frozen source passed native/Wasm/first-seed proof,
then lost Chrome's execution context during the second seed. Recovery command
`python3 /tmp/wasm-vm-saturation-cold-recovery.py` reran only the remaining two
seeds, three faults and receipt in that same scrubbed, unchanged clone. The
script, original failure, exact commands and clean before/after checks are
archived. No mathematical result was available from the interrupted attempt.

Seal command: `python3 tools/virgl-saturation/seal.py --hot target/evidence/virgl-saturation --cold target/evidence/virgl-saturation-cold --output evidence/virgl-saturation/worker`.
The seal contains 123 authenticated members and both actual sanitizer binaries.
Archive SHA256 `0f23bfac558168d1207a3841028243ba5d0d1c4cb9f34faac2d2ebf8fa220b53`;
index SHA256 `3652615c51b879418d967067e6394b978f30fa118085b0b04a3d4c6ef18b185b`.
Hot receipt SHA256 `0273c4d54a0d67f7fc2ea64c3f9eacb04c09f94205eda3f0a0b0ecf27620690f`;
cold receipt SHA256 `55e23cf85c16f7fcd7b1dcb5468e826c7c1be0aa322cbf21e6536b073da82ab3`.

The recordings demonstrate 1,313 native/Wasm singles and pairs, 1,245 actual
pinned witnesses, 2,933 unchanged whole predecessor responses, 836 metadata
attacks, 18 owned banks and four composed prior bases. Each hot/cold set checks
121,032 physical words and 79,872 pixels through both backends, four exact
captured statements, all masks, aliases, versions, bank A/B/A updates, restoration
and source modifiers. All three emitted-source faults contradict the independent
oracle; successful runs dispose all GL/renderer objects with zero errors. The
independent Fraction receipt authenticates predictions and readbacks. The
defensive unsafe-known-numerator branch is unexecuted after old numeric authority
rejects such sources; this premise is explicitly submitted for coverage review.

This boundary adds no computed F2I range facts. Complete original compositor
bodies, production negotiation and guest caps remain gated. No guest-offload,
FPS, MIPS or deployment claim is made; fresh verification is still required.

### 2026-10-04 — fresh adversarial verifier — VERDICT: verified

VERDICT: verified. Reviewed the complete `bad92bfdaba16295b064a78c0767652da09be158..8bb489e04170afd3a9158afeb4a9808386db5997` diff before
recorded states, wrote P1–P14 first, and attempted to refute every scoped criterion.
All fourteen predictions are HELD. Runtime `31641b3fb5fa4e09256531df67dfaaadf651b0ea` and frozen source
`81dfb7c010eb117d93335bc3a7c91878546449f8` remain unchanged; this session edited only critic guards, acceptance
wiring, status/log/queue and evidence. Report citations below name archive members
in `evidence/virgl-saturation/verifier/recording.tar.gz`; `verdict.json` and the
index bind every report, exact command, source and raw point.

- **P1 seal/source — HELD.** Authenticated all 123 worker members and 610 tracked
  source bindings, including both actual sanitizer binaries and original profiles.
  Evidence-only signed-zero and byte-set repairs did not change runtime.
  `authentication.json:3`, SHA256 `6cf7b58e069f4e5e148fa142cd1ebfa8d3dd1f7c92b8f94ff8b7d0ef4d204ebd`.
- **P2/P4 domain, authority, versions — HELD.** 1,160 independent native/Wasm
  cases reject zero/special/subnormal/unknown/out-of-domain divisors, enforce
  consumed post-modifier versions and exponent margins, and attack killed/saved
  facts, aliases, liveness, masks and control-flow joins. Unit and nonunit paths
  consume existing numeric authority. The 88-case producer matrix attacks the
  defensive authority premise; 16 cases poison unused/consumed divisor lanes.
  `independent-regressions.json:4`, SHA256 `cc47765bbad6f807baaca911f23a37700d163c7da062c664731edc0c9fa64692`.
- **P3 equations and actual hardware — HELD.** Independently interpreted actual
  TGSI with Fraction arithmetic and separate binary32 rounding, then checked
  all 242,064 hot/cold words and 159,744 pixels on owned and pinned Mesa backends.
  Division uses the ESSL highp 2.5-ULP bound and permits numerical zero signs;
  ordinary owned raw MOV/copy and untouched lanes stay exact. No worker oracle,
  emitted GLSL inverse, or recorded expected value supplies these equations.
  `source-semantics.json:3`, SHA256 `c64f91bb251a7e8018678867e7c164dc1d02b4cd026c10db93343339601f17ca`.
- **P5 locality, clamp order, ranges — HELD.** The independent guard rejects
  unsupported SAT/PRECISE spellings and computed F2I range authority. An additional
  physical three-program probe checked 72 words: adjacent plain DIV stays
  `[-2,-.25,2,2]`; masked aliased MOV_SAT reads the old `.wzyx` and yields
  `[1,-.25,0,2]`, preserving untouched DIV words. Predictions were written before
  readbacks, not inferred from them. `locality-semantics.json:3`, SHA256 `7e0cf16603014a88515b11a1f26953a186c37a26a6824475d8d8be4ca7d48dce`.
- **P6 actual native/Wasm/pinned converter — HELD.** Replayed both archived
  sanitizer binaries with their exact fixture; transcripts are byte-identical,
  no sanitizer error appears, and original raw profiles merge/export identically.
  Independently parsed 2,626 requests and 2,490 pinned token witnesses, including
  actual SAT masks. Complete Wasm pair sources also match physical captures.
  `native-replays.json:3`, SHA256 `4cd7aa4d6c624524ca319f760eece1b35539fad9530194697f5cec170c399f69`; `native-source-parity.json:3`, SHA256 `13c612fe20438bac24e0ffb2fabae3ceb073adcc7f43886c5b1c94d7452f1e95`.
- **P7 metadata ownership — HELD.** 1,876 hostile attacks across 26 distinct
  contracts preserve complete old obligations, descending versions, stages,
  immutable copies and strict shapes/keys/types. No accessor executes; malformed
  ranges/banks reject. `consumer-attacks.json:3`, SHA256 `4bd9701865557187d893e55eacca743b938a857f7fcff2eaf3db15332b29f856`.
- **P8 owning banks/lifetime — HELD.** Independently checked physical uniforms,
  mutated-caller A/B/A snapshots, sync/async restoration and all 18 bank variants.
  Nonfinite updates reject atomically; successful and faulty runs dispose objects,
  leave zero live budgets and report no unexpected GL/browser errors.
  `source-semantics.json:3`, SHA256 `c64f91bb251a7e8018678867e7c164dc1d02b4cd026c10db93343339601f17ca`.
- **P9 reflection, schedules, captures — HELD.** Actual shaderSource events bind
  current pair/pinned sources. All scheduled positions execute: each seed has
  305 vertex probes and 1,664 fragment probes, masks 1–15, both carriers, all
  32 planes, aliases/swizzles/control arms, and four exact captured instructions
  on each backend. Reflection types/extents and physical banks match.
  `plan-audit.json:3`, SHA256 `48ad2484c327c5973707cc55f6580b1129ee44c9957de842d5355ba5b3ebab00`.
- **P10 numerical faults and sabotage — HELD.** All six actual emitted-source
  lower/upper/order faults contradict the independent capture guard and dispose
  resources. For example, hot order fault vertex 225/vector 0/lane 4 observes
  `0x3f000000` outside predicted `0x3f400000` ±2 ULP; raw capture
  `76eab8c6ffb75662ab50457fc5239f8ced00566ceceb8dd2c75818663b28384c` is at
  hot fault report line 1,631,264. Copy-only native lower-bound sabotage admits
  forbidden 0/0 and fails `bounded-division-0-0-false`; fixture sabotage calling
  raw word 1 normal fails `numeric-authority-MOV_SAT-1-false` against correct code.
  `sensitivity.json:3`, SHA256 `d557fa5a0ad0b9913756bc58ae9951bc19a7aff52c3f552c7d569d15a28d1851`.
- **P11 changed-hunk coverage — HELD.** Actual recorded binaries/profiles and
  five V8 records cover 22 runtime hunks/85 added runtime lines. Every line has
  hits or an explicit static/type/comment/control waiver; no dead/unproven hunk.
  The predicate has 3,172 calls per set. The true edge of
  `!safe_raw_float(a)` has zero hits and is **waived**, not called exercised:
  existing numeric authority rejects raw unsafe words first; fully known numeric
  producers preserve safe words, unknown arithmetic erases facts, and copy/join/
  negation preserves the invariant. Source points `raw_bits.c:77–87,127–153,
  208–219,265–339` and 88 independent producer cases support the argument.
  Defensive rejection stays as a future invariant guard.
  `coverage-audit.json:3`, SHA256 `e4ce9e4bd3c1d972044b9e5fe30ac980ba6f3f2babc37248e1089571129d2ca9`.
- **P12 pristine clone — HELD, qualified.** One exact-source clean clone with
  scrubbed environment was inspected directly. The original second-seed browser
  context interruption and failed make are preserved; they supplied no numerical
  state. Only missing two-seed/three-fault/receipt commands were recovered in
  that same unchanged clean clone. This is incremental completion, not a claim
  of an uninterrupted cold make or an extra clone.
  `final-checks.json:182`, SHA256 `196ae9a8995237e9f2798b25d78059767cf9c6946f9ded573289bc720191c3e7`.
- **P13 carried HELD — HELD.** Authenticated seven predecessor critic seals and
  unchanged boundaries: 247 dependencies, six helpers/critic oracles and seven
  production gates. All 2,933 whole predecessor responses per set match; precise
  FRC retains its 36,096-word capture and real negative-complement fault.
  Original partitions remain 23/25 and 5/112; both complete compositor bodies
  remain rejected. `carry-forward.json:3`, SHA256 `86fcfce950d4e17372a4eff7515557e99f36e5873052eba8f534a3c7da9b12ba`.
- **P14 independent seed and novel attack — HELD.** Physical seed 19,088,743
  adds 39,576 independently checked words/26,624 pixels on both backends. All
  served bytes match frozen runtime; the sole untracked critic guard was not
  served. The novel lane/version poison cases and physical adjacency/alias probe
  above held. `fourth-seed-semantics.json:3`, SHA256 `698e6c296455a88772795ac2ed503000d4d6d40df065ff8b528023c77b7f1a71`.

The original critic producer-case failure is also archived. Its first expectation
ignored the already-stated quotient margin: FRC_PRECISE(2^-126)/2 correctly
rejects at exponent difference -127. Only that critic expectation was corrected
before the complete matrix; no product contradiction was found
(`expectation-correction.json:3`, SHA256 `d896962971edfb9484ff6367967b2e3ee7d2fcf777216ee9a937d5dc38d54155`). The numerical budget is
grounded in [ESSL 3.00 §4.5.1, printed page 52](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf).

SUITE: promoted `saturation-regressions.mjs` (1,160 native/Wasm cases) and
`saturation-capture-regressions.py` (source-equation checks on actual full-word
carriers and all fragment planes), wired into `make verify-E6-T12g6h`. Both guards
passed directly and failed bounded sabotage. Syntax, Python compilation, shell
syntax and diff whitespace checks passed. Exact commands and test SHA256s are in
`verdict.json`. No runtime repair was made. rr is waived by current policy; no
FPS, MIPS, live guest, full-original, production admission or deployment proof
is claimed. The private compiler boundary alone is verified.

Critic seal: 100 authenticated members; archive SHA256 `cd1a07fa45456a46060dabe52d8a91c6521fd46d11bdac3ff5f7a3480654cead`; index SHA256 `690b88eeb9125b4afccba8e7ff06dbc376f5183e04a60e70ed0d7fb8be730df5`; verdict record SHA256 `4f16b8765090e6e70698f5544535bb2ebd3ba3eef49a7c9b191db5f0332c2863`.
