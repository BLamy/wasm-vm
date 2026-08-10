---
id: E4-T33
epic: 4
title: Bulk JIT CPU-state handoff and bounded browser handle lifetime
priority: 432
status: in-progress
depends_on: [E4-T31]
estimate: S
risk: high
capstone: false
---

## Goal

Remove the per-register host boundary from both JIT executors. Marshal the frozen CPU-state region
in one bulk write and one bulk read per compiled block, and retain a stable browser typed-array view
instead of constructing/cloning JS handles on every register access and dispatch.

## Acceptance criteria

- Native and browser executors perform O(1) state-copy calls per block, with no per-register memory
  reads/writes and no per-dispatch browser `Function`/memory-view clone.
- The release JIT pure-ALU benchmark is faster than the interpreter on the same frozen head and the
  before/after MIPS ratio is recorded against the now-exact E4-T31 work budget.
- A long browser-executor stress run completes with bounded live modules/handles, active eviction,
  no `addToExternrefTable0` growth failure, and identical final architectural state.
- Precise traps, I/M/A parity, SMC invalidation, eviction, and integrated CLI JIT tests remain green.

## Adversarial verification

Force a memory fault after dirty register writeback, evict while repeatedly retranslating, set a tiny
cache budget, and run enough hot blocks to exceed the old failure point. Any lost register, imprecise
trap, unbounded live handle count, or JIT slowdown refutes the change.

## Verification log
