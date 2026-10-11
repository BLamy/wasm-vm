---
id: E6-T11d31
epic: 6
title: Preserve original signed and unsigned integer color image storage
status: verified
estimate: S
risk: high
priority: 525.027039000373
depends_on: [E6-T11d30]
capstone: false
---

## Goal

Add an explicitly selected original integer color store, transfer layout and native
WebGL2 backend for original formats177..200 (R/RG/RGB/RGBA, 8/16/32-bit UINT/SINT).
The current selected shared-exponent profile rejects these layouts before allocation.
Preserve every historical constructor, owner protocol, resource/cache/transfer ceiling,
shader compiler, decoder, draw executor, generated compiler and production capset.
The subsequent compiler and consumer boundaries must be independently qualified.

## Acceptance criteria

- `make verify-E6-T11d31` is the one deterministic acceptance command. Preserve exact
  source/generated identities, original metadata/bytes and every native/public plane,
  caller state, object retirement, physical completion and full nested V8 source/ranges.
- Original integer formats are admitted only by the new explicitly selected layout,
  owner and matching native backend; every old owner/layout still refuses. Metadata,
  limits, backing, inline fields, configuration, roles, levels and attachment mutations
  remain checked without invoking accessors or accepting new targets/flags/samples.
- All24 layouts preserve exact original signed/unsigned raw words at each 8/16/32-bit
  width through native uploads and sync/async reads. R/RG use matching native formats;
  RGB expands to matching native RGBA with integer alpha1; RGBA remains matching.
  Native readback is RGBA_INTEGER with INT or UNSIGNED_INT, then original lane/width
  narrowing in the already charged scratch. No float/normalized conversion is allowed.
- Base, NPOT truncated/full mip chains, original render/sampler/combined roles, inline
  and attached strided subrect transfers, and every untouched source/output/SG byte
  are independently reconstructed from original values. Signed minima and UINT high
  words above2^31 appear in inputs declared before GPU execution, without fitting or
  changing inputs after observing a native result.
- Whole original and private native mip planes follow physical completion. Private
  nonzero ranges use native integer NEAREST framebuffer blits without a CPU pixel
  download supplying GPU copies. GPU-only typed integer clears alter one original
  mip and refresh retained ranges; adjacent mips and whole source backing retain
  their original values. RGB implicit alpha is initialized with typed integer clear.
- Three varied ownership schedules exercise context switching, source-ID reuse,
  retained old storage/ranges, queued read complete/cancel/resource destruction and
  disposal. Actual held storage/fence identities survive reuse; native objects retire
  once and all terminal byte/ticket/view/lease/reference budgets return to zero.
- Original guest/native expansion, scratch/read staging and private-copy bytes are
  charged before allocation. At/over bounds refuse exactly; malformed fields and
  actual native errors/context loss cannot publish success or new private authority.
- Two real native controls corrupt upload lane identity or copied source level,
  complete the physical run, and fail the unchanged original-word/full-plane inverse.
  Mismatched integer read format is an explicit native-error control, never a substitute
  for wrong-pixel detection after successful native completion.
- Carry unchanged predecessor HELD boundaries and all ten D26–D30 worker/critic seals
  by exact digest. Run affected prior store/transfer owner gates. Freeze runtime/harness,
  record the full hot command, repeat that same command once in a pristine scrubbed
  exact-head clone, seal and reopen/hash every indexed member before submission.

## Adversarial verification

Fresh critic reads this task and full scoped diff first, predicts concrete values before
looking, independently reopens/hashes the complete archive and source closure, and derives
native/public planes from original signed fields and source bytes with an independent
integer oracle. Audit every smallest governing nested V8 partition for changed runtime
regions; line samples are navigation. Exercise all stated roles, malformed/config/error,
limits and three varied retained-ownership schedules; invent one bounded native integer
or lifetime attack; sabotage a promoted check with actual native wrong pixels after the
original physical completion. Carry unchanged HELD results/seals and final pristine clone.
Classify unexecuted changed behavior as needs-evidence or dead, then promote the independent
proof, seal critic recording, log verdict, check policy, regenerate queue and commit.
The worker cannot verify its own submission.

## Execution slices

