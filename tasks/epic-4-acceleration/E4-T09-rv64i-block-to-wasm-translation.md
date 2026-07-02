---
id: E4-T09
epic: 4
title: RV64I basic-block translation to WASM with locals-based register mapping
priority: 409
status: pending
depends_on: [E4-T07, E4-T08]
estimate: L
capstone: false
---

## Goal
A `crates/jit-translate` translator that turns one predecoded RV64I basic block into one
wasm function (via `wasm-emit`) implementing the E4-T06 ABI: guest registers mapped to
i64 locals (lazily loaded from the CPU-state region of linear memory on first read, written
back per the eager/dirty rules on exits), correct RV64 semantics for the full base integer
ISA, and a returned exit code + next-PC. Verified natively by executing generated functions
under wasmtime against the interpreter — no browser in the loop yet.

## Context
This is the JIT's heart. Scope is deliberately RV64I only (ALU, ALU-immediate, LUI/AUIPC,
shifts, SLT/SLTU, branches, JAL/JALR); loads/stores emit calls to placeholder import
call-outs (real memory fastpath is E4-T11), and system instructions terminate blocks
(E4-T12). Sharp edges the translator must own: `x0` reads fold to constant 0 and writes
are discarded; all `*W` ops compute in i32 then `i64.extend_i32_s` (sign-extension of the
32-bit result is architectural); shift amounts mask to 6 bits (5 for `*W`); branch offsets
produce two exits (taken/fallthrough PCs are block-relative constants); JALR clears bit 0
of the target. wasm has no goto: the block body is straight-line code with early returns
via the exit-code path, per the design doc.

## Deliverables
- `translate_block(&DecodedBlock, &Abi) -> Vec<u8>` emitting one wasm function; register
  allocator tracking loaded/dirty locals with writeback at every exit point.
- Full RV64I coverage incl. every branch/jump form; loads/stores via import stubs.
- Native differential test rig: run block under wasmtime (state in a linear-memory image)
  and under the interpreter from identical random initial register states; compare full
  register file + next-PC + exit code. 100k random RV64I blocks, plus directed edge cases
  (x0 targets, SLT boundary values, shift masks, ADDIW sign extension, JALR bit-0).
- Translation-time budget measured: median µs per block recorded in stats.

## Acceptance criteria
- [ ] 100k-block randomized differential run: zero divergences (register file, PC, exit).
- [ ] Directed edge-case suite green, including `addiw x5, x6, -1` style sign-extension
      traps-for-the-unwary and `sll` with rs2 ≥ 64.
- [ ] Every generated module passes `wasmparser` validation (asserted in the rig).
- [ ] Writeback correctness proven by the rig comparing the *memory-resident* state image
      after exit, not just wasmtime-local values.
- [ ] Median translation time per block < 50 µs native (predecode → bytes).

## Adversarial verification
Refute via differential divergence. Attack angles: (1) run your own fuzz campaign with a
different seed and a generator biased toward the nasty cases: chains where a register is
read then written then read (lazy-load/dirty interactions), blocks writing x0 mid-block
then reading it, back-to-back AUIPC/JALR pairs, maximum-length blocks; any divergence
refutes; (2) inspect writeback discipline: construct a block where a dirty local is live at
the *taken* branch exit but not fallthrough — verify both exits produce correct memory
state; (3) mutate the ABI state offsets in one place and confirm tests catch it (guards
against tests reading the same wrong offsets); (4) validate 1k generated modules in an
actual browser (`WebAssembly.validate`) to catch wasmtime-tolerated encoding quirks.

## Verification log
(empty)
