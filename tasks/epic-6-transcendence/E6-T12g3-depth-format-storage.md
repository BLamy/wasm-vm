---
id: E6-T12g3
epic: 6
title: Prove required packed depth formats and explicit unsupported depth rejection
priority: 525.0270103
status: in-progress
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
