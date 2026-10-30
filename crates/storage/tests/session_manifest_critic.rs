//! Fresh E9-T02 critic regressions: independent identity mutations, parser attacks and bounds.
//! The nine shared native/Wasm acceptance cases remain in session_manifest/cases.rs.

use wasm_vm_storage::session::*;
const MANIFEST: &[u8] = include_bytes!("session_manifest/fixtures/manifest-v1.json");
const EVENT: &[u8] = include_bytes!("session_manifest/fixtures/event-v1.json");
fn manifest() -> SessionManifest {
    SessionManifest::from_bytes(MANIFEST).unwrap()
}
fn runtime(m: &SessionManifest) -> RuntimeDescriptor {
    RuntimeDescriptor {
        machine: m.machine.clone(),
        policy: m.policy.clone(),
        captured_inputs: CAPTURE_INPUTS.iter().map(|s| (*s).into()).collect(),
    }
}

#[test]
fn duplicate_payload_discriminants_and_foreign_fields_are_refused() {
    let text = std::str::from_utf8(EVENT).unwrap();
    for replacement in [
        "\"storage\":\"inline\",\"storage\":\"inline\"",
        "\"storage\":\"blob\",\"storage\":\"inline\"",
        "\"storage\":\"inline\",\"foreign_required\":true",
        "\"storage\":\"inline\",\"bytes\":[99]",
    ] {
        let bytes = text
            .replacen("\"storage\":\"inline\"", replacement, 1)
            .into_bytes();
        let before = bytes.clone();
        let observed = EventRecord::from_bytes(&bytes);
        assert!(
            matches!(observed, Err(SessionError::Malformed(_))),
            "accepted {replacement}: {observed:?}"
        );
        assert_eq!(bytes, before);
        println!("duplicate/foreign payload rejected: {replacement}");
    }
}

#[test]
fn every_device_field_is_an_immutable_identity() {
    let m = manifest();
    let before = m.to_bytes().unwrap();
    for field in [
        "id",
        "kind",
        "mmio_base",
        "mmio_length",
        "irq",
        "state_version",
    ] {
        let mut r = runtime(&m);
        let d = &mut r.machine.devices[0];
        match field {
            "id" => d.id = "novel-uart-137".into(),
            "kind" => d.kind = "virtio-rng".into(),
            "mmio_base" => d.mmio_base.0 += 8192,
            "mmio_length" => d.mmio_length += 128,
            "irq" => d.irq += 7,
            _ => d.state_version += 1,
        }
        assert_eq!(
            m.admit(&r),
            Err(SessionError::IdentityMismatch("devices")),
            "{field}"
        );
        assert_eq!(m.to_bytes().unwrap(), before);
        println!("device identity refused: {field}");
    }
}

#[test]
fn adjacent_wide_positions_and_length_identity() {
    let base = EventRecord::from_bytes(EVENT).unwrap();
    for sequence in [
        (1u64 << 53) - 1,
        1u64 << 53,
        (1u64 << 53) + 1,
        u64::MAX - 200,
    ] {
        let mut e = base.clone();
        e.sequence = ExactU64(sequence);
        e.retired = ExactU64(sequence);
        e.transition = ExactU64(sequence + 100);
        let encoded = e.to_bytes().unwrap();
        assert_eq!(EventRecord::from_bytes(&encoded).unwrap(), e);
        assert!(
            std::str::from_utf8(&encoded)
                .unwrap()
                .contains(&format!("\"sequence\":\"{sequence}\""))
        );
        println!("exact decimal sequence {sequence}");
    }
    let mut m = manifest();
    let r = runtime(&m);
    m.assets[0].content.length.0 += 1;
    let before = m.to_bytes().unwrap();
    let retained = [
        VerifiedAsset::from_bytes(b"vm-runtime-v1"),
        VerifiedAsset::from_bytes(b"wasm-module-v1"),
        VerifiedAsset::from_bytes(b"kernel-v1"),
        VerifiedAsset::from_bytes(b"base-image-v1"),
    ];
    assert_eq!(
        m.availability(&[r], &retained),
        Ok(RuntimeAvailability::UnavailableAsset {
            sha256: m.machine.vm_build,
            length: m.assets[0].content.length
        })
    );
    assert_eq!(m.to_bytes().unwrap(), before);
    println!("matching hash with foreign byte length is unavailable");
}

