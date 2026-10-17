---
id: E9-T05
epic: 9
title: Capture and restore coherent software session checkpoints
priority: 524.905
status: pending
depends_on: [E9-T03, E9-T04]
estimate: S
risk: high
capstone: false
---

## Goal

Save a usable single-hart software-rendered machine at a session position and restore it after reload.

## Boundary

Coordinate CPU/RAM/device state, clock policy, input queues, log cursor and historical disk root at one bounded quiescence point. Accelerated guests remain explicitly gated until T17/T18.

## Acceptance criteria

- [ ] Record and restore exact CPU/device/disk witnesses from the same boundary, including pending I/O and held keyboard state.
- [ ] A failed capture or rejected restore leaves the previous committed checkpoint and current machine usable; never publish half a tuple.
- [ ] Use real native and built-browser fixtures; restore guest-visible memory and files rather than accepting a screenshot as state proof.

## Deterministic acceptance

`make verify-E9-T05`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Capture during disk I/O and input transitions, force quiesce timeout and corrupt one component. Demand all-or-nothing admission and an independently checked post-restore guest witness.

## Verification log

(pending; no implementation or verification claim)
