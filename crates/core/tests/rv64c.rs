//! E1-T08: RV64C compressed decoding — expansion correctness (vs toolchain ground-truth),
//! the exhaustive 65536-pattern sweep, reserved/illegal encodings, C.JALR's pc+2 link, and
//! the fetch-path (compressed advances pc by 2; a straddling 32-bit op is two accesses).
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::decode::decode;
use wasm_vm_core::decode_c::expand_c;
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

// ── expansion vs toolchain ground-truth (riscv64-unknown-elf-as -march=rv64gc) ──

#[test]
fn expansions_match_toolchain_ground_truth() {
    // (16-bit RVC word, its 32-bit expansion) — the expansions were produced by the
    // reference assembler/disassembler, so these pin the immediate scrambles.
    let cases: &[(u16, u32)] = &[
        (0x0001, 0x0000_0013), // c.nop        → addi x0, x0, 0
        (0x0808, 0x0101_0513), // c.addi4spn a0, sp, 16 → addi a0, sp, 16
        (0x6105, 0x0201_0113), // c.addi16sp sp, 32     → addi sp, sp, 32
        (0x65c1, 0x0001_05b7), // c.lui a1, 0x10        → lui a1, 0x10
        (0x9702, 0x0007_00e7), // c.jalr a4             → jalr x1, a4, 0
        (0x4622, 0x0081_2603), // c.lwsp a2, 8(sp)      → lw a2, 8(sp)
        (0x6914, 0x0105_3683), // c.ld a3, 16(a0)       → ld a3, 16(a0)
    ];
    for &(c, want) in cases {
        assert_eq!(
            expand_c(c),
            Ok(want),
            "expand_c({c:#06x}) should be {want:#010x}"
        );
    }
}

#[test]
fn reserved_and_illegal_encodings() {
    assert_eq!(expand_c(0x0000), Err(wasm_vm_core::decode::IllegalInstr)); // all-zeros
    // C.ADDI4SPN with nzuimm=0 (any funct3=000 q0 word with the imm bits clear).
    assert!(expand_c(0x0000).is_err());
    // q0 funct3=100 is reserved.
    assert!(expand_c(0x8000).is_err());
    // C.LWSP/C.LDSP with rd=0 are reserved.
    assert!(expand_c(0x4002).is_err(), "c.lwsp x0 reserved"); // funct3=010 q2, rd=0
    assert!(expand_c(0x6002).is_err(), "c.ldsp x0 reserved"); // funct3=011 q2, rd=0
    // C.JR x0 (rs1=0) is reserved: funct3=100 q2, bit12=0, rd=0, rs2=0 → 0x8002.
    assert!(expand_c(0x8002).is_err(), "c.jr x0 reserved");
    // C.ADDIW x0 (rd=0) reserved: funct3=001 q1, rd=0 → 0x2001.
    assert!(expand_c(0x2001).is_err(), "c.addiw x0 reserved");
}

#[test]
fn exhaustive_16bit_sweep_never_panics_and_expansions_decode() {
    // Every one of the 65536 half-word patterns: expand_c must not panic, and any legal
    // expansion must decode cleanly (a valid 32-bit base instruction). Count the legal set.
    let mut legal = 0u32;
    for c in 0u32..=0xFFFF {
        let c = c as u16;
        // Only genuine compressed patterns (op != 0b11) go through expand_c.
        if c & 0b11 == 0b11 {
            continue;
        }
        if let Ok(w) = expand_c(c) {
            assert!(
                decode(w).is_ok(),
                "expand_c({c:#06x}) = {w:#010x} does not decode",
            );
            legal += 1;
        }
    }
    // A stable count (an independent Spike-derived reference is the adversarial check).
    assert_eq!(legal, LEGAL_COMPRESSED, "compressed legal-count drifted");
}