One boundary: selected original integer allocation and transfer/range representation in
resources.mjs plus a declarative original-format map. Native upload expansion/read narrowing
and integer copy/initialization stay within that representation boundary. No packet/shader/
draw/production or multidimensional-texture behavior is added here.

## Evidence boundary

This is isolated native storage authority only. It grants no integer sampler/output shader
admission, production feature/capset, complete GLES API, guest Mesa/desktop rendering,
worker scanout, demo deployment or performance result. Those are ordered successor gates.

## Verification log

### 2026-10-10 — worker — verified predecessor and exact-head refusal

D30 is independently verified at `131f7ec39a56b747e4107f9b2e5077e8215434f0`.
`node evidence/virgl-production-readiness/standard-integer-image-gap.mjs` records
all24 original integer formats with base/full NPOT chains and render/sampler/combined
roles:144 owner/layout refusals, zero allocations. Its adjacent JSON pins complete
original metadata, old runtime source bytes and original enum header at that head.
This synthetic refusal grants no native, guest, production or capset authority.
The human instruction continues production graphics work ahead of unrelated queue work.

Native representation is derived from the pinned Khronos GLES3 reference pages
(commit `4bdf67a73d040f79bd7b087f5c1e588809e1f329`, glTexImage2D/glReadPixels/
glBlitFramebuffer/glClearBuffer) and Mesa26.2.2 original format descriptors.
Integer RGB is expanded to matching native RGBA; native integer alpha is1.
Integer public reads use guaranteed RGBA_INTEGER plus INT/UNSIGNED_INT.
The original4MiB/resource,32MiB aggregate and8MiB scratch ceilings stay unchanged.

### 2026-10-10 — worker — source-declaration proof repair; runtime unchanged

At frozen runtime/harness head `78cbe57062fcddb0d2325e326a153e0e05b01731`,
all288 native matrix cases, three19-case schedules, both physical corruption
controls and the independent inverse passed (346388 native components,529620
public bytes,109152 untouched SG padding bytes). The selected full command did
not complete: the historical async test server refused to serve the new imported
`integer-images.mjs`, producing404 before module evaluation. This is a harness
source-closure gap, not a passing acceptance claim. The exact failed record is
`target/evidence/virgl-standard-integer-images-78cbe570-hot/retained-async-jobs/report.json`
(SHA256 `3efa4bc6be3ce523fe08a2f232b95e8195f325762860da4953264f1eb32bf299`); its acceptance log SHA256
is `af0c63433022772d219a30e6f6a44d48b8f578c7f78618402c1f5452d2c00d3c`.

Only the new imported source declaration is appended to27 historical closed test
server allowlists. `standard-integer-image-serving.py` and its adjacent inverse
map require each algorithm to reconstruct byte-for-byte to the verified predecessor.
The corrected async native preview passes. Runtime, compiler, decoder, executor,
limits and all ten predecessor seals are unchanged. Packed, byte and legacy color
storage previews cover the newly extended read selector’s historical branches.
The final frozen command and one pristine clone follow; no unrelated Rust/workspace
gates or historical HELD criteria are restarted. These isolated modules are not
part of the deployed app or a reachable production feature; web/wasm/crates/capsets
remain unchanged, so no demo capability or deployment is claimed at this boundary.

### 2026-10-10 — worker — frozen native submission; fresh verdict pending

Runtime and final harness are frozen at `ba735c389ca9db84de76f5ee042035edbccf0a99`.
Runtime bytes are unchanged from `78cbe57062fcddb0d2325e326a153e0e05b01731`:
`integer-images.mjs` SHA256 `8871226b60ad86ee1f585f8de6e5891241a361ad84aa811a36028fd003d95029`;
`resources.mjs` SHA256 `b9b7645b12ad66a1ab6a05df6f8707be827e7422025462f8f738730459712e02`.
Commands:

```
EMCC=/Users/blamy/.cache/wasm-vm/emsdk/4.0.22/wasm-vm-emcc \
VIRGL_INTEGER_IMAGE_EVIDENCE_DIR=target/evidence/virgl-standard-integer-images-final-hot \
make verify-E6-T11d31
python3 tools/virgl-command/standard-integer-image-cold.py --output target/evidence/virgl-standard-integer-images-final-cold
python3 tools/virgl-command/standard-integer-image-seal.py target/evidence/virgl-standard-integer-images-final-hot target/evidence/virgl-standard-integer-images-final-cold evidence/virgl-standard-integer-images/worker
```

