//! E0-T06 golden decode table.
//!
//! PROVENANCE (independent of the decoder): every positive word below was produced by
//! a real assembler — `clang -target riscv64-unknown-elf -march=rv64i -mno-relax` +
//! `llvm-objdump -d -M no-aliases` (alpine:latest, LLVM 19 era) from
//! `scratchpad/golden.s`; branch/JAL words include REAL label-distance immediates,
//! with the B/J range extremes (+4094/-4096, +1048574/-1048576) constructed by
//! `.skip`-separated labels so the assembler itself emitted the boundary encodings.
//! Reproduce: assemble the same source and diff the dump.

use wasm_vm_core::decode::{Instr, decode};

use Instr::*;

/// (word, expected decode) — 70 assembler-produced entries.
#[rustfmt::skip]
const GOLDEN: &[(u32, Instr)] = &[
    // U-type
    (0x123452b7, Lui { rd: 5, imm: 0x12345000 }),
    (0xffffffb7, Lui { rd: 31, imm: -4096 }),               // 0xfffff000 sign-extended
    (0x00000037, Lui { rd: 0, imm: 0 }),
    (0x00001097, Auipc { rd: 1, imm: 0x1000 }),
    (0xffffff17, Auipc { rd: 30, imm: -4096 }),
    // JAL (label-resolved: +8 / -8) and J-range extremes
    (0x008000ef, Jal { rd: 1, imm: 8 }),
    (0xff9ff06f, Jal { rd: 0, imm: -8 }),
    (0x7ffff06f, Jal { rd: 0, imm: 1048574 }),
    (0x8000006f, Jal { rd: 0, imm: -1048576 }),
    // JALR
    (0x00008067, Jalr { rd: 0, rs1: 1, imm: 0 }),           // ret
    (0xffc102e7, Jalr { rd: 5, rs1: 2, imm: -4 }),
    (0x7fff80e7, Jalr { rd: 1, rs1: 31, imm: 2047 }),
    // Branches (label-resolved) and B-range extremes
    (0x00208463, Beq { rs1: 1, rs2: 2, imm: 8 }),
    (0xfe419ee3, Bne { rs1: 3, rs2: 4, imm: -4 }),
    (0xfe62cce3, Blt { rs1: 5, rs2: 6, imm: -8 }),
    (0x0083d463, Bge { rs1: 7, rs2: 8, imm: 8 }),
    (0xfea4e8e3, Bltu { rs1: 9, rs2: 10, imm: -16 }),
    (0xfec5f6e3, Bgeu { rs1: 11, rs2: 12, imm: -20 }),
    (0x7e000fe3, Beq { rs1: 0, rs2: 0, imm: 4094 }),
    (0x80000063, Beq { rs1: 0, rs2: 0, imm: -4096 }),
    // Loads
    (0x00010083, Lb { rd: 1, rs1: 2, imm: 0 }),
    (0xfff21183, Lh { rd: 3, rs1: 4, imm: -1 }),
    (0x7ff32283, Lw { rd: 5, rs1: 6, imm: 2047 }),
    (0x80043383, Ld { rd: 7, rs1: 8, imm: -2048 }),
    (0x00454483, Lbu { rd: 9, rs1: 10, imm: 4 }),
    (0x00865583, Lhu { rd: 11, rs1: 12, imm: 8 }),
    (0x00c76683, Lwu { rd: 13, rs1: 14, imm: 12 }),
    // Stores
    (0x00110023, Sb { rs1: 2, rs2: 1, imm: 0 }),
    (0xfe321fa3, Sh { rs1: 4, rs2: 3, imm: -1 }),
    (0x7e532fa3, Sw { rs1: 6, rs2: 5, imm: 2047 }),
    (0x80743023, Sd { rs1: 8, rs2: 7, imm: -2048 }),
    // OP-IMM
    (0xfff00093, Addi { rd: 1, rs1: 0, imm: -1 }),          // sign extension (angle 5)
    (0x00000513, Addi { rd: 10, rs1: 0, imm: 0 }),
    (0x80012093, Slti { rd: 1, rs1: 2, imm: -2048 }),
    (0x7ff23193, Sltiu { rd: 3, rs1: 4, imm: 2047 }),
    (0x0ff34293, Xori { rd: 5, rs1: 6, imm: 255 }),
    (0xf0046393, Ori { rd: 7, rs1: 8, imm: -256 }),
    (0x00f57493, Andi { rd: 9, rs1: 10, imm: 15 }),
    (0x00011093, Slli { rd: 1, rs1: 2, shamt: 0 }),
    (0x03f21193, Slli { rd: 3, rs1: 4, shamt: 63 }),
    (0x00135293, Srli { rd: 5, rs1: 6, shamt: 1 }),
    (0x03f45393, Srli { rd: 7, rs1: 8, shamt: 63 }),
    (0x43f55493, Srai { rd: 9, rs1: 10, shamt: 63 }),
    (0x41f65593, Srai { rd: 11, rs1: 12, shamt: 31 }),
    // OP
    (0x003100b3, Add { rd: 1, rs1: 2, rs2: 3 }),
    (0x40628233, Sub { rd: 4, rs1: 5, rs2: 6 }),
    (0x009413b3, Sll { rd: 7, rs1: 8, rs2: 9 }),
    (0x00c5a533, Slt { rd: 10, rs1: 11, rs2: 12 }),
    (0x00f736b3, Sltu { rd: 13, rs1: 14, rs2: 15 }),
    (0x0128c833, Xor { rd: 16, rs1: 17, rs2: 18 }),
    (0x015a59b3, Srl { rd: 19, rs1: 20, rs2: 21 }),
    (0x418bdb33, Sra { rd: 22, rs1: 23, rs2: 24 }),
    (0x01bd6cb3, Or { rd: 25, rs1: 26, rs2: 27 }),
    (0x01eefe33, And { rd: 28, rs1: 29, rs2: 30 }),
    // OP-IMM-32
    (0xfff1009b, Addiw { rd: 1, rs1: 2, imm: -1 }),
    (0x7ff2019b, Addiw { rd: 3, rs1: 4, imm: 2047 }),
    (0x01f3129b, Slliw { rd: 5, rs1: 6, shamt: 31 }),
    (0x01f4539b, Srliw { rd: 7, rs1: 8, shamt: 31 }),
    (0x41f5549b, Sraiw { rd: 9, rs1: 10, shamt: 31 }),
    (0x4006559b, Sraiw { rd: 11, rs1: 12, shamt: 0 }),
    // OP-32
    (0x003100bb, Addw { rd: 1, rs1: 2, rs2: 3 }),
    (0x4062823b, Subw { rd: 4, rs1: 5, rs2: 6 }),
    (0x009413bb, Sllw { rd: 7, rs1: 8, rs2: 9 }),
    (0x00c5d53b, Srlw { rd: 10, rs1: 11, rs2: 12 }),
    (0x40f756bb, Sraw { rd: 13, rs1: 14, rs2: 15 }),
    // MISC-MEM / SYSTEM (angle 4: nonzero fm/pred/succ are VALID)
    (0x0ff0000f, Fence { rd: 0, rs1: 0, fm: 0, pred: 0xF, succ: 0xF }),
    (0x0330000f, Fence { rd: 0, rs1: 0, fm: 0, pred: 0x3, succ: 0x3 }),
    (0x8330000f, Fence { rd: 0, rs1: 0, fm: 0x8, pred: 0x3, succ: 0x3 }), // fence.tso
    (0x00000073, Ecall),
    (0x00100073, Ebreak),
];

