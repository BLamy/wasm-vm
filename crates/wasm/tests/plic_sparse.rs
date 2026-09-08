#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;

#[path = "../../core/tests/support/plic_sparse_cases.rs"]
mod cases;

#[wasm_bindgen_test]
fn selector_and_snapshot_cases_match_old_range_oracle() {
    cases::selector_snapshot_cases();
}

#[wasm_bindgen_test]
fn real_bus_gateway_sequence_preserves_observability() {
    cases::hostile_restore_and_bus_sequence();
}

#[wasm_bindgen_test]
fn encoded_guest_plic_trace_and_digest_are_exact() {
    cases::encoded_guest_trace();
}