Both full commands passed. The pristine detached clone ran that same acceptance
command once at the frozen head, with scrubbed Rust/Cargo/Node/Python/npm/compiler
environment and empty tracked status before/after. Both receipts authenticate
347 native cases,346388 native components,529620 public bytes and109152 untouched
SG padding bytes. All24 original formats, three roles, four mip-chain shapes,
strided/subrect/inline/sync/async paths, typed GPU clear/range refresh and three
varied ownership schedules are captured on actual Apple M4 Metal WebGL2.
Both upload-lane and copy-level physical corruptions fail the unchanged whole-plane
original-word inverse after actual fence completion. The full nested V8 audits
contain403 exercised governing partitions and zero unexecuted changed partitions.
Historical owner/layout refusals, native errors/context loss, object/fence retirement,
terminal budgets,27 exact server-declaration inverses, unchanged compiler artifacts
and all ten D26–D30 worker/critic seals are authenticated by each receipt.

The committed worker packet contains48653 indexed members, complete native blobs,
events, browser sources/ranges/screenshots, full source closure and actual generated
compiler artifacts. The sealer reopened every member and checked its size/digest.
`evidence/virgl-standard-integer-images/worker/recording.tar.gz` SHA256 is
`ee9d19ac6f0fbbce842fb0c416731e6770a61e05bf77c84d6a6840fb2cc21fb2`;
`records.json` SHA256 is `98e2767f99f9d7c1acb8bf1dfa8cab36a1d009517c99d171dad994653d4f3da5`.
Hot receipt SHA256 `f127c85a75d5e180a2618508a8e7a153a01d1f713eb739fa21fbfcf6462eeff1`;
cold report SHA256 `3022d10d2d8f37835a5e0f9bfe57fa04d059f820eb86158b958fd874a4f1c481`;
cold receipt SHA256 `a9345f8cc2e2d551b7fad8a8f388ef957ad7729d25de0df3f82c2547e1255d58`.
These are worker claims awaiting a fresh adversarial verifier. They grant isolated
original integer storage/transfer authority only, with no guest shader/command,
production capset, complete GLES API, deployed demo or performance claim.

### 2026-10-10 — fresh adversarial verifier — VERDICT: verified

VERDICT: verified

Fresh critic reviewed AGENTS.md, the complete task and scoped predecessor/submission diff before opening evidence. Predictions written before evidence are retained verbatim in predictions-before-evidence.json (SHA256 f66151a53fe55b0db3f75a861e068807bd37e55f87ff2976e9743f583c09be29); final HELD/FAILED resolutions and exact citations are in predictions.json. Runtime remains ba735c389ca9db84de76f5ee042035edbccf0a99; native critic runs are 7327f4a9e95db5817192fd16f71a7e4901fa2a1e. Only offline proof audit/seal repairs followed, at 019d3e19195cc1084ace3509807acafaf756d36b. Served native module/runner bytes are unchanged and the packet includes both original native-head and final critic source closures.

