//! E0-T09 control-flow matrix: JAL/JALR/branch semantics per §2.5, link ordering,
//! bit-0 clearing, taken-only misalignment traps, and range edges.

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

// 4 MiB natively (J-type ±1 MiB edges must land inside RAM); 64 KiB under miri —
// zeroing 4 MiB per machine() under interpretation is the E0-T07 pathological case.
// The one test needing the ±1 MiB reach is #[cfg_attr(miri, ignore)]d with rationale.
const RAM: u64 = if cfg!(miri) {
    64 * 1024
} else {
    4 * 1024 * 1024
};
const RAM_END: u64 = DRAM_BASE + RAM;
const CODE: u64 = DRAM_BASE + if cfg!(miri) { 0x1000 } else { 0x0010_0000 };

fn machine() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.regs.pc = CODE;
    (hart, SystemBus::new(Ram::new(RAM as usize).unwrap()))
}

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn jalr(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, 0b1100111)
}
/// J-type encoder (imm[20|10:1|11|19:12] scramble), even imm in ±1 MiB.
fn jal(rd: u8, imm: i64) -> u32 {
    assert!((-1048576..=1048574).contains(&imm) && imm % 2 == 0);
    let u = imm as u32;
    (((u >> 20) & 1) << 31)
        | (((u >> 1) & 0x3FF) << 21)
        | (((u >> 11) & 1) << 20)
        | (((u >> 12) & 0xFF) << 12)
        | ((rd as u32) << 7)
        | 0b1101111
}
/// B-type encoder (imm[12|10:5|4:1|11] scramble), even imm in ±4 KiB.
fn b_type(f3: u32, rs1: u8, rs2: u8, imm: i64) -> u32 {
    assert!((-4096..=4094).contains(&imm) && imm % 2 == 0);
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

// ── acceptance anchors ──────────────────────────────────────────────────────

#[test]
fn jal_links_and_jumps_acceptance() {
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, jal(1, 8)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(1), CODE + 4, "link = pc + 4");
    assert_eq!(hart.regs.pc, CODE + 8);
}

#[test]
fn jal_x0_zero_self_loops_forever_acceptance() {
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, jal(0, 0)).unwrap();
    for _ in 0..1000 {
        hart.step(&mut bus).unwrap();
        assert_eq!(hart.regs.pc, CODE, "self-loop PC must be stable");
        assert_eq!(hart.regs.read(0), 0);
    }
}

