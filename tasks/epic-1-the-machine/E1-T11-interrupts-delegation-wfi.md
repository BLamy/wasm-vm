---
id: E1-T11
epic: 1
title: Interrupt architecture — mie/mip, mideleg/medeleg trap delegation, priority, WFI
priority: 111
status: pending
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
- [ ] With mideleg[5]=1 (STIP delegated), a pending-enabled supervisor timer interrupt in
      U-mode traps to stvec with scause = 0x8000_0000_0000_0005 and sstatus.SPP=0.
- [ ] The same interrupt while in M-mode does NOT fire (M > delegated target S).
- [ ] All six lines pending+enabled in M with MIE=1 → MEIP wins; clear it → MSIP; etc.,
      full priority chain asserted.
- [ ] mepc after an interrupt points at the first unexecuted instruction; the interrupted
      instruction either fully retired or didn't run (no mid-instruction state).
- [ ] WFI with mstatus.MIE=0 but mie.MTIE=1 returns when MTIP goes pending (no trap taken,
      execution continues after WFI).
- [ ] Vectored stvec: interrupt cause 5 enters at BASE+20; synchronous still at BASE.
- [ ] Writes to mip.MTIP from software are ignored (readback unchanged).

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
(empty)
