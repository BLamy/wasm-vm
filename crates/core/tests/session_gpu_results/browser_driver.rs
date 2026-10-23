//! C's real tape driver; these native tests do not claim a physical browser run.
use super::*;
use wasm_vm_core::session_replay::{
    GpuReplayConfig, ReplayDriver, ReplayPlan, ReplayReason, ReplayStatus, StateWitness,
};
const RENDERER: [u8; 32] = [17; 32];
fn fresh(length: usize) -> Rig {
    let mut machine = Machine::new(length + 1024 * 1024);
    machine.enable_plic();
    machine.enable_clint(64);
    machine.enable_virtio_slots(None);
    machine.enable_virtio_gpu(Box::new(NullSink)).unwrap();
    let host = Rc::new(RefCell::new(Host::default()));
    let mail = Submit3dMailbox::new();
    machine
        .attach_qualified_virgl(
            Box::new(Controls(host.clone())),
            Box::new(Jobs(host.clone())),
            mail.clone(),
            caps(),
        )
        .unwrap();
    let gpu = machine.virtio_gpu().unwrap().1;
    machine.start_session_clock(1).unwrap();
    Rig {
        machine,
        gpu,
        host,
        mail,
        trace: VecSink::new(),
        length,
        disk: None,
    }
}
fn state(rig: &mut Rig) -> StateWitness {
    StateWitness {
        position: rig.pos(),
        resume_sha256: rig.machine.gpu_session_state_digest().unwrap(),
    }
}
fn branch_evidence(rig: &mut Rig, name: &str) {
    let Ok(root) = std::env::var("E9_BRANCH_EVIDENCE") else {
        return;
    };
    let thread = std::thread::current();
    let case = thread.name().unwrap_or("branch").replace("::", "-");
    let directory = std::path::Path::new(&root).join(case);
    std::fs::create_dir_all(&directory).unwrap();
    let witness = state(rig);
    let logical = rig.machine.gpu_session_state_witness_bytes().unwrap();
    let ram = rig.machine.bus_mut().ram().as_bytes().to_vec();
    let trace = rig.trace.canonical();
    std::fs::write(directory.join(format!("{name}.logical-state")), &logical).unwrap();
    std::fs::write(directory.join(format!("{name}.ram")), &ram).unwrap();
    std::fs::write(directory.join(format!("{name}.trace")), &trace).unwrap();
    let report = format!(
        "{{\"boundary\":\"native GPU architecture; synthetic physical sink, no browser-pixel claim\",\"transition\":\"{}\",\"retired\":\"{}\",\"sequence\":\"{}\",\"phase\":\"before\",\"ordinal\":{},\"stateSha256\":\"{}\",\"ramSha256\":\"{}\",\"logicalSha256\":\"{}\",\"traceSha256\":\"{}\",\"traceLines\":{}}}\n",
        witness.position.transition,
        witness.position.retired,
        witness.position.sequence,
        witness.position.ordinal,
        hex(&witness.resume_sha256),
        hex(&Sha256::digest(&ram)),
        hex(&Sha256::digest(&logical)),
        hex(&Sha256::digest(trace.as_bytes())),
        trace.lines().count()
    );
    std::fs::write(directory.join(format!("{name}.json")), report).unwrap();
}
struct History {
    plan: ReplayPlan,
    payloads: Vec<Payload>,
    mid: Vec<u8>,
    nonram: Vec<u8>,
    ram_digest: [u8; 32],
    mid_position: SessionPosition,
    final_bytes: Vec<u8>,
    branch_point: Option<StateWitness>,
    original_trace: String,
}
fn history() -> History {
    history_with_unused_cursor(false)
}
fn history_with_unused_cursor(unused_cursor: bool) -> History {
    history_with_branch(unused_cursor, false)
}
fn history_with_branch(unused_cursor: bool, branch: bool) -> History {
    history_with_extra(unused_cursor, branch, 0, 0).0
}
fn history_with_extra(
    unused_cursor: bool,
    branch: bool,
    extra_count: usize,
    extra_bytes: usize,
) -> (History, Option<StateWitness>) {
    let mut rig = Rig::with_owned_devices(64, None, false, 0, None, branch);
    let begin = state(&mut rig);
    let initial = rig.machine.save_gpu_result_resume(&RENDERER).unwrap();
    rig.pending();
    if unused_cursor {
        // Configure a ready but never notified cursor ring. Resume re-arms its
        // host wake hint and may materialize the initial ring cache on dispatch.
        let base = virt::VIRTIO_BASE + 7 * virt::VIRTIO_STRIDE;
        for (offset, value) in [
            (0x30, 1),
            (0x38, 16),
            (0x80, (virt::DRAM_BASE + 0x30000) as u32),
            (0x84, 0),
            (0x90, (virt::DRAM_BASE + 0x31000) as u32),
            (0x94, 0),
            (0xa0, (virt::DRAM_BASE + 0x32000) as u32),
            (0xa4, 0),
            (0x44, 1),
            (0x30, 0),
        ] {
            rig.machine.bus_mut().store32(base + offset, value).unwrap();
        }
    }
    rig.until(rig.pos().transition + 7, 3);
    let exchange = rig.exchange(1);
    assert_eq!(
        rig.machine.submit3d_gather(&exchange).unwrap(),
        vec![0x6d; 64]
    );
    let final_bytes = (0..64).map(|n| (n * 17 + 3) as u8).collect::<Vec<_>>();
    rig.until(rig.pos().transition + 5, 2);
    let exchange = rig.exchange(2);
    rig.machine
        .submit3d_scatter(&exchange, &final_bytes)
        .unwrap();
    let before_physical = state(&mut rig);
    rig.post(rig.completion(Ok(()), 2)).unwrap();
    assert_eq!(
        state(&mut rig),
        before_physical,
        "physical readiness cannot change guest witness"
    );
    let batch = rig.machine.take_session_gpu_recording().unwrap();
    assert_eq!(
        state(&mut rig),
        before_physical,
        "recorder drain is not architectural state"
    );
    let mid = rig.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let nonram = rig
        .machine
        .save_gpu_result_state_without_ram(&RENDERER)
        .unwrap();
    assert!(nonram.len() < mid.len());
    let mid_position = rig.pos();
    let ram_digest = rig.machine.snapshot().mem_digest;
    rig.done();
    rig.check(&final_bytes, 0x1100);
    let mut events = batch.events;
    let mut stream_mid = None;
    for index in 0..extra_count {
        let transition = rig.pos().transition;
        let mut bytes = vec![index as u8; extra_bytes];
        if extra_bytes >= 8 {
            bytes[..8].copy_from_slice(&(index as u64).to_le_bytes());
        }
        rig.machine
            .stage_session_effect(transition, SessionEffect::HostInput { channel: 1, bytes })
            .unwrap();
        rig.machine
            .deliver_session_host_boundary(|_, channel, bytes| {
                assert_eq!(channel, 1);
                [0, bytes.len() as u64, 0, 0]
            })
            .unwrap();
        if (index + 1) % 8 == 0 {
            let drained = rig.machine.take_session_gpu_recording().unwrap();
            assert!(drained.payloads.is_empty());
            events.extend(drained.events);
        }
        if index + 1 == extra_count / 2 {
            stream_mid = Some(state(&mut rig));
        }
        if index + 1 < extra_count {
            rig.until(transition + 1, 1);
        }
    }
    let branch_point = branch.then(|| state(&mut rig));
    if let Some(point) = branch_point {
        rig.until(point.position.transition + 5, 3);
        rig.machine
            .stage_session_effect(
                rig.pos().transition,
                SessionEffect::WriteRam {
                    address: WITNESS + 192,
                    bytes: vec![b'P'],
                },
            )
            .unwrap();
        rig.machine.deliver_session_boundary().unwrap();
        rig.until(point.position.transition + 15, 3);
    }
    let end = state(&mut rig);
    if branch {
        branch_evidence(&mut rig, "parent-recorded");
    }
    events.extend(rig.machine.take_session_gpu_recording().unwrap().events);
    let mut witnesses = vec![begin, before_physical];
    if let Some(point) = stream_mid {
        witnesses.push(point);
    }
    if let Some(point) = branch_point {
        witnesses.push(point);
    }
    witnesses.push(end);
    (
        History {
            plan: ReplayPlan {
                begin: begin.position,
                end: end.position,
                initial_resume: initial,
                events,
                witnesses,
            },
            payloads: batch.payloads,
            mid,
            nonram,
            ram_digest,
            mid_position,
            final_bytes,
            branch_point,
            original_trace: rig.trace.canonical(),
        },
        stream_mid,
    )
}
fn config(payloads: Vec<Payload>) -> GpuReplayConfig {
    GpuReplayConfig {
        renderer_digest: RENDERER,
        ram_digest: None,
        payloads,
    }
}

