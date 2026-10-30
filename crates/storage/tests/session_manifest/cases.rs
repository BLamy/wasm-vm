//! The same literal oracles and hostile metadata cases run natively and on wasm32/Node.
use wasm_vm_storage::session::*;

pub const MANIFEST: &[u8] = include_bytes!("fixtures/manifest-v1.json");
pub const EVENT: &[u8] = include_bytes!("fixtures/event-v1.json");
pub const CHUNK: &[u8] = include_bytes!("fixtures/chunk-v1.json");

pub fn manifest() -> SessionManifest {
    SessionManifest::from_bytes(MANIFEST).unwrap()
}
fn event() -> EventRecord {
    EventRecord::from_bytes(EVENT).unwrap()
}
fn runtime(m: &SessionManifest) -> RuntimeDescriptor {
    RuntimeDescriptor {
        machine: m.machine.clone(),
        policy: m.policy.clone(),
        captured_inputs: [
            "lifecycle",
            "storage-control",
            "checkpoint-control",
            "uart",
            "timers",
            "rtc",
            "entropy",
        ]
        .into_iter()
        .map(String::from)
        .collect(),
    }
}

pub fn golden_wide_positions() {
    let m = manifest();
    assert_eq!(m.begin.sequence.0, 9_007_199_254_740_993);
    assert_eq!(m.end.sequence.0, 9_007_199_254_740_994);
    assert_eq!(m.begin.transition.0, 9_007_199_254_741_093);
    assert_eq!(m.begin.retired.0, 9_007_199_254_740_993);
    assert_eq!(m.to_bytes().unwrap(), MANIFEST);
    let e = event();
    assert_eq!(e.to_bytes().unwrap(), EVENT);
    let (index, bytes) = EventChunkIndex::from_records(std::slice::from_ref(&e)).unwrap();
    assert_eq!(bytes, CHUNK);
    assert_eq!(index, m.events[0]);
    assert_eq!(index.decode_records(CHUNK).unwrap(), vec![e.clone()]);
    let mut maximum = e;
    maximum.transition = ExactU64(u64::MAX);
    maximum.retired = ExactU64(u64::MAX);
    maximum.sequence = ExactU64(u64::MAX);
    maximum.ordinal = u32::MAX;
    assert_eq!(
        EventRecord::from_bytes(&maximum.to_bytes().unwrap()).unwrap(),
        maximum
    );
    assert_eq!(m.admit(&runtime(&m)), Ok(()));
}

pub fn noncanonical_numbers_and_hashes() {
    let text = std::str::from_utf8(EVENT).unwrap();
    for bad in [
        "9007199254740994",
        "9007199254740994.0",
        "true",
        "null",
        "\"\"",
        "\"00\"",
        "\"01\"",
        "\"-1\"",
        "\"+1\"",
        "\" 1\"",
        "\"1e3\"",
        "\"18446744073709551616\"",
        "\"0000000000000000000000000\"",
    ] {
        let corrupt = text.replacen(
            "\"sequence\":\"9007199254740994\"",
            &format!("\"sequence\":{bad}"),
            1,
        );
        assert!(
            matches!(
                EventRecord::from_bytes(corrupt.as_bytes()),
                Err(SessionError::Malformed(_))
            ),
            "accepted {bad}"
        );
    }
    let original = std::str::from_utf8(MANIFEST).unwrap();
    let hash = &m_hash(&manifest());
    for replacement in [hash.to_uppercase(), "0".repeat(63), "g".repeat(64)] {
        let corrupt = original.replacen(hash, &replacement, 1);
        assert!(matches!(
            SessionManifest::from_bytes(corrupt.as_bytes()),
            Err(SessionError::Malformed(_))
        ));
    }
    assert!(matches!(
        SessionManifest::from_bytes(&[0xff, 0xfe]),
        Err(SessionError::Malformed(_))
    ));
    assert!(matches!(
        SessionManifest::from_bytes(&vec![b' '; MAX_MANIFEST_BYTES + 1]),
        Err(SessionError::TooLarge(_))
    ));
    assert!(matches!(
        EventRecord::from_bytes(&vec![b' '; MAX_EVENT_BYTES + 1]),
        Err(SessionError::TooLarge(_))
    ));
}

