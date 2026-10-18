use wasm_vm_storage::checkpoint::*;
use wasm_vm_storage::session::*;

pub fn fixture() -> CheckpointContext {
    CheckpointContext {
        version: Version::V1,
        runtime: ContentHash::of(b"runtime"),
        kernel: ContentHash::of(b"kernel"),
        ram_bytes: ExactU64(256 << 20),
        clock: ClockPolicy {
            mode: ClockMode::Icount,
            divider: 10,
            timebase_hz: ExactU64(10_000_000),
            interactive: None,
        },
        position: Position {
            transition: ExactU64(u64::MAX),
            phase: Phase::After,
            ordinal: u32::MAX,
            sequence: ExactU64(9_007_199_254_740_993),
            retired: ExactU64(u64::MAX),
        },
        held: HeldInput {
            keyboard: vec![30, 248],
            tablet: vec![272],
            mouse: vec![],
        },
    }
}
pub fn exact_cursor_and_keys() {
    let value = fixture();
    let bytes = value.to_bytes().unwrap();
    assert_eq!(CheckpointContext::from_bytes(&bytes).unwrap(), value);
    let text = std::str::from_utf8(&bytes).unwrap();
    assert!(text.contains("\"18446744073709551615\""));
    assert!(text.contains("\"9007199254740993\""));
    assert_eq!(
        CheckpointContext::canonical_json(&bytes)
            .unwrap()
            .as_bytes(),
        bytes
    );
}
pub fn refuse_shapes_versions_and_unrecorded_modes() {
    for change in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] {
        let mut value = fixture();
        match change {
            0 => value.version.major = 2,
            1 => value.version.minor = 1,
            2 => value.ram_bytes.0 = 1 << 20,
            3 => value.ram_bytes.0 = (1 << 30) + 4096,
            4 => value.ram_bytes.0 += 1,
            5 => value.clock.mode = ClockMode::Wall,
            6 => value.clock.interactive = Some("wall-on-keyboard".into()),
            7 => value.clock.divider = 0,
            8 => value.clock.timebase_hz.0 += 1,
            9 => value.held.keyboard = vec![30, 30],
            10 => value.held.tablet = vec![273, 272],
            _ => value.position.sequence.0 = u64::MAX,
        }
        assert!(value.to_bytes().is_err(), "case {change}");
    }
    let bytes = fixture().to_bytes().unwrap();
    for length in 0..bytes.len() {
        assert!(CheckpointContext::from_bytes(&bytes[..length]).is_err());
    }
    let mut json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    json["ram_bytes"] = serde_json::json!(268435456);
    assert!(CheckpointContext::from_bytes(&serde_json::to_vec(&json).unwrap()).is_err());
    json = serde_json::from_slice(&bytes).unwrap();
    json["unknown"] = serde_json::json!(true);
    assert!(CheckpointContext::from_bytes(&serde_json::to_vec(&json).unwrap()).is_err());
    assert!(CheckpointContext::from_bytes(&vec![b' '; MAX_CONTEXT_BYTES + 1]).is_err());
}
