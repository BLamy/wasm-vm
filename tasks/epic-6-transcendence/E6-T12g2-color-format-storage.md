---
id: E6-T12g2
epic: 6
title: Map required color formats and forced alpha with role-safe storage
priority: 525.0270102
status: pending
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

(empty)