- P0 custody — HELD. Reopened/hash-checked every48653 indexed worker member, 320513260 bytes, not samples. Archive ee9d19ac6f0fbbce842fb0c416731e6770a61e05bf77c84d6a6840fb2cc21fb2 and index98e2767f99f9d7c1acb8bf1dfa8cab36a1d009517c99d171dad994653d4f3da5 match. Citation: `custody.json:1` `` (SHA256 `4efc1580c77c1d8eb5e3dbf52261a18f63bda0029d11ecffc35f2a58f1733617`). Carry the authenticated full packet.
- P1 original representation/specs — HELD. Independent literal enum/Mesa signed-width/lane derivation and four reopened Khronos pages at4bdf67a73d040f79bd7b087f5c1e588809e1f329 support matching native integers, RGB alpha1, guaranteed RGBA_INTEGER INT/UI read, typed clear and NEAREST copy. Citation: `primary-spec-reopen.json:1` `` (SHA256 `7700efbaf55915ad2d14fc8bd6fd2200b84872b10fbda648d8f0142262f1292c`). Preserve this isolated storage scope.
- P2 gates/malformed inputs — HELD.1296 old owner/1152 old layout refusals,1872 invalid metadata,864 invalid transfers,432 hostile metadata and3 config records remain closed without getter execution. Novel backing/membership replacement cannot validate or issue a stale read. Citation: `fresh/wire/report.json:3441` `/wire/records/0` (SHA256 `883c121146f61eb350f5ed036c302e32525086dc9cd67294551f6861ec024ed7`); complete independent counts in `audit.json:1` `` (SHA256 `78de06b02c2ea62816c3aa7b84dd9bff8e0a4ce8d2b61e57a0c791cd9888f6e2`). Carry the unchanged owner boundary.
- P3 complete words and output planes — HELD. Fresh288-case matrix uses seed0x243f6a88 and all24 formats/three roles/four shapes. Independent full hot,cold,fresh comparison checks45885 planes/SG points,2125212 native components,1588860 public bytes and327456 untouched padding bytes, including full native sync/PBO buffers before narrowing. Signed first R lanes are0,1,-1,-2147483648,2147483647,-2147483647,-2,17,63 with G/B0,A1; UINT high words remain exact. Citation: `fresh/hardware-matrix/report.json:1644036` `/browserResult/result/runs/240/planes/0/observed/native` (SHA256 `4a04df38ae34554396a49d87326f8b455cc9a315aacb9f24d980f4a4578edbdf`) and `fresh/hardware-matrix/report.json:1315972` `/browserResult/result/runs/192/planes/0/observed/native` (SHA256 `4a04df38ae34554396a49d87326f8b455cc9a315aacb9f24d980f4a4578edbdf`). Promote the independent original-word inverse.
- P4 physical integer copies/clear — HELD. RGB initialized(0,0,0,1), caller FBO/mask/scissor restored, full original/private mip planes match, copies use actual NEAREST integer framebuffer blits without CPU pixel download, and GPU-only typed clear/refresh preserves adjacent planes and complete backing. Citation: `fresh/hardware-matrix/report.json:1476624` `/browserResult/result/runs/216/initialNative` (SHA256 `4a04df38ae34554396a49d87326f8b455cc9a315aacb9f24d980f4a4578edbdf`) and `fresh/hardware-matrix/report.json:1475690` `/browserResult/result/runs/216/views` (SHA256 `4a04df38ae34554396a49d87326f8b455cc9a315aacb9f24d980f4a4578edbdf`). Retain all original/native planes.
- P5 lifetime/completion/errors — HELD. Three fresh19-case schedules at0x6a09e667,0xbb67ae85,0x3c6ef372 cover complete/cancel/dispose,nine native failure sites and actual context loss, with actual created/retained/ready/deleted sync identity and each object retired once. Novel old generation3/private3 survives new generation5; textures7/13 remain distinct from28. Last hold releases old original/private1968->896 GPU bytes; terminal budgets0. Citations: `fresh/hardware-boundaries-0x6a09e667/report.json:3665` `/browserResult/result/runs` (SHA256 `1202cea186b4585b6f69b36a74c0840f610096208f262a4ba7f77d4adbb0c1fa`), `fresh/hardware-boundaries-0xbb67ae85/report.json:3665` `/browserResult/result/runs` (SHA256 `77c58f4fdd1eeab09ba4c848d12ac487a4e9bc2af20df8196b07654d2d8ed833`), `fresh/hardware-boundaries-0x3c6ef372/report.json:3665` `/browserResult/result/runs` (SHA256 `a4579071df307b6e6339e79c3b7d10a3a8564f1ed6cd3327ba158bc4ac0bb3c9`), `novel-native/report.json:834` `/browserResult/result/runs/0/identities` (SHA256 `64554671402b0a03e241989385efa5bda627e18251209672198cd43405348e72`), `novel-native/report.json:1216` `/browserResult/result/runs/0/afterHoldRelease` (SHA256 `64554671402b0a03e241989385efa5bda627e18251209672198cd43405348e72`). Preserve the retained generation and retirement assertions.
- P6 counter snapshot subprediction — FAILED; preflight acceptance — HELD separately. I predicted observable gpuBytes would already be increased at original/private texStorage2D. The first native allocation reports0: `novel-native/report.json:1370` `/browserResult/result/runs/0/events/2` (SHA256 `64554671402b0a03e241989385efa5bda627e18251209672198cd43405348e72`). This was stronger than the preflight criterion. Derived costs/remaining ceilings are checked before allocation at resources.mjs:535–539 and910–913; the unchanged host call at358–359 and native allocate at1231–1268 are synchronous, with no async/await/yield. Owner counters publish only after success at541/915. Scratch/PBO reservations publish before allocation at477–484. Complete original9x5 RGB32 mips cost guest672/native896; range1..3 costs176; old3x2 read costs compact72/scratch96/PBO96. Expanded bound2448 accepts once;2447 refuses with zero allocations, cited `fresh/wire/report.json:207192` `/wire/records/5773` (SHA256 `883c121146f61eb350f5ed036c302e32525086dc9cd67294551f6861ec024ed7`) and `fresh/wire/report.json:207234` `/wire/records/5774` (SHA256 `883c121146f61eb350f5ed036c302e32525086dc9cd67294551f6861ec024ed7`).8MiB read bound is exact, cited `fresh/wire/report.json:273537` `/wire/records/7656` (SHA256 `883c121146f61eb350f5ed036c302e32525086dc9cd67294551f6861ec024ed7`) and `fresh/wire/report.json:273596` `/wire/records/7657` (SHA256 `883c121146f61eb350f5ed036c302e32525086dc9cd67294551f6861ec024ed7`). The exact snippets and digest are retained in `preflight-boundary.json:1` `` (SHA256 `b39c331ac891cc77be08370ac577ab187fbe3947960e363078b0d994b9557bf8`). No stated acceptance criterion is waived, and no new reentrant-owner contract is claimed. Correct the overstrong prediction without runtime rework.
- P7 native wrong-pixel controls — HELD. Both independent fresh actual upload-lane/copy-level controls finish physically and fail the unchanged original inverse; mismatched integer read remains a distinct native-error angle. Citations: `fresh/fault-upload-lane/report.json:3774` `/partial/runs/0/uploadFence` (SHA256 `621c43e2065895e8ecf36fcf36e54c22c34ab7949c89ae86e6286270fbf60811`) and `fresh/fault-copy-level/report.json:3866` `/partial/runs/0/views/0/fence` (SHA256 `480aa9358550bb560192c9fc4cdbd18bfba8f999cf22c3aa17d8f85e42705f5e`). Keep both physically successful corruption controls.
- P8 coverage/scope — HELD. All403 smallest governing partitions across76 changed runtime line records have positive counts in hot and cold separately, and in the fresh+carried union, with zero unexecuted changed behavior.51 fine historical float/byte/packed/shared partitions carry exact unchanged source, nested range and receipt digests. Earlier fresh-only diagnostic36 coarser historical gaps and failing critic.log entry are preserved; proof-only carry repair does not alter native evidence. Citation: `coverage.json:178908` `/audits/2` (SHA256 `7a5e8ab7d1ed3e9d042c57bf090dd1f5dc0c55d6257b96dc095f493d9564e826`). Scoped documentation/declarative config waivers and every scoped diff hunk are in scoped-hunk-waivers.json; no product behavior is waived. Carry unchanged HELD branches rather than restarting them.
- P9 predecessor and source boundary — HELD. All ten D26-D30 worker/critic seals and nine runtime boundaries match131f7ec39a56b747e4107f9b2e5077e8215434f0 by exact digests; all27 historical server changes invert byte-for-byte. Actual generated wasm41d5c79624d7799cb9339b3fb754bfb4b744ee959b70d8cc2daedfb0a1fb4ac8 and mjs509aaeb879c95b90acd26de08a310b23991779cf3564f174bbc1702c9b68a021 remain unchanged. Citations: `worker/hot/receipt.json:1` `` (SHA256 `f127c85a75d5e180a2618508a8e7a153a01d1f713eb739fa21fbfcf6462eeff1`) and `worker/cold/receipt.json:1` `` (SHA256 `a9345f8cc2e2d551b7fad8a8f388ef957ad7729d25de0df3f82c2547e1255d58`). Carry all predecessor seals.
- P10 pristine isolation — HELD/carried once. Full hot make verify-E6-T11d31 and the same final pristine scrubbed clone command passed at ba735c, with authenticated receipts/logs and empty tracked state. Earlier78cbe570404 remains explicitly failed, not a passing claim. Citation: `worker/cold/report.json:1` `` (SHA256 `3022d10d2d8f37835a5e0f9bfe57fa04d059f820eb86158b958fd874a4f1c481`). No isolation/portability finding justified repeating the clone or unrelated workspace gates.
- P11 novel native attack and promoted sabotage — HELD. Independent RGB32 UINT/SINT9x5 fourmip/range1..3 extreme-clear/old3x2 PBO read under hostile caller state, mutable input, accessor and attachment/context/source-ID reuse passed26 whole-plane observations and exact72-byte old public read. Citation: `novel-native/report.json:1042` `/browserResult/result/runs/0/oldRead` (SHA256 `64554671402b0a03e241989385efa5bda627e18251209672198cd43405348e72`). Post-fence sabotage physically changes private mipR from0xffffffff to17 after original sync8 completes at turn3; actual sabotage sync27 completes at turn15. The unchanged oracle fails expected native SHA2569ed6cd057c586ff70eaffd9f696d9c948e7e7a960b083c8daddfe600a4165b7c against actual325330276d590b9171e0edeea2ff38c42673fb0ad8188a087a5f484f2999223c. Citations: `sabotage-post-fence/report.json:704` `/partial/runs/0/originalFence` (SHA256 `1c28e377aedeee10c6a7a6dec70f557b9094f919ea824c9700e18fafa08e74d1`), `sabotage-post-fence/report.json:756` `/partial/runs/0/sabotageFence` (SHA256 `1c28e377aedeee10c6a7a6dec70f557b9094f919ea824c9700e18fafa08e74d1`), `sabotage-post-fence/report.json:648` `/partial/runs/0/observations/10` (SHA256 `1c28e377aedeee10c6a7a6dec70f557b9094f919ea824c9700e18fafa08e74d1`), `sabotage-post-fence/report.json:255` `/browserResult/error/message` (SHA256 `1c28e377aedeee10c6a7a6dec70f557b9094f919ea824c9700e18fafa08e74d1`). Keep the independent physical sabotage check unchanged.

