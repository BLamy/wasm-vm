---
id: E6-T12l
epic: 6
title: Render guest es2gears interactively and pass an independent workload differential
priority: 525.02708
status: pending
depends_on: [E6-T12k]
estimate: S
risk: high
capstone: false
---

## Boundary

Prove es2gears inside the actual guest desktop and retain the original independent
render-differential attack. Pin packages, desktop configuration and reference
inputs. The verifier chooses one additional workload the implementer did not
list, such as a glmark2-es2 build scene; record its unchanged guest-generated
stream and truthful supported-feature outcome. A missing feature is a failure
to complete this milestone until a separate S fix is verified.

## Deterministic acceptance

`make verify-E6-T12l` shows es2gears rendering correctly at >=30 actually presented
FPS with its own FPS output visible in the guest terminal and independently
correlated browser frame-profiler data. Compare kmscube, es2gears and the
verifier-selected workload against matched llvmpipe references: SSIM>=0.95 and
no Y/winding/geometry inversion or missing textures. The command accepts the
recorded verifier workload selection as a pinned fixture, not an arbitrary
nonreproducible shell override. Retain screenshots, streams, references, frame
timings and zero unexpected browser errors. Run affected high-risk gates,
final clean clone and repository demo/browser/live-deployment checks.

## Adversarial verification

Choose reference frames before reading rendered results and compare scenes
outside the worker's selected examples. Verify no CPU fallback, frame dropping,
oracle substitution or undocumented shader rewrite. Re-run the previously
verified kmscube/readback gates incrementally where dependencies are unchanged.
Performance and correctness must both survive real desktop composition.

## Verification log

(empty)
