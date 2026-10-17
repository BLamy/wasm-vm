---
id: E9-T04
epic: 9
title: Preserve immutable disk state for historical checkpoints
priority: 524.904
status: in-progress
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

### 2026-10-17 — worker — started

E9-T02 and E3-T12c3 are verified, and the preceding session-store slice is independently
verified and published. This high-risk S boundary stores immutable, content-addressed
maps of the complete COW write set, bound to the canonical chunked-image identity and
exact overlay generation. Restoring a root constructs a private overlay; it never seeds
or rewrites the live persistent store. Shared block references remain reachable from
every surviving root. The proof will use real guest file changes and an independent
filesystem reader, interleaved publication/live writes, sibling roots, and identity and
generation refusal cases. Coherent CPU/RAM/device capture remains the T05 boundary.
