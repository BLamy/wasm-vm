---
id: E3-T22
epic: 3
title: Clipboard integration - OSC 52 copy, paste injection, bracketed paste
priority: 322
status: pending
depends_on: [E2]
estimate: M
capstone: false
---

## Goal
Real clipboard flow between guest and host: guest programs emitting OSC 52 sequences set the
host clipboard; host paste (Ctrl+Shift+V / context menu) injects into the guest tty with
bracketed-paste framing when the guest has enabled it; vim/tmux clipboard workflows in the
guest behave like a native terminal.

## Context
Copy path: xterm.js doesn't handle OSC 52 writes to the system clipboard by itself —
register a handler (`registerOscHandler(52, …)`) that base64-decodes the payload
(`52;c;<base64>`) and calls `navigator.clipboard.writeText()`. That API needs a secure
context and can require transient user activation depending on browser/permission state —
handle rejection by queueing the payload behind a "copied — click to confirm" affordance,
never dropping silently; cap payload size (100 KB) against hostile guests. Support the
query form (`52;c;?`) *only* behind an explicit permission toggle, default off — guest
reads of the host clipboard are an exfiltration channel. Paste path: intercept the paste
event, and if the guest enabled bracketed paste (DECSET 2004 — xterm.js tracks this) wrap
in `ESC[200~ … ESC[201~`; normalize newlines to CR; chunk large pastes so the UART/tty ring
(Epic 2) doesn't drop bytes. Verify xterm.js default mouse-selection copy also works.

## Deliverables
- OSC 52 handler (copy + gated query) with size cap, permission-failure UX, and the
  read-permission toggle default-off.
- Paste pipeline: bracketed-paste framing keyed off mode 2004 state, newline
  normalization, chunked injection with backpressure against the tty buffer.
- Guest conveniences in the image (T11 coordination): vim config with
  `clipboard=unnamedplus`-equivalent OSC52 provider or a `yank`-to-OSC52 helper, tmux
  `set -s set-clipboard on`.
- Browser E2E tests: scripted copy from guest (`printf` the OSC sequence) asserted via
  clipboard read; scripted paste of a 1 MB text into `cat > file` asserted by guest sha256.

## Acceptance criteria
- [ ] `printf '\033]52;c;%s\a' "$(printf hi | base64)"` in the guest puts `hi` on the host
      clipboard (or triggers the one-click confirm flow, which then does).
- [ ] In guest vim (image defaults), yanking a line makes it pasteable in a host text
      field; pasting host text into insert-mode vim inserts it verbatim — including text
      containing `ESC[201~`-looking content pasted *outside* bracketed mode not executing
      as if typed (see verification).
- [ ] 1 MB paste into `cat > /root/paste.txt` yields a byte-identical file (sha256), no
      dropped or reordered chunks.
- [ ] Guest clipboard *query* (`52;c;?`) returns nothing while the toggle is off; returns
      clipboard contents when explicitly enabled.
- [ ] Multi-line paste into a shell with bracketed paste on executes zero commands until
      Enter; with a bracketed-paste-off guest (mode 2004 unset) the documented fallback
      behavior applies.

## Adversarial verification
Treat the guest as hostile. Emit a 10 MB OSC 52 payload — cap must hold, terminal must stay
responsive. Emit malformed base64 and unterminated OSC sequences — parser hangs refute.
Paste hostile content: text containing `\x1b[201~` (bracket-escape injection — the classic
paste-injection CVE class) must not terminate bracketing early in a way that lets the
remainder execute; verify the implementation strips/escapes embedded end-markers. Race:
paste while the guest rapidly toggles mode 2004. Attempt clipboard read from the guest with
the toggle off via both the query form and timing tricks — any leak refutes. Confirm the
permission-denied path (deny clipboard permission at the browser level) shows the fallback
affordance and never throws unhandled.

## Verification log
(empty)
