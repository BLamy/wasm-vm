---
id: E5-T09c
epic: 5
title: Latest-wins requestAnimationFrame presentation scheduler
priority: 509.3
status: pending
depends_on: [E5-T09b]
estimate: S
risk: medium
capstone: false
---

## Goal

Decouple guest flush callbacks from display refresh with a page-owned latest-wins scheduler that
performs at most one upload and draw per requestAnimationFrame.

## Boundary

This slice owns the browser scheduler and its queue/coalescer seam. It does not own the hidden-tab
timer fallback, public metrics surface, or end-to-end guest workload.

## Deliverables

- A scheduler accepting frame plans, retaining only the newest pending plan, and issuing one present
  per animation frame.
- Explicit counters for enqueued, coalesced, presented, skipped, and overrun frames.
- Focused fake-rAF tests proving scheduling idempotence, latest-wins behavior, and teardown safety.

## Acceptance criteria

- A synthetic producer at 240 plans/second presents no more than the display callback count plus one;
  the pending queue remains bounded at one and the latest plan is eventually presented.
- Reentrant enqueue, pause/resume, and dispose sequences never create two active rAF chains or leave
  a callback referencing a disposed canvas.
- The scheduler's counters distinguish accepted plans from coalesced/skipped plans without
  reporting a present that did not invoke the backend.

## Verification command

`node --test web/tests/e5-t09c-present-scheduler.test.mjs`

## Adversarial verification

Use a deterministic fake clock with a 4x-slow backend and random enqueue order; assert no unbounded
queue growth, no duplicate present, and eventual latest-frame delivery after the backend catches up.

## Verification log

(empty)
