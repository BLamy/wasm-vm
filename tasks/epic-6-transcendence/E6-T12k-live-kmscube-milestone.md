---
id: E6-T12k
epic: 6
title: Render real guest kmscube at 30 FPS with reference image and cache proof
priority: 525.02707
status: pending
depends_on: [E6-T12j]
estimate: S
risk: high
capstone: false
---

## Boundary

Establish the original kmscube correctness/performance milestone through the
real guest device and WebGL2 renderer. Pin workload source, scene/frame timing,
guest image and host configuration; use comparable llvmpipe reference frames.
No rewritten command stream, reduced scene or skipped submissions may stand in
for the workload. Any independent missing feature or optimization must first
land in its own verified S task rather than broadening this milestone.

## Deterministic acceptance

`make verify-E6-T12k` renders the spinning cube at 800x600 for at least 60 seconds
with at least 30 actually presented FPS, matching a committed screenshot
sequence to corresponding llvmpipe reference frames at SSIM>=0.95. Record
browser presentation/frame-profiler data as well as guest counters so dropped
frames cannot fake the claim. Require the documented program/state-cache hit
rate >95% after frame 10, with complete hit/miss denominators and counters in the
debug UI. Record original command/shader/binding dumps for selected frames,
host/browser/GPU identity, zero unexpected errors and no fallback. Preserve
readback/2D regressions, run relevant high-risk gates and final clean clone,
then perform AGENTS.md demo/browser/live-deployment checks.

## Adversarial verification

Independently align reference frames and check Y orientation, winding, depth,
textures and alpha rather than trusting average SSIM alone. Attack counters by
delaying presentation and invalidating cache entries; measurements must expose
the changes. Carry E6-T12i's 10^4 blend-toggle/collision/eviction proof forward
when its code is unchanged. FPS below threshold, SSIM below 0.95 or inverted
geometry refutes the milestone; successful initialization alone is insufficient.

## Verification log

(empty)
