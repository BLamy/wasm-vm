---
id: E4-T07
epic: 4
title: Hand-rolled WASM module emitter crate (sections, LEB128, function bodies)
priority: 407
status: pending
depends_on: [E4-T06]
estimate: L
capstone: false
---

## Goal
A new `crates/wasm-emit` crate that builds valid WebAssembly binary modules from scratch —
section framing, LEB128, type/import/function/table/memory/export/element/code sections,
and a typed instruction encoder — with zero runtime dependencies, `no_std + alloc`
compatible, fast enough to emit thousands of small functions per second, and proven valid
by `wasmparser` in tests only.

## Context
The JIT emits wasm bytes at runtime *inside* a wasm module; pulling in `wasm-encoder`+
friends is possible but this crate is small, hot, and load-bearing enough to own (v86
hand-rolls exactly this in `src/rust/wasmgen`). Scope is the JIT's need, not generality:
one imported shared memory, one imported funcref table, imported host call-outs, and N
emitted functions. Binary format reference: WebAssembly Core Spec §5 (binary format).
Required opcodes: full i32/i64 ALU/compare, loads/stores with memarg (including 8/16/32
partial widths, signed/unsigned), f32/f64 basics, control (`block/loop/if/else/end/br/
br_if/br_table/return/call/call_indirect/unreachable`), `local.get/set/tee`,
`global.get/set`, `select`, `drop`, and the atomic RMW/load/store subset (threads proposal
encodings, 0xFE prefix) for E4-T14/T22.

## Deliverables
- `crates/wasm-emit` with: `uleb128/sleb128` encoders; `ModuleBuilder` producing sections
  in canonical order with correct byte-length prefixes; `FuncBuilder` managing locals
  declaration (run-length encoded by type) and body emission; typed opcode API (no raw
  `0x6a` at call sites); label/blocktype handling for structured control flow.
- Support for shared-memory limits flag (0x03) and memarg alignment encoding.
- Tests: (a) every emitted construct validated by `wasmparser::Validator` with the threads
  feature on (dev-dependency only); (b) property test — randomized straight-line function
  generator, 10k modules, all validate; (c) golden-byte tests for LEB128 edge values
  (0, 127, 128, i32::MIN, u64::MAX) against hand-computed encodings; (d) an executable
  smoke test running an emitted add-function under wasmtime (dev-dependency, native only).
- Benchmark: emit a 200-function module; record MB/s and time in the crate README.

## Acceptance criteria
- [ ] `cargo tree -p wasm-emit -e normal` shows zero non-workspace dependencies.
- [ ] Crate builds for `wasm32-unknown-unknown` and native; tests green natively.
- [ ] 10k-module property test passes `wasmparser` validation with zero failures.
- [ ] sleb128 golden tests cover negative i33/i64 blocktype and constant edge cases.
- [ ] Emitting a 200-function/1k-instruction-each module takes < 10 ms native.

## Adversarial verification
Refute by producing an invalid or misencoded module the tests miss. Attack angles:
(1) extend the property generator adversarially — nested control flow ≥ 32 deep,
`br_table` with 1000 targets, functions with > 50k locals, section sizes crossing LEB128
length-prefix byte boundaries (the classic bug: body length computed before a nested fixup
changes it) — validate all with `wasmparser` AND instantiate a sample in a real browser;
(2) diff bytes against `wat2wasm` output for five hand-written equivalents — any semantic
divergence (not mere encoding choice like non-minimal LEB, which the spec forbids anyway —
check minimality) refutes; (3) misuse the API (unbalanced `end`, wrong local index) and
confirm it panics/errors at build time rather than emitting garbage; (4) confirm shared
memory + atomics encodings by instantiating with a SharedArrayBuffer-backed memory in
Chrome and Firefox.

## Verification log
(empty)