fn config_for(events: &[SessionDelivery], payloads: &[Payload]) -> GpuReplayConfig {
    let required: Vec<_> = events
        .iter()
        .filter_map(|event| match &event.effect {
            SessionEffect::HostInput {
                channel: session_gpu::CHANNEL,
                bytes,
            } => match GpuResult::decode(bytes).unwrap().kind {
                ResultKind::Scatter { payload, .. } => Some(payload),
                _ => None,
            },
            _ => None,
        })
        .collect();
    config(
        payloads
            .iter()
            .filter(|payload| required.contains(&payload.reference))
            .cloned()
            .collect(),
    )
}

#[test]
fn session_replay_streamed_initial_to_end_gpu_pending_fence() {
    let history = history();
    let first_witness = history.plan.witnesses[0];
    let mid_witness = history.plan.witnesses[1];
    let final_witness = *history.plan.witnesses.last().unwrap();
    let split = history
        .plan
        .events
        .partition_point(|event| event.position.sequence <= mid_witness.position.sequence);
    let first = ReplayPlan {
        begin: first_witness.position,
        end: mid_witness.position,
        initial_resume: history.plan.initial_resume.clone(),
        events: history.plan.events[..split].to_vec(),
        witnesses: vec![first_witness, mid_witness],
    };
    let second = ReplayPlan {
        begin: mid_witness.position,
        end: final_witness.position,
        initial_resume: vec![],
        events: history.plan.events[split..].to_vec(),
        witnesses: vec![mid_witness, final_witness],
    };
    first.validate().unwrap();
    second.validate_continuation().unwrap();
    let mut rig = fresh(64);
    let mut driver = ReplayDriver::start_gpu(
        &mut rig.machine,
        first.clone(),
        config_for(&first.events, &history.payloads),
    )
    .unwrap();
    let mut exchange = 1;
    drive_to_with_exchange(&mut rig, &mut driver, first.end, 0, Ok(()), &mut exchange).unwrap();
    let frontier = driver.frontier(&mut rig.machine).unwrap();
    assert_eq!(frontier.position, mid_witness.position);
    assert_eq!(frontier.state_sha256, mid_witness.resume_sha256);
    assert_eq!(frontier.renderer_digest, Some(RENDERER));
    assert!(frontier.gpu_cursor.is_some());
    driver
        .continue_gpu_window(
            &mut rig.machine,
            frontier,
            second.clone(),
            config_for(&second.events, &history.payloads),
        )
        .unwrap();
    drive_to_with_exchange(&mut rig, &mut driver, second.end, 0, Ok(()), &mut exchange).unwrap();
    assert_eq!(driver.status(), ReplayStatus::Completed);
    assert_eq!(driver.event_cursor(), history.plan.events.len());
    assert_eq!(state(&mut rig), final_witness);
    rig.check(&history.final_bytes, 0x1100);
}

