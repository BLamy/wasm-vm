---
id: E6-T11d42
epic: 6
title: Preserve original packed UN24 depth and stencil storage and transfers
status: verified
estimate: S
risk: high
priority: 525.027039000382
depends_on: [E6-T11d41]
capstone: false
---

## Boundary

One opt-in original packed fixed-depth resource/backend path for
S8_UINT_Z24_UNORM=20 and Z24X8_UNORM=21. Checked single-layer 2D depth/sampler
roles1/8/9, full/truncated NPOT mip chains, original little-endian public fields,
strided segmented transfers and retained native ranges share this storage
boundary. Preserve every historical factory, original command consumer,
compiler, production device and capability admission.

Original20 has low S8 and high UN24 in one four-byte word; original21 has low
UN24 and unused high X8. Use native DEPTH24_STENCIL8/UNSIGNED_INT_24_8 and
DEPTH_COMPONENT24/UNSIGNED_INT respectively. Original21 readback has canonical
zero X8, with no invented unused-lane preservation promise. Native-only depth
sampling and fixed-function stencil extraction provide authoritative public
readback, without a CPU image/depth/stencil mirror or rasterizer. Native packed
scratch copies must use the same DEPTH24_STENCIL8 format, while existing floating
scratch calls keep their default DEPTH32F_STENCIL8 behavior.

Charge native images, scratch, conversion and PBO staging before any allocation
or read. Private mip ranges preserve source generation, remap levels and refresh
through actual matching native copies after GPU-only changes. Cancellation,
opposite-format ID reuse and both disposal orders retire objects and physical
fences once. Guest sampler/surface command admission remains refused; the
consumer, shadow/stencil/API/capset and real guest/demo boundaries are successors.

## Deterministic acceptance

`make verify-E6-T11d42`

Authenticate the full independently verified D41 worker/critic seals, original
wire/format definitions, whole pinned Mesa/virglrenderer/GLES sources and
unchanged actual C/Wasm compiler identities. Record the original24 storage
refusals and6 consumer refusals at verified D41 before activation. Preserve those
consumer refusals and every historical resource factory's admission.

Exercise all16,777,216 original UN24 words for each format through actual native
storage and complete canonical public readback, in bounded chunks. Native sampled
depth must differ by at most one ULP from independently derived
float32(original_UN24/16777215); that allowance applies only to native FLOAT depth
lanes. Every canonical public UN24/S8/X8 and padding byte is exact. Include all256
original S8 values and independent actual stencil diagnostics. Public readback
must derive from native planes, never unchanged guest backing. Record actual
upload words, both complete native field planes, full public bodies, write/read
ordering and consumed physical fences.

Cover both formats/all three roles; NPOT/full/truncated mip chains, nonzero boxes,
odd strides/offsets and segmented padding; inline, synchronous and asynchronous
transfers; full/private retained ranges and source-ID reuse; refresh after a
GPU-only depth/stencil clear with unchanged backing. Floating clears obey the
whole GLES fixed conversion bound, with public bytes exactly serializing the
validated native choice. No guest depth comparison or stencil-state claim follows.

Reject malformed descriptors, unsupported roles/targets/layers/samples/flags,
invalid chains, strided overflows and one-byte-short resource/view/scratch/staging
budgets before allocation or collection. Native allocated-then-failed images,
conversion copies and PBO reads roll back every charge/object. Run three varied
physical lifetime schedules, including stale queued reads, opposite-format ID
reuse, cancellation and disposal. Count owned, consumed and disposal-only fences
separately; synchronous driver readPixels returns are not invented sync events.

Refute actual completed native depth and S8 corruption after a distinct second
consumed fence using unchanged full original-input inverses. Retain native UN16
and floating18/126 transfers and original consumer gates affected by the shared
helper. Cover every changed governing nested V8 partition or exact source-pinned
unchanged predecessor operand. Run scoped syntax/diff/policy and affected native
browser gates, one final frozen hot run and one pristine scrubbed cold clone.
Seal and reopen every full source/input/native/public/browser/coverage/screenshot
record before a fresh adversarial verifier examines the submission.

This isolated factory is not demo-reachable and grants no production authority.
Complete API/caps, actual guest/compositor/worker/scanout/live deployment and
300MIPS remain in E6-T11d and subsequent qualification.

