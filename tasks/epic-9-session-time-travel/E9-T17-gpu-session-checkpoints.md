---
id: E9-T17
epic: 9
title: Restore historical accelerated desktop checkpoint pairs
priority: 524.917
status: pending
depends_on: [E9-T05, E9-T16, E6-T11d74c, E6-T11d74d]
estimate: S
risk: high
capstone: false
---

## Goal

Use coherent RAM/disk/GPU checkpoint pairs as accelerated session keyframes.

## Boundary

Integrate the accepted production GPU checkpoint path, renderer/profile identity, physical scanout and fresh epoch ownership with the session store. Reuse verified predecessor work; no raw WebGL handles are serialized.

## Acceptance criteria

- [ ] Capture two real accelerated desktop positions and restore the matching guest state, disk root, GPU resources and physical scanout from each.
- [ ] Require actual post-restore guest rendering/input and current-epoch scanout; old screenshots, retained readiness messages and software fallback do not prove accelerated restore.
- [ ] Reject incompatible host/profile/build or lost-context captures cleanly. Reuse the verified E6-T11d74a/b/c/d native/renderer/worker/publication path; the cancelled E6-T11 container is not an executable prerequisite. Retain the authenticated clock policy and fresh epochs.

## Deterministic acceptance

`make verify-E9-T17`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Cross-wire RAM/disk/GPU components, change the host profile, lose context while capturing and send stale epoch completions. Require explicit refusal and preservation of the original session.

## Verification log

(pending; no implementation or verification claim)
