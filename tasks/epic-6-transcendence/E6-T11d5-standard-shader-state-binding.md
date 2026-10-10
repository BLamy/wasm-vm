---
id: E6-T11d5
epic: 6
title: Execute standard guest shader bindings through owned renderer jobs
priority: 525.027038
status: verified
depends_on: [E6-T11d4]
estimate: S
risk: high
capstone: false
---

## Boundary

Add an explicit host-selected `createVirglStandardAsyncRenderer` factory using
the existing resource/state/cache/job engine. Keep the old factories, command
profile, exact/private metadata admission and strict constant contracts intact.
No packet, provenance label, metadata fact or caller option may select a weaker
facet. This is the one standard shader-binding boundary; production device
negotiation, full GLES API support and live guest boot remain gated successors.

Own and validate the standard compiler's complete metadata with descriptor-only
records and dense bounded arrays. Admit native highp semantics, word uniforms,
GENERIC 0..15 at physical IO 0..31, smooth/flat word interfaces, native fragment
coordinates/discard, the measured system block, and checked 2D sampler slots 0..15
in both stages. Derive the pair interface internally and validate paired stage
outputs before linking. Restrict execution to the existing single COLOR0 target;
compiler support for other targets/broadcast must fail explicitly at this slice.

Add a separate standard submission decoder sharing the bounded packet grammar.
Only this decoder admits up to 2048 raw words in VS/FS slot0, including arbitrary
32-bit encodings; the old finite-word decoder and limits stay unchanged. Upload
exact owned words through active reflected uvec4 arrays, bounded by declared
extent and actual host component limits. Zero every absent active word so a
short/reset/unbound bank cannot borrow stale native state. Reflection can remove
unused native uniforms/samplers without inventing exact numerical authority.

Both-stage sampler view specialization, raw flat linkage and shader variants
participate in owned generation/cache keys and byte accounting. Reuse existing
leases, actual vertex/index fetch checks, async input/output exchanges, later-task
zero-timeout fence polls, cancellation/drain and complete state restoration.
Native undefined shader domains retain standard behavior; there is no GPU loop
termination or exact floating-point certificate.

## Deterministic acceptance

`make verify-E6-T11d5` records independent literal wire/metadata predictions,
actual fixed-memory compiler results and hardware renderer-job draws. Cover
VS/FS slots 511 and 2048-word bounds, nonfinite raw words, malformed tails with
zero mutation, short/reset bank zeroing, maximum physical/generic indices,
fragment-derived smooth/flat interfaces and native coordinates/discard. Probe
both-stage slot15 samplers with distinct real images and nonidentity/all-constant
views; record actual bound units, uploaded/read native words, sources, reflection,
buffer bytes and independently recomputed full pixels.

Execute complete captured 92cb and c580 sources and authentic original banks via
queued wire commands and real transfers/draws rather than private exact admission.
Record A/B/A restoration, cached relinking and variant changes, retained selector
identity/handle reuse, job input ownership and varied later-task schedules. Fail
wrong-facet/accessor/oversized/spoofed metadata before native draw. Quotas/errors
must clean up all owned objects and retain useful structured provenance.

A real uniform upload, vertex view or flat linkage mutation must fail its named
independent pixel oracle. Carry unchanged compiler/native/transport proofs and
run affected old renderer regressions. At a frozen head record the complete
submission once, run one final pristine exact-head clone with scrubbed environment,
seal original bytes/source/coverage/browser records, and submit to a fresh critic.
This isolated renderer factory is not imported by the production demo yet.

## Adversarial verification

Predict uploaded native words, reflected array extent, interstage types, texture
units and specific pixels before inspection. Attack getter/proxy/sparse/foreign
metadata, old exact authority in the new facet or standard metadata in the old
facet, over-limit counts/IO and incompatible paired metadata. Independently choose
one well-defined shader/texture combination; attack shortening/reset after a
previous full bank, stage/context swaps, optimized-out reads, view changes,
cache eviction and handle reuse. Exercise varied job schedules and prove no
readback/consumed request escapes its fence or owned identity. Hold every changed
runtime hunk against deterministic/physical evidence or a narrow justified waiver.
Sabotage the promoted oracle once. Do not impose full API/guest boot/throughput
claims on this isolated binding slice.

## Verification log

