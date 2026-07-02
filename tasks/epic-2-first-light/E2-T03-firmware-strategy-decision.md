---
id: E2-T03
epic: 2
title: Firmware decision — built-in SBI in the emulator vs OpenSBI as guest payload
priority: 203
status: pending
depends_on: [E2-T01]
estimate: S
capstone: false
---

## Goal
A written, evidence-backed architecture decision record choosing between (a) implementing
SBI directly in the emulator (the emulator *is* the M-mode firmware; kernel entered in
S-mode) and (b) running an unmodified OpenSBI `fw_jump`/`fw_dynamic` binary as an M-mode
guest payload — fixing the kernel entry contract for every subsequent boot task.

## Context
Option (b) is maximally authentic: OpenSBI exercises our M-mode CSRs, PMP, and trap
delegation exactly as hardware would, and its banner is a great Level 1 smoke test. But it
adds an opaque 200KB+ binary to every debug session, requires PMP and `mcounteren`/
`medeleg`/`mideleg` semantics to be flawless, and makes SBI bugs bisectable only through
OpenSBI's own sources. Option (a) is the TinyEMU/JSLinux approach: trap `ecall`-from-S in
the emulator, implement SBI v2.0 in Rust — fully debuggable, no M-mode execution on the hot
path, but *we* own spec compliance (E2-T04..T06) and lose OpenSBI as an M-mode test. The
decision must state: entry mode and address (e.g., kernel Image at `0x8020_0000`, entered
in S-mode with `a0`=hartid, `a1`=DTB), what happens to M-mode CSR visibility, how
`medeleg`/`mideleg` are configured at reset, and a fallback plan (can we still boot OpenSBI
later as a compliance exercise?). Evaluate empirically, not rhetorically: prototype both far
enough to see the first kernel/OpenSBI output lines.

## Deliverables
- `docs/adr/0002-sbi-firmware.md`: options, evaluation evidence (what was actually run and
  what it printed), decision, consequences, revisit conditions.
- The chosen boot path stubbed in code: reset state setup, payload load addresses, and the
  `ecall` routing skeleton (SBI dispatch enum, no extensions implemented yet).
- If (b) is rejected: a tracked follow-up note describing what OpenSBI-as-testcase would
  still verify about our M-mode, so the coverage loss is explicit.

## Acceptance criteria
- [ ] ADR contains transcripts/screenshots of both prototypes' first output (OpenSBI banner
      attempt, or S-mode entry reaching the kernel's first SBI call), not just argument.
- [ ] Entry contract (mode, PC, a0/a1, initial `satp`/`sstatus`/delegation state) is stated
      precisely enough that E2-T15 can be implemented against it without asking questions.
- [ ] SBI dispatch skeleton compiles on native and `wasm32`; unknown EID returns
      `SBI_ERR_NOT_SUPPORTED` (-2) rather than trapping or panicking.
- [ ] ADR names the SBI spec version targeted (v2.0) and lists exactly which extensions
      Epic 2 will implement: Base, TIME, IPI, RFENCE, HSM, DBCN, legacy 0x01/0x02.

## Adversarial verification
Attack the ADR's factual claims, not its taste. Check: does Linux 6.6 actually require the
claimed minimum SBI version (read `arch/riscv/kernel/sbi.c`)? If (b) was rejected "because
PMP is incomplete", run the riscv-tests PMP cases and see whether that claim is even true.
If (a) was chosen, boot OpenSBI `fw_jump.bin` from the QEMU distribution on our emulator
anyway — if it gets *further* than the ADR predicted, the evaluation was shallow: refute.
Confirm the reset-state table in the ADR by dumping actual CSR state at first instruction
in a trace. Any contradiction between ADR and code skeleton is a refutation.

## Verification log
(empty)
