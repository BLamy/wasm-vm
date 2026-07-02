---
id: E1-T12
epic: 1
title: CLINT — mtime/mtimecmp/msip, machine timer and software interrupts
priority: 112
status: pending
depends_on: [E1-T11]
estimate: S
capstone: false
---

## Goal
A SiFive-compatible CLINT device on the memory bus at 0x0200_0000 providing the machine
timer (mtime/mtimecmp driving mip.MTIP) and the software-interrupt register (msip driving
mip.MSIP), with a defined mtime advance policy for both native and browser execution —
the heartbeat OpenSBI and the Linux scheduler tick depend on.

## Context
The CLINT layout QEMU-virt/OpenSBI expect: msip hart0 at base+0x0 (32-bit, bit 0
significant), mtimecmp hart0 at base+0x4000 (64-bit), mtime at base+0xBFF8 (64-bit).
Semantics: MTIP is pending iff mtime >= mtimecmp (a *level*, continuously re-evaluated —
writing mtimecmp above mtime clears MTIP); msip bit 0 mirrors directly into mip.MSIP.
mtime advance policy must be deterministic for testing: we drive mtime from retired
instruction count with a configurable divider (e.g. 1 tick / 10 instructions ≈ 10 MHz at
100 MIPS), with a host-clock mode available later for wall-time accuracy at Level 2+.
Privileged spec §3.2.1 defines mtime/mtimecmp; the address map is platform convention.

## Deliverables
- `clint.rs` device implementing the bus trait from Epic 0: 4- and 8-byte reads/writes at
  the three registers (partial-width access to mtime/mtimecmp per QEMU behavior:
  32-bit halves supported).
- MTIP/MSIP level generation wired into the T11 mip logic (device owns the bits; CSR
  writes to them remain ignored).
- Deterministic instruction-count clock source behind a `ClockSource` trait; divider in
  machine config; documented in the device's module docs.
- Tests: timer fires at the exact retire boundary where mtime crosses mtimecmp; writing
  mtimecmp = u64::MAX as two 32-bit halves (low then high) doesn't glitch a spurious
  interrupt (write high half first — document the 32-bit-write idiom from the spec).

## Acceptance criteria
- [ ] A bare-metal program setting mtimecmp = mtime + 1000 with MTIE/MIE enabled traps to
      mtvec with mcause 0x8000_0000_0000_0007 after exactly the expected retire count.
- [ ] Writing mtimecmp > mtime while MTIP pending clears MTIP without any CSR access.
- [ ] Writing 1 then 0 to msip sets then clears mip.MSIP, observable via csrr.
- [ ] mtime is writable (spec: mtime is writable memory-mapped) and reads back.
- [ ] 32-bit accesses to both halves of mtime/mtimecmp behave as on QEMU-virt.
- [ ] Identical interrupt-delivery retire index native vs wasm32 for the same program
      (determinism of the instruction-count clock).

## Adversarial verification
Refute determinism first: run the timer test 100× in both builds and diff the retire index
of trap entry — any variance refutes. Attack the level semantics: set mtimecmp in the
past (MTIP immediately pending), enter WFI — must wake instantly; then raise mtimecmp
inside the handler without clearing anything else and prove MTIP drops (a sticky-bit
implementation fails this). Attack access widths: 1- and 2-byte accesses to CLINT
registers — match QEMU-virt's behavior (test on real qemu-system-riscv64, document, then
diff). Attack the rollover: set mtime = u64::MAX - 5, mtimecmp = 2, and verify the
comparison is unsigned (no interrupt until wrap actually occurs). Cross-check against
QEMU-virt running the same bare-metal ELF with -icount for determinism.

## Verification log
(empty)
