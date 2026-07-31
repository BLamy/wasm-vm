---
id: E3-T12b
epic: 3
title: CPU architectural snapshot and instruction-exact resume
priority: 321.92
status: pending
depends_on: [E3-T12a]
estimate: S
risk: high
capstone: false
---

## Goal
Snapshot and restore the hart's complete architectural execution state so continuation produces an
instruction-identical trace, including privilege, traps, counters, timers, and pending interrupts.

## Deliverables
- A versioned CPU section covering registers, PC, privilege, CSRs, reservations, counters, and
  architecturally relevant pending state.
- An all-or-nothing restore implementation with exhaustive field inventory.
- A native determinism target: run N, snapshot, run M, restore, rerun M, and byte-diff traces.

## Acceptance criteria
- [ ] `make verify-E3-T12b` passes and the post-restore M-instruction trace is byte-identical,
  including timer-interrupt placement.
- [ ] Dirty-target restore proves every architectural field is overwritten exactly once while
  malformed input leaves the target unchanged.
- [ ] Native and wasm32 builds accept the same versioned CPU payload.

## Adversarial verification
Delete or reorder each serialized CPU field, snapshot immediately around trap/interrupt/LR-SC
boundaries, and restore into deliberately dirty state. Any mutant surviving the trace diff, partial
mutation on error, or host-width-dependent encoding refutes.

## Verification log
(empty)
