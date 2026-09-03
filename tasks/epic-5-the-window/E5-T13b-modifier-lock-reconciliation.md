---
id: E5-T13b
epic: 5
title: modifier and lock-key reconciliation
priority: 513.2
status: verified
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

### 2026-09-03 — verifier — VERDICT: verified (user-directed)

- **Modifier state — HELD.** Predicted a missing modifier would be repaired before a dependent
  event and a stranded modifier would be released before the next event; the exact fixtures
  observe Control down before `KeyA`, Control up before `KeyA` break, and the forced-release path
  preserves a still-held `KeyA` without deferring the corrective break.
- **Own edges and AltGr — HELD.** Predicted a modifier's own make/break would not self-repair and
  Windows-style Control+AltRight would produce two bounded prefixes; the 23-test run observes no
  extra Shift frames and the exact `29, 56, 16` sequence.
- **LED reconciliation — HELD.** Predicted each CapsLock/NumLock divergence would emit exactly one
  down/up pair and remain quiet until T11 feedback agrees; the run observes codes 58/69 as exact
  pairs, pending repair clearing after the LED snapshot catches up, and one repair for 50 repeated
  stale observations. A separate 1,000-observation stale-LED attack also observes two CapsLock
  events and one repair.
- **Coverage and integrity — HELD.** Recomputed evidence SHA-256
  `e7fbf43737f77f7de0fe97a0c5f2d666fd9d8a4b87ee132f7e84cb3b507eda19`, matched the recorded
  implementation head `f352030`, reran the 23-test reconciliation command, the inherited 38-test
  keyboard/protocol matrix, syntax checks, projection identity, and `git diff --check`. Every
  changed runtime/test/package hunk is exercised or is the required source projection; no
  browser, WebKit, or independent-machine run is applicable to this deterministic layer.
- **SUITE — HELD.** The exact-head JSON evidence, deterministic reconciliation/bridge tests, and
  bounded stale-LED attack are retained as permanent proof artifacts.

Commands: `npm run test:keyboard-reconciliation --prefix web`; `npm run test:keyboard --prefix
web`; `node --check web/src/input/reconciliation.js`; `cmp -s web/src/input/reconciliation.ts
web/src/input/reconciliation.js`; `git diff --check f352030^ f352030`; 1,000-observation stale-
LED attack via `node --input-type=module`.
