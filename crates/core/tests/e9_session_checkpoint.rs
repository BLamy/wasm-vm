//! Real native instructions and DMA/input state through the exact session boundary.
#![cfg(not(feature = "zicsr-stub"))]
use std::path::PathBuf;
use wasm_vm_core::dev::virtio::input::{EV_KEY, EV_SYN, InputEvent, SYN_REPORT};
use wasm_vm_core::{
    Machine,
    bus::Bus,
    platform::{Platform, virt},
    resume::{SectionReader, SnapshotWriter, section},
    trace::{HashSink, NullSink},
};

fn machine(name: &str) -> Machine {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/riscv-tests-bin")
        .join(name);
    let mut m = Machine::new(8 * 1024 * 1024);
    m.load_elf(&std::fs::read(path).unwrap()).unwrap();
    m
}

#[test]
fn session_native_trace_matches_uninterrupted_guest() {
    for name in [
        "rv64ud-p-fmadd",
        "rv64ua-p-lrsc",
        "rv64mi-p-csr",
        "rv64mi-p-zicntr",
    ] {
        for n in [37, 111] {
            let mut source = machine(name);
            source.run_traced(n, &mut NullSink);
            let before = source.snapshot();
            let saved = source.save_session_resume().unwrap();
            assert_eq!(source.snapshot(), before, "capture changed CPU/RAM");
            let mut reference = HashSink::new();
            source.run_traced(220, &mut reference);
            let mut target = machine(name);
            target.run_traced(n + 19, &mut NullSink);
            target.load_session_resume(&saved).unwrap();
            assert_eq!(target.snapshot(), before);
            let mut restored = HashSink::new();
            target.run_traced(220, &mut restored);
            assert!(
                reference.retired() > 0,
                "unexecuted continuation {name} {n}"
            );
            assert_eq!(
                (reference.hash(), reference.retired()),
                (restored.hash(), restored.retired())
            );
            assert_eq!(target.snapshot(), source.snapshot());
            println!(
                "E9_SESSION_NATIVE {name} boundary={n} retired={} trace={:016x} ram={}",
                reference.retired(),
                reference.hash(),
                source.snapshot().hex_digest()
            );
        }
    }
}

#[test]
fn session_machine_keeps_delivered_key_without_capture_releases() {
    let mut source = machine("rv64ua-p-lrsc");
    source.enable_plic();
    source.enable_virtio_slots(None);
    let (_, keys, _) = source.enable_virtio_keyboard();
    let b = virt::DRAM_BASE + 0x60000;
    let base = Platform::virtio_base(3);
    // Real split ring with two writable 8-byte event descriptors: key down and SYN_REPORT.
    for (offset, value) in [
        (0x030, 0),
        (0x038, 8),
        (0x080, b as u32),
        (0x084, (b >> 32) as u32),
        (0x090, (b + 0x800) as u32),
        (0x094, ((b + 0x800) >> 32) as u32),
        (0x0a0, (b + 0xa00) as u32),
        (0x0a4, ((b + 0xa00) >> 32) as u32),
        (0x044, 1),
        (0x070, 0x0f),
    ] {
        source.bus_mut().store32(base + offset, value).unwrap();
    }
    for i in 0..2u64 {
        source
            .bus_mut()
            .store64(b + i * 16, b + 0xc00 + i * 8)
            .unwrap();
        source.bus_mut().store32(b + i * 16 + 8, 8).unwrap();
        source.bus_mut().store16(b + i * 16 + 12, 2).unwrap();
        source
            .bus_mut()
            .store16(b + 0x804 + i * 2, i as u16)
            .unwrap();
    }
    source.bus_mut().store16(b + 0x802, 2).unwrap();
    assert!(keys.borrow_mut().inject_event(EV_KEY, 30, 1));
    keys.borrow_mut().sync();
    source.bus_mut().store32(base + 0x050, 0).unwrap();
    source.run_traced(1, &mut NullSink);
    assert_eq!(source.bus_mut().load16(b + 0xa02).unwrap(), 2);
    assert_eq!(source.bus_mut().load16(b + 0xc00).unwrap(), EV_KEY);
    assert_eq!(source.bus_mut().load16(b + 0xc02).unwrap(), 30);
    assert_eq!(source.bus_mut().load32(b + 0xc04).unwrap(), 1);
    assert_eq!(keys.borrow().pending_events(), 0);
    let input = keys.borrow().to_session_snapshot().unwrap();
    let before = source.snapshot();
    let saved = source.save_session_resume().unwrap();
    assert_eq!(keys.borrow().to_session_snapshot().unwrap(), input);
    assert_eq!(source.snapshot(), before);
    let mut target = machine("rv64ua-p-lrsc");
    target.enable_plic();
    target.enable_virtio_slots(None);
    let (_, restored, _) = target.enable_virtio_keyboard();
    target.load_session_resume(&saved).unwrap();
    assert_eq!(target.snapshot(), before);
    assert_eq!(restored.borrow().to_session_snapshot().unwrap(), input);
    assert_eq!(
        restored.borrow_mut().release_all().release_events,
        [
            InputEvent::new(EV_KEY, 30, 0),
            InputEvent::new(EV_SYN, SYN_REPORT, 0)
        ]
    );
}

