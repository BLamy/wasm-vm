// Independent E5-T22f verifier: seeded TOR/privilege/PTE sequences with a
// hand-calculated retirement/fault oracle and a cache-disabled machine.
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::csr::{CsrOp, MSTATUS, Priv, SATP};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::resume::ComponentSnapshot;
use wasm_vm_core::trace::{HashSink, TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 256 * 1024;
const VA: u64 = 0x4000_0000;
const SEED: u64 = 0x91e5_22f0_6a7b_c3d9;

#[derive(Default)]
struct Records {
    rows: Vec<TraceRecord>,
    digest: HashSink,
}
impl TraceSink for Records {
    fn retire(&mut self, row: &TraceRecord) {
        self.rows.push(*row);
        self.digest.retire(row);
    }
}

fn random(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

fn config(locked: bool, executable: bool) -> u64 {
    0x000f_000d | ((0x09 | (u64::from(executable) << 2) | (u64::from(locked) << 7)) << 8)
}

fn machine(code: u64, split: u64, locked: bool, executable: bool, cache: usize) -> Machine {
    let mut m = Machine::new(RAM);
    for (i, word) in [0x0015_0513, 0x0015_8593, 0xff9f_f06f].iter().enumerate() {
        m.bus_mut().store32(code + i as u64 * 4, *word).unwrap();
    }
    let root = DRAM_BASE + 0x1000;
    let l1 = root + 0x1000;
    let l0 = l1 + 0x1000;
    let pte = |pa: u64, bits: u64| ((pa >> 12) << 10) | bits;
    m.bus_mut().store64(root + 8, pte(l1, 1)).unwrap();
    m.bus_mut().store64(l1, pte(l0, 1)).unwrap();
    // Same physical page: supervisor RX, user RX, supervisor R, user R.
    for (i, bits) in [0x4b, 0x5b, 0x43, 0x53].iter().enumerate() {
        m.bus_mut()
            .store64(l0 + i as u64 * 8, pte(code, *bits))
            .unwrap();
    }
    m.hart_mut().csr.pmp.write_addr(0, (code + split) >> 2);
    m.hart_mut().csr.pmp.write_addr(1, (code + 4096) >> 2);
    m.hart_mut()
        .csr
        .pmp
        .write_addr(2, (DRAM_BASE + RAM as u64) >> 2);
    m.hart_mut()
        .csr
        .pmp
        .write_cfg(0, config(locked, executable));
    m.hart_mut()
        .csr
        .access(
            SATP,
            CsrOp::Write,
            (8 << 60) | (root >> 12),
            false,
            false,
            0,
        )
        .unwrap();
    // SUM must not allow supervisor instruction fetch from a user leaf.
    m.hart_mut()
        .csr
        .access(MSTATUS, CsrOp::Write, 1 << 18, false, false, 0)
        .unwrap();
    if cache != 0 {
        m.set_block_cache_capacity(cache);
    }
    m.set_block_cache(cache != 0);
    m
}

#[derive(Clone, Copy)]
struct Step {
    pc: u64,
    mode: Priv,
    page_ok: bool,
    locked: bool,
    executable: bool,
    split: u64,
}

fn step(m: &mut Machine, s: Step) -> Records {
    m.hart_mut().csr.mode = s.mode;
    m.hart_mut().regs.pc = s.pc;
    let x10 = m.hart().regs.read(10);
    let x11 = m.hart().regs.read(11);
    let retired = if !s.page_ok {
        0
    } else if !s.executable && (s.locked || s.mode != Priv::M) {
        s.split / 4
    } else {
        3
    };
    let expected = if retired == 3 {
        RunOutcome::MaxInstrs
    } else {
        RunOutcome::Trapped(Trap {
            cause: if s.page_ok {
                Exception::InstrAccessFault
            } else {
                Exception::InstrPageFault
            },
            tval: s.pc + retired * 4,
        })
    };
    let mut records = Records::default();
    assert_eq!(m.run_traced(3, &mut records), expected);
    assert_eq!(records.rows.len() as u64, retired);
    assert_eq!(m.hart().regs.read(10), x10 + u64::from(retired >= 1));
    assert_eq!(m.hart().regs.read(11), x11 + u64::from(retired >= 2));
    for (i, row) in records.rows.iter().enumerate() {
        assert_eq!(row.pc, s.pc + i as u64 * 4);
    }
    records
}

fn parity(a: &Machine, b: &Machine, x: &Records, y: &Records) -> String {
    assert_eq!(x.rows, y.rows);
    assert_eq!(a.hart().to_snapshot(), b.hart().to_snapshot());
    let ram = a.snapshot().hex_digest();
    assert_eq!(ram, b.snapshot().hex_digest());
    ram
}

pub fn seeded_mode_map_pte_sequence(mut report: impl FnMut(&str)) {
    for seed in [SEED, SEED ^ 0xd1b5_4a32_d192_ed03] {
        for (locked, initial_x) in [(false, true), (true, true), (true, false)] {
            for capacity in [1, 64] {
                let mut rng = seed;
                let code = DRAM_BASE + 0x10000 + (random(&mut rng) & 7) * 4096;
                let mut split = 4 + (random(&mut rng) & 1) * 4;
                let mut executable = initial_x;
                let mut a = machine(code, split, locked, executable, capacity);
                let mut b = machine(code, split, locked, executable, 0);
                assert!(!b.block_cache_enabled());
                let warm = Step {
                    pc: code,
                    mode: Priv::M,
                    page_ok: true,
                    locked,
                    executable,
                    split,
                };
                let x = step(&mut a, warm);
                let y = step(&mut b, warm);
                parity(&a, &b, &x, &y);
                let offset = (random(&mut rng) % 6) as usize;
                let modes = [Priv::M, Priv::S, Priv::U, Priv::M, Priv::U, Priv::S];
                let mut had_hit = false;
                for round in 0..48 {
                    let choice = random(&mut rng);
                    let next_x = if round < 8 {
                        executable
                    } else {
                        choice & 1 != 0
                    };
                    let next_split = if round < 8 {
                        split
                    } else {
                        4 + ((choice >> 1) & 1) * 4
                    };
                    let old_revision = a.hart().csr.pmp.revision();
                    let increments = if locked {
                        0
                    } else {
                        u64::from(next_x != executable) + u64::from(next_split != split)
                    };
                    for m in [&mut a, &mut b] {
                        m.hart_mut()
                            .csr
                            .pmp
                            .write_cfg(0, config(false, if locked { !executable } else { next_x }));
                        m.hart_mut().csr.pmp.write_addr(0, (code + next_split) >> 2);
                        if locked {
                            m.hart_mut().csr.pmp.write_addr(1, (code + 2048) >> 2);
                        }
                        assert_eq!(m.hart().csr.pmp.revision(), old_revision + increments);
                    }
                    if !locked {
                        executable = next_x;
                        split = next_split;
                    }
                    for m in [&a, &b] {
                        assert_eq!(m.hart().csr.pmp.read_cfg(0), config(locked, executable));
                        assert_eq!(m.hart().csr.pmp.read_addr(0), (code + split) >> 2);
                        assert_eq!(m.hart().csr.pmp.read_addr(1), (code + 4096) >> 2);
                    }
                    let mode = modes[(round + offset) % modes.len()];
                    let phase = (round / 8) % 3;
                    let alias = match (mode, phase) {
                        (Priv::U, 0) | (Priv::S, 1) => 1,
                        (Priv::U, 2) => 3,
                        (Priv::S, 2) => 2,
                        _ => 0,
                    };
                    let s = Step {
                        pc: if mode == Priv::M {
                            code
                        } else {
                            VA + alias * 4096
                        },
                        mode,
                        page_ok: mode == Priv::M || phase == 0,
                        locked,
                        executable,
                        split,
                    };
                    let x = step(&mut a, s);
                    let y = step(&mut b, s);
                    let ram = parity(&a, &b, &x, &y);
                    had_hit |= a.block_cache_entry_stats().0 > 0;
                    report(&format!(
                        "ATTACK seed={seed:016x} lock={locked} initial_x={initial_x} cache={capacity} round={round} mode={mode:?} pte_phase={phase} split={split} x={executable} revision={} retired={} x10={} x11={} trace={:016x} ram={ram}",
                        a.hart().csr.pmp.revision(),
                        x.rows.len(),
                        a.hart().regs.read(10),
                        a.hart().regs.read(11),
                        x.digest.hash()
                    ));
                    for row in &x.rows {
                        report(&format!("{}", fmt_canonical(row)));
                    }
                    if round == 23 {
                        let saved = a.save_resume().unwrap();
                        assert_eq!(saved, b.save_resume().unwrap());
                        for m in [&mut a, &mut b] {
                            m.hart_mut().regs.write(10, 0xdead_beef);
                            m.bus_mut()
                                .store8(DRAM_BASE + RAM as u64 - 1, 0xa5)
                                .unwrap();
                            m.load_resume(&saved).unwrap();
                            assert_eq!(m.save_resume().unwrap(), saved);
                        }
                        report("RESTORE CPU/RAM/PMP restored over dirty state");
                    }
                }
                assert!(had_hit, "the attack must reuse physical cached entries");
                for m in [&mut a, &mut b] {
                    m.hart_mut().reset(code);
                    assert_eq!(m.hart().csr.mode, Priv::M);
                    assert_eq!(m.hart().csr.pmp.read_cfg(0), 0);
                    assert!(!m.hart().csr.pmp.any_armed());
                }
                let s = Step {
                    pc: code,
                    mode: Priv::M,
                    page_ok: true,
                    locked: false,
                    executable: false,
                    split,
                };
                let x = step(&mut a, s);
                let y = step(&mut b, s);
                parity(&a, &b, &x, &y);
                for mode in [Priv::S, Priv::U] {
                    let mut traces = Vec::new();
                    for m in [&mut a, &mut b] {
                        m.hart_mut().csr.mode = mode;
                        m.hart_mut().regs.pc = code;
                        let mut records = Records::default();
                        assert_eq!(
                            m.run_traced(1, &mut records),
                            RunOutcome::Trapped(Trap {
                                cause: Exception::InstrAccessFault,
                                tval: code
                            })
                        );
                        assert!(records.rows.is_empty());
                        assert_eq!(m.hart().regs.read(10), 1);
                        assert_eq!(m.hart().regs.read(11), 1);
                        traces.push(records);
                    }
                    parity(&a, &b, &traces[0], &traces[1]);
                    report(&format!(
                        "RESET seed={seed:016x} lock={locked} cache={capacity} mode={mode:?} no_grant=denied retired=0"
                    ));
                }
            }
        }
    }
    report("SEEDED_ATTACK_HELD seeds=2 map_cases=3 capacities=2 boundaries=576");
}
