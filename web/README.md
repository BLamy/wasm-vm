# Browser demo (E0-T23)

A static page that loads the `wasm-vm` core as a wasm ES module, instantiates
`WasmMachine`, and wires its per-byte console callback into an [xterm.js](https://xtermjs.org/)
terminal. Run/Reset controls, an ELF file picker, the embedded default `hello.elf`, and a
status line showing the exit code + retired-instruction count.

## Build & serve (cold-clone reproducible, offline)

```sh
make web-build     # wasm-pack build --target web + npm ci (pinned xterm.js) + copy ELFs
make web-serve     # python3 -m http.server on :8080
```

Then open **http://localhost:8080** and click **Run** → `Hello from RV64` renders in the
terminal, and the status line shows `exited code=0 retired=83`.

Must be served over **HTTP** — wasm streaming and ES-module MIME rules break under
`file://`. There is **no CDN**: xterm.js is pinned in `package-lock.json` and installed
with `npm ci`, so builds are reproducible and work offline.

## Browser support

Current **Chrome** and **Firefox** (both ship `WebAssembly`, ES modules, and
`application/wasm` streaming). The terminal is raw byte output at Level 0 — keyboard input,
resize, and full ANSI apps arrive with the real UART in Epic 2.

## Files

- `index.html` — page + xterm.js UMD include + `main.js` module.
- `main.js` — wasm init, terminal wiring, Run/Reset, file picker, status line. Errors
  (bad ELF, trap) render **in the terminal**, not only the JS console.
- `assets/*.elf` — default guests, copied from `guest/prebuilt/` by `web-build`.
- `pkg/`, `node_modules/` — build artifacts (gitignored; regenerate with `web-build`).
