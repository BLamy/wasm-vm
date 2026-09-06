#![cfg(not(feature = "zicsr-stub"))]
#[path = "../../../tests/shared/e5_t22f_verifier.rs"]
mod fixture;

#[test]
fn seeded_mode_map_pte_sequence() {
    fixture::seeded_mode_map_pte_sequence(|_| {});
}