#[test]
fn session_replay_streamed_gpu_rejects_stale_cursor_and_renderer_before_work() {
    let history = history();
    let middle = history.plan.witnesses[1];
    let split = history
        .plan
        .events
        .partition_point(|event| event.position.sequence <= middle.position.sequence);
    let first = ReplayPlan {
        begin: history.plan.begin,
        end: middle.position,
        initial_resume: history.plan.initial_resume.clone(),
        events: history.plan.events[..split].to_vec(),
        witnesses: history.plan.witnesses[..=1].to_vec(),
    };
    let second = ReplayPlan {
        begin: middle.position,
        end: history.plan.end,
        initial_resume: vec![],
        events: history.plan.events[split..].to_vec(),
        witnesses: history.plan.witnesses[1..].to_vec(),
    };
    for wrong_cursor in [true, false] {
        let mut rig = fresh(64);
        let mut driver = ReplayDriver::start_gpu(
            &mut rig.machine,
            first.clone(),
            config_for(&first.events, &history.payloads),
        )
        .unwrap();
        drive_to(&mut rig, &mut driver, first.end, 0, Ok(())).unwrap();
        let mut frontier = driver.frontier(&mut rig.machine).unwrap();
        let before = rig.machine.gpu_session_state_witness_bytes().unwrap();
        let mut next = config_for(&second.events, &history.payloads);
        if wrong_cursor {
            frontier.gpu_cursor = frontier.gpu_cursor.map(|cursor| cursor + 1);
        } else {
            next.renderer_digest = [99; 32];
        }
        let error = driver
            .continue_gpu_window(&mut rig.machine, frontier, second.clone(), next)
            .unwrap_err();
        assert_eq!(error.reason, ReplayReason::InvalidPlan);
        assert_eq!(driver.status(), ReplayStatus::Diverged);
        assert_eq!(
            rig.machine.gpu_session_state_witness_bytes().unwrap(),
            before
        );
    }
}

