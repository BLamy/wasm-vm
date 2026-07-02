//! RV64I instruction decoder (E0-T06): a pure, allocation-free, never-panicking
//! `const fn decode(u32) -> Result<Instr, IllegalInstr>` covering all six base
//! encoding formats (R/I/S/B/U/J).
//!
//! References: Unprivileged ISA (20191213) §2.2 (formats), §2.3 (immediate variants —
//! B-type scramble `imm[12|10:5|4:1|11]`, J-type `imm[20|10:1|11|19:12]`), Ch. 5
//! (RV64I: LWU/LD/SD, `*W` ops, 6-bit shamt), Ch. 24 Table 24.1 (opcode map).
//!
//! Level-0 policy decisions (documented here, tested in the golden table):
//! - `insn[1:0] != 0b11` is compressed space → illegal (no C extension yet, E1-T08).
//! - FENCE decodes for ALL fm/pred/succ values (they are architecturally valid,
//!   including `fence.tso`); FENCE.I (funct3=001) is Zifencei → illegal at Level 0.
//! - SYSTEM: only the exact words ECALL (0x00000073) and EBREAK (0x00100073) decode;
//!   CSR space (funct3 != 0) and xRET/WFI encodings are illegal until E1.
//! - M-extension encodings (OP/OP-32 with funct7=0000001) are illegal until E1-T03.

/// The instruction word did not decode to a valid Level-0 RV64I instruction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IllegalInstr;

