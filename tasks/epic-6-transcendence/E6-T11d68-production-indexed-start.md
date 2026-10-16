---
id: E6-T11d68
epic: 6
title: Preserve original indexed DRAW start hints in production
priority: 525.027036
status: verified
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

### 2026-10-14 — fresh verifier

VERDICT: verified

- P1 original indexed hint — HELD. Before inspecting the result, predicted
  from pinned VirGL1.3.0 `vrend_renderer.c6139–6157` that indexed GL calls use
  only `sub_ctx->ib.offset`, including nonzero and overflowing start hints.
  The nine recorded width1/2/4, schedule0/1/2 rows authenticate the literal
  original Quickshell packet, complete poisoned uploads, unchanged offset8
  and exact62-index native copies. Starts0/1/u32MAX and the repaired follow-up
  produce all independently recomputed green pixels and untouched strided RAM
  padding. Citation: sealed cold `indexed-start/hardware/run-0000..0008.json.gz`
  and the pinned native source; no remaining demand.
- P2 bounded novel offset/restart — HELD. Predicted that offset12 selects
  seven u32 indices0,1,2,MAX,2,1,3 despite dishonest min/max hints2..2, and that
  the two strip segments cover all16 pixels magenta. Both independent schedules
  173205/987654 hold exact native copy offsets, returned index bytes, actual
  bounds0..3, restart count1 and literal pixels. Poisoned suffix, storage-span
  and valid signed-array negatives have no native draw effects. The private
  profile admits start0 and refuses start1. Citation: independent novel03 and
  final cold `indexed-start/promoted-novel/run-0000..0003.json.gz`; no remaining
  demand. The original upload is authenticated at transfer time; the draw reads
  retained native storage rather than gathering guest backing again.
- P3 test sensitivity — HELD. Predicted that adding start-times-index-size
  would change the selected poisoned span. A single isolated served-copy
  mutation produces original0x1205 for start1 instead of required0x1100, while
  start0 and the private profile still pass. The repository runtime is
  unchanged and all native owners/syncs retire. Citation: independent
  `critic-production-indexed-start-sabotage-01`; no remaining demand.
- P4 ownership and preserved guards — HELD. Each worker row records five
  physical draws, exact original responses/fence echoes, the original24-byte
  CTX_DESTROY after a pending fenced draw, and zero final native owners/syncs.
  Zero-count, span, actual-fetch and array-range refusals remain explicit.
  Existing native transport/capability, private-profile and earlier unchanged
  ABI/budget/loss predictions carry forward; no remaining demand.
- COVERAGE — HELD. The changed `prepareDraw` and `decodeFields` guards execute
  in both production and private profiles, including nonindexed refusal and
  u32MAX admission; independent precise coverage records22 executions of each
  enclosing changed path. Canonical, web-source and built-dist modules are
  byte-identical. Message text is waived as diagnostic-only; mirrors are
  exact copies; roadmap metadata is exercised in the built demo. The new
  recording target, full cold path, source inventory and authenticated hot
  continuation execute. The separately recorded pending query probe/metadata
  grants no production API claim.
- P5 final custody and clean clone — HELD. Reopened all257 worker archive
  identities and all123 cold file identities; independently interrogated all13
  cold rows (131108 assertions), their guest command traces/machine digests,
  exact sources and rebuilt proof Wasm. Frozen head is
  `01730dff4bb381755d560910cddb0380da096404`; later commits only add evidence and
  task metadata. Ordinary full-history clone uses `--no-local`, scrubbed
  environment, fresh build and all11 acceptance gates with no carry. Native
  389+13+2 tests pass without ignored tests; private replay and built demo127/0
  pass without unexpected errors or proof exports. The introduced default-demo
  else-association was independently reproduced and its harness-only fix
  rechecked. No remaining D68 evidence gap.

Worker evidence: `worker/exact-head-submission-and-cold.tar.gz`, SHA256
`c973a1abcd9f5f6ae81cd8cedccc050d79ac3294d20473267f9c6a6cd2e85021`.
Independent evidence: `verifier/independent-original-indexed-start-01.tar.gz`,
SHA256`7ccc6d6522045181a658e8c9fb653b901bf9a126fbaff29ff75400e555ddf00a`,
95 reopened identities. Both are under `evidence/virgl-production-indexed-start/`.
`verifier/final-audit.json` binds the cold rows, source/binary identities and
scope. SUITE: promoted original-queue indexed-start critic/browser harness,
worker matrix and `make verify-E6-T11d68`; retained served-copy sabotage.

Commands: independent critic browser with schedules173205,987654; isolated
`--sabotage indexed-offset`; actual default-demo taskD before/fixed replay;
worker archive/record custody and literal-byte audits; final full cold
`make verify-E6-T11d68`; task policy and queue regeneration.
This verdict covers the original indexed-start boundary. Complete default
Omarchy, mandatory queries69a/69b, recovery and deployment remain separate.
