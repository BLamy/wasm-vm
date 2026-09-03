---
id: E5-T12b
epic: 5
title: DOM keyboard event normalization and evdev bridge
priority: 512.2
status: pending
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

(empty)
