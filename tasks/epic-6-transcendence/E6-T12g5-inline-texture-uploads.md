---
id: E6-T12g5
epic: 6
title: Execute bounded RESOURCE_INLINE_WRITE and stride-repacked uploads
priority: 525.0270105
status: implemented
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
