//! Fresh E9-T09 critic: independent scalar arithmetic, nonmonotonic callback admission,
//! self-modifying-code delivery and restored pending effects under varied run quanta.
//! The model never asks the emulator to compute its expected register/PC values.
use jit_runtime::WasmtimeExecutor;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE as BASE};
use wasm_vm_core::session_clock::SessionEffect;
use wasm_vm_core::{Machine, RunOutcome};

const DATA: u64 = BASE + 0x4000;
const WARM: u64 = 512;
fn lcg(state: &mut u64) -> u64 {
    *state = state
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    *state
}
fn addi(rd: u32, delta: u32) -> u32 {
    (delta << 20) | (rd << 15) | (rd << 7) | 0x13
}
fn jal(offset: i32) -> u32 {
    let n = offset as u32;
    ((n >> 20) & 1) << 31
        | ((n >> 1) & 0x3ff) << 21
        | ((n >> 11) & 1) << 20
        | ((n >> 12) & 0xff) << 12
        | 0x6f
}
fn board(program: &[u32], compiled: bool, divider: u64) -> Machine {
    let mut m = Machine::new(1 << 20);
    for (i, word) in program.iter().enumerate() {
        m.bus_mut().store32(BASE + 4 * i as u64, *word).unwrap();
    }
    m.hart_mut().regs.pc = BASE;
    m.enable_clint(divider);
    m.set_block_cache(compiled);
    m.set_interrupt_batching(compiled);
    if compiled {
        m.set_executor(Box::new(WasmtimeExecutor::new()));
        m.set_hotness_threshold(1);
        m.set_jit(true);
    }
    m.start_session_clock(1).unwrap();
    m
}
fn stage(m: &mut Machine, at: u64, address: u64, payload: Vec<u8>) {
    m.stage_session_effect(
        at,
        SessionEffect::WriteRam {
            address,
            bytes: payload,
        },
    )
    .unwrap();
}
fn run_to(m: &mut Machine, at: u64, seed: &mut u64) {
    while m.session_position().unwrap().transition < at {
        let quantum = 1 + lcg(seed) % 137;
        assert_eq!(m.run_session_until(at, quantum), Ok(RunOutcome::MaxInstrs));
    }
}
fn expected(n: u64, initial: &[u32], changes: &[(u64, usize, u32)]) -> ([u64; 32], u64) {
    let mut regs = [0u64; 32];
    let mut words = initial.to_vec();
    // This scalar model counts guest arithmetic independently of emulator snapshots/counters.
    for transition in 0..n {
        for &(at, index, word) in changes {
            if at == transition {
                words[index] = word;
            }
        }
        let index = (transition as usize) % words.len();
        if index + 1 != words.len() {
            let word = words[index];
            let rd = ((word >> 7) & 31) as usize;
            assert_eq!((word & 127, (word >> 12) & 7), (0x13, 0));
            let immediate = ((word as i32) >> 20) as i64 as u64;
            regs[rd] = regs[rd].wrapping_add(immediate);
        }
    }
    (regs, BASE + 4 * (n % (words.len() as u64)))
}
fn check_model(m: &Machine, n: u64, program: &[u32], changes: &[(u64, usize, u32)]) {
    let (registers, pc) = expected(n, program, changes);
    assert_eq!(m.hart().regs.pc, pc, "pc at {n}");
    for (i, expected) in registers.iter().enumerate() {
        assert_eq!(m.hart().regs.read(i as u8), *expected, "x{i} at {n}");
    }
    let pos = m.session_position().unwrap();
    assert_eq!((pos.transition, pos.retired), (n, n));
}
#[test]
fn seeded_owned_writes_match_independent_arithmetic_and_pending_restore() {
    let mut executed = 0;
    for seed in [2u64, 7, 29, 73, 65537, 0xdeadbeef] {
        let mut random = seed;
        let length = 3 + (lcg(&mut random) % 10) as usize;
        let mut words: Vec<u32> = (0..length - 1)
            .map(|i| addi(1 + (i as u32) % 12, 1 + (lcg(&mut random) % 71) as u32))
            .collect();
        words.push(jal(-4 * (length as i32 - 1)));
        let index = (lcg(&mut random) % (length as u64 - 1)) as usize;
        let at = WARM + 1 + (lcg(&mut random) % 19);
        let changes = [
            (at, index, addi(1 + (index as u32) % 12, 97)),
            (at + 17, index, addi(1 + (index as u32) % 12, 101)),
        ];
        let mut plain = board(&words, false, 1 + seed % 17);
        let mut jit = board(&words, true, 1 + seed % 17);
        assert_eq!(plain.run(WARM), RunOutcome::MaxInstrs);
        assert_eq!(jit.run(WARM), RunOutcome::MaxInstrs);
        assert!(jit.executor().unwrap().executed_blocks() > 0);
        for m in [&mut plain, &mut jit] {
            // Later admission first and equal-position order are independent of transition order.
            stage(
                m,
                at + 17,
                BASE + 4 * index as u64,
                changes[1].2.to_le_bytes().to_vec(),
            );
            stage(m, at, DATA, vec![11]);
            stage(
                m,
                at,
                BASE + 4 * index as u64,
                changes[0].2.to_le_bytes().to_vec(),
            );
            stage(m, at, DATA, vec![22]);
            m.stage_session_effect(at + 1, SessionEffect::ExternalPending(true))
                .unwrap();
            m.stage_session_effect(at + 18, SessionEffect::ExternalPending(false))
                .unwrap();
        }
        let pending = jit.save_session_resume().unwrap();
        let mut restored = board(&words, true, 1 + seed % 17);
        restored.load_session_resume(&pending).unwrap();
        assert_eq!(pending, plain.save_session_resume().unwrap());
        let mut expected_receipts = Vec::new();
        for stop in [
            at - 1,
            at,
            at + 1,
            at + 2,
            at + 17,
            at + 18,
            at + 19,
            at + 137,
        ] {
            run_to(&mut plain, stop, &mut random);
            run_to(&mut jit, stop, &mut random);
            run_to(&mut restored, stop, &mut random);
            check_model(&plain, stop, &words, &changes);
            check_model(&jit, stop, &words, &changes);
            check_model(&restored, stop, &words, &changes);
            let p = plain.take_session_deliveries().unwrap();
            assert_eq!(p, jit.take_session_deliveries().unwrap());
            assert_eq!(p, restored.take_session_deliveries().unwrap());
            expected_receipts.extend(p);
            let snapshot = plain.save_session_resume().unwrap();
            assert_eq!(snapshot, jit.save_session_resume().unwrap());
            assert_eq!(snapshot, restored.save_session_resume().unwrap());
        }
        assert_eq!(
            expected_receipts
                .iter()
                .map(|d| (
                    d.position.transition,
                    d.position.ordinal,
                    d.position.sequence,
                    d.ticket
                ))
                .collect::<Vec<_>>(),
            vec![
                (at, 1, 1, 1),
                (at, 2, 2, 2),
                (at, 3, 3, 3),
                (at + 1, 1, 4, 4),
                (at + 17, 1, 5, 0),
                (at + 18, 1, 6, 5)
            ]
        );
        executed += jit.executor().unwrap().executed_blocks();
        println!(
            "seed={seed} length={length} smc_at={at} final={} real_compiled_blocks={}",
            at + 137,
            jit.executor().unwrap().executed_blocks()
        );
    }
    assert!(executed > 0);
    println!("seeded scalar/JIT/pending-restore attacks passed; executed_blocks={executed}");
}

