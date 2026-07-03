---
id: E1-T10
epic: 1
title: Precise synchronous exceptions — cause priority, mtval/stval, mtvec dispatch
priority: 110
status: implemented
depends_on: [E1-T09]
estimate: M
capstone: false
---

## Goal
Every synchronous exception in the privileged spec is raised precisely — correct mcause
code, correct mepc (the faulting instruction, never the next one), spec-exact mtval, and
correct priority when one instruction can raise several — dispatched through mtvec with
both direct and vectored modes supported.

## Context
Privileged spec §3.1.15 (mcause codes), §3.1.16 (mtval), §3.1.7 (mtvec), and the
exception-priority table (§3.1.15, Table 3.7): instruction-address-misaligned is raised
by the *branch/jump*, breakpoint > page fault > access fault > misaligned for a given
access, illegal-instruction before any operand-related fault. Codes in scope now: 0
(insn addr misaligned), 1 (insn access fault), 2 (illegal), 3 (breakpoint/EBREAK), 4/6
(load/store-AMO addr misaligned), 5/7 (load/store-AMO access fault), 8/9/11 (ecall U/S/M);
12/13/15 (page faults) get their raise sites in T16 but the plumbing lands here. mtval:
faulting VA for misaligned/access/page faults; the instruction bits (fully expanded? no —
the *actual* encoding, 16-bit for compressed) for illegal instruction; 0 for ecall.
mtvec: MODE WARL (0 direct, 1 vectored; ≥2 reserved), BASE 4-byte aligned; vectored mode
applies to interrupts only — synchronous traps always go to BASE.

## Deliverables
- A single `Trap { cause, tval }` type; one `take_trap()` path used by every raise site
  (delegation added in T11); interpreter main loop restructured so a trapping instruction
  has zero architectural side effects (no partial register/memory writes).
- mepc/mtval/mcause written on entry; mepc bit 0 masked; misaligned-load/store policy
  decided and documented (we trap misaligned — Linux handles/avoids; matches Spike default).
- EBREAK/ECALL; illegal-instruction raise sites unified (decoder, CSR file, privilege
  checks, FP FS=Off, reserved rm, ...) all carrying the raw instruction bits into mtval.
- Priority tests: one instruction constructed to plausibly raise 2+ exceptions per row of
  the priority table, asserting the winner.

## Acceptance criteria
- [x] `jalr` to an odd address: under IALIGN=16 (C extension) JALR masks bit 0 → the target
      is even and LEGAL, so JALR can never raise cause 0 (the criterion predates the C
      extension). Cause 0 is instead reachable only via a genuinely misaligned FETCH (odd PC),
      which delivers cause 0 with mtval = the odd address and mepc = that pc (bit 0 masked).
      Both are asserted (`precise_exceptions::jalr_to_odd_lands_even`, `misaligned_fetch_...`).