fn replay_long_gpu_history(extra_count: usize, extra_bytes: usize) {
    let (history, middle) = history_with_extra(false, false, extra_count, extra_bytes);
    let middle = middle.unwrap();
    assert!(
        history.plan.events.len() > wasm_vm_core::session_replay::MAX_REPLAY_EVENTS
            || extra_count * extra_bytes > wasm_vm_core::session_replay::MAX_REPLAY_BYTES
    );
    let split = history
        .plan
        .events
        .partition_point(|event| event.position.sequence <= middle.position.sequence);
    let first = ReplayPlan {
        begin: history.plan.begin,
        end: middle.position,
        initial_resume: history.plan.initial_resume.clone(),
        events: history.plan.events[..split].to_vec(),
        witnesses: history
            .plan
            .witnesses
            .iter()
            .copied()
            .filter(|witness| witness.position.sequence <= middle.position.sequence)
            .collect(),
    };
    let second = ReplayPlan {
        begin: middle.position,
        end: history.plan.end,
        initial_resume: vec![],
        events: history.plan.events[split..].to_vec(),
        witnesses: history
            .plan
            .witnesses
            .iter()
            .copied()
            .filter(|witness| witness.position.sequence >= middle.position.sequence)
            .collect(),
    };
    first.validate().unwrap();
    second.validate_continuation().unwrap();
    assert!(first.events.len() <= wasm_vm_core::session_replay::MAX_REPLAY_EVENTS);
    assert!(second.events.len() <= wasm_vm_core::session_replay::MAX_REPLAY_EVENTS);
    let mut rig = fresh(64);
    let mut driver = ReplayDriver::start_gpu(
        &mut rig.machine,
        first.clone(),
        config_for(&first.events, &history.payloads),
    )
    .unwrap();
    let mut exchange = 1;
    drive_to_with_exchange(&mut rig, &mut driver, first.end, 0, Ok(()), &mut exchange).unwrap();
    let frontier = driver.frontier(&mut rig.machine).unwrap();
    assert_eq!(frontier.state_sha256, middle.resume_sha256);
    assert_eq!(frontier.event_cursor, first.events.len());
    driver
        .continue_gpu_window(
            &mut rig.machine,
            frontier,
            second.clone(),
            config_for(&second.events, &history.payloads),
        )
        .unwrap();
    drive_to_with_exchange(&mut rig, &mut driver, second.end, 0, Ok(()), &mut exchange).unwrap();
    assert_eq!(driver.status(), ReplayStatus::Completed);
    assert_eq!(driver.event_cursor(), history.plan.events.len());
    assert_eq!(state(&mut rig), *history.plan.witnesses.last().unwrap());
    rig.check(&history.final_bytes, 0x1100);
    if let Ok(root) = std::env::var("E9_STREAMED_EVIDENCE") {
        let case = if extra_count > wasm_vm_core::session_replay::MAX_REPLAY_EVENTS {
            "gpu-event-count"
        } else {
            "gpu-body-bytes"
        };
        let directory = std::path::Path::new(&root).join(case);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join("original.guest-trace"),
            &history.original_trace,
        )
        .unwrap();
        std::fs::write(
            directory.join("final.logical-state"),
            rig.machine.gpu_session_state_witness_bytes().unwrap(),
        )
        .unwrap();
        std::fs::write(
            directory.join("final.ram"),
            rig.machine.bus_mut().ram().as_bytes(),
        )
        .unwrap();
        std::fs::write(
            directory.join("frontiers.json"),
            format!(
                "{{\"middle\":{{\"transition\":\"{}\",\"sequence\":\"{}\",\"stateSha256\":\"{}\",\"eventCursor\":{}}},\"final\":{{\"transition\":\"{}\",\"sequence\":\"{}\",\"stateSha256\":\"{}\",\"eventCursor\":{}}}}}\n",
                frontier.position.transition,
                frontier.position.sequence,
                hex(&frontier.state_sha256),
                frontier.event_cursor,
                history.plan.end.transition,
                history.plan.end.sequence,
                hex(&history.plan.witnesses.last().unwrap().resume_sha256),
                driver.event_cursor(),
            ),
        )
        .unwrap();
    }
}

#[test]
fn session_replay_streamed_initial_to_end_gpu_event_count() {
    replay_long_gpu_history(wasm_vm_core::session_replay::MAX_REPLAY_EVENTS + 263, 1);
}

#[test]
fn session_replay_streamed_initial_to_end_gpu_body_bytes() {
    replay_long_gpu_history(260, 262_144);
}
fn branch_rig(record: bool) -> Rig {
    let mut machine = Machine::new(64 + 1024 * 1024);
    machine.enable_plic();
    machine.enable_clint(64);
    machine.start_session_clock(1).unwrap();
    machine
        .enable_session_devices(None, false, false, !record)
        .unwrap();
    machine.enable_session_network(!record).unwrap();
    machine.enable_virtio_gpu(Box::new(NullSink)).unwrap();
    let host = Rc::new(RefCell::new(Host::default()));
    let mail = Submit3dMailbox::new();
    machine
        .attach_qualified_virgl(
            Box::new(Controls(host.clone())),
            Box::new(Jobs(host.clone())),
            mail.clone(),
            caps(),
        )
        .unwrap();
    let gpu = machine.virtio_gpu().unwrap().1;
    if record {
        machine
            .start_session_sources(machine.source_policy(), None)
            .unwrap();
        machine.enable_session_gpu_results(false).unwrap();
    }
    Rig {
        machine,
        gpu,
        host,
        mail,
        trace: VecSink::new(),
        length: 64,
        disk: None,
    }
}

