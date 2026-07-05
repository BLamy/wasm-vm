//! Constrained-random RV64IM instruction-stream generator (E1-T21).
//!
//! Output is **assembly text**, not encoded words, on purpose: the toolchain's assembler
//! encodes it. A hand-rolled encoder in the fuzzer would just inject the fuzzer's OWN bugs
//! into the stimulus — the opposite of what a differential rig is for. The generator's job
//! is to choose *which* instructions and *which* operands, with distributions tuned to
//! surface bugs; correctness of encoding is gcc's problem.
//!
//! ## This increment's stimulus class: straight-line RV64IM
//! The body is pure register-to-register integer arithmetic — no loads, stores, branches,
//! or jumps. That is a deliberate, safe first slice:
//!   * Control flow always falls through to the halt epilogue (no runaway, no self-modify).
//!   * No memory traffic means the body can never clobber the `tohost` word, so the halt
//!     is guaranteed reachable and every generated program terminates.
//!   * It still exercises the highest-divergence-density corner of the ISA: `M`-extension
//!     division (div-by-zero → -1, signed overflow `INT_MIN/-1` → `INT_MIN`), `MULH*`
//!     signedness, `W`-suffix 32-bit sign-extension, and shift-amount masking — all
//!     spec-pinned, so a mismatch against Spike is a real bug, not a WARL choice.
//!
//! Loads/stores (bounded scratch), branches, and F/D/C are follow-on stimulus classes
//! (see the task log's deferred list); the generator is structured so they slot in as new
//! `Op` arms without touching the harness or minimizer.

use crate::rng::Rng;

/// The scratch register pool the body may read and write. Deliberately SMALL (7 registers)
/// to force operand aliasing and write-after-write hazards — the same physical register as
/// two sources, or as source and destination, is where accumulation/ordering bugs hide.
/// `x0` is excluded (writes discarded) and the halt epilogue owns `t0`/`t1` after the body,
/// so the body clobbering them is harmless.
const POOL: &[&str] = &["t0", "t1", "t2", "t3", "t4", "t5", "t6"];

/// An operand shape decides how a mnemonic's line is formatted.
#[derive(Clone, Copy)]
enum Shape {
    /// `op rd, rs1, rs2`
    R,
    /// `op rd, rs1, imm12` (12-bit signed immediate)
    I,
    /// `op rd, rs1, shamt` (shift-amount immediate)
    Shift { max: u32 },
    /// `op rd, imm20` (LUI/AUIPC 20-bit immediate)
    U,
}

/// One generatable instruction: its mnemonic, operand shape, and selection weight.
struct Op {
    mnemonic: &'static str,
    shape: Shape,
    weight: u32,
}

