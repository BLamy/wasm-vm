---
id: E6-T12g5
epic: 6
title: Execute bounded RESOURCE_INLINE_WRITE and stride-repacked uploads
priority: 525.0270105
status: verified
depends_on: [E6-T12g4]
estimate: S
risk: high
capstone: false
---

## Boundary

Complete RESOURCE_INLINE_WRITE and required stride-repacked texture uploads
through the checked command/store boundary. Preserve exact guest bytes, format
conversion, boxes/levels/row/layer strides, deferred ownership and generation
checks. Do not decode opaque END_TRANSFERS padding recursively or weaken other
command framing. Use original packet/payload provenance wherever captured.

## Deterministic acceptance

`make verify-E6-T12g5` executes required original inline/transfer packets
and independent physical byte/color/depth oracles, including odd padded rows,
partial boxes, caller mutation and async yields. Bound all allocations before
GPU effects; require malformed/short/overflow/unsupported packets to fail and
an exercised copy/stride source fault to be detected. Retain format/view and
tiny-scene regressions and final pristine-clone proof.

## Adversarial verification

Attack packet lengths, trailing data, offset/stride/layer overflow, caller
mutation and detached/shared inputs, bad resource roles, ID reuse and overlapping
rows. Check untouched guest padding and neighbors. Sabotage one row or inline
payload offset and require the independent physical oracle to fail.

## Verification log

### 2026-10-04 — worker — execution boundary

Continue the user's graphics-offload chain from independently verified G4
`feb78352200139079db61257acf1de1004456037`. The authenticated G1 inventories
contain zero client RESOURCE_INLINE_WRITE packets, two kmscube TRANSFER3D
packets and three es2gears TRANSFER3D packets. Prove those original packets and
payloads separately from synthetic inline packets; do not invent capture claims.

Admit opcode9 with the pinned eleven common words and data beginning at word12,
level0 and one buffer/2D layer. Preserve opaque usage. Default row stride is the
whole resource's width in guest bytes; default layer stride is the whole height,
as in pinned vrend_renderer transfer validation. The narrow inline profile accepts
exactly the rounded-up strided footprint (up to three unused alignment bytes),
not extra whole words. Repack owned dense scratch only after bounds/quotas. Inline
payloads do not require guest backing, never scatter into backing, and async jobs
yield before issuing their owned upload with resource/membership generation checks.
END_TRANSFERS stays opaque. Higher mip/layer/target families remain rejected.

Acceptance includes original normal transfers, native color2/67/233 and Z16,
odd/padded rows and partial boxes, buffer input, padding/neighbors, default strides,
malformed/overflow/accessor inputs, caller mutation, actual delayed fences, ID and
attachment reuse, allocation/backend fault rollback and independent source sabotage.
The compiler/CPU/web deployment boundaries remain unchanged; negotiation is disabled.


### 2026-10-04 — worker — recorded implementation claim

Frozen runtime/harness head `7c155f8ff630d4a83786cb2f4c982ddb26e3ab69`, diff base `feb78352200139079db61257acf1de1004456037`.
Commands: `VIRGL_INLINE_EVIDENCE_DIR=target/evidence/virgl-inline-worker-final
make verify-E6-T12g5`; `python3 tools/virgl-command/inline-cold.py --output
target/evidence/virgl-inline-worker-cold`. Both exit0; cold exact head has no
tracked/untracked changes before/after, with scrubbed configuration. The gate
builds the unchanged pinned wasm compiler and runs affected decoder, resource,
state, draw, async, color, depth and view paths. G4 retains44 unchanged flat
renderer draws. Rust/CPU/full guest/compiler semantic boundaries are unchanged;
no unrelated workspace wall, production deploy or host rr is claimed.

The Node/browser admission transcript has202 identical assertions; hardware
Chrome154.0.8037.93 / ANGLE Metal Apple M4 Max has3907 held assertions with
zero console/page/request/GL errors. Five original normal packets and pre-submit
CPU payloads execute with independent GPU digests: kmscube resource5@125
event140/byte0 with snapshot139, resource4@114 event154/byte0 snapshot152;
gears resources36/37/38 event5115 bytes0/56/112 with snapshots5112/5113/5114.
Neither client has original inline packets. Synthetic inline proof covers
color67/2/233, Z16 and vertex/index buffers, owned whole and partial boxes, odd
row strides and resource-width defaults, padding/backing/neighbor preservation,
caller dword/input mutation, direct async access and twelve actual-fence jobs
(delays0/1/3, each native texture format, A/B/A), context/member/resource name
reuse, cancellation/disposal, backend failure/recovery, quotas before GPU issue
and the exact262144-byte submission/262096-byte inline payload limit.