#[test]
fn isolated_gpu_branches_drop_past_transport_and_bodies_without_changing_parent_future() {
    let history = history_with_branch(false, true);
    let at = history.branch_point.unwrap();
    let mut source = branch_rig(false);
    let mut driver = ReplayDriver::start_gpu(
        &mut source.machine,
        history.plan.clone(),
        config(history.payloads.clone()),
    )
    .unwrap();
    drive_to(&mut source, &mut driver, at.position, 19, Ok(())).unwrap();
    source.check(&history.final_bytes, 0x1100);
    assert!(source.machine.can_capture_recording_branch());
    let before = source.machine.gpu_session_state_witness_bytes().unwrap();
    assert_eq!(state(&mut source), at);
    branch_evidence(&mut source, "selected-before-capture");
    assert!(source.machine.capture_recording_branch(None).is_err());
    let captured = source
        .machine
        .capture_recording_branch(Some(&RENDERER))
        .unwrap();
    assert_eq!(
        source.machine.gpu_session_state_witness_bytes().unwrap(),
        before
    );
    assert_eq!(state(&mut source), at);
    branch_evidence(&mut source, "selected-after-capture");
    let mut children = Vec::new();
    for letter in [b'A', b'B'] {
        let mut child = branch_rig(true);
        let empty = child.machine.save_gpu_result_resume(&RENDERER).unwrap();
        assert!(
            child
                .machine
                .restore_recording_branch(&captured, Some(&[99; 32]))
                .is_err()
        );
        assert_eq!(
            child.machine.save_gpu_result_resume(&RENDERER).unwrap(),
            empty
        );
        child
            .machine
            .restore_recording_branch(&captured, Some(&RENDERER))
            .unwrap();
        assert_eq!(child.machine.session_position(), Some(at.position));
        assert_eq!(child.machine.session_branch_offline(), Ok(true));
        child.check(&history.final_bytes, 0x1100);
        let drained = child.machine.take_session_gpu_recording().unwrap();
        assert!(drained.events.is_empty() && drained.payloads.is_empty());
        let initial = child.machine.save_gpu_result_resume(&RENDERER).unwrap();
        let first = state(&mut child);
        child
            .machine
            .stage_session_effect(
                at.position.transition,
                SessionEffect::WriteRam {
                    address: WITNESS + 192,
                    bytes: vec![letter],
                },
            )
            .unwrap();
        child.machine.deliver_session_boundary().unwrap();
        child.until(at.position.transition + 20, 3);
        let last = state(&mut child);
        branch_evidence(
            &mut child,
            if letter == b'A' { "child-a" } else { "child-b" },
        );
        let events = child.machine.take_session_gpu_recording().unwrap();
        assert!(events.payloads.is_empty());
        children.push((
            letter,
            ReplayPlan {
                begin: first.position,
                end: last.position,
                initial_resume: initial,
                events: events.events,
                witnesses: vec![first, last],
            },
        ));
    }
    assert_eq!(
        source.machine.gpu_session_state_witness_bytes().unwrap(),
        before
    );
    // Only a RAM effect remains, so completing the original future needs no host callback.
    while !driver
        .run_chunk_to(
            &mut source.machine,
            history.plan.end,
            3,
            |_, _, _| unreachable!(),
        )
        .unwrap()
    {}
    assert_eq!(source.machine.bus_mut().load8(WITNESS + 192).unwrap(), b'P');
    for (letter, plan) in children.into_iter().rev() {
        let mut replay = branch_rig(false);
        let mut child_driver =
            ReplayDriver::start_gpu(&mut replay.machine, plan.clone(), config(vec![])).unwrap();
        replay.machine.mark_offline_branch_replay().unwrap();
        while !child_driver
            .run_chunk_to(&mut replay.machine, plan.end, 3, |_, _, _| unreachable!())
            .unwrap()
        {}
        assert_eq!(
            replay.machine.bus_mut().load8(WITNESS + 192).unwrap(),
            letter
        );
        replay.check(&history.final_bytes, 0x1100);
    }
}

