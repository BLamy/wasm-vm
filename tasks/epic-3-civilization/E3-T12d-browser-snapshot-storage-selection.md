---
id: E3-T12d
epic: 3
title: Browser snapshot persistence and restore selection
priority: 321.94
status: pending
depends_on: [E3-T12c]
estimate: S
risk: high
capstone: false
---

## Goal
Persist coherent snapshots in the browser and select restore versus cold boot using exact build,
base-image, and overlay-generation validation.

## Deliverables
- Bounded streaming snapshot save/load storage plus export/import without whole-blob duplication.
- A typed browser restore decision API returning resume or a specific cold-boot reason.
- Browser tests for corrupt, truncated, stale, missing, and valid snapshots across reload.

## Acceptance criteria
- [ ] `make verify-E3-T12d` saves, reloads, validates, and restores a production-sized snapshot
  without exceeding the documented memory bound.
- [ ] Every invalid snapshot falls back to cold boot with a typed reason and leaves local overlay
  state intact.
- [ ] Export/import round-trips the identical container digest.

## Adversarial verification
Kill the tab during each storage phase, truncate or swap snapshot objects, exhaust quota, and race
two tabs opening the same snapshot. Any half-published snapshot selected for restore, silent data
loss, whole-RAM duplicate allocation, or ambiguous fallback refutes.

## Verification log
(empty)
