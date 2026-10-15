---
id: E6-T11d74
epic: 6
title: Default Omarchy launches to the existing software warm snapshot
priority: 525.027039
status: pending
depends_on: [E6-T11d70, E6-T11d71, E6-T11d72, E6-T11d73]
estimate: S
risk: medium
capstone: false
---

## Boundary

Without an explicit graphics override, the launcher and direct Omarchy desktop
URL use the existing software warm snapshot. Explicit gpu=1 or choosing GPU
in the launcher retains the qualified GPU cold-boot path. Keep the graphics
choice visible; explain warm versus cold in the existing launcher/docs. No
snapshot serialization, guest image, CPU, renderer or timing semantics change.

## Deterministic acceptance

`make verify-E6-T11d74` builds the ordinary bundle and checks the unselected
launcher default, direct no-gpu Omarchy URL and explicit gpu=0/gpu=1 selection.
Use actual UI/image/worker paths for all four images with no GPU query override:
initial/repeat and Alpine/Node persistence, plus original trusted Omarchy typing
and cursor displacement. Record actual restored/ready state and paired hashes;
never substitute a screenshot or an injected marker. Explicit GPU selection is
checked without repeating its unchanged independently verified long desktop boot.
Run docs validation, default127/0 and affected site routes. Deploy and check the
same default software paths and explicit GPU admission on the public URL.

## Adversarial verification

Use the exact user URL with no gpu parameter and a fresh browser context. Attack
a saved stale service worker and direct query selection; the new version must
reach the warm route while explicitgpu1 still selects the unchanged cold path.
Remove only the default-selection change in an isolated page copy; the default
selector/actual boot-options oracle must fail. Carry existing renderer/native/
stock GPU evidence by unchanged boundary; no new CPU or latency-budget claim.

## Verification log

### 2026-10-15 — worker — user-reported default route

At publishedf0357748, main.js selectsGPU unlessgpu=0. The user's ordinary
Omarchy URL therefore cold-boots even though the existing paired software
snapshot fast-boots. Existing software checks explicitly appendedgpu=0, so
they did not exercise this missing default choice. Correct that one launch
boundary and record the exact no-override route.
