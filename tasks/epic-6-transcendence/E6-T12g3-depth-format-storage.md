---
id: E6-T12g3
epic: 6
title: Prove required packed depth formats and explicit unsupported depth rejection
priority: 525.0270103
status: implemented
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
