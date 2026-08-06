---
id: E4-T06
epic: 4
title: JIT architecture design document — tiering, block shape, side exits, budgets
priority: 406
status: verification-debt
depends_on: [E4-T02, E4-T05]
estimate: M
capstone: false
---

## Goal
A reviewed `docs/jit-architecture.md` that commits — with rationale and numbers from the
profiling tasks — to the JIT's load-bearing decisions: tiering policy, translation unit
shape, the ABI between dispatch loop and generated code, side-exit/deopt strategy,
translation-cache keying and invalidation matrix, and memory/module budgets. Every later
task in this epic implements a section of this document instead of re-litigating it.

## Context
Dynamic binary translation to WASM has three public prior arts to mine: v86's JIT
(basic blocks batched into wasm modules, dispatch via a jump table, interpreter fallback),
QEMU TCG (physically-keyed TBs, block chaining, tb_flush on fence.i-equivalents, icount),
and CheerpX (closed, but talks/blogs describe tiered execution and SMC handling). The
browser adds unique constraints the doc must own: `WebAssembly.Module` compilation cost and
main-thread sync-compile size caps, no code patching after instantiation (chaining must go
through mutable data: funcref tables / link slots in memory), and instance/memory limits.

## Deliverables
- `docs/jit-architecture.md` covering, at minimum, with a decision + rationale each:
  - Tiering: interpreter → JIT hotness threshold (initial value, e.g. 64 executions, and
    how it's counted per E4-T05 blocks); what is never JITted.
  - Translation unit: basic blocks first; superblock/trace extension criteria stated as a
    later measured experiment, not folklore.
  - ABI: how generated functions receive CPU state (shared linear memory layout, state
    offsets), register mapping policy (guest x-regs in wasm i64 locals, lazy load, eager
    writeback rules), exit-code enum (fallthrough-PC, trap, interrupt-poll, budget-expiry).
  - Side exits: precise-state reconstruction rules; what must be materialized before any
    potentially-trapping op.
  - Invalidation matrix: fence.i / SFENCE.VMA / satp write / SMC store / eviction — with
    the physical-address-keying argument spelled out.
  - Budgets: max translated-code bytes, max live Modules/Instances per browser, compile
    queue depth, pause-time target (< 5 ms JIT-attributable stalls).
  - Worker execution model sketch (SAB, Atomics) and what stays on the main thread.
- An ADR-style decision log; open questions each assigned to a specific E4 task.

## Acceptance criteria
- [ ] Every decision cites either a measurement (E4-T01/T02/T04/T05 data) or named prior
      art (v86/TCG file- or post-level references, not hand-waves).
- [ ] The exit-code enum, state-layout offsets, and invalidation matrix are specified
      precisely enough that E4-T09..T20 can be implemented without amending the ABI.
- [ ] Budgets are concrete numbers with a stated fallback when exceeded.
- [ ] Doc reviewed in a separate session; review comments and resolutions committed.

## Adversarial verification
Refute by finding an unanswered load-bearing question. The verifier reads the doc cold and
attacks: (1) pick three later tasks (e.g. E4-T12, T17, T18) and attempt to write their
function signatures purely from the doc — any required-but-unspecified detail (who writes
back registers on a trap side-exit? how does an SMC store find the blocks to kill?) is a
refutation; (2) check the invalidation matrix against the RISC-V privileged spec (fence.i,
SFENCE.VMA rs1/rs2 forms, ASID) — a missing case refutes; (3) verify each cited number
exists in the profiling artifacts; (4) stress the budget arithmetic: at the stated
blocks-per-module and module cap, confirm a gcc-sized working set fits or has a defined
eviction story.

## Verification log
- 2026-08-05 — **`docs/jit-architecture.md` written + committed (`245bb53`); status partially-verified (doc complete; the AC's separate-session REVIEW is the remaining step).** 462 lines / 14 sections, every load-bearing decision committed with real cited numbers (device-sync 47%, browser 89%-in-wasm + 7.1% bindgen boundary, the measured **2.24× E4-T05 uplift**, 261.7 CoreMark / 189.7 DMIPS / ~30 MIPS baseline — 19 evidence citations, none invented). Commits: **3 tiers** (interp → E4-T05 block cache → ONE JIT tier; 2nd tier only if E4-T28 shows ≥2× left); promote at the **64th** block execution; translation unit = the E4-T05 `DecodedBlock` verbatim; frozen `CpuState` layout + **9-variant `ExitCode`** ABI; retire-clock per-op + device/interrupt sampling batched to block boundary (preserves E4-T05 determinism); invalidation reuses physical-PC keying + `has_code` bitmap (full matrix incl. ASID/sfence); emit real WASM ~64 blocks/module via funcref-table chaining, 32 MiB code cache / 256 Modules / <5 ms pause LRU. ADR log D1–D11, every decision tied to a ledger/test falsifiability gate, open questions assigned to specific E4 tasks. **4 highest-risk items flagged for spikes:** (1) batching+retire-clock determinism through compiled code (→E4-T25 differential); (2) browser module budget + funcref-table chaining vs 5 ms (→E4-T19); (3) inline-TLB coherence with the audited walker (→E4-T11 fuzz); (4) FP inline-vs-softfloat (→E4-T15). Honest: the gcc working-set budget arithmetic is flagged a hypothesis (that bench row is deferred). REMAINING (debt): the formal separate-session review (§11 stub) — a process step for a later session.
(empty)
