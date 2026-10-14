---
id: E6-T11d69b
epic: 6
title: Measure logical original transform-feedback primitive query counts
priority: 525.027038
status: implemented
depends_on: [E6-T11d69a]
estimate: S
risk: high
capstone: false
---

## Boundary

Original query type6 reports real TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN through
the independently held query/resource lifecycle from69a. The original capture
lowering assembles primitives and repeats POINTS capture per output buffer;
measure real native capture and normalize to original logical primitives once.
Do not sum duplicate output-buffer passes or publish CPU predicted counts.
Unsupported query types remain refused. Bounded allocations, availability,
resource/generation ownership and cleanup remain intact.

## Deterministic acceptance

`make verify-E6-T11d69b` records original query commands, real native feedback
query results and exact original16-byte guest result readback. Independently
predicted counts cover points/lines/triangles, strips/fans, fixed restart,
instances, multiple output buffers, capacity truncation and zero capture.
Interleave virtual owners and completion schedules. Check logical counts against
actual captured data, type6/index0, availability/state/result_size4/u64 high0,
unsupported query types, reuse/destroy/reset and loss. The independent actual
RISC-V GBM/GLES3 probe must admit allthree mandatory targets with no GL errors
or rejected valid transport commands. Record affected high-risk gates and one
final clean clone. Parent then separately proves default Omarchy and deployment.

## Adversarial verification

Fresh verifier holds the source lowering against actual native query calls and
captured bytes. Invent one bounded multi-buffer/restart/capacity case. Sabotage
duplicate-pass counting or primitive normalization and demand that the guest
result oracle fails. Carry unchanged69a results. No CPU capture prediction or
mocked native counter suffices.

## Evidence carried

The independent actual-GLES3 negative and pinned original ABI are preserved in
E6-T11d69 and the committed original-negative seal. Public renderer remains
virgl; no llvmpipe, invented packets, fabricated availability or CPU count may
justify a positive result. Parent default Omarchy remains a separate acceptance.

## Verification log

### 2026-10-14 — worker — active

Continue the existing native PR stack after independently verified69a at
8ce1cc97. The execution boundary is real per-draw native feedback measurement,
normalized per primitive and counted once across output buffers. Parent desktop
input, recovery and deployment remain separately gated.

### 2026-10-14 — worker — implemented; exact-head submission

Runtime frozen at `9e97707dfd417216ec9d10e3054b12e9aad882c3` (implementation
`b50fda32`, browser mirrors `9e97707d`). Original type6 now measures the first
actual native POINTS capture pass of each original draw, retains that draw’s
primitive divisor, validates native availability/uint32/divisibility, and sums
normalized counts once across output buffers. Boolean and feedback queries
coexist per virtual owner. Empty queries receive actual native measurements;
a capture/scatter error invalidates its complete logical query and retires its
native parts. All results use original CUSTOM storage and16-byte guest transfers.

Recorded commands:

- `python3 tools/virgl-production/verify-feedback-queries.py --output target/evidence/production-feedback-queries-frozen01` — all12 gates passed:
  policy, format, core/native and Wasm clippy, native tests, transport/typed ABI,
  actual proof Wasm build, feedback hardware, held boolean hardware, promoted
 69a attacks/framing, private profile, ordinary default demo127/0/zero errors.
- Feedback hardware: three completion schedules and physical pending-query
  context loss;23 direct cases per schedule;1,289,921 assertions. Literal
  primitive identities cover every point/line/triangle mode, restart, instances,
  four output buffers, per-draw mixed counts, unequal capacities, empty capture,
  exact data/padding, owner interleaving, reset, active destruction, and an actual
  GL error after real scatter followed by explicit incomplete-query refusal.
- Held boolean matrix7 rows/192,598 assertions and promoted69a matrix6 rows/
 2,000,588 assertions passed unchanged.
- `python3 tools/virgl-production/cold.py --task E6-T11d69b --output target/evidence/production-feedback-queries-cold01` — ordinary full-history
  `--no-local --single-branch` clone, scrubbed environment, no carried build or
  assets, `make web-dist` and all12 acceptance gates passed on the same frozen
  head. Hardware row counts and assertions match the hot submission.
