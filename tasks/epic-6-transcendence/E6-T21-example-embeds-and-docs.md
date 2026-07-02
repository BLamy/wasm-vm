---
id: E6-T21
epic: 6
title: Example embeds and SDK docs — terminal widget and the almostnode IDE front-end
priority: 621
status: pending
depends_on: [E6-T19, E6-T20]
estimate: M
capstone: false
---

## Goal
Two working, documented example embeds prove the SDK from the outside: a minimal
single-file terminal widget, and the almostnode web-IDE rewired as a front-end to a real
machine — its editor, run button, and output panel driven by the SDK instead of API
shims — plus generated API reference docs and Playwright coverage for both.

## Context
The ROADMAP names this moment: almostnode (`~/Dev/almostnode`) built Node-API shims, a
virtual FS, and web IDEs as *emulation-of-APIs*; wasm-vm is *emulation-of-hardware*, and
its IDE becomes a candidate front-end. Example A is the adoption test: one HTML file, a
CDN ESM import, xterm.js wired to `vm.serial`, ~30 lines a stranger can copy. Example B
is the integration test: the IDE's file tree and editor buffers sync into the guest via
`vm.files` over the 9p embed share; "Run" writes the buffer, executes it in the guest
(via a serial exec channel or a small guest agent invoked over serial with output
framing), and streams stdout/stderr into the IDE's output panel with exit-code surfacing.
Example B must use only public SDK API — no reaching into runner internals; any missing
capability it exposes becomes an SDK issue filed and either fixed here or documented as
a limitation. Docs: typedoc-generated API reference from the SDK's types, plus a written
"embedding guide" walking both examples, including the COOP/COEP decision table from
E6-T19 and the security recipes from E6-T20.

## Deliverables
- `examples/terminal-embed/index.html`: the single-file embed, pinned SDK version,
  served by `examples/serve.sh` with and without COOP/COEP to show both modes.
- `examples/almostnode-ide/`: the IDE front-end integration (vendored or submoduled UI,
  clearly attributed), a `README.md` mapping each IDE feature to the SDK calls used,
  and the guest-agent script it installs (if the exec channel needs one).
- `docs/embedding-guide.md` + generated API reference wired into the docs build.
- Playwright e2e: example A boots to prompt and echoes typed input; example B edits a
  Python file, runs it, asserts output text and a nonzero-exit error path.
- Issues filed (and linked in the task log) for every SDK gap discovered.

## Acceptance criteria
- [ ] Example A works from a plain static file server on a fresh machine following only
      its README: boot to login, type, see output — verified in Chrome and Firefox.
- [ ] Example B: create `hello.py` in the IDE, click Run, see `hello` in the output
      panel in < 3 s after boot has completed; edit to raise an exception, Run, see the
      traceback and exit code 1 rendered distinctly.
- [ ] Example B file sync is bidirectional: `touch /mnt/embed/from-guest.txt` in the
      guest terminal makes the file appear in the IDE tree within 2 s (watch or poll —
      mechanism documented).
- [ ] Both examples pass Playwright in CI headless; example A's page weight excluding
      wasm/image assets is < 100 kB.
- [ ] Neither example imports anything from `sdk/` internals (lint rule or import check
      in CI proves public-API-only).

## Adversarial verification
Do a cold-start usability refutation: on a machine that has never built this repo,
follow example A's README verbatim with a stopwatch — any missing step, implicit
dependency (headers! mime types!), or failure within 15 minutes of effort refutes.
Attack example B's exec channel: run a script that prints 10 MB to stdout, one that
reads stdin forever, one that forks a background process and exits, and one whose
output contains the channel's own framing delimiters — output corruption, a hung Run
button, or framing injection refutes. Kill and reboot the VM from the IDE while a run
is in flight — the IDE must recover to a runnable state. Verify the public-API claim by
deleting `sdk/` internals from `node_modules` shape (pack + install the tarball, run
examples against the installed package only). Then check the docs the hard way: pick
three code samples from the embedding guide and paste-run them unmodified; any that
don't compile/run refute the docs claim.

## Verification log
(empty)
