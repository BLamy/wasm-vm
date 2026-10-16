---
id: E6-T12g
epic: 6
title: Map required VirGL resource formats and texture views to WebGL2
priority: 525.02701
status: cancelled
depends_on: [E6-T12f6]
estimate: M
risk: high
capstone: false
---

## Boundary

Extend the resource/view executor for the pinned kmscube and es2gears workload
requirements: measured color/depth formats, channel order and forced alpha,
sampler-view swizzles, mip/layer/cube addressing and filtering. Inventory and
capture any new es2gears inputs first. Distinguish resource, surface, sampling
and vertex-format roles; a GL allocation probe alone does not prove all roles.
Honor the contract's explicit rejections, including Z32_UNORM, until a faithful
mapping has independent evidence. Unsupported formats stay absent from caps.
Complete required RESOURCE_INLINE_WRITE and stride-repacked texture uploads.

## Deterministic acceptance

`make verify-E6-T12g` executes original required upload/view packets and literal
independent color/alpha/depth/mip/cube-face oracles in WebGL2. Test every admitted
format in each advertised role, including upload, sample, attachment and readback.
Record exact GL formats/types, swizzle lowering, original payload provenance,
bounded allocation and zero errors. Preserve tiny-scene replay, run affected
high-risk resource/shader gates and final clean clone. Required unsupported
formats block later workloads rather than being silently converted incorrectly.

## Adversarial verification

Attack incompatible surface/view reinterpretation, nonidentity swizzles,
zero/one alpha, odd row strides, mip/layer bounds and cube-face orientation.
Force forbidden format requests and require explicit failure. Sabotage channel
ordering or one cube face and require the independent oracle to fail. This
does not grant every format found in the wider desktop corpus support.

## Verification log

### 2026-10-04 — decomposition before execution

Inspection identified separate capture/provenance, color storage, packed depth,
view specialization/addressing and inline-write boundaries. This was an M-sized
planning container despite its old S label. Replace it with ordered S slices
E6-T12g1 through E6-T12g6; no acceptance requirement is removed. The original
combined acceptance remains `make verify-E6-T12g`, owned by E6-T12g6. Raster/depth
state task E6-T12h depends on that verified closure, not this cancelled parent.
Each slice retains unsupported requests explicitly; resource allocation alone
never grants sampling, attachment, readback or guest caps. Pinned workload
requirements come from the actual old kmscube and new es2gears captures.
