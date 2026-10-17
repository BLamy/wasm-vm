---
id: E9-T20
epic: 9
title: Continue from the past on an isolated recording branch
priority: 524.920
status: pending
depends_on: [E9-T19, E9-T04, E9-T14]
estimate: S
risk: high
capstone: false
---

## Goal

Let a user resume from a past position while preserving the original session and its future.

## Boundary

Branch creation with a new session/log identity and private writable disk root. Network access stays offline until a deliberate go-live transition establishes fresh connections; never retransmit recorded actions as a side effect of branching.

## Acceptance criteria

- [ ] Create two continuations from one past position and preserve original future events, files and shared ancestors unchanged.
- [ ] Branch writes and new inputs appear only in the selected child; reopen and replay parent and siblings independently.
- [ ] An explicit go-live action resets or refuses historical external connections under the documented policy; no automatic reconnection or side-effect replay occurs during seek.

## Deterministic acceptance

`make verify-E9-T20`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Write the same file differently in parent and two children, then delete/reopen in varying order. Use an external counter to detect unintended reconnects or duplicate state-changing sends.

## Verification log

(pending; no implementation or verification claim)