/// Reserved / garbage / not-yet-implemented encodings — all must be IllegalInstr.
#[rustfmt::skip]
// NOTE: FENCE.I (0x0000100F), CSRRW (0x00101073), and WFI (0x10500073) moved OUT of this
// table in E1-T02 — they are now LEGAL in the default Zicsr decoder (still illegal under
// feature=zicsr-stub, exercised by the E0-T19 rv64ui-p path).
const NEGATIVE: &[u32] = &[
    0x00000000, // all zeros (defined illegal)
    0xFFFFFFFF, // all ones (defined illegal)
    0x00000001, // compressed space: insn[1:0] == 01
    0x00000002, // compressed space: insn[1:0] == 10
    0x00008062, // compressed space with plausible upper bits
    0x0000200F, // MISC-MEM funct3=010 (reserved)
    // MUL/MULH (0x02208033/0x02209033) and REMUW (0x0220F03B) are now LEGAL — M extension,
    // E1-T03. But an M *W-form reserved funct3 stays illegal:
    0x0220303B, // OP-32 funct7=0000001 funct3=011 — reserved (no such M *W op)
    0x0220103B, // OP-32 funct7=0000001 funct3=001 — reserved
    0x04011093, // SLLI with insn[26]=1 (top6=000001, reserved)
    0x0201109B, // SLLIW with insn[25]=1 — architecturally illegal (acceptance)
    0x6000509B, // SRAIW-space with garbage funct7
    0x00009067, // JALR funct3=001 (reserved)
    0x0020A063, // BRANCH funct3=010 (reserved)
    0x0020B063, // BRANCH funct3=011 (reserved)
    0x00017003, // LOAD funct3=111 (reserved)
    0x00004023, // STORE funct3=100 (reserved)
    0x80000033, // OP funct7=1000000 (garbage on ADD slot)
    0x40004033, // OP funct7=0100000 on XOR slot (only ADD/SRL take 0100000)
    0x4000403B, // OP-32 funct7=0100000 on invalid slot
    0x0000203B, // OP-32 funct3=010 (no SLTW exists)
    0x10200073, // SRET — privileged, illegal at Level 0
    0x0000002F, // AMO opcode (A extension)
    0x00000007, // LOAD-FP opcode (F extension)
    0x0000006B, // reserved opcode 1101011
    0x000000F3, // SYSTEM funct3=0 but rd=1 (not the exact ECALL word)
    0x00200073, // SYSTEM rs2-field=2 variant (URET space) — not ECALL/EBREAK
];

