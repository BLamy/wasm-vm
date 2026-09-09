---
id: E5-T09c
epic: 5
title: Latest-wins requestAnimationFrame presentation scheduler
priority: 509.3
status: verified
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

### 2026-09-04 — verifier — VERDICT: verified

- P1 latest-wins and scheduling idempotence — HELD. Predicted three enqueues would leave one
  pending plan, one active callback, and only the newest value would be presented; the focused fake-
  rAF test observed value `3`, `coalesced=2`, `skipped=2`, and no callback after the drain.
- P2 bounded load — HELD. Predicted a deterministic 240-plans/sec producer against 60 display
  callbacks and a four-work-unit backend would never exceed one pending plan or two active chains;
  the seeded random enqueue order observed `maxPending=1`, `maxActive=1`, an eventually presented
  final plan, and `presented <= displayCallbacks + 1`.
- P3 lifecycle safety — HELD. Predicted reentrant enqueue would defer exactly one overrun, pause/
  resume would retain only the latest plan, and callbacks captured before pause/dispose would be
  inert; the focused tests observed `overruns=1`, one resumed chain, and zero stale presentations.
- P4 truthful counters — HELD. Predicted a false or throwing backend delivery would increment
  `skipped` without incrementing `presented`; the exact test observed `presented=0`, `skipped=2`,
  and one captured error for the throwing delivery.
- P5 controller seam and coverage — HELD. Predicted the opt-in controller would defer backend
  work until rAF, retire a queued old-size frame on resize, and leave no callback after dispose;
  the controller fixture observed latest-frame delivery, resize retirement, and an inert stale
  callback. The focused suite covered the scheduler and all changed controller paths (7 passed,
  0 failed), and `make web-dist` refreshed the deployable source tree.

Exact final implementation head: `c8ca9213fa1fc6fbbc18be47b3a7c6867fcfc6e1`.
Exact acceptance command: `make verify-E5-T09c`.
Evidence: `evidence/e5-t09c/present-scheduler.json` (SHA-256
`8156b10280dc8292a0469f4e808371be668b6171766ceebaf3fd5b266c5c85f8`), whose recorded head,
proof-file digests, and passing `node --test web/tests/e5-t09c-present-scheduler.test.mjs` match
this claim. Independent machines, WebKit, and host rr are excluded by the task boundary and user
direction; hidden-tab fallback and the end-to-end workload remain T09d/T09e.