#[test]
fn jalr_bit0_clear_to_2mod4_target_lands_under_ialign16() {
    // jalr x1, 3(x2) with x2 4-aligned: target = (x2 + 3) & !1 = x2 + 2 (2-mod-4). With the
    // C extension IALIGN=16 (E1-T08), a 2-mod-4 target is LEGAL — the jump lands (bit 0 is
    // still cleared per JALR) and writes the link. (An odd target can never arise: JALR
    // masks bit 0, and JAL/branch immediates are even.)
    let (mut hart, mut bus) = machine();
    let x2 = DRAM_BASE + 0x100; // 4-aligned
    hart.regs.write(2, x2);
    bus.store32(CODE, jalr(1, 2, 3)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(
        hart.regs.pc,
        x2 + 2,
        "lands at the bit-0-cleared 2-mod-4 target"
    );
    assert_eq!(hart.regs.read(1), CODE + 4, "link = pc + 4");
}

#[test]
fn jalr_rd_equals_rs1_uses_old_value_acceptance() {
    // jalr x5, 0(x5): target from OLD x5, then link written over it.
    let (mut hart, mut bus) = machine();
    let target = DRAM_BASE + 0x200; // 4-aligned, mapped
    hart.regs.write(5, target);
    bus.store32(CODE, jalr(5, 5, 0)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, target, "target computed from OLD rs1");
    assert_eq!(hart.regs.read(5), CODE + 4, "then link written to rd");
}

#[test]
fn blt_vs_bltu_disagree_exactly_on_sign_boundary_acceptance() {
    // (a, b, blt_taken, bltu_taken)
    let table: &[(u64, u64, bool, bool)] = &[
        (0, 1, true, true),
        (1, 0, false, false),
        (u64::MAX, 0, true, false),              // -1 <s 0 ; MAX >u 0
        (0, u64::MAX, false, true),              // 0 >s -1 ; 0 <u MAX
        (i64::MIN as u64, 1, true, false),       // MIN <s 1 ; huge >u 1
        (1, i64::MIN as u64, false, true),       // 1 >s MIN ; 1 <u huge
        (i64::MIN as u64, u64::MAX, true, true), // MIN <s -1 ; and 0x8000… <u 0xFFFF…
        (5, 5, false, false),
    ];
    for &(a, b, blt_t, bltu_t) in table {
        for (f3, taken) in [(0b100u32, blt_t), (0b110, bltu_t)] {
            let (mut hart, mut bus) = machine();
            hart.regs.write(2, a);
            hart.regs.write(3, b);
            bus.store32(CODE, b_type(f3, 2, 3, 8)).unwrap();
            hart.step(&mut bus).unwrap();
            let expect = if taken { CODE + 8 } else { CODE + 4 };
            assert_eq!(hart.regs.pc, expect, "f3={f3:#b} a={a:#x} b={b:#x}");
        }
    }
}

#[test]
fn fence_retires_pc_plus_4_acceptance() {
    for word in [0x0FF0_000Fu32, 0x0330_000F, 0x8330_000F] {
        let (mut hart, mut bus) = machine();
        bus.store32(CODE, word).unwrap();
        hart.step(&mut bus).unwrap();
        assert_eq!(hart.regs.pc, CODE + 4);
    }
}

// ── §2.5 misalignment ordering ──────────────────────────────────────────────

#[test]
fn taken_branch_to_pc_plus_2_lands_not_taken_retires() {
    // beq x2, x3, +2. With IALIGN=16 the taken branch LANDS at pc+2 (a legal target).
    let word = b_type(0b000, 2, 3, 2);
    let (mut hart, mut bus) = machine();
    hart.regs.write(2, 7);
    hart.regs.write(3, 7);
    bus.store32(CODE, word).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(
        hart.regs.pc,
        CODE + 2,
        "taken branch to pc+2 lands (IALIGN=16)"
    );
    // not taken: x2 != x3 → retires normally, pc += 4
    let (mut hart, mut bus) = machine();
    hart.regs.write(2, 7);
    hart.regs.write(3, 8);
    bus.store32(CODE, word).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, CODE + 4);
}

#[test]
fn jal_to_2mod4_target_lands_under_ialign16() {
    // JAL to a 2-mod-4 target is legal with IALIGN=16 — it lands and writes the link.
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, jal(1, 6)).unwrap(); // target = pc + 6 (2-mod-4)
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, CODE + 6, "lands (IALIGN=16)");
    assert_eq!(hart.regs.read(1), CODE + 4, "link = pc + 4");
}

#[test]
fn cause_0_vs_cause_1_distinction_at_ram_end() {
    // Adversarial angle 4: taken branch in the last word of RAM targeting
    // ram_end + 4 (ALIGNED) — the branch itself retires; the NEXT step
    // fetch-faults cause 1 at the target.
    let (mut hart, mut bus) = machine();
    let last = RAM_END - 4;
    hart.regs.pc = last;
    bus.store32(last, b_type(0b000, 0, 0, 8)).unwrap(); // beq x0,x0,+8 → taken
    hart.step(&mut bus).unwrap();
    assert_eq!(
        hart.regs.pc,
        RAM_END + 4,
        "aligned out-of-RAM target: branch retires"
    );
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(
        t.cause,
        Exception::InstrAccessFault,
        "the FETCH faults, cause 1"
    );
    assert_eq!(t.tval, RAM_END + 4);
}

// ── range edges ─────────────────────────────────────────────────────────────

