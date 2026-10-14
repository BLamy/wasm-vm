---
id: E6-T11d68
epic: 6
title: Preserve original indexed DRAW start hints in production
priority: 525.027036
status: implemented
depends_on: [E6-T11d67]
estimate: S
risk: high
capstone: false
---

## Boundary

Production indexed DRAW_VBO accepts the original ignored start hint. Pinned
VirGL1.3.0 uses the retained SET_INDEX_BUFFER byte offset directly for indexed
GL calls, independently of DRAW.start. Do not add start times index-size, do not
trust min/max hints, and do not weaken binding/range/fetch budgets. Preserve
private proof profiles and original array draw signed-range guards.

## Deterministic acceptance

`make verify-E6-T11d68` records original qualified Wasm/MMIO allocation, backing,
transfer, indexed draw and readback on hardware WebGL2. Exercise literal original
Quickshell start1/count62/strip/restart words, starts0/1/u32MAX, valid nonzero
binding offsets with poisoned prefix/suffix, supported index widths, and exact
independently predicted pixels. Original uploads must authenticate the poisoned input bytes; retained index
reads must select the unchanged binding offset and exact selected span. Out-of-bounds binding/count/actual vertex fetch
refuse before a native draw; retained resources/fences/cleanup remain bounded.
Record guest traces/digests, affected high-risk gates, built demo and one final
pristine-clone proof. Full default Omarchy acceptance belongs to the parent.

## Adversarial verification

Fresh verifier predicts ignored indexed start from pinned native source before
reading the result. Use a bounded novel hint/offset/restart combination, check
actual gathers/native pixels and poisoning guards, and sabotage start-times-size
to require failure. Preserve private profile nonzero-start refusal and array
signed-range guards. Every changed runtime line must execute or be waived.

## Verification log

### 2026-10-14 — worker — actual default Quickshell negative

Parent capture production-omarchy-gpu-profile12-09 records eight original
unsupported-draw failures. First request1515/failure1517, sequence0183/context9,
byteOffset4244, original words
[786440,1,62,5,1,1,0,0,1,65535,0,4294967295,0]. Pinned native renderer
SHA256be7e5c63fb501cb77bd5b2c13c332f8b93c49fd04d207f17d434932c237f4ea3
6139–6157 ignores indexed info->start and uses sub_ctx->ib.offset directly.
Original request streams and exact outcomes are preserved; no positive claim
comes from this negative. The explicit user request continues this single
graphics boundary in the existing native PR stack.

### 2026-10-14 — worker — original negative sealed; narrow runtime correction

The actual default-session negative, immutable served renderer/default Wasm,
complete original commands, independent GLES query probe and client/image/build
identities are sealed in
`evidence/virgl-production-readiness/default-omarchy-indexed-and-query-gap/original-negative.tar.gz`,
SHA25602ff956cc3d933cf7dda9c0db44c4cf8d04878d5bae4bd84b78f5d4f8dbdaaaf,
94 files authenticated by paired JSON. This binds request1515/failure1517 and
all eight original Quickshell refusals to the source that executed them.

The production decoder now ignores indexed start/count arithmetic because the
pinned native indexed path ignores that hint; the consumer admits nonzero
indexed starts only for production. Binding offsets/spans, actual fetched
indices, original array signed-range guards and private profiles remain intact.
The nine self-validation matrix runs pass across index widths1/2/4 and completion
schedules0/1/2, with original start1/count62/strip/restart words, hints0/1/u32MAX,
literal full green quad pixels and complete readback padding, span/actual-fetch
refusals and fenced immediate context destruction. Failed harness runs remain
preserved: the first wrongly expected a second guest-backing gather at draw
time, although the original upload authenticates retained native storage; the
second exposed the decoder's obsolete start/count overflow condition; the third
used a28-byte resource-id helper rather than the original24-byte CTX_DESTROY
header. The corrected array negative uses restart0 so it reaches the runtime
signed-range guard. These are self-validation, not the frozen submission or
fresh verdict.

### 2026-10-14 — worker — evidence harness repair; prior gates carried

Frozen f9874e31944d215658a4f81190a9651352fbb3df passed policy, format, core/wasm
clippy,389 core library tests, original transport/capability tests, proof build,
all9 selected hardware runs and the promoted independent offset/restart rows.
Its submission stopped at the historical private-profile server: two imported
modules (dimensional-depth-images.mjs and multisample.mjs) were absent from its
strict served-source inventory, producing actual404 errors before runtime import.
This is a proof-harness gap. Adding those exact dependencies makes the original
private replay pass without runtime changes.

The evidence-only continuation authenticates the completed prior report/files,
passing gate statuses and exact current served source/proof-binary hashes. It
allows only the two recording scripts and this task log to change; any runtime
or dependency change forbids carry. It repeats the missing private/default
proof. The final pristine-clone run remains full and does not use carry.

### 2026-10-14 — worker — exact-head submission

Frozen runtime head `01730dff4bb381755d560910cddb0380da096404`. Full ordinary
pristine clone: `python3 tools/virgl-production/cold.py --task E6-T11d68 --output
target/evidence/production-indexed-start-cold-01`. Its clone (no local hardlinks),
`make web-dist`, and full `make verify-E6-T11d68` all exit0 with scrubbed proving
environment. All11 acceptance gates pass, including9 original hardware matrix
rows,4 promoted independent offset/restart rows, private historical replay and
the default built demo127passed/0failed with zero console errors. The full cold
run uses no carry. The hot evidence-only continuation
`python3 tools/virgl-production/verify-indexed-start.py --output
target/evidence/production-indexed-start-frozen-02 --carry-from
target/evidence/production-indexed-start-frozen-01` also passes. The earlier
missing-module404 is preserved and its held gates authenticated.

The reopened worker seal is
`evidence/virgl-production-indexed-start/worker/exact-head-submission-and-cold.tar.gz`, SHA256
`c973a1abcd9f5f6ae81cd8cedccc050d79ac3294d20473267f9c6a6cd2e85021`, 257 files with paired JSON
identities. Native source, actual Wasm/MMIO input uploads, retained binding
reads, exact pixel/readback-padding oracles, refusals, fences and destruction
are recorded. This proves the indexed hint correction and preserved guards;
it does not claim complete default Omarchy, GLES queries or final deployment.
Fresh adversarial verdict remains independent.
