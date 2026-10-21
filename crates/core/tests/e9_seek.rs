#![cfg(not(feature = "zicsr-stub"))]
use sha2::{Digest, Sha256};
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    csr::{CsrOp, MIE, MSTATUS, MTVEC},
    session_clock::{SessionDelivery, SessionEffect, SessionPhase, SessionPosition},
    session_replay::{ReplayDriver, ReplayPlan, StateWitness},
};

fn simple() -> Machine {
    let mut machine = Machine::new(1 << 20);
    machine.enable_clint(1);
    let code: Vec<_> = (0..32).flat_map(|_| 0x0010_8093u32.to_le_bytes()).collect();
    machine.bus_mut().write_ram_slice(BASE, &code).unwrap();
    machine.hart_mut().regs.pc = BASE;
    machine.start_session_clock(1).unwrap();
    machine
}
fn witness(machine: &mut Machine) -> StateWitness {
    let position = machine.session_position().unwrap();
    let resume_sha256 = Sha256::digest(machine.save_session_resume().unwrap()).into();
    StateWitness {
        position,
        resume_sha256,
    }
}
fn until(machine: &mut Machine, transition: u64) {
    while machine.session_position().unwrap().transition < transition {
        assert_eq!(
            machine.run_session_until(transition, 3),
            Ok(RunOutcome::MaxInstrs)
        );
    }
}
fn delivery(machine: &mut Machine, effect: SessionEffect) -> SessionDelivery {
    let at = machine.session_position().unwrap().transition;
    machine.stage_session_effect(at, effect).unwrap();
    machine.deliver_session_boundary().unwrap();
    machine.take_session_deliveries().unwrap().remove(0)
}
fn replay_to(
    plan: ReplayPlan,
    target: SessionPosition,
    quantum: u64,
) -> (SessionPosition, [u8; 32]) {
    let mut machine = simple();
    let mut driver = ReplayDriver::start(&mut machine, plan).unwrap();
    let mut calls = 0;
    while !driver
        .run_chunk_to(&mut machine, target, quantum, |_, _, _| unreachable!())
        .unwrap()
    {
        calls += 1;
        assert!(calls < 64, "bounded replay must progress");
    }
    let at = machine.session_position().unwrap();
    (
        at,
        Sha256::digest(machine.save_session_resume().unwrap()).into(),
    )
}

#[test]
fn same_boundary_events_and_between_keyframe_targets_match_from_start_in_seeded_seeks() {
    let mut original = simple();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let first = witness(&mut original);
    let mut states = vec![first];
    until(&mut original, 3);
    states.push(witness(&mut original)); // before either same-boundary event
    let a = delivery(
        &mut original,
        SessionEffect::WriteRam {
            address: BASE + 0x800,
            bytes: vec![1],
        },
    );
    states.push(witness(&mut original));
    let b = delivery(
        &mut original,
        SessionEffect::WriteRam {
            address: BASE + 0x800,
            bytes: vec![2],
        },
    );
    states.push(witness(&mut original));
    until(&mut original, 5);
    let keyframe_resume = original.save_session_resume().unwrap();
    let keyframe = witness(&mut original);
    states.push(keyframe);
    until(&mut original, 7);
    states.push(witness(&mut original));
    let c = delivery(&mut original, SessionEffect::ExternalPending(false));
    states.push(witness(&mut original));
    until(&mut original, 10);
    states.push(witness(&mut original));
    let events = vec![a, b, c];
    let full = ReplayPlan {
        begin: first.position,
        end: states.last().unwrap().position,
        initial_resume,
        events: events.clone(),
        witnesses: vec![first, *states.last().unwrap()],
    };
    full.validate().unwrap();
    let suffix = ReplayPlan {
        begin: keyframe.position,
        end: full.end,
        initial_resume: keyframe_resume,
        events: events[2..].to_vec(),
        witnesses: vec![keyframe, *states.last().unwrap()],
    };
    suffix.validate().unwrap();
    let mut seed = 17u32;
    let mut earlier = 0;
    let mut later = 0;
    for _ in 0..100 {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let expected = states[(seed as usize) % states.len()];
        let from_start = replay_to(full.clone(), expected.position, 1);
        assert_eq!(from_start, (expected.position, expected.resume_sha256));
        if expected.position.transition >= keyframe.position.transition {
            let from_keyframe = replay_to(suffix.clone(), expected.position, 7);
            assert_eq!(from_keyframe, from_start);
            later += 1;
        } else {
            earlier += 1;
        }
    }
    assert!(earlier > 0 && later > 0);
    assert_eq!(
        (
            states[1].position.transition,
            states[2].position.transition,
            states[3].position.transition
        ),
        (3, 3, 3)
    );
    assert_eq!(
        (
            states[1].position.sequence,
            states[2].position.sequence,
            states[3].position.sequence
        ),
        (0, 1, 2)
    );
}

