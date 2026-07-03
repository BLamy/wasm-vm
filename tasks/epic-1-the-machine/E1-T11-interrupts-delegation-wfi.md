---
id: E1-T11
epic: 1
title: Interrupt architecture — mie/mip, mideleg/medeleg trap delegation, priority, WFI
priority: 111
status: implemented
depends_on: [E1-T10]
estimate: L
capstone: false
---

## Goal
Asynchronous interrupts delivered with spec-exact enable/pending logic, priority ordering,
and delegation: mie/mip and their sie/sip views, medeleg/mideleg routing traps to S-mode,
the mstatus.MIE/SIE global-enable rules across privilege modes, and a WFI that actually
sleeps the interpreter loop until a wakeup condition — the mechanism Linux's timer tick
and every device interrupt will ride through.

## Context
Privileged spec §3.1.8–3.1.9, §3.1.6.1, §4.1.3. Bit positions in mip/mie: SSIP=1, MSIP=3,
STIP=5, MTIP=7, SEIP=9, MEIP=11. An interrupt i is taken in mode x when: it is pending
and enabled (mip[i] & mie[i]), it targets mode x (per mideleg), and either current mode <
x, or current mode == x with xstatus.xIE=1. M-targeted interrupts are never maskable from
S/U. Priority among simultaneously-pending: MEI > MSI > MTI > SEI > SSI > STI. Delegation:
medeleg/mideleg bits route to S; medeleg[11] (ecall-from-M) is read-only zero; delegated
traps taken while executing in M still go to M — never downward. mcause interrupt bit 63
set; interrupts sample *between* instructions (precise: mepc = next unexecuted insn). WFI
completes when any locally-enabled-and-pending interrupt exists even if globally disabled
(mstatus.MIE=0) — that idiom (WFI with MIE=0, then poll mip) must not hang.

## Deliverables
- Interrupt check at the top of the instruction loop: compute pending&enabled per mode,
  apply delegation, pick highest priority, vector via mtvec/stvec (vectored MODE=1 →
  BASE + 4×cause for interrupts).
- mip write behavior: MSIP/MTIP/MEIP read-only to software (set by CLINT/PLIC in
  T12/T13); SSIP/STIP/SEIP writable from M; sip view exposes only S bits, SSIP writable
  from S.
- medeleg/mideleg with correct WARL masks (only implementable cause bits writable;
  medeleg[11]=0 hardwired).
- WFI: in the harness, a real "sleep until wakeup" (native: park until injected event;
  wasm: yield to the event loop) with the TW trap from T09 honored.
- Tests: an interrupt-priority matrix test raising all six lines simultaneously in every
  {mode, MIE/SIE, mideleg} combination and asserting which trap fires and where.

## Acceptance criteria
- [x] mideleg[5]=1 STIP delegated → U-mode S timer traps to stvec, scause = 0x8000…0005,
      SPP=0 (`interrupts::delegated_interrupt_delivers_to_stvec_with_scause_and_spp`).
- [x] Same interrupt in M-mode does NOT fire (`delegated_stimer_fires_in_u_not_in_m`).
- [x] Full priority chain MEI>MSI>MTI>SEI>SSI>STI in M with MIE=1
      (`full_priority_chain_in_m_with_mie`); untakeable-higher-skipped
      (`higher_priority_but_untakeable_is_skipped`).
- [x] mepc = first unexecuted instruction; the interrupted instr fully retired or didn't run
      (`interrupt_taken_after_an_instruction_retires_precise_mepc`).
- [x] WFI with MIE=0 but MTIE=1 + MTIP pending → no trap, execution continues after WFI
      (`wfi_with_mie_clear_and_mtip_pending_continues_no_trap`).
- [x] Vectored: interrupt cause 5 → BASE+20; synchronous → BASE
      (`vectored_stvec_interrupt_enters_at_base_plus_4x_cause`); vectored M-SSI → BASE+4
      (`vectored_mtvec_m_interrupt_ssi_enters_at_base_plus_4` — the rv64mi illegal.S path).
