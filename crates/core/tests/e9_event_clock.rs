//! Deterministic exact-boundary, timer/idle, precision and snapshot admission evidence.
#![cfg(not(feature = "zicsr-stub"))]
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE as BASE};
use wasm_vm_core::csr::{CsrOp, MIE, MINSTRET, MSTATUS, MTVEC, Priv};
use wasm_vm_core::resume::{SectionReader, SnapshotError, SnapshotWriter, section};
use wasm_vm_core::session_clock::{MAX_EVENTS, MAX_PAYLOAD, SessionEffect, SessionError};
use wasm_vm_core::trace::{TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};
const DATA: u64 = BASE + 0x4000;
const HANDLER: u64 = BASE + 0x2000;

fn addi(rd: u32, rs: u32, value: i32) -> u32 {
    ((value as u32) << 20) | (rs << 15) | (rd << 7) | 0x13
}
fn poke(m: &mut Machine, at: u64, words: &[u32]) {
    for (i, word) in words.iter().enumerate() {
        m.bus_mut().store32(at + i as u64 * 4, *word).unwrap()
    }
}
fn csr(m: &mut Machine, addr: u16, value: u64) {
    m.hart_mut()
        .csr
        .access(addr, CsrOp::Write, value, false, false, 0)
        .unwrap();
}
fn machine(cache: bool) -> Machine {
    let mut m = Machine::new(8 << 20);
    poke(&mut m, BASE, &[addi(1, 1, 1), addi(2, 2, 3), 0xff9ff06f]);
    m.hart_mut().regs.pc = BASE;
    m.enable_clint(4);
    m.set_block_cache(cache);
    m.set_interrupt_batching(cache);
    m.start_session_clock(1).unwrap();
    m
}
fn write(m: &mut Machine, at: u64, address: u64, bytes: &[u8]) -> u64 {
    m.stage_session_effect(
        at,
        SessionEffect::WriteRam {
            address,
            bytes: bytes.to_vec(),
        },
    )
    .unwrap()
}
fn artifact(name: &str, bytes: impl AsRef<[u8]>) {
    if let Some(dir) = std::env::var_os("E9_CLOCK_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir);
        let dir = if dir.is_absolute() {
            dir
        } else {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../..")
                .join(dir)
        };
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), bytes).unwrap();
    }
}
fn repack(blob: &[u8], edit: impl Fn(&mut Vec<u8>)) -> Vec<u8> {
    let (h, sections) = SectionReader::new(blob).unwrap();
    let mut w = SnapshotWriter::new(&h.core_hash, &h.base_image_hash, h.overlay_generation);
    for s in sections {
        let s = s.unwrap();
        let mut payload = s.payload.to_vec();
        if s.tag == section::SESSION_CLOCK {
            edit(&mut payload)
        }
        w.section(s.tag, &payload);
    }
    w.finish()
}
#[derive(Default)]
struct Lines(String);
impl TraceSink for Lines {
    fn retire(&mut self, r: &TraceRecord) {
        use std::fmt::Write;
        writeln!(self.0, "{}", fmt_canonical(r)).unwrap();
    }
}

#[test]
fn paused_controls_keep_sequence_and_ordinal_without_executing_a_transition() {
    let mut m = machine(false);
    let cpu = m.hart().regs.pc;
    let time = m.clint_mtime();
    write(&mut m, 0, DATA, b"one");
    write(&mut m, 0, DATA, b"two");
    m.deliver_session_boundary().unwrap();
    let receipts = m.take_session_deliveries().unwrap();
    assert_eq!(
        receipts
            .iter()
            .map(|d| (
                d.position.transition,
                d.position.retired,
                d.position.ordinal,
                d.position.sequence
            ))
            .collect::<Vec<_>>(),
        vec![(0, 0, 1, 1), (0, 0, 2, 2)]
    );
    assert_eq!((m.hart().regs.pc, m.clint_mtime()), (cpu, time));
    let saved = m.save_session_resume().unwrap();
    let mut restored = machine(true);
    restored.load_session_resume(&saved).unwrap();
    write(&mut restored, 0, DATA, b"three");
    restored.deliver_session_boundary().unwrap();
    let last = restored.take_session_deliveries().unwrap().remove(0);
    assert_eq!(
        (
            last.position.transition,
            last.position.retired,
            last.position.ordinal,
            last.position.sequence
        ),
        (0, 0, 3, 3)
    );
    assert_eq!(
        (restored.hart().regs.pc, restored.clint_mtime()),
        (cpu, time)
    );
    artifact(
        "paused-controls.resume",
        restored.save_session_resume().unwrap(),
    );
}

