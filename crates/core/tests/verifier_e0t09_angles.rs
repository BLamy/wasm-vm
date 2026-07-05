//! E0-T09 adversarial verifier — control-flow attacks with the verifier's own
//! encodings, seeds, and a spec-first Python differential model (angle 1
//! substitute for Spike, per project precedent; Spike re-runs at E0-T13).
#[path = "torture_data.rs"]
mod torture_data;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::decode::{Instr, decode};
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const RAM: u64 = 4 * 1024 * 1024;
const CODE: u64 = DRAM_BASE + 0x1000;

fn machine() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.regs.pc = CODE;
    (hart, SystemBus::new(Ram::new(RAM as usize).unwrap()))
}

/// Verifier's own B-type encoder (re-derived from the spec scramble table).
fn b_enc(f3: u32, rs1: u8, rs2: u8, imm: i64) -> u32 {
    let u = imm as u32;
    (((u >> 12) & 1) << 31)
        | (((u >> 5) & 0x3F) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | (((u >> 1) & 0xF) << 8)
        | (((u >> 11) & 1) << 7)
        | 0b1100011
}
fn jal_enc(rd: u8, imm: i64) -> u32 {
    let u = imm as u32;
    (((u >> 20) & 1) << 31)
        | (((u >> 1) & 0x3FF) << 21)
        | (((u >> 11) & 1) << 20)
        | (((u >> 12) & 0xFF) << 12)
        | ((rd as u32) << 7)
        | 0b1101111
}
fn jalr_enc(rd: u8, rs1: u8, imm: i32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | ((rd as u32) << 7) | 0b1100111
}

// ── SUITE-EDIT AUDIT: the three words removed from the trap tables must now
// retire or fault per the NEW semantics — never IllegalInstruction. ──────────
#[test]
fn audit_removed_placeholder_words_now_execute() {
    // 0x008000EF = jal x1, +8 (golden, decode_golden.rs) — retires.
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, 0x008000EF).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, CODE + 8);
    assert_eq!(hart.regs.read(1), CODE + 4);

    // 0x00008067 = jalr x0, 0(x1) (ret) — with aligned mapped x1 it retires.
    let (mut hart, mut bus) = machine();
    hart.regs.write(1, CODE + 0x40);
    bus.store32(CODE, 0x00008067).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, CODE + 0x40);

    // 0x00208463 = beq x1, x2, +8 — taken and not-taken both retire.
    for (a, b, dst) in [(7u64, 7u64, CODE + 8), (7, 9, CODE + 4)] {
        let (mut hart, mut bus) = machine();
        hart.regs.write(1, a);
        hart.regs.write(2, b);
        bus.store32(CODE, 0x00208463).unwrap();
        hart.step(&mut bus).unwrap();
        assert_eq!(hart.regs.pc, dst);
    }
    // And confirm the replacement words decode to what the comment claims,
    // via the project's own verified decoder.
    assert_eq!(
        decode(0x0000_0163).unwrap(),
        Instr::Beq {
            rs1: 0,
            rs2: 0,
            imm: 2
        }
    );
    assert_eq!(
        decode(0x0011_00E7).unwrap(),
        Instr::Jalr {
            rd: 1,
            rs1: 2,
            imm: 1
        }
    );
}

// ── ANGLE 1 SUBSTITUTE: spec-first differential on the torture blob ─────────
#[test]
fn torture_blob_full_pc_trace_matches_spec_model() {
    let (mut hart, mut bus) = machine();
    hart.regs.pc = torture_data::TORTURE_BASE;
    for &(a, w) in torture_data::WORDS {
        bus.store32(a, w).unwrap();
    }
    let trace = torture_data::PC_TRACE;
    for (i, &want_pc) in trace.iter().enumerate() {
        assert_eq!(
            hart.regs.pc, want_pc,
            "pc trace diverged at retirement {i} (model {want_pc:#x}, hart {:#x})",
            hart.regs.pc
        );
        if i + 1 < trace.len() {
            hart.step(&mut bus).unwrap();
        }
    }
    for (n, &want) in torture_data::FINAL_REGS.iter().enumerate() {
        assert_eq!(hart.regs.read(n as u8), want, "x{n} final value");
    }
}

