# RISCOF known-exclusion list (E1-T20; emptied E1-T26)

Tests whose DUT-vs-reference signature comparison is permitted to differ, each with a
spec-cited justification. **Target: EMPTY by the Level-1 capstone (E1-T24) — now MET.**

## Status: EMPTY — the full arch-test suite passes (395 / 0) against the Sail reference

Every entry that lived here existed for ONE reason: the **Spike** fallback reference
(spike-1.1.1-dev) could not be configured to our exact declared ISA. Spike hardcodes
misaligned trapping, and its ISA/extension set could not be pared to Bare/Sv39/Sv48 + 16-entry
PMP, so signatures diverged on tests our machine handles correctly for the ISA it *declares*.

E1-T26 switched the reference to the canonical **RISC-V Sail model** (`sail_riscv_sim`, a
config-honoring golden model), with `compliance/sail/sail_config_override.json` pinning Sail to
our declared ISA (rv64gc + S/U + Sv39/Sv48; misaligned scalar supported; Svnapot/Svpbmt/Sv57/
Svrsw60t59b disabled). Against that reference the **entire suite passes with 0 failures**, so
there is nothing to exclude:

- **Misaligned load/store (8 `privilege/misalign-*`)** — our machine supports hardware
  misaligned access (`hw_data_misaligned_support: True`); Sail honors the declaration and
  agrees. (Spike could not — it always traps misaligned.)
- **Sv57 (38 `vm_sv57` / `vm_pmp/sv57`)** — our machine implements up to Sv48 and WARL-rejects
  satp MODE=10; Sail configured without Sv57 agrees. A legal ISA subset (Priv §4.1.11).
- **64-region PMP (4 `pmpm_all_entries_check`)** — our machine declares 16 PMP entries; the
  64-region case is gated off by the DUT platform and Sail matches.

The **Spike** fallback remains available (`RISCOF_REF=spike bash tools/run_riscof.sh`) and still
reports its documented 43 divergences — a reference-capability gap, not a DUT bug, which is
exactly what moving to the canonical reference resolves.
