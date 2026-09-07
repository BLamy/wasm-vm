---
id: E5-T26e
epic: 5
title: Desktop restore reconciliation for agent, scanout, and viewport
priority: 526.5
status: pending
depends_on: [E5-T26d, E5-T23e, E5-T22b]
estimate: S
risk: high
capstone: false
---

## Goal

Compose the device sections into one restore transaction and reconcile host-facing state: agent
HELLO, canvas dimensions, scanout/cursor presentation, viewport changes, and input/audio repairs.

## Boundary

Own restore ordering and the host/guest reconciliation callbacks. Do not add new device payload
formats; consume the contracts from E5-T26a through E5-T26d and the existing agent/viewport work.

## Acceptance criteria

- A valid composite snapshot restores all component sections in dependency order, re-handshakes
  the agent, resizes or letterboxes the canvas through T22, and presents a full repair frame.
- A changed host window size produces a deterministic resize event/letterbox result without
  changing the snapshotted guest scanout dimensions.
- Any component refusal aborts atomically, clears transient reconciliation work, and leaves a
  clean cold-boot fallback rather than a half-restored desktop.

## Verification command

make verify-E5-T26e

## Adversarial verification

Drop the agent channel during restore, change viewport dimensions between save and load, and
force one component version refusal. Verify bounded retry/abort behavior and no stale host state.

## Verification log

(empty)
