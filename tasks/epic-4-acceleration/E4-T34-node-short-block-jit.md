---
id: E4-T34
epic: 4
title: Short-block JIT acceleration for restored Node startup
priority: 434
status: pending
depends_on: [E4-T32]
estimate: S
risk: high
capstone: false
---

## Goal

Make the JIT accelerate the real restored node-Alpine workload rather than merely report high
translated retirement. Remove the measured boundary cost of Node/V8's short, memory-heavy and
indirect basic blocks with one bounded execution seam (for example guarded dynamic-target fusion,
shared compiled-state chaining, or the equivalent measured design) while preserving exact budgets.

## Acceptance criteria

- The validated deployed-R2 Node ELF and snapshot run a non-echo-spoofable fresh
  `node -e` computation in the foreground worker in <=20 seconds median, complete in <=25 seconds,
  and at least 3x faster than the same-head browser main-thread fast-interpreter path. Record the
  remaining gap to the <=5-second stretch target.
- JIT wall time is faster than worker interpreter wall time on the same restored image, with positive
  compiled/executed/retired deltas and no threshold-1-style compile/RSS storm.
- The measured host-boundary rate improves by at least 4x over the current approximately five guest
  instructions per compiled dispatch, without hiding work, counter, interrupt, or fault accounting.
- Precise faults, timer/device interrupts, dynamic-target changes, SMC invalidation, eviction, and
  CLI/Node architectural output remain exact across native and browser executors.

## Adversarial verification

Change a previously monomorphic `jalr` target mid-run, fault in the middle of a fused short-block
chain, make an interrupt pending at every remaining-budget tail, rewrite a linked page, and churn the
smallest cache budget. Compare exact counters/PC/registers against interpreter and require the real
Node result, not a synthetic ALU proxy. Any stale target, duplicated side effect, budget overshoot,
compile pause storm, or JIT wall-time loss refutes the change.

## Verification log
