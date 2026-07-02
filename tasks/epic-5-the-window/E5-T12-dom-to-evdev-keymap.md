---
id: E5-T12
epic: 5
title: DOM KeyboardEvent.code → evdev translation with capture policy
priority: 512
status: pending
depends_on: [E5-T11]
estimate: M
capstone: false
---

## Goal
Real keystrokes flow: a translation layer maps `KeyboardEvent.code` (physical key
identity) to evdev codes for the T11 keyboard, tracks modifier state, suppresses browser
autorepeat, and enforces an explicit preventDefault/capture policy — so typing in the
canvas types in the guest, layout handled by the guest's own keymap.

## Context
`event.code` is the *physical* key ("KeyA", "Backquote"), which is exactly what an evdev
scancode is — layout (QWERTZ, dvorak, AltGr composition) is the guest's job via its
loaded keymap, same as real hardware. The table is ~120 entries: "KeyA"→KEY_A(30),
"Digit1"→KEY_1(2), "Backquote"→KEY_GRAVE(41), "IntlBackslash"→KEY_102ND(86),
"AltRight"→KEY_RIGHTALT(100) (AltGr is just right-alt at this layer),
"MetaLeft"→KEY_LEFTMETA(125), "NumpadEnter"→KEY_KPENTER(96), etc. — generated from a
checked-in data table, not hand-written match arms. Browser repeat: forward only
`!event.repeat` downs (T11 decided guest-side repeat). Dead keys arrive as their
physical key with `event.key == "Dead"` — irrelevant, we map by code. IME: while
`event.isComposing`/keydown `keyCode 229`, forward nothing (policy: IME unsupported in
captured mode v1, documented). preventDefault policy: when capture is on, preventDefault
everything reaching the canvas *except* the T08 reserved chord and a configurable
browser-passthrough list; document what is uncapturable (Ctrl+W/T/N in Chrome unless
PWA/kiosk, Cmd+Q/Tab on macOS, F11) in `docs/input.md`.

## Deliverables
- `web/src/input/keymap.ts`: data table (code string → evdev u16) with a generator test
  asserting bijectivity where expected and full W3C `code` value coverage for PC-105.
- `web/src/input/keyboard.ts`: keydown/keyup handlers on the canvas host element →
  `inject_event` calls; repeat suppression; isComposing guard; capture on/off state
  with visible indicator (pairs with T08 UI).
- preventDefault policy implementation + passthrough config; `docs/input.md` section
  listing captured, passthrough, and uncapturable chords per browser/OS.
- Playwright test driving `page.keyboard` against the fbcon getty: types a command,
  asserts serial-side execution.

## Acceptance criteria
- [ ] Typing `ls -la | grep 'x' && echo "hi~"` at a guest getty (via Playwright real key
      events, US layout) executes correctly — covers shift pairs, quotes, pipe, tilde.
- [ ] With guest keymap set to `de` (loadkeys), pressing physical KeyY produces guest
      'z' — proving layout lives guest-side.
- [ ] Held key: exactly one evdev down forwarded despite N DOM repeat events; guest
      shows repeated chars only if its own repeat is configured (fbcon: no repeat).
- [ ] Ctrl+C at a running `cat` interrupts it (modifier+key ordering correct); the T08
      reserved chord still toggles views and never reaches evtest.
- [ ] Capture-off mode: canvas keystrokes reach the browser normally (no preventDefault).

## Adversarial verification
Attack ordering and state: script rapid interleaved chords (Shift down, A down, Shift
up, A up; Ctrl+Shift+T with passthrough off) via Playwright and diff the guest-side
evtest stream against the expected sequence — any reorder or loss refutes. Attack the
table: property-test that every `KeyboardEvent.code` the browser can emit for a PC-105
keyboard (fixture list from the W3C UI Events code spec) maps or is explicitly listed
unmapped; an unmapped mainstream key (e.g. "ContextMenu") refutes. AltGr on Windows
Chrome emits Ctrl+AltRight — verify the doc's stated handling matches behavior. Try
NumLock-dependent Numpad codes both states. Any browser-default action firing while
captured (e.g. `/` opening quick-find in Firefox) refutes the preventDefault policy.

## Verification log
(empty)