/// The RV64IM straight-line opcode menu with hand-tuned weights. `M`-extension ops carry
/// extra weight because their spec-defined corner cases (÷0, overflow, high-half
/// signedness) are the richest divergence sources and we want the smoke tier to hit them
/// densely.
const OPS: &[Op] = &[
    // RV64I register-register
    Op {
        mnemonic: "add",
        shape: Shape::R,
        weight: 3,
    },
    Op {
        mnemonic: "sub",
        shape: Shape::R,
        weight: 3,
    },
    Op {
        mnemonic: "and",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "or",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "xor",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "slt",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "sltu",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "sll",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "srl",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "sra",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "addw",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "subw",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "sllw",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "srlw",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "sraw",
        shape: Shape::R,
        weight: 2,
    },
    // RV64I register-immediate
    Op {
        mnemonic: "addi",
        shape: Shape::I,
        weight: 3,
    },
    Op {
        mnemonic: "andi",
        shape: Shape::I,
        weight: 2,
    },
    Op {
        mnemonic: "ori",
        shape: Shape::I,
        weight: 2,
    },
    Op {
        mnemonic: "xori",
        shape: Shape::I,
        weight: 2,
    },
    Op {
        mnemonic: "slti",
        shape: Shape::I,
        weight: 2,
    },
    Op {
        mnemonic: "sltiu",
        shape: Shape::I,
        weight: 2,
    },
    Op {
        mnemonic: "addiw",
        shape: Shape::I,
        weight: 2,
    },
    Op {
        mnemonic: "slli",
        shape: Shape::Shift { max: 64 },
        weight: 2,
    },
    Op {
        mnemonic: "srli",
        shape: Shape::Shift { max: 64 },
        weight: 2,
    },
    Op {
        mnemonic: "srai",
        shape: Shape::Shift { max: 64 },
        weight: 2,
    },
    Op {
        mnemonic: "slliw",
        shape: Shape::Shift { max: 32 },
        weight: 2,
    },
    Op {
        mnemonic: "srliw",
        shape: Shape::Shift { max: 32 },
        weight: 2,
    },
    Op {
        mnemonic: "sraiw",
        shape: Shape::Shift { max: 32 },
        weight: 2,
    },
    // U-type (deterministic: AUIPC is pc-relative but the layout is fixed per program)
    Op {
        mnemonic: "lui",
        shape: Shape::U,
        weight: 1,
    },
    Op {
        mnemonic: "auipc",
        shape: Shape::U,
        weight: 1,
    },
    // RV64M — weighted up for corner-case density
    Op {
        mnemonic: "mul",
        shape: Shape::R,
        weight: 3,
    },
    Op {
        mnemonic: "mulh",
        shape: Shape::R,
        weight: 3,
    },
    Op {
        mnemonic: "mulhu",
        shape: Shape::R,
        weight: 3,
    },
    Op {
        mnemonic: "mulhsu",
        shape: Shape::R,
        weight: 3,
    },
    Op {
        mnemonic: "div",
        shape: Shape::R,
        weight: 4,
    },
    Op {
        mnemonic: "divu",
        shape: Shape::R,
        weight: 4,
    },
    Op {
        mnemonic: "rem",
        shape: Shape::R,
        weight: 4,
    },
    Op {
        mnemonic: "remu",
        shape: Shape::R,
        weight: 4,
    },
    Op {
        mnemonic: "mulw",
        shape: Shape::R,
        weight: 2,
    },
    Op {
        mnemonic: "divw",
        shape: Shape::R,
        weight: 3,
    },
    Op {
        mnemonic: "divuw",
        shape: Shape::R,
        weight: 3,
    },
    Op {
        mnemonic: "remw",
        shape: Shape::R,
        weight: 3,
    },
    Op {
        mnemonic: "remuw",
        shape: Shape::R,
        weight: 3,
    },
];

/// A generated program: a fixed prologue that seeds the register pool, a body of random
/// instructions (the minimizable unit is one body line), and a fixed halt epilogue.
pub struct Program {
    pub seed: u64,
    /// `li` lines seeding each pool register with a biased constant.
    pub prologue: Vec<String>,
    /// The random instruction body — each entry is one `.S` line. The minimizer deletes
    /// entries from this vector.
    pub body: Vec<String>,
}

impl Program {
    /// Generate a program of `count` body instructions from `seed`.
    pub fn generate(seed: u64, count: usize) -> Program {
        let mut rng = Rng::new(seed);
        let prologue = POOL
            .iter()
            .map(|reg| format!("    li {reg}, {:#x}", rng.biased_imm()))
            .collect();
        let weights: Vec<u32> = OPS.iter().map(|o| o.weight).collect();
        let mut body = Vec::with_capacity(count);
        for _ in 0..count {
            let op = &OPS[rng.weighted(&weights)];
            body.push(format_line(op, &mut rng));
        }
        Program {
            seed,
            prologue,
            body,
        }
    }

    /// Render the full `.S` source for the current (possibly minimized) body. The layout —
    /// entry symbol, `.tohost` section, halt loop — matches what our loader and Spike both
    /// consume via the E0-T20 harness.
    pub fn render(&self) -> String {
        let mut s = String::new();
        s.push_str("# GENERATED by tools/fuzz (E1-T21) — do not edit by hand.\n");
        s.push_str(&format!(
            "# seed={:#x} body_len={}\n",
            self.seed,
            self.body.len()
        ));
        s.push_str(".section .text.init,\"ax\",@progbits\n");
        s.push_str(".globl rvtest_entry_point\n");
        s.push_str("rvtest_entry_point:\n");
        for line in &self.prologue {
            s.push_str(line);
            s.push('\n');
        }
        s.push_str("    # --- random body ---\n");
        for line in &self.body {
            s.push_str(line);
            s.push('\n');
        }
        s.push_str("    # --- halt: write 1 to tohost, then spin ---\n");
        s.push_str("    li t0, 1\n");
        s.push_str("    la t1, tohost\n");
        s.push_str("    sd t0, 0(t1)\n");
        s.push_str("1:  j 1b\n");
        s.push_str(".pushsection .tohost,\"aw\",@progbits\n");
        s.push_str(".align 8\n.globl tohost\ntohost: .dword 0\n");
        s.push_str(".globl fromhost\nfromhost: .dword 0\n");
        s.push_str(".popsection\n");
        s
    }
}

