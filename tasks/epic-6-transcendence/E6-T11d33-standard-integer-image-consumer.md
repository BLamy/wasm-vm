---
id: E6-T11d33
epic: 6
title: Consume original signed and unsigned integer images in native draws
status: verified
estimate: S
risk: high
priority: 525.027039000375
depends_on: [E6-T11d32]
capstone: false
---

## Boundary

Complete one selected original integer image consumer boundary, composing
verified D31 storage and D32 compilation. Existing FLOAT-only normalizers and
the original view/surface decoder currently refuse this path. Add a selected
owned metadata/result/pair/interface contract for native
sampler2D/isampler2D/usampler2D and one COLOR0 whose vec4/ivec4/uvec4 type agrees
with explicit bounded host attachment masks. Retain original input register,
interpolation, system/raster value, uniform-block, typed vertex and query rules.
Keep every historical normalizer closed and byte-identical. Broadcast and multiple
color outputs remain outside this single-color consumer contract.

Expose a distinct profile constant and four entry points: metadata parsing,
single-result normalization, linked-pair normalization and interface derivation.
Single-stage host colors use own signedColorMask/unsignedColorMask fields;
pairs carry those plus the five established vertex/uniform selectors. COLOR0
masks are disjoint and bounded to bit0. A vertex stage's recorded color masks
must be zero. The compiler's semantic COLOR0 location may use a nonzero physical
OUT register. The original interpolation interface key remains unchanged;
attachment types are separate host authority for consumer cache keys.
Interface derivation retains the initial-stage smooth-to-flat promotion path.
A successful linked pair must contain the compiler's promoted vertex generic
types/interpolation matching each fragment generic input, in addition to the
established component-extent and interface-key checks.

Wire the contract into one selected async renderer/decoder profile for original
integer 2D views, single COLOR0 targets and raw integer clears. Native sampler
types must match retained storage signedness. Pair output masks come from the
actual retained target format and enter every material cache identity. Preserve
typed view swizzles, original texture operations, native iv/uiv clears, implicit
RGB alpha1 and existing job/generation/fence ownership. Keep unsupported integer
filter state explicit. All old factories, packets and FLOAT admission remain
unchanged. This selected consumer grants no production capset, guest, deployed
demo or performance authority.

## Deterministic acceptance

make verify-E6-T11d33

Replay actual frozen D32 native/Wasm compiler results through the selected
normalizers, deriving sampler/output types and COLOR locations independently
from original declarations and explicit host masks. Exercise all selected stage,
pair and interface entry points and retained vertex/uniform/query branches.
Original multi-color/broadcast and malformed contracts refuse. Existing
normalizers continue refusing the selected compiler profile; actual affected
historical accepted contracts remain byte-identical. Own getter-free snapshots,
caller mutation after capture, unknown or required-inherited fields, trapping
records, malformed errors,
partial results, array bounds/duplicates and selector/type disagreement refuse
without borrowed authority. Results remain recursively owned and frozen.

Execute original wire through the actual selected store, backend, decoder and
async renderer in headed hardware WebGL2. Cover all24 original integer sampling
formats and every qualified target format, both signedness classes, every legal
stage texture opcode, full/truncated NPOT mips, typed outputs/clears/swizzles and
RGB alpha1 after rendering. Independently reconstruct full defined native words
and original transfer bytes; never render expected output in JavaScript. Record
unique native sync objects, every poll, completion-before-read ordering and
handle retirement. Exercise same-shader target sign changes/cache hits,
mismatched views, stale generations, interleaved contexts/yields, retirement,
cancellation and complete drain. Actual native wrong-level, wrong-word and
completed-output sabotage must fail the unchanged oracle. Preserve affected
historical FLOAT consumer behavior.

Use the authenticated D32 generated module and its original inputs/native
response records, rather than a replacement translator or computed fixture
metadata. Exercise the new JavaScript contract in Node and a recorded headed
browser run with zero console/page/request errors and a screenshot. No demo
capability changes follow while this contract remains unreachable from the demo.