## Adversarial verification

A fresh critic writes falsifiable predictions before evidence. Independently
authenticate custody and invert full original descriptors, fields, uploads,
native/public/padding bytes and source identities. Attack UN24 low values, high
half/tie values, ignored X8 and all256 S8 values; verify matching stencil scratch
format, mip geometry, exact budgets, actual writer-before-consumed-fence ordering
and terminal retirement. Carry prior HELD results only at unchanged boundaries.

Run three new schedules and one bounded novel packed-field/range attack. Sabotage
actual completed native depth or S8 after a distinct consumed fence and demand
unchanged inverses reject it. Promote one useful deterministic attack and seal
fresh evidence. Verify only when no contradiction or proof gap survives and all
changed governing partitions are executed, precisely waived or deleted. Do not
repeat the unchanged final cold clone absent a portability finding.

## Verification log

### 2026-10-11 — worker — verified predecessor and original packed depth gap

D41 is independently verified at
`c34b00e91f6e84501f0eff731a74857a10eb4250` and published on existing open PR519.
Its fresh verifier released all Git/Node/browser/GPU leases. The user's explicit
instruction continues production graphics qualification ahead of unrelated queue
work. Existing stack500 and all70 prior PR identities/order/base branches remain
intact; this is the next branch above PR519, not a replacement stack.

Exact original reproduction at the verified D41 head:

```sh
node evidence/virgl-production-readiness/standard-packed-depth-image-gap.mjs
```

The adjacent complete JSON records24 original20/21 role/base/mip/direction layout
refusals and6 original base/private sampler or mip-surface packet refusals, with
the complete original metadata, fields, packets and source/primary/generated
identities. This storage task closes the24 layout refusals; consumer admission
and its6 refusals remain for the independently ordered next boundary.

Whole pinned `vrend_formats.c:87..92` supplies the native mapping. Whole Mesa
`u_format.yaml` defines20 as UP8/UN24 and21 as UN24/X8. The native-only planning
probe under `/tmp/wasmvm-production-api-plan/un24-native/` refuted simple bit
replication for21: some original high-half words round down by one after actual
Metal upload despite the arithmetic-only inverse passing. The corrected planning
probe chooses a U32 encoding around the independently derived binary32 depth;
its65,536 stratified values preserve canonical words with maximum one sampled
ULP. These ephemeral probes guide implementation and are not final evidence.
The final acceptance must prove the complete original domain in the actual
selected resource/backend at its frozen source head.

### 2026-10-11 — worker — self-validation before source freeze

Ephemeral selected-backend hardware validation on headed Chrome155/Apple M4 Max
Metal passed all128 bounded domain chunks:16,777,216 consecutive original UN24
values for each20/21 format, exact canonical public words, and maximum one native
sampled FLOAT ULP. The independent Python inverse reopened complete recorded
original/native/public bodies. The32-case role/mip/segmented matrix includes an
independent exhaustive256-reference S8 diagnostic; three46-case lifetime/fault
schedules and all affected UN16/floating18/126/original Z16 consumer gates passed.
Actual completed depth and S8 mutation controls were rejected after distinct
consumed fences. These runs are self-validation, not the frozen submission.

A whole-result domain recording terminated without a report and was discarded.
The recorder now streams each complete compressed body to disk per bounded
chunk, retaining its descriptor, byte count and digest in the final report. This
changes evidence transport only. Full final recordings remain subject to whole
body custody checks and archive reopening. The seal uses ordered16MiB parts of
one unchanged gzip stream only when needed to fit GitHub's per-file limit.

Nested coverage executes all new packed-depth semantics;10 precise unchanged
D41 color operands are pinned by whole predecessor source SHA, UTF16 offsets and
exact text. The final source must rerun the deterministic acceptance at its
frozen head, followed by one pristine scrubbed clone and a fresh critic.

### 2026-10-11 — worker — implemented, frozen native submission

Frozen source/recording head `c9d745dca15c170d0dfc080d20d39e8696d436fc`.
The implementation is limited to resources.mjs, unorm-depth-images.mjs and the
optional matching stencil scratch format in floating-depth-gpu.mjs. Decoder,
state, actual C/Wasm compiler, core/guest/production and web remain unchanged.

