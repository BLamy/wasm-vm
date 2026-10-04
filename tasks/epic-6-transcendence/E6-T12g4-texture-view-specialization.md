---
id: E6-T12g4
epic: 6
title: Execute required sampler-view swizzles addressing and filtering
priority: 525.0270104
status: pending
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

(empty)
