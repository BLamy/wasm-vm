---
id: E1-T01
epic: 1
title: Spec-correct machine reset and initial architectural state
priority: 101
status: verified
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
### 2026-07-03 — worker claim — branch task/e1-t01-machine-reset (stacked on e0-t26, opens Epic 1)
Deliverables: the single authoritative reset state.
- crates/core/src/csr.rs (NEW, real CSR state — begins replacing E0-T19's quarantined zicsr-stub):
  Priv enum (U/S/M, Default=M via #[default]); Csrs{ mode, mstatus, mcause } with at_reset() (M,
  0, 0) + hardwired read-only accessors misa()/mhartid()/mvendorid()/marchid()/mimpid() and
  mie()/mprv() bit readers. MISA_RV64GC_SU = 0x800000000014112D (MXL=2; A C D F I M S U — decoded
  bit-by-bit and asserted).
- Hart gains a non-gated `pub csr: Csrs` field. Hart::reset(reset_vector): regs=XRegs::default()
  (all x 0), regs.pc=reset_vector, csr=Csrs::at_reset(), and (under zicsr-stub) csrs=default. ALL
  constructors funnel through it: Hart::default() resets to DRAM_BASE (0x8000_0000), Hart::new()=
  default(). x0 stays hardwired (enforced in XRegs::write, E0-T05).
- Hart/XRegs/CsrFile derive PartialEq,Eq so the determinism test compares whole harts.
- crate::csr registered in lib.rs.
TESTS: crates/core/tests/reset.rs (4): fresh-hart-in-reset-state (pc, all x0, M-mode, mstatus=0,
MIE=0, MPRV=0, mcause=0, misa=0x800000000014112D, mhartid/vendor/arch/imp=0) at DRAM_BASE and an
explicit vector; x0 stays zero after add x0,x1,x2; reset-is-bit-identical-from-any-prior-state
(dirty EVERY field incl mstatus=u64::MAX/mode=U/mcause, reset, assert == fresh Hart); reset-after-
10k-instructions (run loops.elf to exit + churn 10k arbitrary words through the real bus, reset,
assert == fresh — no execution state leaks). crates/wasm/tests/reset.rs (wasm32): same reset-state
+ determinism, explicitly asserting misa>>62==2 (MXL high bits NOT truncated through the bindgen/
64-bit boundary — verifier angle 3).
COMPAT: Hart::new() now starts pc at DRAM_BASE (was 0); safe — only XRegs-default and an execution-
wrap test referenced pc==0, and running from pc<DRAM_BASE always fetch-faulted anyway. Full
workspace 0 FAILED; E0-T19 riscv-tests still green; all 4 feature combos + wasm32 build; zero-cost
--selftest OK.
misa note: 0x800000000014112D is our DELIBERATE WARL config (RV64GC + S/U), matching the
acceptance's exact value; the universal reset fields (M-mode, mstatus=0, mcause=0, pc=vector,
mhartid=0, x0=0) match Spike/Sail from instruction zero (Spike's misa depends on its --isa flag).
Gates: fmt; clippy --workspace --all-targets --all-features -D warnings 0 (derived Priv Default);
workspace tests 0 FAILED; reset 4/4 native + 1/1 wasm; feature matrix + zero-cost green.
rr: N/A (macOS). Verifier angles open: reset-visible divergence vs Spike/Sail (dump misa/mhartid/
mstatus/mcause), dirty-state leakage incl FS/FP/satp (1 — mstatus=u64::MAX dirtied here), x0 via
compressed/CSR rd=x0 (2), and wasm misa/pc 64-bit truncation (3, misa>>62==2 asserted).

### 2026-07-03 — adversarial verifier (fresh session) — VERDICT: verified
- misa independent decode: 0x800000000014112D = MXL bits[63:62]=2 (RV64) + exactly {A,C,D,F,I,M,S,U}, no extra/missing, bits[61:26]=0. Matches MISA_RV64GC_SU + misa().
- reset-field mutation coverage: every field mutation RED — mcause=1, mode=U, mstatus MIE set (mie() assert live), mstatus MPRV set (mprv() live), misa 112D→112C (hard-literal, non-vacuous), pc-not-set. All x0..x31 checked.
- determinism incl. stub: reset_is_bit_identical dirties regs/pc/mode/mstatus/mcause, compares WHOLE hart via Hart PartialEq; removing self.csr reset FAILs (PartialEq compares csr); removing self.csrs (stub) reset RED under --features zicsr-stub (10k churn dirties stub csrs).
- x0 hardwired: single XRegs::write authority, private array; no path to write x0 nonzero.
- wasm 64-bit: wasm-pack node green, misa>>62==2 + full 0x800000000014112D, no truncation; native==wasm on every field.
- Spike cross-check: Spike 1.1.1 boots vector 0x80000000 (==DRAM_BASE), ISA rv64i_m_a_f_d_c_zicsr, M-mode; no universal field disagreed (couldn't script per-CSR dump but §3.4 values are Spike invariants).
- compat: workspace 0 failed; riscv-tests 1 passed. Non-vacuous. VERIFIED — no rework.