Exact commands and complete recorded bodies are in
`evidence/virgl-packed-depth-images/worker/README.md`. The final hot acceptance
and one pristine scrubbed detached clone pass at the same frozen head; clone
checkout is clean before and after. The full37,947-member seal reopened every
logical body. Archive is21 ordered16MiB-or-smaller pieces of one gzip stream,
339,293,519 bytes, SHA
`e60573b012f80accdeb73f9e1a63d3408c080a8ad4746e68de72b7d373ad602f`;
index SHA `77ad969bd93459de71e673eacfa914f52d2d6d833ddb017f43059de30cbfac1d`.

Per hot/cold run: both complete16,777,216-value original domains,32 role/mip/SG
cases, three46-case varied physical schedules and four refuted native controls.
Independent full-body inverses validate33,563,813 native pixels,268,471,144 exact
public bytes,10,352 padding bytes and all256 S8 values. Successful native FLOAT
samples have maximum one ULP; deliberately corrupted samples are separate.
Native budget rollback, private generations/ranges, GPU-only refresh with
unchanged backing, cancellation, disposal and caller-state restoration pass.
Fence audit:1584 owned,1575 consumed,9 disposal-only;1128 fenced CPU collections
and384 synchronous driver returns. Objects retire once; terminal budgets zero.
Nested V8 coverage:516 executed,10 precise unchanged D41 operands,0 unproven.
Held original UN16/floating18/126/Z16 consumers and actual compiler SHA pins pass.
Original6 packed guest consumer refusals and all historical admission remain.

Worker claim: original20/21 native storage and public transfers satisfy this
bounded storage contract on the recorded real Metal backend. This is a worker
submission awaiting a fresh adversarial critic, not a verified status or complete
production/API/capset/guest graphics/deployment/300MIPS claim.

### 2026-10-11 — fresh verifier — VERDICT: verified

I did not implement this task. Read the task and three runtime diffs before
opening evidence; wrote P1–P11 predictions first, original journal SHA
`42bd4d1c7fcdfe1bd1e1137fcce73ffb09f5f957353edc97e0caaf41b640099d`.
Full per-prediction report, observed native sequences/body digests and precise
demands are in `evidence/virgl-packed-depth-images/verifier/VERDICT.md`.
Every prediction is HELD; no product contradiction or missing worker run survives.

- P1 custody/source — HELD: independently reopened all37,947 D42 and41,650 D41
  logical bodies, authenticated all21 worker parts and915 frozen Git source
  bodies, whole Mesa/virglrenderer/GLES and served V8/compiler identities.
- P2 original fields/admissions — HELD: whole original enum/Mesa/native mapping
  and original numeric wire fields match; all14 old owners,13 old layouts and
  six guest sampler/surface refusals remain unchanged.
- P3 full domains — HELD: independent literal inverses reopen all native/public
  bodies for every0..16777215 UN24 word in both formats/hot/cold; successful
  native max1 ULP, exact public/S8/canonical X8/padding. No code-under-test
  conversion supplies the critic's expected fields.
- P4 native diagnostics — HELD: actual independent depth/S8 diagnostics and all
  256 EQUAL references in each matrix group;47,104 actual reference calls per
  hot/cold matrix. Large extra domain diagnostic is explicitly depth-only, with
  exact native packing/public S8 planes checked across the complete domains.
- P5 physical completion — HELD: independently audited all positive298 rows per
  hot/cold:1584 owned/1575 consumed/9 disposal-only syncs,1128 fenced CPU
  collections/384 synchronous driver returns. Actual completion follows latest
  writers; every native object deletes once and terminal charges are zero.
- P6 lifetime/ranges — HELD: three NEW seeds0x73c19be5,0xd0846f21,0x5e9a7c33 each
  pass46 recorded cases. Full/private NPOT remap, actual matching native refresh,
  unchanged backing, old generations, opposite-format ID reuse, stale queues,
  cancellation and disposal hold in independent full-body/native-event audits.
- P7 precharge/rollback — HELD: malformed/overflow/one-byte-short guards refuse
  before affected native allocation or collection; post-allocation failures
  unwind immediately before disposal and leave no charge/object leak.
