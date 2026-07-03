//! RV64C compressed-instruction expansion (E1-T08).
//!
//! Every legal 16-bit RVC encoding is *expanded* to its 32-bit RV64I/F/D equivalent word;
//! that word then flows through the exact same [`crate::decode::decode`] + execute path, so
//! a compressed op is byte-for-byte identical to its expansion — the one place FP/int
//! semantics live (Unprivileged ISA "C" chapter). Reserved encodings return `IllegalInstr`.
//!
//! References: RVC quadrant tables and the CIW/CL/CS/CB/CJ/CI/CSS/CR immediate formats.
//! RV64-specific rows: C.ADDIW replaces C.JAL; C.LD/C.SD/C.LDSP/C.SDSP exist; there is no
//! C.FLW/C.FLWSP (those funct3 slots are C.LD/C.LDSP in RV64).

use crate::decode::IllegalInstr;

// ── base-instruction encoders (produce the 32-bit word) ─────────────────────────

const fn i_type(op: u32, f3: u32, rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32 & 0xFFF) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op
}
const fn s_type(op: u32, f3: u32, rs1: u32, rs2: u32, imm: i32) -> u32 {
    let u = imm as u32;
    ((u >> 5 & 0x7F) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((u & 0x1F) << 7) | op
}
const fn b_type(op: u32, f3: u32, rs1: u32, rs2: u32, imm: i32) -> u32 {
    let u = imm as u32;
    ((u >> 12 & 1) << 31)
        | ((u >> 5 & 0x3F) << 25)
        | (rs2 << 20)
        | (rs1 << 15)
        | (f3 << 12)
        | ((u >> 1 & 0xF) << 8)
        | ((u >> 11 & 1) << 7)
        | op
}
const fn u_type(op: u32, rd: u32, imm: i32) -> u32 {
    (imm as u32 & 0xFFFF_F000) | (rd << 7) | op
}
const fn j_type(op: u32, rd: u32, imm: i32) -> u32 {
    let u = imm as u32;
    ((u >> 20 & 1) << 31)
        | ((u >> 1 & 0x3FF) << 21)
        | ((u >> 11 & 1) << 20)
        | ((u >> 12 & 0xFF) << 12)
        | (rd << 7)
        | op
}
const fn r_type(op: u32, f3: u32, f7: u32, rd: u32, rs1: u32, rs2: u32) -> u32 {
    (f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op
}
/// A shift-immediate (op-imm) with a 6-bit RV64 shamt and the `top6` selector field.
const fn shift_imm(f3: u32, top6: u32, rd: u32, rs1: u32, shamt: u32) -> u32 {
    (top6 << 26) | (shamt << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0b0010011
}

const OP_IMM: u32 = 0b0010011;
const OP_IMM32: u32 = 0b0011011;
const OP: u32 = 0b0110011;
const OP32: u32 = 0b0111011;
const LOAD: u32 = 0b0000011;
const STORE: u32 = 0b0100011;
const LOADFP: u32 = 0b0000111;
const STOREFP: u32 = 0b0100111;

// ── bit helpers ─────────────────────────────────────────────────────────────────

/// A 3-bit compressed register field `x8..x15`.
const fn rp(c: u16, hi: u32) -> u32 {
    ((c as u32 >> hi) & 0x7) + 8
}
/// Bit `n` of the instruction.
const fn bit(c: u16, n: u32) -> u32 {
    (c as u32 >> n) & 1
}
/// Bits `[hi:lo]`.
const fn bits(c: u16, hi: u32, lo: u32) -> u32 {
    (c as u32 >> lo) & ((1 << (hi - lo + 1)) - 1)
}
/// Sign-extend the low `n` bits of `v`.
const fn sext(v: u32, n: u32) -> i32 {
    let shift = 32 - n;
    ((v << shift) as i32) >> shift
}

/// Expand a 16-bit RVC instruction to its 32-bit base equivalent, or `IllegalInstr` for a
/// reserved/unsupported encoding (`c[1:0] == 0b11` is NOT compressed and is a caller error).
pub const fn expand_c(c: u16) -> Result<u32, IllegalInstr> {
    let op = c as u32 & 0b11;
    let funct3 = (c as u32 >> 13) & 0x7;
    match (op, funct3) {
        // ── Quadrant 0 ──────────────────────────────────────────────────────
        (0b00, 0b000) => {
            // C.ADDI4SPN → addi rd', x2, nzuimm (nzuimm=0 reserved, incl. all-zeros).
            let nzuimm = (bits(c, 10, 7) << 6)
                | (bits(c, 12, 11) << 4)
                | (bit(c, 5) << 3)
                | (bit(c, 6) << 2);
            if nzuimm == 0 {
                return Err(IllegalInstr);
            }
            Ok(i_type(OP_IMM, 0b000, rp(c, 2), 2, nzuimm as i32))
        }
        (0b00, 0b001) => {
            // C.FLD → fld rd', rs1', uimm (scaled by 8).
            let uimm = (bits(c, 6, 5) << 6) | (bits(c, 12, 10) << 3);
            Ok(i_type(LOADFP, 0b011, rp(c, 2), rp(c, 7), uimm as i32))
        }
        (0b00, 0b010) => {
            // C.LW → lw rd', rs1', uimm (scaled by 4).
            let uimm = (bit(c, 5) << 6) | (bits(c, 12, 10) << 3) | (bit(c, 6) << 2);
            Ok(i_type(LOAD, 0b010, rp(c, 2), rp(c, 7), uimm as i32))
        }
        (0b00, 0b011) => {
            // C.LD → ld rd', rs1', uimm (RV64, scaled by 8).
            let uimm = (bits(c, 6, 5) << 6) | (bits(c, 12, 10) << 3);
            Ok(i_type(LOAD, 0b011, rp(c, 2), rp(c, 7), uimm as i32))
        }
        (0b00, 0b101) => {
            // C.FSD → fsd rs2', rs1', uimm.
            let uimm = (bits(c, 6, 5) << 6) | (bits(c, 12, 10) << 3);
            Ok(s_type(STOREFP, 0b011, rp(c, 7), rp(c, 2), uimm as i32))
        }
        (0b00, 0b110) => {
            // C.SW → sw rs2', rs1', uimm.
            let uimm = (bit(c, 5) << 6) | (bits(c, 12, 10) << 3) | (bit(c, 6) << 2);
            Ok(s_type(STORE, 0b010, rp(c, 7), rp(c, 2), uimm as i32))
        }
        (0b00, 0b111) => {
            // C.SD → sd rs2', rs1', uimm (RV64).
            let uimm = (bits(c, 6, 5) << 6) | (bits(c, 12, 10) << 3);
            Ok(s_type(STORE, 0b011, rp(c, 7), rp(c, 2), uimm as i32))
        }
        (0b00, _) => Err(IllegalInstr), // funct3=100 reserved

        // ── Quadrant 1 ──────────────────────────────────────────────────────
        (0b01, 0b000) => {
            // C.ADDI → addi rd, rd, nzimm (rd=0/imm=0 are NOP/HINT — still legal).
            let rd = bits(c, 11, 7);
            let imm = sext((bit(c, 12) << 5) | bits(c, 6, 2), 6);
            Ok(i_type(OP_IMM, 0b000, rd, rd, imm))
        }
        (0b01, 0b001) => {
            // C.ADDIW → addiw rd, rd, imm (RV64; rd=0 reserved).
            let rd = bits(c, 11, 7);
            if rd == 0 {
                return Err(IllegalInstr);
            }
            let imm = sext((bit(c, 12) << 5) | bits(c, 6, 2), 6);
            Ok(i_type(OP_IMM32, 0b000, rd, rd, imm))
        }
        (0b01, 0b010) => {
            // C.LI → addi rd, x0, imm (rd=0 HINT).
            let rd = bits(c, 11, 7);
            let imm = sext((bit(c, 12) << 5) | bits(c, 6, 2), 6);
            Ok(i_type(OP_IMM, 0b000, rd, 0, imm))
        }
        (0b01, 0b011) => {
            let rd = bits(c, 11, 7);
            if rd == 2 {
                // C.ADDI16SP → addi x2, x2, nzimm (nzimm=0 reserved).
                let nzimm = sext(
                    (bit(c, 12) << 9)
                        | (bits(c, 4, 3) << 7)
                        | (bit(c, 5) << 6)
                        | (bit(c, 2) << 5)
                        | (bit(c, 6) << 4),
                    10,
                );
                if nzimm == 0 {
                    return Err(IllegalInstr);
                }
                Ok(i_type(OP_IMM, 0b000, 2, 2, nzimm))
            } else {
                // C.LUI → lui rd, nzimm (nzimm=0 reserved; rd=0 HINT).
                let imm = sext((bit(c, 12) << 17) | (bits(c, 6, 2) << 12), 18);
                if imm == 0 {
                    return Err(IllegalInstr);
                }
                Ok(u_type(0b0110111, rd, imm))
            }
        }
        (0b01, 0b100) => {
            // MISC-ALU.
            let rd = rp(c, 7);
            let shamt = (bit(c, 12) << 5) | bits(c, 6, 2);
            match bits(c, 11, 10) {
                0b00 => Ok(shift_imm(0b101, 0b000000, rd, rd, shamt)), // C.SRLI
                0b01 => Ok(shift_imm(0b101, 0b010000, rd, rd, shamt)), // C.SRAI
                0b10 => {
                    // C.ANDI → andi rd', rd', imm.
                    let imm = sext((bit(c, 12) << 5) | bits(c, 6, 2), 6);
                    Ok(i_type(OP_IMM, 0b111, rd, rd, imm))
                }
                _ => {
                    let rs2 = rp(c, 2);
                    match (bit(c, 12), bits(c, 6, 5)) {
                        (0, 0b00) => Ok(r_type(OP, 0b000, 0b0100000, rd, rd, rs2)), // C.SUB
                        (0, 0b01) => Ok(r_type(OP, 0b100, 0, rd, rd, rs2)),         // C.XOR
                        (0, 0b10) => Ok(r_type(OP, 0b110, 0, rd, rd, rs2)),         // C.OR
                        (0, 0b11) => Ok(r_type(OP, 0b111, 0, rd, rd, rs2)),         // C.AND
                        (1, 0b00) => Ok(r_type(OP32, 0b000, 0b0100000, rd, rd, rs2)), // C.SUBW
                        (1, 0b01) => Ok(r_type(OP32, 0b000, 0, rd, rd, rs2)),       // C.ADDW
                        _ => Err(IllegalInstr),                                     // reserved
                    }
                }
            }
        }
        (0b01, 0b101) => {
            // C.J → jal x0, offset.
            Ok(j_type(0b1101111, 0, cj_offset(c)))
        }
        (0b01, 0b110) => {
            // C.BEQZ → beq rs1', x0, offset.
            Ok(b_type(0b1100011, 0b000, rp(c, 7), 0, cb_offset(c)))
        }
        (0b01, 0b111) => {
            // C.BNEZ → bne rs1', x0, offset.
            Ok(b_type(0b1100011, 0b001, rp(c, 7), 0, cb_offset(c)))
        }

        // ── Quadrant 2 ──────────────────────────────────────────────────────
        (0b10, 0b000) => {
            // C.SLLI → slli rd, rd, shamt (rd=0/shamt=0 HINT).
            let rd = bits(c, 11, 7);
            let shamt = (bit(c, 12) << 5) | bits(c, 6, 2);
            Ok(shift_imm(0b001, 0b000000, rd, rd, shamt))
        }
        (0b10, 0b001) => {
            // C.FLDSP → fld rd, x2, uimm.
            let rd = bits(c, 11, 7);
            let uimm = (bits(c, 4, 2) << 6) | (bit(c, 12) << 5) | (bits(c, 6, 5) << 3);
            Ok(i_type(LOADFP, 0b011, rd, 2, uimm as i32))
        }
        (0b10, 0b010) => {
            // C.LWSP → lw rd, x2, uimm (rd=0 reserved).
            let rd = bits(c, 11, 7);
            if rd == 0 {
                return Err(IllegalInstr);
            }
            let uimm = (bits(c, 3, 2) << 6) | (bit(c, 12) << 5) | (bits(c, 6, 4) << 2);
            Ok(i_type(LOAD, 0b010, rd, 2, uimm as i32))
        }
        (0b10, 0b011) => {
            // C.LDSP → ld rd, x2, uimm (RV64; rd=0 reserved).
            let rd = bits(c, 11, 7);
            if rd == 0 {
                return Err(IllegalInstr);
            }
            let uimm = (bits(c, 4, 2) << 6) | (bit(c, 12) << 5) | (bits(c, 6, 5) << 3);
            Ok(i_type(LOAD, 0b011, rd, 2, uimm as i32))
        }
        (0b10, 0b100) => {
            let rd = bits(c, 11, 7);
            let rs2 = bits(c, 6, 2);
            match (bit(c, 12), rs2) {
                (0, 0) => {
                    // C.JR → jalr x0, rs1, 0 (rs1=0 reserved).
                    if rd == 0 {
                        return Err(IllegalInstr);
                    }
                    Ok(i_type(0b1100111, 0b000, 0, rd, 0))
                }
                (0, _) => Ok(r_type(OP, 0b000, 0, rd, 0, rs2)), // C.MV → add rd, x0, rs2
                (1, 0) => {
                    if rd == 0 {
                        Ok(0x0010_0073) // C.EBREAK
                    } else {
                        // C.JALR → jalr x1, rs1, 0.
                        Ok(i_type(0b1100111, 0b000, 1, rd, 0))
                    }
                }
                _ => Ok(r_type(OP, 0b000, 0, rd, rd, rs2)), // C.ADD → add rd, rd, rs2 (bit12=1, rs2≠0)
            }
        }
        (0b10, 0b101) => {
            // C.FSDSP → fsd rs2, x2, uimm.
            let uimm = (bits(c, 9, 7) << 6) | (bits(c, 12, 10) << 3);
            Ok(s_type(STOREFP, 0b011, 2, bits(c, 6, 2), uimm as i32))
        }
        (0b10, 0b110) => {
            // C.SWSP → sw rs2, x2, uimm.
            let uimm = (bits(c, 8, 7) << 6) | (bits(c, 12, 9) << 2);
            Ok(s_type(STORE, 0b010, 2, bits(c, 6, 2), uimm as i32))
        }
        (0b10, 0b111) => {
            // C.SDSP → sd rs2, x2, uimm (RV64).
            let uimm = (bits(c, 9, 7) << 6) | (bits(c, 12, 10) << 3);
            Ok(s_type(STORE, 0b011, 2, bits(c, 6, 2), uimm as i32))
        }

        _ => Err(IllegalInstr),
    }
}

/// CJ-format jump offset (C.J), sign-extended (bit 11 sign), bit 0 = 0.
const fn cj_offset(c: u16) -> i32 {
    let v = (bit(c, 12) << 11)
        | (bit(c, 8) << 10)
        | (bits(c, 10, 9) << 8)
        | (bit(c, 6) << 7)
        | (bit(c, 7) << 6)
        | (bit(c, 2) << 5)
        | (bit(c, 11) << 4)
        | (bits(c, 5, 3) << 1);
    sext(v, 12)
}

/// CB-format branch offset (C.BEQZ/C.BNEZ), sign-extended (bit 8 sign), bit 0 = 0.
const fn cb_offset(c: u16) -> i32 {
    let v = (bit(c, 12) << 8)
        | (bits(c, 6, 5) << 6)
        | (bit(c, 2) << 5)
        | (bits(c, 11, 10) << 3)
        | (bits(c, 4, 3) << 1);
    sext(v, 9)
}
