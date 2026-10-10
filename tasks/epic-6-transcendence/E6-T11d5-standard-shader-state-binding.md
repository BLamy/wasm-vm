---
id: E6-T11d5
epic: 6
title: Execute standard guest shader bindings through owned renderer jobs
priority: 525.027038
status: in-progress
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
