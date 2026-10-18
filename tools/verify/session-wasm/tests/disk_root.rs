#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test;
#[path = "../../../../crates/storage/tests/disk_root/cases.rs"]
mod cases;

#[wasm_bindgen_test]
fn snapshot_backends_require_durability_and_ownership() {
    cases::snapshot_backends_require_durability_and_ownership();
}

#[wasm_bindgen_test]
fn golden_exact_generation() {
    cases::golden_exact_generation();
}
#[wasm_bindgen_test]
fn private_forks_restore_in_reverse() {
    cases::private_forks_restore_in_reverse();
}
#[wasm_bindgen_test]
fn identities_refuse_before_loading() {
    cases::identities_refuse_before_loading();
}
#[wasm_bindgen_test]
fn payload_failure_cannot_publish_a_partial_disk() {
    cases::payload_failure_cannot_publish_a_partial_disk();
}
#[wasm_bindgen_test]
fn schema_order_and_bounds() {
    cases::schema_order_and_bounds();
}
#[wasm_bindgen_test]
fn deleting_child_pins_preserves_shared_ancestors() {
    cases::deleting_child_pins_preserves_shared_ancestors();
}
#[wasm_bindgen_test]
fn seeded_interleavings_keep_owned_roots_stable() {
    cases::seeded_interleavings_keep_owned_roots_stable();
}
