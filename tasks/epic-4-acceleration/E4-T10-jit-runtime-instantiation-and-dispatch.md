---
id: E4-T10
epic: 4
title: JIT runtime — module instantiation, host imports, and dispatch-loop integration
priority: 410
status: pending
depends_on: [E4-T09]
estimate: L
capstone: false
---

## Goal
Translated blocks actually execute inside the running VM: emitted bytes become a
`WebAssembly.Module`/Instance in the browser (wasmtime natively, same bytes), generated
functions are registered in a funcref table, and the main dispatch loop checks the
translation cache — hit calls the translated function through the table, miss falls back
to the E4-T05 interpreter — with the exit-code protocol (fallthrough PC, untranslated
target, trap, interrupt-budget expiry) fully wired.

## Context
This closes the tier-up loop end to end for RV64I-only blocks. Browser realities to handle
now: the synchronous `new WebAssembly.Module` path is size-capped on the main thread in
Chrome (~4 KB), so compilation goes through `WebAssembly.compile` (async) or happens off
the main thread later (E4-T21) — this task may use eager async compile with the interpreter
running until installation. Generated code must participate in interrupt delivery: an
instruction-budget counter decremented per block, exiting to the dispatch loop when
exhausted so CLINT/PLIC checks still happen with bounded latency (QEMU icount analog).
The native path runs the identical module bytes under wasmtime so every later task is
testable in CI without a browser.

## Deliverables
- `JitRuntime` trait with browser impl (js-sys: compile, instantiate with shared imports:
  memory, funcref table, call-out functions) and native wasmtime impl.
- Translation cache: phys-PC → table index map; installation path (validate generation per
  E4-T08, grow table, `table.set`); uninstall path (reset to sentinel).
- Dispatch loop integration: lookup, `call_indirect` entry, exit-code handling for all
  enum variants; instruction budget plumbed through generated code (global or state field).
- End-to-end test: a bare-metal RV64I guest binary runs with JIT on, natively and in a
  browser test page; stats report >90% of retired instructions executed in translated code.
- JIT on/off runtime flag; identical guest-visible behavior both ways (test asserts equal
  final state on a deterministic workload).

## Acceptance criteria
- [ ] Deterministic RV64I guest produces bit-identical final architectural state with JIT
      on vs off, natively and in-browser.
- [ ] Stats show ≥ 90% translated-instruction ratio on a hot-loop workload after warmup.
- [ ] A pending timer interrupt is taken within one instruction budget (test with
      mtimecmp set mid-loop; budget documented).
- [ ] Main-thread sync-compile size cap never hit: all browser compiles use the async path
      (asserted by instrumentation, tested with a > 4 KB module).
- [ ] Full riscv-tests rv64ui green with JIT forced on (threshold 0), native wasmtime path.

## Adversarial verification
Refute equivalence and liveness. Attack angles: (1) run rv64ui with threshold 0 AND
threshold 1 AND a 1-entry translation cache — flapping between tiers must not corrupt
state; any test differing from interpreter-only is a refutation; (2) interrupt starvation:
craft an infinite tight loop fully covered by translated code and confirm a timer interrupt
still fires (budget path) — hang = refutation; (3) reentrancy: force an install to complete
*while* the same block is executing (async compile completion) and verify no table-index
UAF/mismatch; (4) kill the async compile pipeline (reject the promise) and confirm the VM
degrades to interpreter without crashing; (5) compare browser vs wasmtime execution of the
same 1k random blocks from E4-T09's rig — engine-behavior divergence refutes the "same
bytes both paths" claim.

## Verification log
(empty)
