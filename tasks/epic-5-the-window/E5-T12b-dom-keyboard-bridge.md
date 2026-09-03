---
id: E5-T12b
epic: 5
title: DOM keyboard event normalization and evdev bridge
priority: 512.2
status: implemented
depends_on: [E5-T12a]
estimate: S
risk: medium
capstone: false
---

## Goal

Translate normalized DOM keydown/keyup events into framed T11 evdev events through the
`WasmLinux` keyboard bridge. Track modifiers and held keys, suppress browser autorepeat and IME
events according to the written v1 policy, and preserve make/break ordering.

## Deliverables

- `web/src/input/keyboard.ts`: event normalization, modifier/held-key state, keydown/keyup
  translation, `event.repeat` suppression, and `isComposing`/keyCode-229 guard.
- The host adapter that calls `sendKeyboardEvent` and `syncKeyboard` for each coherent frame,
  including release ordering for modifier chords.
- Deterministic unit fixtures for shifted punctuation, AltGr's right-alt representation, rapid
  interleaved chords, repeat events, and IME/dead-key policy.

## Acceptance criteria

- [ ] A physical `KeyA` down/up produces exactly one KEY_A make frame and one break frame, each
      terminated by SYN_REPORT; DOM repeat keydowns add no frames.
- [ ] Shift/Ctrl/Alt/Meta modifiers are emitted before the dependent key and released after it;
      `Ctrl+C` and shifted punctuation have the expected evdev sequence.
- [ ] Composing events and keyCode 229 produce no guest events, while a dead key still maps by its
      physical `code` when not composing.

## Adversarial verification

Feed rapid `ShiftLeft` down, `KeyA` down, `ShiftLeft` up, `KeyA` up and a held key with 100 repeat
callbacks; assert exact sequence and no duplicate down. Feed Windows-style Ctrl+AltRight AltGr
ordering and verify the documented representation. Inject an unmapped code and require an explicit
diagnostic/no-op rather than an arbitrary evdev code.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

Implementation commit `baf1d20` adds the JavaScript-compatible TypeScript keyboard bridge and
its no-bundler projection, plus the direct/whole-machine-worker WasmLinux adapter. Each accepted
physical key transition calls `sendKeyboardEvent(EV_KEY, evdev, value)` and then `syncKeyboard`.
The bridge tracks physical held keys, suppresses DOM repeat and IME/keyCode-229 events, maps dead
keys by `code`, reports unmapped/orphan events as diagnostics, and defers modifier breaks until
dependent keys have broken. The loader controller and versioned worker allow-list now expose both
keyboard methods; the protocol fixture asserts FIFO send-before-sync ordering.

The frozen-head recording ran the 35-test direct Node matrix covering KeyA make/break, 100 repeat
callbacks, rapid Shift/A release ordering, Ctrl+C, shifted punctuation, Windows Ctrl+AltRight
AltGr, IME/dead-key handling, unmapped/orphan diagnostics, adapter calls, listener lifecycle, and
the inherited T12a table. `npm run test:keyboard --prefix web` ran the 30 keyboard/protocol tests.
Both passed with zero failures; `node --check` on the changed browser modules, `git diff --check`,
and `cargo check -p wasm-vm-wasm` also passed. Output SHA-256 is
`0fbd11d2e8fbf5b6c31236aecd336c329882e03faed2a7a86608c926c7f9db31`.

Evidence: `evidence/e5-t12b/keyboard-bridge-2026-09-03.json`, including the exact frame
sequences and changed-file digests. Browser capture/preventDefault wiring and the getty proof
remain owned by E5-T12c.
