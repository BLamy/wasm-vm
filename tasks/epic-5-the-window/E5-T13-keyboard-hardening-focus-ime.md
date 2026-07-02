---
id: E5-T13
epic: 5
title: Keyboard hardening — focus loss, stuck modifiers, lock-key reconciliation
priority: 513
status: pending
depends_on: [E5-T12]
estimate: M
capstone: false
---

## Goal
The keyboard is unbreakable by window management: focus loss releases every held key,
OS-swallowed shortcuts can't strand a modifier down in the guest, CapsLock state
divergence is detected and reconciled, and a panic "release all keys" control exists —
eliminating the classic emulator failure where Alt-Tab leaves Alt stuck forever.

## Context
The browser doesn't promise a keyup for every keydown: Cmd+Tab/Alt+Tab deliver the
modifier down then steal focus; media keys and OS shortcuts vanish mid-chord; dead-key
sequences on some layouts skip events. Mechanisms: (1) host-side held-key set (source of
truth for what the guest believes is down); (2) on `blur`, `visibilitychange→hidden`,
pointer-lock loss, and view toggle (T08): inject key-up for every held key + SYN;
(3) modifier resync — on every keydown/keyup, compare `event.getModifierState()` for
Control/Alt/Shift/Meta against the held set and inject corrective up/down before the
event's own code; (4) lock keys — CapsLock is stateful on the host but a plain key to
the guest; track guest LED state (T11 statusq) vs `getModifierState('CapsLock')` and on
divergence inject a CapsLock down/up pair (policy: host wins on focus gain, documented).

## Deliverables
- `web/src/input/held-keys.ts`: held-key set with release-all, unit-tested in isolation.
- Blur/visibility/lock-loss/view-toggle hooks wired to release-all.
- Per-event modifier reconciliation from `getModifierState`.
- CapsLock/NumLock reconciliation using T11 LED feedback; divergence counter in stats.
- UI "release all keys" button + stats: currently-held list visible in a debug panel.
- Playwright tests simulating focus theft mid-chord.

## Acceptance criteria
- [ ] Hold Alt, click outside the canvas (blur): guest evtest shows ALT up within one
      frame; debug panel shows zero held keys.
- [ ] Alt+Tab away and back (Playwright window juggling or manual protocol documented):
      typing afterwards produces unmodified letters — no phantom Alt (checked via guest
      `showkey -s` or evtest scripted assertion).
- [ ] Host CapsLock toggled while unfocused, then refocus and type: guest case matches
      host LED expectation within one reconciliation event.
- [ ] Ctrl held while `visibilitychange` fires → Ctrl re-pressed on return only if
      physically still down (getModifierState true) — both branches tested.
- [ ] 500-iteration fuzz (random focus flaps interleaved with chords) ends with held-set
      empty and guest modifier state neutral.

## Adversarial verification
Your mission: strand a key. Attack windows: switch OS apps mid-chord, use browser
menus, open devtools, trigger a JS alert() during a held chord, drag-select outside the
canvas starting from inside. After each, type `a` at the guest getty — anything but a
lone lowercase 'a' (unless host CapsLock is genuinely on) refutes. Attack reconciliation
loops: toggle CapsLock rapidly 50x while the guest is under load (slow drain) — prove no
oscillating injection storm (injection count bounded, panel stable). Attack the panic
button during a genuinely held physical key — next physical keyup must not underflow the
held set (inject up for a non-held key must be a no-op). Kill the VM worker and restart
(E4 machinery): held-set must reset with it.

## Verification log
(empty)