#[test]
fn valid_gpu_renderer_and_profile_refuse_independently() {
    let mut m = manifest();
    let hash = BlobRef::of(b"verifier-renderer-137");
    m.machine.devices.push(DeviceIdentity {
        id: "gpu137".into(),
        kind: "virtio-gpu3d".into(),
        mmio_base: ExactU64(0x10004000),
        mmio_length: 256,
        irq: 6,
        state_version: 1,
    });
    m.machine.gpu = Some(GpuIdentity {
        renderer_build: hash.sha256,
        profile: ContentHash([137; 32]),
    });
    m.assets.push(RuntimeAsset {
        role: "gpu-renderer".into(),
        content: hash,
    });
    m.policy.profile = "rv64-linux-gpu-v1".into();
    m.policy
        .required_inputs
        .extend(["gpu-results", "display", "dma"].map(String::from));
    m.checkpoints[0].gpu = Some(BlobRef::of(b"verifier-renderer-state-137"));
    m.validate().unwrap();
    let before = m.to_bytes().unwrap();
    for field in ["renderer_build", "profile"] {
        let mut r = runtime(&m);
        let gpu = r.machine.gpu.as_mut().unwrap();
        if field == "renderer_build" {
            gpu.renderer_build = ContentHash([138; 32]);
        } else {
            gpu.profile = ContentHash([139; 32]);
        }
        assert_eq!(
            m.admit(&r),
            Err(SessionError::IdentityMismatch("GPU")),
            "{field}"
        );
        assert_eq!(m.to_bytes().unwrap(), before);
        println!("GPU identity refused: {field}");
    }
    let mut invalid = m.clone();
    invalid.checkpoints[0].gpu.as_mut().unwrap().length = ExactU64(0);
    assert_eq!(
        invalid.validate(),
        Err(SessionError::Invalid("blob length"))
    );
    println!("GPU checkpoint payload length refused");
}

#[test]
fn serialization_caps_and_invalid_token_paths() {
    let mut m = manifest();
    m.policy.clock.interactive = Some("keyboard-switch-137".into());
    assert_eq!(m.validate(), Err(SessionError::Invalid("clock policy")));
    for role in ["vm", "wasm", "kernel", "base"] {
        let mut m = manifest();
        m.assets
            .iter_mut()
            .find(|a| a.role == role)
            .unwrap()
            .content
            .sha256 = ContentHash([141; 32]);
        assert_eq!(m.validate(), Err(SessionError::IdentityMismatch(role)));
        println!("internal asset binding refused: {role}");
    }
    let mut m = manifest();
    let first = m.checkpoints[0].clone();
    m.checkpoints.clear();
    for i in 0..MAX_INDEX_ENTRIES {
        let mut cp = first.clone();
        cp.id = format!("cp-{i:060}");
        m.checkpoints.push(cp);
    }
    m.validate().unwrap();
    assert_eq!(m.to_bytes(), Err(SessionError::TooLarge("encoded data")));
    println!("bounded manifest encoder refused valid oversized index encoding");
    let mut e = EventRecord::from_bytes(EVENT).unwrap();
    e.intent = vec![255; 65_536];
    e.payload = EventPayload::Inline {
        bytes: vec![255; MAX_INLINE_BYTES],
    };
    e.validate().unwrap();
    assert_eq!(e.to_bytes(), Err(SessionError::TooLarge("encoded data")));
    assert_eq!(
        EventChunkIndex::from_records(&[e]),
        Err(SessionError::TooLarge("encoded data"))
    );
    println!("bounded event/chunk encoders refused serialized byte overflow");
    assert_eq!(
        format!("{}", SessionError::DigestMismatch),
        "DigestMismatch"
    );
}

