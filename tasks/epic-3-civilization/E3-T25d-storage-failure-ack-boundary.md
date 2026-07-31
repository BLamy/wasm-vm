---
id: E3-T25d
epic: 3
title: Storage failure pause and acknowledgement boundary
priority: 325.4
status: pending
depends_on: [E3-T25a, E3-T10]
estimate: S
risk: high
capstone: false
---

## Goal
Surface backend write, eviction, handle-loss, and quota failures before the guest receives a false
durability acknowledgement, then resume safely when the condition is cleared.

## Deliverables
- Typed adapters from IndexedDB/OPFS/quota failures into the shared pause surface.
- An acknowledgement barrier tied to E3-T08 commit semantics.
- Fault-injected retry tests for each storage cause.

## Acceptance criteria
- [ ] `make verify-E3-T25d` proves no failing write/flush is acknowledged to the guest and each
  cleared fault retries to durable completion.
- [ ] Cause-specific text/actions distinguish quota, eviction, handle loss, and I/O failure.
- [ ] Cancel/reset paths leave the overlay and machine in a documented coherent state.

## Adversarial verification
Fail at every write/commit acknowledgement boundary, evict during retry, exhaust quota, and lose the
backend handle repeatedly. Any false ACK, silent data loss, ambiguous recovery, stale handle reuse,
or inconsistent overlay refutes.

## Verification log
(empty)
