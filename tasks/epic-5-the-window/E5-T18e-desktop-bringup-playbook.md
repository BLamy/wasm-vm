---
id: E5-T18e
epic: 5
title: Publish the desktop bring-up playbook and final boot proof
priority: 518.5
status: in-progress
depends_on: [E5-T18d]
estimate: S
risk: high
capstone: false
---

## Goal

Turn the completed local bring-up work into a reproducible, reviewed operating playbook and
final rebuilt-artifact proof.

## Boundary

This slice owns only the cross-slice failure inventory, docs/desktop-bringup.md, boot timing
reporting, and final clean rebuild plus cold-boot sign-off. It does not add new compositor,
input, or pointer behavior.

## Deliverables

- docs/desktop-bringup.md with the debug-channel cheat sheet and every encountered symptom,
  diagnosis command, fix, and expected recovery outcome.
- A cold/warm boot-to-desktop timing report tied to the exact committed image/profile.
- A deterministic final verifier that rebuilds the image from the committed manifest and runs
  the local cold-boot gauntlet without dirty-image or cache shortcuts.

## Acceptance criteria

- [ ] The playbook covers every failure recorded by E5-T18a-d, including seatd/udev/permissions,
      runtime-directory, renderer, input/XKB, restart, and getty-fallback symptoms.
- [ ] The exact rebuilt artifact is hash-bound in the report, and the local cache-disabled
      25-boot gauntlet has no hang, black screen, missing cursor, or missing menu.
- [ ] The report records cold and warm boot-to-desktop timings and the final verifier passes
      from the committed manifest with no undeclared hand edits to the image.

## Verification command

make verify-E5-T18e

## Adversarial verification

Have the fresh verifier run the documented failure drills using only the playbook: remove the
video device, delete runtime-directory initialization, force gles2, and trigger three crashes.
Each diagnosis must complete in five minutes and match a documented symptom/fix. Mutate the
published image or manifest after the rebuild; the verifier must reject the stale hash rather
than accepting dirty-image evidence. WebKit and independent machines are out of scope.

## Verification log

### 2026-09-05 — coordinator — planned

This final S slice makes the debugging knowledge and exact rebuilt-boot proof durable before
downstream resize, performance, and capstone work can depend on T18.

### 2026-09-06 — worker — STARTED

Consolidate the verified T18a-d failure inventory without changing compositor/input
semantics. Freeze the complete existing package/custom-file manifests, rebuild the
T18d recovery-enabled interactive image from those committed inputs in a fresh
shared-folder clone, and bind 25 cache-disabled browser boots plus a cache-enabled
prime/reload timing pair to that artifact. Independent machines, WebKit, and rr
remain out of scope. Continue stacking; merge all PRs only at the Epic 5 milestone,
then reuse the prepared Omarchy filesystem, deploy production, and stop before E6.