Carry verified D32 C/Wasm/native-GPU/stack/fixed-memory and D31 storage facts by
unchanged exact code/dependency/evidence digest. Capture every smallest governing
nested V8 interval over changed runtime bytes. Record the final exact head,
repeat the same command once in a pristine scrubbed clone, seal and reopen all
indexed source/input/record members, then obtain a fresh independent critic.

## Adversarial verification

Read the diff and predict exact normalized original sampler types, native color
types and owned fields before inspecting evidence. Reopen every indexed member,
derive original metadata independently, and audit the full nested changed-byte
coverage. Attack selectors, shader interfaces, unsigned/signed confusion,
caller-owned records, target/cache changes and malformed error paths. Run varied
deterministic schedules/seeds, invent one bounded novel native consumer attack
and sabotage a new assertion once. Carry only unchanged D32/D31
facts. The verifier promotes proof/tests/status and never fixes runtime.

## Verification log

The verified-head original refusal and dependency seals are required before
this pending task enters the active lane.

### 2026-10-10 — worker — verified dependency and original consumer refusal

D32 is independently verified at c64c3325c15d8978f455d57fc103559eec1b9d20
and published on existing open PR510, based on PR509. All verifier leases were
released before this plan. Reproduce at that exact source head:
`node evidence/virgl-production-readiness/standard-integer-image-consumer-gap.mjs`.
The script authenticates both complete D32 seals, reopens all 40,143 members,
and extracts the actual sealed generated compiler. All 22 original signed/unsigned
stage texts and two original pairs compile successfully, while the existing
metadata/result/pair/interface consumer refuses their selected profile. All 48
original format177..200 sampler-view and surface packets are refused. Complete
texts, results, wire bytes, source/generated hashes and dependency seals are in
the adjacent JSON. This negative demonstrates no native draw or guest execution.
The human instruction prioritizes completing production guest graphics ahead of
unrelated queue work, preserving the existing open PR chain.

### Primary sources

OpenGL ES3.0.6 (2019-11-01), sections3.8.13,4.1.7 and4.2.3:
https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf,
checked2026-10-10. Integer targets bypass blending, and integer clears require
the native signed/unsigned ClearBuffer entry point. Preserve original Gallium
full-clear scissor/write-mask behavior and RGB implicit alpha1 independently.
The selected consumer refuses non-nearest integer filtering explicitly; it does
not invent defined sampled values for an incomplete native integer texture.

### 2026-10-10 — worker — source freeze preparation

The selected implementation uses the authenticated D32 module without rebuilding
or changing compiler/storage/guest sources. Inner-loop runs exercised all586
original integer matrix cases; two additional physical OUT5 COLOR0 cases,
one selected FLOAT compatibility case and two native typed-vertex/constant0 cases
bring the frozen matrix to591 cases/1773 complete frames. The original contract
matrix replays all2586 responses in Node and the headed browser, with144 hostile
contract attacks and zero getter invocations. Every physical wrong-level,
wrong-word and completed-output control reaches genuine native completion and
fails the unchanged full-word inverse. The first boundary schedule passes24
complete frames; the submission repeats three distinct schedules. Affected
historical FLOAT draws pass their existing smoke command.

Full smallest governing V8 partitions are retained. Only exact pre-existing
older-facet/default operands and non-executable whitespace have explicit,
source-offset/digest-bound waiver entries in
`tools/virgl-integer-image-consumer/coverage-waivers.json`; all selected runtime
branches need positive evidence. Every waiver states its predecessor/static
reason and remains open to independent refutation. The final recorded command,
pristine clone, seals and exact source head will be added after recording.

### 2026-10-10 — worker — implemented, sealed original native consumer

Frozen source head: `ba5370a38126048d64d9353e9be5317a69e2d538`.
Exact commands: `make verify-E6-T11d33`, then
`python3 tools/virgl-integer-image-consumer/cold.py --output target/evidence/virgl-standard-integer-image-consumer-cold`, then
`python3 tools/virgl-integer-image-consumer/seal.py target/evidence/virgl-standard-integer-image-consumer target/evidence/virgl-standard-integer-image-consumer-cold evidence/virgl-integer-image-consumer/worker`.
All commands passed. The pristine clone ran the identical make command at the
same head; scrubbed environment and before/after clean status are recorded in
`cold/report.json` in the seal.