Two independent served runtime faults are caught before inverse readback:
inline offset+1 at raw RGBA texel0 expected[0,85,170,7], observed[85,170,7,85];
using rowBytes instead of rowStride at partial texel11 expected[85,170,85,158],
observed[165,165,165,85]. Opaque END padding, malformed/trailing/short packets,
unsupported levels/layers, roles, offset/row/layer overflow, accessor/sparse/
shared/detached inputs and incorrect opcode metadata all reject without upload.

Evidence: `evidence/virgl-inline-uploads/worker/manifest.json`, `records.json`
and `recording.tar.gz` (76 regular artifacts), archive SHA256
`04553ec60232a633120c7de041e13e297ce46134684712f6a6d39d75c76df157`, index SHA256
`992ce84526079024210ad159f0910e1d30954d349b4b2e0df4f6c7386f4f6bf1`. Hot receipt SHA256
`dfdf0a4ba11f1ae6109ffa4ba47956b80030bb947aa16780a78954c4cea23e18`; cold report SHA256
`36c3a2078053a91075eb0529b41334f9eda9b3ab6d6dbf62de6178bb4a9b92c0`; cold receipt SHA256
`51879851fad12cb85d8de49325b313c04f4f7a20dad2dca9471886897da790c2`. Includes complete reports/counters/screenshots,
source faults, logs, frozen diff and generated wasm artifacts. Hot/cold source
and input tables match. `hot/changed-line-coverage.json` gives positive first-token
V8 ranges for all57 added runtime lines, with structural/comment lines identified;
this is a worker map, not an independent coverage verdict. Production negotiation
remains disabled; full inventory/shader closure is G6 and raster depth state H.


### 2026-10-04 — fresh verifier — VERDICT: verified

VERDICT: verified

Read AGENTS.md, the entire task and frozen runtime/harness diff before evidence,
then recorded predictions before observations in
`target/evidence/virgl-inline-uploads-verifier/predictions.md`. Reviewed runtime
`7c155f8ff630d4a83786cb2f4c982ddb26e3ab69` against independently verified G4
`feb78352200139079db61257acf1de1004456037`; `ecabcafb` is the worker submission.
All P0–P8 and N1–N4 are HELD; no semantic refutation or sufficiency gap survived.
Full points, per-token coverage, evidence digests and suite decision are in
`target/evidence/virgl-inline-uploads-verifier/verdict.md`, SHA256
`be8b38a0b936cd6280d327c2911c43e32cc2a476ba038e7133b9044059a24dad`.
Prediction results SHA256
`ac48d6be72d4e5d7cd631b481ee9cd190863df7c76767fd79d3ee58ea71b5281`.

Here `W` is authenticated worker archive member `hot/hardware/report.json`,
SHA256 `6e1a9bc1c7f7c3d79cf9580439f4fd31be644cf1ec203726c664e0904257c740`;
`N` is verifier `novel-clean/report.json`, SHA256
`9d1011ce3f11a91fadc8a19e97be7e51434ab86d5605b4b05f959fb10b32f335`.

- **P0/P8 — HELD.** Independently authenticated all76 regular archive members,
  84 frozen source and40 input bindings, generated compiler, served modules,
  counters and screenshots across23 hot/cold reports. Archive SHA256 remains
  `04553ec60232a633120c7de041e13e297ce46134684712f6a6d39d75c76df157`.
  Exact-head cold report:4–21 has exit0, pristine before/after and scrubbed
  environment; its digest remains
  `36c3a2078053a91075eb0529b41334f9eda9b3ab6d6dbf62de6178bb4a9b92c0`.
  Hot/cold source/input tables match. All eight affected regressions pass;
  unchanged G1–G4/compiler/CPU conclusions carry forward. Retained flat view
  regression records44 draws,12 faults and zero final budgets. No portability
  finding warranted repeating the once-final pristine clone.
- **P1/P4 — HELD.** W:247 proves eleven common words, immutable word12 data
  and opaque usage; W:389 keeps END padding opaque. W:1529/1535 prove no getter
  invocation and zero guard uploads. W:1809/2087/41411 prove quota, allocation
  and backend rollback. W:1731/43721 physically prove exact262144-byte wire /
  262096-byte payload, with one added dword rejected. Short/trailing, overlap,
  offset/stride/layer overflow, unsupported level/layer/role and inconsistent
  metadata reject. N:187640 independently repeats malformed/role/input attacks.
