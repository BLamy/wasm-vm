---
id: E6-T10c
epic: 6
title: Freeze browser renderer capabilities against the captured guest corpus
priority: 525.0269
status: in-progress
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

### 2026-10-03 — worker — activated (UTC)

Parent `0abd0745` independently verified E6-T10b; its complete reference corpus
is published in PR #404. This task is prioritized ahead of the independent
desktop-release lane to continue the user's explicit guest-graphics offload
request. No other task remains active. The current corpus contains 33 command
families and 19 distinct VERT/FRAG TGSI bodies; Xwayland contributes the most
complex shader operations. The existing shader bridge remains a bounded
prototype, not support for all recorded shaders or a guest renderer. This slice
will freeze the backend/feature contract and prove representative browser
mappings without advertising unimplemented guest capabilities.