The full actual C/Wasm matrix replayed2586 original responses in Node and the
headed browser (1238 selected accepted records,144 hostile contract attacks,
zero getters). All591 native cases/1773 whole frames matched453888 output words
and601440 source words across4854 native source planes. All original public
readbacks matched35460000 backing bytes including row padding. The matrix held
4137 unique real WebGLSync objects, recorded9945 polls and10321 CPU reads,
with completion-before-read and once-only retirement. Three boundary schedules
(1030219,2882400001,1629686191) each held24 complete frames, including retained
old generations, opposite-sign target changes/cache reuse, GPU-only updates,
integer blend bypass/write masks/full clears, native sign/filter refusals,
cancellation and both disposal paths. Actual wrong-level, altered original-word
and post-completion native output controls failed the unchanged independent
whole-word inverse after physical completion. Original OUT5 maps COLOR0 at
native location0; selected FLOAT compatibility and both actual native typed
vertex/constant0 paths hold. The historical FLOAT consumer smoke command passes.

The recorded page runs had zero console/page/request errors and screenshots;
complete requests/responses, wire bytes, input/output blobs, native allocations,
reflections, real sync identities/every poll and complete nested CDP/V8 ranges
are sealed. Coverage:611 positive governing partitions;41 explicit unchanged
older-facet/default/whitespace waivers; no unexplained zero partitions.
D32 compiler/generated/fixed-memory/stack facts and D31 storage facts are carried
by unchanged exact code and both independently authenticated predecessor seals,
whose40143 members were all reopened. This claims only the selected original
single-color consumer boundary. Production capsets, guest acceleration,
deployment,300MIPS and the full API remain unqualified.

Seal: `evidence/virgl-integer-image-consumer/worker/{manifest.json,records.json,recording.tar.gz}`.
Archive SHA256: `4bf86adde84cf2ea958e195f6740a848d67f0641952cf4ab00d613f5cae6db3a`.
Index SHA256: `2220c476a1feafe3fe7c9228347d0fae4af07f3888f87a52bbc51c8e869568ce`.
Hot receipt: `591ad67ca59bedfed7259c95d050151500a870783c3b5426298e1199b6da03e4`.
Cold report: `e68e7e6ab9137a33dd2e44dd853bd3c2d52bed79e34b316e881fc00bf8f52697`.
Cold receipt: `4c84fe93685aef3d023412b1ea0e3646dd94b2e2d069e1222749b06f875c4963`.
All78714 indexed members, including806 exact source files, were reopened and hashed.
Fresh adversarial verification is pending.


### 2026-10-10 — fresh independent verifier — VERDICT: verified

VERDICT: verified

I oriented against predecessor `c64c3325c15d8978f455d57fc103559eec1b9d20`, predicted before opening
worker evidence, and independently interrogated frozen source
`ba5370a38126048d64d9353e9be5317a69e2d538` / submission
`a9a5fecd071f95d2e30692c84e9540ab6f070997`. Exact critic proof head:
`09643f18243c1c9239715f5950d81a4f2f6264dc`. No runtime implementation or requirement changed.
All fifteen predictions and the two explicit verifier-assumption corrections
remain in `critic/predictions.json` and `critic/verdict.json` in the archive.

Paths below name re-openable verifier archive members. Every cited file/line and
JSON pointer has its full SHA256 in `critic/citations.json`, SHA256
`65dcf6b0fa01764a0da7c82a20aa8755617e99d71b11d3c6457945917dfa4608`.