- `VIRGL_WEB_ROOT=<frozen ordinary dist> VIRGL_GUEST_IMAGE=target/virgl-production/image-12 VIRGL_INTERACTIVE_HOLD=1 node tools/virgl-production/browser.mjs target/evidence/production-feedback-gles-probe01 probe` — default Wasm/production
  worker and actual RISC-V kernel/Mesa26.2.2; original serial command in
  `query-command.json` executes independently compiled GCC12 GLES C02. Public
  renderer is `virgl (wasm-vm WebGL2 VirGL)`, no software DRI. Allthree mandatory
  targets admit/current-query/actualempty0. Two-buffer counts5/3/3, mixed11,
  exact-fit4 and incomplete0 passed; every12 complete1024-byte mapped buffer
  matched literal data/padding. Expected overflow0x502 and optional numeric/
  timer0x500 refusals passed. Probe exit0; all query owners/parts/pending0.

The independent C01 originally expected partial success for an overflowing GLES
LINE_STRIP draw. The spec §2.15.2 requires INVALID_OPERATION, so that first
negative is preserved alongside C02’s explicit negative and valid exact-fit
replacement. Original Gallium/MMIO capacity truncation remains independently
exercised, including asymmetric output capacities.

The ordinary image12/default-SDDM capture `production-omarchy-gpu-feedback01`
preserved C01’s real mandatory/basic/mixed positives but later failed with an
actual worker-heartbeat timeout during desktop startup. That full recording is
closed and sealed as negative parent evidence. This task does not claim default
Omarchy keyboard/bar, complete startup, recovery, performance, or deployment.
The component query proof does not replace those parent acceptance criteria.

Committed worker seal:
`evidence/virgl-production-feedback-queries/worker/exact-head-query-submission-and-cold.tar.gz`
—28,846,513bytes;SHA256
`8b527cd2ba48b62479435bb78c6471732e031b8ebca9b0a5a1e83695afeb9ec4`;
paired JSON authenticates1,038 file identities. Every archive member was reopened
and authenticated. It includes hot/cold records (excluding the cold checkout),
661 immutable ordinary assets, both complete actual guest recordings, both C
sources/binaries/build receipts, original serial/GPU logs and source/image pins.
Submission-only writes add this log, a boolean-doc qualifier and the independently
compiled C02 fixture; renderer/browser bytes stay at the frozen head. Fresh
verifier verdict remains required.

### 2026-10-14 — fresh verifier finding — VERDICT: refuted

Aggregate-error isolation — FAILED twice on frozen9e97707d. Independent
actual native counts9/6/5 were observed, then the fixture delivered individually
valid uint32/divisible counters whose logical sum7,874,106,707 exceeds the
original result width. The GET correctly refused0x1201 and wrote no DONE, but
queries.mjs70/74–75 retained three available parts and queryRequestedtrue.
After removing the fault, global pollPending80–85 rejected an already-ready
independent context2 GET0x1201 rather than0x1100. NativeParts3/pending1
remained. Exact fault row `target/evidence/critic-production-feedback-queries-faults-01/run-0003.json.gz` SHA256
`cf98407d17e7bb42991aa9467efd1acdc098fe254d019220f94616f946142d2e`; independent316227 recheck report
`target/evidence/critic-production-feedback-queries-overflow-recheck-01/report.json` SHA256
`f679262e2304208bf79b6d2df59d443a9b237801509e02bd308d143145e4af9d`.

Demand: quarantine/clear the unrepresentable aggregate or permit validated
reread so other owners and query destruction stay usable. Saturation and a
particular same-query retry are not required. The verifier carries HELD mixed/
capacity/restart/empty data/counts, actual C02 valid-host proof, and transient
fractional/nondivisible/u32+1 rejection plus healthy retry. Worker restores the
active lane and repairs only this boundary; no broader parent claim is made.

### 2026-10-14 — worker — repaired exact-head resubmission

The independently reproduced aggregate-isolation failure is repaired at
`ad3798a2`; ordinary browser mirrors/dist freeze at
`aa451b8170852b882632a6bc6ee1118bd0a2501a`. Query source SHA256
`08027068614d5501746515918ec423a30188448d3ce031bb619ef08805fe9e0d`.
Before refusing an unrepresentable aggregate, the controller clears native
parts, stops polling and marks that logical query invalid. It returns the
original error once; another owner’s ready query and the rejected query’s
destroy/fresh-BEGIN paths remain usable. Existing per-part transactional
retries, count calculation, boolean queries and capability negotiation are
unchanged. The old failure and both independent reproductions remain preserved.

