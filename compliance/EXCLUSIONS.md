# RISCOF known-exclusion list (E1-T20)

Tests whose DUT-vs-Spike signature comparison is permitted to differ, each with a spec-cited
justification. Target: EMPTY by the Level-1 capstone (E1-T24). Every entry is a documented
implementation-scope choice, NOT a hidden failure. Format: <test path>  # <reason>.

## Sv57 virtual memory — NOT IMPLEMENTED (Priv §4.5; §4.1.11 satp MODE)
We implement Bare / Sv39 / Sv48 (E1-T16, E1-T18); satp MODE=10 (Sv57) is a WARL no-op (correctly
rejected). These tests exercise a paging mode we don't provide — spec-permissible (any subset of
Bare/Sv39/Sv48/Sv57 is legal). Removed by a future Sv57 task.

vm_pmp/src/sv57/sv57_pmp_on_pa_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_pmp/src/sv57/sv57_pmp_on_pa_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_pmp/src/sv57/sv57_pmp_on_pte_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_pmp/src/sv57/sv57_pmp_on_pte_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_A_and_D_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_A_and_D_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_canonical_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_canonical_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_global_pte_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_global_pte_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_invalid_pte_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_invalid_pte_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_misaligned_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_misaligned_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_mprv_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_mprv_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_mprv_U_set_sum_set_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_mprv_U_set_sum_unset_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_mstatus_sbe_set_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_mstatus_sbe_set_sum_set_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_mxr_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_mxr_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_nleaf_pte_level0_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_nleaf_pte_level0_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_pte_reserved_field_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_reserved_rsw_pte_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_reserved_rsw_pte_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_reserved_rwx_pte_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_reserved_rwx_pte_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_reserved_svnapot_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_reserved_svpbmt_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_satp_access_tests.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_spage_access_U_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_sum_set_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_sum_set_U_bit_unset_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_sum_unset_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_VA_all_ones_S_mode.S  # Sv57 unimplemented (we support up to Sv48)
vm_sv57/src/sv57_VA_all_zeros_S_mode.S  # Sv57 unimplemented (we support up to Sv48)

## 64-region PMP — WE IMPLEMENT 16 ENTRIES (Priv §3.7: 0..64 PMP entries permitted)
pmpm_all_entries_check-* are gated RVTEST_CASE(... verify (PMP['pmp-writable'] == 64) ...) — they
require a 64-entry PMP. We implement 16 (E1-T15: pmpcfg0/2 + pmpaddr0..15), a spec-legal count;
writing pmpaddr16..63 (unimplemented CSRs) correctly raises illegal-instruction, so the signature
diverges from a 64-entry reference. Not a bug. A future task may widen PMP to 64 entries.

pmp/src/pmpm_all_entries_check-01.S  # requires 64-region PMP; we implement 16 (E1-T15)
pmp/src/pmpm_all_entries_check-02.S  # requires 64-region PMP; we implement 16 (E1-T15)
pmp/src/pmpm_all_entries_check-03.S  # requires 64-region PMP; we implement 16 (E1-T15)
pmp/src/pmpm_all_entries_check-04.S  # requires 64-region PMP; we implement 16 (E1-T15)
