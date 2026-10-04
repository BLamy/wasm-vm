---
id: E6-T12g4
epic: 6
title: Execute required sampler-view swizzles addressing and filtering
priority: 525.0270104
status: in-progress
depends_on: [E6-T12g3]
estimate: S
risk: high
capstone: false
---

## Boundary

Implement immutable per-view sampling semantics for the measured required
formats: swizzles including zero/one, format/alpha/origin specialization, mip/
layer/cube addressing and filtering where required. Validate view/storage role
compatibility and include all shader-visible dependencies in the program key.
Never advertise unproven targets or level/layer/face semantics. Any requirement
outside the measured bounded shader/storage family gets its own S dependency.

## Deterministic acceptance

`make verify-E6-T12g4` runs original required surface/view/sampler packets
and independent WebGL2 swizzle/alpha/filter and each admitted mip/layer/cube-face
oracle. Test every advertised role, view aliasing and A/B/A restoration, with
bounded variant allocation and exact GL calls. Explicitly record unrequired
unsupported target/level families and reject their requests. Require a swizzle
or admitted cube-face source fault to fail, retained color/depth/tiny-scene
checks and final clean clone.

## Adversarial verification

Attack nonidentity swizzle, zero/one lanes, mip/layer/face bounds, cube
orientation, incompatible reinterpretation, filtering/LOD and poisoned host
state. Collide shader keys while changing view semantics and require distinct
correct physical results; unsupported requests cannot become no-ops.

## Verification log

### 2026-10-04 — worker — execution boundary

The user's graphics-offload continuation selects this next eligible dependency
at verified G3 `96d6b83fcde1765fc5e931a95808629f78d37b60`.
G1's unchanged client sampler requirement is kmscube format67/target2,
level/layer0, identity swizzle and clamp-edge linear non-mip filtering
(resource5@125; VIEW at176/byte4400; SAMPLER at176/byte4444). The original
gears client creates no sampler views. Preserve unsupported mip/layer/cube,
depth-view and vertex-texture families explicitly; do not invent captured
requirements or advertise those families.

Extend exact-matching existing color views2/67/233 with bounded immutable
selectors0–5, including ZERO/ONE, as the task's synthetic specialization
proof. Native storage and alpha are the independently verified G2 boundary.
Specialize the checked compiler's existing fragment 2D TEX output in a private
per-program GLSL variant; do not mutate shared textures or add view images.
Canonical program keys include every specialization dependency, preserve
fixed legacy identity semantics, and reuse the original A program on A/B/A.
Own and charge fragment variants alongside existing flat vertex variants;
prove allocation/compile/link/reflection/quota rollback and deletion.

Use unchanged original packets plus separate synthetic hardware sampling,
swizzle/alpha, nearest/linear/clamp-edge, alias/role, A/B/A and poisoned-state
oracles. A swizzle source fault must fail independent pixels. Retain affected
color/depth/state/draw/async/tiny checks, then freeze the exact source, record
final hardware/pristine-clone proof and submit to a fresh critic. This remains
an isolated renderer boundary; production negotiation stays disabled.

