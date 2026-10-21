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
struct History {
    plan: ReplayPlan,
    payloads: Vec<Payload>,
    mid: Vec<u8>,
    nonram: Vec<u8>,
    ram_digest: [u8; 32],
    mid_position: SessionPosition,
    final_bytes: Vec<u8>,
}
fn history() -> History {
    history_with_unused_cursor(false)
}
fn history_with_unused_cursor(unused_cursor: bool) -> History {
    let mut rig = Rig::new(64, None, false);
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
    let end = state(&mut rig);
    let mut events = batch.events;
    events.extend(rig.machine.take_session_gpu_recording().unwrap().events);
    History {
        plan: ReplayPlan {
            begin: begin.position,
            end: end.position,
            initial_resume: initial,
            events,
            witnesses: vec![begin, before_physical, end],
        },
        payloads: batch.payloads,
        mid,
        nonram,
        ram_digest,
        mid_position,
        final_bytes,
    }
}
fn config(payloads: Vec<Payload>) -> GpuReplayConfig {
    GpuReplayConfig {
        renderer_digest: RENDERER,
        ram_digest: None,
        payloads,
    }
}
fn drive(
    rig: &mut Rig,
    driver: &mut ReplayDriver,
    delay: usize,
    outcome: Result<(), E>,
) -> Result<(), wasm_vm_core::session_replay::ReplayDivergence> {
    let mut exchange = 1;
    for turn in 0..4000 {
        let reached = driver.run_chunk_to(&mut rig.machine, driver.end(), 3, |_, _, _| {
            panic!("no live input")
        })?;
        if reached {
            return Ok(());
        }
        if turn < delay || rig.host.borrow().jobs.is_empty() {
            continue;
        }
        if exchange <= 2 {
            let e = rig.exchange(exchange);
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
                (exchange == 2).then_some(output.as_slice()),
                None,
            ) {
                Ok(bytes) => {
                    if exchange == 1 {
                        assert_eq!(bytes, vec![0x6d; 64]);
                    } else {
                        assert!(bytes.is_empty());
                    }
                    exchange += 1;
                }
                Err(GpuError::PhysicalPending) => {}
                error => panic!("physical receipt: {error:?}"),
            }
        }
        if exchange == 3 {
            rig.post(rig.completion(outcome, 2)).unwrap();
            exchange = 4;
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
