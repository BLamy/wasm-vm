use wasm_vm_core::{
    Machine,
    resume::{SectionReader, SnapshotWriter, section},
};
use wasm_vm_storage::{ImageManifest, Layout, OverlayDelta, checkpoint::*, session::*};
use wasm_vm_wasm::software_checkpoint::*;
fn fixture() -> (CheckpointContext, Vec<u8>, Vec<u8>) {
    let image = ImageManifest::from_image(&[0; 8192], 4096, Layout::Split).unwrap();
    let mut machine = Machine::new(16 << 20);
    machine.enable_clint(10);
    machine.set_snapshot_identity_with_generation(
        [1; 32],
        image.base_hash(),
        9_007_199_254_740_993,
    );
    let context = CheckpointContext {
        version: Version::V1,
        runtime: ContentHash::of(b"runtime"),
        kernel: ContentHash::of(b"kernel"),
        ram_bytes: ExactU64(16 << 20),
        clock: ClockPolicy {
            mode: ClockMode::Icount,
            divider: 10,
            timebase_hz: ExactU64(10_000_000),
            interactive: None,
        },
        position: Position::ZERO,
        held: HeldInput {
            keyboard: vec![30],
            tablet: vec![],
            mouse: vec![],
        },
    };
    let disk = OverlayDelta {
        image_len: 8192,
        base_binding: image.base_hash(),
        generation: 9_007_199_254_740_993,
        blocks: vec![(1, [0x72; 4096])],
    }
    .to_bytes();
    (context, machine.save_session_resume().unwrap(), disk)
}
#[test]
fn checkpoint_only_context_refuses_an_unbound_native_event_clock() {
    let (context, native, disk) = fixture();
    let (header, sections) = SectionReader::new(&native).unwrap();
    let mut writer = SnapshotWriter::new(
        &header.core_hash,
        &header.base_image_hash,
        header.overlay_generation,
    );
    for item in sections {
        let item = item.unwrap();
        writer.section(item.tag, item.payload);
    }
    let mut clocked = Machine::new(4096);
    clocked.start_session_clock(1).unwrap();
    let blob = clocked.save_session_resume().unwrap();
    let (_, sections) = SectionReader::new(&blob).unwrap();
    let payload = sections
        .map(Result::unwrap)
        .find(|s| s.tag == section::SESSION_CLOCK)
        .unwrap();
    writer.section(section::SESSION_CLOCK, payload.payload);
    assert!(matches!(
        SoftwareCheckpoint::encode(&context, &writer.finish(), &disk, b"", b""),
        Err(CheckpointError::Malformed)
    ));
}

#[test]
fn tuple_exact_components_and_each_digest() {
    let (context, native, disk) = fixture();
    let bytes = SoftwareCheckpoint::encode(
        &context,
        &native,
        &disk,
        b"queued UART\r",
        b"pending output",
    )
    .unwrap();
    let decoded = SoftwareCheckpoint::from_bytes(&bytes).unwrap();
    assert_eq!(decoded.context, context);
    assert_eq!(decoded.resume, native);
    assert_eq!(decoded.disk, disk);
    assert_eq!(decoded.input, b"queued UART\r");
    assert_eq!(decoded.output, b"pending output");
    for length in 0..bytes.len() {
        assert!(
            SoftwareCheckpoint::from_bytes(&bytes[..length]).is_err(),
            "truncation {length}"
        );
    }
    let mut offset = 212;
    for index in 0..5 {
        let length = u64::from_le_bytes(bytes[12 + index * 40..20 + index * 40].try_into().unwrap())
            as usize;
        let mut changed = bytes.clone();
        changed[offset] ^= 1;
        assert!(matches!(
            SoftwareCheckpoint::from_bytes(&changed),
            Err(CheckpointError::Digest)
        ));
        offset += length;
    }
    for at in [0, 8, 12, 52, 92, 132, 172] {
        let mut changed = bytes.clone();
        changed[at] = 255;
        assert!(SoftwareCheckpoint::from_bytes(&changed).is_err());
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(SoftwareCheckpoint::from_bytes(&trailing).is_err());
    println!(
        "E9_SOFTWARE_FRAME bytes={} generation=9007199254740993 five-component-digests=held",
        bytes.len()
    );
}
#[test]
fn tuples_reject_wrong_disk_and_clock_even_when_rehashed() {
    let (mut context, native, mut disk) = fixture();
    disk[49] ^= 1;
    assert!(SoftwareCheckpoint::encode(&context, &native, &disk, b"", b"").is_err());
    disk[49] ^= 1;
    disk[17] ^= 1;
    assert!(SoftwareCheckpoint::encode(&context, &native, &disk, b"", b"").is_err());
    disk[17] ^= 1;
    context.clock.divider = 11;
    assert!(SoftwareCheckpoint::encode(&context, &native, &disk, b"", b"").is_err());
    context.clock.divider = 10;
    for which in [0, 1, 2] {
        let (header, sections) = SectionReader::new(&native).unwrap();
        let mut writer = SnapshotWriter::new(
            &header.core_hash,
            &header.base_image_hash,
            header.overlay_generation,
        );
        for item in sections {
            let item = item.unwrap();
            if item.tag == section::CLOCK {
                if which == 0 {
                    continue;
                }
                let mut clock = item.payload.to_vec();
                clock[..8].copy_from_slice(&10u64.to_le_bytes());
                writer.section(item.tag, &clock);
                if which == 2 {
                    writer.section(item.tag, item.payload);
                }
            } else {
                writer.section(item.tag, item.payload);
            }
        }
        assert!(SoftwareCheckpoint::encode(&context, &writer.finish(), &disk, b"", b"").is_err());
    }
}
