#![cfg(not(feature = "zicsr-stub"))]
use sha2::{Digest, Sha256};
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::mmap::DRAM_BASE,
    session_clock::SessionEffect,
    session_replay::{
        MAX_REPLAY_BYTES, MAX_REPLAY_EVENTS, ReplayDriver, ReplayFrontier, ReplayPlan,
        ReplayReason, ReplayStatus, StateWitness,
    },
    trace::VecSink,
};

fn fixture(instructions: usize, recording: bool) -> Machine {
    let mut machine = Machine::new(1 << 20);
    machine.enable_clint(1);
    machine
        .bus_mut()
        .write_ram_slice(DRAM_BASE, &[0x13, 0, 0, 0].repeat(instructions + 2))
        .unwrap();
    machine.hart_mut().regs.pc = DRAM_BASE;
    machine.start_session_clock(1).unwrap();
    if recording {
        machine
            .start_session_sources(machine.source_policy(), None)
            .unwrap();
    }
    machine
}

fn witness(machine: &mut Machine) -> StateWitness {
    StateWitness {
        position: machine.session_position().unwrap(),
        resume_sha256: Sha256::digest(machine.save_session_resume().unwrap()).into(),
    }
}

struct History {
    first: ReplayPlan,
    second: ReplayPlan,
    final_resume: Vec<u8>,
    payload_bytes: usize,
    count: usize,
    original_trace: String,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn record(count: usize, payload_bytes: usize) -> History {
    assert!(count >= 2);
    let split = count / 2;
    let mut original = fixture(count, true);
    let begin = original.session_position().unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let first_witness = witness(&mut original);
    let mut before = Vec::with_capacity(split);
    let mut after = Vec::with_capacity(count - split);
    let mut trace = VecSink::new();
    let mut middle = None;
    for index in 0..count {
        let transition = original.session_position().unwrap().transition;
        let mut payload = vec![index as u8; payload_bytes];
        if payload_bytes >= 8 {
            payload[0..8].copy_from_slice(&(index as u64).to_le_bytes());
        }
        original
            .stage_session_effect(
                transition,
                SessionEffect::HostInput {
                    channel: 1,
                    bytes: payload,
                },
            )
            .unwrap();
        original
            .deliver_session_host_boundary(|_, channel, bytes| {
                assert_eq!(channel, 1);
                [0, bytes.len() as u64, 0, 0]
            })
            .unwrap();
        let mut delivered = original.take_session_deliveries().unwrap();
        assert_eq!(delivered.len(), 1);
        if index < split {
            before.push(delivered.remove(0));
        } else {
            after.push(delivered.remove(0));
        }
        if index + 1 == split {
            middle = Some(witness(&mut original));
        }
        if index + 1 < count {
            assert_eq!(
                original
                    .run_session_until_traced(transition + 1, 1, &mut trace)
                    .unwrap(),
                RunOutcome::MaxInstrs
            );
        }
    }
    let final_witness = witness(&mut original);
    let final_resume = original.save_session_resume().unwrap();
    let middle = middle.unwrap();
    History {
        first: ReplayPlan {
            begin,
            end: middle.position,
            initial_resume,
            events: before,
            witnesses: vec![first_witness, middle],
        },
        second: ReplayPlan {
            begin: middle.position,
            end: final_witness.position,
            initial_resume: vec![],
            events: after,
            witnesses: vec![middle, final_witness],
        },
        final_resume,
        payload_bytes,
        count,
        original_trace: trace.canonical(),
    }
}

fn run_first(history: &History) -> (Machine, ReplayDriver, ReplayFrontier) {
    let mut machine = fixture(history.count, false);
    let mut driver = ReplayDriver::start(&mut machine, history.first.clone()).unwrap();
    driver
        .run_to_end(&mut machine, 64, |_, channel, bytes| {
            assert_eq!(channel, 1);
            [0, bytes.len() as u64, 0, 0]
        })
        .unwrap();
    assert_eq!(driver.status(), ReplayStatus::Completed);
    let frontier = driver.frontier(&mut machine).unwrap();
    assert_eq!(frontier.event_cursor, history.first.events.len());
    assert_eq!(frontier.position, history.second.begin);
    assert_eq!(
        frontier.state_sha256,
        history.second.witnesses[0].resume_sha256
    );
    assert_eq!(frontier.source_cursor, 0);
    assert!(frontier.source_last_loaded.is_none());
    assert!(frontier.device_cursor.is_none());
    assert!(frontier.network_cursor.is_none());
    assert!(frontier.gpu_cursor.is_none());
    assert!(frontier.renderer_digest.is_none());
    (machine, driver, frontier)
}

fn complete(history: History, case: &str) {
    history.first.validate().unwrap();
    history.second.validate_continuation().unwrap();
    let (mut machine, mut driver, frontier) = run_first(&history);
    assert_eq!(
        machine.stage_session_effect(
            frontier.position.transition,
            SessionEffect::ExternalPending(false)
        ),
        Err(wasm_vm_core::session_clock::SessionError::ReplayActive)
    );
    driver
        .continue_window(&mut machine, frontier, history.second)
        .unwrap();
    assert_eq!(driver.status(), ReplayStatus::Ready);
    assert_eq!(driver.event_cursor(), frontier.event_cursor);
    driver
        .run_to_end(&mut machine, 64, |_, channel, bytes| {
            assert_eq!(channel, 1);
            [0, bytes.len() as u64, 0, 0]
        })
        .unwrap();
    assert_eq!(driver.status(), ReplayStatus::Completed);
    assert_eq!(driver.event_cursor(), history.count);
    let final_frontier = driver.frontier(&mut machine).unwrap();
    assert_eq!(final_frontier.event_cursor, history.count);
    assert_eq!(machine.save_session_resume().unwrap(), history.final_resume);
    if let Ok(root) = std::env::var("E9_STREAMED_EVIDENCE") {
        let directory = std::path::Path::new(&root).join(case);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join("original.guest-trace"),
            &history.original_trace,
        )
        .unwrap();
        std::fs::write(directory.join("final.resume"), &history.final_resume).unwrap();
        std::fs::write(
            directory.join("frontiers.json"),
            format!(
                "{{\"middle\":{{\"transition\":\"{}\",\"sequence\":\"{}\",\"stateSha256\":\"{}\",\"eventCursor\":{}}},\"final\":{{\"transition\":\"{}\",\"sequence\":\"{}\",\"stateSha256\":\"{}\",\"eventCursor\":{}}}}}\n",
                frontier.position.transition,
                frontier.position.sequence,
                hex(&frontier.state_sha256),
                frontier.event_cursor,
                final_frontier.position.transition,
                final_frontier.position.sequence,
                hex(&final_frontier.state_sha256),
                final_frontier.event_cursor,
            ),
        )
        .unwrap();
    }
}

