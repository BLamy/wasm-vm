---
id: E6-T11c
epic: 6
title: Present retained 3D resources through the existing virtio scanout path
priority: 525.02698
status: pending
depends_on: [E6-T11b2]
estimate: S
risk: high
capstone: false
---

## Boundary

Support SET_SCANOUT and flush/presentation for renderer-backed resources through
the existing Epic5 canvas path. Preserve ownership across resize, rebinding,
public unref and asynchronous presentation; define orientation and scanout
format conversion. Avoid an extra copy where the measured WebGL2/browser path
allows it, and document necessary copies honestly. Preserve ordinary 2D scanout
and explicit failure behavior; production negotiation is still disabled.

## Deterministic acceptance

`make verify-E6-T11c` records a test-negotiated guest 3D resource reaching the
actual built browser canvas with independent corner/alpha/orientation pixels,
then switches between 3D and ordinary 2D scanout. Exercise resize/rebind/unref
and prove retained frames survive until their presentation completes. Boot the
Epic5 desktop and record unchanged two-dimensional behavior, zero console errors,
screenshots and resource-lifetime counters. Run affected native/wasm/browser
gates and the high-risk final pristine-clone proof.

## Adversarial verification

Alternate scanouts and dimensions while submissions are pending; delete public
handles before display and reuse their IDs. Reject unsupported formats/regions
without stale-frame or cross-context exposure. Sabotage Y orientation and require
the corner oracle to fail. A fixture presentation is not live Mesa bring-up.

## Verification log

(empty)
