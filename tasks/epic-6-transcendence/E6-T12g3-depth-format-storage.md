---
id: E6-T12g3
epic: 6
title: Prove required packed depth formats and explicit unsupported depth rejection
priority: 525.0270103
status: verified
depends_on: [E6-T12g2]
estimate: S
risk: high
capstone: false
---

## Boundary

Map only measured required depth/stencil formats with exact guest packed-bit
upload/readback conversion and explicit resource/surface/sampling roles. Core
WebGL2 DEPTH_COMPONENT32F is not Z32_UNORM; format17 remains rejected until an
independently faithful mapping exists. Use real GPU observations rather than
CPU mirrors. Additional draw-state execution belongs to E6-T12h.
The real unmodified gears candidate selects format16 Z16_UNORM; include its
exact16-bit normalized depth behavior. The verified G1 inventory is authoritative.

## Deterministic acceptance

`make verify-E6-T12g3` proves each admitted required depth role in actual
WebGL2 with independent packed-bit, depth-sample/attachment/occlusion and
readback oracles, boundary encodings and odd strides. Record exact GL format/
type/conversions, bounded storage and zero errors. Require forbidden Z32_UNORM
failure, semantic source-fault sensitivity, retained color/resource checks and
final pristine clone. Name any required unsupported format that gates workloads.

## Adversarial verification

Attack stencil/depth bit order, unused-byte handling, endpoint and adjacent
depths, non-faithful float reinterpretation, incompatible surface/view roles,
async readback lifetime and budget accounting. Sabotage packed-bit conversion
and require the independent GPU oracle to fail.

## Verification log

### 2026-10-04 — worker — execution boundary

The user's graphics-offload continuation selects this next eligible graphics
dependency after verified G2 head `9d93635d7aee08adb3cb1b17516cb4e5da87c9b0`.
G1 requires only format16 Z16_UNORM, bind1, target2/flags0 for depth:
original es2gears resource35@4425, surface handle4 at event5115/byte5568.
Kmscube has no client depth format. Admit this measured depth-surface/storage
role only; guest depth sampler views and raster/depth draw-state execution
remain separate boundaries. Format17 Z32_UNORM and unrequired stencil/float
depth formats remain explicit failures.

Use native DEPTH_COMPONENT16 and owned explicit little-endian16-bit upload.
WebGL2/GLES3 readPixels does not expose depth components, so inverse readback
needs an actual GPU sampling/packing pass into a temporary normalized color
image. Charge region-sized conversion texture, readback/PBO bytes and CPU
scratch before GL allocation; preserve all old color/buffer accounting and
global limits. Never use a CPU depth mirror or a persistent full-resource
shadow. Prove all65536 uploaded encodings and independent sampling/attachment/
occlusion, odd rows, roles, retained generations, sync/async release/quota paths
and byte-order fault sensitivity before the final pristine clone and fresh critic.
Production negotiation remains disabled; the isolated local hardware proof
is the browser boundary, with no new production demo import or MIPS claim.

### 2026-10-04 — worker — implemented, awaiting fresh critic

Frozen runtime/harness head `61db520384877672b63a23cd0539946c55297431`,
against verified G2 base `9d93635d7aee08adb3cb1b17516cb4e5da87c9b0`.
Commands: `VIRGL_DEPTH_EVIDENCE_DIR=target/evidence/virgl-depth-formats-worker-final
make verify-E6-T12g3`; `python3 tools/virgl-command/depth-cold.py --output
target/evidence/virgl-depth-formats-worker-cold`; and `node
target/evidence/virgl-depth-formats-worker-final/supplement/driver.mjs`.
The selected high-risk gate covers this isolated JS storage/state boundary:
syntax/format checks, pinned unchanged WASM translator build, affected native
and real hardware decoder/resource/state/draw/async/color checks, scheduled
PBO reads, exact-source fault sensitivity and final pristine clone. Rust/ISA,
full guest execution and production browser imports are unchanged.