- P8 actual completed sabotage — HELD: reopened worker depth/S8 and precision/
  stencil controls. Worker S8 actual169→243 occurs at native sequence106 between
  consumed sync4/96 and sync6/118 (both actual37148), native raw SHA
  `8f0d79898ead31af35fa611c42606f82304405e71fc41928f38300824b65b5f0`.
  Fresh promoted inverse rejects actual199→97 at native sequence131 between
  consumed sync4/122 and distinct sync6/144 (both actual/delivered37146), raw
  SHA `cf2ddc1876d99a1c0619d9368f7bdbbd1b45c5e506d07a6aab21735a6270c2f7`.
  A second fresh existing inverse rejects98→56. These intentional corruptions
  are recorded failing controls; unchanged full original-input inverses catch them.
- P9 retained/cold — HELD: affected UN16/floating18/126/Z16 paths pass;211 actual
  retained D32F_S8 allocations per floating-storage run preserve the old helper
  default. Actual generated MJS/Wasm pins remain unchanged. Authenticated one
  pristine scrubbed frozen cold clone, clean before/after; no repeat was needed.
- P10 finest coverage — HELD: independent raw V8/Git partition reconstruction
  yields516 executed/10 source-SHA/UTF16/text-pinned unchanged D41 color operands/
  0 unproven per hot/cold. No changed packed-depth/scratch semantics are waived.
- P11 novel attack — HELD: correlated low/tie/high/max UN24 pairs and all256 S8/
  X8 through33×17 segmented mips, private levels1..3, eight GPU clear values,
  odd nonzero mip read and held old ranges pass. Promoted test/driver/Make target
  at `d3583d1f4574dfd9fc7a3b0bef0e3e544342cee1` passes two formats/34,170
  predictions and its physical completed-S8 sabotage mode intentionally exits1.

Retained the initial failed promoted-harness capture at8d1a2f55, the refinement
journal written before the completing run, and corrected intermediate pass at
3a08a913. Initial harness wrongly extended the original-upload1 ULP inverse to
GPU FLOAT clear: actual low bits0x358c0001 choose UN24 18 within[17,18], while
the invented inverse0x35900001 differs262144 ULP. Full failed native body SHA
`b64d688f0a32cb7709ddbbe9326b69fa89828fb04a81ba37e8929bd36593f0c9`
is independently reopened. Whole pinned GLES3.0.6 SHA
`7e831831595d3e44c267cc0a0d754f8c244cf3c8f5056f49a674f25fb9d5adeb`
§2.1.6.1/2 (physical PDF23–24), §2.13.1 (PDF95–96), §4.2.3 (PDF201–202),
§3.8.15.1 (PDF176) supports the full clear conversion interval and exact native
choice serialization. Original upload normalization/1 ULP bounds are unchanged;
this was a verifier-harness correction, not a runtime correction or product failure.

SUITE: promoted `renderer/virgl-command/tests/standard-packed-depth-critic.mjs`,
`tools/verify-virgl-standard-packed-depth-critic.mjs`,
`make verify-E6-T11d42-critic` and its actual completed-stencil control. Exact
fresh commands and independent scripts/results are in the critic README/seal.
Critic seal reopens all5,097 logical members/950 real bodies/4,147 earlier-real
hardlinks,228,666,681 logical bytes. One joined7,561,056-byte gzip stream SHA
`c36fb7f77a4088c0c61b283cd4997512079b10ae8d7e6024932d5a27d42334ba`;
index SHA `98df45b4000a79235b6407b5c7beaa59c718ffb60c49016607d750dcfe310991`;
manifest SHA `41d6374be74e6119bfc85cd35e4e9d97345c0904f7ddd512f4a988cac5560400`.

Frozen runtime is unchanged fromc9d745dc at final critic harness d3583d1f; status/
evidence commits change no runtime. Final scoped Node syntax, independent Python
script compilation, diff whitespace and task policy checks pass; queue rebuilt
after policy. Carry D41 HELD results only at authenticated unchanged boundaries.
No production/API/caps, real guest Mesa/compositor/scanout, deployment or300MIPS
authority is granted. All Git/index/source/Node/compiler/browser/GPU leases are
released to the root after the final verdict/evidence/status commit.