SUITE: promoted tools/verify-virgl-standard-integer-images-adversarial.sh, its immutable native runner and renderer/virgl-command/tests/standard-integer-image-critic.mjs; independent Python custody/original-word/full-plane/nested-coverage audit and full-record sealer. No product implementation changed. Commands: bash tools/verify-virgl-standard-integer-images-adversarial.sh at7327f4a9e95db5817192fd16f71a7e4901fa2a1e completed all native work, then exposed only the historical coverage carry scoping error; fixed offline audits passed, ending with python3 tools/virgl-command/standard-integer-image-critic.py --capture target/evidence/virgl-standard-integer-images-critic at 019d3e19195cc1084ace3509807acafaf756d36b. Syntax checks, git diff --check, full record seal and reopen, policy then queue regeneration complete the verifier submission.

Authority: isolated original integer storage/transfer/range only. No integer shader/consumer, guest execution, production negotiation/draw/capset, demo deployment or performance claim. No semantic refutation or outstanding evidence demand survived; the failed stronger counter snapshot prediction remains explicit.

Final critic seal: `evidence/virgl-standard-integer-images/verifier/recording.tar.gz` SHA256 `5d5b84c170550abfb54b56b81e694489a8a2e8b6bfd9226a9e1e0ac65fab9b2d`; `records.json` SHA256 `64ddaf6adfc7dd4fda82943d9b518fb6420c2f618b43d60ed5edc156033619d5`. All69,487 indexed regular members reopened against exact size/digest (487,464,615 unpacked bytes); native head `7327f4a9e95db5817192fd16f71a7e4901fa2a1e`, final offline critic head `019d3e19195cc1084ace3509807acafaf756d36b`. Audit SHA256 `78de06b02c2ea62816c3aa7b84dd9bff8e0a4ce8d2b61e57a0c791cd9888f6e2`, coverage SHA256 `7a5e8ab7d1ed3e9d042c57bf090dd1f5dc0c55d6257b96dc095f493d9564e826`. Full source/native-head and final proof sources, original inputs/native/public planes, full nested ranges, physical object/fence events, browser errors/screenshots, initial/final predictions and the earlier proof-only coverage diagnostic are retained. Every original/native/public record remains replayable by exact file/line/pointer/digest in `citation-points.json` inside the packet.
