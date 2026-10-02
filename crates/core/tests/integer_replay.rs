//! E5.5-T03bf: literal arithmetic oracles and public-boundary replay differentials.
//! The wasm test includes this file, so both targets execute exactly the same fixtures.
//! Set INTEGER_REPLAY_EVIDENCE_DIR on native to retain canonical traces and SHA-256
//! SHA256(serialized-hart || SHA256(RAM)) digests, including CSRs/FP/reservation.
#![cfg(not(feature = "zicsr-stub"))]

use sha2::{Digest, Sha256};
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MCYCLE, MINSTRET, MSCRATCH, Priv, SATP};
use wasm_vm_core::hart::Exception;
use wasm_vm_core::resume::ComponentSnapshot;
use wasm_vm_core::trace::{HashSink, TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};

const DATA: u64 = DRAM_BASE + 0x4000;
const RAM_BYTES: usize = 32 * 1024;
const MAX: u64 = u64::MAX;
const MIN: u64 = 0x8000_0000_0000_0000;
const WMIN: u64 = 0xffff_ffff_8000_0000;

#[derive(Default)]
struct Records(Vec<TraceRecord>);
impl TraceSink for Records {
    fn retire(&mut self, record: &TraceRecord) {
        self.0.push(*record);
    }
}

fn i(imm: i32, f3: u32, opcode: u32) -> u32 {
    ((imm as u32 & 0xfff) << 20) | (1 << 15) | (f3 << 12) | (3 << 7) | opcode
}
fn r(f7: u32, f3: u32, opcode: u32) -> u32 {
    (f7 << 25) | (2 << 20) | (1 << 15) | (f3 << 12) | (3 << 7) | opcode
}
fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    ((imm as u32 & 0xfff) << 20) | (u32::from(rs1) << 15) | (u32::from(rd) << 7) | 0x13
}

