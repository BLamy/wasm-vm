---
id: E0-T22
epic: 0
title: wasm-bindgen wrapper — machine handle, step and run, console callback into JS
priority: 22
status: pending
depends_on: [E0-T02, E0-T11, E0-T12, E0-T16, E0-T17]
estimate: M
capstone: false
---

## Goal
`wasm-vm-wasm` exposes the machine to JavaScript through a thin, panic-safe
`#[wasm_bindgen]` surface: construct with RAM size, load ELF bytes, step/run with
instruction budgets, receive console bytes through a JS callback, and read back traces,
registers, and state digests — everything the browser demo (E0-T23) and capstone need,
with zero emulator logic living in this crate.

## Context
This is the bet-#2 boundary made concrete: the wrapper adapts types (`Vec<u8>` ↔
`Uint8Array`, `u64` registers ↔ `BigUint64Array`), converts `Result` into thrown
`JsError`s, and implements `ConsoleSink` by invoking a stored `js_sys::Function` per byte
(batched flush is a Level 4 concern; correctness first). Panics must reach the JS console
via `console_error_panic_hook`, initialized once. Re-entrancy is real: a console callback
that calls back into `step()` would alias the machine's `&mut` — the wrapper must make
this a caught error (interior `RefCell` with `try_borrow_mut`), never UB or an abort.

## Deliverables
- `crates/wasm/src/lib.rs`: `WasmMachine` with `new(ram_mib: u32)`,
  `load_elf(&mut self, bytes: &[u8]) -> Result<(), JsError>`,
  `set_console(&mut self, cb: js_sys::Function)`, `run(&mut self, max_instrs: u32) ->
  Result<JsValue, JsError>` (status object: `{kind: "exited"|"trapped"|"max", code,
  cause, retired}` via `serde_wasm_bindgen` or manual `js_sys::Object`),
  `step(&mut self, n: u32) -> Result<u32, JsError>`, `registers() -> js_sys::
  BigUint64Array` (33 values: pc + x0..x31), `state_digest() -> String`,
  `set_trace(&mut self, on: bool)` and `take_trace() -> String` (canonical format).
- `wasm-pack build crates/wasm --target web` producing `pkg/` (gitignored).
- `wasm-bindgen-test` suite (`wasm-pack test --node`): embedded `hello.elf` via
  `include_bytes!` runs to exit 0 with console capture equal to `Hello from RV64\n`.

## Acceptance criteria
- [ ] Node test: hello runs, callback receives exactly the expected bytes in order,
      status object is `{kind: "exited", code: 0, retired: <n>}` with `<n>` equal to the
      native CLI's `retired=` for the same ELF.
- [ ] `take_trace()` for `loops.elf` (trace on, first 40 lines) equals the E0-T16 golden
      trace byte-for-byte.
- [ ] Malformed ELF bytes throw a catchable `JsError` (message names the `ElfError`
      variant); the machine remains usable afterward.
- [ ] Calling `run` before `load_elf`, or after exit, throws a descriptive `JsError` —
      no unreachable/abort.
- [ ] `state_digest()` after a hello run matches the native `--dump-state` digest.

## Adversarial verification
(1) Re-entrancy attack: register a console callback that immediately calls
`machine.step(1)` — an abort/unreachable trap in wasm refutes; a thrown, catchable error
passes. (2) Panic-path attack: force an internal panic (e.g. a debug-only test hook or a
contrived state) and confirm a readable stack reaches the console via the panic hook
rather than a bare `RuntimeError: unreachable`. (3) Leak attack: construct and drop 500
`WasmMachine(64 MiB)` instances calling `.free()`; observe `WebAssembly.Memory` growth —
unbounded growth refutes. (4) Zero-length and 4 GiB-length byte inputs to `load_elf`.
(5) Determinism triangle: retired count, digest, and trace must agree across native CLI,
node-wasm, and (later) browser for all three golden ELFs — any leg diverging refutes.

## Verification log
(empty)
