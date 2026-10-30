//! Independent E9-T05 critic: late-component refusal and exact mixed-input continuations.
#![cfg(not(feature = "zicsr-stub"))]

use std::path::PathBuf;
use wasm_vm_core::Machine;
use wasm_vm_core::block::MemBackend;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::rtc::FixedClock;
use wasm_vm_core::dev::virtio::gpu::NullSink as DisplaySink;
use wasm_vm_core::dev::virtio::input::EV_KEY;
use wasm_vm_core::dev::virtio::net::LoopbackBackend;
use wasm_vm_core::dev::virtio::rng::EntropySource;
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::resume::{SectionReader, SnapshotWriter};
use wasm_vm_core::trace::{HashSink, NullSink};

struct NoEntropy;
impl EntropySource for NoEntropy {
    fn fill(&mut self, out: &mut [u8]) {
        out.fill(0x6d);
    }
}

fn machine(seed: u64) -> Machine {
    let mut value = Machine::new(16 << 20);
    let elf =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/riscv-tests-bin/rv64ua-p-lrsc");
    value.load_elf(&std::fs::read(elf).unwrap()).unwrap();
    value.enable_clint(1 + seed % 1024);
    value.enable_plic();
    value
        .enable_uart16550()
        .borrow_mut()
        .push_input(b"critic UART");
    value.enable_rtc(Box::new(FixedClock(0)));
    value.enable_virtio_blk(Box::new(MemBackend::new(vec![0; 8192])));
    value.enable_virtio_net(Box::new(LoopbackBackend::new()));
    value.enable_virtio_rng(Box::new(NoEntropy));
    let (_, keyboard, _) = value.enable_virtio_keyboard();
    let (_, tablet, _, mouse) = value.enable_virtio_pointer();
    value.enable_virtio_snd();
    value.enable_virtio_gpu(Box::new(DisplaySink)).unwrap();
    value.enable_virtio_console_at(8);
    for (slot, state, key) in [
        (3, keyboard, 30 + seed as u16 % 16),
        (4, tablet, 0x110),
        (5, mouse, 0x111),
    ] {
        // A real writable split ring delivers the first frame into guest RAM.
        let desc = virt::DRAM_BASE + 0x700000 + slot * 0x4000;
        let base = Platform::virtio_base(slot);
        for (offset, number) in [
            (0x030, 0),
            (0x038, 8),
            (0x080, desc as u32),
            (0x084, (desc >> 32) as u32),
            (0x090, (desc + 0x800) as u32),
            (0x094, ((desc + 0x800) >> 32) as u32),
            (0x0a0, (desc + 0xa00) as u32),
            (0x0a4, ((desc + 0xa00) >> 32) as u32),
            (0x044, 1),
            (0x070, 0x0f),
        ] {
            value.bus_mut().store32(base + offset, number).unwrap();
        }
        for index in 0..2u64 {
            value
                .bus_mut()
                .store64(desc + index * 16, desc + 0xc00 + index * 8)
                .unwrap();
            value.bus_mut().store32(desc + index * 16 + 8, 8).unwrap();
            value.bus_mut().store16(desc + index * 16 + 12, 2).unwrap();
            value
                .bus_mut()
                .store16(desc + 0x804 + index * 2, index as u16)
                .unwrap();
        }
        value.bus_mut().store16(desc + 0x802, 2).unwrap();
        assert!(state.borrow_mut().inject_event(EV_KEY, key, 1));
        state.borrow_mut().sync();
        value.bus_mut().store32(base + 0x050, 0).unwrap();
        value.run_traced(1, &mut NullSink);
        assert_eq!(value.bus_mut().load16(desc + 0xa02), Ok(2));
        assert_eq!(value.bus_mut().load32(desc + 0xc04), Ok(1));
        // A complete queued release and a separate staged press must both survive capture.
        assert!(state.borrow_mut().inject_event(EV_KEY, key, 0));
        state.borrow_mut().sync();
        assert!(state.borrow_mut().inject_event(EV_KEY, key + 1, 1));
    }
    value
}

fn reordered(blob: &[u8], rotation: usize, changed: Option<(u32, usize)>) -> Vec<u8> {
    let (header, reader) = SectionReader::new(blob).unwrap();
    let mut parts: Vec<_> = reader.map(Result::unwrap).collect();
    let count = parts.len();
    parts.rotate_left(rotation % count);
    parts.reverse();
    let mut writer = SnapshotWriter::new(
        &header.core_hash,
        &header.base_image_hash,
        header.overlay_generation,
    );
    for part in parts {
        if let Some((tag, mode)) = changed
            && tag == part.tag
        {
            match mode {
                0 => continue,
                1 => {
                    writer.section(part.tag, part.payload);
                }
                2 => {
                    writer.section(part.tag, &part.payload[..part.payload.len() - 1]);
                    continue;
                }
                3 => {
                    writer.section(part.tag, &[]);
                    continue;
                }
                _ => unreachable!(),
            }
        }
        writer.section(part.tag, part.payload);
    }
    if changed == Some((u32::MAX, 0)) {
        writer.section(u32::MAX, b"unrecognized component");
    }
    writer.finish()
}