#[derive(Clone, Copy)]
struct Case {
    name: &'static str,
    word: u32,
    a: u64,
    b: u64,
    expected: u64,
}
fn cases() -> Vec<Case> {
    let mut cases = Vec::new();
    let mut add = |name, word, a, b, expected| {
        cases.push(Case {
            name,
            word,
            a,
            b,
            expected,
        })
    };
    // All 43 specialized opcodes. Results are hand-derived literals, never calls
    // to the production integer helper or values captured from the legacy path.
    add("lui", 0x8000_01b7, 0, 0, WMIN);
    add("auipc", 0xffff_f197, 0, 0, DRAM_BASE - 4096);
    add("addi", i(1, 0, 0x13), MAX, 0, 0);
    add("slti", i(0, 2, 0x13), MIN, 0, 1);
    add("sltiu", i(-1, 3, 0x13), MIN, 0, 1);
    add("xori", i(-1, 4, 0x13), 0x55, 0, 0xffff_ffff_ffff_ffaa);
    add("ori", i(-2048, 6, 0x13), 0x55, 0, 0xffff_ffff_ffff_f855);
    add("andi", i(-2048, 7, 0x13), MAX, 0, 0xffff_ffff_ffff_f800);
    add("slli", i(63, 1, 0x13), 1, 0, MIN);
    add("srli", i(63, 5, 0x13), MIN, 0, 1);
    add("srai", i(0x43f, 5, 0x13), MIN, 0, MAX);
    add("add", r(0, 0, 0x33), MAX, 1, 0);
    add("sub", r(0x20, 0, 0x33), 0, 1, MAX);
    add("sll", r(0, 1, 0x33), 1, 127, MIN);
    add("slt", r(0, 2, 0x33), MIN, 0, 1);
    add("sltu", r(0, 3, 0x33), MIN, MAX, 1);
    add("xor", r(0, 4, 0x33), 0x55, 0xaa, 0xff);
    add("srl", r(0, 5, 0x33), MIN, 127, 1);
    add("sra", r(0x20, 5, 0x33), MIN, 127, MAX);
    add("or", r(0, 6, 0x33), 0x55, 0xaa, 0xff);
    add("and", r(0, 7, 0x33), 0x55, 0xaa, 0);
    add("addiw", i(1, 0, 0x1b), 0x7fff_ffff, 0, WMIN);
    add("slliw", i(31, 1, 0x1b), 0xffff_ffff_0000_0001, 0, WMIN);
    add("srliw", i(31, 5, 0x1b), 0xaaaa_aaaa_8000_0000, 0, 1);
    add("sraiw", i(0x41f, 5, 0x1b), 0x1234_5678_8000_0000, 0, MAX);
    add("addw", r(0, 0, 0x3b), 0x7fff_ffff, 1, WMIN);
    add(
        "subw",
        r(0x20, 0, 0x3b),
        0x1234_5678_8000_0000,
        1,
        0x7fff_ffff,
    );
    add("sllw", r(0, 1, 0x3b), 0xffff_ffff_0000_0001, 63, WMIN);
    add("srlw", r(0, 5, 0x3b), 0xaaaa_aaaa_8000_0000, 63, 1);
    add("sraw", r(0x20, 5, 0x3b), 0x1234_5678_8000_0000, 63, MAX);
    add("mul", r(1, 0, 0x33), MAX, 2, MAX - 1);
    add("mulh", r(1, 1, 0x33), MIN, 2, MAX);
    add("mulhsu", r(1, 2, 0x33), MAX, MAX, MAX);
    add("mulhu", r(1, 3, 0x33), MAX, MAX, MAX - 1);
    add("div", r(1, 4, 0x33), (-7i64) as u64, 3, (-2i64) as u64);
    add("divu", r(1, 5, 0x33), MAX, 2, 0x7fff_ffff_ffff_ffff);
    add("rem", r(1, 6, 0x33), (-7i64) as u64, 3, MAX);
    add("remu", r(1, 7, 0x33), MAX, 2, 1);
    add("mulw", r(1, 0, 0x3b), 0xaaaa_aaaa_7fff_ffff, 2, MAX - 1);
    add("divw", r(1, 4, 0x3b), 0xaaaa_aaaa_ffff_fff9, 3, MAX - 1);
    add("divuw", r(1, 5, 0x3b), 0xaaaa_aaaa_ffff_ffff, 1, MAX);
    add("remw", r(1, 6, 0x3b), 0xaaaa_aaaa_ffff_fff9, 3, MAX);
    add(
        "remuw",
        r(1, 7, 0x3b),
        0xaaaa_aaaa_8000_0000,
        0xffff_ffff,
        WMIN,
    );
    assert_eq!(cases.len(), 43);
    cases
}

