---
id: E2-T22
epic: 2
title: xterm.js to UART wiring — input path, control characters, resize story
priority: 222
status: pending
depends_on: [E2-T07, E2-T21]
estimate: M
capstone: false
---

## Goal
A real terminal in the page: xterm.js bidirectionally wired to the 16550 so the browser
guest console is byte-for-byte equivalent to the native CLI's pty — ^C interrupts, vi
draws correctly, paste works, and the terminal-size story is explicit rather than broken.

## Context
Output path: UART THR bytes → batched across a dispatch quantum → `term.write(bytes)`
(xterm.js handles VT100/xterm sequences natively — do not filter or translate; getty was
configured for vt100 in E2-T18, switch inittab to `xterm` term type and verify). Input
path: `term.onData(str)` → UTF-8 encode → UART RX FIFO respecting the 16-byte cap with
backpressure (queue in JS, drain as the guest reads — do NOT drop; the E2-T07 OE path is
for genuine overrun only). Control characters arrive as data — ^C = 0x03, ^Z = 0x1a,
^D = 0x04 — and become SIGINT/SIGTSTP/EOF via the kernel's n_tty line discipline; our job
is only faithful byte delivery (verify Enter sends `\r` (0x0d): kernel `icrnl` maps it —
sending `\n` breaks some programs). Bind common browser-conflicting keys via
`attachCustomKeyEventHandler` (let Ctrl+C pass through when there's a selection? decide,
document). Resize: a serial console has no out-of-band winsize; document the Level 2
story explicitly — fixed default 80x24 getty, `stty rows R cols C` printed as a hint (or
a one-click button that types it), with a note that a proper resize channel arrives with
virtio-console/ssh in later epics. Wire the xterm `fit` addon so the *rendered* terminal
matches the page, and surface its dims for the stty hint.

## Deliverables
- `web/terminal.ts`: xterm.js integration (onData → machine input, machine output →
  write), backpressure queue with a high-water metric, custom key handler policy.
- A "fix size" affordance that emits the correct `stty rows N cols M` for the current fit.
- Playwright tests: boot busybox in-page, type commands, assert echoed output; paste test;
  ^C test.

## Acceptance criteria
- [ ] In-browser busybox: `ls`, `vi /tmp/x` (insert, save, quit), `top -n 1` render
      correctly in xterm.js with TERM=xterm.
- [ ] ^C kills a running `yes` without killing the shell; ^Z suspends `vi` and `fg`
      resumes it (job control end-to-end, requires E2-T13's cttyhack).
- [ ] Pasting a 100 KB text into `cat > /tmp/f` then `wc -c /tmp/f` shows zero lost bytes.
- [ ] After the stty hint/button, `vi` uses the full terminal area at a non-80x24 size.
- [ ] Native CLI and browser produce identical guest-visible byte streams for a scripted
      input sequence (recorded via `--uart-tap` dump and diffed).

## Adversarial verification
Hostile typing: hold a key at OS autorepeat for 30 s during `top` refresh — dropped input
or garbled screen refutes backpressure. Paste 1 MB (beyond any reasonable FIFO) — bytes
must all arrive (slowly is fine); loss refutes. Unicode attack: type/paste `héllo wörld
日本語` into `cat`; UTF-8 must round-trip byte-exact (`wc -c` check). Timing attack: run
`yes` for 10 s — the page must stay responsive (xterm write batching working; a frozen
main thread refutes) and stopping with ^C must take effect within 1 s. Diff against
webvm.io/alpine.html behavior for ^C/^Z/paste as a reference point; unexplained worse
behavior on a listed criterion refutes. Verify the `--uart-tap` equivalence claim
mechanically, not by eyeball.

## Verification log
(empty)
