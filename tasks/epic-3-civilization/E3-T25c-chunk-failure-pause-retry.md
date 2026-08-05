---
id: E3-T25c
epic: 3
title: Chunk-demand failure pause and retry
priority: 325.3
status: pending
depends_on: [E3-T25a, E3-T03]
estimate: S
risk: high
capstone: false
---

## Goal
Pause the machine coherently when a demanded image chunk exhausts retries, then resume the same
blocked operation after the user retries successfully.

## Deliverables
- Idempotent VM pause/resume plumbing at the block-demand boundary.
- A chunk-specific recovery surface with retry/details and preserved device state.
- Deterministic permanent/transient failure injection around one guest read.

## Acceptance criteria
- [ ] `make verify-E3-T25c` pauses during guest `find /usr`, clears the injected failure, resumes,
  and completes without guest-visible transient EIO or duplicated execution.
- [ ] Closing/dismissing the surface cannot strand an unresumable machine.
- [ ] Repeated retry keeps memory and pending block requests bounded.

## Adversarial verification
Fail before/after each fetch transition, retry rapidly, dismiss with mouse/keyboard, suspend the tab,
and combine with unrelated console input. Any lost/duplicated request, leaked EIO, deadlock, runaway
queue, or zombie pause refutes.

## Verification log
(empty)