// ── ANGLE 2: misaligned-trap ordering, all six predicates + jal + jalr ──────
#[test]
fn taken_misaligned_traps_purely_all_predicates_and_jumps() {
    // operand pairs chosen so each predicate is TAKEN
    let taken: &[(u32, u64, u64)] = &[
        (0b000, 9, 9),        // beq
        (0b001, 9, 8),        // bne
        (0b100, u64::MAX, 0), // blt  (-1 <s 0)
        (0b101, 0, u64::MAX), // bge  (0 >=s -1)
        (0b110, 1, u64::MAX), // bltu (1 <u MAX)
        (0b111, u64::MAX, 1), // bgeu
    ];
    for &(f3, a, b) in taken {
        let (mut hart, mut bus) = machine();
        hart.regs.write(6, a);
        hart.regs.write(7, b);
        bus.store32(CODE, b_enc(f3, 6, 7, 0x156)).unwrap(); // +342 ≡ 2 mod 4
        let before = format!("{}", hart.regs);
        let t = hart.step(&mut bus).expect_err("must trap");
        assert_eq!(t.cause, Exception::InstrAddrMisaligned, "f3={f3:#b}");
        assert_eq!(t.tval, CODE + 0x156, "f3={f3:#b} tval = target");
        assert_eq!(hart.regs.pc, CODE, "f3={f3:#b} pc = branch's own address");
        assert_eq!(format!("{}", hart.regs), before, "f3={f3:#b} state mutated");
    }
    // not-taken with the SAME misaligned encodings: swap operands per predicate
    let not_taken: &[(u32, u64, u64)] = &[
        (0b000, 9, 8),
        (0b001, 9, 9),
        (0b100, 0, u64::MAX),
        (0b101, u64::MAX, 0),
        (0b110, u64::MAX, 1),
        (0b111, 1, u64::MAX),
    ];
    for &(f3, a, b) in not_taken {
        let (mut hart, mut bus) = machine();
        hart.regs.write(6, a);
        hart.regs.write(7, b);
        bus.store32(CODE, b_enc(f3, 6, 7, 0x156)).unwrap();
        hart.step(&mut bus)
            .unwrap_or_else(|t| panic!("not-taken f3={f3:#b} trapped: {t:?}"));
        assert_eq!(hart.regs.pc, CODE + 4, "f3={f3:#b} falls through");
    }
    // jal: link register must keep its OLD value through the trap
    let (mut hart, mut bus) = machine();
    hart.regs.write(3, 0xFEED);
    bus.store32(CODE, jal_enc(3, 0x15A)).unwrap(); // ≡ 2 mod 4
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::InstrAddrMisaligned);
    assert_eq!(t.tval, CODE + 0x15A);
    assert_eq!(hart.regs.read(3), 0xFEED);
    assert_eq!(hart.regs.pc, CODE);
    // jalr rd==rs1 on the TRAP path: rs1 must survive untouched
    let (mut hart, mut bus) = machine();
    hart.regs.write(9, CODE + 0x202); // even, ≡ 2 mod 4
    bus.store32(CODE, jalr_enc(9, 9, 0)).unwrap();
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::InstrAddrMisaligned);
    assert_eq!(t.tval, CODE + 0x202);
    assert_eq!(
        hart.regs.read(9),
        CODE + 0x202,
        "rd==rs1 unmodified on trap"
    );
}

// ── ANGLE 3: range edges via hand-derived + golden encodings ────────────────
#[test]
fn range_edges_via_golden_words() {
    // 0x7E000FE3 (decode_golden) = beq x0,x0,+4094 — hand check of the scramble:
    // bit31=0(imm12) f7=0x3F(imm10:5=0b111111) rs2=0 rs1=0 f3=0 bits11:8=0xF
    // (imm4:1) bit7=1(imm11) → imm = 0b0111111111110 = 4094. Taken → cause 0.
    assert_eq!(b_enc(0, 0, 0, 4094), 0x7E00_0FE3, "encoder vs golden word");
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, 0x7E00_0FE3).unwrap();
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::InstrAddrMisaligned);
    assert_eq!(t.tval, CODE + 4094);

    // -4096: imm12=1 only → 0x80000063. Aligned → lands exactly. Place pc so
    // the target is mapped: pc = DRAM_BASE + 0x2000.
    assert_eq!(b_enc(0, 0, 0, -4096), 0x8000_0063);
    let (mut hart, mut bus) = machine();
    let pc = DRAM_BASE + 0x2000;
    hart.regs.pc = pc;
    bus.store32(pc, 0x8000_0063).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, pc - 4096);

    // JAL +1048574 = 0x7FFFF06F (golden): odd extreme → cause 0, exact tval.
    assert_eq!(jal_enc(0, 1048574), 0x7FFF_F06F);
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, 0x7FFF_F06F).unwrap();
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::InstrAddrMisaligned);
    assert_eq!(t.tval, CODE + 1048574);

    // JAL -1048576 = 0x8000006F (golden): aligned extreme lands exactly.
    assert_eq!(jal_enc(0, -1048576), 0x8000_006F);
    let (mut hart, mut bus) = machine();
    let pc = DRAM_BASE + 0x0018_0000; // target DRAM_BASE+0x80000, mapped in 4 MiB
    hart.regs.pc = pc;
    bus.store32(pc, 0x8000_006F).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, pc - 1048576);

    // +1048572: max ALIGNED positive J immediate lands exactly.
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, jal_enc(0, 1048572)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, CODE + 1048572);
}

