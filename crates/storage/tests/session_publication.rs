use wasm_vm_storage::session::*;
use wasm_vm_storage::session_publication::*;

const MANIFEST: &[u8] = include_bytes!("session_manifest/fixtures/manifest-v1.json");
const EVENT: &[u8] = include_bytes!("session_manifest/fixtures/event-v1.json");
const CHUNK: &[u8] = include_bytes!("session_manifest/fixtures/chunk-v1.json");
fn manifest() -> SessionManifest {
    SessionManifest::from_bytes(MANIFEST).unwrap()
}

#[test]
fn references_deduplicate_direct_assets_and_roots() {
    let mut m = manifest();
    let mut checkpoint = m.checkpoints[0].clone();
    checkpoint.id = "same-state-second-name".into();
    m.checkpoints.push(checkpoint);
    let refs = references(&m).unwrap();
    assert_eq!(refs.blobs.len(), 6);
    assert_eq!(refs.roots, vec![ContentHash::of(b"e9:before\n")]);
    assert!(refs.blobs.windows(2).all(|w| w[0].sha256 < w[1].sha256));
    let json: serde_json::Value =
        serde_json::from_slice(&references_json(MANIFEST).unwrap()).unwrap();
    assert_eq!(json["blobs"].as_array().unwrap().len(), 6);
    assert!(json["blobs"][0]["length"].is_string());
    let mut gpu = manifest();
    gpu.machine.devices.push(DeviceIdentity {
        id: "gpu0".into(),
        kind: "virtio-gpu3d".into(),
        mmio_base: ExactU64(0x1000_1000),
        mmio_length: 256,
        irq: 6,
        state_version: 1,
    });
    let renderer = BlobRef::of(b"renderer-v1");
    gpu.machine.gpu = Some(GpuIdentity {
        renderer_build: renderer.sha256,
        profile: ContentHash([17; 32]),
    });
    gpu.assets.push(RuntimeAsset {
        role: "gpu-renderer".into(),
        content: renderer,
    });
    gpu.policy.profile = "rv64-linux-gpu-v1".into();
    gpu.policy
        .required_inputs
        .extend(["gpu-results", "display", "dma"].map(String::from));
    gpu.checkpoints[0].gpu = Some(BlobRef::of(b"renderer-state-v1"));
    assert_eq!(references(&gpu).unwrap().blobs.len(), 8);
}

#[test]
fn append_extends_a_wide_position_without_rewriting_its_prefix() {
    let previous = manifest();
    let mut next = previous.clone();
    next.end.transition.0 += 1;
    next.end.retired.0 += 1;
    let mut checkpoint = next.checkpoints[0].clone();
    checkpoint.id = "later".into();
    checkpoint.position = next.end;
    checkpoint.next_sequence = ExactU64(9_007_199_254_740_995);
    next.checkpoints.push(checkpoint);
    assert_eq!(check_append(&previous, &next), Ok(()));
    assert_eq!(check_append(&previous, &previous), Ok(()));
    assert_eq!(previous.to_bytes().unwrap(), MANIFEST);
}

#[test]
fn append_refuses_foreign_identity_and_policy() {
    let previous = manifest();
    for variant in 0..6 {
        let mut next = previous.clone();
        match variant {
            0 => next.id = "other-session".into(),
            1 => {
                next.machine.vm_build = ContentHash([31; 32]);
                next.assets[0].content.sha256 = next.machine.vm_build;
            }
            2 => next.policy.required_inputs.push("display".into()),
            3 => next.assets.swap(0, 1),
            4 => {
                next.begin.ordinal = 1;
                next.checkpoints[0].position = next.begin;
            }
            _ => next.extensions[0].bytes[0] ^= 1,
        }
        next.validate().unwrap();
        assert_eq!(
            check_append(&previous, &next),
            Err(SessionError::IdentityMismatch("session publication"))
        );
    }
    assert_eq!(previous.to_bytes().unwrap(), MANIFEST);
}

#[test]
fn append_refuses_replaced_checkpoint_or_event() {
    let previous = manifest();
    for variant in 0..3 {
        let mut next = previous.clone();
        match variant {
            0 => next.checkpoints[0].disk_root = ContentHash([71; 32]),
            1 => next.checkpoints[0].machine.sha256 = ContentHash([72; 32]),
            _ => next.events[0].content.sha256 = ContentHash([73; 32]),
        }
        next.validate().unwrap();
        assert_eq!(
            check_append(&previous, &next),
            Err(SessionError::Invalid("committed history prefix"))
        );
    }
}

fn witness(position: Position, byte: u8) -> serde_json::Value {
    let mut value = serde_json::to_value(position).unwrap();
    value["digest"] = serde_json::json!(vec![byte; 32]);
    value
}

