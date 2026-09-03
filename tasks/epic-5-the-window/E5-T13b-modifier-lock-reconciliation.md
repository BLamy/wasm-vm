---
id: E5-T13b
epic: 5
title: modifier and lock-key reconciliation
priority: 513.2
status: in-progress
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

(empty)