#[test]
fn session_replay_streamed_initial_to_end_count() {
    let history = record(MAX_REPLAY_EVENTS + 263, 1);
    assert!(history.count > MAX_REPLAY_EVENTS);
    assert!(history.first.events.len() <= MAX_REPLAY_EVENTS);
    assert!(history.second.events.len() <= MAX_REPLAY_EVENTS);
    complete(history, "software-event-count");
}

#[test]
fn session_replay_streamed_initial_to_end_bytes() {
    let history = record(260, 262_144);
    assert!(history.count * history.payload_bytes > MAX_REPLAY_BYTES);
    assert!(history.first.events.len() * history.payload_bytes < MAX_REPLAY_BYTES);
    assert!(history.second.events.len() * history.payload_bytes < MAX_REPLAY_BYTES);
    complete(history, "software-body-bytes");
}

#[test]
fn session_replay_streamed_rejects_stale_cursor_gap_and_wrong_endpoint() {
    let history = record(4, 4);
    let (mut machine, mut driver, mut frontier) = run_first(&history);
    let before = machine.save_session_resume().unwrap();
    frontier.event_cursor += 1;
    let error = driver
        .continue_window(&mut machine, frontier, history.second.clone())
        .unwrap_err();
    assert_eq!(error.reason, ReplayReason::InvalidPlan);
    assert_eq!(driver.status(), ReplayStatus::Diverged);
    assert_eq!(machine.save_session_resume().unwrap(), before);

    for mutate in [
        |p: &mut ReplayPlan| p.begin.sequence += 1,
        |p: &mut ReplayPlan| p.witnesses[0].resume_sha256[0] ^= 1,
    ] {
        let (mut machine, mut driver, frontier) = run_first(&history);
        let before = machine.save_session_resume().unwrap();
        let mut next = history.second.clone();
        mutate(&mut next);
        let error = driver
            .continue_window(&mut machine, frontier, next)
            .unwrap_err();
        assert_eq!(error.reason, ReplayReason::InvalidPlan);
        assert_eq!(driver.status(), ReplayStatus::Diverged);
        assert_eq!(machine.save_session_resume().unwrap(), before);
    }
}

