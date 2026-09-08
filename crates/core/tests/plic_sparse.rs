#![cfg(not(target_arch = "wasm32"))]

#[path = "support/plic_sparse_cases.rs"]
mod cases;

#[test]
fn selector_and_snapshot_cases_match_old_range_oracle() {
    cases::selector_snapshot_cases();
}

#[test]
fn real_bus_gateway_sequence_preserves_observability() {
    cases::hostile_restore_and_bus_sequence();
}

#[test]
fn invalid_context_eip_keeps_native_panic_contract() {
    cases::invalid_context_eip_panics();
}

#[test]
fn encoded_guest_plic_trace_and_digest_are_exact() {
    cases::encoded_guest_trace();
}
