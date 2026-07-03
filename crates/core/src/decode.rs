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
//! - M-extension encodings (OP/OP-32 with funct7=0000001) decode as of E1-T03; unlike Zicsr
//!   they are NOT gated on `zicsr-stub` (the rv64ui-p path never executes M ops, so decoding
//!   them as legal there is inert).

/// The instruction word did not decode to a valid Level-0 RV64I instruction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IllegalInstr;

/// The read-modify-write operation of an AMO instruction (A extension, E1-T04). The
/// funct5 selector; the width (W/D) is carried by the `AmoW`/`AmoD` [`Instr`] variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AmoOp {
    Swap,
    Add,
    Xor,
    And,
    Or,
    Min,
    Max,
    Minu,
    Maxu,
}

/// Two-operand single-precision arithmetic (OP-FP), E1-T06.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FpArithOp {
    Add,
    Sub,
    Mul,
    Div,
}
/// Fused multiply-add family (MADD/MSUB/NMSUB/NMADD opcodes), E1-T06.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FpFusedOp {
    /// `+(rs1*rs2)+rs3`
    Madd,
    /// `+(rs1*rs2)-rs3`
    Msub,
    /// `-(rs1*rs2)+rs3`
    Nmsub,
    /// `-(rs1*rs2)-rs3`
    Nmadd,
}
/// Sign-injection variant (FSGNJ/FSGNJN/FSGNJX), E1-T06.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FpSgnjOp {
    /// take rs2's sign
    J,
    /// take ¬rs2's sign
    Jn,
    /// xor the signs
    Jx,
}
/// Ordered FP comparison writing an integer 0/1 (FLE/FLT/FEQ), E1-T06.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FpCmpOp {
    Le,
    Lt,
    Eq,
}
/// Integer width for float↔int conversions (`.W/.WU/.L/.LU`), E1-T06.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FpIntWidth {
    /// signed 32-bit
    W,
    /// unsigned 32-bit
    Wu,
    /// signed 64-bit
    L,
    /// unsigned 64-bit
    Lu,
}

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
    // ── M extension: OP (RV64M, funct7=0000001) ─────────────────────────────
    Mul {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Mulh {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Mulhsu {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Mulhu {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Div {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Divu {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Rem {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Remu {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    // ── M extension: OP-32 (RV64M *W forms, funct7=0000001) ──────────────────
    Mulw {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Divw {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Divuw {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Remw {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    Remuw {
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    // ── A extension (AMO opcode 0b0101111), E1-T04 ──────────────────────────
    // `aq`/`rl` are decoded and preserved for the Epic 6 SMP future; they are no-ops
    // for a single in-order hart. All four aq/rl combinations are legal.
    /// Load-reserved word/doubleword: `rd = sext(mem[rs1])`, sets the reservation.
    LrW {
        rd: u8,
        rs1: u8,
        aq: bool,
        rl: bool,
    },
    LrD {
        rd: u8,
        rs1: u8,
        aq: bool,
        rl: bool,
    },
    /// Store-conditional: `rd = 0` and store on a valid reservation, else `rd = 1`.
    ScW {
        rd: u8,
        rs1: u8,
        rs2: u8,
        aq: bool,
        rl: bool,
    },
    ScD {
        rd: u8,
        rs1: u8,
        rs2: u8,
        aq: bool,
        rl: bool,
    },
    /// Atomic memory operation word/doubleword: `rd = sext(old); mem[rs1] = op(old, rs2)`.
    AmoW {
        op: AmoOp,
        rd: u8,
        rs1: u8,
        rs2: u8,
        aq: bool,
        rl: bool,
    },
    AmoD {
        op: AmoOp,
        rd: u8,
        rs1: u8,
        rs2: u8,
        aq: bool,
        rl: bool,
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
    // ── Zicsr + Zifencei + xRET (E1-T02) ────────────────────────────────────
    /// Instruction-fetch fence (Zifencei) — a no-op for an in-order interpreter, but it
    /// must decode and retire.
    FenceI,
    /// `rd = csr; csr = rs1` (read side effect suppressed when `rd == x0`).
    Csrrw {
        rd: u8,
        rs1: u8,
        csr: u16,
    },
    /// `rd = csr; csr |= rs1` (write suppressed when `rs1 == x0`).
    Csrrs {
        rd: u8,
        rs1: u8,
        csr: u16,
    },
    /// `rd = csr; csr &= ~rs1` (write suppressed when `rs1 == x0`).
    Csrrc {
        rd: u8,
        rs1: u8,
        csr: u16,
    },
    /// Immediate forms: `uimm` is the 5-bit zero-extended `insn[19:15]`.
    Csrrwi {
        rd: u8,
        uimm: u8,
        csr: u16,
    },
    Csrrsi {
        rd: u8,
        uimm: u8,
        csr: u16,
    },
    Csrrci {
        rd: u8,
        uimm: u8,
        csr: u16,
    },
    /// Return from M-mode trap (`pc = mepc`).
    Mret,
    /// Wait-for-interrupt — retires as a no-op here.
    Wfi,
    // ── F extension (single precision), E1-T06 ──────────────────────────────
    /// `f[rd] = mem[rs1+imm]` (32-bit load, NaN-boxed into the f-register).
    Flw {
        rd: u8,
        rs1: u8,
        imm: i64,
    },
    /// `mem[rs1+imm] = f[rs2]` (low 32 bits).
    Fsw {
        rs1: u8,
        rs2: u8,
        imm: i64,
    },
    /// FADD/FSUB/FMUL/FDIV.S. `rm` is the raw 3-bit field (validated at execution).
    FpArithS {
        op: FpArithOp,
        rd: u8,
        rs1: u8,
        rs2: u8,
        rm: u8,
    },
    FsqrtS {
        rd: u8,
        rs1: u8,
        rm: u8,
    },
    /// FMADD/FMSUB/FNMSUB/FNMADD.S.
    FpFusedS {
        op: FpFusedOp,
        rd: u8,
        rs1: u8,
        rs2: u8,
        rs3: u8,
        rm: u8,
    },
    /// FSGNJ[N,X].S — pure bit ops, no flags.
    FsgnjS {
        op: FpSgnjOp,
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    /// FMIN.S / FMAX.S.
    FminmaxS {
        is_max: bool,
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    /// FEQ/FLT/FLE.S — result is written to integer register `rd`.
    FpCmpS {
        op: FpCmpOp,
        rd: u8,
        rs1: u8,
        rs2: u8,
    },
    /// FCLASS.S — 10-bit class mask to integer register `rd`.
    FclassS {
        rd: u8,
        rs1: u8,
    },
    /// FMV.X.W — bit-move f→x (sign-extends bit 31).
    FmvXW {
        rd: u8,
        rs1: u8,
    },
    /// FMV.W.X — bit-move x→f (NaN-boxed).
    FmvWX {
        rd: u8,
        rs1: u8,
    },
    /// FCVT.{W,WU,L,LU}.S — float → integer register `rd`.
    FcvtToIntS {
        width: FpIntWidth,
        rd: u8,
        rs1: u8,
        rm: u8,
    },
    /// FCVT.S.{W,WU,L,LU} — integer register `rs1` → float `rd`.
    FcvtFromIntS {
        width: FpIntWidth,
        rd: u8,
        rs1: u8,
        rm: u8,
    },
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

/// SYSTEM (opcode `0b1110011`): ECALL/EBREAK always; the Zicsr CSR ops, MRET, and WFI are
/// decoded only when the throwaway `zicsr-stub` is OFF — E0-T19's rv64ui-p path routes CSR
/// space through the stub, so decode must keep returning `IllegalInstr` there.
const fn decode_system(insn: u32) -> Result<Instr, IllegalInstr> {
    match insn {
        0x0000_0073 => return Ok(Instr::Ecall),
        0x0010_0073 => return Ok(Instr::Ebreak),
        _ => {}
    }
    #[cfg(feature = "zicsr-stub")]
    {
        Err(IllegalInstr)
    }
    #[cfg(not(feature = "zicsr-stub"))]
    {
        if insn == 0x3020_0073 {
            return Ok(Instr::Mret);
        }
        if insn == 0x1050_0073 {
            return Ok(Instr::Wfi);
        }
        let rd = ((insn >> 7) & 0x1F) as u8;
        let rs1 = ((insn >> 15) & 0x1F) as u8;
        let csr = ((insn >> 20) & 0xFFF) as u16;
        match funct3(insn) {
            0b001 => Ok(Instr::Csrrw { rd, rs1, csr }),
            0b010 => Ok(Instr::Csrrs { rd, rs1, csr }),
            0b011 => Ok(Instr::Csrrc { rd, rs1, csr }),
            0b101 => Ok(Instr::Csrrwi { rd, uimm: rs1, csr }),
            0b110 => Ok(Instr::Csrrsi { rd, uimm: rs1, csr }),
            0b111 => Ok(Instr::Csrrci { rd, uimm: rs1, csr }),
            // funct3 = 000 (non-ecall/ebreak/mret/wfi) or 100 is reserved.
            _ => Err(IllegalInstr),
        }
    }
}
const fn funct7(i: u32) -> u32 {
    i >> 25
}

/// AMO opcode (`0b0101111`), A extension (E1-T04). funct3 selects width (010=W, 011=D);
/// funct5 (`insn[31:27]`) selects the op; `aq=insn[26]`, `rl=insn[25]`. LR's rs2 field is
/// reserved and must be zero (a nonzero rs2 is illegal — keeps decode injective). Every
/// aq/rl combination is legal (including aq=rl=1).
const fn decode_amo(insn: u32) -> Result<Instr, IllegalInstr> {
    let is_d = match funct3(insn) {
        0b010 => false,
        0b011 => true,
        _ => return Err(IllegalInstr),
    };
    let funct5 = insn >> 27;
    let aq = (insn >> 26) & 1 == 1;
    let rl = (insn >> 25) & 1 == 1;
    let (rd, rs1, rs2) = (rd(insn), rs1(insn), rs2(insn));
    match funct5 {
        // LR: rs2 is a reserved field, must be zero.
        0b00010 => {
            if rs2 != 0 {
                return Err(IllegalInstr);
            }
            if is_d {
                Ok(Instr::LrD { rd, rs1, aq, rl })
            } else {
                Ok(Instr::LrW { rd, rs1, aq, rl })
            }
        }
        0b00011 => {
            if is_d {
                Ok(Instr::ScD {
                    rd,
                    rs1,
                    rs2,
                    aq,
                    rl,
                })
            } else {
                Ok(Instr::ScW {
                    rd,
                    rs1,
                    rs2,
                    aq,
                    rl,
                })
            }
        }
        _ => {
            let op = match funct5 {
                0b00001 => AmoOp::Swap,
                0b00000 => AmoOp::Add,
                0b00100 => AmoOp::Xor,
                0b01100 => AmoOp::And,
                0b01000 => AmoOp::Or,
                0b10000 => AmoOp::Min,
                0b10100 => AmoOp::Max,
                0b11000 => AmoOp::Minu,
                0b11100 => AmoOp::Maxu,
                _ => return Err(IllegalInstr),
            };
            if is_d {
                Ok(Instr::AmoD {
                    op,
                    rd,
                    rs1,
                    rs2,
                    aq,
                    rl,
                })
            } else {
                Ok(Instr::AmoW {
                    op,
                    rd,
                    rs1,
                    rs2,
                    aq,
                    rl,
                })
            }
        }
    }
}

/// OP-FP (`0b1010011`), single-precision F extension (E1-T06). `funct7` selects the op;
/// `funct3` is the rounding mode for arithmetic/convert ops (any of the 8 values decodes —
/// a reserved mode traps at *execution*), or an op selector for sign-inject/min-max/compare/
/// move/classify. `rs2 == 0` is required for FSQRT and the move/classify/convert-to-int ops.
const fn decode_op_fp(insn: u32) -> Result<Instr, IllegalInstr> {
    let rd = ((insn >> 7) & 0x1F) as u8;
    let rs1 = ((insn >> 15) & 0x1F) as u8;
    let rs2 = ((insn >> 20) & 0x1F) as u8;
    let f3 = funct3(insn);
    let rm = f3 as u8;
    match funct7(insn) {
        0b0000000 => Ok(Instr::FpArithS {
            op: FpArithOp::Add,
            rd,
            rs1,
            rs2,
            rm,
        }),
        0b0000100 => Ok(Instr::FpArithS {
            op: FpArithOp::Sub,
            rd,
            rs1,
            rs2,
            rm,
        }),
        0b0001000 => Ok(Instr::FpArithS {
            op: FpArithOp::Mul,
            rd,
            rs1,
            rs2,
            rm,
        }),
        0b0001100 => Ok(Instr::FpArithS {
            op: FpArithOp::Div,
            rd,
            rs1,
            rs2,
            rm,
        }),
        0b0101100 => {
            if rs2 == 0 {
                Ok(Instr::FsqrtS { rd, rs1, rm })
            } else {
                Err(IllegalInstr)
            }
        }
        0b0010000 => match f3 {
            0b000 => Ok(Instr::FsgnjS {
                op: FpSgnjOp::J,
                rd,
                rs1,
                rs2,
            }),
            0b001 => Ok(Instr::FsgnjS {
                op: FpSgnjOp::Jn,
                rd,
                rs1,
                rs2,
            }),
            0b010 => Ok(Instr::FsgnjS {
                op: FpSgnjOp::Jx,
                rd,
                rs1,
                rs2,
            }),
            _ => Err(IllegalInstr),
        },
        0b0010100 => match f3 {
            0b000 => Ok(Instr::FminmaxS {
                is_max: false,
                rd,
                rs1,
                rs2,
            }),
            0b001 => Ok(Instr::FminmaxS {
                is_max: true,
                rd,
                rs1,
                rs2,
            }),
            _ => Err(IllegalInstr),
        },
        0b1010000 => match f3 {
            0b000 => Ok(Instr::FpCmpS {
                op: FpCmpOp::Le,
                rd,
                rs1,
                rs2,
            }),
            0b001 => Ok(Instr::FpCmpS {
                op: FpCmpOp::Lt,
                rd,
                rs1,
                rs2,
            }),
            0b010 => Ok(Instr::FpCmpS {
                op: FpCmpOp::Eq,
                rd,
                rs1,
                rs2,
            }),
            _ => Err(IllegalInstr),
        },
        0b1100000 => match rs2 {
            0 => Ok(Instr::FcvtToIntS {
                width: FpIntWidth::W,
                rd,
                rs1,
                rm,
            }),
            1 => Ok(Instr::FcvtToIntS {
                width: FpIntWidth::Wu,
                rd,
                rs1,
                rm,
            }),
            2 => Ok(Instr::FcvtToIntS {
                width: FpIntWidth::L,
                rd,
                rs1,
                rm,
            }),
            3 => Ok(Instr::FcvtToIntS {
                width: FpIntWidth::Lu,
                rd,
                rs1,
                rm,
            }),
            _ => Err(IllegalInstr),
        },
        0b1101000 => match rs2 {
            0 => Ok(Instr::FcvtFromIntS {
                width: FpIntWidth::W,
                rd,
                rs1,
                rm,
            }),
            1 => Ok(Instr::FcvtFromIntS {
                width: FpIntWidth::Wu,
                rd,
                rs1,
                rm,
            }),
            2 => Ok(Instr::FcvtFromIntS {
                width: FpIntWidth::L,
                rd,
                rs1,
                rm,
            }),
            3 => Ok(Instr::FcvtFromIntS {
                width: FpIntWidth::Lu,
                rd,
                rs1,
                rm,
            }),
            _ => Err(IllegalInstr),
        },
        0b1110000 => match f3 {
            0b000 if rs2 == 0 => Ok(Instr::FmvXW { rd, rs1 }),
            0b001 if rs2 == 0 => Ok(Instr::FclassS { rd, rs1 }),
            _ => Err(IllegalInstr),
        },
        0b1111000 => {
            if f3 == 0b000 && rs2 == 0 {
                Ok(Instr::FmvWX { rd, rs1 })
            } else {
                Err(IllegalInstr)
            }
        }
        _ => Err(IllegalInstr),
    }
}

/// A fused multiply-add opcode (MADD/MSUB/NMSUB/NMADD). `fmt = insn[26:25]` selects the
/// format; `00` = single-precision (E1-T06), `01` = double (E1-T07), else illegal.
const fn decode_fused(insn: u32, op: FpFusedOp) -> Result<Instr, IllegalInstr> {
    if (insn >> 25) & 0b11 != 0b00 {
        return Err(IllegalInstr);
    }
    Ok(Instr::FpFusedS {
        op,
        rd: ((insn >> 7) & 0x1F) as u8,
        rs1: ((insn >> 15) & 0x1F) as u8,
        rs2: ((insn >> 20) & 0x1F) as u8,
        rs3: ((insn >> 27) & 0x1F) as u8,
        rm: ((insn >> 12) & 0x7) as u8,
    })
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
            // M extension (funct7 = 0000001): MUL/MULH/MULHSU/MULHU/DIV/DIVU/REM/REMU.
            (0b0000001, 0b000) => Ok(Instr::Mul {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000001, 0b001) => Ok(Instr::Mulh {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000001, 0b010) => Ok(Instr::Mulhsu {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000001, 0b011) => Ok(Instr::Mulhu {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000001, 0b100) => Ok(Instr::Div {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000001, 0b101) => Ok(Instr::Divu {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000001, 0b110) => Ok(Instr::Rem {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000001, 0b111) => Ok(Instr::Remu {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            _ => Err(IllegalInstr),
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
            // M extension *W forms (funct7 = 0000001): funct3 001/010/011 are reserved.
            (0b0000001, 0b000) => Ok(Instr::Mulw {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000001, 0b100) => Ok(Instr::Divw {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000001, 0b101) => Ok(Instr::Divuw {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000001, 0b110) => Ok(Instr::Remw {
                rd: d,
                rs1: s1,
                rs2: s2,
            }),
            (0b0000001, 0b111) => Ok(Instr::Remuw {
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
            // funct3=001 is FENCE.I (Zifencei) — only the canonical encoding (rd=rs1=imm=0,
            // i.e. exactly 0x0000_100F); its fields are reserved-zero, so a nonzero variant
            // stays illegal (keeps decode injective for the round-trip oracle). Decoded by
            // the real Zicsr subsystem (E1-T02); under the throwaway `zicsr-stub` (E0-T19
            // rv64ui-p path) it stays illegal, matching that suite's documented fence_i skip.
            #[cfg(not(feature = "zicsr-stub"))]
            0b001 if insn == 0x0000_100F => Ok(Instr::FenceI),
            _ => Err(IllegalInstr),
        },
        0b0101111 => decode_amo(insn),
        // F extension (E1-T06). LOAD-FP/STORE-FP funct3=010 is the single-precision width
        // (011 = double, E1-T07).
        0b0000111 => match funct3(insn) {
            0b010 => Ok(Instr::Flw {
                rd: d,
                rs1: s1,
                imm: imm_i(insn),
            }),
            _ => Err(IllegalInstr),
        },
        0b0100111 => match funct3(insn) {
            0b010 => Ok(Instr::Fsw {
                rs1: s1,
                rs2: s2,
                imm: imm_s(insn),
            }),
            _ => Err(IllegalInstr),
        },
        0b1010011 => decode_op_fp(insn),
        0b1000011 => decode_fused(insn, FpFusedOp::Madd),
        0b1000111 => decode_fused(insn, FpFusedOp::Msub),
        0b1001011 => decode_fused(insn, FpFusedOp::Nmsub),
        0b1001111 => decode_fused(insn, FpFusedOp::Nmadd),
        0b1110011 => decode_system(insn),
        _ => Err(IllegalInstr),
    }
}