### 2026-10-09 — worker — pending readiness boundary

The standard compiler can emit a fragment uniform array with 512 raw vectors,
while `parseConstantDomain` rejects its metadata and `decodeSubmission` rejects
an otherwise valid2048-word inline FS constant bank. A new explicit consumer and
host-selected decoder are required; weakening the existing exact facet would
confuse its numerical/word proof. Activate only after E6-T11d4 is verified.

### 2026-10-09 — worker — implemented; frozen renderer recording

Runtime/acceptance head `365b3cf3d076637c347c7e9802420f847d09fbed` (diff from
`11558494`). Exact commands:

```sh
VIRGL_STANDARD_STATE_EVIDENCE_DIR=target/evidence/virgl-standard-state-final make verify-E6-T11d5
python3 tools/virgl-command/standard-state-cold.py --output target/evidence/virgl-standard-state-final-cold
python3 tools/virgl-command/standard-state-seal.py target/evidence/virgl-standard-state-final target/evidence/virgl-standard-state-final-cold evidence/virgl-standard-state/worker
```

The frozen gate passes 542 literal wire predictions and 32 metadata attacks,
then 55 actual hardware queued frames with 2,371,168 independently checked
pixels. It records native uniform words, reflection, sources, vertex buffer
bytes, distinct texture units/images, input/output ownership and actual fences
at delays 0/2/5 with command step budgets 64/1/2. Short and empty banks clear
native suffixes; A/B/A restoration, cache reset/relink/pressure, retained selector
name reuse, raw flat words/attribute15, all sixteen generic semantics, both-stage
sampler15 views, native fragment coordinates/discard and built-in IDs execute.
The complete captured 92cb and c580 programs execute through literal queued
shader/constant/transfer/draw packets with all three authentic original banks.
Every original frame's observed maximum RGBA8 error is zero (acceptance budgets
are 1, or 6 for c580's inherited native highp color equation). Real compiler
errors, foreign/accessor metadata, pair mismatch, quotas and malformed tails
fail before native draw and clean up. Two jobs cancel after actual native draw
and drain their completion fences. Chrome's active built-in integer reflection
uses location -1 and is checked separately from bound guest attributes.

A served-state mutation skips short raw uploads and fails specifically at
`short-bank-0 independent physical pixel oracle`; the original first pixel is
[96,64,48,159] and its mutated observation is [128,128,143,191]. An offline audit
reconstructs shader/constant/view state from recorded original wire bytes,
checks actual read native words and saved full pixels, and catches that fault.
All nine directly affected old decoder/resource/state/draw/async/raster/cache/
blend/float gates and the promoted blend/float boundaries pass once at this head.
The C/compiler and Rust/device boundaries are unchanged: carry E6-T11d4 at
`9323b445` and their prior native/wasm/guest evidence. The old metadata/numerical
contract prefix is byte-identical (SHA256
`bfd25f78876cb1b60c7d04de81245c5d9e3938fb4d34f6b0e723961d896afdd2`).
The actual rebuilt Wasm remains 16 MiB, SHA256
`40772f2a609b803a11f97a3cdd35087810964c2dd35662e0bb143e7144f97287`.

