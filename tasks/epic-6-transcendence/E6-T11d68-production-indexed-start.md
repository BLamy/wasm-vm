---
id: E6-T11d68
epic: 6
title: Preserve original indexed DRAW start hints in production
priority: 525.027036
status: in-progress
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
independently predicted pixels. Captured gathers must use the unchanged binding
offset and exact selected span. Out-of-bounds binding/count/actual vertex fetch
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
