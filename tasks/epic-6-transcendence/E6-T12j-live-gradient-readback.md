---
id: E6-T12j
epic: 6
title: Prove guest gradient glReadPixels through actual asynchronous 3D readback
priority: 525.02706
status: pending
depends_on: [E6-T11e]
estimate: S
risk: high
capstone: false
---

## Boundary

Prove the complete live guest draw-to-readback path using a finite GLES gradient
application with an independent literal/computed pixel oracle. Guest Mesa must
submit its own original shaders, geometry, state and transfers through our
device/renderer. Do not use captured host outputs, a CPU-rendered substitute or
an application-side fake readback. Exercise FROM_HOST_3D or the actual negotiated
COPY_TRANSFER3D reverse path, including guest backing and fence completion.

## Deterministic acceptance

`make verify-E6-T12j` boots the pinned guest in the built browser, runs the finite
gradient workload, and requires guest-side exact assertions for independently
chosen representable pixel values, a clear success marker and zero unexpected
browser errors. Bind readback bytes, guest addresses, transfer packets, fence
response order, renderer identities and screenshot to recorded guest/browser
evidence. Preserve tiny-scene replay and no-fallback evidence. Run affected
high-risk gates and final pristine-clone acceptance; update and verify the demo
if the live capability surface changes.

## Adversarial verification

Alter one shader constant or transfer offset and require the guest's pixel test
to fail. Delay GPU completion to expose premature success, use nontrivial row
strides and partial boxes, and cross a backing-page boundary. Output must land
only in validated guest bytes before its completion is reported. Repeated
readbacks must not leak pending buffers or return stale prior-frame data.

## Verification log

(empty)
