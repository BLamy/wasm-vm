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
        assert_eq!(m.hart().regs.read(i as u32), *expected, "x{i} at {n}");
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
