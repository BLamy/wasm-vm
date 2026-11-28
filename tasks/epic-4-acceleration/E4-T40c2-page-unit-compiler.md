---
id: E4-T40c2
epic: 4
title: Page-unit compiler — one wasm function per hot guest code page, differential-tested natively
priority: 0.387691
status: pending
depends_on: [E4-T40c1]
estimate: S
risk: high
capstone: false
---

## Boundary

`crates/jit-translate` (or a new module beside it): translate the decoded blocks of one physical code page
into one wasm function that dispatches by entry offset (`br_table`), follows in-page branches and fall-throughs
inside the function, checks the retire budget/horizon at block entries, re-validates the page's fetch-TLB entry
at each in-page block entry, and returns `retired | exit reason | next pc` on anything it does not handle (the
interpreter runs it). The machine state contract is E4-T40c's prototype's (`turbo_jit.rs`): registers, PC, fast
TLB, RAM and the dirty/code-page bitmaps in place, nothing copied.

## Deterministic acceptance

Native differential tests: for generated and recorded block sets, executing the compiled page function (in the
native wasm runtime the JIT tests already use) and interpreting the same instructions give identical register,
memory and retired-count results, including SMC inside the page, a TLB change between entries, and budget exits.

## Verification log
