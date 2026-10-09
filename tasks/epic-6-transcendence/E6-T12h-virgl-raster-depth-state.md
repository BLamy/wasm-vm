---
id: E6-T12h
epic: 6
title: Execute required VirGL raster depth and vertex state without coordinate drift
priority: 525.02702
status: in-progress
depends_on: [E6-T12g6]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement the additional captured kmscube/es2gears draw-state requirements over
the eight-object engine: scissor, depth/stencil behavior, supported culling and
winding, vertex formats/layouts and constant-buffer bindings. Keep unsupported
instancing/primitive/point/line variants explicit rather than silently ignoring
their fields. Preserve GL clip space, framebuffer Y origin, front-face winding
and pixel centers; WebGL2 already uses GL clip depth, so do not import the
obsolete WebGPU [-1,1]-to-[0,1] remap. Document shader-key dependencies.

## Deterministic acceptance

`make verify-E6-T12h` executes independently checked recorded state/draw cases
and literal occlusion/scissor/winding tests. Draw fullscreen triangles at
z=0.999 and z=-0.999 against a mid-depth occluder and require correct pixels.
Exercise required vertex/constant layouts, actual shader reflection and state
restoration across A/B/A contexts; retain tiny-scene and format regressions.
Record all admitted state fields, browser/GPU identity and zero GL errors.
Run affected high-risk gates and a final pristine-clone proof.

## Adversarial verification

Toggle depth, blend, scissor and orientation between adjacent draws; poison
host state and reuse handles across contexts. Attack fetch alignment/stride,
missing attributes, incompatible target state and shader-key mismatches.
Sabotage depth direction or winding and require failure. Additional independent
feature families discovered during workload bring-up need separate S tasks.

## Verification log

### 2026-10-09 — worker — activation

Continue the production graphics dependency chain explicitly requested by the
user. E6-T12g6 is independently verified at `10adfaaf3badf5f70ad9375f4e0bff6a615418f6`.
This high-risk boundary adds actual required draw/state behavior to the isolated
renderer; it does not yet advertise guest acceleration or claim live FPS/MIPS.
Original client packets require triangle strips, RGB32F fetches, negative-Y
viewports, lower-left winding and Z16 depth attachments. Active stencil,
instancing, points/lines and other unsupported fields remain explicit errors.
