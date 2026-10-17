---
id: E9-T04
epic: 9
title: Preserve immutable disk state for historical checkpoints
priority: 524.904
status: pending
depends_on: [E9-T02, E3-T12c3]
estimate: S
risk: high
capstone: false
---

## Goal

Rewind guest files along with CPU and RAM without overwriting the current persistent disk.

## Boundary

Versioned copy-on-write overlay roots and their reference/identity rules. Each checkpoint references an immutable disk generation; replay writes use a private overlay.

## Acceptance criteria

- [ ] Create two roots around a real guest file change and restore the matching content from each.
- [ ] Keep checkpoint disk roots stable while recording continues and when a separate live branch writes the same block.
- [ ] Reject mismatched base images/generations before applying state; preserve shared ancestors when a child session is deleted.

## Deterministic acceptance

`make verify-E9-T04`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Interleave writes and checkpoint publication, then restore both roots in reverse order. Any newer file bytes leaking into the older state, or mutation of a sibling root, is a failure.

## Verification log

(pending; no implementation or verification claim)
