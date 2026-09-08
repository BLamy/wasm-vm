#![cfg(not(target_arch = "wasm32"))]

#[path = "support/plic_sparse_verifier_cases.rs"]
mod cases;

#[test]
fn reserved_seed_and_reversed_completion_preserve_plic_authority() {
    cases::reserved_seed_and_reversed_completion();
}