#[test]
fn public_entrypoints_propagate_validation_and_shape_refusals() {
    let mut m = manifest();
    m.id.clear();
    let r = runtime(&m);
    assert_eq!(m.to_bytes(), Err(SessionError::Invalid("session id")));
    assert_eq!(m.admit(&r), Err(SessionError::Invalid("session id")));
    assert_eq!(
        m.availability(&[r], &[]),
        Err(SessionError::Invalid("session id"))
    );
    for label in ["device", "extension", "asset", "checkpoint", "input"] {
        let mut m = manifest();
        let expected = match label {
            "device" => {
                m.machine.devices[0].id.clear();
                "device id"
            }
            "extension" => {
                m.extensions[0].kind.clear();
                "extension kind"
            }
            "asset" => {
                m.assets[0].role.clear();
                "asset role"
            }
            "checkpoint" => {
                m.checkpoints[0].id.clear();
                "checkpoint id"
            }
            _ => {
                m.policy.required_inputs[0] = "bad input".into();
                "capture inputs"
            }
        };
        assert_eq!(m.validate(), Err(SessionError::Invalid(expected)));
    }
    for location in ["asset", "chunk"] {
        let mut m = manifest();
        if location == "asset" {
            m.assets[0].content.length = ExactU64(0);
        } else {
            m.events[0].content.length = ExactU64(0);
        }
        assert_eq!(m.validate(), Err(SessionError::Invalid("blob length")));
    }
    let b = BlobRef {
        sha256: ContentHash::default(),
        length: ExactU64(0),
    };
    assert_eq!(b.verify(&[]), Err(SessionError::Invalid("blob length")));
    let text = std::str::from_utf8(MANIFEST).unwrap();
    let bad = text.replacen("\"major\":1", "\"major\":2", 1);
    assert!(matches!(
        SessionManifest::from_bytes(bad.as_bytes()),
        Err(SessionError::Version {
            section: "manifest",
            major: 2,
            minor: 0
        })
    ));
    let text = std::str::from_utf8(EVENT).unwrap();
    let bad = text.replacen("\"major\":1", "\"major\":2", 1);
    assert!(matches!(
        EventRecord::from_bytes(bad.as_bytes()),
        Err(SessionError::Version {
            section: "event",
            major: 2,
            minor: 0
        })
    ));
    let mut index = manifest().events[0].clone();
    let bytes = format!("[{bad}]").into_bytes();
    index.content = BlobRef::of(&bytes);
    assert!(matches!(
        index.decode_records(&bytes),
        Err(SessionError::Version {
            section: "event",
            major: 2,
            minor: 0
        })
    ));
    let mut e = EventRecord::from_bytes(EVENT).unwrap();
    e.required = false;
    assert_eq!(
        EventChunkIndex::from_records(&[e]),
        Err(SessionError::Invalid("optional guest effect"))
    );
    for field in ["kind", "device"] {
        let mut e = EventRecord::from_bytes(EVENT).unwrap();
        if field == "kind" {
            e.kind.clear();
        } else {
            e.device.clear();
        }
        assert_eq!(
            e.validate(),
            Err(SessionError::Invalid(if field == "kind" {
                "event kind"
            } else {
                "event device"
            }))
        );
    }
    let mut e = EventRecord::from_bytes(EVENT).unwrap();
    e.payload = EventPayload::Blob { content: b };
    assert_eq!(e.validate(), Err(SessionError::Invalid("blob length")));
    for begin in [u64::MAX, u64::MAX - 1] {
        let mut m = manifest();
        m.begin.sequence = ExactU64(begin);
        m.end = m.begin;
        m.events[0].count = 2;
        assert_eq!(m.validate(), Err(SessionError::Overflow));
    }
    println!(
        "entrypoint validation, invalid labels/assets and both event-range overflow paths refused"
    );
}

