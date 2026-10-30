//! Checkpoint identity with actual translated execution at a device-free capture boundary.
use jit_runtime::WasmtimeExecutor;
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    session_devices::{BaseDisk, CompletionStatus, DeviceIntent, PayloadRef},
};

fn payload(chunk: u32) -> Vec<u8> {
    (0..512)
        .map(|n| ((n * 13 + chunk as usize * 79 + 17) % 251) as u8)
        .collect()
}
fn board() -> Machine {
    let mut m = Machine::new(1 << 20);
    m.enable_clint(1);
    m.start_session_clock(1).unwrap();
    m.enable_session_devices(
        Some(BaseDisk {
            identity: [37; 32],
            sectors: 2,
            chunk_bytes: 512,
            chunks: (0..2)
                .map(|n| PayloadRef::of(&payload(n)).unwrap())
                .collect(),
        }),
        true,
        false,
        false,
    )
    .unwrap();
    let program = include_bytes!("../../../web/assets/e9-device-completions.bin");
    m.bus_mut().write_ram_slice(BASE, program).unwrap();
    for (i, word) in [
        0x001a0a13,
        0x003a8a93,
        0x005b0b13,
        0x007b8b93,
        0x00bc0c13,
        0xfedff06fu32,
    ]
    .into_iter()
    .enumerate()
    {
        m.bus_mut()
            .store32(BASE + (1605 + i as u64) * 4, word)
            .unwrap();
    }
    m.hart_mut().regs.pc = BASE;
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_executor(Box::new(WasmtimeExecutor::new()));
    m.set_hotness_threshold(1);
    m.set_jit(true);
    m
}
fn until(m: &mut Machine, target: u64, quantum: u64) {
    while m.session_position().unwrap().transition < target {
        assert_eq!(
            m.run_session_until(target, quantum),
            Ok(RunOutcome::MaxInstrs)
        );
    }
}
fn evidence(name: &str, bytes: &[u8]) {
    if let Some(dir) = std::env::var_os("E9_DEVICE_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), bytes).unwrap();
    }
}
#[test]
fn inactive_capture_has_identical_checkpoints_across_real_jit_batch_edges() {
    let mut m = board();
    until(&mut m, 4096, 31);
    let requests = m.session_device_requests().unwrap();
    assert_eq!(requests.len(), 3);
    for request in &requests {
        let bytes = match request.intent {
            DeviceIntent::BaseBlock { chunk, .. } => payload(chunk),
            DeviceIntent::Agent { .. } => b"file-agent-owned-result".to_vec(),
            DeviceIntent::Capture { .. } => panic!("capture is disabled"),
        };
        let lease = m.lease_session_device(request.id).unwrap();
        m.complete_session_device(&lease, CompletionStatus::Supplied, 0, bytes)
            .unwrap();
    }
    m.take_session_deliveries().unwrap();
    let pending = m.save_session_resume().unwrap();
    evidence("jit-inactive-capture-pending.resume", &pending);
    for target in [5000, 5001, 5002] {
        let mut expected = None;
        for quantum in [31, 1, 8, 4096] {
            let mut resumed = board();
            resumed.load_session_resume(&pending).unwrap();
            let before = resumed.executor().unwrap().executed_blocks();
            until(&mut resumed, target, quantum);
            let executed = resumed.executor().unwrap().executed_blocks() - before;
            if quantum >= 8 {
                assert!(
                    executed > 0,
                    "real six-instruction translated loop must execute"
                );
            }
            assert_eq!(resumed.bus_mut().load16(BASE + 0x12002), Ok(2));
            assert_eq!(resumed.bus_mut().load16(BASE + 0x22402), Ok(1));
            assert_eq!(resumed.session_device_cursor(), Ok(3));
            let frame = resumed.save_session_resume().unwrap();
            evidence(
                &format!("jit-inactive-capture-target{target}-q{quantum}.resume"),
                &frame,
            );
            if let Some(expected) = &expected {
                assert_eq!(
                    &frame, expected,
                    "target={target} quantum={quantum} compiled={executed}"
                );
            } else {
                expected = Some(frame);
            }
            println!(
                "target={target} quantum={quantum} compiled_blocks={executed} position={:?}",
                resumed.session_position().unwrap()
            );
        }
    }
}
