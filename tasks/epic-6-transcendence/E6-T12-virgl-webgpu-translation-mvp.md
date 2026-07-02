---
id: E6-T12
epic: 6
title: virgl-to-WebGPU translation MVP — TGSI to WGSL, es2gears and kmscube render
priority: 612
status: pending
depends_on: [E6-T11]
estimate: L
capstone: false
---

## Goal
A `WebGpuRenderer` implementing the E6-T10 MVP command subset — state objects, shaders,
draws, clears, transfers — with a TGSI→WGSL shader translator and a Gallium-state→
GPURenderPipeline cache, sufficient to render kmscube and es2gears correctly at
interactive frame rates inside the guest desktop.

## Context
The MVP subset (from the E6-T10 captures) is roughly: CREATE_OBJECT for shader/
vertex_elements/blend/DSA/rasterizer/sampler_state/sampler_view/surface; SET_ commands
for framebuffer state, viewport, scissor, vertex/index/constant buffers, sampler views;
CLEAR; DRAW_VBO; RESOURCE_INLINE_WRITE; plus the transfer paths from E6-T11. Shaders
arrive as TGSI text — parse to a small IR, emit WGSL (consider targeting naga IR to
reuse its WGSL backend and validation). Coordinate-system traps: GL clip-space z in
[-1,1] vs WebGPU [0,1] (bake the remap into the vertex shader epilogue), framebuffer
Y-flip, front-face winding under flip, pixel-center offsets for point/line rasterization.
Gallium's state-object model maps well to WebGPU pipelines but pipeline creation is
expensive: key a pipeline cache on the bound state-vector hash (shaders, vertex layout,
blend/DSA/rasterizer, target formats) and pre-warm async where possible. Bind group
convention: group 0 = constbuf UBOs, group 1 = samplers+views (document it; the
translator and any future venus work must agree).

## Deliverables
- `renderer/webgpu/`: state tracking, pipeline cache, buffer/texture upload paths
  (TRANSFER_TO_HOST_3D → queue.writeTexture/writeBuffer with stride repacking),
  readback (FROM_HOST_3D via mapAsync staging, integrated with fence completion).
- `tgsi/`: parser + WGSL emitter covering VS/FS, ALU ops, texturing (2D/cube), control
  flow (IF/LOOP), with golden-file tests for every shader in the E6-T10 captures.
- Scanout integration: rendered surfaces composite into the Epic 5 canvas path
  (SET_SCANOUT with a 3D resource) without an extra copy where the platform allows.
- Frame-capture debug tool: dump decoded commands + WGSL + bind state for frame N.

## Acceptance criteria
- [ ] kmscube renders the spinning cube correctly for 60+ seconds at ≥30 FPS at 800x600
      (screenshot sequence committed; SSIM ≥ 0.95 vs llvmpipe reference frames).
- [ ] es2gears in the guest desktop renders correctly at ≥30 FPS and reports its own FPS
      counter output in the terminal.
- [ ] `glReadPixels` path works: a guest test app draws a gradient, reads it back, and
      asserts pixel values — exercising FROM_HOST_3D end-to-end.
- [ ] Every captured-corpus shader translates: TGSI→WGSL golden tests pass and naga
      validation reports zero errors on all emitted WGSL.
- [ ] Pipeline cache hit rate > 95% after frame 10 of kmscube (counter in debug UI).

## Adversarial verification
Render-diff adversarially: run kmscube, es2gears, and *one workload the implementer did
not list* (e.g. glmark2-es2 `build` scene) against llvmpipe references; SSIM < 0.95 or
any geometry inversion (Y-flip/winding bugs show as inside-out models) refutes. Attack
the coordinate remap: a guest test drawing a full-screen triangle with z=0.999 and
z=-0.999 against a mid-depth occluder exposes clip-space errors as wrong occlusion.
Attack the pipeline cache: render a scene that toggles blend state per draw 10^4 times —
a cache-key collision shows as state bleeding between draws; memory growth without bound
refutes (cache must have an eviction story). Kill the WebGPU device (`device.destroy()`
via devtools / simulate `device.lost`) mid-frame: the machine must degrade (fall back to
2D scanout or surface an error) rather than wedge the ctrl queue — a permanently stuck
guest compositor refutes. Run 30 min of kmscube and chart JS heap + GPU memory; monotonic
growth refutes.

## Verification log
(empty)
