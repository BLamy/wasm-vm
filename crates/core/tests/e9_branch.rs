//! Native continuation ownership. Filesystem and browser receipts accompany this primitive proof.
#![cfg(not(feature = "zicsr-stub"))]
use std::cell::Cell;

use sha2::{Digest, Sha256};
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    session_clock::{SessionEffect, SessionPosition},
    session_network::{LinkStatus, NetworkError, NetworkEvent},
    session_replay::{ReplayDriver, ReplayPlan, StateWitness},
};

const DATA: u64 = BASE + 0x8000;
fn machine(replay: bool) -> Machine {
    let mut m = Machine::new(1 << 20);
    // addi x1,x1,1; jal x0,-4: real retired instructions continue on each private RAM image.
    m.bus_mut()
        .write_ram_slice(BASE, &[0x93, 0x80, 0x10, 0x00, 0x6f, 0xf0, 0xdf, 0xff])
        .unwrap();
    m.hart_mut().regs.pc = BASE;
    m.enable_clint(1);
    m.start_session_clock(1).unwrap();
    m.enable_session_devices(None, false, false, replay)
        .unwrap();
    m.enable_session_network(replay).unwrap();
    if !replay {
        m.start_session_sources(m.source_policy(), None).unwrap();
    }
    m
}
fn witness(m: &mut Machine) -> StateWitness {
    StateWitness {
        position: m.session_position().unwrap(),
        resume_sha256: Sha256::digest(m.save_session_resume().unwrap()).into(),
    }
}
fn run(m: &mut Machine, transition: u64) {
    while m.session_position().unwrap().transition < transition {
        assert_eq!(
            m.run_session_until(transition, 7),
            Ok(RunOutcome::MaxInstrs)
        );
    }
}
fn write(m: &mut Machine, value: u8) -> wasm_vm_core::session_clock::SessionDelivery {
    m.stage_session_effect(
        m.session_position().unwrap().transition,
        SessionEffect::WriteRam {
            address: DATA,
            bytes: vec![value],
        },
    )
    .unwrap();
    m.deliver_session_boundary().unwrap();
    m.take_session_deliveries().unwrap().remove(0)
}
fn history() -> (Machine, ReplayPlan) {
    let mut parent = machine(false);
    let initial_resume = parent.save_session_resume().unwrap();
    let first = witness(&mut parent);
    run(&mut parent, 10);
    let event = write(&mut parent, b'P');
    run(&mut parent, 20);
    let last = witness(&mut parent);
    (
        parent,
        ReplayPlan {
            begin: first.position,
            end: last.position,
            initial_resume,
            events: vec![event],
            witnesses: vec![first, last],
        },
    )
}

#[test]
fn unused_ready_gpu_ring_cache_does_not_change_exact_software_replay() {
    use wasm_vm_core::{
        dev::virtio::gpu::NullSink,
        mmio::{MmioDevice, Width},
    };
    let ready = |replay, initialized| {
        let mut m = machine(replay);
        let (slot, _) = m.enable_virtio_gpu(Box::new(NullSink)).unwrap();
        let mut slot = slot.borrow_mut();
        for (offset, value) in [(0x70, 3), (0x24, 1), (0x20, 1), (0x70, 11)] {
            slot.write(offset, Width::B4, value).unwrap();
        }
        for index in 0..if initialized { 2 } else { 0 } {
            let start = BASE + 0x1000 + index * 0x3000;
            for (offset, value) in [
                (0x30, index),
                (0x38, 8),
                (0x80, start),
                (0x90, start + 0x1000),
                (0xa0, start + 0x2000),
                (0x44, 1),
            ] {
                slot.write(offset, Width::B4, value).unwrap();
            }
        }
        slot.write(0x70, Width::B4, 15).unwrap();
        drop(slot);
        m
    };
    for initialized in [false, true] {
        let mut source = ready(false, initialized);
        let initial_resume = source.save_session_resume().unwrap();
        let first = witness(&mut source);
        run(&mut source, 20);
        let last = witness(&mut source);
        let plan = ReplayPlan {
            begin: first.position,
            end: last.position,
            initial_resume,
            events: vec![],
            witnesses: vec![first, last],
        };
        let mut restored = ready(true, initialized);
        let mut driver = ReplayDriver::start(&mut restored, plan).unwrap();
        while !driver
            .run_chunk_to(&mut restored, last.position, 3, |_, _, _| unreachable!())
            .unwrap()
        {}
        assert_eq!(
            restored.save_session_resume().unwrap(),
            source.save_session_resume().unwrap()
        );
        if let Ok(directory) = std::env::var("E9_BRANCH_EVIDENCE") {
            let path =
                std::path::Path::new(&directory).join(format!("software-empty-ring-{initialized}"));
            std::fs::create_dir_all(&path).unwrap();
            std::fs::write(
                path.join("source.resume"),
                source.save_session_resume().unwrap(),
            )
            .unwrap();
            std::fs::write(
                path.join("replayed.resume"),
                restored.save_session_resume().unwrap(),
            )
            .unwrap();
        }
    }
}