#[test]
fn a_pending_gpu_command_refuses_branching_without_mutating_the_selected_replay() {
    let history = history_with_branch(false, true);
    let mut selected = branch_rig(false);
    let mut driver = ReplayDriver::start_gpu(
        &mut selected.machine,
        history.plan.clone(),
        config(history.payloads.clone()),
    )
    .unwrap();
    drive_to(&mut selected, &mut driver, history.mid_position, 0, Ok(())).unwrap();
    let before = selected.machine.gpu_session_state_witness_bytes().unwrap();
    let before_witness = state(&mut selected);
    branch_evidence(&mut selected, "pending-before-refusal");
    assert!(!selected.machine.can_capture_recording_branch());
    assert!(
        selected
            .machine
            .capture_recording_branch(Some(&RENDERER))
            .is_err()
    );
    assert_eq!(
        selected.machine.gpu_session_state_witness_bytes().unwrap(),
        before
    );
    assert_eq!(state(&mut selected), before_witness);
    branch_evidence(&mut selected, "pending-after-refusal");
}
fn drive(
    rig: &mut Rig,
    driver: &mut ReplayDriver,
    delay: usize,
    outcome: Result<(), E>,
) -> Result<(), wasm_vm_core::session_replay::ReplayDivergence> {
    drive_to(rig, driver, driver.end(), delay, outcome)
}
fn drive_to(
    rig: &mut Rig,
    driver: &mut ReplayDriver,
    target: SessionPosition,
    delay: usize,
    outcome: Result<(), E>,
) -> Result<(), wasm_vm_core::session_replay::ReplayDivergence> {
    let mut exchange = 1;
    drive_to_with_exchange(rig, driver, target, delay, outcome, &mut exchange)
}
fn drive_to_with_exchange(
    rig: &mut Rig,
    driver: &mut ReplayDriver,
    target: SessionPosition,
    delay: usize,
    outcome: Result<(), E>,
    exchange: &mut u64,
) -> Result<(), wasm_vm_core::session_replay::ReplayDivergence> {
    for turn in 0..4000 {
        let reached = driver.run_chunk_to(&mut rig.machine, target, 3, |_, channel, bytes| {
            assert_eq!(channel, 1, "no live input or provider callback");
            [0, bytes.len() as u64, 0, 0]
        })?;
        if reached {
            return Ok(());
        }
        if turn < delay || rig.host.borrow().jobs.is_empty() {
            continue;
        }
        if *exchange <= 2 {
            let e = rig.exchange(*exchange);
            rig.host
                .borrow()
                .leases
                .last()
                .unwrap()
                .authorize_transport()
                .unwrap();
            let output = [0xa7; 64];
            match rig.machine.replay_session_gpu_transport(
                &e,
                (*exchange == 2).then_some(output.as_slice()),
                None,
            ) {
                Ok(bytes) => {
                    if *exchange == 1 {
                        assert_eq!(bytes, vec![0x6d; 64]);
                    } else {
                        assert!(bytes.is_empty());
                    }
                    *exchange += 1;
                }
                Err(GpuError::PhysicalPending) => {}
                error => panic!("physical receipt: {error:?}"),
            }
        }
        if *exchange == 3 {
            rig.post(rig.completion(outcome, 2)).unwrap();
            *exchange = 4;
        }
    }
    panic!("bounded driver failed to settle")
}
#[test]
fn record_origin_replays_with_authentic_gpu_callbacks_and_a_pending_keyframe() {
    let history = history();
    for delay in [0, 19, 91] {
        let mut rig = fresh(64);
        let mut driver = ReplayDriver::start_gpu(
            &mut rig.machine,
            history.plan.clone(),
            config(history.payloads.clone()),
        )
        .unwrap();
        drive(&mut rig, &mut driver, delay, Ok(())).unwrap();
        assert_eq!(driver.status(), ReplayStatus::Completed);
        rig.check(&history.final_bytes, 0x1100);
        assert_eq!(
            rig.machine.gpu_session_state_digest().unwrap(),
            history.plan.witnesses.last().unwrap().resume_sha256
        );
        assert_eq!(
            rig.machine.submit3d_gather(&rig.exchange(3)),
            Err(E::BridgePoisoned)
        );
    }
    // The recorded keyframe retains the real accepted owner and settled physical work.
    // Restoring it never reissues a guest command or waits for a nonexistent host job.
    let mut plan = history.plan.clone();
    plan.initial_resume = history.mid.clone();
    plan.begin = history.mid_position;
    plan.events
        .retain(|e| e.position.sequence > plan.begin.sequence);
    plan.witnesses.remove(0);
    let mut rig = fresh(64);
    let mut driver = ReplayDriver::start_gpu(&mut rig.machine, plan, config(vec![])).unwrap();
    drive(&mut rig, &mut driver, 0, Ok(())).unwrap();
    assert!(rig.host.borrow().jobs.is_empty());
    rig.check(&history.final_bytes, 0x1100);
}
#[test]
fn missing_or_corrupt_owned_body_refuses_before_restore_and_physical_failure_cannot_substitute_success()
 {
    let history = history();
    for changed in [false, true] {
        let mut rig = fresh(64);
        let before = rig.machine.snapshot();
        let mut payloads = history.payloads.clone();
        if changed {
            payloads[0].bytes[0] ^= 1;
        } else {
            payloads.remove(0);
        }
        assert_eq!(
            ReplayDriver::start_gpu(&mut rig.machine, history.plan.clone(), config(payloads))
                .err()
                .unwrap()
                .reason,
            ReplayReason::InvalidPlan
        );
        assert_eq!(rig.machine.snapshot(), before);
        assert!(!rig.machine.session_sources_active());
    }
    let mut rig = fresh(64);
    let mut driver = ReplayDriver::start_gpu(
        &mut rig.machine,
        history.plan.clone(),
        config(history.payloads),
    )
    .unwrap();
    let error = drive(&mut rig, &mut driver, 0, Err(E::OutOfMemory)).unwrap_err();
    assert_eq!(error.reason, ReplayReason::Adapter);
    assert_eq!(driver.status(), ReplayStatus::Diverged);
    assert_eq!(error.position, history.plan.events.last().unwrap().position);
    assert_eq!(
        rig.machine.bus_mut().load16(USED + 2).unwrap(),
        4,
        "failure retains the genuine pending fence"
    );
}
#[test]
fn recorded_begin_rejection_accepts_settled_physical_outcomes_but_not_uncertain_work() {
    let mut original = Rig::new(64, None, false);
    let begin = state(&mut original);
    let initial_resume = original.machine.save_gpu_result_resume(&RENDERER).unwrap();
    original.host.borrow_mut().fail = Some(E::InvalidParameter);
    original.pending();
    original.done();
    original.check(&[0x6d; 64], 0x1205);
    let end = state(&mut original);
    let batch = original.machine.take_session_gpu_recording().unwrap();
    assert!(batch.payloads.is_empty());
    let plan = ReplayPlan {
        begin: begin.position,
        end: end.position,
        initial_resume,
        events: batch.events,
        witnesses: vec![begin, end],
    };
    original.dump_state("browser-begin-rejection", "original");
    for physical in 0..3 {
        let mut replay = fresh(64);
        // Rejecting a second cancellation exposes any attempt to cancel an
        // already completed physical job, including a rejected begin callback.
        replay.host.borrow_mut().cancel_fail = true;
        if physical == 0 {
            replay.host.borrow_mut().fail = Some(E::InvalidParameter);
        }
        let mut driver =
            ReplayDriver::start_gpu(&mut replay.machine, plan.clone(), config(vec![])).unwrap();
        let mut posted = physical == 0;
        let mut finished = false;
        for _ in 0..1000 {
            let before = replay.machine.snapshot();
            match driver.run_chunk_to(&mut replay.machine, plan.end, 1, |_, _, _| {
                panic!("no live input")
            }) {
                Ok(true) => {
                    assert!(
                        physical < 2,
                        "uncertain physical work bypassed cancellation"
                    );
                    replay.check(&[0x6d; 64], 0x1205);
                    assert_eq!(state(&mut replay), plan.witnesses[1]);
                    replay.dump_state("browser-begin-rejection", &format!("settled-{physical}"));
                    finished = true;
                    break;
                }
                Err(error) => {
                    assert_eq!(physical, 2);
                    assert_eq!(error.reason, ReplayReason::Adapter);
                    assert_eq!(replay.machine.snapshot(), before);
                    assert_eq!(replay.machine.bus_mut().load16(USED + 2).unwrap(), 4);
                    finished = true;
                    break;
                }
                Ok(false) => {}
            }
            if !posted && !replay.host.borrow().jobs.is_empty() {
                let mut completion = replay.completion(Ok(()), 0);
                if physical == 2 {
                    completion.outcome = Err(E::BridgePoisoned);
                    completion.gpu_complete = false;
                }
                replay.post(completion).unwrap();
                posted = true;
            }
        }
        assert!(finished, "bounded error replay did not terminate");
        assert!(replay.host.borrow().cancelled.is_empty());
    }
}
#[test]
fn logical_witness_binds_cpu_ram_and_pending_gpu_authority() {
    let mut rig = Rig::new(64, None, false);
    rig.pending();
    let before = state(&mut rig);
    let old = rig.machine.hart().regs.read(7);
    rig.machine.hart_mut().regs.write(7, old ^ 1);
    assert_ne!(state(&mut rig), before);
    rig.machine.hart_mut().regs.write(7, old);
    let old = rig.machine.bus_mut().load8(BACKING).unwrap();
    rig.machine.bus_mut().store8(BACKING, old ^ 1).unwrap();
    assert_ne!(state(&mut rig), before);
    rig.machine.bus_mut().store8(BACKING, old).unwrap();
    assert_eq!(state(&mut rig), before);
    let e = rig.exchange(1);
    rig.machine.submit3d_gather(&e).unwrap();
    assert_ne!(
        state(&mut rig),
        before,
        "logical DMA counter and result cursor are covered"
    );
}