The pristine exact-head clone at
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-standard-state-cold-fnt6r7vr/wasm-vm`
passes the same complete acceptance with scrubbed build environment and no
checkout changes. Hot/cold V8 coverage, browser reports/screenshots, original
input bytes, generated modules, logs and pixel captures are sealed in
`evidence/virgl-standard-state/worker/{manifest.json,records.json,recording.tar.gz}`:
228 records, 9,228,643 archive bytes; archive SHA256
`553a510d719a5a4dd2617ec3ae1d126ee3a77ed4cbec5d113fb254b33c69d3d0`,
index `efc78b0e268437e163c675bf1c601e3ee41f1c5272de39b2240b9c6921501ff4`,
hot receipt `c0649f4e28aa4a2ed7ce758f4777b1b32939bcd51e5d7e043f5e72c2fbe82c52`,
cold report `d6f52779845212d7ba72b8869019a954f3412f52890fc4f2b874fabf1af81183`,
cold receipt `82d9846e1fcaf59167fe9089ff004c9491275007d2dde28ee48d2182bd566d9f`.
This is a standard shader-binding prerequisite only: single COLOR0, the existing
2D texture/storage and draw profile, no production negotiation or live guest/API/
scanout/throughput claim. Production demo entry points remain gated. Submit to a
fresh adversarial session; the worker has not set verified.


### 2026-10-09 — fresh verifier — scoped native-admission refutation

VERDICT: refuted

- F1 raw uniform omission — FAILED. Predicted rejection before draw when both
  stage/pair metadata coherently omit an active FS bank while preserving real
  compiler GLSL. Both independent runs instead complete `drawArrays(5,0,4)` at
  turn 16 (`ok:true`, `gpuComplete:true`): active `fsconst0` has three vectors,
  twelve zero native words despite the full literal bank, and first pixel
  [0,0,0,0] rather than [91,117,153,140]. Frozen diff points:
  `constant-domain.mjs:857`, `state.mjs:517`. Evidence:
  `evidence/virgl-standard-state/verifier/findings.jsonl:1`, recheck report
  `browserResult.result.cases[0]`, SHA256
  `6ad6e395c8de953ebca9ce351b32b8d7f4ace556603c141e8e3acb97a32abbdc`.
  Account for every active native default-block raw uniform before draw.
- F2 sampler omission — FAILED. The same coherent omission of FS samplers also
  completes one draw at turn 16. Native `fssamp2`/`fssamp15` both read unit 0 rather
  than 2/15; first pixel [77,81,80,232] rather than [91,117,153,140]. Frozen diff
  points: `constant-domain.mjs:864`, `state.mjs:542`. Evidence:
  `evidence/virgl-standard-state/verifier/findings.jsonl:2`, same recheck report
  digest, `browserResult.result.cases[1]`. Account for every active native
  default-block sampler before draw, preserving legitimate optimized-out reads.

The complete verdict, prediction matrix, exact commands, recorded points and
narrow coverage waivers are in
`evidence/virgl-standard-state/verifier/verdict.md`. All conclusions are bound to
immutable runtime 365b3cf3 / worker claim e5d4dba7, not a repair head. All other
predictions are HELD: independently authenticated 228 worker records; audited
all 110 hot/cold frames and 4,742,336 full pixels, including authentic original
92cb/c580 shaders/banks; read literal wire, actual native uniform/buffer/system
state and 146 real completion fences. All 45 runtime hunks / 268 added lines
are accounted with seven explicit partial-line waivers plus structural lines;
no additional sufficiency gap remains. A new four-image both-stage shader/view/
raw-linkage attack passes 22 frames under two independently chosen seeds and
schedules, 25 metadata attacks and two native admission attacks. Its single
served VS-view sabotage reaches real draw and fails the named independent pixel
oracle ([82,117,144,140] rather than [91,117,153,140]).

Carry unchanged compiler/device/transport proof at 9323b445 and the legacy prefix
`bfd25f78876cb1b60c7d04de81245c5d9e3938fb4d34f6b0e723961d896afdd2`, affected
old gates and the already authenticated pristine exact-head clone. Preserve
HELD results where code, dependency boundary and digest remain unchanged.
Critic regression candidates and reproduction tooling are committed; terminal
SUITE promotion waits for these refutations to clear. No runtime code was fixed.
Return this same task to `in-progress` for native-admission repair and affected
re-recording; do not start a successor yet.

Critic seal: `evidence/virgl-standard-state/verifier/{manifest.json,records.json,
recording.tar.gz}`, 52 members, archive SHA256
`6f05eeafad2f2dcdc225957b6ee95889855c1abc3538b480ad3f9a1222257c9b`, index
`09f798b43f4b9e960c97879b682ac0110089cb9f124b42108d79edd4093cbd7e`.

### 2026-10-09 — worker — native binding completeness repair; implemented

The fresh critic refuted F1/F2 at `01c4dc73`: coherently omitted active FS
constant/sampler metadata reached a native draw. Repair/acceptance head
`adcbe81bcd091c3d411a8f96ac8746e1a17290fb` adds standard-only enumeration of
every active native uniform after the existing typed reflection checks. Default
block entries must match checked raw constants, stage samplers or the inserted
blend uniform; block entries must belong to the already measured, owned system
block. No native binding may disappear merely because both stage and pair
metadata omit it. Legitimate driver pruning and the old renderer facet remain
unchanged. The original critic's other HELD results and 45-hunk coverage/waivers
at `01c4dc73` carry forward, with the new admission hunk requiring fresh review.

Exact frozen commands:

```sh
VIRGL_STANDARD_STATE_EVIDENCE_DIR=target/evidence/virgl-standard-state-reflection-final make verify-E6-T11d5
python3 tools/virgl-command/standard-state-cold.py --output target/evidence/virgl-standard-state-reflection-final-cold
python3 tools/virgl-command/standard-state-seal.py target/evidence/virgl-standard-state-reflection-final target/evidence/virgl-standard-state-reflection-final-cold evidence/virgl-standard-state/reflection-repair
```

The full prescribed gate and pristine scrubbed exact-head clone both pass:
542 literal wire predictions, 32 metadata attacks, 56 hardware queued frames
and 2,371,424 independently checked pixels. Four new coherent stage/pair
omission cases cover active VS/FS constants and samplers; each names the actual
native binding, fails `shader-reflection-error` and records zero native draws.
All successful frames now include directly queried complete active native
uniform lists. The added mixed-constant blend frame physically exercises the
renderer-owned float uniform and agrees with the independent literal-packet
blend equation. Original full compositor programs/banks, short/reset zeroing,
both-stage views, ownership, cancellation, fences and all nine affected old
regressions plus promoted blend/float boundaries still pass.

Both real served mutations remain sensitive. Short-upload corruption fails
`short-bank-0 independent physical pixel oracle`. Disabling only the new native
accounting loop reaches one real completed native draw with omitted VS constant
metadata, then fails `omitted-active-vertex-uniforms coherently spoofed stage/pair
metadata rejects` (expected false, observed true). Original source/mutation
bytes, native calls, error provenance, partial recordings, full saved pixels and
coverage are sealed; no proxy fabricates the program outcome. The offline audit
passes all 56 normal frames and catches the original short-upload fault.

The cold clone is
`/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/wasm-vm-virgl-standard-state-cold-e809aaf_/wasm-vm`.
Its exact head and clean checkout are recorded. The new committed seal is
`evidence/virgl-standard-state/reflection-repair/{manifest.json,records.json,recording.tar.gz}`:
332 records, 10,343,259 archive bytes; archive SHA256
`9c2a187e7f192c35bcc9c06eb32d1e7fc90e8e7ca938cb37c6a124eb3bdc467e`,
index `be036ae9072dbfae6ea1225572ffbe62fa84a5df4ebe345eefe25a72d62fef11`,
hot receipt `c7e39d32cb02684d278a2f673544063b10498c449ce1ea37ebadf5bcebe5ffa8`,
cold report `dc427e1574da1cb0caf7b8f761883f95c73a95fa61ee45ffa024e488e5315161`,
cold receipt `33545abd27c2b5ab70b2126f12bd469722f72a81949d59b1da7e97f0df04ef6f`.
The unchanged C/compiler, Rust/device/transport, original numerical prefix and
16MiB Wasm proofs carry. This remains an isolated single-COLOR0 binding slice;
no full guest API, production capset, live guest acceleration, scanout or MIPS
claim follows. Submit this repaired head to a fresh adversarial session.

### 2026-10-10 — fresh verifier — VERDICT: verified

The repair at `adcbe81bcd091c3d411a8f96ac8746e1a17290fb` survives independent
falsification and incremental sufficiency review. Worker claim
`b1263f6e60d68239288309218b3e8cc4590363ad` changes documentary/seal bytes only.
Predictions R1–R9 were written before inspecting the new state; every result is
HELD. The complete prediction matrix, recorded points, source identities and
coverage ledger are in `evidence/virgl-standard-state/reflection-verifier/verdict.md`.

- F1/F2 — HELD after repair. Re-run the original independently chosen TGSI,
  four images and literal raw banks. Coherent stage/pair omissions of FS/VS raw
  uniforms and FS/VS samplers reject `shader-reflection-error` at opcode 31,
  byteOffset 1912, with zero native draws. Actual native entries at turn 15 are
  `fsconst0[0]`, `fssamp2`, `vsconst0[0]` and `vssamp3`; complete native lists,
  type/extent/default-block queries and attached source are recorded at
  `promoted-final/normal/report.json:browserResult.result.nativeBindings.cases[0..3]`
  inside the fresh seal. These clear the original two refutations without
  replacing the original independently selected specimens.
- Bounded novel attack — HELD. A genuinely active undeclared default-block
  `wv_critic_unaccounted` float rejects before draw. Its native-optimized-out
  declaration counterpart completes one real draw and matches all 64 original
  independently predicted pixels [91,117,153,140]. Points are cases[4] and [5]
  of the same report; native source, actual calls and completion fences are saved.
- Worker evidence and legitimate bindings — HELD. Independently authenticate
  all 332 repaired records, receipts, source closures and the already completed
  pristine scrubbed exact-head clone. Audit all 112 hot/cold hardware frames and
  4,742,848 full pixels. All 110 prior wire/source/native-count/pixel digests are
  unchanged. Both added index 34 blend frames have native factor
  [0.25,0.5,0.75,1]; the literal Gallium packet and bank equation independently
  predicts [16,64,143,255] throughout each 16x16 image. The complete active native
  accounting includes 672 system entries, 182 raw entries, 16 samplers and two
  renderer-owned blend entries. The unchanged compiler/device/transport closure
  at 9323b445 and legacy prefix
  `bfd25f78876cb1b60c7d04de81245c5d9e3938fb4d34f6b0e723961d896afdd2`
  carry with the original HELD predictions and affected gates.
- Sabotage — HELD. Disabling only the actual served native-accounting loop
  completes the original F1 draw with twelve zero FS words and all-zero pixels,
  then fails the named coherent-omission rejection oracle (expected false,
  observed true). The original served VS-view mutation also completes a real
  draw and fails the independent pixel oracle: [82,117,144,140] rather than
  [91,117,153,140]. Exact served mutation bytes, native calls, readbacks and
  fences are sealed in `promoted-final/fault-native-binding` and `fault-pixel`.
- COVERAGE — HELD. All 14 new runtime lines at `state.mjs:597-610` are accounted:
  eleven executed lines and three structural lines, no new runtime waiver.
  All 60 added worker proof lines are accounted; the promoted harness has 68
  executed, 15 structural and two narrowly waived diagnostic portions. Exact
  V8 offsets/counts and reasons are in `coverage-audit.json`. Carry the original
  45-hunk / seven partial-line waiver matrix unchanged. Each changed proof tool
  has a separate execution/declarative ledger. No additional proof gap remains.

SUITE: promote `make verify-E6-T11d5-adversarial`, preserving the original
independent shader/images/banks/CPU equation and adding six native-accounting
regressions. The final target passes 22 regression frames plus one native
elimination draw, 1,472 full pixels, 25 metadata attacks, two prior native
admission attacks, five real accounting rejections and both served-source
sabotages. Preliminary harness-only corrections are recorded explicitly in
`harness-correction.json`; no runtime implementation was edited by the verifier.

Exact commands from `/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm`:

```sh
python3 evidence/virgl-standard-state/reflection-verifier/authenticate.py
python3 evidence/virgl-standard-state/reflection-verifier/recording_audit.py
VIRGL_STANDARD_STATE_ADVERSARIAL_EVIDENCE_DIR=evidence/virgl-standard-state/reflection-verifier/promoted-final make verify-E6-T11d5-adversarial
python3 evidence/virgl-standard-state/reflection-verifier/coverage_audit.py
python3 evidence/virgl-standard-state/reflection-verifier/adjudicate.py
python3 evidence/virgl-standard-state/reflection-verifier/seal.py --verify
python3 tools/check_task_policy.py
python3 tools/build_queue.py
```

Fresh critic seal:
`evidence/virgl-standard-state/reflection-verifier/{manifest.json,records.json,recording.tar.gz}`,
90 members, 2,816,869 archive bytes; archive SHA256
`fc19a77e6f6819c4b3cec8c98449e37accc7c9160d7d2ab8554fa8560d06f045`,
index `02d8445ba85ef95e2dcf41c6f441afcbf012d860b5781000ff7750e7b190608d`.
It retains predictions, exact harness diff, frozen sources, full native/pixel/
fence observations, browser captures and incremental audits. Separately
authenticated worker/prior critic seals retain their original digests above.
Set this isolated standard binding slice verified. Full guest API/caps,
production draw integration, guest boot/scanout and throughput remain ordered
successor work; this verdict grants no such authority. No second cold clone is
needed because the repaired runtime already has its final pristine proof.