#[test]
#[cfg_attr(miri, ignore)] // needs the 4 MiB native RAM for ±1 MiB J-targets; the
// arithmetic paths it walks (imm scrambles, wrapping pc) run under miri in the
// misalignment and loop tests above
fn branch_and_jal_range_edges() {
    // B-type ±4 KiB (aligned variants of the extremes: +4092, -4096).
    for imm in [4092i64, -4096] {
        let (mut hart, mut bus) = machine();
        bus.store32(CODE, b_type(0b000, 0, 0, imm)).unwrap();
        hart.step(&mut bus).unwrap();
        assert_eq!(hart.regs.pc, CODE.wrapping_add(imm as u64), "B imm={imm}");
    }
    // The 2-mod-4 extreme (+4094) is a LEGAL target under IALIGN=16 → it lands.
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, b_type(0b000, 0, 0, 4094)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(
        hart.regs.pc,
        CODE + 4094,
        "2-mod-4 branch target lands (IALIGN=16)"
    );

    // J-type ±1 MiB: -1048576 and +1048574 (2-mod-4) both land under IALIGN=16.
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, jal(0, -1048576)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, CODE - 1048576);
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, jal(0, 1048574)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, CODE + 1048574, "2-mod-4 jal target lands");
    // +1048572: max positive ALIGNED J target lands.
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, jal(0, 1048572)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, CODE + 1048572);
}

// ── programs: call/return and loops ─────────────────────────────────────────

#[test]
fn call_return_chain_three_deep() {
    // main: call f1; f1: call f2; f2: call f3; f3: ret; ... unwinds via ra
    // then x31 = 0xAA marks completion. Uses jal ra and ret (jalr x0, 0(ra)).
    let (mut hart, mut bus) = machine();
    let f1 = CODE + 0x100;
    let f2 = CODE + 0x200;
    let f3 = CODE + 0x300;
    // main at CODE: jal x1, f1 ; addi x31, x0, 0xAA (executed after return)
    bus.store32(CODE, jal(1, (f1 - CODE) as i64)).unwrap();
    bus.store32(CODE + 4, i_type(0xAA, 0, 0b000, 31, 0b0010011))
        .unwrap();
    // f1: save ra in x10; jal x1, f2; restore; ret
    bus.store32(f1, i_type(0, 1, 0b000, 10, 0b0010011)).unwrap(); // mv x10, x1
    bus.store32(f1 + 4, jal(1, (f2 - (f1 + 4)) as i64)).unwrap();
    bus.store32(f1 + 8, i_type(0, 10, 0b000, 1, 0b0010011))
        .unwrap(); // mv x1, x10
    bus.store32(f1 + 12, jalr(0, 1, 0)).unwrap(); // ret
    // f2: save ra in x11; jal x1, f3; restore; ret
    bus.store32(f2, i_type(0, 1, 0b000, 11, 0b0010011)).unwrap();
    bus.store32(f2 + 4, jal(1, (f3 - (f2 + 4)) as i64)).unwrap();
    bus.store32(f2 + 8, i_type(0, 11, 0b000, 1, 0b0010011))
        .unwrap();
    bus.store32(f2 + 12, jalr(0, 1, 0)).unwrap();
    // f3: ret immediately
    bus.store32(f3, jalr(0, 1, 0)).unwrap();

    for _ in 0..12 {
        if hart.regs.read(31) == 0xAA {
            break;
        }
        hart.step(&mut bus).unwrap();
    }
    assert_eq!(hart.regs.read(31), 0xAA, "call/return chain did not unwind");
    assert_eq!(hart.regs.pc, CODE + 8);
}

#[test]
fn countdown_loop_executes_exact_iteration_count() {
    // x2 = 5; loop: addi x2, x2, -1 ; bne x2, x0, loop ; addi x31, x0, 1
    let (mut hart, mut bus) = machine();
    hart.regs.write(2, 5);
    bus.store32(CODE, i_type(-1, 2, 0b000, 2, 0b0010011))
        .unwrap();
    bus.store32(CODE + 4, b_type(0b001, 2, 0, -4)).unwrap();
    bus.store32(CODE + 8, i_type(1, 0, 0b000, 31, 0b0010011))
        .unwrap();
    let mut steps = 0;
    while hart.regs.read(31) == 0 && steps < 100 {
        hart.step(&mut bus).unwrap();
        steps += 1;
    }
    assert_eq!(hart.regs.read(2), 0);
    assert_eq!(steps, 11, "5 iterations x 2 + final addi = 11 retirements");
}