#[test]
fn golden_table_decodes_exactly() {
    assert!(GOLDEN.len() >= 60, "golden table must hold >= 60 entries");
    for &(word, expected) in GOLDEN {
        assert_eq!(
            decode(word),
            Ok(expected),
            "word {word:#010x} decoded wrong"
        );
    }
}

#[test]
fn negative_table_is_all_illegal() {
    assert!(
        NEGATIVE.len() >= 20,
        "negative table must hold >= 20 entries"
    );
    for &word in NEGATIVE {
        assert!(
            decode(word).is_err(),
            "word {word:#010x} must be IllegalInstr"
        );
    }
}

// Full-size sweeps natively; reduced under miri (interpreted, ~1000x slower) — the
// point of the miri pass is UB detection on the code paths, not volume.
#[cfg(miri)]
const SWEEP: u64 = 2_000;
#[cfg(not(miri))]
const SWEEP: u64 = 1_000_000;

#[test]
fn compressed_space_is_always_illegal() {
    // Any word with insn[1:0] != 0b11 — sample densely.
    let mut state: u64 = 0x5EED_2026_0702_0006;
    for _ in 0..(SWEEP / 10) {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let w = (state >> 16) as u32;
        for low in [0b00u32, 0b01, 0b10] {
            assert!(decode((w & !0b11) | low).is_err());
        }
    }
}

#[test]
fn sweep_never_panics_and_is_total() {
    // Acceptance: 1M random words; adversarial angle 3: strided sweep. Both — any
    // panic fails the test by definition of #[test].
    let mut legal = 0u64;
    let mut state: u64 = 0x5EED_2026_0702_0616;
    for _ in 0..SWEEP {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        if decode((state >> 24) as u32).is_ok() {
            legal += 1;
        }
    }
    // Sanity: valid encodings are a small fraction of the space.
    assert!(legal < SWEEP / 5, "implausibly many legal decodes: {legal}");

    let stride: u32 = if cfg!(miri) { 0x0100_0001 } else { 0x10001 };
    let mut w: u32 = 0;
    loop {
        let _ = decode(w);
        match w.checked_add(stride) {
            Some(next) => w = next,
            None => break,
        }
    }
}

#[test]
fn decode_works_in_const_context() {
    // Acceptance: const-friendly. Evaluated at compile time.
    const NOP: Result<Instr, wasm_vm_core::decode::IllegalInstr> = decode(0x00000013);
    assert_eq!(
        NOP,
        Ok(Addi {
            rd: 0,
            rs1: 0,
            imm: 0
        })
    );
}
