//! E0-T21: property tests for the decoder. Two independent oracles:
//!   1. an `encode(&Instr) -> u32` assembler written FROM THE SPEC (Unprivileged ISA
//!      §2.2–2.3, Ch. 24), never from decode.rs — so `encode(decode(w)) == w` on legal
//!      words is a genuine cross-check, not a tautology;
//!   2. reserved-encoding strategies asserting `decode` returns `IllegalInstr`.
//!
//! Configured for 10,000 cases per strategy (committed, not the default 256).
#![cfg(not(target_arch = "wasm32"))]

use proptest::prelude::*;
use wasm_vm_core::decode::{
    AmoOp, FpArithOp, FpCmpOp, FpFusedOp, FpIntWidth, FpSgnjOp, Instr, decode,
};

fn opfp(funct7: u32, funct3: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (funct7 << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (funct3 << 12)
        | ((rd as u32) << 7)
        | 0b1010011
}
fn fused(opcode: u32, rs3: u8, rs2: u8, rs1: u8, rm: u32, rd: u8) -> u32 {
    ((rs3 as u32) << 27)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (rm << 12)
        | ((rd as u32) << 7)
        | opcode // fmt (bits 26:25) = 00 for single
}
fn cvt_idx(w: FpIntWidth) -> u8 {
    match w {
        FpIntWidth::W => 0,
        FpIntWidth::Wu => 1,
        FpIntWidth::L => 2,
        FpIntWidth::Lu => 3,
    }
}

// ── independent encoder (spec-derived; the round-trip oracle) ─────────────────

fn r(op: u32, f3: u32, f7: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (f7 << 25) | ((rs2 as u32) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn i_enc(op: u32, f3: u32, rd: u8, rs1: u8, imm: i64) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn s_enc(op: u32, f3: u32, rs1: u8, rs2: u8, imm: i64) -> u32 {
    let u = imm as u32;
    (((u >> 5) & 0x7F) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((u & 0x1F) << 7)
        | op
}
fn b_enc(op: u32, f3: u32, rs1: u8, rs2: u8, imm: i64) -> u32 {
    let u = imm as u32;
    (((u >> 12) & 1) << 31)
        | (((u >> 5) & 0x3F) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | (((u >> 1) & 0xF) << 8)
        | (((u >> 11) & 1) << 7)
        | op
}
fn u_enc(op: u32, rd: u8, imm: i64) -> u32 {
    (((imm >> 12) as u32) & 0xFFFFF) << 12 | ((rd as u32) << 7) | op
}
fn j_enc(op: u32, rd: u8, imm: i64) -> u32 {
    let u = imm as u32;
    (((u >> 20) & 1) << 31)
        | (((u >> 1) & 0x3FF) << 21)
        | (((u >> 11) & 1) << 20)
        | (((u >> 12) & 0xFF) << 12)
        | ((rd as u32) << 7)
        | op
}
fn shift(op: u32, f3: u32, f6or7_hi: u32, rd: u8, rs1: u8, shamt: u8) -> u32 {
    // op-imm shifts: insn[31:26]=f6, shamt[5:0]. op-imm-32 shifts: insn[31:25]=f7,
    // shamt[4:0]. `f6or7_hi` is the pre-positioned high field, `shamt` already masked.
    f6or7_hi | ((shamt as u32) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}

fn amo_word(funct5: u32, aq: bool, rl: bool, funct3: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (funct5 << 27)
        | ((aq as u32) << 26)
        | ((rl as u32) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (funct3 << 12)
        | ((rd as u32) << 7)
        | 0b0101111
}
fn amo_funct5(op: AmoOp) -> u32 {
    match op {
        AmoOp::Swap => 0b00001,
        AmoOp::Add => 0b00000,
        AmoOp::Xor => 0b00100,
        AmoOp::And => 0b01100,
        AmoOp::Or => 0b01000,
        AmoOp::Min => 0b10000,
        AmoOp::Max => 0b10100,
        AmoOp::Minu => 0b11000,
        AmoOp::Maxu => 0b11100,
    }
}

fn csr_word(f3: u32, rd: u8, rs1_or_uimm: u8, csr: u16) -> u32 {
    ((csr as u32) << 20)
        | ((rs1_or_uimm as u32) << 15)
        | (f3 << 12)
        | ((rd as u32) << 7)
        | 0b1110011
}

/// Reassemble the exact 32-bit word for a decoded instruction. Any bit decode dropped or
/// misplaced makes this differ from the input word.
fn encode(instr: &Instr) -> u32 {
    use Instr::*;
    const OPIMM: u32 = 0b0010011;
    const OP: u32 = 0b0110011;
    const OPIMM32: u32 = 0b0011011;
    const OP32: u32 = 0b0111011;
    match *instr {
        Lui { rd, imm } => u_enc(0b0110111, rd, imm),
        Auipc { rd, imm } => u_enc(0b0010111, rd, imm),
        Jal { rd, imm } => j_enc(0b1101111, rd, imm),
        Jalr { rd, rs1, imm } => i_enc(0b1100111, 0b000, rd, rs1, imm),
        Beq { rs1, rs2, imm } => b_enc(0b1100011, 0b000, rs1, rs2, imm),
        Bne { rs1, rs2, imm } => b_enc(0b1100011, 0b001, rs1, rs2, imm),
        Blt { rs1, rs2, imm } => b_enc(0b1100011, 0b100, rs1, rs2, imm),
        Bge { rs1, rs2, imm } => b_enc(0b1100011, 0b101, rs1, rs2, imm),
        Bltu { rs1, rs2, imm } => b_enc(0b1100011, 0b110, rs1, rs2, imm),
        Bgeu { rs1, rs2, imm } => b_enc(0b1100011, 0b111, rs1, rs2, imm),
        Lb { rd, rs1, imm } => i_enc(0b0000011, 0b000, rd, rs1, imm),
        Lh { rd, rs1, imm } => i_enc(0b0000011, 0b001, rd, rs1, imm),
        Lw { rd, rs1, imm } => i_enc(0b0000011, 0b010, rd, rs1, imm),
        Ld { rd, rs1, imm } => i_enc(0b0000011, 0b011, rd, rs1, imm),
        Lbu { rd, rs1, imm } => i_enc(0b0000011, 0b100, rd, rs1, imm),
        Lhu { rd, rs1, imm } => i_enc(0b0000011, 0b101, rd, rs1, imm),
        Lwu { rd, rs1, imm } => i_enc(0b0000011, 0b110, rd, rs1, imm),
        Sb { rs1, rs2, imm } => s_enc(0b0100011, 0b000, rs1, rs2, imm),
        Sh { rs1, rs2, imm } => s_enc(0b0100011, 0b001, rs1, rs2, imm),
        Sw { rs1, rs2, imm } => s_enc(0b0100011, 0b010, rs1, rs2, imm),
        Sd { rs1, rs2, imm } => s_enc(0b0100011, 0b011, rs1, rs2, imm),
        Addi { rd, rs1, imm } => i_enc(OPIMM, 0b000, rd, rs1, imm),
        Slti { rd, rs1, imm } => i_enc(OPIMM, 0b010, rd, rs1, imm),
        Sltiu { rd, rs1, imm } => i_enc(OPIMM, 0b011, rd, rs1, imm),
        Xori { rd, rs1, imm } => i_enc(OPIMM, 0b100, rd, rs1, imm),
        Ori { rd, rs1, imm } => i_enc(OPIMM, 0b110, rd, rs1, imm),
        Andi { rd, rs1, imm } => i_enc(OPIMM, 0b111, rd, rs1, imm),
        Slli { rd, rs1, shamt } => shift(OPIMM, 0b001, 0, rd, rs1, shamt),
        Srli { rd, rs1, shamt } => shift(OPIMM, 0b101, 0, rd, rs1, shamt),
        Srai { rd, rs1, shamt } => shift(OPIMM, 0b101, 0b010000 << 26, rd, rs1, shamt),
        Add { rd, rs1, rs2 } => r(OP, 0b000, 0, rd, rs1, rs2),
        Sub { rd, rs1, rs2 } => r(OP, 0b000, 0b0100000, rd, rs1, rs2),
        Sll { rd, rs1, rs2 } => r(OP, 0b001, 0, rd, rs1, rs2),
        Slt { rd, rs1, rs2 } => r(OP, 0b010, 0, rd, rs1, rs2),
        Sltu { rd, rs1, rs2 } => r(OP, 0b011, 0, rd, rs1, rs2),
        Xor { rd, rs1, rs2 } => r(OP, 0b100, 0, rd, rs1, rs2),
        Srl { rd, rs1, rs2 } => r(OP, 0b101, 0, rd, rs1, rs2),
        Sra { rd, rs1, rs2 } => r(OP, 0b101, 0b0100000, rd, rs1, rs2),
        Or { rd, rs1, rs2 } => r(OP, 0b110, 0, rd, rs1, rs2),
        And { rd, rs1, rs2 } => r(OP, 0b111, 0, rd, rs1, rs2),
        Addiw { rd, rs1, imm } => i_enc(OPIMM32, 0b000, rd, rs1, imm),
        Slliw { rd, rs1, shamt } => shift(OPIMM32, 0b001, 0, rd, rs1, shamt),
        Srliw { rd, rs1, shamt } => shift(OPIMM32, 0b101, 0, rd, rs1, shamt),
        Sraiw { rd, rs1, shamt } => shift(OPIMM32, 0b101, 0b0100000 << 25, rd, rs1, shamt),
        Addw { rd, rs1, rs2 } => r(OP32, 0b000, 0, rd, rs1, rs2),
        Subw { rd, rs1, rs2 } => r(OP32, 0b000, 0b0100000, rd, rs1, rs2),
        Sllw { rd, rs1, rs2 } => r(OP32, 0b001, 0, rd, rs1, rs2),
        Srlw { rd, rs1, rs2 } => r(OP32, 0b101, 0, rd, rs1, rs2),
        Sraw { rd, rs1, rs2 } => r(OP32, 0b101, 0b0100000, rd, rs1, rs2),
        // M extension (funct7 = 0000001), E1-T03.
        Mul { rd, rs1, rs2 } => r(OP, 0b000, 0b0000001, rd, rs1, rs2),
        Mulh { rd, rs1, rs2 } => r(OP, 0b001, 0b0000001, rd, rs1, rs2),
        Mulhsu { rd, rs1, rs2 } => r(OP, 0b010, 0b0000001, rd, rs1, rs2),
        Mulhu { rd, rs1, rs2 } => r(OP, 0b011, 0b0000001, rd, rs1, rs2),
        Div { rd, rs1, rs2 } => r(OP, 0b100, 0b0000001, rd, rs1, rs2),
        Divu { rd, rs1, rs2 } => r(OP, 0b101, 0b0000001, rd, rs1, rs2),
        Rem { rd, rs1, rs2 } => r(OP, 0b110, 0b0000001, rd, rs1, rs2),
        Remu { rd, rs1, rs2 } => r(OP, 0b111, 0b0000001, rd, rs1, rs2),
        Mulw { rd, rs1, rs2 } => r(OP32, 0b000, 0b0000001, rd, rs1, rs2),
        Divw { rd, rs1, rs2 } => r(OP32, 0b100, 0b0000001, rd, rs1, rs2),
        Divuw { rd, rs1, rs2 } => r(OP32, 0b101, 0b0000001, rd, rs1, rs2),
        Remw { rd, rs1, rs2 } => r(OP32, 0b110, 0b0000001, rd, rs1, rs2),
        Remuw { rd, rs1, rs2 } => r(OP32, 0b111, 0b0000001, rd, rs1, rs2),
        Fence {
            rd,
            rs1,
            fm,
            pred,
            succ,
        } => {
            ((fm as u32) << 28)
                | ((pred as u32) << 24)
                | ((succ as u32) << 20)
                | ((rs1 as u32) << 15)
                // funct3 = 000 (omitted: shifting 0 has no effect)
                | ((rd as u32) << 7)
                | 0b0001111
        }
        // A extension (E1-T04). funct3 = 010 (W) / 011 (D).
        LrW { rd, rs1, aq, rl } => amo_word(0b00010, aq, rl, 0b010, rd, rs1, 0),
        LrD { rd, rs1, aq, rl } => amo_word(0b00010, aq, rl, 0b011, rd, rs1, 0),
        ScW {
            rd,
            rs1,
            rs2,
            aq,
            rl,
        } => amo_word(0b00011, aq, rl, 0b010, rd, rs1, rs2),
        ScD {
            rd,
            rs1,
            rs2,
            aq,
            rl,
        } => amo_word(0b00011, aq, rl, 0b011, rd, rs1, rs2),
        AmoW {
            op,
            rd,
            rs1,
            rs2,
            aq,
            rl,
        } => amo_word(amo_funct5(op), aq, rl, 0b010, rd, rs1, rs2),
        AmoD {
            op,
            rd,
            rs1,
            rs2,
            aq,
            rl,
        } => amo_word(amo_funct5(op), aq, rl, 0b011, rd, rs1, rs2),
        Ecall => 0x0000_0073,
        Ebreak => 0x0010_0073,
        // Zicsr / Zifencei / xRET (E1-T02).
        FenceI => 0x0000_100F,
        Mret => 0x3020_0073,
        Wfi => 0x1050_0073,
        Csrrw { rd, rs1, csr } => csr_word(0b001, rd, rs1, csr),
        Csrrs { rd, rs1, csr } => csr_word(0b010, rd, rs1, csr),
        Csrrc { rd, rs1, csr } => csr_word(0b011, rd, rs1, csr),
        Csrrwi { rd, uimm, csr } => csr_word(0b101, rd, uimm, csr),
        Csrrsi { rd, uimm, csr } => csr_word(0b110, rd, uimm, csr),
        Csrrci { rd, uimm, csr } => csr_word(0b111, rd, uimm, csr),
        // F extension (E1-T06).
        Flw { rd, rs1, imm } => i_enc(0b0000111, 0b010, rd, rs1, imm),
        Fsw { rs1, rs2, imm } => s_enc(0b0100111, 0b010, rs1, rs2, imm),
        FpArithS {
            op,
            rd,
            rs1,
            rs2,
            rm,
        } => {
            let f7 = match op {
                FpArithOp::Add => 0b0000000,
                FpArithOp::Sub => 0b0000100,
                FpArithOp::Mul => 0b0001000,
                FpArithOp::Div => 0b0001100,
            };
            opfp(f7, rm as u32, rd, rs1, rs2)
        }
        FsqrtS { rd, rs1, rm } => opfp(0b0101100, rm as u32, rd, rs1, 0),
        FpFusedS {
            op,
            rd,
            rs1,
            rs2,
            rs3,
            rm,
        } => {
            let opcode = match op {
                FpFusedOp::Madd => 0b1000011,
                FpFusedOp::Msub => 0b1000111,
                FpFusedOp::Nmsub => 0b1001011,
                FpFusedOp::Nmadd => 0b1001111,
            };
            fused(opcode, rs3, rs2, rs1, rm as u32, rd)
        }
        FsgnjS { op, rd, rs1, rs2 } => {
            let f3 = match op {
                FpSgnjOp::J => 0b000,
                FpSgnjOp::Jn => 0b001,
                FpSgnjOp::Jx => 0b010,
            };
            opfp(0b0010000, f3, rd, rs1, rs2)
        }
        FminmaxS {
            is_max,
            rd,
            rs1,
            rs2,
        } => opfp(0b0010100, u32::from(is_max), rd, rs1, rs2),
        FpCmpS { op, rd, rs1, rs2 } => {
            let f3 = match op {
                FpCmpOp::Le => 0b000,
                FpCmpOp::Lt => 0b001,
                FpCmpOp::Eq => 0b010,
            };
            opfp(0b1010000, f3, rd, rs1, rs2)
        }
        FclassS { rd, rs1 } => opfp(0b1110000, 0b001, rd, rs1, 0),
        FmvXW { rd, rs1 } => opfp(0b1110000, 0b000, rd, rs1, 0),
        FmvWX { rd, rs1 } => opfp(0b1111000, 0b000, rd, rs1, 0),
        FcvtToIntS { width, rd, rs1, rm } => opfp(0b1100000, rm as u32, rd, rs1, cvt_idx(width)),
        FcvtFromIntS { width, rd, rs1, rm } => opfp(0b1101000, rm as u32, rd, rs1, cvt_idx(width)),
    }
}

// ── strategies producing random LEGAL words per format ────────────────────────

fn reg() -> impl Strategy<Value = u8> {
    (0u8..32).boxed()
}

prop_compose! {
    fn r_type()(
        f in prop::sample::select(vec![
            (0b000u32, 0u32), (0b001, 0), (0b010, 0), (0b011, 0), (0b100, 0),
            (0b101, 0), (0b110, 0), (0b111, 0), (0b000, 0b0100000), (0b101, 0b0100000),
            // M extension: funct7 = 0000001 legal for every funct3 (E1-T03).
            (0b000, 0b0000001), (0b001, 0b0000001), (0b010, 0b0000001), (0b011, 0b0000001),
            (0b100, 0b0000001), (0b101, 0b0000001), (0b110, 0b0000001), (0b111, 0b0000001),
        ]),
        rd in reg(), rs1 in reg(), rs2 in reg(),
    ) -> u32 { r(0b0110011, f.0, f.1, rd, rs1, rs2) }
}

prop_compose! {
    fn op32_type()(
        f in prop::sample::select(vec![
            (0b000u32, 0u32), (0b001, 0), (0b101, 0), (0b000, 0b0100000), (0b101, 0b0100000),
            // M extension *W forms: funct3 000/100/101/110/111 at funct7=0000001 (E1-T03).
            (0b000, 0b0000001), (0b100, 0b0000001), (0b101, 0b0000001),
            (0b110, 0b0000001), (0b111, 0b0000001),
        ]),
        rd in reg(), rs1 in reg(), rs2 in reg(),
    ) -> u32 { r(0b0111011, f.0, f.1, rd, rs1, rs2) }
}

prop_compose! {
    fn i_op_imm()(
        f3 in prop::sample::select(vec![0b000u32, 0b010, 0b011, 0b100, 0b110, 0b111]),
        rd in reg(), rs1 in reg(), imm in -2048i64..2048,
    ) -> u32 { i_enc(0b0010011, f3, rd, rs1, imm) }
}

prop_compose! {
    fn i_load()(
        f3 in prop::sample::select(vec![0b000u32, 0b001, 0b010, 0b011, 0b100, 0b101, 0b110]),
        rd in reg(), rs1 in reg(), imm in -2048i64..2048,
    ) -> u32 { i_enc(0b0000011, f3, rd, rs1, imm) }
}

prop_compose! {
    fn s_store()(
        f3 in prop::sample::select(vec![0b000u32, 0b001, 0b010, 0b011]),
        rs1 in reg(), rs2 in reg(), imm in -2048i64..2048,
    ) -> u32 { s_enc(0b0100011, f3, rs1, rs2, imm) }
}

prop_compose! {
    fn branch()(
        f3 in prop::sample::select(vec![0b000u32, 0b001, 0b100, 0b101, 0b110, 0b111]),
        rs1 in reg(), rs2 in reg(), imm in -4096i64..4096,
    ) -> u32 { b_enc(0b1100011, f3, rs1, rs2, imm & !1) }
}

prop_compose! {
    fn u_or_j()(
        which in 0u8..3, rd in reg(), imm20 in 0i64..(1 << 20), jimm in -(1i64 << 20)..(1 << 20),
    ) -> u32 {
        match which {
            0 => u_enc(0b0110111, rd, ((imm20 as u32) << 12) as i32 as i64), // lui
            1 => u_enc(0b0010111, rd, ((imm20 as u32) << 12) as i32 as i64), // auipc
            _ => j_enc(0b1101111, rd, jimm & !1),                            // jal
        }
    }
}

prop_compose! {
    fn shifts()(
        which in 0u8..6, rd in reg(), rs1 in reg(), sh in 0u8..64,
    ) -> u32 {
        let s5 = sh & 0x1F;
        match which {
            0 => shift(0b0010011, 0b001, 0, rd, rs1, sh),                    // slli (6-bit)
            1 => shift(0b0010011, 0b101, 0, rd, rs1, sh),                    // srli
            2 => shift(0b0010011, 0b101, 0b010000 << 26, rd, rs1, sh),       // srai
            3 => shift(0b0011011, 0b001, 0, rd, rs1, s5),                    // slliw (5-bit)
            4 => shift(0b0011011, 0b101, 0, rd, rs1, s5),                    // srliw
            _ => shift(0b0011011, 0b101, 0b0100000 << 25, rd, rs1, s5),      // sraiw
        }
    }
}

prop_compose! {
    fn i_addiw()(rd in reg(), rs1 in reg(), imm in -2048i64..2048) -> u32 {
        i_enc(0b0011011, 0b000, rd, rs1, imm)
    }
}

prop_compose! {
    fn fence()(rd in reg(), rs1 in reg(), bits in 0u32..(1 << 12)) -> u32 {
        // fm|pred|succ = insn[31:20], any 12-bit value valid.
        (bits << 20) | ((rs1 as u32) << 15) | ((rd as u32) << 7) | 0b0001111
    }
}

fn config() -> ProptestConfig {
    // 10,000 cases per strategy (committed, not the default 256).
    ProptestConfig::with_cases(10_000)
}

macro_rules! roundtrip {
    ($name:ident, $strat:expr) => {
        proptest! {
            #![proptest_config(config())]
            #[test]
            fn $name(w in $strat) {
                let d = decode(w).expect("strategy produces only legal words");
                // Round-trip: re-encoding the decoded instruction reproduces every bit —
                // catches any dropped/misplaced field.
                prop_assert_eq!(encode(&d), w, "round-trip mismatch for {:#010x} -> {:?}", w, d);
            }
        }
    };
}

roundtrip!(roundtrip_r_type, r_type());
roundtrip!(roundtrip_op32, op32_type());
roundtrip!(roundtrip_op_imm, i_op_imm());
roundtrip!(roundtrip_load, i_load());
roundtrip!(roundtrip_store, s_store());
roundtrip!(roundtrip_branch, branch());
roundtrip!(roundtrip_u_j, u_or_j());
roundtrip!(roundtrip_shifts, shifts());
roundtrip!(roundtrip_addiw, i_addiw());
roundtrip!(roundtrip_fence, fence());

// Zicsr (E1-T02): all 6 CSR ops with any rd/rs1(uimm)/csr must round-trip.
prop_compose! {
    fn csr_ops()(
        f3 in prop::sample::select(vec![0b001u32, 0b010, 0b011, 0b101, 0b110, 0b111]),
        rd in reg(), rs1 in reg(), csr in 0u16..4096,
    ) -> u32 { csr_word(f3, rd, rs1, csr) }
}
roundtrip!(roundtrip_csr, csr_ops());

// A extension (E1-T04): every legal AMO word (LR/SC/AMO × W/D × all aq/rl) round-trips.
prop_compose! {
    fn amo_ops()(
        funct5 in prop::sample::select(vec![
            0b00010u32, 0b00011, // LR, SC
            0b00001, 0b00000, 0b00100, 0b01100, 0b01000, // swap add xor and or
            0b10000, 0b10100, 0b11000, 0b11100, // min max minu maxu
        ]),
        funct3 in prop::sample::select(vec![0b010u32, 0b011]),
        rd in reg(), rs1 in reg(), rs2 in reg(), aq in any::<bool>(), rl in any::<bool>(),
    ) -> u32 {
        // LR's rs2 field is reserved and must be zero.
        let rs2 = if funct5 == 0b00010 { 0 } else { rs2 };
        amo_word(funct5, aq, rl, funct3, rd, rs1, rs2)
    }
}
roundtrip!(roundtrip_amo, amo_ops());

// F extension (E1-T06): every legal single-precision encoding round-trips, including all
// rounding-mode field values (reserved rm 5/6/7 still DECODE — they trap at execution).
prop_compose! {
    fn fp_ops()(
        which in 0u8..18,
        rd in reg(), rs1 in reg(), rs2 in reg(), rs3 in reg(),
        rm in 0u32..8, sel in 0u32..4, imm in -2048i64..2048,
    ) -> u32 {
        match which {
            0 => i_enc(0b0000111, 0b010, rd, rs1, imm),   // flw
            1 => s_enc(0b0100111, 0b010, rs1, rs2, imm),  // fsw
            2 => opfp(0b0000000, rm, rd, rs1, rs2),       // fadd.s
            3 => opfp(0b0000100, rm, rd, rs1, rs2),       // fsub.s
            4 => opfp(0b0001000, rm, rd, rs1, rs2),       // fmul.s
            5 => opfp(0b0001100, rm, rd, rs1, rs2),       // fdiv.s
            6 => opfp(0b0101100, rm, rd, rs1, 0),         // fsqrt.s (rs2=0)
            7 => fused(0b1000011, rs3, rs2, rs1, rm, rd), // fmadd.s
            8 => fused(0b1000111, rs3, rs2, rs1, rm, rd), // fmsub.s
            9 => fused(0b1001011, rs3, rs2, rs1, rm, rd), // fnmsub.s
            10 => fused(0b1001111, rs3, rs2, rs1, rm, rd),// fnmadd.s
            11 => opfp(0b0010000, rm % 3, rd, rs1, rs2),  // fsgnj[n,x].s
            12 => opfp(0b0010100, rm % 2, rd, rs1, rs2),  // fmin/fmax.s
            13 => opfp(0b1010000, rm % 3, rd, rs1, rs2),  // feq/flt/fle.s
            14 => opfp(0b1100000, rm, rd, rs1, sel as u8),// fcvt.{w,wu,l,lu}.s
            15 => opfp(0b1101000, rm, rd, rs1, sel as u8),// fcvt.s.{w,wu,l,lu}
            16 => opfp(0b1110000, sel % 2, rd, rs1, 0),   // fmv.x.w (0) / fclass.s (1)
            _ => opfp(0b1111000, 0b000, rd, rs1, 0),      // fmv.w.x
        }
    }
}
roundtrip!(roundtrip_fp, fp_ops());

// A few reserved OP-FP encodings must decode illegal.
proptest! {
    #![proptest_config(config())]
    #[test]
    fn reserved_op_fp_is_illegal(rd in reg(), rs1 in reg()) {
        // FSQRT with rs2 != 0; FMV.X.W with a nonzero rs2; a reserved funct7; FSGNJ funct3=3.
        prop_assert!(decode(opfp(0b0101100, 0, rd, rs1, 1)).is_err(), "fsqrt rs2!=0");
        prop_assert!(decode(opfp(0b1110000, 0b000, rd, rs1, 5)).is_err(), "fmv.x.w rs2!=0");
        prop_assert!(decode(opfp(0b0011111, 0, rd, rs1, 0)).is_err(), "reserved funct7");
        prop_assert!(decode(opfp(0b0010000, 0b011, rd, rs1, 0)).is_err(), "fsgnj funct3=3");
        // A double-precision fused op (fmt=01) is not decoded yet (E1-T07).
        let dfused = fused(0b1000011, 0, 0, rs1, 0, rd) | (0b01 << 25);
        prop_assert!(decode(dfused).is_err(), "fmt=01 (double) fused illegal pre-E1-T07");
    }
}

// ── REVERSE round-trip: decode(encode(instr)) == instr, with NEGATIVE immediates ──
// The word round-trip encode(decode(w))==w is structurally BLIND to immediate value /
// sign-extension bugs: the encoder re-masks to the architectural field, so a decoder that
// zero-extends imm_i (e.g. addi x1,x2,-1 → +4095) still re-encodes to the same word. This
// direction seeds instructions carrying full signed immediates and asserts the decoded
// Instr — whose imm is the architectural i64 value — equals the original, catching sign
// errors in imm_i/imm_s/imm_b/imm_j. (Also gives JALR its only value round-trip.)

prop_compose! {
    fn i_imm_instr()(rd in reg(), rs1 in reg(), imm in -2048i64..2048, which in 0u8..9) -> Instr {
        use Instr::*;
        match which {
            0 => Addi { rd, rs1, imm },
            1 => Slti { rd, rs1, imm },
            2 => Sltiu { rd, rs1, imm },
            3 => Xori { rd, rs1, imm },
            4 => Ori { rd, rs1, imm },
            5 => Andi { rd, rs1, imm },
            6 => Lw { rd, rs1, imm },
            7 => Addiw { rd, rs1, imm },
            _ => Jalr { rd, rs1, imm },
        }
    }
}
prop_compose! {
    fn s_imm_instr()(rs1 in reg(), rs2 in reg(), imm in -2048i64..2048, sd in prop::bool::ANY) -> Instr {
        if sd { Instr::Sd { rs1, rs2, imm } } else { Instr::Sw { rs1, rs2, imm } }
    }
}
prop_compose! {
    fn b_imm_instr()(rs1 in reg(), rs2 in reg(), imm in -4096i64..4096, which in 0u8..6) -> Instr {
        use Instr::*;
        let imm = imm & !1; // B-type imm[0] is always 0
        match which {
            0 => Beq { rs1, rs2, imm },
            1 => Bne { rs1, rs2, imm },
            2 => Blt { rs1, rs2, imm },
            3 => Bge { rs1, rs2, imm },
            4 => Bltu { rs1, rs2, imm },
            _ => Bgeu { rs1, rs2, imm },
        }
    }
}
prop_compose! {
    // U-type: imm = sign_extend(v << 12); v's top bit makes it negative.
    fn u_imm_instr()(rd in reg(), v in 0u32..(1 << 20), auipc in prop::bool::ANY) -> Instr {
        let imm = ((v << 12) as i32) as i64;
        if auipc { Instr::Auipc { rd, imm } } else { Instr::Lui { rd, imm } }
    }
}
prop_compose! {
    fn j_imm_instr()(rd in reg(), imm in -(1i64 << 20)..(1 << 20)) -> Instr {
        Instr::Jal { rd, imm: imm & !1 } // J-type imm[0] is always 0
    }
}

macro_rules! reverse_roundtrip {
    ($name:ident, $strat:expr) => {
        proptest! {
            #![proptest_config(config())]
            #[test]
            fn $name(instr in $strat) {
                // decode of the assembled word must reproduce the EXACT Instr, immediates
                // (incl. sign) and all.
                prop_assert_eq!(decode(encode(&instr)), Ok(instr), "value round-trip for {:?}", instr);
            }
        }
    };
}

reverse_roundtrip!(value_roundtrip_i_imm, i_imm_instr());
reverse_roundtrip!(value_roundtrip_store, s_imm_instr());
reverse_roundtrip!(value_roundtrip_branch, b_imm_instr());
reverse_roundtrip!(value_roundtrip_u, u_imm_instr());
reverse_roundtrip!(value_roundtrip_j, j_imm_instr());

/// Concrete negative-immediate words with their exact expected decoded value — a direct,
/// non-vacuous semantic check independent of the encoder (words assembled by hand from the
/// spec bit layout). A zero-extending decoder fails these immediately.
#[test]
fn negative_immediates_decode_to_the_exact_signed_value() {
    use Instr::*;
    // addi x1, x2, -1  = 0xfff10093
    assert_eq!(
        decode(0xfff1_0093),
        Ok(Addi {
            rd: 1,
            rs1: 2,
            imm: -1
        })
    );
    // addi x5, x0, -2048 (most-negative I-imm) = 0x80000293
    assert_eq!(
        decode(0x8000_0293),
        Ok(Addi {
            rd: 5,
            rs1: 0,
            imm: -2048
        })
    );
    // sd x6, -8(x2)  = 0xfe613c23  (S-imm = -8)
    assert_eq!(
        decode(0xfe61_3c23),
        Ok(Sd {
            rs1: 2,
            rs2: 6,
            imm: -8
        })
    );
    // bne x3, x4, -8 = 0xfe419ce3  (B-imm = -8; assembler-confirmed)
    assert_eq!(
        decode(0xfe41_9ce3),
        Ok(Bne {
            rs1: 3,
            rs2: 4,
            imm: -8
        })
    );
    // lui x1, 0x80000 → imm sign-extends to 0xffffffff_80000000 = -2147483648
    assert_eq!(
        decode(0x8000_00b7),
        Ok(Lui {
            rd: 1,
            imm: -2_147_483_648
        })
    );
    // jal x0, -4 = 0xffdff06f
    assert_eq!(decode(0xffdf_f06f), Ok(Jal { rd: 0, imm: -4 }));
}

// ── reserved / illegal encodings must decode to IllegalInstr ──────────────────

proptest! {
    #![proptest_config(config())]

    /// SLLIW/SRLIW/SRAIW with insn[25] = 1 is reserved (RV64 word-shift shamt is 5 bits).
    #[test]
    fn slliw_with_bit25_set_is_illegal(rd in reg(), rs1 in reg(), sh in 0u8..64) {
        for f3 in [0b001u32, 0b101] {
            // funct7 hi-field 0 for both slliw and srliw; the reserved insn[25] is forced on.
            let base = shift(0b0011011, f3, 0, rd, rs1, sh);
            let w = base | (1 << 25); // force the reserved bit
            prop_assert!(decode(w).is_err(), "SLLIW/SRLIW/SRAIW insn[25]=1 must be illegal: {:#010x}", w);
        }
    }

    /// OP with an undefined funct7 (anything but 0000000 / 0100000 / 0000001) is illegal.
    /// funct7 = 0000001 is the M extension (E1-T03), legal for every funct3, so it is
    /// excluded from this reserved-funct7 sweep.
    #[test]
    fn op_with_undefined_funct7_is_illegal(
        f3 in 0u32..8, rd in reg(), rs1 in reg(), rs2 in reg(),
        f7 in (0u32..128).prop_filter("legal funct7", |f| *f != 0 && *f != 0b0100000 && *f != 0b0000001),
    ) {
        let w = r(0b0110011, f3, f7, rd, rs1, rs2);
        prop_assert!(decode(w).is_err(), "OP funct7={:#09b} must be illegal: {:#010x}", f7, w);
    }

    /// BRANCH funct3 in {010, 011} and LOAD funct3 = 111 and STORE funct3 in {100..111}
    /// are reserved.
    #[test]
    fn reserved_mem_branch_funct3_is_illegal(rd in reg(), rs1 in reg(), rs2 in reg(), imm in -2048i64..2048) {
        prop_assert!(decode(b_enc(0b1100011, 0b010, rs1, rs2, imm & !1)).is_err());
        prop_assert!(decode(b_enc(0b1100011, 0b011, rs1, rs2, imm & !1)).is_err());
        prop_assert!(decode(i_enc(0b0000011, 0b111, rd, rs1, imm)).is_err()); // load 111
        prop_assert!(decode(s_enc(0b0100011, 0b100, rs1, rs2, imm)).is_err()); // store 100
    }

    /// AMO with a bad width (funct3 ∉ {010,011}), a reserved funct5, or LR with a nonzero
    /// (reserved) rs2 field must all decode illegal.
    #[test]
    fn reserved_amo_encodings_are_illegal(
        rd in reg(), rs1 in reg(), rs2 in reg(), aq in any::<bool>(), rl in any::<bool>(),
    ) {
        // Bad width: funct3 = 000 / 100 with an otherwise-valid AMOADD funct5.
        for f3 in [0b000u32, 0b001, 0b100, 0b111] {
            prop_assert!(decode(amo_word(0b00000, aq, rl, f3, rd, rs1, rs2)).is_err(),
                "AMO funct3={:03b} must be illegal", f3);
        }
        // Reserved funct5 (e.g. 00101, 11111) at a valid width.
        for f5 in [0b00101u32, 0b00110, 0b01010, 0b11111] {
            prop_assert!(decode(amo_word(f5, aq, rl, 0b010, rd, rs1, rs2)).is_err(),
                "AMO funct5={:05b} must be illegal", f5);
        }
        // LR (funct5=00010) with a NONZERO reserved rs2 field is illegal.
        let bad_rs2 = if rs2 == 0 { 1 } else { rs2 };
        prop_assert!(decode(amo_word(0b00010, aq, rl, 0b010, rd, rs1, bad_rs2)).is_err(),
            "LR.W with rs2={} (reserved!=0) must be illegal", bad_rs2);
    }

    /// SYSTEM words other than the exact ECALL/EBREAK encodings are illegal at Level 0
    /// (CSR space, xRET, WFI).
    #[test]
    /// SYSTEM funct3=000 words other than the four exact privileged encodings (ECALL,
    /// EBREAK, MRET, WFI) are reserved, and funct3=100 is reserved. (funct3∈{1,2,3,5,6,7}
    /// are the legal CSR ops — E1-T02.)
    fn reserved_system_funct3_000_and_100_are_illegal(rd in reg(), rs1 in reg(), rest in any::<u32>()) {
        // funct3 = 100 with arbitrary rd/rs1/csr — always reserved.
        let w100 = ((rest & 0xFFF) << 20) | ((rs1 as u32) << 15) | (0b100 << 12) | ((rd as u32) << 7) | 0b1110011;
        prop_assert!(decode(w100).is_err(), "SYSTEM funct3=100 {:#010x} must be illegal", w100);
        // funct3 = 000 word that is NOT one of the four exact privileged encodings.
        let w000 = ((rest & 0xFFF) << 20) | ((rs1 as u32) << 15) | ((rd as u32) << 7) | 0b1110011;
        if w000 != 0x0000_0073 && w000 != 0x0010_0073 && w000 != 0x3020_0073 && w000 != 0x1050_0073 {
            prop_assert!(decode(w000).is_err(), "reserved SYSTEM funct3=000 {:#010x} must be illegal", w000);
        }
    }
}