// ── ANGLE 4: cause 0 vs cause 1 with JALR, incl. unmapped+misaligned ────────
#[test]
fn jalr_cause0_vs_cause1_even_when_target_unmapped() {
    let unmapped_aligned = 0x4000u64; // in the hole, 4-aligned
    let unmapped_odd = 0x4002u64; // in the hole, ≡ 2 mod 4

    // aligned unmapped: the JALR RETIRES (link written, pc moved); the NEXT
    // step fetch-faults cause 1 at the target.
    let (mut hart, mut bus) = machine();
    hart.regs.write(2, unmapped_aligned);
    bus.store32(CODE, jalr_enc(1, 2, 0)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, unmapped_aligned, "jump itself retires");
    assert_eq!(hart.regs.read(1), CODE + 4, "link written");
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::InstrAccessFault, "fetch faults cause 1");
    assert_eq!(t.tval, unmapped_aligned);

    // odd unmapped: alignment is checked AT THE JUMP → cause 0 immediately,
    // link unwritten, pc unmoved — mapping never consulted.
    let (mut hart, mut bus) = machine();
    hart.regs.write(1, 0xC0DE);
    hart.regs.write(2, unmapped_odd);
    bus.store32(CODE, jalr_enc(1, 2, 0)).unwrap();
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::InstrAddrMisaligned, "cause 0, not 1");
    assert_eq!(t.tval, unmapped_odd);
    assert_eq!(hart.regs.read(1), 0xC0DE);
    assert_eq!(hart.regs.pc, CODE);
}

// ── NOVEL: jalr bit-0 clear must RESCUE an odd rs1 (spec's &!1 is not a trap
// precondition — an odd pointer with a compensating target lands fine), and
// wrapping jalr arithmetic (rs1 near u64::MAX + positive imm) wraps mod 2^64. ──
#[test]
fn novel_jalr_bit0_rescue_and_wrapping_target() {
    // x2 = CODE + 0x41 (odd). jalr x1, 3(x2): target = (CODE+0x44) & !1 =
    // CODE+0x44, 4-aligned → RETIRES. A wrong order (align-check before &!1,
    // or trapping on odd rs1) would trap here.
    let (mut hart, mut bus) = machine();
    hart.regs.write(2, CODE + 0x41);
    bus.store32(CODE, jalr_enc(1, 2, 3)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, CODE + 0x44, "odd rs1 rescued by &!1");
    assert_eq!(hart.regs.read(1), CODE + 4);

    // wrapping: rs1 = -8 (u64), imm = +8 → target 0 (aligned, unmapped):
    // retires, then fetch-faults cause 1 at 0 — not a panic, not cause 0.
    let (mut hart, mut bus) = machine();
    hart.regs.write(2, (-8i64) as u64);
    bus.store32(CODE, jalr_enc(1, 2, 8)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, 0, "wrapped to zero");
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::InstrAccessFault);
    assert_eq!(t.tval, 0);

    // wrapping the OTHER way: pc-relative branch backward past 0 is impossible
    // here, but jal with negative imm from low pc wraps mod 2^64: pc=DRAM_BASE,
    // jal -1048576 → target < DRAM_BASE, unmapped, ALIGNED → retires then cause 1.
    let (mut hart, mut bus) = machine();
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, jal_enc(0, -1048576)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, DRAM_BASE - 1048576);
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::InstrAccessFault);
}