fn edge_cases() -> Vec<Case> {
    let mut cases = Vec::new();
    for (name, word, a, b, expected) in [
        ("div-zero", r(1, 4, 0x33), MIN, 0, MAX),
        ("divu-zero", r(1, 5, 0x33), 17, 0, MAX),
        ("rem-zero", r(1, 6, 0x33), MIN, 0, MIN),
        ("remu-zero", r(1, 7, 0x33), MAX - 7, 0, MAX - 7),
        ("div-overflow", r(1, 4, 0x33), MIN, MAX, MIN),
        ("rem-overflow", r(1, 6, 0x33), MIN, MAX, 0),
        (
            "divw-zero",
            r(1, 4, 0x3b),
            0x8000_0000,
            0x1234_5678_0000_0000,
            MAX,
        ),
        ("divuw-zero", r(1, 5, 0x3b), 17, 0x1234_5678_0000_0000, MAX),
        (
            "remw-zero",
            r(1, 6, 0x3b),
            0x8000_0000,
            0x1234_5678_0000_0000,
            WMIN,
        ),
        (
            "remuw-zero",
            r(1, 7, 0x3b),
            0x8000_0000,
            0x1234_5678_0000_0000,
            WMIN,
        ),
        (
            "divw-overflow",
            r(1, 4, 0x3b),
            0xaaaa_aaaa_8000_0000,
            0xbbbb_bbbb_ffff_ffff,
            WMIN,
        ),
        (
            "remw-overflow",
            r(1, 6, 0x3b),
            0xaaaa_aaaa_8000_0000,
            0xbbbb_bbbb_ffff_ffff,
            0,
        ),
        (
            "mulh-negative-pair",
            r(1, 1, 0x33),
            MIN,
            MIN,
            0x4000_0000_0000_0000,
        ),
        ("mulhsu-negative-high", r(1, 2, 0x33), MIN, MAX, MIN),
        (
            "mulhsu-positive-high",
            r(1, 2, 0x33),
            0x7fff_ffff_ffff_ffff,
            MAX,
            0x7fff_ffff_ffff_fffe,
        ),
        ("sll-mask-zero", r(0, 1, 0x33), 0x1234, 64, 0x1234),
        ("srl-mask-zero", r(0, 5, 0x33), MIN, 64, MIN),
        ("sra-mask-zero", r(0x20, 5, 0x33), MIN, 64, MIN),
        (
            "sllw-mask-zero",
            r(0, 1, 0x3b),
            0x1234_5678_8000_0000,
            32,
            WMIN,
        ),
        (
            "srlw-mask-zero",
            r(0, 5, 0x3b),
            0x1234_5678_8000_0000,
            32,
            WMIN,
        ),
        (
            "sraw-mask-zero",
            r(0x20, 5, 0x3b),
            0x1234_5678_8000_0000,
            32,
            WMIN,
        ),
        ("slti-false", i(-1, 2, 0x13), MAX, 0, 0),
        ("sltiu-false", i(-1, 3, 0x13), MAX, 0, 0),
        ("slt-false", r(0, 2, 0x33), 0, MIN, 0),
        ("sltu-false", r(0, 3, 0x33), MAX, MIN, 0),
    ] {
        cases.push(Case {
            name,
            word,
            a,
            b,
            expected,
        });
    }
    cases
}

fn machine(cache: bool, batching: bool) -> Machine {
    let mut m = Machine::new(RAM_BYTES);
    m.set_block_cache(cache);
    m.set_interrupt_batching(batching);
    let h = m.hart_mut();
    h.regs.pc = DRAM_BASE;
    h.resv = Some((DATA, 8));
    h.csr
        .access(MSCRATCH, CsrOp::Write, 0xdead_beef, false, false, 0)
        .unwrap();
    h.csr.mstatus |= 0b01 << 13;
    for n in 0..32 {
        h.fregs.write_raw(n, 0x0123_4567_89ab_cdef ^ u64::from(n));
    }
    m.bus_mut().store64(DATA, 0xfeed_face_cafe_beef).unwrap();
    m
}

fn assert_same(left: &Machine, right: &Machine) {
    assert_eq!(left.hart().to_snapshot(), right.hart().to_snapshot());
    assert_eq!(left.snapshot(), right.snapshot());
}

fn digest(m: &Machine) -> String {
    let mut hash = Sha256::new();
    hash.update(m.hart().to_snapshot());
    hash.update(m.snapshot().mem_digest);
    format!("{:x}", hash.finalize())
}

