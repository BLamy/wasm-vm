---
id: E9-T23
epic: 9
title: Harden recording and seeking against crashes and corrupt history
priority: 524.923
status: pending
depends_on: [E9-T07, E9-T18c, E9-T20, E9-T21, E9-T22]
estimate: S
risk: high
capstone: false
---

## Goal

Keep recorded history and the browser usable across interruption, malformed data and device loss.

## Boundary

Integration recovery of accepted session boundaries: append/keyframe/branch/GC interruption, quota/eviction, multi-tab ownership, cancelled seeks and graphics context loss.

## Acceptance criteria

- [ ] A seeded fault matrix preserves the last committed prefix and every unaffected parent/sibling session; incomplete work never becomes playable.
- [ ] Exercise at least 10000 bounded manifest/event/keyframe mutations and varied completion schedules with no panic, out-of-bounds access, unbounded allocation or hung control request.
- [ ] Actual built-browser context loss, reload and stale-epoch injection resolve pending requests and show a recoverable state; evidence includes exact positions, digests and original failures.

## Deterministic acceptance

`make verify-E9-T23`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Choose new interruption points around commits and fence completion, race two tabs, and sabotage a cancellation/generation check to show that the promoted tests detect it.

## Verification log

(pending; no implementation or verification claim)