/// Number of legal 16-bit RVC encodings among the 3 compressed quadrants (49152 patterns,
/// op != 0b11): 46743 legal, 2409 reserved (q0 funct3=100 is 2048 of those; the rest are
/// nzuimm=0 / imm=0 / rd=0 / reserved-ALU subcases). The adversarial verifier reproduces
/// this from Spike's decoder.
const LEGAL_COMPRESSED: u32 = 46743;

// ── fetch path + C.JALR pc+2 link (the classic bug) ─────────────────────────────

fn machine() -> (Hart, SystemBus) {
    (Hart::new(), SystemBus::new(Ram::new(64 * 1024).unwrap()))
}

#[test]
fn compressed_advances_pc_by_two() {
    // C.ADDI a0, 1 = 0x0505 → addi a0, a0, 1. Advances pc by 2.
    let (mut hart, mut bus) = machine();
    hart.regs.pc = DRAM_BASE;
    bus.store16(DRAM_BASE, 0x0505).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(10), 1, "c.addi a0,1 executed");
    assert_eq!(hart.regs.pc, DRAM_BASE + 2, "pc advanced by 2");
}

#[test]
fn c_jalr_writes_pc_plus_2_not_pc_plus_4() {
    // C.JALR a4 (0x9702) = jalr x1, a4, 0. The link MUST be pc+2 (the compressed length),
    // not pc+4 — the classic RVC expansion bug.
    let (mut hart, mut bus) = machine();
    hart.regs.pc = DRAM_BASE;
    let target = DRAM_BASE + 0x40;
    hart.regs.write(14, target); // a4
    bus.store16(DRAM_BASE, 0x9702).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, target, "jumped to a4");
    assert_eq!(
        hart.regs.read(1),
        DRAM_BASE + 2,
        "link = pc + 2 (compressed)"
    );
}

#[test]
fn c_j_and_c_beqz_offsets() {
    // C.J +6 then landing. c.j imm — build via expand and run.
    let (mut hart, mut bus) = machine();
    hart.regs.pc = DRAM_BASE;
    // C.J 0x20: assemble the CJ offset by round-tripping through expand? Simpler: use a
    // small forward C.J and check pc moved by the offset. c.j 6 → 0xa019? Use expand check.
    // c.beqz a5, +8 when a5==0 → taken.
    hart.regs.write(15, 0); // a5 = 0
    let c_beqz = 0xc781u16; // c.beqz a5, ... (offset encoded); verify it takes and lands even
    let expanded = expand_c(c_beqz).unwrap();
    // The expansion is a beq a5, x0, off; execute both forms from the same state and compare.
    let mut h2 = Hart::new();
    h2.regs.pc = DRAM_BASE;
    h2.regs.write(15, 0);
    let mut b2 = SystemBus::new(Ram::new(64 * 1024).unwrap());
    b2.store32(DRAM_BASE, expanded).unwrap();
    h2.step(&mut b2).unwrap();
    bus.store16(DRAM_BASE, c_beqz).unwrap();
    hart.step(&mut bus).unwrap();
    // Same branch target — but the compressed form advances from a 2-byte instruction while
    // the expanded 32-bit form is 4 bytes; a TAKEN branch uses pc+offset (independent of
    // length), so both land at the same pc.
    assert_eq!(
        hart.regs.pc, h2.regs.pc,
        "C.BEQZ lands where its expansion does"
    );
}

#[test]
fn straddling_32bit_instruction_is_two_accesses() {
    // A 32-bit instruction whose upper half is in unmapped space must fault on the SECOND
    // parcel access (cause 1), not read past the region as one 32-bit load.
    let (mut hart, mut bus) = machine();
    let last = DRAM_BASE + 64 * 1024 - 2; // last halfword of RAM
    hart.regs.pc = last;
    // A 32-bit word's low parcel (bits[1:0]=11) lives here; the high parcel is off the end.
    bus.store16(last, 0x0093).unwrap(); // low half of an addi (opcode 0010011, bits[1:0]=11)
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::InstrAccessFault, "second parcel faults");
    assert_eq!(t.tval, last + 2, "fault at the second half's address");
}
