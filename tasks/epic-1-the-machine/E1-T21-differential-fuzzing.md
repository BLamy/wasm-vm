---
id: E1-T21
epic: 1
title: Differential fuzzing — random instruction streams lockstep against Spike
priority: 121
status: pending
depends_on: [E1-T19]
estimate: L
capstone: false
---

## Goal
A fuzzing rig that generates constrained-random RV64GC instruction streams, executes them
in lockstep on our hart and on Spike, compares architectural state at every retire, and
auto-minimizes any divergence to a short reproducer checked in as a regression test —
the tool that finds the bugs the curated suites were not written to find.

## Context
riscv-tests/RISCOF encode known-interesting cases; fuzzing finds the unknown ones
(operand-aliasing bugs, flag-accumulation bugs, WARL corner writes). Architecture:
(1) generator — weighted opcode selection over all implemented extensions, register
pressure control (small register pool to force aliasing/hazards), immediate distributions
biased to boundaries, a configurable % of raw random 16/32-bit words to exercise
illegal-instruction paths, and trap-heavy modes (CSR ops, ecall/ebreak, misaligned
targets) — always terminated by a halt sequence; (2) lockstep executor — drive Spike via
its commit log (`spike --log-commits`) or libspike bindings, parse per-retire {pc, insn,
rd/csr writebacks}, compare against our trace from the Epic 0 tracer; on mismatch, dump
both states; (3) minimizer — delta-debug the stream to the shortest prefix reproducing
the divergence; (4) corpus — every found bug lands in `tests/fuzz-regressions/` with the
seed and a one-line diagnosis. Fixed PRNG seeds ⇒ fully reproducible runs.

## Deliverables
- `tools/fuzz/` crate: generator (seeded, config-driven op weights), Spike lockstep
  driver, state comparator (x-regs, f-regs, fcsr, privilege, mstatus/mcause/mepc/mtval
  subset), minimizer, and a `cargo run -p fuzz -- --seed N --count M` CLI.
- Machine-mode fuzz profile (all extensions, traps allowed) and a U-mode+Sv39 profile
  (page tables pre-built, page faults expected and compared as events).
- CI: a smoke tier (1M instructions, fixed seed set) on every PR; a nightly tier
  (100M+, fresh seeds) with divergence artifacts uploaded.
- ≥10 checked-in regression cases from the initial fuzz campaign (history says there
  will be at least that many) or a statement in the task log that N hours of fuzzing at
  documented throughput found fewer.

## Acceptance criteria
- [ ] A seeded run reproduces bit-identically across two hosts (same divergence report
      or same clean pass).
- [ ] Mutation sensitivity: each of 6 seeded CPU bugs (one per extension incl. a WARL
      mask bug and an fflags bug) is found by the smoke tier within its budget.
- [ ] A discovered divergence auto-minimizes to ≤ 20 instructions and is emitted as a
      standalone .S reproducer that fails deterministically.
- [ ] The comparator checks fcsr and mstatus.FS — not just x-regs (verified by the
      fflags seeded bug being caught).
- [ ] Nightly tier sustains ≥ 1M retire-compares/minute (documented) so 100M is < 2h.
- [ ] The U-mode+Sv39 profile compares trap events (cause, tval) as first-class stream
      items, not just final state.

## Adversarial verification
Attack the comparator's blind spots: seed bugs in state it might not compare — an mepc
off-by-2 on compressed-instruction traps, a NaN-payload difference, an x0-write leak, a
satp WARL drift — and require the rig to catch each; any miss refutes the "lockstep"
claim. Attack generator coverage: instrument decode with per-opcode counters over a 10M
run and produce the histogram — implemented opcodes with zero coverage (beyond a
documented exclusion list like WFI) refute the coverage claim. Attack Spike-parity
assumptions: find a case where Spike is non-spec (known: some WARL choices) — the rig
must support a documented per-divergence adjudication file rather than silently
allowlisting. Attack reproducibility: run the same seed on native and wasm32 builds of
OUR side (Spike stays native) — differing verdicts refute T22 early. Finally, let the
nightly run 12h and triage: every divergence must terminate in either a fixed bug, a
regression test, or a spec-cited adjudication entry — an untriaged pile refutes process.

## Verification log
(empty)