#[test]
fn live_exact_witnesses_are_finalized_once_without_rewriting_initial_state() {
    let mut previous = manifest();
    let first = witness(previous.begin, 7);
    previous.extensions = vec![Extension {
        kind: "e9-exact-initial-witness-v1".into(),
        required: false,
        bytes: serde_json::to_vec(&vec![first.clone()]).unwrap(),
    }];
    previous.validate().unwrap();
    let mut next = previous.clone();
    next.extensions.push(Extension {
        kind: "e9-exact-state-witnesses-v1".into(),
        required: false,
        bytes: serde_json::to_vec(&vec![first, witness(next.end, 9)]).unwrap(),
    });
    assert_eq!(check_append(&previous, &next), Ok(()));
    assert_eq!(check_append(&next, &next), Ok(()));

    let mut attack = next.clone();
    attack.extensions[0].bytes[0] ^= 1;
    assert!(check_append(&previous, &attack).is_err());
    let mut attack = next.clone();
    attack.extensions[1].bytes =
        serde_json::to_vec(&vec![witness(previous.begin, 8), witness(next.end, 9)]).unwrap();
    assert_eq!(
        check_append(&previous, &attack),
        Err(SessionError::IdentityMismatch("session publication"))
    );
    let mut attack = next.clone();
    attack.extensions[1].bytes = serde_json::to_vec(&vec![
        witness(previous.begin, 7),
        witness(previous.begin, 9),
    ])
    .unwrap();
    assert_eq!(
        check_append(&previous, &attack),
        Err(SessionError::IdentityMismatch("session publication"))
    );
    let mut attack = next.clone();
    attack.extensions[1].bytes[0] ^= 1;
    assert!(check_append(&next, &attack).is_err());
    let mut attack = next.clone();
    attack.extensions.push(Extension {
        kind: "unexpected".into(),
        required: false,
        bytes: vec![1],
    });
    assert_eq!(
        check_append(&next, &attack),
        Err(SessionError::IdentityMismatch("session publication"))
    );
}

#[test]
fn discover_verified_event_payloads_and_refuse_unindexed_bytes() {
    let mut m = manifest();
    assert_eq!(event_references(&m, CHUNK), Ok(vec![]));
    let mut event = EventRecord::from_bytes(EVENT).unwrap();
    let expected = BlobRef::of(b"captured external observation");
    event.payload = EventPayload::Blob {
        content: expected.clone(),
    };
    let mut next = event.clone();
    next.sequence.0 += 1;
    next.ordinal += 1;
    let (index, bytes) = EventChunkIndex::from_records(&[event, next]).unwrap();
    m.end = index.last;
    m.events = vec![index];
    assert_eq!(event_references(&m, &bytes), Ok(vec![expected.clone()]));
    let json: serde_json::Value =
        serde_json::from_slice(&event_references_json(&m.to_bytes().unwrap(), &bytes).unwrap())
            .unwrap();
    assert_eq!(json.as_array().unwrap().len(), 1);
    assert_eq!(
        event_references(&m, b"[]"),
        Err(SessionError::Invalid("unindexed event chunk"))
    );
    assert_eq!(
        event_references(&m, &vec![0; MAX_CHUNK_BYTES as usize + 1]),
        Err(SessionError::TooLarge("event chunk"))
    );
}

#[test]
fn conflicting_lengths_and_malformed_indexes_never_publish() {
    let mut m = manifest();
    m.checkpoints[0].machine = m.assets[0].content.clone();
    m.checkpoints[0].machine.length.0 += 1;
    assert!(matches!(
        references(&m),
        Err(SessionError::LengthMismatch { .. })
    ));
    assert!(matches!(
        references_json(b"{}"),
        Err(SessionError::Malformed(_))
    ));
    assert!(matches!(
        event_references_json(b"{}", CHUNK),
        Err(SessionError::Malformed(_))
    ));
    let mut corrupt = manifest();
    corrupt.version.major = 2;
    assert!(matches!(
        check_append(&corrupt, &manifest()),
        Err(SessionError::Version { .. })
    ));
    assert!(matches!(
        check_append(&manifest(), &corrupt),
        Err(SessionError::Version { .. })
    ));
    let mut m = manifest();
    let mut event = EventRecord::from_bytes(EVENT).unwrap();
    let content = BlobRef::of(b"captured payload");
    event.payload = EventPayload::Blob {
        content: content.clone(),
    };
    let mut next = event.clone();
    next.sequence.0 += 1;
    next.ordinal += 1;
    next.payload = EventPayload::Blob {
        content: BlobRef {
            length: ExactU64(content.length.0 + 1),
            ..content
        },
    };
    let (index, bytes) = EventChunkIndex::from_records(&[event, next]).unwrap();
    m.end = index.last;
    m.events = vec![index];
    assert!(matches!(
        event_references(&m, &bytes),
        Err(SessionError::LengthMismatch { .. })
    ));
}