#[test]
fn pending_boolean_controls_restore_before_their_exact_delivery() {
    let mut m = machine(false);
    m.stage_session_effect(10, SessionEffect::ExternalPending(true))
        .unwrap();
    m.stage_session_effect(11, SessionEffect::ExternalPending(false))
        .unwrap();
    let saved = m.save_resume().unwrap();
    artifact("queued-pending-flags.resume", &saved);
    let mut restored = machine(true);
    restored.load_resume(&saved).unwrap();
    assert_eq!(
        restored.run_session_until(12, 100),
        Ok(RunOutcome::MaxInstrs)
    );
    let receipts = restored.take_session_deliveries().unwrap();
    assert_eq!(
        receipts
            .iter()
            .map(|d| (d.position.transition, d.position.sequence, d.effect.clone()))
            .collect::<Vec<_>>(),
        vec![
            (10, 1, SessionEffect::ExternalPending(true)),
            (11, 2, SessionEffect::ExternalPending(false))
        ]
    );
    artifact(
        "delivered-pending-flags.resume",
        restored.save_session_resume().unwrap(),
    );
}

#[test]
fn owned_events_stop_before_delivery_and_invalidate_decoded_code() {
    for cache in [false, true] {
        let mut m = machine(cache);
        // Deliberately enqueue the later callback first; tie order remains admission order.
        write(&mut m, 40, DATA, b"future");
        let first = write(&mut m, 10, BASE + 4, &addi(2, 2, 5).to_le_bytes());
        let second = write(&mut m, 10, BASE + 4, &addi(2, 2, 7).to_le_bytes());
        assert!(first < second);
        assert_eq!(m.run_session_until(10, 1000), Ok(RunOutcome::MaxInstrs));
        assert_eq!(m.session_position().unwrap().transition, 10);
        assert_eq!(m.session_position().unwrap().sequence, 0);
        assert_eq!(m.hart().regs.read(2), 9);
        assert_eq!(m.session_pending_events(), 3);
        assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        assert_eq!(
            m.hart().regs.read(2),
            16,
            "the next guest instruction consumes the last owned code write"
        );
        assert!(
            m.save_session_resume().is_err(),
            "applied, undrained effects cannot vanish from a keyframe"
        );
        let deliveries = m.take_session_deliveries().unwrap();
        assert_eq!(deliveries.len(), 2);
        assert_eq!(
            deliveries
                .iter()
                .map(|d| (
                    d.position.transition,
                    d.position.retired,
                    d.position.ordinal,
                    d.position.sequence,
                    d.ticket
                ))
                .collect::<Vec<_>>(),
            vec![(10, 10, 1, 1, first), (10, 10, 2, 2, second)]
        );
        let mut trace = Lines::default();
        assert_eq!(m.run_traced(31, &mut trace), RunOutcome::MaxInstrs);
        assert_eq!(m.session_position().unwrap().transition, 42);
        assert_eq!(m.session_position().unwrap().retired, 42);
        let mut data = [0; 6];
        m.bus_mut().ram().read_slice(DATA, &mut data).unwrap();
        assert_eq!(&data, b"future");
        assert_eq!(m.take_session_deliveries().unwrap()[0].position.sequence, 3);
        let snapshot = m.save_session_resume().unwrap();
        artifact(&format!("owned-cache-{cache}.resume"), &snapshot);
        artifact(&format!("owned-cache-{cache}.trace"), trace.0);
        println!(
            "owned cache={cache} position={:?} state={}",
            m.session_position().unwrap(),
            m.snapshot().hex_digest()
        );
        if cache {
            let mut plain = machine(false);
            plain.load_session_resume(&snapshot).unwrap();
            assert_eq!(plain.save_session_resume().unwrap(), snapshot)
        }
    }
}

fn waiting() -> Machine {
    let mut m = Machine::new(8 << 20);
    m.hart_mut().regs.pc = BASE;
    poke(&mut m, BASE, &[0x10500073, addi(4, 4, 1), 0x0000006f]);
    poke(&mut m, HANDLER, &[addi(10, 10, 1), 0x0000006f]);
    m.enable_clint(4).borrow_mut().mtimecmp = 100;
    csr(&mut m, MTVEC, HANDLER);
    csr(&mut m, MIE, 1 << 7);
    csr(&mut m, MSTATUS, 1 << 3);
    m.start_session_clock(1).unwrap();
    m
}

