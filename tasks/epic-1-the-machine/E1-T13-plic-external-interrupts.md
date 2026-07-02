---
id: E1-T13
epic: 1
title: PLIC — priorities, enables, thresholds, claim/complete, M and S contexts
priority: 113
status: pending
depends_on: [E1-T11]
estimate: M
capstone: false
---

## Goal
A QEMU-virt-compatible PLIC at 0x0C00_0000 routing up to 32 external interrupt sources
through per-source priorities, per-context enable bits and priority thresholds, and the
claim/complete handshake, driving mip.MEIP (hart0 M context) and mip.SEIP (hart0 S
context) — the front door every Level 2 device (UART, virtio) will ring.

## Context
The RISC-V PLIC spec (riscv-plic-1.0.0) with the QEMU-virt memory map Linux's device tree
expects: source priorities at base+0x0 (source i at +4*i; source 0 nonexistent), pending
bits at +0x1000, enable bits at +0x2000 + 0x80*context, threshold at +0x200000 +
0x1000*context, claim/complete at threshold+4. Contexts: hart0/M = 0, hart0/S = 1.
Semantics: a source with priority 0 never interrupts; context EIP is asserted while any
pending&enabled source has priority > threshold; CLAIM read returns the highest-priority
such source (ties broken by lowest source id) and clears its pending bit; COMPLETE write
of that id re-opens the gateway. Level-triggered gateway model: a source held high
re-pends after complete.

## Deliverables
- `plic.rs` bus device: 32 sources, 2 contexts, 32-bit register accesses per the map
  above; an `IrqLine` handle devices use to assert/deassert source levels.
- EIP evaluation on every relevant state change, wired to mip.MEIP/mip.SEIP via the T11
  interrupt logic (PLIC owns those mip bits; CSR writes to them remain ignored).
- A test-only software-triggered source for exercising the machinery before real devices.
- Unit tests: threshold masking, priority ties, claim-clears-pending, double claim
  (second returns 0), complete of a stale/wrong id (ignored), level re-pend after
  complete, independent M vs S context routing.

## Acceptance criteria
- [ ] Source 5 pending, enabled in context 1 only, priority 3, threshold 0 → mip.SEIP set,
      mip.MEIP clear; claim from context 1 returns 5 and drops SEIP (until re-pend).
- [ ] With threshold = 7 and all priorities ≤ 7, no EIP is asserted for that context.
- [ ] Two sources pending (ids 3 and 9, equal priority) → claim returns 3, then 9.
- [ ] Claim when nothing is pending&enabled returns 0 and changes no state.
- [ ] While a source is claimed and not completed, its level re-assertion does not
      re-pend it; after COMPLETE it does (gateway semantics).
- [ ] A bare-metal program takes an MEIP interrupt through mtvec, claims, handles, and
      completes; the same wired to S via mideleg[9] delivers through stvec with scause
      0x8000_0000_0000_0009.
- [ ] Register map accesses match qemu-system-riscv64 `virt` for the same sequence
      (probe program run on both, register dumps diffed).

## Adversarial verification
Refute the map first: run a probe binary on real QEMU-virt (single-hart) that walks every
implemented PLIC register — write patterns, read back — and diff the dump against ours;
any offset/width/reset-value divergence is a refutation. Attack the handshake state
machine: claim from context 0 and complete from context 1 (must not release context 0's
gateway); complete with an id never claimed; claim twice without complete; enable-bit
changes between pend and claim. Attack EIP recomputation: raise threshold above the
pending source's priority *after* EIP asserts — EIP must drop without any claim. Attack
the T11 integration: pend a PLIC source and a CLINT timer simultaneously and verify MEI >
MTI ordering end-to-end. A stuck EIP after any sequence, or interrupt delivery while
threshold masks it, refutes.

## Verification log
(empty)