#[test]
fn two_fresh_recordings_preserve_parent_future_and_replay_owner() {
    let (mut parent, plan) = history();
    let parent_before = parent.save_session_resume().unwrap();
    let mut selected = machine(true);
    let mut driver = ReplayDriver::start(&mut selected, plan.clone()).unwrap();
    let at = SessionPosition {
        transition: 5,
        retired: 5,
        ..Default::default()
    };
    while !driver
        .run_chunk_to(&mut selected, at, 2, |_, _, _| unreachable!())
        .unwrap()
    {}
    let selected_before = selected.save_session_resume().unwrap();
    let branch = selected.capture_recording_branch(None).unwrap();
    assert_eq!(selected.save_session_resume().unwrap(), selected_before);
    let mut children = Vec::new();
    for letter in [b'A', b'B'] {
        let mut child = machine(false);
        let old_lease = child.lease_session_network(None).unwrap();
        child.restore_recording_branch(&branch, None).unwrap();
        assert_eq!(child.session_position(), Some(at));
        assert_eq!(child.session_branch_offline(), Ok(true));
        let opens = Cell::new(0);
        assert!(matches!(
            child.open_session_network_provider(|| opens.set(opens.get() + 1)),
            Err(NetworkError::BranchOffline)
        ));
        assert_eq!(opens.get(), 0);
        assert_eq!(
            child.complete_session_network(
                &old_lease,
                NetworkEvent::Link {
                    status: LinkStatus::Open,
                    code: 0
                }
            ),
            Err(NetworkError::BranchOffline)
        );
        assert_eq!(
            child.go_live_session_branch(),
            Err(NetworkError::BranchOffline)
        );
        write(&mut child, letter);
        run(&mut child, 24);
        assert_eq!(child.bus_mut().load8(DATA).unwrap(), letter);
        assert!(child.hart().regs.read(1) > 5);
        // Ordinary guest-state restore cannot reopen a continuation's host policy.
        let saved = child.save_session_resume().unwrap();
        child.load_session_resume(&saved).unwrap();
        assert_eq!(child.session_branch_offline(), Ok(true));
        assert!(child.restore_recording_branch(&branch, None).is_err());
        children.push(child);
    }
    assert_eq!(children[0].bus_mut().load8(DATA).unwrap(), b'A');
    assert_eq!(children[1].bus_mut().load8(DATA).unwrap(), b'B');
    assert_eq!(parent.bus_mut().load8(DATA).unwrap(), b'P');
    assert_eq!(parent.save_session_resume().unwrap(), parent_before);
    assert_eq!(selected.save_session_resume().unwrap(), selected_before);
    assert!(
        selected
            .stage_session_effect(5, SessionEffect::ExternalPending(false))
            .is_err()
    );
    while !driver
        .run_chunk_to(&mut selected, plan.end, 3, |_, _, _| unreachable!())
        .unwrap()
    {}
    assert_eq!(selected.bus_mut().load8(DATA).unwrap(), b'P');
    assert_eq!(selected.save_session_resume().unwrap(), parent_before);
}

#[test]
fn capture_refuses_recording_and_restore_refuses_replay_without_opening_ingress() {
    let mut recording = machine(false);
    let before = recording.save_session_resume().unwrap();
    assert!(recording.capture_recording_branch(None).is_err());
    assert_eq!(recording.save_session_resume().unwrap(), before);
    let mut replay = machine(true);
    assert!(replay.restore_recording_branch(&before, None).is_err());
    assert!(matches!(
        replay.lease_session_network(None),
        Err(NetworkError::ReplayIngress)
    ));
}

#[test]
fn even_a_transition_zero_branch_cannot_reuse_its_recording_owner() {
    let (_, plan) = history();
    let mut selected = machine(true);
    let _driver = ReplayDriver::start(&mut selected, plan).unwrap();
    assert!(selected.can_capture_recording_branch());
    let image = selected.capture_recording_branch(None).unwrap();
    let mut child = machine(false);
    child.restore_recording_branch(&image, None).unwrap();
    assert_eq!(child.session_position(), Some(Default::default()));
    let before = child.save_session_resume().unwrap();
    assert!(child.restore_recording_branch(&image, None).is_err());
    assert_eq!(child.save_session_resume().unwrap(), before);
    assert_eq!(child.session_branch_offline(), Ok(true));
}

#[test]
fn offline_branch_end_keeps_buffered_past_network_and_legacy_exhaustion_stays_strict() {
    let mut source = machine(false);
    let initial_resume = source.save_session_resume().unwrap();
    let first = witness(&mut source);
    let lease = source.lease_session_network(None).unwrap();
    source
        .complete_session_network(&lease, NetworkEvent::Receive(vec![0x37; 32]))
        .unwrap();
    let events = source.take_session_deliveries().unwrap();
    run(&mut source, 4);
    let last = witness(&mut source);
    let final_bytes = source.save_session_resume().unwrap();
    let plan = ReplayPlan {
        begin: first.position,
        end: last.position,
        initial_resume,
        events,
        witnesses: vec![first, last],
    };
    for offline in [false, true] {
        let mut replay = machine(true);
        let mut driver = ReplayDriver::start(&mut replay, plan.clone()).unwrap();
        if offline {
            replay.mark_offline_branch_replay().unwrap();
        }
        let result = driver.run_to_end(&mut replay, 2, |_, _, _| unreachable!());
        if offline {
            result.unwrap();
            assert_eq!(replay.save_session_resume().unwrap(), final_bytes);
            assert_eq!(
                replay.lease_session_network(None).err(),
                Some(NetworkError::ReplayIngress)
            );
        } else {
            assert!(
                result.is_err(),
                "ordinary prefix must still exhaust network buffers"
            );
        }
    }
}
