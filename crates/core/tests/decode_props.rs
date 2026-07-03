//! E0-T21: property tests for the decoder. Two independent oracles:
//!   1. an `encode(&Instr) -> u32` assembler written FROM THE SPEC (Unprivileged ISA
//!      §2.2–2.3, Ch. 24), never from decode.rs — so `encode(decode(w)) == w` on legal
//!      words is a genuine cross-check, not a tautology;
//!   2. reserved-encoding strategies asserting `decode` returns `IllegalInstr`.
//!
//! Configured for 10,000 cases per strategy (committed, not the default 256).
#![cfg(not(target_arch = "wasm32"))]

use proptest::prelude::*;
use wasm_vm_core::decode::{Instr, decode};

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
        Ecall => 0x0000_0073,
        Ebreak => 0x0010_0073,
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
        ]),
        rd in reg(), rs1 in reg(), rs2 in reg(),
    ) -> u32 { r(0b0110011, f.0, f.1, rd, rs1, rs2) }
}

prop_compose! {
    fn op32_type()(
        f in prop::sample::select(vec![
            (0b000u32, 0u32), (0b001, 0), (0b101, 0), (0b000, 0b0100000), (0b101, 0b0100000),
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

    /// OP with an undefined funct7 (anything but 0000000 / 0100000) is illegal, incl. the
    /// M-extension funct7 = 0000001.
    #[test]
    fn op_with_undefined_funct7_is_illegal(
        f3 in 0u32..8, rd in reg(), rs1 in reg(), rs2 in reg(),
        f7 in (0u32..128).prop_filter("legal funct7", |f| *f != 0 && *f != 0b0100000),
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

    /// SYSTEM words other than the exact ECALL/EBREAK encodings are illegal at Level 0
    /// (CSR space, xRET, WFI).
    #[test]
    fn non_ecall_ebreak_system_is_illegal(w in any::<u32>().prop_map(|w| (w & !0x7f) | 0b1110011)
        .prop_filter("not ecall/ebreak", |w| *w != 0x0000_0073 && *w != 0x0010_0073)) {
        prop_assert!(decode(w).is_err(), "SYSTEM {:#010x} must be illegal", w);
    }
}
