//! Real guest RTC/RNG/WFI observations, original/replay byte equality and bounded attacks.
#![cfg(not(feature = "zicsr-stub"))]
use std::{cell::Cell, rc::Rc};
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    dev::{
        rtc::WallClock,
        virtio::rng::{EntropySource, EntropyUnavailable},
    },
    resume::{SectionReader, SnapshotWriter, section},
    session_clock::{
        SessionDelivery, SessionEffect, SessionError, SessionPhase,
        sources::{
            DivergenceReason, ObservationKind, ObservationRecord, ObservationTape, SourcePolicy,
        },
    },
    trace::{TraceRecord, TraceSink, fmt_canonical},
};
const PROGRAM: &[u8] = include_bytes!("../../../web/assets/e9-time-entropy.bin");
const REPORT: u64 = BASE + 0x5000;
fn pause() -> u64 {
    PROGRAM
        .chunks_exact(4)
        .position(|b| u32::from_le_bytes(b.try_into().unwrap()) == 0x53100013)
        .unwrap() as u64
}
fn end() -> u64 {
    PROGRAM.len() as u64 / 4
}
struct HostTime {
    epoch: Rc<Cell<u64>>,
    calls: Rc<Cell<u32>>,
    hostile: bool,
}
impl WallClock for HostTime {
    fn now_ns(&self) -> u64 {
        assert!(!self.hostile, "replay read the live host clock");
        let n = self.calls.get();
        self.calls.set(n + 1);
        self.epoch.get() + u64::from(n) * 17
    }
}
struct HostEntropy {
    seed: u32,
    calls: Rc<Cell<u32>>,
    hostile: bool,
    unavailable: Rc<Cell<bool>>,
}
impl EntropySource for HostEntropy {
    fn fill(&mut self, out: &mut [u8]) {
        assert!(!self.hostile, "replay used host entropy");
        let n = self.calls.get();
        self.calls.set(n + 1);
        for (i, b) in out.iter_mut().enumerate() {
            *b = (self
                .seed
                .wrapping_mul(13)
                .wrapping_add(n * 37)
                .wrapping_add(i as u32 * 11)) as u8;
        }
    }
    fn validate_len(&self, _: usize) -> Result<(), EntropyUnavailable> {
        assert!(!self.hostile, "replay consulted the live entropy provider");
        Ok(())
    }
    fn try_fill(&mut self, out: &mut [u8]) -> Result<(), EntropyUnavailable> {
        if self.unavailable.get() {
            return Err(EntropyUnavailable);
        }
        self.fill(out);
        Ok(())
    }
}
struct Fixture {
    unavailable: Rc<Cell<bool>>,
    machine: Machine,
    epoch: Rc<Cell<u64>>,
    time_calls: Rc<Cell<u32>>,
    rng_calls: Rc<Cell<u32>>,
    uart: Rc<std::cell::RefCell<wasm_vm_core::dev::uart16550::Uart16550>>,
}
fn fixture(seed: u32, hostile: bool, cache: bool) -> Fixture {
    let mut machine = Machine::new(16 << 20);
    machine.enable_clint(5);
    machine.enable_plic();
    let epoch = Rc::new(Cell::new(1_700_000_000_123_456_789));
    let time_calls = Rc::new(Cell::new(0));
    let rng_calls = Rc::new(Cell::new(0));
    let unavailable = Rc::new(Cell::new(false));
    machine.enable_rtc(Box::new(HostTime {
        epoch: epoch.clone(),
        calls: time_calls.clone(),
        hostile,
    }));
    let uart = machine.enable_uart16550();
    machine.enable_virtio_slots(None);
    machine.enable_virtio_rng(Box::new(HostEntropy {
        seed,
        calls: rng_calls.clone(),
        hostile,
        unavailable: unavailable.clone(),
    }));
    for (i, b) in PROGRAM.iter().enumerate() {
        machine.bus_mut().store8(BASE + i as u64, *b).unwrap();
    }
    machine.hart_mut().regs.pc = BASE;
    machine.set_block_cache(cache);
    machine.set_interrupt_batching(cache);
    machine.start_session_clock(1).unwrap();
    Fixture {
        unavailable,
        machine,
        epoch,
        time_calls,
        rng_calls,
        uart,
    }
}
#[derive(Default)]
struct Lines(String);
impl TraceSink for Lines {
    fn retire(&mut self, record: &TraceRecord) {
        use std::fmt::Write;
        writeln!(self.0, "{}", fmt_canonical(record)).unwrap();
    }
}
fn artifact(name: &str, bytes: impl AsRef<[u8]>) {
    if let Some(dir) = std::env::var_os("E9_SOURCE_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), bytes).unwrap();
    }
}
fn control(machine: &mut Machine, code: u8) {
    let p = machine.session_position().unwrap();
    machine
        .stage_session_effect(
            p.transition,
            SessionEffect::HostInput {
                channel: 16,
                bytes: vec![code],
            },
        )
        .unwrap();
    machine
        .deliver_session_host_boundary(|_, channel, bytes| {
            assert_eq!(channel, 16);
            assert_eq!(bytes, [code]);
            [0, 0, 0, 0]
        })
        .unwrap();
}
fn run(
    machine: &mut Machine,
    target: u64,
    quantum: u64,
    lines: &mut Lines,
    receipts: &mut Vec<SessionDelivery>,
) {
    while machine.session_position().unwrap().transition < target {
        assert_eq!(
            machine
                .run_session_until_traced(target, quantum, lines)
                .unwrap(),
            RunOutcome::MaxInstrs
        );
        receipts.extend(machine.take_session_deliveries().unwrap());
    }
}
fn observations(receipts: &[SessionDelivery], policy: SourcePolicy) -> ObservationTape {
    ObservationTape {
        policy,
        records: receipts
            .iter()
            .filter_map(|r| {
                if let SessionEffect::Observation(value) = &r.effect {
                    Some(ObservationRecord {
                        position: r.position,
                        value: value.clone(),
                    })
                } else {
                    None
                }
            })
            .collect(),
    }
}
fn receipt_lines(receipts: &[SessionDelivery]) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    for r in receipts {
        let (kind, status, requested, bytes) = match &r.effect {
            SessionEffect::Observation(value) => (
                value.kind as u8,
                value.status,
                value.requested,
                value.bytes.as_slice(),
            ),
            SessionEffect::HostInput { channel: 16, bytes } => {
                (16, 0, bytes.len() as u32, bytes.as_slice())
            }
            _ => panic!("unexpected guest effect"),
        };
        let mut hex = String::new();
        for byte in bytes {
            write!(hex, "{byte:02x}").unwrap();
        }
        writeln!(out,"{{\"transition\":\"{}\",\"retired\":\"{}\",\"phase\":\"{}\",\"ordinal\":{},\"sequence\":\"{}\",\"ticket\":\"{}\",\"kind\":{},\"status\":{},\"requested\":{},\"hex\":\"{}\"}}",r.position.transition,r.position.retired,r.position.phase.label(),r.position.ordinal,r.position.sequence,r.ticket,kind,status,requested,hex).unwrap();
    }
    out
}
fn original(
    seed: u32,
    cache: bool,
) -> (
    Fixture,
    ObservationTape,
    Vec<SessionDelivery>,
    Vec<u8>,
    Vec<u8>,
    Lines,
) {
    let mut f = fixture(seed, false, cache);
    let policy = f.machine.source_policy();
    f.machine.start_session_sources(policy, None).unwrap();
    let mut receipts = vec![];
    let mut lines = Lines::default();
    control(&mut f.machine, 1);
    receipts.extend(f.machine.take_session_deliveries().unwrap());
    run(&mut f.machine, pause(), 7, &mut lines, &mut receipts);
    control(&mut f.machine, 0);
    receipts.extend(f.machine.take_session_deliveries().unwrap());
    let paused = f.machine.save_session_resume().unwrap();
    let time = f.machine.clint_mtime();
    f.epoch.set(f.epoch.get() + 333_333_333);
    assert_eq!(f.machine.clint_mtime(), time);
    control(&mut f.machine, 1);
    receipts.extend(f.machine.take_session_deliveries().unwrap());
    run(&mut f.machine, end(), 31, &mut lines, &mut receipts);
    control(&mut f.machine, 0);
    control(&mut f.machine, 2);
    receipts.extend(f.machine.take_session_deliveries().unwrap());
    let final_frame = f.machine.save_session_resume().unwrap();
    let tape = observations(&receipts, policy);
    (f, tape, receipts, paused, final_frame, lines)
}
#[test]
fn guest_observations_replay_under_hostile_providers_and_different_quanta() {
    for (seed, cache) in [(0x9e3779b9, false), (0xa409a563, true)] {
        let (mut source, tape, source_receipts, paused, final_frame, lines) = original(seed, cache);
        let expected = source.uart.borrow_mut().take_output();
        assert_eq!(expected.len(), 113);
        assert_eq!(
            (
                source.rng_calls.get(),
                tape.records
                    .iter()
                    .filter(|r| r.value.kind == ObservationKind::Entropy)
                    .count()
            ),
            (2, 2)
        );
        assert!(
            tape.records
                .iter()
                .any(|r| r.value.kind == ObservationKind::RtcPoll)
        );
        assert!(
            tape.records
                .iter()
                .all(|r| r.position.phase == SessionPhase::Observe)
        );
        assert!(
            tape.records
                .windows(2)
                .any(|w| w[0].position.transition == w[1].position.transition
                    && w[1].position.ordinal == w[0].position.ordinal + 1)
        );
        for (i, b) in expected[64..80].iter().enumerate() {
            assert_eq!(*b, seed.wrapping_mul(13).wrapping_add(i as u32 * 11) as u8);
        }
        for (i, b) in expected[80..113].iter().enumerate() {
            assert_eq!(
                *b,
                seed.wrapping_mul(13)
                    .wrapping_add(37)
                    .wrapping_add(i as u32 * 11) as u8
            );
        }
        let report: Vec<u8> = (0..113)
            .map(|i| source.machine.bus_mut().load8(REPORT + i).unwrap())
            .collect();
        assert_eq!(report, expected);
        assert_eq!(
            expected[48], 0,
            "RTC deadline fired during the explicit pause"
        );
        let before = u64::from_le_bytes(expected[32..40].try_into().unwrap());
        let after = u64::from_le_bytes(expected[40..48].try_into().unwrap());
        assert!(after >= before + 1000);
        assert_eq!(source.machine.session_position().unwrap().transition, end());
        assert_eq!(
            source.machine.session_position().unwrap().retired,
            end() - 1
        );
        let encoded = tape.encode().unwrap();
        assert_eq!(ObservationTape::decode(&encoded).unwrap(), tape);
        for quantum in [1, 7, 64] {
            let mut replay = fixture(seed ^ 0xffffffff, true, !cache);
            let policy = replay.machine.source_policy();
            replay
                .machine
                .start_session_sources(policy, Some(ObservationTape::decode(&encoded).unwrap()))
                .unwrap();
            let mut receipts = vec![];
            let mut replay_lines = Lines::default();
            control(&mut replay.machine, 1);
            receipts.extend(replay.machine.take_session_deliveries().unwrap());
            run(
                &mut replay.machine,
                pause(),
                quantum,
                &mut replay_lines,
                &mut receipts,
            );
            control(&mut replay.machine, 0);
            receipts.extend(replay.machine.take_session_deliveries().unwrap());
            assert_eq!(replay.machine.save_session_resume().unwrap(), paused);
            replay.epoch.set(42);
            control(&mut replay.machine, 1);
            receipts.extend(replay.machine.take_session_deliveries().unwrap());
            run(
                &mut replay.machine,
                end(),
                quantum,
                &mut replay_lines,
                &mut receipts,
            );
            control(&mut replay.machine, 0);
            control(&mut replay.machine, 2);
            receipts.extend(replay.machine.take_session_deliveries().unwrap());
            replay.machine.finish_session_source_replay().unwrap();
            assert_eq!(receipts, source_receipts);
            assert_eq!(replay_lines.0, lines.0);
            let replay_frame = replay.machine.save_session_resume().unwrap();
            assert_eq!(replay_frame, final_frame);
            assert_eq!(replay.uart.borrow_mut().take_output(), expected);
            assert_eq!((replay.time_calls.get(), replay.rng_calls.get()), (0, 0));
            artifact(
                &format!("seed-{seed:08x}-q{quantum}-replay.resume"),
                replay_frame,
            );
            artifact(
                &format!("seed-{seed:08x}-q{quantum}-replay.trace"),
                replay_lines.0,
            );
        }
        artifact(&format!("seed-{seed:08x}-record.resume"), &final_frame);
        artifact(&format!("seed-{seed:08x}-paused.resume"), &paused);
        artifact(&format!("seed-{seed:08x}-record.trace"), lines.0);
        artifact(&format!("seed-{seed:08x}.observations"), encoded);
        artifact(
            &format!("seed-{seed:08x}.receipts.jsonl"),
            receipt_lines(&source_receipts),
        );
        artifact(&format!("seed-{seed:08x}.uart.bin"), expected);
        artifact(
            &format!("seed-{seed:08x}.counts.txt"),
            format!(
                "time_calls={}\nrng_calls={}\npause={}\nend={}\n",
                source.time_calls.get(),
                source.rng_calls.get(),
                pause(),
                end()
            ),
        );
    }
}
#[test]
fn malformed_policies_lengths_and_reordered_or_exhausted_records_are_typed() {
    let (_, tape, _, _, _, _) = original(19, false);
    for attack in 0..8 {
        let mut replay = fixture(87, true, false);
        let mut altered = tape.clone();
        let policy = replay.machine.source_policy();
        match attack {
            0 => altered.policy.divider += 1,
            1 => altered
                .records
                .iter_mut()
                .find(|r| r.value.kind == ObservationKind::Entropy)
                .unwrap()
                .value
                .bytes
                .pop()
                .map(|_| ())
                .unwrap(),
            2 => altered.records.clear(),
            3 => altered.records[0].value.kind = ObservationKind::RtcPoll,
            4 => altered.records[0].position.transition += 1,
            5 => altered.records[0].value.requested = 7,
            6 => altered.policy.version = 2,
            7 => altered.policy.timebase_hz = 1,
            _ => unreachable!(),
        }
        let before = replay.machine.save_session_resume().unwrap();
        let result = replay.machine.start_session_sources(policy, Some(altered));
        if matches!(attack, 0 | 1 | 5 | 6 | 7) {
            assert!(matches!(
                result,
                Err(SessionError::ClockPolicyMismatch | SessionError::MalformedObservation)
            ));
            assert_eq!(before, replay.machine.save_session_resume().unwrap());
        } else {
            result.unwrap();
            control(&mut replay.machine, 1);
            replay.machine.take_session_deliveries().unwrap();
            let error = replay.machine.run_session_until(end(), 64).unwrap_err();
            assert!(matches!(error, SessionError::SourceDivergence(_)));
            let stopped = replay.machine.session_position().unwrap();
            assert_eq!(replay.machine.run(64), RunOutcome::SessionStopped(error));
            assert_eq!(replay.machine.session_position().unwrap(), stopped);
            artifact(&format!("attack-{attack}.txt"), format!("{error:?}\n"));
        }
        assert_eq!((replay.time_calls.get(), replay.rng_calls.get()), (0, 0));
    }
    let mut invalid = tape.encode().unwrap();
    for i in [0, 8, 12, 24, 28, 30, 66] {
        let old = invalid[i];
        invalid[i] ^= 0xff;
        assert!(
            ObservationTape::decode(&invalid).is_err(),
            "wire offset {i}"
        );
        invalid[i] = old;
    }
    for n in 0..32 {
        assert!(ObservationTape::decode(&invalid[..n]).is_err());
    }
}
#[test]
fn entropy_length_intent_diverges_before_dma_or_queue_publication() {
    let (_, mut tape, _, _, _, _) = original(29, false);
    let first = tape
        .records
        .iter_mut()
        .find(|r| r.value.kind == ObservationKind::Entropy)
        .unwrap();
    first.value.requested = 15;
    first.value.bytes.pop();
    let mut replay = fixture(0, true, false);
    let policy = replay.machine.source_policy();
    replay
        .machine
        .start_session_sources(policy, Some(tape))
        .unwrap();
    control(&mut replay.machine, 1);
    replay.machine.take_session_deliveries().unwrap();
    let error = replay.machine.run_session_until(end(), 128).unwrap_err();
    assert!(matches!(error,SessionError::SourceDivergence(d)if d.reason==DivergenceReason::Length));
    assert_eq!(replay.machine.bus_mut().load16(BASE + 0x3002).unwrap(), 0);
    assert!((0..16).all(|i| replay.machine.bus_mut().load8(BASE + 0x4000 + i).unwrap() == 0));
    assert_eq!((replay.time_calls.get(), replay.rng_calls.get()), (0, 0));
    artifact("entropy-length-divergence.txt", format!("{error:?}\n"));
}
#[test]
fn source_checkpoints_bind_policy_and_cursor_before_destination_mutation() {
    let (_, tape, _, paused, final_frame, reference_trace) = original(37, false);
    artifact("cursor-source.paused.resume", &paused);
    artifact("cursor-source.final.resume", &final_frame);
    artifact("cursor-source.observations", tape.encode().unwrap());
    artifact("cursor-source.trace", &reference_trace.0);
    let cursor = SectionReader::new(&paused)
        .unwrap()
        .1
        .map(|s| s.unwrap())
        .find(|s| s.tag == section::SESSION_SOURCES)
        .unwrap()
        .payload
        .to_vec();
    assert_eq!(cursor.len(), 32);
    for attack in 0..5 {
        let mut dest = fixture(1, true, false);
        let policy = dest.machine.source_policy();
        dest.machine
            .start_session_sources(
                policy,
                Some(ObservationTape {
                    policy,
                    records: vec![],
                }),
            )
            .unwrap();
        let before = dest.machine.save_session_resume().unwrap();
        let (h, sections) = SectionReader::new(&paused).unwrap();
        let mut w = SnapshotWriter::new(&h.core_hash, &h.base_image_hash, h.overlay_generation);
        for sec in sections {
            let sec = sec.unwrap();
            let mut b = sec.payload.to_vec();
            if sec.tag == section::SESSION_SOURCES {
                match attack {
                    0 => b[0] ^= 1,
                    1 => b[12..16].copy_from_slice(&6u32.to_le_bytes()),
                    2 => b[24..32].fill(255),
                    3 => b.push(0),
                    4 => continue,
                    _ => unreachable!(),
                }
            }
            w.section(sec.tag, &b);
        }
        assert!(dest.machine.load_session_resume(&w.finish()).is_err());
        assert_eq!(before, dest.machine.save_session_resume().unwrap());
    }
    let mut restored = fixture(0, true, true);
    let policy = restored.machine.source_policy();
    restored
        .machine
        .start_session_sources(
            policy,
            Some(ObservationTape {
                policy,
                records: vec![],
            }),
        )
        .unwrap();
    restored.machine.load_session_resume(&paused).unwrap();
    assert_eq!(restored.machine.save_session_resume().unwrap(), paused);
    let position = restored.machine.session_position().unwrap();
    let suffix = ObservationTape {
        policy,
        records: tape
            .records
            .into_iter()
            .filter(|r| r.position.sequence > position.sequence)
            .collect(),
    };
    restored
        .machine
        .append_session_source_replay(suffix)
        .unwrap();
    control(&mut restored.machine, 1);
    let mut receipts = restored.machine.take_session_deliveries().unwrap();
    let mut lines = Lines::default();
    run(&mut restored.machine, end(), 7, &mut lines, &mut receipts);
    control(&mut restored.machine, 0);
    control(&mut restored.machine, 2);
    receipts.extend(restored.machine.take_session_deliveries().unwrap());
    restored.machine.finish_session_source_replay().unwrap();
    assert_eq!(restored.machine.save_session_resume().unwrap(), final_frame);
    assert_eq!(
        (restored.time_calls.get(), restored.rng_calls.get()),
        (0, 0)
    );
    artifact(
        "restored-source-cursor.resume",
        restored.machine.save_session_resume().unwrap(),
    );
}
#[test]
fn frozen_policy_and_unconsumed_log_tail_refuse_without_host_observation() {
    let (_, tape, _, _, _, _) = original(41, false);
    let mut f = fixture(0, true, false);
    let policy = f.machine.source_policy();
    f.machine.start_session_sources(policy, Some(tape)).unwrap();
    assert!(
        matches!(f.machine.finish_session_source_replay(),Err(SessionError::SourceDivergence(d))if d.reason==DivergenceReason::ExtraRecords)
    );
    let mut changed = fixture(0, true, false);
    let policy = changed.machine.source_policy();
    changed
        .machine
        .start_session_sources(
            policy,
            Some(ObservationTape {
                policy,
                records: vec![],
            }),
        )
        .unwrap();
    changed.machine.set_icount_divider(6).unwrap();
    assert_eq!(
        changed.machine.run(1),
        RunOutcome::SessionStopped(SessionError::ClockPolicyMismatch)
    );
    assert_eq!((changed.time_calls.get(), changed.rng_calls.get()), (0, 0));
    let mut invalid = fixture(0, true, false);
    assert!(
        invalid
            .machine
            .set_icount_divider(u64::from(u32::MAX) + 6)
            .is_err()
    );
    assert_eq!(invalid.machine.source_policy().divider, 5);
}

