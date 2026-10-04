---
id: E6-T12g1
epic: 6
title: Capture unmodified guest es2gears and inventory required resource/view packets
priority: 525.0270101
status: in-progress
depends_on: [E6-T12f6]
estimate: S
risk: high
capstone: false
---

## Boundary

Pin the official Mesa demos source archive, cross-build its unmodified
es2gears Wayland client against the immutable guest sysroot, and capture it
through the existing real RISC-V/Mesa/VirGL reference pipeline. Close the actual
client window through compositor IPC and require its real zero exit; a watchdog
kill cannot count as completion. Preserve source/build/library/binary/recorder
and guest BEGIN/END provenance, every submission and backing snapshot. Keep the
four old captures and nineteen-hash shader claim immutable.

Derive the kmscube and es2gears client requirements directly from authenticated
resource creates and original surface/view/sampler/transfer/draw packets, with
context/event/byte/digest citations. Separate supporting-compositor traffic from
the gears client. Record formats by role, flags/origin, channel order, swizzle,
levels/layers/targets/filtering, inline-write use and any new unchanged shader
bodies. This slice adds no renderer mapping, caps or performance claim.

## Deterministic acceptance

`make verify-E6-T12g1` validates the complete committed real capture, pinned
unmodified workload inputs/build and client draw/exit provenance; reconstructs
its required-format/view inventory; rejects provenance/packet/output mutations;
retains the four old captures and affected recorder/framing regressions. Record
the actual guest run at frozen source and a final pristine-clone acceptance.
Report new shader admission or format gaps as requirements for later slices,
never as inferred browser support.

## Adversarial verification

Attack fake renderer/exit/FPS markers, early closure or timeout counted as
success, wrong workload binary/source pins, source-version substitution,
missing client draws, omitted snapshots, forged resource roles and damaged
packet blobs. Hold client-only inventory against literal protocol words and
ensure supporting compositor formats are not mislabeled client requirements.
The actual executed recorder remains unchanged unless separately scoped proof
is added. No rendered-pixel or browser-FPS claim is made by this capture.

## Verification log

### 2026-10-04 — worker — execution boundary

Verified shader parent is `3381977b27842437e6a675809374642059987854`.
This high-risk S slice captures and inventories one original workload. It adds
no format/shader/device implementation. Source/binary identity, real guest
completion and exact packet provenance are the acceptance boundary. Original
Mesa demos9.0.0 archive candidates are checked against the official SHA-256
before building; the rootfs/kernel and existing recorder stay immutable.
No mapping slice starts before this inventory is independently verified.
