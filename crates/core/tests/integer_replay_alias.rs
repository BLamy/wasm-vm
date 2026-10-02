//! E5.5-T03bf independent verifier attack: a physical cached block must use its
//! current virtual PC through AUIPC, aliased operands, and mixed capture resumes.
#![cfg(not(feature = "zicsr-stub"))]

use sha2::{Digest, Sha256};
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MCYCLE, MINSTRET, Priv, SATP};
use wasm_vm_core::hart::Exception;
use wasm_vm_core::resume::ComponentSnapshot;
use wasm_vm_core::trace::{TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};

const ROOT: u64 = DRAM_BASE + 0x1000;
const CODE: u64 = DRAM_BASE + 0x6000;
const ALIASES: [u64; 2] = [0x1000_0000, 0xffff_ffc0_2000_0000];
const VALUES: [[u64; 4]; 2] = [
    [
        0xffff_ffff_9000_0002,
        0xffff_ffff_2000_0004,
        0xffff_ffff_f200_0000,
        0xffff_ffff_f1ff_ffff,
    ],
    [
        0xffff_ffbf_a000_0002,
        0xffff_ff7f_4000_0004,
        0xffff_fff7_f400_0000,
        0xffff_ffff_f3ff_ffff,
    ],
];
const WORDS: [u32; 7] = [
    0x0000_0001, // c.nop; force later operations into the replay tail
    0x8000_0297, // auipc x5, -0x80000000
    0x0052_82b3, // add x5,x5,x5 (destination aliases both operands)
    0x4052_d2b3, // sra x5,x5,x5 (shift amount uses old destination)
    0xfff2_829b, // addiw x5,x5,-1
    0x0000_1017, // auipc x0,4096
    0x0002_8333, // add x6,x5,x0
];
const OFFSETS: [u64; 7] = [0, 2, 6, 10, 14, 18, 22];

#[derive(Default)]
struct Records(Vec<TraceRecord>);
impl TraceSink for Records {
    fn retire(&mut self, record: &TraceRecord) {
        self.0.push(*record);
    }
}

fn build(cached: bool) -> Machine {
    let mut m = Machine::new(64 * 1024);
    let mut next = ROOT + 0x1000;
    let pte = |pa: u64, flags: u64| ((pa >> 12) << 10) | flags;
    for va in ALIASES {
        let mut table = ROOT;
        for level in (1..=2usize).rev() {
            let slot = table + ((va >> (12 + level * 9)) & 0x1ff) * 8;
            let entry = m.bus_mut().load64(slot).unwrap();
            table = if entry & 1 == 0 {
                let child = next;
                next += 0x1000;
                m.bus_mut().store64(slot, pte(child, 1)).unwrap();
                child
            } else {
                (entry >> 10) << 12
            };
        }
        m.bus_mut()
            .store64(table + ((va >> 12) & 0x1ff) * 8, pte(CODE, 0x4b))
            .unwrap();
    }
    for (&offset, &word) in OFFSETS.iter().zip(&WORDS) {
        m.bus_mut().store16(CODE + offset, word as u16).unwrap();
        if offset != 0 {
            m.bus_mut()
                .store16(CODE + offset + 2, (word >> 16) as u16)
                .unwrap();
        }
    }
    m.bus_mut().store16(CODE + 26, 0x0073).unwrap();
    m.bus_mut().store16(CODE + 28, 0x0010).unwrap(); // ebreak
    let h = m.hart_mut();
    h.csr.pmp.allow_all();
    h.csr
        .access(
            SATP,
            CsrOp::Write,
            (8 << 60) | (ROOT >> 12),
            false,
            false,
            0,
        )
        .unwrap();
    h.csr.mode = Priv::S;
    h.regs.pc = ALIASES[0];
    h.resv = Some((DRAM_BASE + 0x7000, 8));
    m.set_block_cache(cached);
    m.set_interrupt_batching(cached);
    m
}

