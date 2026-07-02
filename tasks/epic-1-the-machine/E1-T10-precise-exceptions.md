---
id: E1-T10
epic: 1
title: Precise synchronous exceptions — cause priority, mtval/stval, mtvec dispatch
priority: 110
status: pending
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
- [ ] `jalr` to an odd address raises cause 0 with mtval = the odd target and mepc = the
      jalr's own pc.
- [ ] A misaligned store to an unmapped-region address raises the *access fault* vs
      *misaligned* winner exactly as Spike does for the same address map.
- [ ] Illegal 32-bit instruction sets mtval to the full 32 bits; illegal compressed sets
      the 16-bit parcel (zero-extended); ecall sets mtval = 0.
- [ ] With mtvec MODE=1 (vectored), an ecall still enters at BASE+0, not BASE+4×cause.
- [ ] Writing mtvec with MODE=3 legalizes (readback MODE ∈ {0,1}); BASE bits [1:0] read 0.
- [ ] A trapping AMO/store leaves memory bit-identical (proven by full-RAM hash
      before/after); a trapping FP op leaves fflags unchanged.
- [ ] rv64mi-p-* subset covering scall/sbreak/illegal/ma_addr/ma_fetch passes both builds.

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
(empty)