fn csr(machine: &mut Machine, address: u16, value: u64) {
    machine
        .hart_mut()
        .csr
        .access(address, CsrOp::Write, value, false, false, 0)
        .unwrap();
}
fn wfi_and_interrupt() -> Machine {
    let mut machine = Machine::new(8 << 20);
    machine.hart_mut().regs.pc = BASE;
    // WFI, then a timer interrupt and a handler instruction. Idle clock advance and interrupt
    // delivery do not retire, but each is a separate reversible transition.
    machine
        .bus_mut()
        .write_ram_slice(
            BASE,
            &[
                0x1050_0073u32.to_le_bytes(),
                0x0000_0073u32.to_le_bytes(),
                0x0000_006fu32.to_le_bytes(),
            ]
            .concat(),
        )
        .unwrap();
    machine
        .bus_mut()
        .store32(BASE + 0x2000, 0x0015_0513)
        .unwrap();
    machine.enable_clint(4).borrow_mut().mtimecmp = 100;
    csr(&mut machine, MTVEC, BASE + 0x2000);
    csr(&mut machine, MIE, 1 << 7);
    csr(&mut machine, MSTATUS, 1 << 3);
    machine.start_session_clock(1).unwrap();
    machine
}

#[test]
fn transition_steps_expose_wfi_and_interrupt_without_inventing_retirements() {
    let mut original = wfi_and_interrupt();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let first = witness(&mut original);
    let mut states = vec![first];
    for transition in 1..=4 {
        until(&mut original, transition);
        states.push(witness(&mut original));
    }
    let plan = ReplayPlan {
        begin: first.position,
        end: states.last().unwrap().position,
        initial_resume,
        events: vec![],
        witnesses: vec![first, *states.last().unwrap()],
    };
    plan.validate().unwrap();
    for target in (0..=4).chain((0..=4).rev()) {
        let mut machine = wfi_and_interrupt();
        let mut driver = ReplayDriver::start(&mut machine, plan.clone()).unwrap();
        while !driver
            .run_chunk_to_transition(&mut machine, target, 1, |_, _, _| unreachable!())
            .unwrap()
        {}
        assert_eq!(
            machine.session_position(),
            Some(states[target as usize].position)
        );
        assert_eq!(
            witness(&mut machine).resume_sha256,
            states[target as usize].resume_sha256
        );
    }
    assert!(
        states
            .windows(2)
            .any(|pair| pair[0].position.retired == pair[1].position.retired)
    );
    assert_eq!(
        states
            .iter()
            .map(|state| state.position.retired)
            .collect::<Vec<_>>(),
        vec![0, 1, 1, 1, 2]
    );
    assert!(
        states
            .iter()
            .all(|state| state.position.phase == SessionPhase::Before)
    );
}

fn trap() -> Machine {
    let mut machine = Machine::new(1 << 20);
    machine.enable_clint(1);
    machine.bus_mut().store32(BASE, 0x0000_0073).unwrap(); // ecall
    machine
        .bus_mut()
        .store32(BASE + 0x2000, 0x0015_0513)
        .unwrap(); // addi x10,x10,1
    machine.hart_mut().regs.pc = BASE;
    csr(&mut machine, MTVEC, BASE + 0x2000);
    machine.start_session_clock(1).unwrap();
    machine
}

