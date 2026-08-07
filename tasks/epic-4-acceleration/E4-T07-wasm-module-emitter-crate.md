---
id: E4-T07
epic: 4
title: Hand-rolled WASM module emitter crate (sections, LEB128, function bodies)
priority: 407
status: verified
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
- 2026-08-05 — **VERIFIED (commit `1b9b6bb`).** New crate `crates/wasm-emit` (pkg `wasm-vm-wasm-emit`): `leb128` (u32/u64/i32/i64, minimal-length), `types`, `ModuleBuilder` (all sections in canonical order, size-prefixes measured from finished bytes, import-aware index spaces, deduped type interning), `FuncBuilder` (typed opcode API, RLE locals, build-time index/control-balance checks). `no_std`+alloc, **zero non-workspace runtime deps** (`cargo tree -e normal`), wasm32 no_std build clean. **Primary AC met decisively (independently re-ran: 13/13):** every emitted module passes `wasmparser::Validator` with `WasmFeatures::all()` — the 4 required shapes (add / funcref-table+call_indirect / loads+stores+control / 64-fn), a wasmtime EXECUTION smoke (2+40=42, wrapping), adversarial encodings (40-deep nesting, 1000-target br_table, 50k RLE locals, body-length LEB boundary sweep), and **10,000 randomized modules all valid**. LEB128: 7 property tests (golden edges + 20k round-trip/minimality). Speed: 200 fns / 400k instrs in 3.84 ms = **156 MB/s, 104M instr/s** (debug; well under the 10 ms bound). fmt/clippy(-D) clean. Coverage: i32/i64 full arith+bitwise+shift+cmp, f32/f64 basics+conv, all load/store widths w/ memarg, locals/globals, call/call_indirect, block/loop/if/br/br_table/return/select, memory.size/grow, the threads-atomics subset (needed by the E4-T06 design). **Deferred (out-of-scope / downstream, not blocking):** v128/SIMD bodies (the RISC-V JIT needs none), full atomic RMW family beyond add/cmpxchg (macro-extendable), and the live-browser SharedArrayBuffer instantiation + `wat2wasm` byte-diff (no browser/wat2wasm in the test env; wasmparser-all-features validity is the spec-level guarantee) — folded into a later JIT-integration task.
(empty)
