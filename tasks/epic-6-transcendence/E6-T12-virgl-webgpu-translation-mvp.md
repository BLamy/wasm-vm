---
id: E6-T12
epic: 6
title: VirGL-to-WebGL2 rendering MVP — decomposed into ordered S tasks
priority: 612
status: cancelled
depends_on: [E6-T10d]
estimate: L
capstone: false
---

## Replacement plan

This L planning container is cancelled, not verified. E6-T10c selected WebGL2 /
ESSL300 and E6-T10d proved the original textured shader pair; seven of nineteen
captured bodies translate, with execution proven only for the stated tests.
The obsolete TGSI-to-WGSL/naga/WebGPU pipeline design is replaced by the pinned
TGSI-to-ESSL300 bridge and a bounded WebGL2 state/program executor. No existing
verified evidence is rewritten and no future capability is advertised here.

1. [E6-T12a — strict command decoder](E6-T12a-virgl-command-decoder.md): portable
   byte parsing, typed/profile validation and exact provenance for all eight
   tiny-scene submissions, with opaque END_TRANSFERS padding and no execution.
2. [E6-T12b — resources and transfers](E6-T12b-virgl-resources-transfers.md):
   attached backing, bounded storage, both copy directions and original input
   bytes; output snapshots are never used to seed replay.
3. [E6-T12c — eight-object state](E6-T12c-virgl-object-state.md): object/binding
   identity, original shaders, framebuffer/constants/layouts, inactive resets
   and retained references across contexts and public unref.
4. [E6-T12d — complete tiny-scene replay](E6-T12d-captured-command-pixel-replay.md):
   all 210 original commands, three GPU draws/readbacks, 768 independent exact
   interior pixels and original cleanup. Then E6-T11a–c connects the transport,
   asynchronous fences and 3D scanout while production capabilities stay off.
5. [E6-T12e — shader control flow](E6-T12e-captured-shader-control-flow.md):
   bounded captured integer/comparison/IF/LOOP semantics and independent pixels.
6. [E6-T12f6 — full-corpus shader closure](E6-T12f6-original-shader-closure.md):
   resolve strict PRECISE faithfully and require all nineteen original bodies,
   unchanged, to translate and compile/link in WebGL2 with semantic oracles.
   Dropping qualifiers, substituting recaptures or testing only already-supported
   hashes does not preserve the original full-corpus milestone. If faithful
   implementation is blocked, dependent work remains gated with exact evidence.
7. [E6-T12g — formats and texture views](E6-T12g-virgl-format-view-mapping.md):
   required upload/inline-write, color/depth roles, swizzles, mip/layer/cube
   mappings and filtering; unsupported formats remain explicit rejections.
8. [E6-T12h — raster/depth/vertex state](E6-T12h-virgl-raster-depth-state.md):
   required state, scissor, constant/vertex bindings and independent Y/winding/
   pixel-center/depth tests, including z=+/-0.999 with a mid-depth occluder.
9. [E6-T12i — bounded cache](E6-T12i-bounded-render-cache.md): complete program/
   state keys, 10^4 blend toggles, collision resistance, eviction and residency,
   plus frame-N command/GLSL/binding dumps. Then E6-T11d–e proves real Mesa,
   truthful positive capsets, hostile-input survival and WebGL context loss.
10. [E6-T12j — real guest gradient readback](E6-T12j-live-gradient-readback.md):
    guest-side independent pixel assertions through actual reverse transfers,
    backing writes and fence completion.
11. [E6-T12k — kmscube](E6-T12k-live-kmscube-milestone.md): at least 60 seconds,
    at least 30 actually presented FPS at 800x600, committed screenshots with
    SSIM >=0.95 versus matched llvmpipe references, and cache hit rate >95%
    after frame10 with real counters in the debug UI.
12. [E6-T12l — es2gears and independent differential](E6-T12l-live-gears-render-differential.md):
    real desktop gears at >=30 FPS with guest FPS output and browser timing;
    kmscube/gears plus a verifier-selected unlisted workload meet SSIM >=0.95
    against llvmpipe and have no inverted geometry or missing textures.
13. [E6-T12m — lifetime soak](E6-T12m-renderer-lifetime-soak.md): the original
    30-minute kmscube JS/GPU-memory chart and bounded-resource/lifetime proof,
    retaining every previously verified milestone and gating E6-T13.

## Preserved acceptance and policy

The original acceptance thresholds and adversarial obligations survive:
complete captured shaders, live gradient glReadPixels, both 30FPS demos,
reference image comparisons including an unlisted workload, coordinate/depth
attacks, >95% cache hits after frame10, 10^4 state changes without key collisions,
eviction, actual mid-frame graphics context loss without control-queue wedge,
and a measured 30-minute memory soak. ESSL300 compilation/linking replaces
WGSL/naga validation; WEBGL_lose_context replaces device.destroy/device.lost.
These are backend adaptations, not removal of the corresponding semantics.

The original state/transfer/scanout/debug deliverables are assigned explicitly
above. Bindings and shader keys must agree with measured reflection and the
verified contract; WebGL2 does not need the former WebGPU clip-depth remap.
Missing independent features discovered by the pinned workloads require their
own ordered S tasks, rather than expanding an active S into a broad renderer
rewrite or weakening an oracle. Production-facing slices must follow AGENTS.md
built-page, live-demo and deployment evidence requirements.

## Verification log

Planning-only decomposition; no implementation or verification claim.
