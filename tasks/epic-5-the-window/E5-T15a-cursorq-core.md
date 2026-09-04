---
id: E5-T15a
epic: 5
title: Cursorq core state and command handling
priority: 515.1
status: in-progress
depends_on: [E5-T03c]
estimate: S
risk: high
capstone: false
---

## Goal

Make virtio-gpu cursorq UPDATE_CURSOR and MOVE_CURSOR real, bounded, and canvas-free by maintaining
validated per-scanout cursor state and notifying the host sink when that state changes.

## Boundary

This slice owns command decoding, resource/position/hotspot validation, cursor state lifetime, and
the core callback contract. PNG/CSS conversion and DOM mode selection belong to E5-T15b/c.

## Deliverables

- Cursor UPDATE/MOVE protocol structs and handlers with malformed-chain/error coverage.
- Per-scanout `{ resource_id, hot_x, hot_y, pos }` state with resource 0 hide semantics.
- A canvas-free cursor-state callback and native tests for update, move, hide, reset, and invalid data.

## Acceptance criteria

- A valid UPDATE_CURSOR records resource id and hotspot; a valid MOVE_CURSOR changes only position.
- Resource id 0 hides the cursor; reset clears every scanout without retaining guest buffers.
- Invalid scanout, resource, dimensions, hotspot, and descriptor lengths return a protocol error and
  do not mutate prior state.
- The same deterministic command sequence produces identical state and callback records natively and
  in the wasm build.

## Verification command

`make verify-E5-T15a`

## Adversarial verification

Feed truncated, oversized, and repeated UPDATE/MOVE chains, alternate hide/show 1,000 times, and
attempt to move an unbound scanout. Any state leak, callback reordering, or guest-memory read past
the checked descriptor refutes the slice.

## Verification log

(empty)
