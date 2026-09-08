#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;

#[path = "../../core/tests/support/plic_sparse_verifier_cases.rs"]
mod cases;

#[wasm_bindgen_test]
fn reserved_seed_and_reversed_completion_preserve_plic_authority() {
    cases::reserved_seed_and_reversed_completion();
}
