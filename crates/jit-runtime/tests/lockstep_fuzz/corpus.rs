//! E4-T25 regression corpus — minimized repros replayed every run.
//!
//! Each entry is a directed minimized block distilled from a caught mis-translation class (the
//! `mutation_tests` injected bugs). With the CORRECT translator these must all lockstep-CLEAN (no
//! divergence): they are the exact operand shapes that DO diverge the moment the corresponding bug
//! is reintroduced, so this test is the standing guard that the SRAW/LW/branch-writeback/div-zero/
//! jalr semantics stay byte-identical to the interpreter. The human-readable repro artifacts live in
//! `crates/jit-runtime/corpus/*.txt`.
//!
//! When the fuzzer finds a NEW divergence, add its minimized block + prior state here (and drop the
//! textual report in `corpus/`) so it can never regress.

use super::*;

/// One corpus entry: a block plus the prior register state + seeded RAM to replay it from.
struct CorpusCase {
    name: &'static str,
    xregs: [u64; 32],
    ram_words: &'static [(u64, u64)],
    ops: &'static [(Instr, u8)],
}

fn prior_from(xregs: [u64; 32], ram: &[u8]) -> ArchState {
    ArchState {
        pc: BASE_PC,
        xregs,
        fregs: [0; 32],
        fcsr: 0,
        privilege: 3,
        mstatus: 0,
        mepc: 0,
        mcause: 0,
        mtval: 0,
        sepc: 0,
        scause: 0,
        stval: 0,
        satp: 0,
        ram_hash: fnv1a(ram),
    }
}

fn reg(idx: usize, v: u64) -> [u64; 32] {
    let mut r = [0u64; 32];
    r[idx] = v;
    r
}

fn regs(pairs: &[(usize, u64)]) -> [u64; 32] {
    let mut r = [0u64; 32];
    for &(i, v) in pairs {
        r[i] = v;
    }
    r
}

fn cases() -> Vec<CorpusCase> {
    use Instr::*;
    vec![
        // SRAW with high garbage in rs1 + a >31 shift count: the *W form must use i32 rs1 & mask
        // mod 32 then sign-extend (SHIFT_MASK_WRONG class).
        CorpusCase {
            name: "sraw_high_bits_shift_over_31",
            xregs: regs(&[(7, 0xFFFF_FFFF_8000_0000), (8, 65)]),
            ram_words: &[],
            ops: &[(
                Sraw {
                    rd: 5,
                    rs1: 7,
                    rs2: 8,
                },
                4,
            )],
        },
        // LW of a word whose bit 31 is set: result must be SIGN-extended (LW_DROP_SEXT class).
        CorpusCase {
            name: "lw_sign_extends_high_bit",
            xregs: regs(&[(6, 0x400)]),
            ram_words: &[(0x400, 0x0000_0000_FFFF_FFFF)],
            ops: &[(
                Lw {
                    rd: 5,
                    rs1: 6,
                    imm: 0,
                },
                4,
            )],
        },
        // A register dirtied before a TAKEN branch must be flushed at the taken exit
        // (TAKEN_BRANCH_NO_WRITEBACK class).
        CorpusCase {
            name: "dirty_reg_live_at_taken_branch",
            xregs: regs(&[(6, 0), (9, 0xDEAD)]),
            ram_words: &[],
            ops: &[
                (
                    Addi {
                        rd: 5,
                        rs1: 9,
                        imm: 7,
                    },
                    4,
                ),
                (
                    Beq {
                        rs1: 6,
                        rs2: 6,
                        imm: 16,
                    },
                    4,
                ),
            ],
        },
        // DIV by zero must yield -1 (all-ones), not the sanitized x/1 (DIV_ZERO_WRONG class).
        CorpusCase {
            name: "div_by_zero_yields_minus_one",
            xregs: regs(&[(1, 1234), (2, 0)]),
            ram_words: &[],
            ops: &[(
                Div {
                    rd: 5,
                    rs1: 1,
                    rs2: 2,
                },
                4,
            )],
        },
        // REM by zero must yield the dividend.
        CorpusCase {
            name: "rem_by_zero_yields_dividend",
            xregs: regs(&[(1, 0x1234_5678), (2, 0)]),
            ram_words: &[],
            ops: &[(
                Rem {
                    rd: 5,
                    rs1: 1,
                    rs2: 2,
                },
                4,
            )],
        },
        // JALR to an odd computed target must clear bit 0 (JALR_NO_CLEAR_BIT0 class).
        CorpusCase {
            name: "jalr_clears_bit0_on_odd_target",
            xregs: reg(14, BASE_PC + 3),
            ram_words: &[],
            ops: &[(
                Jalr {
                    rd: 1,
                    rs1: 14,
                    imm: 1,
                },
                4,
            )],
        },
    ]
}

#[test]
fn corpus_replays_clean() {
    // Hold the shared mutation lock (and clear any active mutation) so a parallel mutation test
    // can't bleed a mis-translation into this correct-translator replay. No-op without the feature.
    #[cfg(feature = "mutation-testing")]
    let _clean_guard = super::clean_campaign_guard();
    let mut n = 0;
    for c in cases() {
        let mut ram = vec![0u8; RAM_BYTES];
        for &(a, w) in c.ram_words {
            ram_write(&mut ram, a, 8, w);
        }
        let prior = prior_from(c.xregs, &ram);
        let block = Block {
            ops: c.ops.to_vec(),
        };
        assert!(
            lockstep_block(&prior, &block, &ram).is_none(),
            "corpus case `{}` DIVERGED under the current translator (regression!)",
            c.name
        );
        n += 1;
    }
    assert!(n >= 6, "expected the full corpus, saw {n}");
    eprintln!("regression corpus: {n} minimized repros replay lockstep-clean");
}