fn m_hash(m: &SessionManifest) -> String {
    // This exact expected hash is also present in the externally generated JSON fixture.
    m.assets[0]
        .content
        .sha256
        .0
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn identities_and_capture_admission() {
    let m = manifest();
    let before = m.to_bytes().unwrap();
    for name in [
        "vm_build",
        "wasm_build",
        "base_image",
        "kernel",
        "initramfs",
        "RAM",
        "harts",
        "devices",
        "GPU",
    ] {
        let mut expected = runtime(&m);
        let other = ContentHash([99; 32]);
        match name {
            "vm_build" => expected.machine.vm_build = other,
            "wasm_build" => expected.machine.wasm_build = other,
            "base_image" => expected.machine.base_image = other,
            "kernel" => expected.machine.kernel = other,
            "initramfs" => expected.machine.initramfs = Some(other),
            "RAM" => expected.machine.ram_bytes = ExactU64(512 << 20),
            "harts" => expected.machine.harts = 2,
            "devices" => expected.machine.devices[0].irq = 11,
            "GPU" => {
                expected.machine.gpu = Some(GpuIdentity {
                    renderer_build: other,
                    profile: other,
                })
            }
            _ => unreachable!(),
        }
        assert_eq!(
            m.admit(&expected),
            Err(SessionError::IdentityMismatch(name))
        );
        assert_eq!(m.to_bytes().unwrap(), before, "admission mutated {name}");
    }
    for variant in 0..7 {
        let mut expected = runtime(&m);
        match variant {
            0 => expected.policy.clock.divider = 64,
            1 => expected.policy.clock.mode = ClockMode::Wall,
            2 => expected.policy.event_version.minor = 1,
            3 => expected.policy.checkpoint_version.major = 2,
            4 => expected.policy.boundary_version = 2,
            5 => expected.policy.mode = RecordingMode::CheckpointsOnly,
            _ => {
                expected.policy.required_inputs.pop().unwrap();
            }
        }
        assert_eq!(
            m.admit(&expected),
            Err(SessionError::IdentityMismatch("replay policy"))
        );
    }
    for missing in ["uart", "rtc", "entropy"] {
        let mut expected = runtime(&m);
        expected.captured_inputs.retain(|input| input != missing);
        assert_eq!(
            m.admit(&expected),
            Err(SessionError::MissingCapture(missing.into()))
        );
    }
    // Mutate the recording itself, keeping its internal asset binding consistent.
    for role in ["vm", "wasm", "kernel", "base"] {
        let mut foreign = m.clone();
        let hash = ContentHash([77; 32]);
        foreign
            .assets
            .iter_mut()
            .find(|asset| asset.role == role)
            .unwrap()
            .content
            .sha256 = hash;
        match role {
            "vm" => foreign.machine.vm_build = hash,
            "wasm" => foreign.machine.wasm_build = hash,
            "kernel" => foreign.machine.kernel = hash,
            _ => foreign.machine.base_image = hash,
        }
        foreign.validate().unwrap();
        assert!(matches!(
            foreign.admit(&runtime(&m)),
            Err(SessionError::IdentityMismatch(_))
        ));
    }
    assert_eq!(m.to_bytes().unwrap(), before);
}

pub fn unavailable_history_is_preserved() {
    let m = manifest();
    let before = m.to_bytes().unwrap();
    let current = RuntimeDescriptor {
        machine: MachineIdentity {
            vm_build: ContentHash([42; 32]),
            ..m.machine.clone()
        },
        ..runtime(&m)
    };
    let retained = vec![
        VerifiedAsset::from_bytes(b"vm-runtime-v1"),
        VerifiedAsset::from_bytes(b"wasm-module-v1"),
        VerifiedAsset::from_bytes(b"kernel-v1"),
        VerifiedAsset::from_bytes(b"base-image-v1"),
    ];
    assert_eq!(
        m.availability(std::slice::from_ref(&current), &retained),
        Ok(RuntimeAvailability::UnavailableRuntime)
    );
    let catalogue = vec![current, runtime(&m)];
    assert_eq!(
        m.availability(&catalogue, &retained),
        Ok(RuntimeAvailability::Available { runtime_index: 1 })
    );
    assert_eq!(
        m.availability(&catalogue, &retained[1..]),
        Ok(RuntimeAvailability::UnavailableAsset {
            sha256: m.machine.vm_build,
            length: m.assets[0].content.length
        })
    );
    let corrupt = vec![
        VerifiedAsset::from_bytes(b"vm-runtime-v2"),
        retained[1].clone(),
        retained[2].clone(),
        retained[3].clone(),
    ];
    assert!(matches!(
        m.availability(&catalogue, &corrupt),
        Ok(RuntimeAvailability::UnavailableAsset { .. })
    ));
    assert_eq!(m.to_bytes().unwrap(), before);
}

pub fn schema_duplicates_and_bounds() {
    let m = manifest();
    let text = std::str::from_utf8(MANIFEST).unwrap();
    for corrupt in [
        text.replacen("\"id\":", "\"id\":\"duplicate\",\"id\":", 1),
        text.replacen("\"harts\":1", "\"harts\":1,\"harts\":1", 1),
        text.replacen(
            "\"ram_bytes\":",
            "\"unknown_required\":true,\"ram_bytes\":",
            1,
        ),
    ] {
        assert!(matches!(
            SessionManifest::from_bytes(corrupt.as_bytes()),
            Err(SessionError::Malformed(_))
        ));
    }
    for section in ["manifest", "events", "checkpoints"] {
        let mut bad = m.clone();
        match section {
            "manifest" => bad.version.major = 2,
            "events" => bad.policy.event_version.minor = 1,
            _ => bad.policy.checkpoint_version.major = 2,
        }
        assert!(
            matches!(bad.validate(), Err(SessionError::Version { section: found, .. }) if found == section)
        );
    }
    let mut bad = m.clone();
    bad.machine.devices.push(bad.machine.devices[0].clone());
    assert_eq!(bad.validate(), Err(SessionError::Duplicate("device id")));
    let mut bad = m.clone();
    bad.assets.push(bad.assets[0].clone());
    assert_eq!(bad.validate(), Err(SessionError::Duplicate("asset role")));
    let mut bad = m.clone();
    bad.checkpoints.push(bad.checkpoints[0].clone());
    assert_eq!(
        bad.validate(),
        Err(SessionError::Duplicate("checkpoint id"))
    );
    let mut bad = m.clone();
    bad.extensions.push(bad.extensions[0].clone());
    assert_eq!(
        bad.validate(),
        Err(SessionError::Duplicate("extension kind"))
    );
    let mut bad = m.clone();
    bad.extensions[0].required = true;
    assert!(matches!(
        bad.validate(),
        Err(SessionError::UnsupportedRequired(_))
    ));
    let mut bad = m.clone();
    bad.extensions[0].bytes = vec![0; 8193];
    assert_eq!(
        bad.validate(),
        Err(SessionError::TooLarge("extension bytes"))
    );
    let mut bad = m.clone();
    bad.extensions = vec![bad.extensions[0].clone(); 17];
    assert_eq!(bad.validate(), Err(SessionError::TooLarge("extensions")));
    let mut bad = m.clone();
    bad.assets = vec![bad.assets[0].clone(); 17];
    assert_eq!(
        bad.validate(),
        Err(SessionError::TooLarge("runtime assets"))
    );
    let mut bad = m.clone();
    bad.checkpoints = vec![bad.checkpoints[0].clone(); MAX_INDEX_ENTRIES + 1];
    assert_eq!(bad.validate(), Err(SessionError::TooLarge("session index")));
    let mut bad = m.clone();
    bad.events = vec![bad.events[0].clone(); MAX_INDEX_ENTRIES + 1];
    assert_eq!(bad.validate(), Err(SessionError::TooLarge("session index")));
    for role in ["vm", "wasm", "kernel", "base"] {
        let mut bad = m.clone();
        bad.assets.retain(|a| a.role != role);
        assert_eq!(bad.validate(), Err(SessionError::MissingAsset(role)));
    }
    let mut bad = m.clone();
    bad.assets[0].role = "foreign-runtime-section".into();
    assert!(matches!(
        bad.validate(),
        Err(SessionError::UnsupportedRequired(_))
    ));
    let mut bad = m.clone();
    bad.policy.required_inputs.push("unknown-source".into());
    assert!(matches!(
        bad.validate(),
        Err(SessionError::UnsupportedRequired(_))
    ));
    let mut bad = m.clone();
    bad.policy.required_inputs.push("uart".into());
    assert_eq!(
        bad.validate(),
        Err(SessionError::Duplicate("capture inputs"))
    );
    let mut bad = m.clone();
    bad.policy.required_inputs.clear();
    assert_eq!(
        bad.validate(),
        Err(SessionError::Invalid("exact replay capture set"))
    );
    let mut bad = m.clone();
    bad.policy.required_inputs = vec!["uart".into(); 33];
    assert_eq!(
        bad.validate(),
        Err(SessionError::TooLarge("capture inputs"))
    );
    for value in ["", "contains space", "bad\0id"] {
        let mut bad = m.clone();
        bad.id = value.into();
        assert_eq!(bad.validate(), Err(SessionError::Invalid("session id")));
    }
    let mut bad = m.clone();
    bad.id = "x".repeat(65);
    assert_eq!(bad.validate(), Err(SessionError::Invalid("session id")));
}

pub fn topology_and_index_attacks() {
    let m = manifest();
    for size in [0, 8 << 20, (256 << 20) + 1, 2 << 30] {
        let mut bad = m.clone();
        bad.machine.ram_bytes = ExactU64(size);
        assert_eq!(
            bad.validate(),
            Err(SessionError::Invalid("one-hart RAM topology"))
        );
    }
    let mut bad = m.clone();
    bad.machine.harts = 2;
    assert_eq!(
        bad.validate(),
        Err(SessionError::Invalid("one-hart RAM topology"))
    );
    let mut bad = m.clone();
    bad.machine.devices.clear();
    assert_eq!(
        bad.validate(),
        Err(SessionError::Invalid("device topology"))
    );
    let mut bad = m.clone();
    bad.machine.devices = vec![bad.machine.devices[0].clone(); 33];
    assert_eq!(
        bad.validate(),
        Err(SessionError::Invalid("device topology"))
    );
    let mut bad = m.clone();
    bad.machine.devices[0].kind = "virtio-9p".into();
    assert!(matches!(
        bad.validate(),
        Err(SessionError::UnsupportedRequired(_))
    ));
    let mut bad = m.clone();
    bad.machine.devices[1].mmio_base = bad.machine.devices[0].mmio_base;
    assert_eq!(
        bad.validate(),
        Err(SessionError::Invalid("overlapping devices"))
    );
    let mut bad = m.clone();
    bad.machine.devices[0].mmio_base = ExactU64(u64::MAX);
    assert_eq!(bad.validate(), Err(SessionError::Overflow));
    for variant in 0..3 {
        let mut bad = m.clone();
        match variant {
            0 => bad.machine.devices[0].irq = 1024,
            1 => bad.machine.devices[0].state_version = 0,
            _ => bad.machine.devices[0].mmio_length = 0,
        }
        assert_eq!(bad.validate(), Err(SessionError::Invalid("device shape")));
    }
    for variant in 0..5 {
        let mut bad = m.clone();
        match variant {
            0 => bad.policy.profile = "userspace".into(),
            1 => bad.policy.boundary_version = 2,
            2 => bad.policy.clock.divider = 0,
            3 => bad.policy.clock.timebase_hz = ExactU64(1),
            _ => bad.policy.clock.interactive = Some("paced-on-keyboard".into()),
        }
        assert!(matches!(bad.validate(), Err(SessionError::Invalid(_))));
    }
    let mut bad = m.clone();
    bad.events[0].count = 0;
    assert_eq!(
        bad.validate(),
        Err(SessionError::Invalid("event chunk shape"))
    );
    let mut bad = m.clone();
    bad.events[0].count = MAX_EVENTS_PER_CHUNK + 1;
    assert_eq!(
        bad.validate(),
        Err(SessionError::Invalid("event chunk shape"))
    );
    let mut bad = m.clone();
    bad.events[0].content.length = ExactU64(MAX_CHUNK_BYTES + 1);
    assert_eq!(
        bad.validate(),
        Err(SessionError::Invalid("event chunk shape"))
    );
    for variant in 0..7 {
        let mut bad = m.clone();
        match variant {
            0 => bad.events[0].first.sequence.0 += 1,
            1 => bad.events[0].last.sequence.0 -= 1,
            2 => bad.end.sequence.0 += 1,
            3 => bad.begin.retired = ExactU64(u64::MAX),
            4 => bad.checkpoints[0].next_sequence.0 += 1,
            5 => bad.checkpoints[0].position.transition = ExactU64(1),
            _ => bad.policy.mode = RecordingMode::CheckpointsOnly,
        }
        assert_eq!(bad.validate(), Err(SessionError::IndexOrder));
    }
    let mut bad = m.clone();
    bad.checkpoints[0].position.ordinal = 1;
    assert_eq!(
        bad.validate(),
        Err(SessionError::Invalid("initial checkpoint"))
    );
    let mut bad = m.clone();
    bad.begin.sequence = ExactU64(u64::MAX);
    bad.end = bad.begin;
    bad.events.clear();
    bad.checkpoints[0].position = bad.begin;
    assert_eq!(bad.validate(), Err(SessionError::Overflow));
    let mut bad = m.clone();
    bad.checkpoints[0].machine.length = ExactU64(0);
    assert_eq!(bad.validate(), Err(SessionError::Invalid("blob length")));
    let mut bad = m.clone();
    bad.checkpoints[0].machine.length = ExactU64(MAX_SESSION_BYTES + 1);
    assert_eq!(bad.validate(), Err(SessionError::Invalid("blob length")));
    let mut bad = m.clone();
    bad.checkpoints[0].machine.length = ExactU64(MAX_SESSION_BYTES);
    assert_eq!(
        bad.validate(),
        Err(SessionError::TooLarge("session payload"))
    );
}

pub fn event_and_chunk_integrity() {
    let m = manifest();
    let e = event();
    let mut corrupt = CHUNK.to_vec();
    let last = corrupt.len() - 2;
    corrupt[last] ^= 1;
    assert_eq!(
        m.events[0].decode_records(&corrupt),
        Err(SessionError::DigestMismatch)
    );
    assert!(matches!(
        m.events[0].decode_records(&CHUNK[..CHUNK.len() - 1]),
        Err(SessionError::LengthMismatch { .. })
    ));
    let mut index = m.events[0].clone();
    index.count = 2;
    assert_eq!(
        index.decode_records(CHUNK),
        Err(SessionError::Invalid("event index differs from payload"))
    );
    let mut index = m.events[0].clone();
    index.first.ordinal = 1;
    assert_eq!(
        index.decode_records(CHUNK),
        Err(SessionError::Invalid("event index differs from payload"))
    );
    let mut index = m.events[0].clone();
    index.content = BlobRef::of(b"not-json");
    assert!(matches!(
        index.decode_records(b"not-json"),
        Err(SessionError::Malformed(_))
    ));
    let mut index = m.events[0].clone();
    index.count = 0;
    assert_eq!(
        index.decode_records(CHUNK),
        Err(SessionError::Invalid("event chunk shape"))
    );
    assert_eq!(
        EventChunkIndex::from_records(&[]),
        Err(SessionError::Invalid("event count"))
    );
    let mut next = e.clone();
    next.sequence.0 += 2;
    assert_eq!(
        EventChunkIndex::from_records(&[e.clone(), next]),
        Err(SessionError::IndexOrder)
    );
    let mut maximum = e.clone();
    maximum.sequence = ExactU64(u64::MAX);
    assert_eq!(
        EventChunkIndex::from_records(&[maximum.clone(), maximum]),
        Err(SessionError::Overflow)
    );
    let mut bad = e.clone();
    bad.required = false;
    assert_eq!(
        bad.validate(),
        Err(SessionError::Invalid("optional guest effect"))
    );
    let mut bad = e.clone();
    bad.kind = "unknown-guest-effect".into();
    assert!(matches!(
        bad.validate(),
        Err(SessionError::UnsupportedRequired(_))
    ));
    bad.required = false;
    assert!(matches!(
        bad.validate(),
        Err(SessionError::UnsupportedRequired(_))
    ));
    bad.kind = "annotation.future".into();
    assert_eq!(
        EventRecord::from_bytes(&bad.to_bytes().unwrap()).unwrap(),
        bad
    );
    let mut bad = e.clone();
    bad.sequence = ExactU64(0);
    assert_eq!(bad.validate(), Err(SessionError::IndexOrder));
    let mut bad = e.clone();
    bad.version.major = 2;
    assert!(matches!(bad.validate(), Err(SessionError::Version { .. })));
    let mut bad = e.clone();
    bad.intent = vec![0; 65_537];
    assert_eq!(bad.validate(), Err(SessionError::TooLarge("event intent")));
    let mut bad = e.clone();
    bad.payload = EventPayload::Inline {
        bytes: vec![0; MAX_INLINE_BYTES + 1],
    };
    assert_eq!(bad.to_bytes(), Err(SessionError::TooLarge("inline event")));
    let mut bad = e.clone();
    bad.status = "".into();
    assert_eq!(bad.validate(), Err(SessionError::Invalid("event status")));
    let mut external = e.clone();
    external.payload = EventPayload::Blob {
        content: BlobRef::of(b"payload"),
    };
    assert_eq!(
        EventRecord::from_bytes(&external.to_bytes().unwrap()).unwrap(),
        external
    );
    if let EventPayload::Blob { content } = &mut external.payload {
        content.length = ExactU64(MAX_CHUNK_BYTES + 1);
    }
    assert_eq!(
        external.validate(),
        Err(SessionError::TooLarge("event blob"))
    );
    for kind in [
        "uart",
        "keyboard",
        "tablet",
        "mouse",
        "display",
        "clock",
        "rtc",
        "entropy",
        "block",
        "network",
        "agent",
        "file-transfer",
        "audio",
        "gpu",
        "lifecycle",
    ] {
        let mut record = e.clone();
        record.kind = kind.into();
        assert_eq!(
            EventRecord::from_bytes(&record.to_bytes().unwrap()).unwrap(),
            record
        );
    }
    let mut next = e.clone();
    next.sequence.0 += 1;
    next.ordinal = 1;
    let (index, bytes) = EventChunkIndex::from_records(&[e.clone(), next.clone()]).unwrap();
    assert_eq!(
        index.decode_records(&bytes).unwrap(),
        vec![e.clone(), next.clone()]
    );
    let mut multiple = m.clone();
    multiple.end = next.position();
    multiple.events = vec![index];
    let mut checkpoint = multiple.checkpoints[0].clone();
    checkpoint.id = "later".into();
    checkpoint.position = multiple.end;
    checkpoint.next_sequence = ExactU64(multiple.end.sequence.0 + 1);
    multiple.checkpoints.push(checkpoint);
    assert_eq!(
        SessionManifest::from_bytes(&multiple.to_bytes().unwrap()).unwrap(),
        multiple
    );
    let mut bad = m.clone();
    bad.events[0].last.ordinal = 1;
    bad.end.ordinal = 1;
    assert_eq!(bad.validate(), Err(SessionError::IndexOrder));
    let mut large = e;
    large.payload = EventPayload::Inline {
        bytes: vec![255; 300_000],
    };
    let mut records = Vec::new();
    for step in 0..5 {
        let mut record = large.clone();
        record.sequence.0 += step;
        record.ordinal += step as u32;
        records.push(record);
    }
    assert_eq!(
        EventChunkIndex::from_records(&records),
        Err(SessionError::TooLarge("event chunk"))
    );
}

pub fn gpu_checkpoint_binding() {
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
    gpu.policy.clock.divider = 64;
    gpu.policy.clock.interactive = Some("paced-on-keyboard".into());
    gpu.policy
        .required_inputs
        .extend(["gpu-results", "display", "dma", "mtime"].map(String::from));
    gpu.checkpoints[0].gpu = Some(BlobRef::of(b"renderer-state-v1"));
    let bytes = gpu.to_bytes().unwrap();
    assert_eq!(SessionManifest::from_bytes(&bytes).unwrap(), gpu);
    let mut expected = runtime(&gpu);
    expected
        .captured_inputs
        .extend(["gpu-results", "display", "dma", "mtime"].map(String::from));
    assert_eq!(gpu.admit(&expected), Ok(()));
    let mut foreign = expected.clone();
    foreign.machine.gpu.as_mut().unwrap().profile = ContentHash([18; 32]);
    assert_eq!(
        gpu.admit(&foreign),
        Err(SessionError::IdentityMismatch("GPU"))
    );
    let mut bad = gpu.clone();
    bad.checkpoints[0].gpu = None;
    assert_eq!(
        bad.validate(),
        Err(SessionError::Invalid("checkpoint GPU binding"))
    );
    let mut bad = gpu.clone();
    bad.machine.gpu = None;
    assert_eq!(bad.validate(), Err(SessionError::Invalid("GPU profile")));
    let mut bad = manifest();
    bad.machine.gpu = gpu.machine.gpu.clone();
    assert_eq!(bad.validate(), Err(SessionError::Invalid("GPU profile")));
    assert_eq!(gpu.to_bytes().unwrap(), bytes);
    // Checkpoint-only sessions have no event claim, but keep precise saved positions.
    let mut checkpoint = manifest();
    checkpoint.policy.mode = RecordingMode::CheckpointsOnly;
    checkpoint.policy.required_inputs.clear();
    checkpoint.events.clear();
    checkpoint.end = checkpoint.begin;
    assert_eq!(
        SessionManifest::from_bytes(&checkpoint.to_bytes().unwrap()).unwrap(),
        checkpoint
    );
}

pub fn topology_requires_capture() {
    let cases: &[(&str, &[&str])] = &[
        ("uart16550", &["uart"]),
        ("clint", &["timers"]),
        ("plic", &[]),
        ("goldfish-rtc", &["rtc"]),
        ("virtio-blk", &["block-read", "block-write", "dma"]),
        ("virtio-net", &["network", "network-time", "dma"]),
        ("virtio-rng", &["entropy", "dma"]),
        ("virtio-keyboard", &["keyboard", "dma"]),
        ("virtio-tablet", &["pointer", "dma"]),
        ("virtio-mouse", &["pointer", "dma"]),
        ("virtio-snd", &["audio-playback", "dma"]),
        ("virtio-gpu2d", &["software-gpu", "display", "dma"]),
        ("virtio-gpu3d", &["gpu-results", "display", "dma"]),
        ("virtio-console", &["agent", "clipboard", "dma"]),
    ];
    for (kind, required) in cases {
        let mut m = manifest();
        m.machine.devices.truncate(1);
        m.machine.devices[0].kind = (*kind).into();
        m.policy.required_inputs = CAPTURE_INPUTS.iter().copied().map(String::from).collect();
        if *kind == "virtio-gpu3d" {
            let renderer = BlobRef::of(b"renderer-v1");
            m.machine.gpu = Some(GpuIdentity {
                renderer_build: renderer.sha256,
                profile: ContentHash([17; 32]),
            });
            m.assets.push(RuntimeAsset {
                role: "gpu-renderer".into(),
                content: renderer,
            });
            m.policy.profile = "rv64-linux-gpu-v1".into();
            m.checkpoints[0].gpu = Some(BlobRef::of(b"renderer-state-v1"));
        }
        m.validate().unwrap();
        for input in ["lifecycle", "storage-control", "checkpoint-control"]
            .iter()
            .chain(required.iter())
        {
            let mut omitted = m.clone();
            omitted
                .policy
                .required_inputs
                .retain(|candidate| candidate != input);
            assert_eq!(
                omitted.validate(),
                Err(SessionError::MissingCapture((*input).into())),
                "{kind} omits {input}"
            );
        }
    }
    for mode in [ClockMode::Wall, ClockMode::PacedIcount] {
        let mut m = manifest();
        m.policy.clock.mode = mode;
        assert_eq!(
            m.validate(),
            Err(SessionError::MissingCapture("mtime".into()))
        );
        m.policy.required_inputs.push("mtime".into());
        m.validate().unwrap();
    }
    let mut m = manifest();
    let initramfs = BlobRef::of(b"initramfs-v1");
    m.machine.initramfs = Some(initramfs.sha256);
    m.assets.push(RuntimeAsset {
        role: "initramfs".into(),
        content: initramfs,
    });
    m.validate().unwrap();
    m.assets.pop();
    assert_eq!(m.validate(), Err(SessionError::MissingAsset("initramfs")));
}