- P01 authentication — HELD. Reopened all 78,714 worker members and compared all 806 frozen source files; archive/index hashes, lengths, names and generated bytes agree. See critic/authentication.json:7 and:8.
- P02 dependency carry — HELD. Reopened both complete D32 seals (40,143 members) and both D31 seals (118,140 members); exact unchanged compiler/generated/fixed-memory/stack and storage facts alone carry. See critic/authentication.json:23 and critic/carry-forward.json:5,:25,:63.
- P03 original types/COLOR0 — HELD. Replayed all 2,586 actual original C/Wasm responses. All 1,238 accepted records derive sampler2D/isampler2D/usampler2D and vec4/ivec4/uvec4 from original declarations and explicit bounded host masks; physical OUT5 retains semantic native location0. See critic/contract-audit.json:18,:28112 and critic/unpacked/hot/hardware/report.json:1900,:9005,:9092.
- P04 ownership/refusals — HELD. Checked 37,935 recursively owned/frozen objects, zero getters, 144 recorded hostile attacks plus 95 independently constructed traps/selector/interface/error attacks. Caller mutation, inherited/unknown/accessor fields, malformed/partial errors and sign disagreement refuse. See critic/contract-audit.json:8,:9,:28110 and critic/promoted/critic-audit.json:5.
- P05 pairs/history — HELD. Initial-stage promotion/interface derivation and linked promoted interpolation/component extents hold; all 957 affected historical normalized results is byte-identical to the authenticated predecessor. See critic/contract-audit.json:7,:28111 and critic/promoted/critic-audit.json:5.
- P06 original wire — HELD. Independently decoded literal words for all 24 views and surfaces, plus raw clear union ffffffff/80000000/7fc01234/1. All 13 malformed/unqualified cases and all 49 historical entries refuse; captured fields own their input snapshot. See critic/wire-audit.json:5,:39,:951.
- P07 complete native words — HELD. Each hot/cold matrix has 591 cases/1773 complete frames: 453,888 output words, 601,440 source words/4854 source planes and 35,460,000 public backing bytes including padding match the independent original-word inverse. All 24 integer source and target formats, both signs, every legal stage opcode, full/truncated NPOT ranges and selected FLOAT occur. See critic/physical-audit.json:16,:20,:74,:102 and critic/unpacked/hot/hardware/report.json:5391985.
- P08 physical typed authority — HELD. Every actual sampler and COLOR0 reflection matches retained source/target sign; typed swizzles/RGB alpha1, actual iv/uiv vertex pointers and original constant0 UBO bytes hold. See critic/unpacked/hot/hardware/report.json:9005,:9092 and critic/physical-audit.json:102.
- P09 actual sync/read/retirement — HELD. Audited every real WebGLSync identity/poll/read/write ordering and once-only retirement: each matrix has 4137 syncs; hot has 9945 polls/10321 CPU reads. Every CPU read follows its own actual completion after relevant physical writes, including PBO fences; all handles and budgets drain. See critic/physical-audit.json:11,:102 and critic/unpacked/hot/hardware/report.json:9244,:5391805.
- P10 cache/generations — HELD. All six worker schedules and three fresh schedules preserve opposite-sign native cache identities/returns, private retained generations through ID/sign/dimension reuse, interleaved contexts and GPU-only refresh without modifying replacement CPU backing. See critic/state-audit.json:9,:10 and critic/promoted/critic-audit.json:12.
- P11 required clear/blend/cancellation behavior — HELD. Native integer blend bypass, write masks/full clears/alpha, pre-draw sign/filter/nonfinite-FLOAT refusals, recovery and cancellation hold. My original additional assumption that synchronous disposal waits for completion was FAILED as stated: the unchanged predecessor dispose path discards incomplete work, collects no CPU output and drains once. This is an overbroad verifier assumption, not a task refutation or requirement change. See critic/state-audit.json:11,:12,:104 and unchanged renderer/virgl-command/state.mjs:1916. The separate novel unused-channel mask prediction correction is preserved in critic/novel-prediction-correction.json.
- P12 actual corruption controls — HELD. Wrong-level binding, wrong original-word uploads and completed-output physical writes each reach actual completed syncs and fail the unchanged whole-word inverse. Post-completion tamper has a second distinct real sync. See critic/physical-audit.json:29758,:29822,:29886 and critic/unpacked/hot/fault-completed-output/report.json:7078,:7084.
- P13 nested coverage — HELD. Independently rebuilt every smallest governing changed-byte V8 partition in hot and cold: 611 positive, 41 explicitly audited byte/offset/digest-bound waivers, zero unexplained. Waivers cover exact unchanged older facets/default operands, one static null no-op for old factories and non-executable whitespace; no selected runtime behavior is waived. See critic/coverage-audit.json:14,:15,:16,:56743,:57489,:114218.
- P14 environment/cold proof — HELD. The pristine clone ran identical make verify-E6-T11d33 at the final frozen runtime head with scrubbed environment and clean before/after status; all recorded headed pages use physical Metal, have zero console/page/request errors and authenticated screenshots. Historical FLOAT hot/cold smoke passes. Critic promotion changes proof only; 1,474 product files and both generated compiler files remain exact. See critic/environment-audit.json:13,:19,:21,:207,:209 and critic/runtime-equality.json.
- P15 fresh/novel/sabotage — HELD. Fresh seeds 1000000007/2147483647/4294967291 hold 72 complete frames. The bounded novel original NPOT 17×9 UINT TXQ/OUT5 attack predicts [8,4,33,5], switches 196→179→193→200 and returns through four exact native program identities without extra links, preserving integer implicit alpha/public padding in 8 complete frames. The new full-word assertion detects actual native R-word 8→9 corruption after a second genuine completion. See critic/promoted/novel-native/report.json:1994,:20648,:24960 and critic/promoted/novel-sabotage/report.json:1812,:9085,:9091,:9097; critic/promoted/critic-audit.json:78,:91,:213.

