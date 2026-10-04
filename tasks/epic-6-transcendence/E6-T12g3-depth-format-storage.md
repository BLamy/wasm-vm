---
id: E6-T12g3
epic: 6
title: Prove required packed depth formats and explicit unsupported depth rejection
priority: 525.0270103
status: pending
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

(empty)
