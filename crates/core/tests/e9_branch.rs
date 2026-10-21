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
