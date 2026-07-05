//! E0-T21: exhaustive no-panic sweep of the ENTIRE 32-bit instruction space. Because the
//! space is only 2^32 words, "decode never panics" is a *theorem* here, not a sample — and
//! the count of legal instructions is checked against an INDEPENDENT analytic tally derived
//! from the RV64I opcode map (not from decode.rs), so a decode table that accidentally
//! widens or narrows a field is caught.
//!
//! `#[ignore]` (it is minutes of CPU); run it explicitly:
//!   cargo test -p wasm-vm-core --release --test exhaustive -- --ignored
#![cfg(not(target_arch = "wasm32"))]

use rayon::prelude::*;
use wasm_vm_core::decode::decode;

/// Legal RV64I encodings among all 2^32 words, derived from the opcode map (Unprivileged
/// ISA §2.2–2.3, Ch. 24) INDEPENDENTLY of decode.rs. Written derivation (P22 = 2^22 free
/// bits after opcode+funct3; P25 = 2^25 for U/J; P16/P15 = RV64/32 shift immediates):
///
/// | group                | count            | reason                                    |
/// |----------------------|------------------|-------------------------------------------|
/// | LUI, AUIPC, JAL       | 3 · 2^25         | opcode + rd + 20-bit imm, no funct        |
/// | JALR                  | 2^22             | funct3 = 000 only                         |
/// | BRANCH                | 6 · 2^22         | beq/bne/blt/bge/bltu/bgeu (010,011 illegal)|
/// | LOAD                  | 7 · 2^22         | lb/lh/lw/ld/lbu/lhu/lwu (111 illegal)     |
/// | STORE                 | 4 · 2^22         | sb/sh/sw/sd                               |
/// | OP-IMM non-shift      | 6 · 2^22         | addi/slti/sltiu/xori/ori/andi             |
/// | OP-IMM slli           | 2^16             | funct3=001, funct6=000000                 |
/// | OP-IMM srli/srai      | 2 · 2^16         | funct3=101, funct6∈{000000,010000}        |
/// | OP base               | 10 · 2^15        | 8 @funct7=0 + sub,sra @funct7=0100000     |
/// | OP M-ext              | 8 · 2^15         | mul..remu @funct7=0000001 (E1-T03)        |
/// | OP-IMM-32 addiw       | 2^22             | funct3=000                                |
/// | OP-IMM-32 slliw       | 2^15             | funct3=001, funct7=0000000 (insn[25]=0)   |
/// | OP-IMM-32 srliw/sraiw | 2 · 2^15         | funct3=101, funct7∈{0000000,0100000}      |
/// | OP-32 base            | 5 · 2^15         | addw/sllw/srlw + subw/sraw                |
/// | OP-32 M-ext           | 5 · 2^15         | mulw/divw/divuw/remw/remuw (E1-T03)       |
/// | AMO LR.W/LR.D         | 2 · 2^12         | rd+rs1+aq+rl free, rs2 reserved=0 (E1-T04)|
/// | AMO SC.W/SC.D         | 2 · 2^17         | rd+rs1+rs2+aq+rl free (E1-T04)            |
/// | AMO ops (9 × W/D)     | 18 · 2^17        | swap/add/xor/and/or/min/max/minu/maxu     |
/// | MISC-MEM FENCE        | 2^22             | funct3=000, all fm/pred/succ valid        |
/// | MISC-MEM FENCE.I      | 1                | canonical 0x0000100F only (E1-T02)        |
/// | SYSTEM CSR ops        | 6 · 2^22         | funct3∈{1,2,3,5,6,7}, any rd/rs1/csr (E1-T02)|
/// | SYSTEM ECALL/EBREAK/MRET/WFI | 4         | four exact words (E1-T02 adds MRET, WFI)  |
///
/// E1-T06 adds the F extension (all decode as legal; a reserved rounding mode traps at
/// *execution*, not decode, so every rm value is a legal encoding). Contributions:
///
/// | F group               | count            | reason                                     |
/// |-----------------------|------------------|--------------------------------------------|
/// | FLW, FSW              | 2 · 2^22         | funct3=010, rd/rs1(/rs2)+imm free          |
/// | FMADD/MSUB/NMSUB/NMADD | 4 · 2^23        | fmt=00, rs3+rs2+rs1+rd+rm free             |
/// | FADD/FSUB/FMUL/FDIV.S | 4 · 2^18         | rd+rs1+rs2+rm free                          |
/// | FSQRT.S               | 2^13             | rs2=0; rd+rs1+rm free                       |
/// | FSGNJ[N,X]/FMIN,MAX/FEQ,LT,LE | 8 · 2^15 | funct3-selected; rd+rs1+rs2 free           |
/// | FCVT.{to,from}-int.S  | 8 · 2^13         | rs2∈{0..3} width; rd+rs1+rm free           |
/// | FMV.X.W/FCLASS.S/FMV.W.X | 3 · 2^10      | funct3+rs2 fixed; rd+rs1 free              |
///
/// Folding 2·2^22 + 4·2^23 (=8·2^22) into the 2^22 term (56→66); 8·2^15 into 31→39; 2^13
/// (FSQRT) + 8·2^13 (FCVT) into 1→10. Sum =
/// 66·2^22 + 4·2^18 + 20·2^17 + 3·2^16 + 39·2^15 + 10·2^13 + 3·2^10 + 5 = 282_053_637.
///
/// NOTE: the CSR ops / FENCE.I / MRET / WFI belong to the DEFAULT (Zicsr) decoder; under
/// `feature = "zicsr-stub"` they route to the E0-T19 stub. M/A/F are NOT feature-gated. This
/// sweep runs with default features.
pub const EXPECTED_LEGAL: u64 = 66 * (1 << 22)
    + 4 * (1 << 18)
    + 20 * (1 << 17)
    + 3 * (1 << 16)
    + 39 * (1 << 15)
    + 10 * (1 << 13)
    + 3 * (1 << 10)
    + 5;

#[test]
#[ignore = "exhaustive 2^32 sweep — minutes; run with --release --ignored"]
fn decode_never_panics_and_legal_count_matches_analytic_tally() {
    // decode() is a pure const fn: calling it on every u32 either returns Ok/Err or would
    // panic (a bug). Rayon splits the range across cores; the reduce tallies legals.
    const CHUNK: u64 = 1 << 20;
    let chunks = (u32::MAX as u64 + 1) / CHUNK;
    let legal: u64 = (0..chunks)
        .into_par_iter()
        .map(|c| {
            let start = (c * CHUNK) as u32;
            let mut n = 0u64;
            for off in 0..CHUNK as u32 {
                if decode(start.wrapping_add(off)).is_ok() {
                    n += 1;
                }
            }
            n
        })
        .sum();

    assert_eq!(
        legal, EXPECTED_LEGAL,
        "legal-instruction tally {legal} != analytic {EXPECTED_LEGAL} — a decode field \
         mask drifted (widened/narrowed a legal region)"
    );
}
