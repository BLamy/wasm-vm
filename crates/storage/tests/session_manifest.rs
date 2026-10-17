#[path = "session_manifest/cases.rs"]
mod cases;

#[test]
fn golden_wide_positions() {
    cases::golden_wide_positions();
}
#[test]
fn noncanonical_numbers_and_hashes() {
    cases::noncanonical_numbers_and_hashes();
}
#[test]
fn identities_and_capture_admission() {
    cases::identities_and_capture_admission();
}
#[test]
fn unavailable_history_is_preserved() {
    cases::unavailable_history_is_preserved();
}
#[test]
fn schema_duplicates_and_bounds() {
    cases::schema_duplicates_and_bounds();
}
#[test]
fn topology_and_index_attacks() {
    cases::topology_and_index_attacks();
}
#[test]
fn event_and_chunk_integrity() {
    cases::event_and_chunk_integrity();
}
#[test]
fn gpu_checkpoint_binding() {
    cases::gpu_checkpoint_binding();
}
#[test]
fn topology_requires_capture() {
    cases::topology_requires_capture();
}
