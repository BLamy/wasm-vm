---
id: E3-T23
epic: 3
title: Terminal polish - SIGWINCH resize, truecolor, scrollback, font
priority: 323
status: pending
depends_on: [E3-T22]
estimate: M
capstone: false
---

## Goal
The terminal stops feeling like a serial console: resizing the browser window resizes the
guest tty (programs get SIGWINCH and redraw), 256-color and truecolor output render
correctly with a proper TERM/terminfo setup, scrollback works without fighting fullscreen
apps, and a deliberate monospace webfont renders box-drawing and powerline glyphs cleanly.

## Context
Resize is the subtle one: our console is a serial tty (hvc/ttyS0), and the kernel cannot
learn a serial line's window size by itself — someone must issue TIOCSWINSZ on the guest
side. Mechanism: xterm.js `FitAddon` recomputes cols/rows on window resize; propagate to the
guest via the agent from T21 (`vm-resize <cols> <rows>` calling TIOCSWINSZ on the login tty,
which makes the kernel deliver SIGWINCH) — with a login-profile fallback using the
`resize`-via-CSI-cursor-report trick (util-linux `resize` or a shell function doing
`ESC[999;999H` + DSR) for pre-agent sessions; document which path is primary. Colors:
ship terminfo for `xterm-256color` in the image (ncurses-terminfo-base), set TERM in the
getty/profile, and verify xterm.js truecolor passthrough; do not claim truecolor via TERM
alone — set `COLORTERM=truecolor` and check apps like vim's `termguicolors` actually probe
correctly. Scrollback: xterm.js `scrollback` to 10000 lines; verify alternate-screen apps
(vim, less, top) don't pollute scrollback and mouse-wheel scrolls history in the primary
screen but sends arrow/scroll events in alt-screen apps that request mouse. Font: pick and
self-host (no third-party CDN — see T26 CSP) a font with solid box-drawing/powerline
coverage (JetBrains Mono or Iosevka Term); test glyph metrics so `htop`'s borders align.

## Deliverables
- Resize pipeline: FitAddon → agent `vm-resize` (+ documented fallback), debounced.
- Image additions via T11: terminfo package, TERM/COLORTERM in profile, `resize` fallback
  hook.
- xterm.js config: scrollback 10k, self-hosted font with `@font-face`, cell-metrics
  verification, theme with legible ANSI palette.
- E2E tests: resize during `top` (guest reports new size via `stty size`), truecolor test
  script (24-bit gradient) screenshot-compared, scrollback behavior in and out of
  alt-screen.

## Acceptance criteria
- [ ] Resize the browser window while `vim` is open: vim redraws to the new size without
      `:redraw!`; `stty size` reflects xterm.js cols/rows within 500 ms of resize end.
- [ ] `tput colors` prints 256; a 24-bit color gradient script renders a smooth gradient
      (screenshot artifact attached to the log); `htop` borders are gapless with the
      shipped font.
- [ ] After `less /etc/services` → quit, scrollback shows pre-`less` history, not pager
      contents; mouse wheel scrolls history at the prompt.
- [ ] 10000-line scrollback holds: `seq 1 20000` then scroll to top shows line 10001-ish,
      terminal stays responsive.
- [ ] All terminal assets (font, css) load from the app origin — zero third-party requests
      (network tab assertion, feeds T26).

## Adversarial verification
Resize violently: drag-resize continuously for 10 s during `top` — a wedged tty, garbled
frame, or SIGWINCH storm that starves the guest refutes. Set a 20×5 tiny window and a
300-col ultrawide; run `vim` in both. Kill the agent process in the guest and resize —
the fallback (or a documented degradation) must hold; a silently stale size with no
documented behavior refutes. `cat /dev/urandom` for 5 s: terminal must recover with `reset`.
Compare `htop`, `mc`-style box drawing across Chrome/Firefox for font-metric seams. Paste
the truecolor gradient under load (during `apk add`) and check no interleaved corruption
between console writes and network activity.

## Verification log
(empty)