- **P2 — HELD.** W:431/463 prove odd row arithmetic and resource-width default
  stride. Whole/partial color67/2/233, Z16 and vertex/index bytes match physical
  observations, including untouched neighbors and backing at W:8037.
  `observation-audit.json` independently recreates all18 partial-upload GPU
  digests exactly without renderer layout/conversion/inverse helpers, SHA256
  `9367d63e5f9a42f837abc03e6b327d1fa2c8c2c22d69660249a66d83e81f157b`.
- **P3 — HELD.** W:16829/16841 observe upload-ready before issue with no DMA
  request; W:17281/40175 prove scratch cleanup and zero stale/cancelled writes.
  Twelve actual-fence A/B/A configurations hold at delays0/1/3. Dword/caller
  mutation and unrelated backing changes preserve owned data. N:129044,
  132408 and182156 independently repeat yields, fences and generation attacks.
- **P5 — HELD.** Independent `provenance.json` authenticates all147/8533 listed
  client packets against original blob bytes and confirms zero original inline
  packets; unchanged G1 supplies table completeness. Five independently parsed
  original normal packets and CPU inputs match physical GPU digests: kmscube5
  event140/byte0 snapshot139; kmscube4 event154/byte0 snapshot152; gears36/37/38
  event5115 bytes0/56/112 snapshots5112/5113/5114. Synthetic inline proof remains
  explicitly separate. Provenance SHA256
  `9030ddb5b76a701f339e0e222215e78d28c0c8de9ab5a9b8bc1291e8b463bc4a`.
- **P6/N4 — HELD.** Both worker physical faults reject. Fresh served row
  reversal fails the new physical test at `sabotage-row-reverse/report.json:216`,
  expected[0,85,170,7], observed[255,170,0,50], before inverse conversion.
  Report SHA256 `099a61e83f7081c6086a0ac5f18a7b2eee439f241c042573cb37a111cb7e356a`.
  Separate blind assertion-result sabotage claims pass; independent recorded
  expected/observed comparison catches1520 mismatches, starting assertion205.
  `sabotage-test-blind/report.json` SHA256
  `c20636f483861e99404aae9bbb06f012d87821f3e4db787df320e231f9bb0d65`.
- **P7 — HELD.** Independent zero-context diff/lexical/UTF-16 smallest-range
  V8 audit excludes worker map and mutants. All significant tokens on50 added
  runtime lines execute; seven comment/structural lines are waived, with no
  dead or unproved behavior. `coverage-audit.json` SHA256
  `12e56a9690d193a95219ffba3a7f3aef1d05b796275e1b5d36764b55abd742cc`.
  Declarative docs/metadata and generic harness environment-failure glue add
  no guest claim; recorded logs exercise all new acceptance/cold/receipt paths.
- **N1/N2/N3 — HELD.** Independent Chrome154.0.8037.93 / ANGLE Metal Apple
  M4 Max hardware run passes19594 assertions on18 format/role matrices,
  12 A/B/A jobs and18 lifetime/malformed attack groups. Fresh seeds
  1838461447/418555341/3273552027, delays2/4/6, arbitrary packed10-bit/Z16
  float sampling, odd/default/edge boxes, terminal alignments0–3, poisoned
  UNPACK state and backing/neighbor canaries all hold. All final budgets/native
  names are zero; zero console/page/request/GL errors.

Commands: verifier `authenticate.py`, `coverage-audit.py`, `provenance.py`,
`audit-recording.py`; `node .../run-novel.mjs clean`, `row-reverse`, `test-blind`.

SUITE: retain the committed `inline-uploads.mjs` deterministic physical/
ownership/guard checks, physical source-fault gate and `make verify-E6-T12g5`.
Preserve fresh seeds, independent driver/counters/observations/sabotage as replay
artifacts; no duplicate tracked test or runtime edit was needed. Full-client
shader closure remains G6 and raster depth H. This verifies the isolated inline
transfer boundary, with no full offload, MIPS, negotiation or deployment claim.
No unrelated Rust/CPU/compiler wall, host rr, cold repeat, deploy or Git mutation
was run. Root owns evidence preservation, queue regeneration, commits and stack.

### 2026-10-04 — worker — preserve independent verdict

Preserved the critic's27 nonduplicate artifacts under
`evidence/virgl-inline-uploads/verifier/`, using its original
`verifier-manifest.json`, `verifier-records.json` and `verifier-recording.tar.gz`.
Archive SHA256 `afcc8f01446a1c38bce509eb8208142b4c8e2fac11861ee1cb927c9dcb78cabe`;
index SHA256 `d356775028bb57cac39780872d26a92d3a1dabc8eacc686993df8cfbe9a7ad8f`.
The seal binds frozen7c155f8f and the original worker archive; extracted worker
duplicates are excluded. The independent verdict/all13 held predictions remain
unchanged. No runtime or harness change followed the final recorded source.
