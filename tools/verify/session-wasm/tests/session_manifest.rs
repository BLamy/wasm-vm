#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test;
#[path = "../../../../crates/storage/tests/session_manifest/cases.rs"]
mod cases;

#[wasm_bindgen_test]
fn golden_wide_positions() {
    cases::golden_wide_positions();
}
#[wasm_bindgen_test]
fn noncanonical_numbers_and_hashes() {
    cases::noncanonical_numbers_and_hashes();
}
#[wasm_bindgen_test]
fn identities_and_capture_admission() {
    cases::identities_and_capture_admission();
}
#[wasm_bindgen_test]
fn unavailable_history_is_preserved() {
    cases::unavailable_history_is_preserved();
}
#[wasm_bindgen_test]
fn schema_duplicates_and_bounds() {
    cases::schema_duplicates_and_bounds();
}
#[wasm_bindgen_test]
fn topology_and_index_attacks() {
    cases::topology_and_index_attacks();
}
#[wasm_bindgen_test]
fn event_and_chunk_integrity() {
    cases::event_and_chunk_integrity();
}
#[wasm_bindgen_test]
fn gpu_checkpoint_binding() {
    cases::gpu_checkpoint_binding();
}
#[wasm_bindgen_test]
fn topology_requires_capture() {
    cases::topology_requires_capture();
}
