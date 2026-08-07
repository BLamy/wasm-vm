# `wasm-vm-wasm-emit` (E4-T07)

Hand-rolled WebAssembly module emitter — the byte-level backend the JIT (E4-T09…T20) calls at
runtime to turn a translated guest basic block into a real `.wasm` binary and instantiate it via
`WebAssembly.compile` (one module per ~64-block batch, per `docs/jit-architecture.md` §7).

It is **not** a RISC-V → WASM lowering (that is the JIT's job). It is the generic, correct, fast
builder underneath: LEB128, section framing, and a typed opcode API.

## Why hand-rolled

`wasm-encoder`+friends would work, but this code runs *inside* a wasm module in the browser, is on
the JIT hot path, and is small enough to own — exactly as v86 owns `src/rust/wasmgen`. So:

- **`no_std + alloc`, zero runtime dependencies** (`cargo tree -p wasm-vm-wasm-emit -e normal` shows
  only this crate). Builds for `wasm32-unknown-unknown` and native.
- `wasmparser` + `wasmtime` are **dev-dependencies only** — they validate and execute the output in
  tests; they never enter the shipped wasm build.

## API shape

```rust
use wasm_emit::*;

let mut m = ModuleBuilder::new();
let t = m.add_type(FuncType::new(&[ValType::I64, ValType::I64], &[ValType::I64]));
let f = m.add_function(t);
m.export("add", ExportKind::Func, f);

let mut b = FuncBuilder::new(&[ValType::I64, ValType::I64]);
b.local_get(0);
b.local_get(1);
b.i64_add();
m.add_code(b.finish());

let bytes: Vec<u8> = m.finish(); // a valid wasm binary
```

- `leb128` — `write_u32/u64/i32/i64`, minimal-length by construction.
- `types` — `ValType`, `RefType`, `BlockType`, `Limits` (incl. shared-memory flag `0x03`),
  `Mutability`, `MemType`, `TableType`, `GlobalType`.
- `module::ModuleBuilder` — type/import/function/table/memory/global/export/element/code/start
  sections in canonical order with size prefixes measured from the finished bytes.
- `func::FuncBuilder` — one method per opcode (full i32/i64 ALU/compare/shift, all load/store widths
  with memarg, `local.*`/`global.*`, `call`/`call_indirect`, structured control with blocktypes,
  `br`/`br_if`/`br_table`, `select`, `memory.size`/`grow`, and the threads-proposal atomic subset).
  Local indices and control-flow balance are checked at build time.

## Safety / hard-to-misuse

- Out-of-range `local.get/set/tee` panics at emit time.
- Unbalanced `end` (extra or missing) panics — an unbalanced body can never reach a module.
- Section length prefixes are written *after* the content exists, so a nested change can never
  invalidate a pre-computed prefix (the classic size-fixup bug).

## Benchmark

`tests/speed.rs` emits a **200-function × 1000-instruction** module and asserts `< 10 ms` native.

Measured on this machine (Apple Silicon, unoptimized debug test build):

```
emit 200 fns / 400000 instrs -> 601445 bytes in 3.84 ms  (156.7 MB/s, 104.2M instr/s)
```

That is ~52k function-emits/sec even unoptimized (release is materially faster); the assertion bound
is 10 ms. See the test's `eprintln!` for the live number.

## Validation

`cargo test -p wasm-vm-wasm-emit` runs:

- `tests/leb128.rs` — golden edge bytes (0, 127, 128, ±64, `i32::MIN`, `u64::MAX`, `i64::MIN/MAX`),
  20k-case round-trip + minimality property tests, and a per-shift boundary sweep.
- `tests/validate.rs` — the four required module shapes (add; funcref table + `call_indirect`;
  loads/stores + locals + control flow; 64 functions), an executable `wasmtime` smoke test, the
  adversarial cases (≥32-deep nesting, 1000-target `br_table`, 60k locals, body-length LEB boundary),
  API-misuse panics, and a **10 000-module** randomized-straight-line property test — all validated
  by `wasmparser::Validator` with the threads feature on.
- `tests/speed.rs` — the emit-speed sanity bound.
