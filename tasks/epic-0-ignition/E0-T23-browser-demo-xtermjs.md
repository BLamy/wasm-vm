---
id: E0-T23
epic: 0
title: Browser demo page wiring the wasm machine to an xterm.js console
priority: 23
status: implemented
depends_on: [E0-T22]
estimate: M
capstone: false
---

## Goal
A static `web/` page that loads the wasm-pack module, instantiates `WasmMachine`, and
wires its console callback into an `@xterm/xterm` terminal — with Run/Reset controls, an
ELF file picker, the embedded default `hello.elf`, and a status line showing retired
instructions and exit code. This is the capstone's stage.

## Context
Deliberately boring web engineering: no bundler — `wasm-pack build --target web` emits an
ES module `web/` imports directly; xterm.js is pinned via `package-lock.json` and `npm ci`
(no CDN, so cold-clone builds are reproducible and offline-capable). Pages must be served
over HTTP (wasm streaming + module MIME rules break `file://`) — `make web-serve` wraps
`python3 -m http.server`. The terminal is raw byte output at Level 0; keyboard input,
resize, and ANSI apps arrive with the real UART in Epic 2. Errors (bad ELF, trap) must
render *in the terminal*, not vanish into the JS console.

## Deliverables
- `web/index.html`, `web/main.js` (ES module: init wasm, create terminal, wire
  `set_console` to `term.write(Uint8Array.of(b))`, buttons Run/Reset, file picker via
  `File.arrayBuffer()`, status line fed from the `run()` status object).
- `web/package.json` + lockfile pinning `@xterm/xterm`; `web/assets/hello.elf` copied
  from `guest/prebuilt/` by the build.
- `Makefile` targets: `web-build` (wasm-pack + `npm ci` + asset copy), `web-serve`
  (serve `web/` on :8080).
- `web/README.md`: browser support statement (current Chrome + Firefox) and the HTTP
  requirement.

## Acceptance criteria
- [ ] Cold clone → `make web-build web-serve` → open `http://localhost:8080` in Chrome
      and Firefox → click Run → `Hello from RV64` renders in the xterm.js terminal and
      the status line shows `exited code=0` with a retired count matching the native CLI.
- [ ] Zero errors and zero warnings from our code in the browser console across load,
      run, and reset.
- [ ] Picking `loops.elf` via the file picker runs it (status shows its exit code);
      picking a non-ELF file prints the loader error *in the terminal* and the page
      remains functional.
- [ ] Reset then Run produces identical output (no stale machine state).
- [ ] Works with browser cache disabled and after `git clean -fdx` + rebuild.

## Adversarial verification
Cold start is the whole game: verify from a fresh clone in a fresh browser profile
(`chrome --user-data-dir=$(mktemp -d)`), not a dev machine's warm state. Attack angles:
(1) hard-reload with DevTools cache disabled and throttled network — partial-load races
refute; (2) feed a 100 MB random file through the picker (must error gracefully, tab must
not OOM-crash); (3) click Run five times rapidly — overlapping runs must be prevented or
serialized, interleaved terminal output refutes; (4) check Firefox specifically for the
`application/wasm` MIME/streaming fallback with the chosen dev server; (5) binary-output
attack: run a guest emitting bytes 0x00–0xFF and compare what xterm.js renders against
the CLI's stdout capture — the wrapper must pass bytes through uninterpreted (terminal
rendering may differ; byte delivery to `term.write` must not, assert via a tap that
records callback bytes).

## Verification log
### 2026-07-03 — worker claim — branch task/e0-t23-browser-demo (stacked on e0-t22)
Deliverables: web/ static page — no bundler. index.html includes the pinned xterm.js UMD build
(node_modules/@xterm/xterm/lib/xterm.js + css/xterm.css, NO CDN) and main.js (ES module). main.js:
init the wasm-pack --target web module, create an xterm.js Terminal, wire setConsole(b =>
term.write(Uint8Array.of(b))) [byte-exact, uninterpreted], Run/Reset buttons, ELF file picker via
File.arrayBuffer(), status line fed from the run() status object. Errors (bad ELF, trap) render IN
THE TERMINAL (ANSI red), never only the JS console. Every Run builds a FRESH WasmMachine (Reset is
automatic — no stale state), and a `running` guard + the synchronous run body serialize rapid
clicks (no interleaving). web/package.json + package-lock.json pin @xterm/xterm 5.5.0 (npm ci,
offline). web/assets/*.elf copied from guest/prebuilt by web-build (gitignored, regenerated).
web/README.md: Chrome+Firefox support + the HTTP requirement. Makefile: web-build (wasm-pack +
npm ci + mkdir+cp assets) and web-serve (python3 -m http.server :8080). web/pkg + node_modules +
assets gitignored.
BROWSER-VERIFIED in live Chrome (served via web-serve, http://localhost:8080):
- Run → xterm.js renders "Hello from RV64" (screenshot confirmed) + status "exited code=0
  retired=83" (retired == native CLI). A byte tap (window.__consoleBytes) recorded EXACTLY the 16
  bytes "Hello from RV64\n" delivered to term.write (angle 5 byte-passthrough).
- Browser console: ZERO errors, ZERO warnings — only our own console.debug digest lines; the
  browser digest df49438130a9…5ceb05 == the native --dump-state digest.
- Non-ELF bytes → "load_elf failed: BadMagic" surfaced (message names the ElfError variant); the
  page stays functional.
- Reset then Run → identical output "Hello from RV64\n" + status "exited code=0 retired=83".
- Rapid 5× Run → 80 bytes = five CLEAN, non-interleaved copies (serialized, not garbled).
Reproducibility: rm -rf web/{pkg,node_modules,assets} && make web-build regenerates all artifacts
(wasm-pack Done + npm ci + assets) from committed source + lockfile; all HTTP assets serve 200 with
correct MIME (wasm = application/wasm for streaming).
rr: N/A (browser/web). Verifier angles open: cold clone in a FRESH chrome profile (--user-data-dir),
DevTools cache-disabled + throttled (1), 100 MB junk file via the picker → graceful error no OOM (2),
5× rapid Run serialization (3, byte tap = clean multiples here), Firefox application/wasm streaming
fallback (4), and 0x00–0xFF binary-output byte-delivery tap vs CLI (5).