/// Format one instruction line for its shape, drawing operands from the pool and biased
/// immediate distribution.
fn format_line(op: &Op, rng: &mut Rng) -> String {
    let rd = rng.pick(POOL);
    match op.shape {
        Shape::R => {
            let rs1 = rng.pick(POOL);
            let rs2 = rng.pick(POOL);
            format!("    {} {rd}, {rs1}, {rs2}", op.mnemonic)
        }
        Shape::I => {
            let rs1 = rng.pick(POOL);
            // 12-bit signed immediate: take a biased draw, sign-contract to [-2048, 2047].
            let imm = (rng.biased_imm() as i64) << 52 >> 52;
            format!("    {} {rd}, {rs1}, {imm}", op.mnemonic)
        }
        Shape::Shift { max } => {
            let rs1 = rng.pick(POOL);
            // Bias shift amounts to the legal-range boundary and one past it is impossible
            // (assembler rejects), so clamp to [0, max-1]; max-1 is the interesting edge.
            let shamt = rng.below(max);
            format!("    {} {rd}, {rs1}, {shamt}", op.mnemonic)
        }
        Shape::U => {
            // 20-bit unsigned immediate for LUI/AUIPC.
            let imm = rng.below(1 << 20);
            format!("    {} {rd}, {imm}", op.mnemonic)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_is_reproducible() {
        let a = Program::generate(0xABCD, 200);
        let b = Program::generate(0xABCD, 200);
        assert_eq!(a.render(), b.render(), "same seed must render identically");
    }

    #[test]
    fn distinct_seeds_differ() {
        let a = Program::generate(1, 200);
        let b = Program::generate(2, 200);
        assert_ne!(a.render(), b.render());
    }

    #[test]
    fn body_length_matches_request() {
        let p = Program::generate(5, 137);
        assert_eq!(p.body.len(), 137);
    }

    #[test]
    fn render_has_entry_and_tohost() {
        let p = Program::generate(9, 10);
        let s = p.render();
        assert!(s.contains("rvtest_entry_point:"), "missing entry symbol");
        assert!(s.contains("tohost: .dword 0"), "missing tohost");
        assert!(s.contains("j 1b"), "missing halt spin");
    }

    #[test]
    fn shift_amounts_are_in_range() {
        // Every generated shift line must have a shamt < its width (assembler would reject
        // otherwise — this guards the generator, not gcc).
        for seed in 0..50u64 {
            let p = Program::generate(seed, 300);
            for line in &p.body {
                let t = line.trim();
                for (mn, max) in [
                    ("slli ", 64),
                    ("srli ", 64),
                    ("srai ", 64),
                    ("slliw ", 32),
                    ("srliw ", 32),
                    ("sraiw ", 32),
                ] {
                    if let Some(rest) = t.strip_prefix(mn) {
                        let shamt: u32 = rest.rsplit(',').next().unwrap().trim().parse().unwrap();
                        assert!(shamt < max, "line `{line}` shamt {shamt} >= {max}");
                    }
                }
            }
        }
    }

    #[test]
    fn i_type_immediates_fit_12_bits_signed() {
        for seed in 0..50u64 {
            let p = Program::generate(seed, 300);
            for line in &p.body {
                let t = line.trim();
                for mn in [
                    "addi ", "andi ", "ori ", "xori ", "slti ", "sltiu ", "addiw ",
                ] {
                    if let Some(rest) = t.strip_prefix(mn) {
                        let imm: i64 = rest.rsplit(',').next().unwrap().trim().parse().unwrap();
                        assert!(
                            (-2048..=2047).contains(&imm),
                            "line `{line}` imm {imm} out of i12"
                        );
                    }
                }
            }
        }
    }
}
