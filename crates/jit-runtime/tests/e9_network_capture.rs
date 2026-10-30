//! Network cursor/queue restore across actual translated six-instruction batch edges.
use jit_runtime::WasmtimeExecutor;
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    session_network::{NetworkEvent, SendResult},
};
fn board(replay: bool) -> Machine {
    let mut m = Machine::new(1 << 20);
    m.enable_clint(1);
    m.start_session_clock(1).unwrap();
    m.enable_session_network(replay).unwrap();
    m.bus_mut()
        .write_ram_slice(
            BASE,
            include_bytes!("../../../web/assets/e9-network-capture.bin"),
        )
        .unwrap();
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
            .store32(BASE + (390 + i as u64) * 4, word)
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
fn until(m: &mut Machine, target: u64, q: u64) {
    while m.session_position().unwrap().transition < target {
        assert_eq!(m.run_session_until(target, q), Ok(RunOutcome::MaxInstrs));
    }
}
fn evidence(name: &str, bytes: &[u8]) {
    if let Some(dir) = std::env::var_os("E9_NETWORK_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), bytes).unwrap();
    }
}
#[test]
fn translated_network_checkpoints_match_before_at_and_after_batch_edges() {
    let mut original = board(false);
    until(&mut original, 4096, 31);
    let request = original.session_network_requests().unwrap().remove(0);
    let lease = original.lease_session_network(Some(request.id)).unwrap();
    original
        .complete_session_network(
            &lease,
            NetworkEvent::Send {
                request,
                result: SendResult::Sent,
            },
        )
        .unwrap();
    original.take_session_deliveries().unwrap();
    let pending = original.save_session_resume().unwrap();
    evidence("jit-network-pending.resume", &pending);
    for target in [5000, 5001, 5002] {
        let mut expected = None;
        for q in [31, 1, 8, 4096] {
            let mut m = board(true);
            m.load_session_resume(&pending).unwrap();
            let before = m.executor().unwrap().executed_blocks();
            until(&mut m, target, q);
            let compiled = m.executor().unwrap().executed_blocks() - before;
            if q >= 8 {
                assert!(compiled > 0);
            }
            m.finish_session_network_replay(1).unwrap();
            assert_eq!(m.bus_mut().load16(BASE + 0x22002), Ok(1));
            let frame = m.save_session_resume().unwrap();
            evidence(&format!("jit-network-target{target}-q{q}.resume"), &frame);
            if let Some(expected) = &expected {
                assert_eq!(
                    &frame, expected,
                    "target={target} q={q} compiled={compiled}"
                );
            } else {
                expected = Some(frame);
            }
            println!(
                "target={target} quantum={q} compiled_blocks={compiled} position={:?}",
                m.session_position().unwrap()
            );
        }
    }
}