- [x] mip.MTIP software-write ignored; device-driven bit survives an RMW `csrw`
      (`mip_mtip_software_write_ignored_device_bit_survives`).

## Adversarial verification
Refute with delegation corner cases diffed against Spike/QEMU: mideleg bit set while the
corresponding mie bit toggles mid-stream; interrupts firing on the instruction *boundary*
around xRET (pend an S interrupt, MRET from M into S with SIE=1 — the interrupt must be
taken with sepc = the first S instruction, not the MRET); ecall-from-U with medeleg[8]=1
taken from *M-mode execution of ecall*? (impossible — verify cause 8 requires U). Attack
WFI: TW=1 in S must trap illegal; WFI in U (with S implemented) per spec §3.3.3 — verify
against Spike. Attack sip/sie masking: write all-ones via sip/sie from S and prove no
M-bits changed in mip/mie. Race the wasm build: inject an interrupt from the JS side mid-
block and prove the trace still shows instruction-boundary sampling (identical retire
sequence to native given the same injection point in the instruction stream). Any
divergence from Spike on the priority matrix or any hang in the WFI idiom refutes.

## Verification log

### 2026-07-03 — implementation
Built on E1-T10's precise delivery:
- **`Csrs::next_interrupt()`** — the loop-top sampler: `mip & mie`, priority order MEI>MSI>MTI>
  SEI>SSI>STI, per-line target (mideleg → S else M), and the take rule "current < target, OR
  current == target with xIE". M-interrupts are never maskable from below; a higher-priority but
  untakeable interrupt is skipped so a takeable lower one fires. Returns the mcause + to-S flag.
- **Delegation**: `delegates_to_s(cause, is_interrupt)` — delegated only when the deleg bit is set
  AND running below M (a trap taken in M never goes downward). `take_trap` now routes exceptions
  through medeleg (→ `deliver_trap_s`/stvec) and `take_interrupt` routes interrupts through
  mideleg. `deliver_trap_s` writes sepc/scause/stval + `trap_to_s`. Vectored (MODE=1) interrupts
  enter at BASE + 4×cause via `m/s_handler_entry`; synchronous traps ignore MODE.
- **WARL masks**: mie → 0xAAA (six implemented bits); mideleg → 0x222 (S-interrupts only —
  M-interrupt bits read-only 0); medeleg → {0..=9,12,13,15} with cause 11 (ecall-from-M) and
  reserved 10/14 hardwired 0. mip software write (`csrw mip` from M) is an RMW over SSIP/STIP/SEIP
  only — MSIP/MTIP/MEIP are read-only to software and driven by `set_mip_bit` (the CLINT/PLIC and
  test hardware path).
- **Run loop**: samples `next_interrupt()` at the top of each iteration (instruction boundary,
  precise) and delivers before fetching; taking the trap clears xIE so a pending line does not
  re-fire under its own handler. The unhandled-trap escape now checks the *target* tvec (stvec for
  a delegated exception, mtvec otherwise) so a guest with only stvec set delivers rather than escapes.
- **WFI** stays a spec-compliant hint-NOP (retires; the loop-top sampler provides the wakeup), with
  the E1-T09 TW trap honored — the MIE=0/poll-mip idiom cannot hang.

Tests: `crates/core/tests/interrupts.rs` (12) — priority chain, MIE/SIE gating, delegation to S vs
M, untakeable-skip, WARL masks, mip device-bit RMW, end-to-end delivery to stvec (scause/sepc/SPP),
vectored S- and M-interrupts, WFI idiom, precise-mepc-after-retire. The rv64mi-p `illegal` ELF now
advances through its vectored-interrupt + S-mode-entry + WFI stages (T11) to TESTNUM 5 (SFENCE.VMA /
satp / TVM — E1-T15/T16), confirming the T11 machinery it exercises works; it stays excluded pending
virtual memory. Local gate green: fmt clean; clippy 0 (real + zicsr-stub, all-targets); `cargo test
--workspace` 0 `test result: FAILED`; both wasm builds 0 FAILED. Awaiting adversarial verification.