#[test]
fn missing_wide_fields_and_invalid_blob_numbers_are_malformed() {
    let event = std::str::from_utf8(EVENT).unwrap();
    let missing = event.replacen("\"sequence\":\"9007199254740994\",", "", 1);
    assert!(matches!(
        EventRecord::from_bytes(missing.as_bytes()),
        Err(SessionError::Malformed(_))
    ));
    let m = manifest();
    let text = std::str::from_utf8(MANIFEST).unwrap();
    let hash = m
        .machine
        .vm_build
        .0
        .iter()
        .map(|x| format!("{x:02x}"))
        .collect::<String>();
    let missing = text.replacen(&format!("\"vm_build\":\"{hash}\","), "", 1);
    assert!(matches!(
        SessionManifest::from_bytes(missing.as_bytes()),
        Err(SessionError::Malformed(_))
    ));
    let mut e = EventRecord::from_bytes(EVENT).unwrap();
    e.payload = EventPayload::Blob {
        content: BlobRef::of(b"blob-137"),
    };
    let bytes = e.to_bytes().unwrap();
    let text = std::str::from_utf8(&bytes).unwrap();
    for bad in ["7", "\"07\"", "\"18446744073709551616\""] {
        let text = text.replacen("\"length\":\"8\"", &format!("\"length\":{bad}"), 1);
        assert!(
            matches!(
                EventRecord::from_bytes(text.as_bytes()),
                Err(SessionError::Malformed(_))
            ),
            "{text}"
        );
    }
    println!("missing and blob-deserializer wide integer/hash paths refused");
}

#[test]
fn authenticated_duplicate_phase_and_count_attacks() {
    let first = EventRecord::from_bytes(EVENT).unwrap();
    assert_eq!(
        EventChunkIndex::from_records(&[first.clone(), first.clone()]),
        Err(SessionError::IndexOrder)
    );
    let mut later = first.clone();
    later.sequence.0 += 1;
    later.retired.0 -= 1;
    assert_eq!(
        EventChunkIndex::from_records(&[first.clone(), later]),
        Err(SessionError::IndexOrder)
    );
    let mut after = first.clone();
    after.phase = Phase::After;
    let mut before = first.clone();
    before.sequence.0 += 1;
    before.phase = Phase::Before;
    let bytes = format!(
        "[{},{}]",
        String::from_utf8(after.to_bytes().unwrap()).unwrap(),
        String::from_utf8(before.to_bytes().unwrap()).unwrap()
    )
    .into_bytes();
    let index = EventChunkIndex {
        first: after.position(),
        last: before.position(),
        count: 2,
        content: BlobRef::of(&bytes),
    };
    let unchanged = bytes.clone();
    assert_eq!(index.decode_records(&bytes), Err(SessionError::IndexOrder));
    assert_eq!(bytes, unchanged);
    let mut paused = first.clone();
    paused.sequence.0 += 1;
    let (index, bytes) = EventChunkIndex::from_records(&[first.clone(), paused.clone()]).unwrap();
    assert_eq!(
        index.decode_records(&bytes).unwrap(),
        vec![first.clone(), paused]
    );
    let oversized = vec![first; MAX_EVENTS_PER_CHUNK as usize + 1];
    assert_eq!(
        EventChunkIndex::from_records(&oversized),
        Err(SessionError::Invalid("event count"))
    );
    let mut index = manifest().events[0].clone();
    index.count = MAX_EVENTS_PER_CHUNK + 1;
    assert_eq!(
        index.decode_records(b"not read"),
        Err(SessionError::Invalid("event chunk shape"))
    );
    index.count = 1;
    index.content.length = ExactU64(MAX_CHUNK_BYTES + 1);
    assert_eq!(
        index.decode_records(b"not read"),
        Err(SessionError::Invalid("event chunk shape"))
    );
    println!(
        "authenticated order/duplicate/count attacks refused; same-coordinate paused sequences preserved"
    );
}