fn record_evidence(name: &str, records: &[TraceRecord], states: &str) {
    let mut hash = HashSink::new();
    for r in records {
        hash.retire(r);
    }
    let summary = format!(
        "{name}: retired={} trace-fnv={:#018x} states-sha256={:x}",
        hash.retired(),
        hash.hash(),
        Sha256::digest(states.as_bytes())
    );
    #[cfg(not(target_arch = "wasm32"))]
    eprintln!("{summary}");
    #[cfg(target_arch = "wasm32")]
    wasm_bindgen_test::console_log!("{summary}");
    #[cfg(not(target_arch = "wasm32"))]
    if let Some(dir) = std::env::var_os("INTEGER_REPLAY_EVIDENCE_DIR") {
        use std::fmt::Write;
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut trace = String::new();
        for r in records {
            writeln!(&mut trace, "{}", fmt_canonical(r)).unwrap();
        }
        std::fs::write(dir.join(format!("{name}.trace")), trace).unwrap();
        std::fs::write(dir.join(format!("{name}.states")), states).unwrap();
    }
    // Keep the canonical formatter type-checked by the actual wasm harness too.
    #[cfg(target_arch = "wasm32")]
    if let Some(r) = records.first() {
        assert!(format!("{}", fmt_canonical(r)).starts_with("core 0:"));
    }
}

