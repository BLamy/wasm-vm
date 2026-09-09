//! Actual-wasm32 mirror of the E5-T26p fresh-verifier x0/MMIO attack.
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;

#[path = "../../core/tests/support/retirement_capture_verifier_support.rs"]
mod support;

#[wasm_bindgen_test]
fn wasm_direct_x0_mmio_read_and_fault_keep_effects_and_callbacks() {
    support::direct_x0_mmio_read_and_fault_keep_effects_and_callbacks();
}

#[wasm_bindgen_test]
fn wasm_ordinary_and_cached_x0_mmio_read_and_fault_keep_effects_and_callbacks() {
    support::run_x0_mmio_read_and_fault_keep_effects_and_callbacks();
}
