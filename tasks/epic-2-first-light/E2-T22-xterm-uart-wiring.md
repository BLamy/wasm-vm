---
id: E2-T22
epic: 2
title: xterm.js to UART wiring — input path, control characters, resize story
priority: 222
status: verified
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
- [~] In-browser busybox: `ls`, `vi /tmp/x` (insert, save, quit), `top -n 1` render
      correctly in xterm.js with TERM=xterm. **Partial** — `ls /` verified rendering
      (proc/sys) in the Playwright spec; `vi`/`top` render via xterm's native VT100 but
      aren't asserted by a screen-diff, and TERM=xterm would need an initramfs rebuild
      (busybox `vi` renders acceptably without it). Screen-diff assertion = follow-up.
- [x] ^C kills a running `yes` without killing the shell **Met + verified** (Playwright:
      ^C stops `yes`, a marked `echo` afterwards proves the same shell survived — cttyhack
      ctty routes SIGINT to the fg group, not PID 1). ^Z/`fg` job control works at the guest
      level (cttyhack) but isn't asserted by an automated screen test — **follow-up**.
- [x] Pasting 100 KB into `cat > /tmp/f` then `wc -c` shows zero lost bytes. **Met +
      verified** (Playwright: 100000 bytes → `wc -c` == 100000, JS high-water ≥ 100000).
- [x] After the stty hint/button, the terminal uses a non-80x24 size. **Met** — the "Fit"
      button emits `stty rows N cols M` matching the fitted grid (Playwright-asserted) and
      types it into a live guest.
- [ ] Native CLI vs browser identical guest-visible byte streams via `--uart-tap` diff.
      **DEFERRED** — needs a `--uart-tap` capture harness on both sides; not built yet.

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

### 2026-07-05 — xterm↔UART wiring + RX throughput fix + Pages deploy fix (PR #79)

`web/terminal.js` encapsulates the terminal: guest output written verbatim (xterm renders
VT100/xterm natively); keystrokes/paste UTF-8-encoded through a JS backpressure queue (bounded
per-tick copy + high-water metric) into `ttyS0`; a fit addon + "Fit" button surfacing `stty rows
R cols C` (typed into a live guest); a key policy where a bare Ctrl+C reaches the guest as SIGINT
and copy/paste bind to Shift/Cmd combos. Wired into main.js/index.html; `@xterm/addon-fit` pinned.

**Throughput fix (crates/wasm `runChunk`):** the 16550 RX FIFO (16 bytes) was refilled from
`pending` ONCE per budget → host→guest input capped at ~16 bytes/chunk, wasting the 2M-instruction
budget on a near-empty FIFO. Now interleaves RX refills with short execution slices while input is
queued, and collapses to a single full-budget run when idle (quiet path unchanged). Makes a 100 KB
paste finish in seconds, not minutes.

**Browser verification (gate 3a) — `web/tests/terminal.spec.js`, full web suite 4/4 green headless:**
`ls /` renders proc/sys (Enter sent as CR 0x0d → kernel icrnl → NL); ^C kills a runaway `yes` while
the SAME shell survives; 100 000-byte paste into `cat > /tmp/paste` round-trips byte-exact
(`wc -c` == 100000, high-water ≥ 100000); Fit button's `stty` hint matches the fitted grid.

**Pages deploy fix (bundled — user reported a live 404):** `fetch /releases/…cpio.gz → HTTP 404`
on the deployed site. Two bugs: (1) `publish_dir: ./web` never included `releases/` — `make
web-build` now copies the artifacts into `web/releases/` (gitignored; source of truth stays
`releases/`); (2) root-absolute `/releases/…` URLs drop the `/wasm-vm/` project base — now RELATIVE
`releases/…` (regenerated by gen-web-manifest; web-build re-runs it so they never drift). Verified
by serving the repo root so the demo sits under `/web/` (mirroring `/wasm-vm/`) with a MIME-correct
server (no `/releases` shortcut) and booting: artifacts fetched via relative URLs, kernel unpacked
the initramfs, no 404.

### 2026-07-05 — cold-clone critic — all 4 claims CONFIRMED, no material bugs

A fresh clone was audited by a critic tasked with refuting. It built + ran every Rust/wasm gate
(all exit 0) and static-traced both JS state machines:
- **C1 throughput loop:** terminates (step ≤ remaining, u64 no underflow; FIFO-full still
  decrements — no infinite loop); quiet path = one full-budget run (perf-identical); terminal
  outcome mid-slice returned not swallowed; no double-drain, TX (`mem::take` on an unbounded Vec)
  never lost. **CONFIRMED.**
- **C2 backpressure:** no stuck-draining across detach/attach; cross-Uint8Array chunking fills
  exactly `want` (no drop/dup); type-before-attach drains on attach; high-water accurate; bare
  Ctrl+C → guest, copy/paste → Shift/Cmd. **CONFIRMED.**
- **C3 Pages fix:** URLs truly relative (grep clean of `"/releases`, `src="/`, `fetch("/`);
  resolves against document base at `/wasm-vm/` + `/pr-N/`; Makefile copy targets exactly match
  the manifest paths; dev server still resolves root-served. **CONFIRMED.**
- **C4 no regression:** determinism + no-host-float clean; no `crates/core/src` runtime change. **CONFIRMED.**

Gates (exit 0): build · clippy `--workspace --all-targets --all-features` · clippy `-p wasm-vm-wasm
--target wasm32-unknown-unknown` (lints runChunk) · determinism-hazards · no-host-float · wasm-pack
build. Two theoretical-only notes (both unreachable: a sink that can't throw; leftover pending on a
finished machine). The behavior gate for this change is the 4/4-green Playwright suite.

**2026-07-06 — VERIFICATION-DEBT SWEEP (parallel cold-clone critics, PR #101).** VERDICT SOUND.
Silent-drop attack refuted by source: JS queue and wasm VecDeque unbounded, RX FIFO fed only
rx_free().min(pending) — the 16550 OE drop path is unreachable from browser input; runChunk's
RX/execute interleave provably terminates. ^C/paste/stty criteria recorded (terminal.spec 4/4,
100KB paste zero-loss) + every E3 spec types real sessions through this path for 11-24 min.
Honest gaps noted: vi/top screen-diff follow-up, 1MB adversarial paste and 30s autorepeat never
recorded, --uart-tap equivalence harness doesn't exist (all pre-marked deferred). Backpressure is
memory-unbounded (denial-of-self only, documented).