fn expected(alias: usize) -> Vec<TraceRecord> {
    let v = VALUES[alias];
    let writes = [
        None,
        Some((5, v[0])),
        Some((5, v[1])),
        Some((5, v[2])),
        Some((5, v[3])),
        None,
        Some((6, v[3])),
    ];
    (0..7)
        .map(|i| TraceRecord {
            pc: ALIASES[alias] + OFFSETS[i],
            insn: WORDS[i],
            rd: writes[i],
            mem: None,
        })
        .collect()
}

fn run_pair(budgets: &[u64], trace_even: bool) -> String {
    use std::fmt::Write;
    let mut reference = build(false);
    let mut cached = build(true);
    let mut evidence = String::new();
    let mut observed = Records::default();
    let mut reference_observed = Records::default();
    assert_eq!(cached.run_traced(7, &mut observed), RunOutcome::MaxInstrs);
    assert_eq!(
        reference.run_traced(7, &mut reference_observed),
        RunOutcome::MaxInstrs
    );
    assert_eq!(observed.0, expected(0));
    assert_eq!(reference_observed.0, observed.0);
    assert_eq!(cached.block_cache_entry_stats(), (0, 1));
    cached.hart_mut().regs.pc = ALIASES[1];
    reference.hart_mut().regs.pc = ALIASES[1];
    observed.0.clear();
    reference_observed.0.clear();
    let mut retired = 0usize;
    let expected = expected(1);
    for (slice, &budget) in budgets.iter().enumerate() {
        let traced = (slice % 2 == 0) == trace_even;
        if traced {
            assert_eq!(
                cached.run_traced(budget, &mut observed),
                RunOutcome::MaxInstrs
            );
            assert_eq!(
                reference.run_traced(budget, &mut reference_observed),
                RunOutcome::MaxInstrs
            );
            assert_eq!(observed.0, expected[retired..retired + budget as usize]);
            assert_eq!(reference_observed.0, observed.0);
            for record in &observed.0 {
                writeln!(&mut evidence, "{}", fmt_canonical(record)).unwrap();
            }
            observed.0.clear();
            reference_observed.0.clear();
        } else {
            assert_eq!(cached.run(budget), RunOutcome::MaxInstrs);
            assert_eq!(reference.run(budget), RunOutcome::MaxInstrs);
        }
        retired += budget as usize;
        assert_eq!(cached.hart().to_snapshot(), reference.hart().to_snapshot());
        assert_eq!(cached.snapshot(), reference.snapshot());
        assert_eq!(cached.hart_mut().csr.read(MINSTRET), 7 + retired as u64);
        assert_eq!(cached.hart_mut().csr.read(MCYCLE), 7 + retired as u64);
        assert_eq!(cached.hart().resv, Some((DRAM_BASE + 0x7000, 8)));
    }
    assert_eq!(retired, 7);
    assert_eq!(cached.hart().regs.read(5), VALUES[1][3]);
    assert_eq!(cached.hart().regs.read(6), VALUES[1][3]);
    assert_eq!(cached.hart().regs.read(0), 0);
    assert_eq!(cached.hart().regs.pc, ALIASES[1] + 26);
    assert_eq!(cached.block_cache_entry_stats(), (1, 1));
    let outcome = cached.run_traced(1, &mut observed);
    assert!(matches!(outcome, RunOutcome::Trapped(t) if t.cause == Exception::Breakpoint));
    assert_eq!(outcome, reference.run_traced(1, &mut reference_observed));
    assert!(observed.0.is_empty());
    assert!(reference_observed.0.is_empty());
    assert_eq!(cached.hart_mut().csr.read(MINSTRET), 14);
    assert_eq!(cached.hart().to_snapshot(), reference.hart().to_snapshot());
    assert_eq!(cached.snapshot(), reference.snapshot());
    let mut hash = Sha256::new();
    hash.update(cached.hart().to_snapshot());
    hash.update(cached.snapshot().mem_digest);
    writeln!(
        &mut evidence,
        "budgets={budgets:?} trace_even={trace_even} retired=14 cache_hits=1 cache_misses=1 state_sha256={:x}",
        hash.finalize()
    )
    .unwrap();
    evidence
}