#[test]
fn every_late_component_refusal_preserves_the_whole_destination() {
    let mut source = machine(19);
    source.run_traced(43, &mut NullSink);
    let saved = source.save_session_resume().unwrap();
    let (_, sections) = SectionReader::new(&saved).unwrap();
    let tags: Vec<_> = sections.map(|item| item.unwrap().tag).collect();
    assert_eq!(tags.len(), 16);
    let mut target = machine(731);
    target.run_traced(67, &mut NullSink);
    let original = target.save_session_resume().unwrap();
    for tag in tags {
        for mode in 0..4 {
            let bad = reordered(&saved, (tag as usize * 7 + mode) % 16, Some((tag, mode)));
            assert!(
                target.load_session_resume(&bad).is_err(),
                "accepted tag={tag} mode={mode}"
            );
            assert_eq!(
                target.save_session_resume().unwrap(),
                original,
                "partial target commit tag={tag} mode={mode}"
            );
        }
    }
    assert!(
        target
            .load_session_resume(&reordered(&saved, 3, Some((u32::MAX, 0))))
            .is_err()
    );
    assert_eq!(target.save_session_resume().unwrap(), original);
    let mut reference = machine(731);
    reference.load_session_resume(&original).unwrap();
    let (mut expected, mut observed) = (HashSink::new(), HashSink::new());
    reference.run_traced(211, &mut expected);
    target.run_traced(211, &mut observed);
    assert!(expected.retired() > 0);
    assert_eq!(
        (expected.hash(), expected.retired()),
        (observed.hash(), observed.retired())
    );
    assert_eq!(
        target.save_session_resume().unwrap(),
        reference.save_session_resume().unwrap()
    );
    println!(
        "E9_CRITIC atomic-refusals=65 all-components=16 continuation={:016x}",
        observed.hash()
    );
}

#[test]
fn mixed_delivered_pending_staged_input_survives_32_boundary_schedules() {
    for schedule in 0..32u64 {
        let seed = schedule.wrapping_mul(0x9e37_79b9).wrapping_add(0x4253);
        let mut source = machine(seed);
        source.run_traced(17 + seed % 113, &mut NullSink);
        let inputs = [
            source.keyboard_input().unwrap(),
            source.tablet_input().unwrap(),
            source.mouse_input().unwrap(),
        ];
        let logical_before = inputs
            .each_ref()
            .map(|input| input.borrow().to_session_snapshot().unwrap());
        for (index, bytes) in logical_before.iter().enumerate() {
            let legacy_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
            let ledger = 12 + legacy_length;
            assert_eq!(
                u32::from_le_bytes(bytes[ledger..ledger + 4].try_into().unwrap()),
                1
            );
            assert_eq!(
                u16::from_le_bytes(bytes[ledger + 4..ledger + 6].try_into().unwrap()),
                [30 + seed as u16 % 16, 0x110, 0x111][index]
            );
        }
        let saved = source.save_session_resume().unwrap();
        for (input, expected) in inputs.iter().zip(&logical_before) {
            assert_eq!(
                input.borrow().to_session_snapshot().unwrap(),
                *expected,
                "capture changed a delivered/pending/staged input ledger"
            );
        }
        let mut target = machine(seed ^ 0x1234);
        target.run_traced(7 + seed % 53, &mut NullSink);
        target
            .load_session_resume(&reordered(&saved, schedule as usize, None))
            .unwrap();
        assert_eq!(
            target.save_session_resume().unwrap(),
            saved,
            "schedule {schedule}"
        );
        assert_eq!(
            source.save_session_resume().unwrap(),
            saved,
            "capture mutated source"
        );
        let (mut expected, mut observed) = (HashSink::new(), HashSink::new());
        source.run_traced(251, &mut expected);
        target.run_traced(251, &mut observed);
        assert!(expected.retired() > 0);
        assert_eq!(
            (expected.hash(), expected.retired()),
            (observed.hash(), observed.retired())
        );
        assert_eq!(
            target.save_session_resume().unwrap(),
            source.save_session_resume().unwrap()
        );
        println!(
            "E9_CRITIC schedule={schedule} seed={seed} retired={} trace={:016x}",
            observed.retired(),
            observed.hash()
        );
    }
}