#[test]
fn wfi_idle_and_timer_delivery_are_separate_restorable_transitions() {
    let mut external = waiting();
    external
        .stage_session_effect(0, SessionEffect::ExternalPending(true))
        .unwrap();
    external.deliver_session_boundary().unwrap();
    external.take_session_deliveries().unwrap();
    let pending_state = external.save_session_resume().unwrap();
    artifact("wfi-held-before-wfi.resume", &pending_state);
    let mut external_restored = waiting();
    external_restored
        .load_session_resume(&pending_state)
        .unwrap();
    assert_eq!(
        external_restored.save_session_resume().unwrap(),
        pending_state
    );
    assert_eq!(
        external_restored.run_session_until(2, 5),
        Ok(RunOutcome::MaxInstrs)
    );
    assert_eq!(
        (
            external_restored.session_position().unwrap().transition,
            external_restored.session_position().unwrap().retired,
            external_restored.clint_mtime()
        ),
        (2, 2, 0)
    );
    let mut source = waiting();
    assert_eq!(source.run_session_until(1, 100), Ok(RunOutcome::MaxInstrs));
    assert_eq!(source.clint_mtime(), 0);
    assert_eq!(source.hart().regs.pc, BASE + 4);
    let keyframe = source.save_session_resume().unwrap();
    artifact("wfi-before-idle.resume", &keyframe);
    let mut held = waiting();
    held.load_session_resume(&keyframe).unwrap();
    held.stage_session_effect(1, SessionEffect::ExternalPending(true))
        .unwrap();
    write(&mut held, 1, DATA, b"held");
    assert_eq!(held.run(1), RunOutcome::MaxInstrs);
    assert_eq!(
        (
            held.session_position().unwrap().transition,
            held.session_position().unwrap().retired,
            held.clint_mtime()
        ),
        (2, 2, 0)
    );
    assert_eq!(held.hart().regs.read(4), 1);
    assert_eq!(
        held.take_session_deliveries()
            .unwrap()
            .iter()
            .map(|d| d.position.ordinal)
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
    for quantum in [1, 2, 7, 129] {
        let mut resumed = waiting();
        resumed.load_session_resume(&keyframe).unwrap();
        write(&mut resumed, 1, DATA, b"idle");
        write(&mut resumed, 2, DATA + 4, b"irq");
        while resumed.session_position().unwrap().transition < 2 {
            assert_eq!(
                resumed.run_session_until(2, quantum),
                Ok(RunOutcome::MaxInstrs)
            )
        }
        assert_eq!(
            (
                resumed.session_position().unwrap().transition,
                resumed.session_position().unwrap().retired,
                resumed.clint_mtime(),
                resumed.hart().regs.pc
            ),
            (2, 1, 100, BASE + 4)
        );
        assert_eq!(
            resumed.take_session_deliveries().unwrap()[0]
                .position
                .transition,
            1
        );
        assert_eq!(
            resumed.run_session_until(3, quantum),
            Ok(RunOutcome::MaxInstrs)
        );
        assert_eq!(
            (
                resumed.session_position().unwrap().transition,
                resumed.session_position().unwrap().retired,
                resumed.hart().regs.pc
            ),
            (3, 1, HANDLER)
        );
        assert_eq!(resumed.irq_stats().int[7], 1);
        let delivered = resumed.take_session_deliveries().unwrap();
        assert_eq!(delivered[0].position.transition, 2);
        assert_eq!(delivered[0].position.sequence, 2);
        artifact(
            &format!("wfi-after-interrupt-q{quantum}.resume"),
            resumed.save_session_resume().unwrap(),
        );
        println!(
            "wfi quantum={quantum} position={:?} mtime={} state={}",
            resumed.session_position().unwrap(),
            resumed.clint_mtime(),
            resumed.snapshot().hex_digest()
        );
    }
}

#[test]
fn delivered_traps_and_firmware_calls_do_not_fabricate_retirements() {
    let mut m = machine(false);
    poke(&mut m, BASE, &[0x00000073]);
    csr(&mut m, MTVEC, HANDLER);
    poke(&mut m, HANDLER, &[addi(5, 5, 1)]);
    csr(&mut m, MINSTRET, u64::MAX);
    assert_eq!(m.run(1), RunOutcome::MaxInstrs);
    assert_eq!(
        (
            m.session_position().unwrap().transition,
            m.session_position().unwrap().retired
        ),
        (1, 0)
    );
    assert_eq!(m.hart().regs.pc, HANDLER);
    assert_eq!(m.run(1), RunOutcome::MaxInstrs);
    assert_eq!(
        (
            m.session_position().unwrap().transition,
            m.session_position().unwrap().retired
        ),
        (2, 1)
    );
    let mut firmware = machine(false);
    poke(&mut firmware, BASE, &[0x00000073]);
    firmware.enable_builtin_sbi();
    firmware.hart_mut().csr.pmp.allow_all();
    firmware.hart_mut().csr.mode = Priv::S;
    firmware.hart_mut().regs.write(17, 0x10);
    firmware.hart_mut().regs.write(16, 0);
    assert_eq!(firmware.run(1), RunOutcome::MaxInstrs);
    assert_eq!(
        (
            firmware.session_position().unwrap().transition,
            firmware.session_position().unwrap().retired,
            firmware.hart().regs.pc
        ),
        (1, 0, BASE + 4)
    );
    let mut unhandled = machine(false);
    poke(&mut unhandled, BASE, &[0x00000073]);
    assert!(matches!(unhandled.run(1), RunOutcome::Trapped(_)));
    assert_eq!(unhandled.session_position().unwrap().transition, 0);
    artifact("delivered-trap.resume", m.save_session_resume().unwrap());
    artifact(
        "firmware-call.resume",
        firmware.save_session_resume().unwrap(),
    );
}

#[test]
fn precision_pending_queue_and_exhaustion_survive_real_snapshot_restore() {
    let mut source = machine(false);
    let empty = source.save_session_resume().unwrap();
    let wide = (1u64 << 53) + 1;
    let wide_blob = repack(&empty, |p| {
        p[12..20].copy_from_slice(&wide.to_le_bytes());
        p[20..28].copy_from_slice(&wide.to_le_bytes());
        p[36..44].copy_from_slice(&wide.to_le_bytes());
        p[44..52].copy_from_slice(&wide.to_le_bytes());
    });
    source.load_session_resume(&wide_blob).unwrap();
    write(&mut source, wide + 2, DATA, b"wide");
    let queued = source.save_session_resume().unwrap();
    artifact("wide-queued.resume", &queued);
    let mut restored = machine(true);
    restored.load_session_resume(&queued).unwrap();
    assert_eq!(restored.save_session_resume().unwrap(), queued);
    assert_eq!(
        restored.run_session_until(wide + 2, 100),
        Ok(RunOutcome::MaxInstrs)
    );
    assert_eq!(restored.session_pending_events(), 1);
    assert_eq!(restored.session_position().unwrap().transition, wide + 2);
    assert_eq!(restored.run(1), RunOutcome::MaxInstrs);
    let delivery = restored.take_session_deliveries().unwrap().remove(0);
    assert_eq!(
        (
            delivery.position.transition,
            delivery.position.retired,
            delivery.position.sequence,
            delivery.position.ordinal
        ),
        (wide + 2, wide + 2, wide + 1, 1)
    );
    artifact(
        "wide-delivered.resume",
        restored.save_session_resume().unwrap(),
    );
    let exhausted = repack(&empty, |p| {
        p[36..44].copy_from_slice(&u64::MAX.to_le_bytes());
        p[44..52].copy_from_slice(&u64::MAX.to_le_bytes());
    });
    source.load_session_resume(&exhausted).unwrap();
    let before = source.save_session_resume().unwrap();
    assert_eq!(
        source.stage_session_effect(0, SessionEffect::ExternalPending(true)),
        Err(SessionError::SequenceExhausted)
    );
    assert_eq!(source.save_session_resume().unwrap(), before);
    let exhausted = repack(&empty, |p| {
        p[12..20].copy_from_slice(&u64::MAX.to_le_bytes());
    });
    source.load_session_resume(&exhausted).unwrap();
    let before = source.save_session_resume().unwrap();
    assert_eq!(
        source.run(1),
        RunOutcome::SessionStopped(SessionError::TransitionExhausted)
    );
    assert_eq!(source.save_session_resume().unwrap(), before);
    assert_eq!(
        source.run_session_until(u64::MAX, 1),
        Ok(RunOutcome::MaxInstrs)
    );
    println!(
        "wide transition={} retired={} sequence={}",
        delivery.position.transition, delivery.position.retired, delivery.position.sequence
    );
}

#[test]
fn malformed_clock_queue_is_refused_before_any_machine_mutation() {
    let mut source = machine(false);
    write(&mut source, 3, DATA, b"a");
    write(&mut source, 3, DATA + 1, b"b");
    let blob = source.save_session_resume().unwrap();
    let mut corruptions = vec![
        (0, 255),
        (8, 2),
        (52, 2),
        (53, 2),
        (54, 255),
        (74, 255),
        (82, 255),
        (83, 255),
    ];
    // First queue record: target@58, ticket@66, kind@74, address@75, length@83.
    // The second ticket equals the first: duplicate identity despite otherwise ordered targets.
    corruptions.push((96, 0));
    for (offset, value) in corruptions {
        let damaged = repack(&blob, |p| p[offset] = value);
        let mut target = machine(true);
        target.run(2);
        let before = target.save_session_resume().unwrap();
        assert_eq!(
            target.load_session_resume(&damaged),
            Err(SnapshotError::BadComponentState {
                tag: section::SESSION_CLOCK
            }),
            "offset {offset}"
        );
        assert_eq!(
            target.save_session_resume().unwrap(),
            before,
            "offset {offset} mutated machine"
        );
    }
    for n in [0, 8, 12, 57, blob.len() - 1] {
        assert!(source.load_session_resume(&blob[..n]).is_err())
    }
    let missing = repack(&blob, |p| p.push(0));
    assert!(source.load_session_resume(&missing).is_err());
    for omit in [
        section::CPU,
        section::RAM,
        section::CLOCK,
        section::SESSION_CLOCK,
    ] {
        let (header, sections) = SectionReader::new(&blob).unwrap();
        let mut writer = SnapshotWriter::new(
            &header.core_hash,
            &header.base_image_hash,
            header.overlay_generation,
        );
        for item in sections {
            let item = item.unwrap();
            if item.tag != omit {
                writer.section(item.tag, item.payload);
            }
        }
        let mut target = machine(true);
        let before = target.save_resume().unwrap();
        assert!(
            target.load_resume(&writer.finish()).is_err(),
            "active ordinary restore must retain complete session topology: {omit}"
        );
        assert_eq!(target.save_resume().unwrap(), before);
    }
    artifact("queue-valid.resume", blob);
}

#[test]
fn bounded_mailbox_and_unsupported_scheduling_refuse_before_effects() {
    let mut m = machine(false);
    let initial = m.snapshot();
    assert_eq!(
        m.start_session_clock(2),
        Err(SessionError::UnsupportedScheduling)
    );
    assert_eq!(m.start_session_clock(1), Err(SessionError::AlreadyActive));
    assert_eq!(
        m.stage_session_effect(
            0,
            SessionEffect::WriteRam {
                address: 0,
                bytes: vec![1]
            }
        ),
        Err(SessionError::InvalidAddress)
    );
    assert_eq!(
        m.stage_session_effect(
            0,
            SessionEffect::WriteRam {
                address: DATA,
                bytes: vec![0; MAX_PAYLOAD + 1]
            }
        ),
        Err(SessionError::PayloadTooLarge)
    );
    for _ in 0..MAX_EVENTS {
        m.stage_session_effect(10, SessionEffect::ExternalPending(true))
            .unwrap();
    }
    assert_eq!(
        m.stage_session_effect(10, SessionEffect::ExternalPending(false)),
        Err(SessionError::QueueFull)
    );
    assert_eq!(m.snapshot(), initial);
    let mut bytes = machine(false);
    for _ in 0..4 {
        write(&mut bytes, 10, DATA, &vec![7; MAX_PAYLOAD]);
    }
    assert_eq!(
        bytes.stage_session_effect(
            10,
            SessionEffect::WriteRam {
                address: DATA,
                bytes: vec![1]
            }
        ),
        Err(SessionError::QueueFull)
    );
    let mut paced = Machine::new(8192);
    paced.enable_clint(1);
    struct Clock;
    impl wasm_vm_core::time::MonotonicClock for Clock {
        fn now_nanos(&self) -> u64 {
            0
        }
    }
    paced.set_paced_icount_clock(Box::new(Clock)).unwrap();
    assert_eq!(
        paced.start_session_clock(1),
        Err(SessionError::UnsupportedScheduling)
    );
    let mut changed = machine(false);
    let before = changed.snapshot();
    changed.set_wall_clock(
        Box::new(Clock),
        wasm_vm_core::time::WallClockPolicy::default(),
    );
    assert_eq!(
        changed.run(1),
        RunOutcome::SessionStopped(SessionError::UnsupportedScheduling)
    );
    assert_eq!(changed.snapshot(), before);
    assert!(changed.save_session_resume().is_err());
    assert_eq!(m.run_session_until(1, 1), Ok(RunOutcome::MaxInstrs));
    assert_eq!(m.run_session_until(0, 1), Err(SessionError::PositionPast));
    assert_eq!(
        m.stage_session_effect(0, SessionEffect::ExternalPending(true)),
        Err(SessionError::PositionPast)
    );
}