/// A decoded RV64I instruction. All immediates are sign-extended to `i64` at decode
/// time; register fields are 5-bit (0..=31) by construction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Instr {
    // ── U-type ──────────────────────────────────────────────────────────────
    Lui {
        rd: u8,
        imm: i64,
    },
    Auipc {
        rd: u8,
        imm: i64,
    },
    // ── J-type ──────────────────────────────────────────────────────────────
    Jal {
        rd: u8,
        imm: i64,
    },
    // ── I-type: jump ────────────────────────────────────────────────────────
    Jalr {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    // ── B-type ──────────────────────────────────────────────────────────────
    Beq {
        rs1: u8,
        rs2: u8,
        imm: i64,
    },
    Bne {
        rs1: u8,
        rs2: u8,
        imm: i64,
    },
    Blt {
        rs1: u8,
        rs2: u8,
        imm: i64,
    },
    Bge {
        rs1: u8,
        rs2: u8,
        imm: i64,
    },
    Bltu {
        rs1: u8,
        rs2: u8,
        imm: i64,
    },
    Bgeu {
        rs1: u8,
        rs2: u8,
        imm: i64,
    },
    // ── I-type: loads ───────────────────────────────────────────────────────
    Lb {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    Lh {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    Lw {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    Ld {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    Lbu {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    Lhu {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    Lwu {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    // ── S-type ──────────────────────────────────────────────────────────────
    Sb {
        rs1: u8,
        rs2: u8,
        imm: i64,
    },
    Sh {
        rs1: u8,
        rs2: u8,
        imm: i64,
    },
    Sw {
        rs1: u8,
        rs2: u8,
        imm: i64,
    },
    Sd {
        rs1: u8,
        rs2: u8,
        imm: i64,
    },
    // ── I-type: OP-IMM ──────────────────────────────────────────────────────
    Addi {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    Slti {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    Sltiu {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    Xori {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    Ori {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    Andi {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    /// RV64: shamt is 6 bits (`insn[25:20]`), 0..=63.
    Slli {
        rd: u8,
        rs1: u8,
        shamt: u8,
    },
    Srli {
        rd: u8,
        rs1: u8,
        shamt: u8,
    },
    Srai {
        rd: u8,
        rs1: u8,
        shamt: u8,
    },
    // ── R-type: OP ──────────────────────────────────────────────────────────
    Add {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Sub {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Sll {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Slt {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Sltu {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Xor {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Srl {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Sra {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Or {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    And {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    // ── OP-IMM-32 (RV64) ────────────────────────────────────────────────────
    Addiw {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    /// shamt is 5 bits; `insn[25] = 1` is illegal (checked in decode).
    Slliw {
        rd: u8,
        rs1: u8,
        shamt: u8,
    },
    Srliw {
        rd: u8,
        rs1: u8,
        shamt: u8,
    },
    Sraiw {
        rd: u8,
        rs1: u8,
        shamt: u8,
    },
    // ── OP-32 (RV64) ────────────────────────────────────────────────────────
    Addw {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Subw {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Sllw {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Srlw {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Sraw {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    // ── MISC-MEM / SYSTEM ───────────────────────────────────────────────────
    /// Fields preserved verbatim; all fm/pred/succ values are valid (incl. TSO).
    Fence {
        rd: u8,
        rs1: u8,
        fm: u8,
        pred: u8,
        succ: u8,
    },
    Ecall,
    Ebreak,
}

// ── field extractors (spec §2.2/§2.3 bit layouts) ───────────────────────────

const fn rd(i: u32) -> u8 {
    ((i >> 7) & 0x1F) as u8
}
const fn rs1(i: u32) -> u8 {
    ((i >> 15) & 0x1F) as u8
}
const fn rs2(i: u32) -> u8 {
    ((i >> 20) & 0x1F) as u8
}
const fn funct3(i: u32) -> u32 {
    (i >> 12) & 0x7
}
const fn funct7(i: u32) -> u32 {
    i >> 25
}

/// I-type: `imm[11:0] = insn[31:20]`, sign-extended.
const fn imm_i(i: u32) -> i64 {
    ((i as i32) >> 20) as i64
}

/// S-type: `imm[11:5] = insn[31:25]`, `imm[4:0] = insn[11:7]`.
const fn imm_s(i: u32) -> i64 {
    let hi = (i as i32) >> 25; // sign-extends imm[11:5]
    let lo = ((i >> 7) & 0x1F) as i32;
    ((hi << 5) | lo) as i64
}

/// B-type scramble: `imm[12] = insn[31]`, `imm[11] = insn[7]`,
/// `imm[10:5] = insn[30:25]`, `imm[4:1] = insn[11:8]`, `imm[0] = 0`.
const fn imm_b(i: u32) -> i64 {
    let sign = (i as i32) >> 31; // all-ones when imm[12] set
    let b11 = ((i >> 7) & 0x1) as i32;
    let b10_5 = ((i >> 25) & 0x3F) as i32;
    let b4_1 = ((i >> 8) & 0xF) as i32;
    ((sign << 12) | (b11 << 11) | (b10_5 << 5) | (b4_1 << 1)) as i64
}

/// U-type: `imm[31:12] = insn[31:12]`, low 12 bits zero, sign-extended to i64.
const fn imm_u(i: u32) -> i64 {
    (i & 0xFFFF_F000) as i32 as i64
}

/// J-type scramble: `imm[20] = insn[31]`, `imm[19:12] = insn[19:12]`,
/// `imm[11] = insn[20]`, `imm[10:1] = insn[30:21]`, `imm[0] = 0`.
const fn imm_j(i: u32) -> i64 {
    let sign = (i as i32) >> 31; // all-ones when imm[20] set
    let b19_12 = ((i >> 12) & 0xFF) as i32;
    let b11 = ((i >> 20) & 0x1) as i32;
    let b10_1 = ((i >> 21) & 0x3FF) as i32;
    ((sign << 20) | (b19_12 << 12) | (b11 << 11) | (b10_1 << 1)) as i64
}

/// Decode one 32-bit instruction word. Pure, allocation-free, never panics:
/// every match is closed with an `IllegalInstr` arm.
pub const fn decode(insn: u32) -> Result<Instr, IllegalInstr> {
    // Compressed space (C extension) is not implemented at Level 0.
    if insn & 0b11 != 0b11 {
        return Err(IllegalInstr);
    }
    let (d, s1, s2) = (rd(insn), rs1(insn), rs2(insn));
    match insn & 0x7F {
        0b0110111 => Ok(Instr::Lui {
            rd: d,
            imm: imm_u(insn),
        }),
        0b0010111 => Ok(Instr::Auipc {
            rd: d,
            imm: imm_u(insn),
        }),
        0b1101111 => Ok(Instr::Jal {
            rd: d,
            imm: imm_j(insn),
        }),
        0b1100111 => match funct3(insn) {
            0b000 => Ok(Instr::Jalr {
                rd: d,
                rs1: s1,
                imm: imm_i(insn),
            }),
            _ => Err(IllegalInstr),
        },
        0b1100011 => {
            let imm = imm_b(insn);
            match funct3(insn) {
                0b000 => Ok(Instr::Beq {
                    rs1: s1,
                    rs2: s2,
                    imm,
                }),
                0b001 => Ok(Instr::Bne {
                    rs1: s1,
                    rs2: s2,
                    imm,
                }),
                0b100 => Ok(Instr::Blt {
                    rs1: s1,
                    rs2: s2,
                    imm,
                }),
                0b101 => Ok(Instr::Bge {
                    rs1: s1,
                    rs2: s2,
                    imm,
                }),
                0b110 => Ok(Instr::Bltu {
                    rs1: s1,
                    rs2: s2,
                    imm,
                }),
                0b111 => Ok(Instr::Bgeu {
                    rs1: s1,
                    rs2: s2,
                    imm,
                }),
                _ => Err(IllegalInstr),
            }
        }
        0b0000011 => {
            let imm = imm_i(insn);
            match funct3(insn) {
                0b000 => Ok(Instr::Lb {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b001 => Ok(Instr::Lh {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b010 => Ok(Instr::Lw {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b011 => Ok(Instr::Ld {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b100 => Ok(Instr::Lbu {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b101 => Ok(Instr::Lhu {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b110 => Ok(Instr::Lwu {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                _ => Err(IllegalInstr),
            }
        }
        0b0100011 => {
            let imm = imm_s(insn);
            match funct3(insn) {
                0b000 => Ok(Instr::Sb {
                    rs1: s1,
                    rs2: s2,
                    imm,
                }),
                0b001 => Ok(Instr::Sh {
                    rs1: s1,
                    rs2: s2,
                    imm,
                }),
                0b010 => Ok(Instr::Sw {
                    rs1: s1,
                    rs2: s2,
                    imm,
                }),
                0b011 => Ok(Instr::Sd {
                    rs1: s1,
                    rs2: s2,
                    imm,
                }),
                _ => Err(IllegalInstr),
            }
        }
        0b0010011 => {
            let imm = imm_i(insn);
            // RV64 shift-immediates use a 6-bit shamt: insn[25:20]; insn[31:26]
            // selects the operation and anything unassigned is illegal.
            let shamt6 = ((insn >> 20) & 0x3F) as u8;
            let top6 = insn >> 26;
            match funct3(insn) {
                0b000 => Ok(Instr::Addi {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b010 => Ok(Instr::Slti {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b011 => Ok(Instr::Sltiu {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b100 => Ok(Instr::Xori {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b110 => Ok(Instr::Ori {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b111 => Ok(Instr::Andi {
                    rd: d,
                    rs1: s1,
                    imm,
                }),
                0b001 => match top6 {
                    0b000000 => Ok(Instr::Slli {
                        rd: d,
                        rs1: s1,
                        shamt: shamt6,
                    }),
                    _ => Err(IllegalInstr),
                },
                0b101 => match top6 {
                    0b000000 => Ok(Instr::Srli {
                        rd: d,
                        rs1: s1,
                        shamt: shamt6,
                    }),
                    0b010000 => Ok(Instr::Srai {
                        rd: d,
                        rs1: s1,
                        shamt: shamt6,
                    }),
                    _ => Err(IllegalInstr),
                },
                _ => Err(IllegalInstr),
            }
        }
        0b0110011 => match (funct7(insn), funct3(insn)) {
            (0b0000000, 0b000) => Ok(Instr::Add {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0100000, 0b000) => Ok(Instr::Sub {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000000, 0b001) => Ok(Instr::Sll {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000000, 0b010) => Ok(Instr::Slt {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000000, 0b011) => Ok(Instr::Sltu {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000000, 0b100) => Ok(Instr::Xor {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000000, 0b101) => Ok(Instr::Srl {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0100000, 0b101) => Ok(Instr::Sra {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000000, 0b110) => Ok(Instr::Or {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000000, 0b111) => Ok(Instr::And {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            _ => Err(IllegalInstr), // incl. M-extension funct7=0000001 (E1-T03)
        },
        0b0011011 => {
            // OP-IMM-32: 5-bit shamt; insn[25] = 1 is architecturally illegal.
            let shamt5 = ((insn >> 20) & 0x1F) as u8;
            match (funct7(insn), funct3(insn)) {
                (_, 0b000) => Ok(Instr::Addiw {
                    rd: d,
                    rs1: s1,
                    imm: imm_i(insn),
                }),
                (0b0000000, 0b001) => Ok(Instr::Slliw {
                    rd: d,
                    rs1: s1,
                    shamt: shamt5,
                }),
                (0b0000000, 0b101) => Ok(Instr::Srliw {
                    rd: d,
                    rs1: s1,
                    shamt: shamt5,
                }),
                (0b0100000, 0b101) => Ok(Instr::Sraiw {
                    rd: d,
                    rs1: s1,
                    shamt: shamt5,
                }),
                _ => Err(IllegalInstr),
            }
        }
        0b0111011 => match (funct7(insn), funct3(insn)) {
            (0b0000000, 0b000) => Ok(Instr::Addw {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0100000, 0b000) => Ok(Instr::Subw {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000000, 0b001) => Ok(Instr::Sllw {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000000, 0b101) => Ok(Instr::Srlw {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0100000, 0b101) => Ok(Instr::Sraw {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            _ => Err(IllegalInstr),
        },
        0b0001111 => match funct3(insn) {
            // FENCE: fields preserved; every fm/pred/succ combination is valid.
            0b000 => Ok(Instr::Fence {
                rd: d,
                rs1: s1,
                fm: ((insn >> 28) & 0xF) as u8,
                pred: ((insn >> 24) & 0xF) as u8,
                succ: ((insn >> 20) & 0xF) as u8,
            }),
            // funct3=001 is FENCE.I (Zifencei) — illegal at Level 0.
            _ => Err(IllegalInstr),
        },
        0b1110011 => match insn {
            0x0000_0073 => Ok(Instr::Ecall),
            0x0010_0073 => Ok(Instr::Ebreak),
            // CSR space, xRET, WFI etc. arrive with E1 (Zicsr / privilege).
            _ => Err(IllegalInstr),
        },
        _ => Err(IllegalInstr),
    }
}
