---
id: E1-T01
epic: 1
title: Spec-correct machine reset and initial architectural state
priority: 101
status: pending
depends_on: [E0]
estimate: S
capstone: false
---

## Goal
The hart comes out of reset in exactly the state the privileged spec (§3.4, "Reset")
mandates, with a single authoritative `Hart::reset()` that every test harness, the WASM
entry point, and future snapshot/restore all go through — no ad-hoc field initialization
scattered across constructors.

## Context
Epic 0's skeleton initializes registers informally. Everything in Epic 1 — CSR semantics,
trap entry, riscv-tests, RISCOF — assumes a defined reset state, and RISCOF in particular
will diff us against Sail/Spike from instruction zero. Getting reset wrong produces
divergences that look like decoder bugs. Reference: RISC-V Privileged Spec §3.4; misa
encoding §3.1.1.

## Deliverables
- `Hart::reset(reset_vector: u64)` in the core crate; all constructors delegate to it.
- Reset state: privilege = M; `mstatus.MIE = 0`, `mstatus.MPRV = 0`; `pc = reset_vector`
  (default `0x8000_0000` to match Spike/QEMU `virt`); `mcause = 0`.
- `misa` reporting MXL=2 (RV64) and extension bits I, M, A, F, D, C, S, U set (RV64GC +
  S/U modes); writable-but-ignored (WARL, we hardwire).
- `mhartid = 0`, read-only; `mvendorid`/`marchid`/`mimpid` readable as 0 (legal per spec).
- Integer registers: `x0` hardwired zero (enforced on every write, not just reset).
- A unit test asserting the full reset state, run natively and under `wasm32` in CI.

## Acceptance criteria
- [ ] After `reset()`, a CSR dump of misa/mhartid/mstatus/mcause matches the values above.
- [ ] `misa` reads `0x800000000014112D` (MXL=2; A,C,D,F,I,M,S,U bits).
- [ ] Writing `x0` via any instruction (e.g. `add x0, x1, x2`) leaves it zero.
- [ ] Two consecutive `reset()` calls after arbitrary execution yield bit-identical state
      (proven by a test that runs 10k random instructions, resets, and compares a full
      state serialization against a fresh hart).
- [ ] The same reset-state test passes under `cargo test` and the wasm32 test runner.

## Adversarial verification
Refute by finding any reset-visible divergence from Spike: boot Spike (`spike -d` or the
Sail model) with a trivial ELF at 0x80000000 whose first instructions dump
misa/mhartid/mstatus/mstatush-equivalents to the signature region, and diff against our
dump. Attack angles: (1) dirty-state leakage — run a program that sets mstatus.FS dirty,
writes FP regs and satp, then reset and prove any field survives; (2) x0 writability via
compressed forms or CSR instructions with rd=x0; (3) WASM build reporting a different misa
or pc due to 64-bit constant truncation through the bindgen boundary. Any single field
differing from the documented reset state, or between native and WASM, is a refutation.

## Verification log
(empty)
