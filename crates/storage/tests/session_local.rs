use wasm_vm_storage::session::{
    ContentHash, ExactU64, MAX_LOCAL_SESSION_BYTES, MAX_SESSION_BYTES, SessionError,
    SessionManifest,
};
use wasm_vm_storage::session_publication;

fn sample() -> SessionManifest {
    SessionManifest::from_bytes(include_bytes!("session_manifest/fixtures/manifest-v1.json"))
        .unwrap()
}

#[test]
fn repeated_local_history_crosses_portable_bound_without_widening_blob_or_archive() {
    let mut local = sample();
    let checkpoint = local.checkpoints[0].clone();
    local.checkpoints = (0..66)
        .map(|index| {
            let mut next = checkpoint.clone();
            next.id = format!("retained-{index}");
            next.machine.length = ExactU64(64 << 20);
            next
        })
        .collect();
    assert!(local.validate_local().is_ok());
    assert_eq!(
        local.validate(),
        Err(SessionError::TooLarge("session payload"))
    );
    let bytes = local.to_bytes_local().unwrap();
    assert_eq!(SessionManifest::from_bytes_local(&bytes).unwrap(), local);
    assert_eq!(
        SessionManifest::from_bytes(&bytes),
        Err(SessionError::TooLarge("session payload"))
    );
    assert_eq!(
        local.to_bytes(),
        Err(SessionError::TooLarge("session payload"))
    );
    let refs = session_publication::references_local(&local).unwrap();
    assert_eq!(
        refs.blobs
            .iter()
            .filter(|entry| entry.sha256 == checkpoint.machine.sha256)
            .count(),
        1,
        "reused checkpoint object is one physical reference"
    );
    assert_eq!(
        session_publication::references(&local),
        Err(SessionError::TooLarge("session payload"))
    );
    assert!(
        session_publication::check_append_local(&sample(), &local).is_err(),
        "a replacement of the original checkpoint is never an append"
    );
    let mut previous = local.clone();
    previous.checkpoints.pop();
    assert_eq!(
        session_publication::check_append_local(&previous, &local),
        Ok(())
    );
    assert_eq!(
        session_publication::check_append(&previous, &local),
        Err(SessionError::TooLarge("session payload"))
    );
    let chunk = include_bytes!("session_manifest/fixtures/chunk-v1.json");
    assert_eq!(
        session_publication::event_references_local(&local, chunk).unwrap(),
        session_publication::event_references(&sample(), chunk).unwrap()
    );

    let mut oversized_blob = local.clone();
    oversized_blob.checkpoints[0].machine.length = ExactU64(MAX_SESSION_BYTES + 1);
    assert_eq!(
        oversized_blob.validate_local(),
        Err(SessionError::Invalid("blob length"))
    );
}

#[test]
fn local_aggregate_limit_rejects_one_byte_over_and_preserves_exact_edge() {
    let mut local = sample();
    let event_bytes: u64 = local
        .events
        .iter()
        .map(|event| event.content.length.0)
        .sum();
    assert!(event_bytes > 0 && event_bytes < MAX_SESSION_BYTES);
    let checkpoint = local.checkpoints[0].clone();
    local.checkpoints = (0..16)
        .map(|index| {
            let mut next = checkpoint.clone();
            next.id = format!("edge-{index}");
            next.machine.sha256 = ContentHash([index as u8 + 1; 32]);
            next.machine.length = ExactU64(if index == 15 {
                MAX_SESSION_BYTES - event_bytes
            } else {
                MAX_SESSION_BYTES
            });
            next
        })
        .collect();
    let aggregate = event_bytes
        + local
            .checkpoints
            .iter()
            .map(|point| point.machine.length.0)
            .sum::<u64>();
    assert_eq!(aggregate, MAX_LOCAL_SESSION_BYTES);
    assert_eq!(local.validate_local(), Ok(()));
    let edge_bytes = local.to_bytes_local().unwrap();
    assert!(SessionManifest::from_bytes_local(&edge_bytes).is_ok());
    local.checkpoints[15].machine.length.0 += 1;
    assert_eq!(
        local.validate_local(),
        Err(SessionError::TooLarge("session payload"))
    );
    let invalid_bytes = serde_json::to_vec(&local).unwrap();
    assert_eq!(
        SessionManifest::from_bytes_local(&invalid_bytes),
        Err(SessionError::TooLarge("session payload"))
    );
}
