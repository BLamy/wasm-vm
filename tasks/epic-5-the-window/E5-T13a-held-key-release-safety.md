---
id: E5-T13a
epic: 5
title: held-key ledger and release-all safety
priority: 513.1
status: pending
depends_on: [E5-T12c]
estimate: S
risk: medium
capstone: false
---

## Goal

Make the host-side set of keys believed down by the guest explicit, bounded, and
idempotent. A single release-all operation must turn every held key into an ordered guest
key-up frame and leave no stale modifier after focus or lifecycle loss.

## Deliverables

- `web/src/input/held-keys.ts` and its no-bundler browser projection, with press, release,
  release-all, snapshot, and reset operations.
- Lifecycle adapters for blur, `visibilitychange` to hidden, pointer-lock loss, and the T08
  view-toggle boundary that call the same release-all operation.
- Deterministic unit fixtures for make/break ordering, duplicate/orphan breaks, bounded state,
  and repeated lifecycle notifications.

## Acceptance criteria

- [ ] Pressing physical keys records each key once; releasing a held key emits one break, while
      duplicate or orphan releases are no-ops and cannot underflow the ledger.
- [ ] `releaseAll` emits exactly one break for every currently held key in deterministic order,
      terminates the frame with `SYN_REPORT`, and leaves the snapshot empty.
- [ ] Synthetic blur, hidden-visibility, pointer-lock-loss, and view-toggle notifications all
      invoke the same release-all path, including when notifications repeat.

## Adversarial verification

Feed 500 alternating lifecycle flaps and duplicate keyups through the isolated adapter, with
randomized held-key order. The final snapshot must be empty and every emitted break must have a
matching prior make. Call release-all twice during a held modifier chord; the second call must
emit no guest events.

## Verification log

(empty)