#[test]
fn receipt_budget_yields_at_a_complete_transition_and_resumes_without_duplicate_reads() {
    let mut f = fixture(7, false, false);
    f.machine.hart_mut().regs.write(2, 0x101000);
    f.machine.bus_mut().store32(BASE, 0x00016283).unwrap();
    f.machine.bus_mut().store32(BASE + 4, 0xffdff06f).unwrap();
    let policy = f.machine.source_policy();
    f.machine.start_session_sources(policy, None).unwrap();
    let mut trace = Lines::default();
    assert_eq!(
        f.machine.run_session_until_traced(1000, 1000, &mut trace),
        Ok(RunOutcome::MaxInstrs)
    );
    assert!(f.machine.session_sources_need_flush());
    assert_eq!(f.time_calls.get(), 252);
    let p = f.machine.session_position().unwrap();
    assert_eq!((p.transition, p.retired, p.sequence), (503, 503, 252));
    let receipts = f.machine.take_session_deliveries().unwrap();
    assert_eq!(receipts.len(), 252);
    for (i, r) in receipts.iter().enumerate() {
        assert_eq!(
            (
                r.position.transition,
                r.position.ordinal,
                r.position.sequence
            ),
            (2 * i as u64, 1, i as u64 + 1)
        );
    }
    assert!(!f.machine.session_sources_need_flush());
    let frame = f.machine.save_session_resume().unwrap();
    let mut rest = vec![];
    run(&mut f.machine, 1000, 64, &mut trace, &mut rest);
    assert_eq!(f.time_calls.get(), 500);
    assert_eq!(f.machine.session_position().unwrap().transition, 1000);
    artifact(
        "bounded-rtc-budget.observations",
        observations(&receipts, policy).encode().unwrap(),
    );
    artifact("bounded-rtc-budget.resume", frame);
    artifact(
        "bounded-rtc-budget-suffix.observations",
        observations(&rest, policy).encode().unwrap(),
    );
    let final_frame = f.machine.save_session_resume().unwrap();
    artifact("bounded-rtc-budget-final.resume", &final_frame);
    let mut replay = fixture(0, true, false);
    replay.machine.hart_mut().regs.write(2, 0x101000);
    replay.machine.bus_mut().store32(BASE, 0x00016283).unwrap();
    replay
        .machine
        .bus_mut()
        .store32(BASE + 4, 0xffdff06f)
        .unwrap();
    replay
        .machine
        .start_session_sources(policy, Some(observations(&receipts, policy)))
        .unwrap();
    let mut replay_trace = Lines::default();
    assert_eq!(
        replay
            .machine
            .run_session_until_traced(1000, 1000, &mut replay_trace),
        Ok(RunOutcome::MaxInstrs)
    );
    assert_eq!(replay.machine.take_session_deliveries().unwrap(), receipts);
    replay
        .machine
        .append_session_source_replay(observations(&rest, policy))
        .unwrap();
    let mut replay_rest = vec![];
    run(
        &mut replay.machine,
        1000,
        7,
        &mut replay_trace,
        &mut replay_rest,
    );
    assert_eq!(replay_rest, rest);
    replay.machine.finish_session_source_replay().unwrap();
    assert_eq!(replay_trace.0, trace.0);
    assert_eq!(replay.machine.save_session_resume().unwrap(), final_frame);
    assert_eq!((replay.time_calls.get(), replay.rng_calls.get()), (0, 0));
    artifact("bounded-rtc-budget.trace", trace.0);
    artifact(
        "bounded-rtc-budget.txt",
        format!("calls_before=252\ncalls_after=500\nyield_position={p:?}\n"),
    );
}
#[test]
fn unavailable_entropy_is_a_recorded_failure_replayed_without_a_host_call() {
    let mut f = fixture(53, false, false);
    f.unavailable.set(true);
    let policy = f.machine.source_policy();
    f.machine.start_session_sources(policy, None).unwrap();
    control(&mut f.machine, 1);
    let error = f.machine.run_session_until(end(), 256).unwrap_err();
    assert!(
        matches!(error,SessionError::SourceDivergence(d)if d.reason==DivergenceReason::ProviderUnavailable)
    );
    let receipts = f.machine.take_session_deliveries().unwrap();
    let tape = observations(&receipts, policy);
    assert_eq!(tape.records.last().unwrap().value.status, 1);
    assert!(tape.records.last().unwrap().value.bytes.is_empty());
    assert_eq!(f.machine.bus_mut().load16(BASE + 0x3002).unwrap(), 0);
    assert_eq!(f.machine.bus_mut().load8(BASE + 0x4000).unwrap(), 0);
    let mut replay = fixture(99, true, false);
    replay
        .machine
        .start_session_sources(policy, Some(tape.clone()))
        .unwrap();
    control(&mut replay.machine, 1);
    assert_eq!(replay.machine.run_session_until(end(), 256), Err(error));
    assert_eq!(replay.machine.take_session_deliveries().unwrap(), receipts);
    assert_eq!((replay.time_calls.get(), replay.rng_calls.get()), (0, 0));
    artifact("unavailable-entropy.observations", tape.encode().unwrap());
    artifact(
        "unavailable-entropy.receipts.jsonl",
        receipt_lines(&receipts),
    );
    artifact("unavailable-entropy.txt", format!("{error:?}\n"));
}
#[test]
fn oversized_guest_entropy_request_refuses_before_allocation_dma_or_publication() {
    let mut f = fixture(0, false, false);
    let bus = f.machine.bus_mut();
    bus.store64(BASE + 0x1000, BASE + 0x4000).unwrap();
    bus.store32(BASE + 0x1008, 1048577).unwrap();
    bus.store16(BASE + 0x100c, 2).unwrap();
    bus.store16(BASE + 0x2002, 1).unwrap();
    for (offset, value) in [
        (0x30, 0),
        (0x38, 8),
        (0x80, (BASE + 0x1000) as u32),
        (0x90, (BASE + 0x2000) as u32),
        (0xa0, (BASE + 0x3000) as u32),
        (0x44, 1),
    ] {
        bus.store32(0x10003000 + offset, value).unwrap();
    }
    bus.store32(BASE, 0x0401a823).unwrap(); // sw x0,0x50(x3): the real guest kick.
    f.machine.hart_mut().regs.write(3, 0x10003000);
    let policy = f.machine.source_policy();
    f.machine.start_session_sources(policy, None).unwrap();
    assert_eq!(
        f.machine.run(2),
        RunOutcome::SessionStopped(SessionError::PayloadTooLarge)
    );
    assert_eq!(f.machine.session_position().unwrap().transition, 1);
    assert_eq!(f.rng_calls.get(), 0);
    assert_eq!(f.machine.bus_mut().load16(BASE + 0x3002).unwrap(), 0);
    assert_eq!(f.machine.bus_mut().load8(BASE + 0x4000).unwrap(), 0);
    artifact(
        "oversized-entropy.txt",
        format!(
            "position={:?}\nrng_calls={}\nused_idx=0\nerror=PayloadTooLarge\n",
            f.machine.session_position().unwrap(),
            f.rng_calls.get()
        ),
    );
}
#[test]
fn provider_observation_outside_execution_cannot_read_the_host_or_resume() {
    let mut f = fixture(0, true, false);
    let policy = f.machine.source_policy();
    f.machine
        .start_session_sources(
            policy,
            Some(ObservationTape {
                policy,
                records: vec![],
            }),
        )
        .unwrap();
    assert!(f.machine.bus_mut().load32(0x101000).is_err());
    let error = f.machine.run_session_until(1, 1).unwrap_err();
    assert!(
        matches!(error,SessionError::SourceDivergence(d)if d.reason==DivergenceReason::OutsideRun)
    );
    assert_eq!((f.time_calls.get(), f.rng_calls.get()), (0, 0));
    assert_eq!(f.machine.session_position().unwrap().transition, 0);
}

