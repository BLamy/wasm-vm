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

#[test]
fn incomplete_capture_prefix_preserves_events_but_never_admits_as_replay() {
    use wasm_vm_storage::session::*;
    let bytes = include_bytes!("session_manifest/fixtures/manifest-v1.json");
    let mut manifest = SessionManifest::from_bytes(bytes).unwrap();
    manifest.policy.mode = RecordingMode::CapturePrefix;
    manifest.policy.clock.mode = ClockMode::Icount;
    manifest.policy.clock.interactive = None;
    manifest.policy.required_inputs = vec![
        "uart".into(),
        "keyboard".into(),
        "pointer".into(),
        "file-transfer".into(),
        "lifecycle".into(),
    ];
    manifest.validate().unwrap();
    let canonical = manifest.to_bytes().unwrap();
    assert_eq!(SessionManifest::from_bytes(&canonical).unwrap(), manifest);
    let runtime = RuntimeDescriptor {
        machine: manifest.machine.clone(),
        policy: manifest.policy.clone(),
        captured_inputs: manifest.policy.required_inputs.clone(),
    };
    assert!(matches!(
        manifest.admit(&runtime),
        Err(SessionError::MissingCapture(_))
    ));
    manifest.policy.mode = RecordingMode::ExactReplay;
    assert!(
        manifest.validate().is_err(),
        "input capture must not qualify missing observation adapters"
    );
    manifest.policy.mode = RecordingMode::CapturePrefix;
    manifest.policy.required_inputs.clear();
    assert!(manifest.validate().is_err());
}