SUITE: promoted `renderer/virgl-command/tests/standard-integer-image-consumer-critic.mjs`,
its independent Python inverse/control audit and recurring
`make verify-E6-T11d33-adversarial`. Exact proof-head make passed; the physical
sabotage child intentionally exited 1 and the unchanged assertion failed only the
first corrupted native R word. Other independent audit scripts and complete
original/native/coverage records are retained in the seal.

Commands: `python3 target/evidence/integer-image-consumer-verifier/authenticate.py`;
`python3 target/evidence/integer-image-consumer-verifier/carry_forward.py`;
`python3 target/evidence/integer-image-consumer-verifier/coverage_audit.py`;
`node target/evidence/integer-image-consumer-verifier/contract_audit.mjs`;
`node target/evidence/integer-image-consumer-verifier/wire_audit.mjs`;
`python3 target/evidence/integer-image-consumer-verifier/physical_audit.py`;
`python3 target/evidence/integer-image-consumer-verifier/state_audit.py`;
`python3 target/evidence/integer-image-consumer-verifier/environment_audit.py`;
`VIRGL_INTEGER_IMAGE_CONSUMER_CRITIC_EVIDENCE_DIR=target/evidence/integer-image-consumer-verifier/promoted make verify-E6-T11d33-adversarial`;
`python3 target/evidence/integer-image-consumer-verifier/prepare_seal.py`;
`python3 target/evidence/integer-image-consumer-verifier/seal.py`.

Final verifier seal:
`evidence/virgl-integer-image-consumer/verifier/{manifest.json,records.json,recording.tar.gz}`.
All 82,519 indexed members reopened (1,120,265,735 bytes), including
every worker member and 810 critic source files.
Archive SHA256: `9a6be3ab3b55cf5c8d1cfb2a7f3283213a5a8bfa8769cad190840c6edbc2592c`.
Index SHA256: `ebf663a084b5b0b8e3b932129416a31e5fec5ec945f6dab3ba442a020b35430d`.
Manifest SHA256: `9e0bf783f5bfbafea6f8b7a477dbe7f70872036bcbba5650081977b641ab8f20`.
Promoted audit SHA256: `8f485b508624ab39add991d3460da2cd5c0378e3419664acafd038d7e1241b1d`.
Worker archive/index remain
`4bf86adde84cf2ea958e195f6740a848d67f0641952cf4ab00d613f5cae6db3a` /
`2220c476a1feafe3fe7c9228347d0fae4af07f3888f87a52bbc51c8e869568ce`.

Owned Node/browser/native GPU/server processes closed and all budgets drained;
`critic/process-cleanup.json` records zero surviving owned processes.
This verdict covers only the selected original single-color integer image
consumer. Production capsets, guest graphics, deployment, full-API support and
300MIPS remain unqualified. The final verdict/status/queue commit changes no
runtime or proof harness; all leases release after that commit.

Final status checks: `python3 tools/check_task_policy.py` passed (active=none),
then `python3 tools/build_queue.py` regenerated 650 tasks/458 verified, and
`git diff --check` passed.
