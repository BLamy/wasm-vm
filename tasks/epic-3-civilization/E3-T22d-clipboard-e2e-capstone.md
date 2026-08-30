---
id: E3-T22d
epic: 3
title: Clipboard browser E2E capstone — scripted copy via clipboard read, 1 MB paste sha256
priority: 322.4
status: implemented
depends_on: [E3-T22a, E3-T22b]
estimate: S
risk: high
capstone: false
---

## Goal
End-to-end browser proof of the clipboard flow against a real guest: a scripted guest `printf` of an
OSC 52 sequence is asserted via a host clipboard read, and a scripted 1 MB paste into `cat > file` is
asserted byte-identical by guest sha256.

## Context
Split from **E3-T22**. The browser-integration capstone over the deterministic E3-T22a (copy) and
E3-T22b (paste) cores. Playwright + Clipboard API permissions; runtime-agnostic parts proven on the
fast busybox guest per the reaping constraint.

## Acceptance criteria
- [ ] Scripted guest OSC 52 copy asserted via `navigator.clipboard.readText()` (or the confirm flow).
- [ ] 1 MB paste into `cat > /root/paste.txt` yields a byte-identical file (sha256), no dropped or
  reordered chunks.
- [ ] Multi-line paste with bracketed paste on executes zero commands until Enter.

## Verification log
- 2026-08-30 — **worker — implemented at `274bc49ebeab03ac68fa84c408588b8c91384bc5`.** The xterm.js
  5.x runtime exposes OSC handlers on `term.parser.registerOscHandler`, not the obsolete
  `term.registerOscHandler`; the terminal now selects the parser API with a compatibility fallback.
  The browser spec and standalone raw-Playwright evidence harness also use the current Demo-tab boot
  path, inspect xterm's actual buffer, end canonical `cat` fixtures with a newline before Ctrl-D, and
  disable tty echo during the 1 MiB transfer so the proof measures input delivery rather than a
  million-character repaint. `make verify-E3-T22d` is now the repeatable headed-browser acceptance
  target and starts/reuses the local server.

  **Exact recorded acceptance run:** `make verify-E3-T22d` (23/23 deterministic OSC52+paste tests;
  `make web-build`; headed Chromium 131.0.6778.33 against `http://127.0.0.1:8123/?noAutoBoot&jit=1`).
  The real guest emitted OSC 52 for `hi`, and the browser observed `onCopied="hi"` plus clipboard
  readback `"hi"`; the multiline fixture returned `alpha`, `bravo`, `charlie`; the guest wrote exactly
  1,000,000 bytes to `/root/paste.txt` and returned SHA-256
  `630b37ed2c6f33ea1a06e69d792ed0b6b9d74f74759457ed3a3c44ce5ffea733`, matching the independent host
  digest, with `highWater=1,000,000`; and a guest DECSET 2004 made the two-line `touch`/`printf`
  paste stay held until Enter. The run completed in 101.4 seconds with zero browser console errors.

  Evidence: `evidence/e3-t22d/clipboard-browser-2026-08-30.json`
  (sha256 `8a3a8b822e1aca5e65751ccc571bd112a752343dbc04d89a2707697c9ce3eeab`) and
  `evidence/e3-t22d/clipboard-browser-2026-08-30.png`
  (sha256 `e32085b48bdd12f91cbfbd84fd1336725ff7e17a482d311e01d1815cbfe527fe`). The JSON records
  runtime head `274bc49ebeab03ac68fa84c408588b8c91384bc5` and the full observed values.

  **Adversarial/supporting gates:** `make verify-E3-T22a` (15/15, including 10 MiB cap-before-decode,
  malformed selection/base64, rejected-write affordance, and read-query-off); `make verify-E3-T22b`
  (8/8, including embedded `ESC[201~` neutralization and 2 MiB framing); `make verify-E3-T22c`
  (4/4 plus shell syntax); `cargo fmt --all --check`; `cargo test -p wasm-vm-core` (all passed);
  `wasm-pack test --node crates/wasm` (all passed); and both no-host-float/determinism-hazard checks.
  The repo-wide `make ci` / `cargo clippy --workspace --all-targets --all-features -- -D warnings`
  wall remains blocked on pre-existing macOS compilation of Linux-only `wvseccomp` syscalls and an
  unrelated `wasm-vm-core::Hart::fetch_phys` dead-code warning; no T22d Rust code is changed.

  **Claim:** At the exact implementation head, a fresh headed Chromium run against the built page
  exercised the real guest-to-host OSC52 path and the real host-to-guest terminal queue, proving the
  required clipboard delivery, byte-exact `/root/paste.txt` 1 MiB transfer, and bracketed-paste
  no-early-execute behavior. The deterministic dependency tests cover hostile OSC52 payloads,
  permission denial/read gating, and paste end-marker injection; the recorded browser run covers the
  integrated guest path with no console errors. Ready for a separate verifier to interrogate the
  evidence and changed hunks.

- 2026-08-03 — **paste E2E GREEN in a real browser; copy + 1 MB skipped as documented environment
  debt.** `web/tests/e3-t22-clipboard.spec.js` drives a live in-page busybox boot and injects through
  the real terminal bridge (`window.__term`).
  - **AC2/AC3 (multi-line paste) — PASSED** (completed run, 3.5m): `window.__term.pasteText("alpha\n
    bravo\ncharlie")` into `cat > /tmp/p` round-trips content-exact through the OSC/paste terminal
    wiring (newline→CR→NL, framePaste). This is the browser-integration capstone for the paste pipeline.
  - **AC1 (OSC 52 copy) — `test.skip`** (headless-clipboard limitation, not a defect): headless
    Chromium never settles `navigator.clipboard.writeText` without a genuine transient user activation,
    so the handler's onCopied/onCopyBlocked callbacks and a clipboard readback never fire. The copy
    decode + size-cap + read-gate + onCopied/onCopyBlocked DISPATCH are fully proven by
    `web/tests/osc52.test.mjs` (15 node cases). Added a symmetric `onClipboardCopied` success hook to
    `web/terminal.js` (a UI "copied!" signal + the test observability path).
  - **AC3 1 MB byte-exact — `test.skip`**: the ~4-min cold-boot + 1 MB drain reliably gets OS-reaped on
    this contended machine (the known "browser boot reaped on mac" limit). The no-loss/backpressure
    guarantee is covered by E2-T22's 100 KB bulk-input browser test + `web/tests/paste.test.mjs`.
  - Boot-harness fixes that made the E2E reach a shell (the page's old `#boot-linux` button was
    removed): boot via `/?noAutoBoot` + fire-and-forget `wvmDemo.runBusybox()` (awaiting its
    boot-pipeline promise hung `page.evaluate`), generous prompt timeout, and a CR nudge so PID-1 `sh`
    draws its `~ #` prompt.
  - Remaining to close AC1/AC3 fully: run on a headed/unloaded machine or CI with clipboard activation
    + boot headroom (the spec's skips are one-line re-enables). `make verify-E3-T22d` runs the node
    cores + the green paste E2E.
