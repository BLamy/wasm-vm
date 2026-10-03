---
id: E6-T10b
epic: 6
title: Capture the current guest graphics driver and command requirements
priority: 525.02702
status: pending
depends_on: [E6-T10a]
estimate: S
risk: medium
capstone: false
---

## Boundary

Pin the prepared Arch/Mesa/Hyprland stack and capture real reference VirGL streams
for a textured GLES scene, kmscube, glmark2-es2 and a compositor frame. Preserve
commands, versions, raw captures, hashes and opcode/shader histograms. Update the
old Alpine/ES2 assumptions using the actual guest. This slice collects a reusable
corpus; it does not advertise capabilities or claim browser desktop rendering.

## Deterministic acceptance

`make verify-E6-T10b` validates all four recorded captures, versions, complete
framing, shader extraction and reproducible histogram/digest generation.

## Adversarial verification

Independently recapture one workload and check materially missing opcode families.
Verify Mesa actually selected virgl; software fallback is a failed capture. Check
captures contain draw work, textures, fences and real shader bodies.

## Verification log
(empty)
