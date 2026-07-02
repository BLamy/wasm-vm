---
id: E2-T04
epic: 2
title: SBI Base extension + DBCN debug console + legacy console putchar/getchar
priority: 204
status: pending
depends_on: [E2-T03]
estimate: M
capstone: false
---

## Goal
A spec-compliant SBI v2.0 Base extension plus the Debug Console (DBCN) and legacy console
extensions, giving the kernel its first working output channel (`earlycon=sbi`) before any
UART exists — the single most valuable debugging tool of this epic.

## Context
SBI calling convention: `ecall` from S-mode with EID in `a7`, FID in `a6`; returns error in
`a0`, value in `a1`; `a0..a5` carry arguments. Errors: `SBI_SUCCESS`=0,
`SBI_ERR_NOT_SUPPORTED`=-2, `SBI_ERR_INVALID_PARAM`=-3, `SBI_ERR_INVALID_ADDRESS`=-5.
Base (EID 0x10): `get_spec_version` (FID 0; encoding: bits 24–30 major, 0–23 minor — return
2.0), `get_impl_id` (pick and register a value; document it), `get_impl_version`,
`probe_extension` (FID 3; returns 0 in `value` for absent extensions, nonzero for present —
*not* an error), `get_mvendorid`/`get_marchid`/`get_mimpid`. DBCN (EID 0x4442434E):
`console_write` (FID 0: num_bytes, base_addr_lo, base_addr_hi — physical addresses, must be
validated against the bus), `console_read` (FID 1), `console_write_byte` (FID 2). Legacy:
EID 0x01 `console_putchar`, EID 0x02 `console_getchar` (returns -1 in `a0` when no byte;
legacy calls clobber only `a0`). Keep `CONFIG_RISCV_SBI_V01` compat in mind: Linux earlycon
`sbi` uses DBCN when probed, else legacy. Console byte sink/source goes through the same
host-console trait Epic 0 built, not directly to stdout.

## Deliverables
- `crates/core/src/sbi/{base,dbcn,legacy}.rs` wired into the E2-T03 dispatch skeleton.
- Unit tests: register-level `ecall` tests for every FID, including error paths.
- A bare-metal guest test binary that prints via DBCN and legacy paths and echoes input.

## Acceptance criteria
- [ ] `probe_extension` on Base/TIME/IPI/RFENCE/HSM/DBCN returns per plan; unknown EIDs
      (e.g., 0x0A PMU) return value 0 with SBI_SUCCESS.
- [ ] `spec_version` decodes to major 2, minor 0; reserved bit 31 is zero.
- [ ] DBCN `console_write` with a base address outside DRAM returns
      `SBI_ERR_INVALID_PARAM`/`INVALID_ADDRESS` without panicking; partial-write semantics
      (bytes written returned in `a1`) implemented.
- [ ] Linux kernel with `earlycon=sbi` produces early boot output on our emulator (may be
      verified as part of E2-T14/T15 bring-up; a bare-metal test suffices here).
- [ ] All tests green on native and `wasm32`.

## Adversarial verification
Fuzz the dispatcher: random EID/FID/arg values for 10^6 calls from a bare-metal S-mode
stub — any panic, hang, or state corruption refutes. DBCN attacks: num_bytes=0;
base+len wrapping past 2^64; buffer straddling end of DRAM; buffer pointing at MMIO — each
must return an SBI error, never fault the host. Legacy `console_getchar` with empty input
must return -1, not block. Diff behavior against OpenSBI running under
`qemu-system-riscv64 -machine virt` with the same probing stub: any divergence in error
codes or probe results that Linux could observe is a refutation.

## Verification log
(empty)
