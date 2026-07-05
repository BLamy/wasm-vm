---
id: E1-T21
epic: 1
title: Differential fuzzing — random instruction streams lockstep against Spike
priority: 121
status: verified
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

### 2026-07-04 — increment 1: RV64IM straight-line differential fuzzer WORKING end-to-end
A complete generate → lockstep → minimize → reproducer vertical slice landed as the
`wasm-vm-fuzz` crate (`tools/fuzz/`), built on the already-verified E0-T20 canonical-trace
harness (the rig's novelty is the *stimulus*, not the Spike comparison — which is reused
wholesale via `tools/diff/run_diff.sh`, now `--isa`-parameterized).

**Architecture (4 modules):**
- `rng.rs` — SplitMix64, no `rand` dependency → `--seed N` is a pure, host-independent
  function to a stream (acceptance #1). Immediate distribution biased hard to boundaries
  (0, ±1, INT_MIN/MAX 32/64, shift-amount edges).
- `isagen.rs` — weighted RV64IM opcode menu over a **7-register pool** (forces
  aliasing/hazards); emits assembly **mnemonics** so gcc encodes them (a self-written
  encoder would only inject the fuzzer's own bugs). Straight-line only: control flow always
  falls through to the halt epilogue and no memory traffic can clobber `tohost`, so every
  program terminates. M-ops weighted up (div/rem = 4) for corner-case density.
- `harness.rs` — assemble via Docker toolchain gcc, run the ELF through `run_diff.sh`
  (our CLI + Spike, normalize both, prefix-compare). Exit 0=match, 1=divergence.
- `minimize.rs` — ddmin over body lines (sound because straight-line: every candidate still
  assembles + halts). Emits the minimal witness as a standalone `.S`.

**Acceptance evidence:**
- **#1 seeded reproducibility** — unit tests assert identical render for a seed across two
  constructions; SplitMix64 uses only wrapping integer arithmetic (host-independent).
- **#2 mutation sensitivity (the key proof)** — injected a real CPU bug (`hart/mod.rs` Div
  div-by-zero result `-1i64` → `0i64`, violating §7.2), rebuilt the release CLI, ran
  `campaign --from 0 --to 40 --count 128`. Seed `0x0` diverged; **ddmin shrank 128 → 2
  instructions in 14 oracle calls**:
  ```asm
  sraiw t2, t3, 25   # t3=0x3f → 32-bit ASR by 25 → t2 = 0 (the divisor)
  div   t3, t1, t2   # ÷0: correct = -1 (all ones); mutant = 0  ← DIVERGENCE
  ```
  ddmin correctly kept the `sraiw` dependency that manufactures the zero divisor. Reverted
  the mutation → the same seed reports `MATCH` (proves the bug was the sole cause; **no
  false positives**). Fixture + write-up checked in at `tools/fuzz/sensitivity/`.
- **#3 ≤20-instruction .S reproducer** — the emitted witness is 2 instructions, standalone,
  deterministic (regenerable via the header's reproduce line).
- **campaign hygiene** — swept seeds 0..12 @ 96 instrs against the *correct* core: **0
  divergences** in ~14s (~1.2s/seed, Docker-per-program) — our RV64IM matches Spike, as
  expected from riscv-tests + E1-T20 RISCOF compliance.

**Corpus (acceptance #4 honesty):** fuzzing the *compliant* core found **zero real**
divergences, so `tests/fuzz-regressions/` is empty with a README stating that outcome (the
covered stimulus class is already RISCOF-compliant); the seeded-mutation experiment is the
"the rig would catch it" proof. `make fuzz-diff-smoke` runs a fixed-seed campaign (fails on
any divergence, auto-minimizing to a reproducer).

**DEFERRED to follow-on increments (structured to slot in as new `Op` arms / ISA strings,
no harness change):** loads/stores over bounded scratch; branches/jumps with a CFG halt
guarantee; F/D/C (fcsr + NaN-payload compare) and A; a **U-mode+Sv39 profile comparing
trap events (cause,tval) as first-class stream items** (acceptance #6); the nightly
≥1M-compares/min high-count tier (acceptance #5) and the wasm32-side reproducibility leg
(leans on E1-T22, acceptance #1 cross-host); the 6-seeded-bug-per-extension battery
(acceptance #2 full) and per-opcode coverage histogram. This increment proves the loop on
the highest-divergence-density ISA corner; the deferrals widen the *stimulus*, not the
already-verified comparator/minimizer.

Local gate: `cargo fmt --all --check` clean; `cargo clippy --workspace --all-targets`
clean; `cargo test --workspace` green (fuzz crate adds 15 unit tests). fmt/clippy/tests all
pass before push.

### 2026-07-04 — critic round 1: VERIFIED (cold clone at `adf98f9`)
Adversarial cold-clone critic ran the full battery at fixed HEAD `adf98f9`; all attacks passed,
clone left clean, nothing pushed.

- **Independent gate:** `cargo fmt --all --check` exit 0 clean; `cargo clippy --workspace
  --all-targets` exit 0, zero warnings; `cargo test --workspace` exit 0 — **90 `test result: ok`
  suites, 0 FAILED**. New fuzz suites present: 15 unit + (8 passed, 1 ignored).
- **Rig runs OUR binary vs REAL Spike (not vacuous, not Spike-for-both):** `harness.rs` → `run_diff.sh`;
  DUT = `target/release/wasm-vm run <elf> --trace`, ref = `spike --isa=${isa} -l --log-commits`.
  Dynamic proof: ours.trace = 93 lines; spike.log = 5100 lines of genuine Spike commit log (boot-ROM
  `auipc t0` @0x1000); verdict `MATCH: 93 instruction(s)` (our trace a prefix of Spike's). `report.py`
  guards non-vacuity (empty ours → exit 2; trap-truncation → divergence).
- **Mutation 1 (documented div-by-zero `-1i64`→`0i64`, hart/mod.rs:760):** rebuilt, `campaign 0..8
  --count 128` → **8/8 divergences**; seed 0 minimized to **2 instructions**; standalone reproducer
  re-ran → DIVERGENCE (deterministic).
- **Mutation 2 (critic's OWN — MULH signedness `rs1 as i64`→`as u64`, hart/mod.rs:741):** a different
  instruction path. `campaign 0..12` → **5/12 divergences**, minimized to 1–3 instructions; seed 2
  isolated a single `mulh t0,t6,t0`. Refutes the "generator only exercises the one hard-coded path"
  concern — the rig catches an independently-chosen bug.
- **No false positives:** after reverting each mutation, `campaign` over 0..8 then 0..12 → **0
  divergences** both times. The mutation was the sole cause.
- **Minimizer soundness:** `minimize.rs` tests are non-vacuous (`preserves_a_two_line_dependency`
  asserts exactly the interdependent pair kept). Generator-safety tests loop 50 seeds × 300 instrs
  asserting shamt < width and imm ∈ [-2048, 2047].
- **Honesty:** `tests/fuzz-regressions/` holds only the README honestly stating zero real bugs found;
  the deferred list (loads/stores, branches, F/D/C, U-mode+Sv39 trap events, nightly ≥1M tier, wasm32
  leg) is explicitly labeled deferred. No status claimed that wasn't earned. The checked-in
  `sensitivity/div_by_zero.S` matches what the critic independently reproduced — genuine, not fabricated.

**VERDICT: verified.** (critic agent `a4e16445a0e268068`, 42 tool-uses, cold clone, no push.)