Source-hashed recording seal: `evidence/virgl-depth-formats/worker/manifest.json`,
`records.json`, and `recording.tar.gz` (60 members; archive SHA256
`dbf7a0fbd12cc4e3711e4fc4745738d9cd3ac2ae4d9d60974f19077e148996eb`).
Hot receipt SHA256 `d4159a43b3104a2d3d927161992b9bc21061e70150ea5b80dd170052fe6d005e`;
pristine clone report `ff57d7016c4d027108303bff9bdded0563fa6307a25d3f99848c1f16514d63d7`;
cold receipt `0b8b1ee981ff669120cb9e8bb54c780ca09fa762ffb9086be21aff8b5f023ba9`.
Both exact-head checkouts have identical source/input bindings; clone status
is empty before/after with inherited build/Node/Python/Rust configuration
scrubbed. Supplement report SHA256
`15c231e08da010c8e19e95f7dca19034dbcad35c4f22cd34ffccb6c4e38b364f`.
Its recorded source/driver and hardware capture exercise the changed gather
failure rollback and the unchanged RGBA ordered scanout fallback. The worker
V8 sweep records145/145 added runtime lines hit across the sealed recordings;
this is a coverage claim for the critic to interrogate, not a verifier verdict.

The recordings demonstrate4,808 identical Node/browser metadata/role/layout
assertions,1,386 hardware assertions and55 supplemental assertions, on
Chrome154.0.8037.93 / ANGLE Metal Apple M4 Max without software fallback or
console/page/request errors. The unchanged original gears resource35@4425
and SURFACE at5115/byte5568 use actual16-bit depth and no stencil. Every UN16
encoding is independently sampled into RGBA32F: largest absolute error
`2.9801867640344426e-08`, with exact little-endian sync/async inverse bytes.
Literal endpoints/adjacent depths pass physical LESS occlusion at12 probes.
Owned split odd rows, offset3x3 reads, untouched neighbors/padding, staging
copy, ID reuse16/67/233, content/lease/backing revocation and pending disposal
pass. Full3x2 read charges GPU60/CPU65/scratch24; partial3x3 charges122/93/36;
one-byte-short cases reject before conversion/PBO allocation. Eighteen native
precision/allocation/compile/link/uniform/FBO/PBO/fence failures roll back
and release tracked names. Reversing upload byte order fails the independent
GPU sample at encoding1: expected `1/65535`, observed `0.003906309604644775`.

No measured depth requirement is missing from this storage boundary. Format17
Z32_UNORM, unmeasured stencil/float formats and all unproved depth sampling
roles still reject. Native depth attachment/occlusion is an independent oracle;
guest depth framebuffer/clear/DSA execution remains E6-T12h. No original CPU
depth upload exists in the selected capture, so upload/read variants are
explicitly synthetic. Production offload negotiation remains disabled; no
full gears offload, deployed capability or300-MIPS claim is made.

### 2026-10-04 — fresh verifier — VERDICT: verified

VERDICT: verified

Reviewed the entire task and frozen diff before the raw recordings, then saved
falsifiable predictions before observations in
`target/evidence/virgl-depth-formats-verifier/predictions.md`. Reviewed runtime/
harness head `61db520384877672b63a23cd0539946c55297431` against verified G2
`9d93635d7aee08adb3cb1b17516cb4e5da87c9b0`. No refutation or proof gap survived.

- **P0 — HELD.** Independently authenticated all60 archive members, the record
  index,97 frozen source/input bindings, generated WASM/module bytes, served
  runtime/counters/screenshots, and the supplemental driver. Archive digest is
  `dbf7a0fbd12cc4e3711e4fc4745738d9cd3ac2ae4d9d60974f19077e148996eb`.
  `authentication.json` SHA256
  `ec87ad8d0cb54413deffe6151749be68122a4655eca9c3d89ac6dd88b5bdf3b0`.
- **P1/P2 — HELD.** Independently decoded original event4425 and SURFACE4 at
  event5115/byte5568: words `[0x50801,4,35,16,0,0]`, packet SHA256
  `83fc0708e2dc18ff1443902b2e0b5b77cdd3c104308de094bf293556604533dd`,
  event trace SHA256 `6c20fda867fea51b85a13dd7d4a4025f56fbf92bccbbc6a11b16db101a2244ea`.
  Authenticated `hot/hardware/report.json` (SHA256
  `e1298d07aeca5150b06acf63a28a5c6c4b9ebd66e8e0dbe2aa62534226fb35f9`)
  `/browserResult/result/encodings` observes all65536 normalized GPU samples,
  max error `2.9801867640344426e-08`. `/literal/attachment` observes actual
  depth16/stencil0 and12 endpoint/adjacent LESS probes. Forbidden Z32/depth
  views remain closed at `/native/assertions/4804` and4806. Independent
  incompatible color/depth aliases preserve state and leases.
- **P3/P4/P5/P6 — HELD.** Same authenticated hardware report: assertions93/100
  prove literal little-endian bytes and odd padding;234/241 prove offset3x3
  words and untouched guards;397/431/465 prove old-format PBO after reuse as
  16/67/233;494/521/549 prove contents/lease/backing rejection. `/literal/pending`,
  `/partial` and `/budgets` prove exact charges,6 pressure and18 host-fault
  rollback/recovery cases, with zero GL/browser errors and tracked-name leaks.
  The authenticated supplement proves gather failure rollback at assertion10
  and inherited RGBA scanout at41, without replacing the runtime.