#[test]
fn session_replay_streamed_same_transition_before_group_keeps_exact_ordinals() {
    let mut original = fixture(2, true);
    let initial_resume = original.save_session_resume().unwrap();
    let begin = witness(&mut original);
    let mut rows = Vec::new();
    for byte in [11, 12] {
        original
            .stage_session_effect(
                0,
                SessionEffect::HostInput {
                    channel: 1,
                    bytes: vec![byte],
                },
            )
            .unwrap();
        original
            .deliver_session_host_boundary(|_, channel, bytes| {
                assert_eq!(channel, 1);
                [0, bytes.len() as u64, 0, 0]
            })
            .unwrap();
        rows.push(original.take_session_deliveries().unwrap().remove(0));
    }
    let end = witness(&mut original);
    let final_resume = original.save_session_resume().unwrap();
    assert_eq!(rows[0].position.transition, rows[1].position.transition);
    assert_eq!(rows[0].position.ordinal + 1, rows[1].position.ordinal);

    let mut first_original = fixture(2, true);
    first_original
        .stage_session_effect(
            0,
            SessionEffect::HostInput {
                channel: 1,
                bytes: vec![11],
            },
        )
        .unwrap();
    first_original
        .deliver_session_host_boundary(|_, _, bytes| [0, bytes.len() as u64, 0, 0])
        .unwrap();
    assert_eq!(first_original.take_session_deliveries().unwrap().len(), 1);
    let middle = witness(&mut first_original);
    assert_eq!(middle.position, rows[0].position);
    let first = ReplayPlan {
        begin: begin.position,
        end: middle.position,
        initial_resume,
        events: vec![rows[0].clone()],
        witnesses: vec![begin, middle],
    };
    let second = ReplayPlan {
        begin: middle.position,
        end: end.position,
        initial_resume: vec![],
        events: vec![rows[1].clone()],
        witnesses: vec![middle, end],
    };
    first.validate().unwrap();
    second.validate_continuation().unwrap();
    let mut replay = fixture(2, false);
    let mut driver = ReplayDriver::start(&mut replay, first).unwrap();
    driver
        .run_to_end(&mut replay, 1, |_, _, bytes| [0, bytes.len() as u64, 0, 0])
        .unwrap();
    let frontier = driver.frontier(&mut replay).unwrap();
    driver
        .continue_window(&mut replay, frontier, second)
        .unwrap();
    driver
        .run_to_end(&mut replay, 1, |_, _, bytes| [0, bytes.len() as u64, 0, 0])
        .unwrap();
    assert_eq!(driver.event_cursor(), 2);
    assert_eq!(replay.save_session_resume().unwrap(), final_resume);
}
