---
id: E6-T10b
epic: 6
title: Capture the current guest graphics driver and command requirements
priority: 525.02702
status: in-progress
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

### 2026-10-03 — worker — activated

Parent `cad9e11702fb3f4b3791d6144ec9d63c01e080d8` (verified E6-T10a,
PR #403). Disposable Linux ARM64 QEMU plus pinned virglrenderer 1.3.0 can
boot the sanitized Arch image and run the actual Mesa 26.2.2 / Hyprland 0.56.2
stack through VirGL. The original ext4 is mounted read-only and a qcow2 overlay
receives all writes. The reference host uses llvmpipe; browser hardware proof
is separate. Existing exploratory debug logs are incomplete and are not this
task's framed corpus. Implementation will capture full submissions, resource
and transfer data, shader continuation framing and finite workload markers.
