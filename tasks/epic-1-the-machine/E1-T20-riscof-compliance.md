---
id: E1-T20
epic: 1
title: RISCOF architectural compliance — DUT plugin, Sail reference, signature diff
priority: 120
status: pending
depends_on: [E1-T19]
estimate: L
capstone: false
---

## Goal
A working RISCOF flow: our emulator packaged as a RISCOF DUT plugin, the RISC-V Sail
model (Spike as fallback) as the reference, riscv-arch-test suites for
RV64IMAFDC_Zicsr_Zifencei + privilege running end-to-end with signature comparison — the
official "is it architecturally RISC-V" verdict the Level 1 capstone requires.

## Context
RISCOF (riscof.readthedocs.io) drives riscv-arch-test: each test is compiled per the DUT's
declared ISA/platform yamls, run on DUT and reference, and both dump a memory *signature*
region (RVMODEL_DATA_BEGIN/END) that must match bit-exactly. We need: (1) a DUT plugin
(Python class riscof_wasm_vm.py) declaring the isa yaml (RV64IMAFDCZicsr_Zifencei,
misaligned policy, the Svade choice from T16) and platform yaml (mtvec reset, tohost
address); (2) an RVMODEL macro header (model_test.h) defining halt (tohost write),
signature dump, and IO macros for our machine; (3) a signature-dump exit path in the
native binary (CLI flags `--signature=FILE --signature-granularity=4`); (4) the Sail
reference (riscv_sim_RV64) built at a pinned commit. Environment pinning matters:
riscof, riscv-arch-test, and sail binaries all lockfiled. The wasm32 leg reuses
signatures: run DUT tests under the wasm harness and diff signatures against the native
DUT run AND the reference.

## Deliverables
- `compliance/` directory: DUT plugin, isa/platform yamls, model_test.h, config.ini,
  provisioning script for sail-riscv + riscv-arch-test at pinned commits.
- Signature-region dump support in the core (write region to file/JS callback at HTIF
  halt), 4-byte granularity per RISCOF convention.
- `make riscof` target producing RISCOF's HTML report; CI job (native mandatory; wasm
  signature-equivalence job alongside).
- Documented divergence policy: any test excluded must be listed with spec-cited
  justification in `compliance/EXCLUSIONS.md` (target: empty by capstone).

## Acceptance criteria
- [ ] `make riscof` runs the I, M, A, F, D, C, Zicsr, Zifencei, and privilege suites of
      riscv-arch-test and RISCOF's report shows 0 failed signature comparisons
      (or only EXCLUSIONS.md-listed entries during development).
- [ ] The isa yaml honestly matches misa from T01 (a yaml claiming less than misa to
      dodge tests is caught by a cross-check in CI: parse both and compare).
- [ ] wasm32 DUT run over the full test list yields signatures byte-identical to the
      native DUT run.
- [ ] Seeded-bug mutation (e.g. wrong sign extension in LWU) produces ≥1 signature
      mismatch and a red run.
- [ ] Full flow reproduces from clean checkout via one documented command (hermetic
      provisioning, pinned shas).

## Adversarial verification
First attack the plumbing, which is where compliance runs lie: verify the DUT plugin
actually invokes OUR binary (strace/log the exec; a plugin accidentally running spike for
both sides produces a perfect green run — check the two signature files differ when a
known-divergent mutation is inserted). Diff the isa/platform yamls against the actual
machine (misa, mtvec reset value, Svade claim) — an inconsistency refutes even if green.
Re-run with the reference switched Sail↔Spike; a test set that passes against one and
fails the other must be investigated and documented, not ignored. Attack signature
granularity/extent: truncate the signature region by 4 bytes in a local hack and confirm
RISCOF flags it (guards against a dump that under-reports). Then run the privilege suite
specifically and audit three medium-difficulty logs by hand (mstatus/mcause signature
values against the spec) to confirm signatures encode real trap state, not zeroed
memory. Finally re-run everything from a fresh clone on a second machine.

## Verification log
(empty)
