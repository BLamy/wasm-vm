//! E5-T26p fresh-verifier attack: x0-target MMIO loads must keep ordered bus effects,
//! and public false-requesting sinks must remain observable.

#[path = "support/retirement_capture_verifier_support.rs"]
mod support;

#[test]
fn direct_x0_mmio_read_and_fault_keep_effects_and_callbacks() {
    support::direct_x0_mmio_read_and_fault_keep_effects_and_callbacks();
}

#[test]
fn ordinary_and_cached_x0_mmio_read_and_fault_keep_effects_and_callbacks() {
    support::run_x0_mmio_read_and_fault_keep_effects_and_callbacks();
}