#[test]
fn virtual_aliases_preserve_integer_pc_and_aliasing_across_mixed_capture_slices() {
    let mut evidence = String::new();
    for budgets in [&[7][..], &[2, 0, 3, 2], &[1, 1, 0, 5], &[0, 4, 3]] {
        for trace_even in [false, true] {
            evidence.push_str(&run_pair(budgets, trace_even));
        }
    }
    eprintln!("{evidence}");
    if let Some(dir) = std::env::var_os("INTEGER_REPLAY_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            std::path::Path::new(&dir).join("integer-virtual-alias.trace"),
            evidence,
        )
        .unwrap();
    }
}

#[test]
fn deferred_integer_writeback_wraps_the_virtual_pc_for_both_lengths() {
    use std::fmt::Write;
    let mut evidence = String::new();
    for compressed in [false, true] {
        let mut reference = None;
        for cached in [false, true] {
            for traced in [false, true] {
                let mut m = Machine::new(64 * 1024);
                let pte = |pa: u64, flags: u64| ((pa >> 12) << 10) | flags;
                for (table, next) in [(ROOT, ROOT + 0x1000), (ROOT + 0x1000, ROOT + 0x2000)] {
                    m.bus_mut().store64(table + 511 * 8, pte(next, 1)).unwrap();
                }
                m.bus_mut()
                    .store64(ROOT + 0x2000 + 511 * 8, pte(CODE, 0x4b))
                    .unwrap();
                let offset = if compressed { 4092 } else { 4090 };
                let start = u64::MAX - (4095 - offset);
                m.bus_mut().store16(CODE + offset, 0x0001).unwrap(); // c.nop prefix
                let word = if compressed { 0x0285 } else { 0x0000_1297 }; // c.addi/auipc x5
                m.bus_mut().store16(CODE + offset + 2, word as u16).unwrap();
                if !compressed {
                    m.bus_mut()
                        .store16(CODE + offset + 4, (word >> 16) as u16)
                        .unwrap();
                }
                let h = m.hart_mut();
                h.csr.pmp.allow_all();
                h.csr
                    .access(
                        SATP,
                        CsrOp::Write,
                        (8 << 60) | (ROOT >> 12),
                        false,
                        false,
                        0,
                    )
                    .unwrap();
                h.csr.mode = Priv::S;
                h.regs.pc = start;
                m.set_block_cache(cached);
                m.set_interrupt_batching(cached);
                let mut records = Records::default();
                let outcome = if traced {
                    m.run_traced(2, &mut records)
                } else {
                    m.run(2)
                };
                assert_eq!(outcome, RunOutcome::MaxInstrs);
                assert_eq!(m.hart().regs.pc, 0);
                let expected = if compressed { 1 } else { 4092 };
                assert_eq!(m.hart().regs.read(5), expected);
                assert_eq!(m.hart_mut().csr.read(MCYCLE), 2);
                assert_eq!(m.hart_mut().csr.read(MINSTRET), 2);
                if traced {
                    assert_eq!(
                        records.0,
                        [
                            TraceRecord {
                                pc: start,
                                insn: 0x0001,
                                rd: None,
                                mem: None,
                            },
                            TraceRecord {
                                pc: start + 2,
                                insn: word,
                                rd: Some((5, expected)),
                                mem: None,
                            },
                        ]
                    );
                    for record in &records.0 {
                        writeln!(&mut evidence, "{}", fmt_canonical(record)).unwrap();
                    }
                }
                let state = m.hart().to_snapshot();
                if let Some((expected_hart, expected_machine)) = &reference {
                    assert_eq!(&state, expected_hart);
                    assert_eq!(&m.snapshot(), expected_machine);
                } else {
                    reference = Some((state, m.snapshot()));
                }
                writeln!(
                    &mut evidence,
                    "compressed={compressed} cached={cached} traced={traced} retired=2 pc=0 x5={expected}"
                )
                .unwrap();
            }
        }
    }
    eprintln!("{evidence}");
    if let Some(dir) = std::env::var_os("INTEGER_REPLAY_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            std::path::Path::new(&dir).join("integer-deferred-wrap.trace"),
            evidence,
        )
        .unwrap();
    }
}
