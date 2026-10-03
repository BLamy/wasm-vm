---
id: E6-T12d
epic: 6
title: Replay the original three VirGL draws and readbacks in WebGL2
priority: 525.02695
status: pending
depends_on: [E6-T12c]
estimate: S
risk: high
capstone: false
---

## Boundary

Execute the textured scene's original DRAW_VBO packets: unsigned-short indexed
triangles, two RG32_FLOAT attributes, one instance and the recorded tint/blend
changes. Bounds-check actual index/vertex fetches; UINT_MAX max_index is an
unknown range hint, not authorization to access a huge buffer. Replay all eight
original submissions and required public lifecycle/backing inputs, preserving
command bytes, geometry, shaders, state, order and cleanup. Explicitly identify
the dependency-selected scene and excluded independent boot scanout events.

## Deterministic acceptance

`make verify-E6-T12d` replays all 210 original packets and three actual GPU draws.
Execute COPY_TRANSFER3D readbacks into staging offsets64/4160/8256, then assert
the independent workload's 768 exact interior pixels over all three phases.
Do not preload later recorded output snapshots or reconstruct state/geometry in
the harness. Bind every executed input to original event/hash/offset provenance.
Record GPU identity, emitted GLSL/reflection, frame-N command/binding dumps,
screenshots, output hashes, cleanup counts and zero browser errors. Complete
affected high-risk gates and one scrubbed pristine-clone replay.

## Adversarial verification

Independently mutate a vertex/index, texture texel, constant, blend factor and
readback offset; the relevant pixel or bounds oracle must fail. Poison reference
output snapshots and require unchanged actual pixels. Attack geometry bounds,
Y orientation, context/subcontext reuse, resource unref before object teardown,
invalid-tail recovery and resource budgets. No Mesa initialization, live guest
transport, production VIRGL advertisement or FPS claim follows this replay.

## Verification log

(empty)