- **P8 — HELD.** Independent V8 smallest-enclosing-range audit classifies every
  added runtime line:131 executed,14 comment/delimiter waivers,0 missing.
  Every changed executable token has a positive non-mutant counter. In
  particular resources.mjs:350 gather rollback hits supplemental counter
  range `[21843,21912)` count1. `coverage.json` SHA256
  `e922defc00a3d0dbc64e85f4dde47c37c1740c3445931bc81cc1a0f931c6f3f5`.
- **P9 — HELD.** Independent source-only upload endian fault fails actual
  normalized GPU sample n=1: expected `1/65535`, observed
  `0.003906309604644775`. Independent shader `float(d>>8)`→`float(d>>7)`
  fault passes upload/sampling, then fails raw GPU RGBA pixels before CPU
  compaction: UN16 word255 has high byte1 rather than0. Original runtime
  SHA256 `d733b6782c58e908a4c1e18a408cf22dbdc0d328231172aab8892ab450313666`;
  endian mutant `12db5a1c3f3e21613113dee6376e65730d5f900644f826fb3ce4943f19d2ba91`;
  packing mutant `1d3db224026295b0a3f214bd8433df50efdfff5ed9ad57ddf6e5e19b62ff360c`.
  `independent-byte-order/report.json` SHA256
  `d5380af786b1e6095339fafc85ebd15dc14e4c968fd7ececb921da9d4ff76825`,
  `/result/error/observation` index15; packing report SHA256
  `46022c8b4ca095b0b9e305530b422b4bdb31951c5832198198d131e3992d0297`,
  observation index19. Both have separately bound source/counters/screenshots.
- **P10 — HELD.** Independent bounded novel attack passed654 assertions on
  hardware Chrome154/ANGLE Metal Apple M4 Max, with seeds439041101,
  1356976835 and1995449448 and varied2..5 withheld real-fence schedules.
  Concurrent7x5/9x3/partial PBOs charge GPU692/CPU458/scratch284 exactly;
  a fourth read rejects before native allocation. Partial writes/scatter preserve
  neighbors/guards, depth PBO survives RGBA ID reuse, cancellation releases
  names, and GPU-only native depth clear11326 is observed by sampling and
  sync/PBO inverse with zero CPU depth uploads. `independent-clean/report.json`
  SHA256 `b98667d68bb21ab1c8ced51ac2948de9b904f02bd6b909cd1e390db6af6682ff`;
  assertions142/333/521 and628/634, `/result/details` for schedules/calls.
- **P7 — HELD, carried forward.** G1 lineage and G2's unchanged boundaries
  retain their verdicts. All6 affected regression recordings pass. Final
  pristine clone report/receipt SHA256
  `ff57d7016c4d027108303bff9bdded0563fa6307a25d3f99848c1f16514d63d7` /
  `0b8b1ee981ff669120cb9e8bb54c780ca09fa762ffb9086be21aff8b5f023ba9`
  authenticate exact source head, scrubbed configuration and empty status
  before/after. No portability finding warrants repeating that proof.

Detailed predictions, points/digests and coverage classifications are in
`target/evidence/virgl-depth-formats-verifier/prediction-results.json` (SHA256
`03123fdc96159e4457a930ef685c4b465205faa641ef6eaca4b9562226e724d5`) and
`verdict.md` (SHA256 `f1ba110e205d9918f9199fab4d942cb2e5d839d9103e801b167020bc2c64cff7`).
Commands: `python3 target/evidence/virgl-depth-formats-verifier/authenticate.py`;
`node target/evidence/virgl-depth-formats-verifier/coverage.mjs`;
`node target/evidence/virgl-depth-formats-verifier/driver.mjs`. All verifier
outputs reside in that directory. Browser contexts/server closed in finally.

SUITE: promote the new committed `depth-formats.mjs` deterministic metadata/
GPU/ownership checks through `make verify-E6-T12g3`; preserve independently
recorded seeds/drivers/faults as the verifier replay artifact. No runtime edits.
The original selected metadata/SURFACE is required and exercised; other depth
uploads/oracles remain synthetic. Guest depth framebuffer/clear/DSA is H,
depth sampler views G4. Format17/stencil/float remain rejected. Production
negotiation remains disabled; no full guest offload or throughput claim.