#[test]
fn source_admission_is_atomic_for_invalid_policy_tape_and_existing_clock() {
    for attack in 0..4 {
        let mut machine = Machine::new(4096);
        machine.enable_clint(5);
        let policy = machine.source_policy();
        let mut declared = policy;
        let mut tape = ObservationTape {
            policy,
            records: vec![],
        };
        if attack == 0 {
            declared.divider = 6;
        }
        if attack == 1 {
            tape.policy.version = 2;
        }
        if attack == 2 {
            machine.start_session_clock(1).unwrap();
        }
        let before = machine.save_session_resume().unwrap();
        let result = machine.start_session_clock_with_sources(declared, Some(tape));
        if attack == 3 {
            result.unwrap();
            assert!(machine.session_sources_active());
            assert!(machine.session_position().is_some());
            assert_eq!(
                machine.start_session_clock_with_sources(policy, None),
                Err(SessionError::AlreadyActive)
            );
        } else {
            assert!(result.is_err());
            assert!(!machine.session_sources_active());
            assert_eq!(machine.save_session_resume().unwrap(), before);
            assert_eq!(machine.session_position().is_some(), attack == 2);
        }
    }
}
#[test]
fn captured_entropy_chain_quota_refuses_all_dma_and_cannot_continue() {
    let mut f = fixture(7, false, false);
    let bus = f.machine.bus_mut();
    for i in 0..6u64 {
        let descriptor = BASE + 0x1000 + i * 16;
        bus.store64(descriptor, BASE + 0x4000 + i * 16).unwrap();
        bus.store32(descriptor + 8, 16).unwrap();
        bus.store16(descriptor + 12, if i == 5 { 2 } else { 3 })
            .unwrap();
        bus.store16(descriptor + 14, (i + 1) as u16).unwrap();
    }
    bus.store16(BASE + 0x2002, 1).unwrap();
    for (offset, value) in [
        (0x30, 0),
        (0x38, 8),
        (0x80, (BASE + 0x1000) as u32),
        (0x90, (BASE + 0x2000) as u32),
        (0xa0, (BASE + 0x3000) as u32),
        (0x44, 1),
    ] {
        bus.store32(0x10003000 + offset, value).unwrap();
    }
    bus.store32(BASE, 0x0401a823).unwrap();
    f.machine.hart_mut().regs.write(3, 0x10003000);
    let policy = f.machine.source_policy();
    f.machine.start_session_sources(policy, None).unwrap();
    for _ in 0..251 {
        control(&mut f.machine, 1);
    }
    assert_eq!(
        f.machine.run(2),
        RunOutcome::SessionStopped(SessionError::QueueFull)
    );
    assert_eq!(f.rng_calls.get(), 5);
    assert_eq!(f.machine.bus_mut().load16(BASE + 0x3002).unwrap(), 0);
    assert!((0..96).all(|i| f.machine.bus_mut().load8(BASE + 0x4000 + i).unwrap() == 0));
    let rows = f.machine.take_session_deliveries().unwrap();
    assert_eq!(rows.len(), 256);
    let position = f.machine.session_position().unwrap();
    assert_eq!(
        f.machine.run(2),
        RunOutcome::SessionStopped(SessionError::QueueFull)
    );
    assert_eq!(f.machine.session_position().unwrap(), position);
    assert_eq!(
        f.machine.stage_session_effect(
            position.transition,
            SessionEffect::HostInput {
                channel: 16,
                bytes: vec![0]
            }
        ),
        Err(SessionError::QueueFull)
    );
    artifact("entropy-chain-quota.receipts.jsonl", receipt_lines(&rows));
    artifact(
        "entropy-chain-quota.txt",
        format!(
            "position={position:?}\nrng_calls=5\nused_idx=0\nall_dma_zero=true\nerror=QueueFull\n"
        ),
    );
}
