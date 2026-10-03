---
id: E6-T10c
epic: 6
title: Freeze browser renderer capabilities against the captured guest corpus
priority: 525.02703
status: pending
depends_on: [E6-T10b]
estimate: S
risk: medium
capstone: false
---

## Boundary

Use the pinned guest corpus and shader bridge to select the browser renderer
backend and write docs/gpu-3d-decision.md. Map every observed opcode/shader/API
feature to supported, implementable or rejected browser behavior. Define exact
capsets, context isolation, resource/scanout lifetime, asynchronous fences and
snapshot/device-loss behavior. Preserve the original E6-T10 coverage requirement;
no observed family may be left TBD or falsely advertised.

## Deterministic acceptance

`make verify-E6-T10c` cross-checks the decision matrix against corpus histograms
and exercises three representative translated shader patterns with pixel oracles
on the supported browser matrix. Unsupported browsers are explicitly gated.

## Adversarial verification

Attack the three hardest claimed mappings, verify exact guest version/driver
claims and browser limits, and reject any capability not implementable by the
chosen API. No Mesa initialization or Hyprland compatibility claim until proven.

## Verification log
(empty)