#[test]
fn delivered_ecall_trap_has_its_own_reverse_step_boundary() {
    let mut original = trap();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let first = witness(&mut original);
    until(&mut original, 1);
    let after_trap = witness(&mut original);
    assert_eq!(
        (after_trap.position.transition, after_trap.position.retired),
        (1, 0)
    );
    until(&mut original, 2);
    let after_handler = witness(&mut original);
    assert_eq!(
        (
            after_handler.position.transition,
            after_handler.position.retired
        ),
        (2, 1)
    );
    let plan = ReplayPlan {
        begin: first.position,
        end: after_handler.position,
        initial_resume,
        events: vec![],
        witnesses: vec![first, after_handler],
    };
    for expected in [after_handler, after_trap, first, after_trap, after_handler] {
        let mut machine = trap();
        let mut driver = ReplayDriver::start(&mut machine, plan.clone()).unwrap();
        while !driver
            .run_chunk_to_transition(
                &mut machine,
                expected.position.transition,
                1,
                |_, _, _| unreachable!(),
            )
            .unwrap()
        {}
        assert_eq!(machine.session_position(), Some(expected.position));
        assert_eq!(witness(&mut machine).resume_sha256, expected.resume_sha256);
    }
}

#[test]
fn reverse_transition_fence_preserves_deliveries_before_the_reversed_instruction() {
    let mut original = simple();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let initial = witness(&mut original);
    let a = delivery(
        &mut original,
        SessionEffect::WriteRam {
            address: BASE + 0x800,
            bytes: vec![1],
        },
    );
    let b = delivery(
        &mut original,
        SessionEffect::WriteRam {
            address: BASE + 0x801,
            bytes: vec![2],
        },
    );
    let before_instruction = witness(&mut original);
    until(&mut original, 1);
    let after_instruction = witness(&mut original);
    let plan = ReplayPlan {
        begin: initial.position,
        end: after_instruction.position,
        initial_resume,
        events: vec![a, b],
        witnesses: vec![initial, after_instruction],
    };

    // Reverse-step restores a fresh candidate and replays to transition - 1. Deliveries made
    // before the reversed instruction remain part of that instruction boundary's exact state.
    let mut candidate = simple();
    let mut driver = ReplayDriver::start(&mut candidate, plan).unwrap();
    while !driver
        .run_chunk_to_transition(&mut candidate, 0, 1, |_, _, _| unreachable!())
        .unwrap()
    {}

    assert_eq!(
        candidate.session_position(),
        Some(before_instruction.position)
    );
    assert_eq!(
        witness(&mut candidate).resume_sha256,
        before_instruction.resume_sha256
    );
}

#[test]
fn dense_boundary_deliveries_yield_before_transition_step_is_published() {
    let mut original = simple();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let initial = witness(&mut original);
    let mut events = Vec::new();
    for value in 1..=65u8 {
        events.push(delivery(
            &mut original,
            SessionEffect::WriteRam {
                address: BASE + 0x800,
                bytes: vec![value],
            },
        ));
    }
    let before_instruction = witness(&mut original);
    until(&mut original, 1);
    let after_instruction = witness(&mut original);
    let plan = ReplayPlan {
        begin: initial.position,
        end: after_instruction.position,
        initial_resume,
        events,
        witnesses: vec![initial, after_instruction],
    };
    let mut candidate = simple();
    let mut driver = ReplayDriver::start(&mut candidate, plan).unwrap();
    assert!(
        !driver
            .run_chunk_to_transition(&mut candidate, 0, 4096, |_, _, _| unreachable!())
            .unwrap()
    );
    assert_eq!(candidate.session_position().unwrap().sequence, 64);
    assert!(
        driver
            .run_chunk_to_transition(&mut candidate, 0, 4096, |_, _, _| unreachable!())
            .unwrap()
    );
    assert_eq!(
        candidate.session_position(),
        Some(before_instruction.position)
    );
    assert_eq!(
        witness(&mut candidate).resume_sha256,
        before_instruction.resume_sha256
    );
}
