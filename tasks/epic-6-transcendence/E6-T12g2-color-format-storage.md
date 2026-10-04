---
id: E6-T12g2
epic: 6
title: Map required color formats and forced alpha with role-safe storage
priority: 525.0270102
status: in-progress
depends_on: [E6-T12g1]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement the measured required normalized color formats, channel order,
X-format forced alpha, resource binding roles and framebuffer origin over the
bounded resource store. Preserve backing/storage/generation/scratch budgets and
owned sync/async upload/readback. Unsupported formats/roles remain rejected.
Sampling, render destination alpha and inverse guest readback must each be
faithful; allocation probes or an upload-only swizzle cannot prove all roles.
The real unmodified gears candidate selects format233 B10G10R10X2_UNORM;
include its packed10-bit channels and forced alpha rather than changing the
workload to request RGBA8. The verified G1 inventory is authoritative.

## Deterministic acceptance

`make verify-E6-T12g2` executes original required color resource/transfer
packets and independent actual WebGL2 upload/sample/attachment/readback cases
for each admitted format/role. Check BGR/RGB order, arbitrary X bytes versus
forced alpha one, odd padded rows, orientation, sync/async ownership and budgets.
Record GL formats/types and zero errors; retain RGBA8/tiny-scene/resource guards,
require a channel/alpha source fault to fail, and run final clean-clone proof.

## Adversarial verification

Attack reinterpretation, forbidden bind roles/format requests, stale leases,
odd strides, untouched padding, alpha-dependent blending, orientation and byte
budget pressure. Sabotage channel ordering or forced destination alpha and
require independent physical pixels/readback to refute it.

## Verification log

### 2026-10-04 — worker — execution boundary

Verified G1 parent is `0550aa94b59364380e543b0c6de41697c5f18fb8`. Its authenticated client
inventory requires format2 B8G8R8X8_UNORM, format67 R8G8B8A8_UNORM and
format233 B10G10R10X2_UNORM. This high-risk S slice changes the bounded
resource/color-surface boundary only. Use native RGB8 for BGRX8 and native
RGB10_A2 for packed10 storage, preserving lower-left flag0 orientation,
four-byte guest strides and conservative storage/scratch/PBO charges. X alpha
must be one when sampled and as a rendering destination; source fragment alpha
still controls RGB blending. Packed transfer/readback must preserve all10 bits.

Admit explicit render/sampler roles plus the measured SCANOUT/SHARED metadata
hints, reject other roles/flags/aliases, and retain exact resource generations.
Sampler-view specialization, depth, vec3/raster/draw closure, scanout conversion
and live caps remain subsequent boundaries. The production demo does not import
these isolated renderer modules; the authoritative browser proof is the local
hardware-WebGL acceptance page, with original packet/backing citations. Record
affected decoder/resource/tiny-scene regressions, new physical sampling/render/
inverse-readback checks, source faults and final pristine-clone proof. A fresh
independent critic must verify the frozen evidence before the next slice.
