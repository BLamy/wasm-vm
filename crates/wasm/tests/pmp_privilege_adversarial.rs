#![cfg(target_arch = "wasm32")]
#![cfg(not(feature = "zicsr-stub"))]
#[path = "../../../tests/shared/e5_t22f_verifier.rs"]
mod fixture;

#[wasm_bindgen_test::wasm_bindgen_test]
fn seeded_mode_map_pte_sequence() {
    fixture::seeded_mode_map_pte_sequence(|_| {});
}