#[test]
fn session_missing_duplicate_or_corrupt_components_are_atomic() {
    let mut source = machine("rv64mi-p-csr");
    source.run_traced(41, &mut NullSink);
    let saved = source.save_session_resume().unwrap();
    for mode in 0..5 {
        let (header, sections) = SectionReader::new(&saved).unwrap();
        let mut writer = SnapshotWriter::new(
            &header.core_hash,
            &header.base_image_hash,
            header.overlay_generation,
        );
        for s in sections {
            let s = s.unwrap();
            if mode == 0 && s.tag == section::CPU {
                continue;
            }
            if mode >= 3 && s.tag == section::CLOCK {
                let mut clock = s.payload.to_vec();
                if mode == 3 {
                    clock[8..16].copy_from_slice(&0u64.to_le_bytes());
                } else {
                    clock[..8].copy_from_slice(&u64::MAX.to_le_bytes());
                }
                writer.section(s.tag, &clock);
            } else if mode == 2 && s.tag == section::CPU {
                writer.section(s.tag, &[0xff]);
            } else {
                writer.section(s.tag, s.payload);
            }
            if mode == 1 && s.tag == section::RAM {
                writer.section(s.tag, s.payload);
            }
        }
        let mut target = machine("rv64mi-p-csr");
        target.run_traced(63, &mut NullSink);
        let before = target.save_session_resume().unwrap();
        assert!(target.load_session_resume(&writer.finish()).is_err());
        assert_eq!(target.save_session_resume().unwrap(), before);
    }
}

#[test]
fn session_active_audio_refuses_capture_and_restore_without_mutation() {
    use wasm_vm_core::dev::virtio::snd::{
        PcmParams, VIRTIO_SND_R_PCM_PREPARE, VIRTIO_SND_R_PCM_START, VIRTIO_SND_S_OK,
    };
    let mut source = machine("rv64mi-p-csr");
    source.enable_plic();
    source.enable_virtio_slots(None);
    let (_, sound) = source.enable_virtio_snd();
    let control = |request: &[u8]| {
        let bytes = sound.borrow_mut().handle_control(request);
        assert_eq!(
            u32::from_le_bytes(bytes[..4].try_into().unwrap()),
            VIRTIO_SND_S_OK
        );
    };
    control(&PcmParams::default().to_bytes());
    let request = |code: u32| {
        let mut bytes = [0; 8];
        bytes[..4].copy_from_slice(&code.to_le_bytes());
        bytes
    };
    control(&request(VIRTIO_SND_R_PCM_PREPARE));
    let prepared = source.save_session_resume().unwrap();
    control(&request(VIRTIO_SND_R_PCM_START));
    let audio = sound.borrow().to_snapshot().unwrap();
    let state = source.snapshot();
    assert!(source.save_session_resume().is_err());
    assert_eq!(sound.borrow().to_snapshot().unwrap(), audio);
    assert_eq!(source.snapshot(), state);
    let active = source.save_resume().unwrap(); // Existing legacy desktop path remains available.
    source.load_session_resume(&prepared).unwrap();
    let before = source.save_session_resume().unwrap();
    assert!(source.load_session_resume(&active).is_err());
    assert_eq!(source.save_session_resume().unwrap(), before);
}
