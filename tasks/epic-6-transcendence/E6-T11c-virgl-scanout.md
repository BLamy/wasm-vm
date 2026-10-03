---
id: E6-T11c
epic: 6
title: Present retained 3D resources through the existing virtio scanout path
priority: 525.02698
status: in-progress
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

## Presentation completion and bounded profile

The initial compatible path uses scanout 0 and existing single-level RGBA8 2D
renderer textures. SET_SCANOUT accepts a whole-resource rectangle; unsupported
formats, cropped bindings and invalid dimensions fail before changing the
previous binding. Ordinary 2D scanout keeps its existing contract.

A guest FLUSH completes after its retained GPU snapshot is ready and its owned
pixels have been accepted by the bounded presenter. A separate frame ticket
remains until actual canvas draw, explicit supersession, cancellation or failure.
The device response does not claim physical presentation. Acceptance separately
requires a frame-correlated canvas draw, including guest unref/rebind before rAF.
A successful enqueue alone is not evidence that pixels reached the canvas.

The scanout binding retains the accepted resource generation independently of its
public ID and context membership. Rendering membership checks stay unchanged.
The presenter keeps at most one pending frame, routes 2D and 3D through the same
display owner, and rejects stale generations after rebinding or reset. Captures
use bounded PBO/fence staging; already issued snapshots have explicit lifetime
semantics independent of later content revisions. Canonical top-down BGRA words
feed the existing built presentation controller, with channel and Y conversion
performed exactly once before that contract. The evidence reports readback,
conversion, ownership copies and presentation upload bytes; no zero-copy claim.

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
