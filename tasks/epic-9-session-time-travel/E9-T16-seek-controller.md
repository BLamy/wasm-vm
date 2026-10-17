---
id: E9-T16
epic: 9
title: Seek and reverse-step with cancellable replay-forward
priority: 524.916
status: pending
depends_on: [E9-T14, E9-T15]
estimate: S
risk: high
capstone: false
---

## Goal

Reach a selected recorded instruction by restoring an earlier keyframe and replaying forward.

## Boundary

Keyframe lookup, exact run-to-target and seek request ownership. Rapid scrubbing cancels superseded work; a stale response cannot replace the latest selected machine.

## Acceptance criteria

- [ ] Targets before/after events and between keyframes reach the same state digest as a from-start replay.
- [ ] Forward-step and reverse-step use precise instruction semantics, including traps, WFI and boundaries sharing an event position.
- [ ] Rapid alternating seeks terminate or cancel within the declared bound; only the latest request publishes state, progress and its rendered result.

## Deterministic acceptance

`make verify-E9-T16`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Issue 100 seeded forward/backward seeks with overlapping requests. Delay an old seek completion and prove it cannot win; independently derive target digests by replaying from the initial checkpoint.

## Verification log

(pending; no implementation or verification claim)
