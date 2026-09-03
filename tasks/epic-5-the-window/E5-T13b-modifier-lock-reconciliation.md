---
id: E5-T13b
epic: 5
title: modifier and lock-key reconciliation
priority: 513.2
status: implemented
depends_on: [E5-T13a]
estimate: S
risk: medium
capstone: false
---

## Goal

Repair modifier and lock-key divergence before it reaches the guest. The browser's
`getModifierState()` and T11 LED feedback are the authorities used to reconcile missing or
stranded Control/Alt/Shift/Meta, CapsLock, and NumLock transitions without creating duplicate
events or an injection storm.

## Deliverables

- Per-event modifier reconciliation layered on the T12 keyboard bridge, with corrective
  transitions emitted before the event's own physical code.
- CapsLock/NumLock host-versus-guest LED reconciliation on focus gain and a bounded diagnostic
  counter for repaired divergence.
- Deterministic tests for both physical-state branches, rapid lock toggles, AltGr-shaped
  modifier input, and exact make/break frame sequences.

## Acceptance criteria

- [ ] For every modifier, a mismatch between the held ledger and
      `getModifierState()` produces exactly one corrective transition before the dependent
      key; an already matching state produces none.
- [ ] A host lock-state mismatch produces one lock down/up pair and updates the diagnostic
      counter; matching LED state and repeated observations produce no additional injection.
- [ ] A Ctrl visibility-loss branch re-presses Ctrl only when the supplied physical modifier
      state is true, while the false branch remains neutral; both branches pass exact sequence
      assertions.

## Adversarial verification

Toggle CapsLock and NumLock 50 times while feeding a slow-drain event sink, then replay the same
observations. The repair count and emitted frames must remain bounded and deterministic, with no
oscillation once host and guest state agree. Interleave Ctrl+AltRight and a missing modifier-up;
the resulting sequence must preserve the documented AltGr representation.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

Implementation commit `f352030` adds `createKeyboardReconciler` as a synchronous wrapper around
the T12b bridge. It repairs missing or stranded Control/Alt/Shift/Meta before the triggering
event, permits an explicit reconciliation break to precede a dependent key, and tracks bounded
repair statistics. CapsLock and NumLock compare host `getModifierState()` or an explicit host
snapshot with the latest T11 LED snapshot; each divergence emits one down/up pair and stays
suppressed until feedback catches up. The TypeScript/browser projections are byte-identical.

The frozen-head recording ran `npm run test:keyboard-reconciliation --prefix web`: 23 tests passed,
0 failed, including both modifier visibility branches, own-edge no-self-repair, stranded-modifier
release with a dependent key held, AltGr-shaped Control+AltRight ordering, exact CapsLock/NumLock
pairs, per-event lock observation, and 50 repeated stale LED observations with one repair. The
existing 38-test keyboard/protocol matrix also passed, along with syntax, projection identity,
and `git diff --check f352030^ f352030`.

Evidence: `evidence/e5-t13b/modifier-lock-reconciliation-2026-09-03.json`, SHA-256
`e7fbf43737f77f7de0fe97a0c5f2d666fd9d8a4b87ee132f7e84cb3b507eda19`.
