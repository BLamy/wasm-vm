---
id: E9-T09
epic: 9
title: Place recorded events at exact guest execution boundaries
priority: 524.909
status: pending
depends_on: [E9-T01, E9-T02]
estimate: S
risk: high
capstone: false
---

## Goal

Give recording and replay one exact instruction position and ordered delivery mechanism.

## Boundary

The single-hart event clock, ordered queue and bounded run-to-event fence across interpreter and JIT. Host callbacks stage data rather than mutate guest state at unrecorded moments.

## Acceptance criteria

- [ ] Equal-position events preserve a monotonic tie-break sequence, including timer delivery and WFI/idle advancement.
- [ ] A JIT block cannot run past a pending event boundary; interpreter/JIT and varied run quanta reach identical state at that boundary.
- [ ] Counters survive snapshot/restore and values above 2^53; sequence exhaustion or an unsupported scheduling mode fails explicitly.

## Deterministic acceptance

`make verify-E9-T09`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Deliver events at a block edge, inside a compiled block and across WFI. Vary browser callback order and run quanta; a shifted injection point or duplicated event is a refutation.

## Verification log

(pending; no implementation or verification claim)