#[test]
fn pending_incremental_gpu_history_requires_the_exact_reconstructed_ram() {
    let history = history();
    for corrupt in [false, true] {
        let mut rig = fresh(64);
        rig.machine
            .seed_gpu_session_ram_from_full_resume(&history.mid, &RENDERER)
            .unwrap();
        if corrupt {
            rig.machine.bus_mut().store8(BACKING, 0).unwrap();
        }
        let before = rig.machine.hart().to_snapshot();
        let mut plan = history.plan.clone();
        plan.begin = history.mid_position;
        plan.initial_resume = history.nonram.clone();
        plan.events
            .retain(|e| e.position.sequence > plan.begin.sequence);
        plan.witnesses.remove(0);
        let result = ReplayDriver::start_gpu(
            &mut rig.machine,
            plan,
            GpuReplayConfig {
                renderer_digest: RENDERER,
                ram_digest: Some(history.ram_digest),
                payloads: vec![],
            },
        );
        if corrupt {
            assert_eq!(
                result.err().unwrap().reason,
                ReplayReason::InitialCheckpoint
            );
            assert_eq!(rig.machine.hart().to_snapshot(), before);
        } else {
            let mut driver = result.unwrap();
            drive(&mut rig, &mut driver, 0, Ok(())).unwrap();
            rig.check(&history.final_bytes, 0x1100);
        }
    }
}

