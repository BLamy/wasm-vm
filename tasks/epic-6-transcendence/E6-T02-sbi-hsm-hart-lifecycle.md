---
id: E6-T02
epic: 6
title: SBI HSM extension — hart_start, hart_stop, hart_suspend, status
priority: 602
status: pending
depends_on: [E6-T01]
estimate: M
capstone: false
---

## Goal
Our SBI firmware layer implements the Hart State Management extension (EID 0x48534D) with
the full state machine — STARTED / STOPPED / START_PENDING / STOP_PENDING / SUSPENDED /
SUSPEND_PENDING / RESUME_PENDING — so the Linux kernel can bring secondary harts online
through the standard `cpu_ops` SBI path and offline them again.

## Context
Linux's riscv SMP bringup (`arch/riscv/kernel/cpu_ops_sbi.c`) requires HSM: the boot hart
calls `sbi_hart_start(hartid, start_addr, opaque)`; the target must begin execution at
`start_addr` in S-mode with `a0=hartid`, `a1=opaque`, `satp=0`, `sstatus.SIE=0`, all other
state unspecified. `hart_stop` is called by the stopping hart itself with interrupts
disabled. `hart_suspend` takes suspend_type (0x0 retentive, 0x80000000 non-retentive,
where non-retentive resumes like hart_start at the given resume_addr). CPU hotplug
(`echo 0 > /sys/devices/system/cpu/cpuN/online`) exercises stop/start cycles. Boot
protocol: exactly one boot hart runs; secondaries are held STOPPED until started.

## Deliverables
- `sbi/hsm.rs`: the four functions with the spec state machine and error codes
  (SBI_ERR_INVALID_PARAM for bad hartid/address, SBI_ERR_ALREADY_AVAILABLE for a started
  hart, SBI_ERR_FAILED as documented fallback).
- Per-hart lifecycle state in `Machine`; STOPPED harts consume zero scheduler quanta.
- Start path: reset the target hart's execution state, set priv=S, pc=start_addr,
  a0/a1 per spec; validate start_addr against physical memory bounds.
- Non-retentive vs retentive suspend semantics; resume on interrupt for retentive.
- Bare-metal multi-hart test binary: boot hart starts each secondary at a trampoline that
  reports (hartid, a0, a1, priv-mode probe) to a result array, then stops itself.

## Acceptance criteria
- [ ] `hart_get_status` returns STOPPED for all secondaries at reset and STARTED after
      `hart_start`; the full transition sequence is asserted by the test binary.
- [ ] Starting an already-started hart returns SBI_ERR_ALREADY_AVAILABLE; hartid ≥
      n_harts and non-existent start_addr return SBI_ERR_INVALID_PARAM.
- [ ] The started hart observes a0=hartid, a1=opaque, S-mode, satp=0 (probe traps on
      S-mode CSR access patterns confirm privilege).
- [ ] A hart that calls `hart_stop` never executes another instruction until restarted.
- [ ] Same test binary passes native and wasm32.

## Adversarial verification
Diff behavior against OpenSBI on QEMU `virt -smp 4` with the same bare-metal test: any
difference in returned error codes, entry register state, or status-query results is a
refutation. Attack angles: (1) start_addr pointing at MMIO or unmapped space — spec says
INVALID_PARAM, check we don't jump first and fault later; (2) racing hart_start twice for
the same hart from two different harts in one scheduler quantum — status must never show
two STARTED transitions; (3) retentive suspend then send an IPI — hart must resume with
all state intact (checksum the register file before/after); (4) hart_stop with pending
interrupts — verify they stay pending and deliver after restart; (5) call HSM functions
from U-mode in the guest and confirm they don't work (ecall routes to S-mode kernel, not
firmware).

## Verification log
(empty)