- [x] A misaligned store to an unmapped-region address raises the *access fault* (our bus
      checks range before alignment — the E0-T08 "Access beats Misaligned" policy, matching
      Spike's default); `trapping_store_and_amo_leave_ram_bit_identical` + rv64mi-p-ma_addr.
- [x] Illegal 32-bit → mtval = full 32 bits; illegal compressed → 16-bit parcel; ecall →
      mtval 0. Plus a compressed op illegal at EXECUTE (C.FLD, FS=Off) reports the *parcel*,
      not the 32-bit expansion (`illegal_mtval_*`, `compressed_illegal_at_execute_*`).
- [x] With mtvec MODE=1 (vectored), an ecall still enters at BASE+0
      (`synchronous_trap_ignores_vectored_mode_enters_at_base`).
- [x] Writing mtvec with MODE=3 legalizes (readback MODE ∈ {0,1}); BASE [1:0] read 0
      (`mtvec_mode3_legalizes_and_base_low_bits_read_zero`, csr.rs WARL test).
- [x] A trapping AMO/store leaves memory bit-identical (full-RAM compare before/after); a
      trapping FP op leaves fflags unchanged (`trapping_store_and_amo_...`, `trapping_fp_load_...`).
- [x] rv64mi-p subset (scall/sbreak/ma_addr/ma_fetch + six load/store-misaligned + csr/mcsr)
      passes via real trap delivery (`riscv_tests_mi`). `illegal`/`breakpoint`/`instret_overflow`
      are excluded — they reach past T10 into E1-T11/T14/debug-triggers (documented in the harness).

## Adversarial verification
Construct compound-fault instructions and diff cause/mtval/mepc against Spike: misaligned
AMO to a PMP-forbidden region (once T15 lands: access-fault vs misaligned priority for
AMOs — spec says misaligned has *lower* priority than access fault for AMOs when the
misalignment could not succeed anyway; check Table 3.7 footnotes); EBREAK inside a
would-be-illegal encoding; a branch whose target is misaligned AND whose comparison
operands come from x0. Attack precision: instrument RAM with a write-logging shim, run
10k random trapping instructions, assert zero writes from trappers. Attack mepc: taken
trap from a compressed instruction must set mepc to that 2-byte pc (not pc&~3). Attack
mtval WARL-ness: if we claim nonzero mtval for illegal instructions, EVERY illegal site
must do it — fuzz illegal encodings (reserved funct7s, bad rm, unimplemented CSRs) and
find one site writing 0. Vectored-mode: verify synchronous traps ignore vectoring even
when cause numbers collide with interrupt numbers.

## Verification log

### 2026-07-03 — implementation
Restructured the trap path into a single precise-delivery mechanism:
- **`step`/`execute` stay PURE** — a faulting instruction returns `Err(Trap)` having touched no
  register/memory (the purity contract). Trap DELIVERY is a separate `Hart::take_trap(trap, epc)`
  that the run loop invokes, so the trap-entry CSRs are the *only* state a trapping instruction
  changes — making mepc/mcause/mtval exact by construction.
- **`Csrs::deliver_trap_m(epc, cause, tval)`** writes mepc (bit 0 masked, IALIGN=16), mcause
  (Interrupt bit 0 for synchronous), mtval, and pushes the mstatus stack via `trap_to_m`.
  `mtvec_base()` returns BASE (bits [63:2]); synchronous traps ALWAYS enter at BASE — vectored
  mode (MODE=1) is interrupts-only (§3.1.7). (Delegation to S lands in E1-T11; all traps → M.)
- **mtvec/stvec MODE WARL**: `meta` mask changed to `!0b10` so a written MODE ≥ 2 legalizes by
  clearing bit 1 (Spike's `val & ~2`) → MODE ∈ {0,1}, BASE 4-byte aligned.
- **mtval precision**: threaded the ORIGINAL fetched bits (`raw_insn`, 16-bit for compressed) into
  `execute`, replacing the expanded `insn` at every illegal-instruction site — so a compressed op
  illegal at EXECUTE (e.g. C.FLD with FS=Off) reports its 2-byte parcel, not the 32-bit expansion.
- **Run loop**: on a trap, deliver through mtvec and keep running (a guest with a handler resumes);
  if NO handler is installed (mtvec BASE == 0) surface `Trapped` to the host so the native runner
  reports a bare ECALL/EBREAK. Every real guest sets mtvec first, so delivery matches Spike; the
  escape only affects handler-less host programs. Under `zicsr-stub` the run loop always escapes
  (CSR space routes to the quarantined stub).

Notable spec realities documented in code + tests: under IALIGN=16, JALR masks bit 0 and every
jump/branch target is even, so instruction-address-misaligned (cause 0) is unreachable via control
flow — only a misaligned FETCH (odd PC) raises it. The task's "jalr to odd → cause 0" line predates
the C extension; the test asserts the RV64GC reality (JALR lands even; misaligned fetch delivers 0).

Tests: `crates/core/tests/precise_exceptions.rs` (10 tests — mepc/mtval/mtvec dispatch, vectored-vs-
direct, mtvec MODE legalization, full-RAM store/AMO purity, fp fflags purity, unhandled-trap escape);
`crates/core/tests/riscv_tests_mi.rs` (rv64mi-p subset, 12 ELFs, real trap delivery). Updated
htif_run.rs / verifier_e0t11_attacks.rs / csr.rs to the delivery model; added `Machine::step`
(pure single-step). Built the suite via `tools/riscv-tests/build-rv64mi.sh` (17 ELFs committed).

Local gate green: fmt clean; clippy 0 (real + `--features zicsr-stub`, all-targets); `cargo test
--workspace` 0 `test result: FAILED`; both wasm builds 0 FAILED. Pre-existing stub-NATIVE failures
in privilege.rs/rv64a.rs (xRET/CSR route to the stub) are unchanged and ungated (CI stub gate is
`--test riscv_tests` only). Awaiting adversarial verification.
