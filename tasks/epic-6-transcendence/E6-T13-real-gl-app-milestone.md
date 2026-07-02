---
id: E6-T13
epic: 6
title: Real GL application milestone — glmark2-es2 plus one interactive app
priority: 613
status: pending
depends_on: [E6-T12]
estimate: L
capstone: false
---

## Goal
The 3D stack graduates from gears to reality: a full glmark2-es2 run completes with
correct rendering, and one real interactive GL application (Neverball or ioquake3 —
whichever the E6-T10 decision and riscv64 packaging make achievable) is playable in the
guest desktop with keyboard/mouse input at usable frame rates.

## Context
glmark2-es2 exercises what gears doesn't: mipmapped and cubemap textures, multiple
vertex formats, FBO render-to-texture (`effect2d`, `desktop` scenes), alpha blending,
larger shaders with loops and conditionals. A real app adds sustained load, texture
streaming, and input-latency sensitivity. Fixed-function GL1.x apps (Neverball) work
because Mesa lowers fixed function to TGSI shaders before virgl ever sees them — the
command stream stays within our subset, but expect new opcodes (stencil state, more
formats: S8/D24S8, RGB565, compressed formats must be *rejected in the capset* so Mesa
falls back to uncompressed uploads). This task is deliberately gap-driven: run, hit a
missing feature, capture, implement, repeat — each gap lands as a commit referencing the
failing scene. Package reality check: confirm glmark2/neverball/ioquake3 availability in
Alpine riscv64 repos (community/testing) or build them in-guest (E6-T22's toolchain is
not yet available; apk or prebuilt only).

## Deliverables
- Gap-fix commits extending the E6-T12 renderer/translator (expected: stencil, FBO
  surfaces beyond scanout, additional texture formats, mipmap generation via chained
  blit pipeline, element-index formats, larger UBO layouts).
- Capset tuning so unsupported formats/features are honestly absent (Mesa must choose
  working fallbacks rather than crash — verify ETC2/S3TC are not advertised).
- Performance instrumentation: per-frame draw count, submit bytes, pipeline switches,
  translation-cache stats, frame time percentiles exported to the debug UI.
- `bench/gpu/` results file: glmark2-es2 score and per-scene FPS at 800x600, host specs.
- A 60-second recorded demo (script + capture instructions) of the interactive app.

## Acceptance criteria
- [ ] `glmark2-es2 --fullscreen` (or -drm flavor under KMS) completes every scene it
      starts without hang or crash; ≥ 12 of its scenes render (SSIM ≥ 0.93 vs llvmpipe
      reference captures for 5 spot-checked scenes); final score recorded.
- [ ] The chosen interactive app reaches its main menu and in-game state, renders
      correctly (no inside-out geometry, no missing textures), and sustains ≥ 20 FPS
      at 800x600 with JIT + smp=2.
- [ ] 20 minutes of continuous app runtime: zero ctrl-queue stalls, zero WebGPU
      validation errors in the browser console, JS/GPU memory stable within 10%.
- [ ] Input works in-app: rebindable keys and mouse look/aim function through the Epic 5
      virtio-input path with no stuck-key artifacts.
- [ ] All E6-T12 milestones still pass (kmscube/es2gears regression gate).

## Adversarial verification
Play adversarially: alt-tab the guest app repeatedly, resize the desktop mid-game, and
switch VTs if the desktop supports it — surface/FBO lifetime bugs show as black screens
or validation-error storms; any wedge refutes. Run a scene the implementer did not
spot-check and SSIM-compare it. Attack formats: force-enable a texture-compression probe
app (`es2_info` extension list must not advertise ETC2/S3TC; if it does and uploads
garble, the capset lie refutes). Attack sustained load: loop glmark2-es2 five times
back-to-back; score variance > 15% between run 1 and run 5 indicates a leak or cache
collapse and refutes the stability claim. Verify the FPS claims with the browser's own
frame profiler, not the app's counter (a translator that drops frames silently can fake
app-side FPS). Finally run the whole thing on a second GPU vendor (e.g. Apple vs NVIDIA
adapter) — vendor-specific WGSL misbehavior that breaks rendering refutes portability.

## Verification log
(empty)
