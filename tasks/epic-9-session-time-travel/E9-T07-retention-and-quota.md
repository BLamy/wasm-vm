---
id: E9-T07
epic: 9
title: Manage session quotas retention and shared-data deletion
priority: 524.907
status: in-progress
depends_on: [E9-T03, E9-T04, E9-T06]
estimate: S
risk: high
capstone: false
---

## Goal

Keep local recordings within explicit user-controlled storage limits without corrupting shared history.

## Boundary

Quota handling and reference-aware session deletion/garbage collection; no cloud storage. Expose origin usage, persistent-storage request outcome and retention controls.

## Acceptance criteria

- [ ] Quota exhaustion stops or pauses recording with a clear state and preserves the last committed prefix; do not silently discard a named session.
- [ ] Delete one branch and reclaim only unreachable chunks; shared checkpoints, disk roots and sibling sessions still restore.
- [ ] Interrupt garbage collection and reopen storage safely; surface browser eviction or missing data honestly and provide delete/retry actions.

## Deterministic acceptance

`make verify-E9-T07`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Force quota failure during append and interrupt GC after reference updates. Check every surviving session against its original content hashes and disk roots.

## Verification log

### 2026-10-18 — worker — started

Dependencies E9-T03/T04/T06 are independently verified. This S/high-risk slice owns
browser session-storage maintenance: explicit payload/point limits and origin persistence
feedback, quota-safe recording pause/retry, and locked reachability-based deletion/cleanup.
No named history is automatically discarded. The planned proof includes real browser quota
failure during append, shared machine/disk/event references, interrupted cleanup and reopen,
varied two-tab lock schedules, actual guest restores and a final pristine-source run.
The retained GPU runtime stays pinned; accelerated history remains gated to T17/T18.