fn exercise_cases(name: &str, cases: &[Case]) {
    use std::fmt::Write;
    let mut evidence = Vec::new();
    let mut states = String::new();
    for c in cases {
        // Prefix=0 exercises the general first-op path. Prefix=1 makes the
        // observed rd3 result an interior, deferrable cached op. An x0-only
        // interior copy cannot prove the computed integer value was correct.
        for prefix in 0..=1usize {
            let budget = 3 + prefix as u64;
            let expected = if c.word & 0x7f == 0x17 {
                c.expected.wrapping_add(prefix as u64 * 4) // AUIPC observes its own PC.
            } else {
                c.expected
            };
            let setup = |cache, batching| {
                let mut m = machine(cache, batching);
                m.hart_mut().regs.write(1, c.a);
                m.hart_mut().regs.write(2, c.b);
                if prefix != 0 {
                    m.bus_mut().store32(DRAM_BASE, addi(31, 31, 0)).unwrap();
                }
                // Exact op, x0-discard variant, and an immediately dependent readback.
                for (idx, word) in [c.word, c.word & !(31 << 7), addi(4, 3, 0)]
                    .into_iter()
                    .enumerate()
                {
                    m.bus_mut()
                        .store32(DRAM_BASE + (idx + prefix) as u64 * 4, word)
                        .unwrap();
                }
                m
            };
            let mut reference = setup(false, false);
            let mut reference_trace = Records::default();
            assert_eq!(
                reference.run_traced(budget, &mut reference_trace),
                RunOutcome::MaxInstrs
            );
            assert_eq!(
                reference.hart().regs.read(3),
                expected,
                "{} prefix={prefix}",
                c.name
            );
            assert_eq!(
                reference.hart().regs.read(4),
                expected,
                "{} prefix={prefix} dependent read",
                c.name
            );
            assert_eq!(
                reference_trace.0[prefix].rd,
                Some((3, expected)),
                "{} prefix={prefix}",
                c.name
            );
            assert_eq!(
                reference_trace.0[prefix + 1].rd,
                None,
                "{} prefix={prefix} x0 trace",
                c.name
            );
            assert_eq!(reference.hart().resv, Some((DATA, 8)));
            for (cache, batching) in [(false, false), (true, false), (true, true)] {
                for slices in [&[budget][..], &[1 + prefix as u64, 0, 2][..]] {
                    for recording in [false, true] {
                        let mut m = setup(cache, batching);
                        let mut trace = Records::default();
                        for &budget in slices {
                            let outcome = if recording {
                                m.run_traced(budget, &mut trace)
                            } else {
                                m.run(budget)
                            };
                            assert_eq!(
                                outcome,
                                RunOutcome::MaxInstrs,
                                "{} prefix={prefix}",
                                c.name
                            );
                        }
                        assert_same(&reference, &m);
                        assert_eq!(m.hart().regs.read(0), 0, "{} prefix={prefix} x0", c.name);
                        // Assert the independent expected value on the candidate too,
                        // making a broken deferred write visible without trace capture.
                        assert_eq!(
                            m.hart().regs.read(3),
                            expected,
                            "{} prefix={prefix} recording={recording} cache={cache} batching={batching}",
                            c.name
                        );
                        if recording {
                            assert_eq!(
                                reference_trace.0, trace.0,
                                "{} prefix={prefix} cache={cache} batching={batching} slices={slices:?}",
                                c.name
                            );
                        }
                    }
                }
            }
            evidence.extend_from_slice(&reference_trace.0);
            writeln!(
                &mut states,
                "{} prefix={prefix} {}",
                c.name,
                digest(&reference)
            )
            .unwrap();
        }
    }
    record_evidence(name, &evidence, &states);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn all_43_integer_opcodes_match_literal_results_in_every_replay_mode() {
    exercise_cases("integer-opcodes", &cases());
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn arithmetic_boundaries_match_literal_results_in_every_replay_mode() {
    exercise_cases("integer-boundaries", &edge_cases());
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn compressed_lengths_and_trap_after_integer_prefix_are_precise() {
    let mut final_reference = None;
    for (cache, batching) in [(false, false), (true, false), (true, true)] {
        for (recording, sliced) in [(false, false), (false, true), (true, false), (true, true)] {
            let mut m = machine(cache, batching);
            // c.li x3,-1; c.addi x3,1; c.slli x3,1; addi x4,x3,7; ebreak.
            for (offset, word) in [(0, 0x51fd), (2, 0x0185), (4, 0x0186)] {
                m.bus_mut().store16(DRAM_BASE + offset, word).unwrap();
            }
            for (offset, word) in [(6, addi(4, 3, 7)), (10, 0x0010_0073)] {
                m.bus_mut()
                    .store16(DRAM_BASE + offset, word as u16)
                    .unwrap();
                m.bus_mut()
                    .store16(DRAM_BASE + offset + 2, (word >> 16) as u16)
                    .unwrap();
            }
            let mut trace = Records::default();
            let budgets: &[u64] = if sliced { &[2, 0, 2, 10] } else { &[10] };
            for (index, &budget) in budgets.iter().enumerate() {
                let outcome = if recording {
                    m.run_traced(budget, &mut trace)
                } else {
                    m.run(budget)
                };
                if index + 1 == budgets.len() {
                    assert!(
                        matches!(outcome, RunOutcome::Trapped(t) if t.cause == Exception::Breakpoint)
                    );
                } else {
                    assert_eq!(outcome, RunOutcome::MaxInstrs);
                }
            }
            assert_eq!(m.hart().regs.pc, DRAM_BASE + 10);
            assert_eq!(m.hart().regs.read(3), 0);
            assert_eq!(m.hart().regs.read(4), 7);
            assert_eq!(m.hart_mut().csr.read(MCYCLE), 4);
            assert_eq!(m.hart().resv, Some((DATA, 8)));
            assert_eq!(m.hart_mut().csr.read(MINSTRET), 4, "fault must not retire");
            if recording {
                assert_eq!(trace.0.len(), 4);
                assert_eq!(
                    trace.0.iter().map(|r| r.pc - DRAM_BASE).collect::<Vec<_>>(),
                    [0, 2, 4, 6]
                );
                assert_eq!(
                    trace.0.iter().map(|r| r.rd).collect::<Vec<_>>(),
                    [Some((3, MAX)), Some((3, 0)), Some((3, 0)), Some((4, 7))]
                );
                record_evidence("integer-compressed-trap", &trace.0, &digest(&m));
            }
            if let Some(reference) = &final_reference {
                assert_same(reference, &m);
            } else {
                final_reference = Some(m);
            }
        }
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn cached_integer_prefix_sees_code_replacement_between_slices() {
    let mut final_reference = None;
    for (cache, batching) in [(false, false), (true, false), (true, true)] {
        for recording in [false, true] {
            let mut m = machine(cache, batching);
            m.bus_mut().store32(DRAM_BASE, addi(3, 3, 1)).unwrap();
            m.bus_mut().store32(DRAM_BASE + 4, addi(4, 3, 2)).unwrap();
            let mut trace = Records::default();
            let mut run = |m: &mut Machine, budget| {
                let outcome = if recording {
                    m.run_traced(budget, &mut trace)
                } else {
                    m.run(budget)
                };
                assert_eq!(outcome, RunOutcome::MaxInstrs);
            };
            run(&mut m, 1);
            // This interior op was predecoded before the first slice returned.
            m.bus_mut().store32(DRAM_BASE + 4, addi(4, 3, 9)).unwrap();
            run(&mut m, 1);
            assert_eq!(m.hart().regs.read(4), 10);
            m.hart_mut().regs.pc = DRAM_BASE;
            run(&mut m, 2);
            assert_eq!(m.hart().regs.read(3), 2);
            assert_eq!(m.hart().regs.read(4), 11);
            assert_eq!(m.hart().resv, Some((DATA, 8)));
            if cache {
                assert!(m.block_cache_entry_stats().1 > 0);
            }
            if recording {
                assert_eq!(
                    trace.0.iter().map(|r| r.rd).collect::<Vec<_>>(),
                    [Some((3, 1)), Some((4, 10)), Some((3, 2)), Some((4, 11))]
                );
                record_evidence("integer-invalidation", &trace.0, &digest(&m));
            }
            if let Some(reference) = &final_reference {
                assert_same(reference, &m);
            } else {
                final_reference = Some(m);
            }
        }
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn cached_auipc_and_compressed_retirement_wrap_the_virtual_pc() {
    for compressed in [false, true] {
        let mut final_reference = None;
        for (cache, batching) in [(false, false), (true, false), (true, true)] {
            for recording in [false, true] {
                let mut m = machine(cache, batching);
                let root = DRAM_BASE + 0x1000;
                let pte = |pa: u64, flags: u64| ((pa >> 12) << 10) | flags;
                for (table, next) in [(root, root + 0x1000), (root + 0x1000, root + 0x2000)] {
                    m.bus_mut().store64(table + 511 * 8, pte(next, 1)).unwrap();
                }
                m.bus_mut()
                    .store64(root + 0x2000 + 511 * 8, pte(DRAM_BASE, 0x4b))
                    .unwrap();
                let start = if compressed { MAX - 1 } else { MAX - 3 };
                if compressed {
                    m.bus_mut().store16(DRAM_BASE + 4094, 0x0185).unwrap(); // c.addi x3,1
                } else {
                    m.bus_mut().store32(DRAM_BASE + 4092, 0x0000_1197).unwrap(); // auipc x3,0x1000
                }
                let h = m.hart_mut();
                h.csr.pmp.allow_all();
                h.csr
                    .access(
                        SATP,
                        CsrOp::Write,
                        (8 << 60) | (root >> 12),
                        false,
                        false,
                        0,
                    )
                    .unwrap();
                h.csr.mode = Priv::S;
                let mut trace = Records::default();
                for _ in 0..2 {
                    m.hart_mut().regs.pc = start;
                    let outcome = if recording {
                        m.run_traced(1, &mut trace)
                    } else {
                        m.run(1)
                    };
                    assert_eq!(outcome, RunOutcome::MaxInstrs);
                    assert_eq!(m.hart().regs.pc, 0);
                }
                assert_eq!(m.hart().regs.read(3), if compressed { 2 } else { 4092 });
                if cache {
                    assert!(
                        m.block_cache_entry_stats().0 > 0,
                        "second entry must hit cache"
                    );
                }
                if recording {
                    assert_eq!(trace.0.len(), 2);
                    assert!(trace.0.iter().all(|r| r.pc == start));
                    record_evidence(
                        if compressed {
                            "integer-wrapping-c"
                        } else {
                            "integer-wrapping-auipc"
                        },
                        &trace.0,
                        &digest(&m),
                    );
                }
                if let Some(reference) = &final_reference {
                    assert_same(reference, &m);
                } else {
                    final_reference = Some(m);
                }
            }
        }
    }
}
