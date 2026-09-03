---
id: E5-T12c
epic: 5
title: keyboard capture policy and browser getty proof
priority: 512.3
status: implemented
depends_on: [E5-T12b]
estimate: S
risk: medium
capstone: false
---

## Goal

Finish the browser-facing keyboard path with an explicit capture toggle and preventDefault policy,
document passthrough and uncapturable chords, and prove that real browser key events reach the
booted guest getty.

## Deliverables

- Capture-on/off state and visible indicator paired with the T08 host chrome; captured events are
  prevented except the reserved view-toggle chord and configured passthrough list.
- `docs/input.md` describing captured, passed-through, and browser/OS-uncapturable chords,
  including Ctrl+W/T/N, Cmd+Q/Tab, and F11 caveats.
- A single Playwright browser proof that drives the built page, types a shell command through the
  guest getty, checks the serial result, and records zero unexpected console errors.

## Acceptance criteria

- [ ] Capture-on typing `ls -la | grep 'x' && echo "hi~"` reaches the guest and executes with
      correct shift, quote, pipe, and tilde behavior.
- [ ] Capture-off canvas keystrokes do not call preventDefault and remain available to the browser;
      captured mode prevents ordinary canvas key defaults while preserving the documented chord.
- [ ] The browser proof also covers Ctrl+C interrupt ordering and reports the capture state in the
      UI; all intended changes are exercised by the recorded run.

## Adversarial verification

Attack capture ordering with rapid chords and the T08 reserved chord, open browser quick-find in a
captured Firefox-like fixture, and try Ctrl+W/T/N, Cmd+Q/Tab, and F11. Verify the documented
passthrough/uncapturable behavior rather than silently promising impossible interception.

## Verification log

### 2026-09-03 — worker — IMPLEMENTED

Implementation commit `fbdfc53` adds the visible capture-on/off indicator and toggle to the T08
terminal chrome, a deterministic physical-code capture policy, and the direct Chromium proof
harness. Captured ordinary events are forwarded through the T11/T12b evdev bridge; the live xterm
textarea retains its printable-letter/Space conversion so the serial getty remains byte-exact.
Reserved `Ctrl+Alt+Backquote` is consumed before guest forwarding, while `Ctrl+W/T/N`, `Cmd+Q/Tab`,
and `F11` remain browser-owned. Capture-off releases held guest keys and leaves browser defaults
available. `docs/input.md` records the browser/OS limitations, including Firefox-style quick-find
and chords that cannot be intercepted before page dispatch.

The exact-head browser recording used one built-page Chromium load from `node
tools/verify/e5-t12c-browser-proof.mjs`. It booted the guest getty, typed
`ls -la | grep 'x' && echo "hi~"` through the focused browser keyboard and observed `hi~`, then
interrupted `cat` with `Ctrl+C` and observed `E5_T12C_CTRL_C_42`. It observed capture-off `F1`
with `defaultPrevented=false`, captured `F2` with `defaultPrevented=true`, the visible
`Keyboard: captured`/`Capture: on` state, one reserved view-toggle notification, no additional
guest frames from that chord, and an empty held-key set. The recording reported zero unexpected
console errors, page errors, or failed requests (the favicon 404 was ignored as permitted).

Deterministic `npm run test:keyboard --prefix web` passed all 38 tests, including rapid modifier
ordering, browser-owned shortcuts, Firefox-style Slash, IME, synthetic reserved-chord cleanup,
and the inherited keyboard/worker protocol matrix. `make web-dist`, JavaScript syntax checks,
byte-identical TypeScript/JavaScript projection checks, and `git diff --check` also passed.

Evidence: `evidence/e5-t12c/keyboard-capture-2026-09-03.json`, SHA-256
`82d4f9bbb92f553e6d91fce7b85d132a6148875513a16b022f634e235abf36bb`; screenshot
`evidence/e5-t12c/keyboard-capture-2026-09-03.png`, SHA-256
`b76aa73eb420afc9ddcae8f982fed5e2d18f250954da73e95fd21afe7c5ab1c6`.
