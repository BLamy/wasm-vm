---
id: E4-T31
epic: 4
title: Bounded JIT work and exact retirement accounting
priority: 431
status: implemented
depends_on: [E4-T30]
estimate: S
risk: high
capstone: false
---

## Goal

Make a bounded `run(N)` mean the same thing under the interpreter and JIT. Cap every compiled block
and host-side chain by remaining work, account clean and faulting compiled retirements exactly in all
architectural/diagnostic clocks, and keep instruction-observing traces truthful by interpreting
when the compiled backend cannot emit per-retire records.

## Acceptance criteria

- A nontrapping `run(N)` performs exactly `N` work slots/retirements with JIT and chaining enabled;
  a block larger than the remaining tail falls back without overshoot.
- Clean and partial-trap compiled exits update `mcycle`, `minstret`, CLINT `mtime` residue,
  `IrqStats`, executor JIT stats, CLI reporting, and Wasm wrapper reporting exactly once.
- Observing trace sinks produce one truthful record per retirement and do not silently omit compiled
  instructions; the zero-record sink retains the JIT fast path.
- Precise trap PCs remain virtual-address correct under paging, prior MMIO effects never replay, and
  chaining/SMC/invalidation behavior remains green in native and browser executor tests.
- The exact pre-fix six-op-loop overshoot is reproduced, then fixed: a 1,000,000 budget cannot report
  more than 1,000,000 retired work or monopolize a browser chunk by running a hidden chain multiple.

## Adversarial verification

Use a remaining budget smaller than a compiled block; fault in the middle after an observable MMIO
store; chain into a successor that no longer fits; write counters immediately before JIT entry; and
run a traced hot loop with JIT armed. Any overshoot, double side effect, missing trace, wrong virtual
fault PC, lost clock residue, or counter disagreement refutes the change.

## Verification log

### 2026-08-09 — planner — activated after verified E4-T30

The pre-split exact-head probe ran a six-op hot loop with `--max-instrs 1000000 --jit
--jit-threshold 1`: the JIT executed about 191.9M instructions (roughly 192x the budget), took
48.78s, and CLI reporting showed only 378 retirements. This task fixes bounded work and accounting
before any throughput claim or main-thread worker quantum depends on them.

### 2026-08-09 — worker — implemented `fad321f6`

- BUDGET: the run loop now subtracts exact `JitProgress.work_used`; each compiled block refuses a
  short remaining tail before touching state, and a later chained refusal preserves already
  committed progress. Taken interrupts and builtin-SBI `continue` paths still consume one bounded
  work slot.
- RETIREMENT: core-owned spans update `mcycle`, `minstret`, CLINT residue, `IrqStats`, and native /
  browser executor statistics exactly once. A partial precise fault accounts only its committed
  prefix; virtual fault PCs are walked from the virtual entry, not the physical cache key.
- TRACE/REPORTING: observing sinks force interpretation so no records disappear. CLI and Wasm
  wrappers report authoritative core counter deltas; a zero-record sink retains compiled execution.
- PROOF: the release million-work six-op regression passed in 0.08s with exactly 1,000,000 total and
  999,996 JIT retirements (pre-fix: about 191.9M hidden JIT retirements / 48.78s). Native affected
  JIT suites passed 42/42; core+CLINT+Zicntr 191/191; CLI 22/22; browser executor 8/8; Wasm wrapper
  9/9. The SBI, short-tail chain, MMIO-once fault, Sv39 virtual-PC, and trace attacks all passed.
- BUILD/BROWSER: format, native strict clippy, affected wasm clippy, wasm32 release build,
  zero-cost trace selftest, and hook-driven `make web-build` passed. The rebuilt `?jit=0` fallback
  restored BusyBox to `~ #` / `guest ready` with zero console errors/warnings. An aggressive live
  main-thread JIT page remained unresponsive, honestly preserving E4-T33/E4-T32 as required work.
- EVIDENCE: `evidence/e4-t31/README.md` and `browser-fallback.jpg` (SHA-256
  `3c22907f2852b7c41c928c36930b4c201d1347eab2db749a4565f4071d038264`).
