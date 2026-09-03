---
id: E5-T12c
epic: 5
title: keyboard capture policy and browser getty proof
priority: 512.3
status: in-progress
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

(empty)