The narrow original fixture passes on both271828/316227 schedules at
`production-feedback-aggregate-repair-self01` (20,106/20,107 assertions). The
independent nine-mode test is permanently promoted in
`critic-fast-boots-feedback-queries.mjs`/`-browser.mjs` and included in acceptance.

Recorded repaired submission commands:

- `python3 tools/virgl-production/verify-feedback-queries.py --output target/evidence/production-feedback-queries-frozen02` — all13 high-risk gates pass on
  the frozen head. Four feedback rows/1,289,895 assertions; eight promoted
  feedback rows/135,788 assertions; seven held boolean rows/192,598 assertions;
  six promoted boolean rows/2,000,588 assertions; private profile and ordinary
  default demo127/0 with zero browser errors. All preceding native/Wasm format,
  clippy, native tests, transport/typed ABI and proof build pass.
- `python3 tools/virgl-production/cold.py --task E6-T11d69b --output target/evidence/production-feedback-queries-cold02` — final full-history, no-hardlink,
  no-carry clone builds ordinary dist and passes all13 acceptance gates on the
  same exact frozen head with scrubbed Rust/Cargo/VirGL/critic environment.
- The independently compiled C02 is rerun through the actual default Wasm/
  production worker/RISC-V kernel/Mesa image12 using the immutable661-asset
  `production-feedback-queries-normal-dist02/dist`, existing `browser.mjs probe`
  and original serial command in `production-feedback-gles-probe02/query-command.json`.
  Allthree mandatory admission/current-query/empty results, counts5/3/3,11,4,0,
  twelve full1024-byte captured outputs, expected overflowing-draw0x502 and
  optional counter/timer0x500 pass again with actual VirGL/no software DRI.
  Probe exit0; query owners/parts/pending0; component closed successfully.
  Its whole original GPU record is12,310,373bytes/SHA256
  `638d8b2999781d0c39b8806c4a5ee2c86abc3a203ae23f7351a9888f3ec08729`.

Fresh coverage review identified the production capture-without-query path as
a narrow proof gap. The verifier recorded real mixed two-output capture with
untouched context1 query storage and no context1 native query allocation. It
promoted that ninth mode after the final cold proof. The worker reruns only
this touched test harness, per incremental policy:
`node tools/virgl-production/critic-fast-boots-feedback-queries-browser.mjs --output target/evidence/production-feedback-queries-promoted-final01` — nine rows/
150,714 assertions pass. No runtime bytes change and no unrelated cold proof
is restarted. Invalid/empty selector guards are test harness input validation.

Reopened/authenticated repair seal:
`evidence/virgl-production-feedback-queries/worker/repaired-query-submission-and-cold.tar.gz`
—32,312,349bytes,1,158 file identities,SHA256
`4ecd06a35fe8a867d689e419ae431e5e274c117d7d78e31991717194d4f909aa`.
Test-only supplement:
`evidence/virgl-production-feedback-queries/worker/promoted-no-query-supplement.tar.gz`
—1,596,024bytes,47 identities,SHA256
`c35ee9fe3775a6cc5bd6ea816236596446bf06f5eb01575e735d6ea361e3c23d`.
Both paired JSON inventories bind every member. Earlier worker/negative seals
remain immutable. Normal/default Omarchy startup/input, its recorded heartbeat
failure, cursor recovery, fast-boot/deployment and performance are expressly
outside this task’s claim and still gated by the parent/e work.

### 2026-10-14 — verifier audit carried to parent

The independent original-packet sweep holds C02 query/capture/result commands
through context2 destruction (`production-feedback-gles-probe02/gpu.ndjson`
2755–2979), with no query/transfer rejection. It also identifies generic console
scanout capture-budget refusals after the C context cleanup: new02 lines7837–7892
(12 beginScanout out-of-memory replies); old01 lines50159–50313 (15). These are
preserved, explicitly outside the query claim, and carried to the parent scanout/
recovery proof. The complete guest recordings are not claimed to have zero
GPU/control errors. No positive default desktop or recovery claim is inferred.
