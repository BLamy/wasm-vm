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
/// | MISC-MEM FENCE        | 2^22             | funct3=000, all fm/pred/succ valid        |
/// | MISC-MEM FENCE.I      | 1                | canonical 0x0000100F only (E1-T02)        |
/// | SYSTEM CSR ops        | 6 · 2^22         | funct3∈{1,2,3,5,6,7}, any rd/rs1/csr (E1-T02)|
/// | SYSTEM ECALL/EBREAK/MRET/WFI | 4         | four exact words (E1-T02 adds MRET, WFI)  |
///
/// The 2^15 groups now total OP(10) + OP M(8) + slliw(1) + srliw/sraiw(2) + OP-32(5) +
/// OP-32 M(5) = 31. Sum = 56·2^22 + 3·2^16 + 31·2^15 + 5 = 236_093_445.
///
/// NOTE: the CSR ops / FENCE.I / MRET / WFI (the 56·2^22 tail + the +5 exact words) belong to
/// the DEFAULT (Zicsr) decoder; under `feature = "zicsr-stub"` they route to the E0-T19 stub
/// and are not decoded. The M-extension is NOT feature-gated — legal in both builds. This
/// sweep runs with default features.
pub const EXPECTED_LEGAL: u64 = 56 * (1 << 22) + 3 * (1 << 16) + 31 * (1 << 15) + 5;

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