// E9-T11 fresh critic: RTC samples may not follow the host's compiled-dispatch quantum.
mod time_entropy {
    use jit_runtime::WasmtimeExecutor;
    use std::{cell::Cell, rc::Rc};
    use wasm_vm_core::{
        Machine, RunOutcome,
        bus::{Bus, mmap::DRAM_BASE as BASE},
        dev::rtc::WallClock,
        session_clock::{
            SessionDelivery, SessionEffect,
            sources::{ObservationKind, ObservationRecord, ObservationTape},
        },
    };

    const WARM: u64 = 384;
    struct Clock {
        calls: Rc<Cell<u32>>,
        forbid: Rc<Cell<bool>>,
    }
    impl WallClock for Clock {
        fn now_ns(&self) -> u64 {
            assert!(!self.forbid.get(), "source replay consulted the live RTC");
            self.calls.set(self.calls.get() + 1);
            123
        }
    }
    struct Board {
        machine: Machine,
        calls: Rc<Cell<u32>>,
        forbid: Rc<Cell<bool>>,
    }
    fn board(guest_read: bool, alarm: bool) -> Board {
        let mut m = Machine::new(1 << 20);
        m.enable_clint(5);
        m.enable_plic();
        let calls = Rc::new(Cell::new(0));
        let forbid = Rc::new(Cell::new(false));
        m.enable_rtc(Box::new(Clock {
            calls: calls.clone(),
            forbid: forbid.clone(),
        }));
        let mut words = vec![0x00108093, 0x00310113, 0x00518193, 0x00720213, 0x00b28293];
        if guest_read {
            // A real compiled pure block jumps to an RTC load that must use interpreter fallback.
            words.extend([super::jal(12), 0x13, 0x13, 0x00056303, super::jal(-36)]);
        } else {
            words.push(super::jal(-20));
        }
        for (i, word) in words.into_iter().enumerate() {
            m.bus_mut().store32(BASE + 4 * i as u64, word).unwrap();
        }
        m.hart_mut().regs.pc = BASE;
        m.hart_mut().regs.write(10, 0x101000);
        m.set_block_cache(true);
        m.set_interrupt_batching(true);
        m.set_executor(Box::new(WasmtimeExecutor::new()));
        m.set_hotness_threshold(1);
        m.set_jit(true);
        m.start_session_clock(1).unwrap();
        assert_eq!(m.run(WARM), RunOutcome::MaxInstrs);
        assert_eq!(m.hart().regs.pc, BASE);
        assert!(m.executor().unwrap().is_compiled(BASE));
        assert!(
            m.executor().unwrap().executed_blocks() > 0,
            "must warm the actual Wasmtime executor"
        );
        if alarm {
            m.bus_mut().store32(0x10100c, 0x7fffffff).unwrap();
            m.bus_mut().store32(0x101008, 0xffffffff).unwrap();
        }
        calls.set(0);
        Board {
            machine: m,
            calls,
            forbid,
        }
    }
    fn drive(m: &mut Machine, target: u64, quantum: u64) -> Vec<SessionDelivery> {
        let mut receipts = vec![];
        while m.session_position().unwrap().transition < target {
            let outcome = m.run_session_until(target, quantum);
            assert_eq!(
                outcome,
                Ok(RunOutcome::MaxInstrs),
                "quantum={quantum}, stopped={:?}",
                m.session_position()
            );
            receipts.extend(m.take_session_deliveries().unwrap());
        }
        receipts
    }
    fn artifact(name: &str, bytes: impl AsRef<[u8]>) {
        if let Some(dir) = std::env::var_os("E9_SOURCE_EVIDENCE") {
            let dir = std::path::PathBuf::from(dir);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(name), bytes).unwrap();
        }
    }
    fn exercise(guest_read: bool, alarm: bool, record_quantum: u64, replay_quantum: u64) {
        let name = format!(
            "jit-source-read-{guest_read}-alarm-{alarm}-rq{record_quantum}-pq{replay_quantum}"
        );
        let target = WARM + if guest_read { 32 } else { 36 };
        let mut record = board(guest_read, alarm);
        let policy = record.machine.source_policy();
        record.machine.start_session_sources(policy, None).unwrap();
        let initial = record.machine.save_session_resume().unwrap();
        artifact(&format!("{name}-initial.resume"), &initial);
        let receipts = drive(&mut record.machine, target, record_quantum);
        let tape = ObservationTape {
            policy,
            records: receipts
                .iter()
                .map(|r| {
                    let SessionEffect::Observation(value) = &r.effect else {
                        panic!("unexpected non-source receipt")
                    };
                    ObservationRecord {
                        position: r.position,
                        value: value.clone(),
                    }
                })
                .collect(),
        };
        assert_eq!(record.calls.get() as usize, tape.records.len());
        artifact(&format!("{name}.observations"), tape.encode().unwrap());
        let final_frame = record.machine.save_session_resume().unwrap();
        artifact(&format!("{name}-record.resume"), &final_frame);
        let mut replay = board(guest_read, alarm);
        replay.forbid.set(true);
        replay
            .machine
            .start_session_sources(policy, Some(tape))
            .unwrap();
        assert_eq!(replay.machine.save_session_resume().unwrap(), initial);
        let replayed = drive(&mut replay.machine, target, replay_quantum);
        replay.machine.finish_session_source_replay().unwrap();
        assert_eq!(
            replayed, receipts,
            "record={record_quantum}, replay={replay_quantum}"
        );
        let replay_frame = replay.machine.save_session_resume().unwrap();
        assert_eq!(replay_frame, final_frame);
        artifact(&format!("{name}-replay.resume"), replay_frame);
        assert_eq!(replay.calls.get(), 0);
        let expected_count = if guest_read { 4 } else { 36 };
        let expected_kind = if guest_read {
            ObservationKind::RtcRead
        } else {
            ObservationKind::RtcPoll
        };
        if guest_read || record_quantum == 1 {
            assert_eq!(receipts.len(), expected_count);
        }
        assert!(receipts.iter().all(
            |r| matches!(&r.effect, SessionEffect::Observation(v) if v.kind == expected_kind)
        ));
        println!(
            "guest_read={guest_read} alarm={alarm} record_quantum={record_quantum} replay_quantum={replay_quantum} observations={} replay_host_calls=0",
            receipts.len()
        );
    }

    #[test]
    fn armed_rtc_samples_replay_across_actual_compiled_dispatch_budgets() {
        for record_quantum in [6, 1] {
            for replay_quantum in [6, 1] {
                exercise(false, true, record_quantum, replay_quantum);
            }
        }
    }
    #[test]
    fn guest_rtc_read_after_compiled_compute_replays_across_budgets() {
        for record_quantum in [8, 1] {
            for replay_quantum in [1, 8] {
                exercise(true, false, record_quantum, replay_quantum);
            }
        }
    }
}