#[test]
fn restored_unused_cursor_cache_preserves_the_complete_guest_witness() {
    let history = history_with_unused_cursor(true);
    let mut plan = history.plan;
    plan.initial_resume = history.mid;
    plan.begin = history.mid_position;
    plan.events
        .retain(|event| event.position.sequence > plan.begin.sequence);
    plan.witnesses.remove(0);
    let mut replay = fresh(64);
    let mut driver =
        ReplayDriver::start_gpu(&mut replay.machine, plan.clone(), config(vec![])).unwrap();
    drive(&mut replay, &mut driver, 0, Ok(())).unwrap();
    assert_eq!(state(&mut replay), *plan.witnesses.last().unwrap());
    assert!(replay.host.borrow().jobs.is_empty());
    replay.check(&history.final_bytes, 0x1100);
    let before = replay.machine.snapshot();
    let witness = replay.machine.gpu_session_state_witness_bytes().unwrap();
    assert!(witness.windows(8).any(|bytes| bytes == b"WVGPULG1"));
    assert!(replay.machine.load_resume(&witness).is_err());
    assert_eq!(replay.machine.snapshot(), before);
    assert_eq!(
        replay.machine.gpu_session_state_witness_bytes().unwrap(),
        witness
    );
}

#[test]
fn fresh_gpu_profile_pins_one_gib_and_icount64_without_changing_software_admission() {
    use wasm_vm_core::dev::{
        rtc::{ClockUnavailable, WallClock},
        virtio::rng::{EntropySource, EntropyUnavailable},
    };
    use wasm_vm_core::{
        session_devices::{BaseDisk, PayloadRef as DiskRef},
        session_profile::ProfileError,
    };
    struct Clock;
    impl WallClock for Clock {
        fn now_ns(&self) -> u64 {
            0
        }
        fn sample_ns(
            &self,
            _: wasm_vm_core::dev::rtc::ClockSample,
        ) -> Result<u64, ClockUnavailable> {
            Ok(0)
        }
    }
    struct Entropy;
    impl EntropySource for Entropy {
        fn fill(&mut self, bytes: &mut [u8]) {
            bytes.fill(0);
        }
        fn try_fill(&mut self, bytes: &mut [u8]) -> Result<(), EntropyUnavailable> {
            bytes.fill(0);
            Ok(())
        }
    }
    let base = || BaseDisk {
        identity: [7; 32],
        sectors: 8,
        chunk_bytes: 4096,
        chunks: vec![DiskRef::of(&vec![0; 4096]).unwrap()],
    };
    let mut gpu = Machine::new(1 << 30);
    gpu.install_full_gpu_session(base(), Box::new(Clock), Box::new(Entropy), [8; 32], false)
        .unwrap();
    assert_eq!(gpu.guest_clock_div(), 64);
    assert_eq!(gpu.ram_len(), 1 << 30);
    assert_eq!(gpu.session_position(), Some(Default::default()));
    assert!(!gpu.session_sources_active());
    assert_eq!(gpu.session_device_replay(), Ok(false));
    assert_eq!(gpu.session_network_replay(), Ok(false));
    assert!(gpu.session_device_requests().unwrap().is_empty());
    drop(gpu);
    let mut small = Machine::new(256 << 20);
    assert!(matches!(
        small.install_full_gpu_session(base(), Box::new(Clock), Box::new(Entropy), [8; 32], false),
        Err(ProfileError::Unsupported)
    ));
    assert!(small.session_position().is_none());
    small
        .install_full_software_session(base(), Box::new(Clock), Box::new(Entropy), [8; 32], false)
        .unwrap();
    assert_eq!(small.guest_clock_div(), 10);
}
