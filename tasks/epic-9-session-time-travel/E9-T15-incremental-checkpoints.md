---
id: E9-T15
epic: 9
title: Add incremental RAM keyframes with bounded storage work
priority: 524.915
status: pending
depends_on: [E9-T05, E9-T14]
estimate: S
risk: high
capstone: false
---

## Goal

Create periodic seek points without serializing a full Omarchy-sized checkpoint every second.

## Boundary

Dirty-page/incremental RAM checkpoint encoding and bounded chain/reference management, reusing accepted disk roots and device snapshots. Compression stays outside long UI-thread tasks.

## Acceptance criteria

- [ ] Reconstruct exact state from a full base plus deltas across guest writes, DMA and restore; all memory mutation paths participate in dirty tracking.
- [ ] Bound delta-chain length and checkpoint work under the T01 budgets; record actual full/delta sizes, pause time and encode/decode memory.
- [ ] Missing/corrupt ancestor chunks refuse restore; deduplicated chunks remain live while referenced by another keyframe or session.

## Deterministic acceptance

`make verify-E9-T15`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Write memory through CPU stores and device DMA, including a page modified back to its earlier value. Remove an ancestor and check refusal; compare reconstruction with an independent full snapshot.

## Verification log

(pending; no implementation or verification claim)
