//! E1-T04: RV64A atomics — the LR/SC reservation lifecycle, all 18 AMOs, and the
//! misalignment traps. Single-hart, so AMOs are plain read-modify-writes and aq/rl are
//! no-ops; the reservation policy (invalidate on overlapping store / xRET / WFI) is the
//! interesting surface and is exercised directly here.
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MEPC};
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const AMO: u32 = 0b0101111;
const W: u32 = 0b010;
const D: u32 = 0b011;
// funct5 selectors.
const F_LR: u32 = 0b00010;
const F_SC: u32 = 0b00011;
const F_SWAP: u32 = 0b00001;
const F_ADD: u32 = 0b00000;
const F_XOR: u32 = 0b00100;
const F_AND: u32 = 0b01100;
const F_OR: u32 = 0b01000;
const F_MIN: u32 = 0b10000;
const F_MAX: u32 = 0b10100;
const F_MINU: u32 = 0b11000;
const F_MAXU: u32 = 0b11100;

/// A data scratch area, doubleword-aligned, clear of the (tiny) code at DRAM_BASE.
const DATA: u64 = DRAM_BASE + 0x800;

fn amo(funct5: u32, f3: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    // aq=rl=0 for the semantic tests (all four combinations are covered by decode_props).
    (funct5 << 27)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((rd as u32) << 7)
        | AMO
}
/// `sw rs2, 0(rs1)` — an ordinary store, for the reservation-invalidation tests.
fn sw(rs1: u8, rs2: u8) -> u32 {
    ((rs2 as u32) << 20) | ((rs1 as u32) << 15) | (0b010 << 12) | 0b0100011
}

fn machine() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    // E1-T15: some tests MRET into U-mode (MPP=0) and keep executing; grant all-RAM PMP so the
    // U-mode fetch of the following instruction isn't denied before the atomic under test runs.
    hart.csr.pmp.allow_all();
    (hart, SystemBus::new(Ram::new(1024 * 1024).unwrap()))
}
fn load_code(bus: &mut SystemBus, instrs: &[u32]) {
    for (i, w) in instrs.iter().enumerate() {
        bus.store32(DRAM_BASE + 4 * i as u64, *w).unwrap();
    }
}

// ── LR/SC reservation lifecycle ─────────────────────────────────────────────────

#[test]
fn lr_then_sc_succeeds_and_writes() {
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 0x1111_1111).unwrap();
    hart.regs.write(10, DATA); // a0 = addr
    hart.regs.write(12, 0xABCD); // a2 = value to store
    hart.regs.pc = DRAM_BASE;
    load_code(
        &mut bus,
        &[amo(F_LR, W, 11, 10, 0), amo(F_SC, W, 11, 10, 12)],
    );
    hart.step(&mut bus).unwrap(); // lr.w a1, (a0)
    hart.step(&mut bus).unwrap(); // sc.w a1, a2, (a0)
    assert_eq!(hart.regs.read(11), 0, "SC success returns 0");
    assert_eq!(bus.load32(DATA).unwrap(), 0xABCD, "SC performed the store");
}

#[test]
fn store_between_lr_and_sc_forces_failure() {
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 0x1111_1111).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 0xABCD);
    hart.regs.write(13, 0x2222_2222); // a3 = the intervening store's value
    hart.regs.pc = DRAM_BASE;
    load_code(
        &mut bus,
        &[
            amo(F_LR, W, 11, 10, 0),
            sw(10, 13),               // sw a3, 0(a0) — invalidates the reservation
            amo(F_SC, W, 11, 10, 12), // sc.w a1, a2, (a0) — must fail
        ],
    );
    for _ in 0..3 {
        hart.step(&mut bus).unwrap();
    }
    assert_eq!(hart.regs.read(11), 1, "SC after overlapping store fails");
    assert_eq!(
        bus.load32(DATA).unwrap(),
        0x2222_2222,
        "SC wrote nothing; only the ordinary store landed"
    );
}

#[test]
fn sc_without_reservation_fails() {
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 0x1111_1111).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 0xABCD);
    hart.regs.pc = DRAM_BASE;
    load_code(&mut bus, &[amo(F_SC, W, 11, 10, 12)]);
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(11), 1, "SC with no LR fails");
    assert_eq!(bus.load32(DATA).unwrap(), 0x1111_1111, "memory untouched");
}

#[test]
fn back_to_back_sc_second_fails() {
    let (mut hart, mut bus) = machine();
    bus.store64(DATA, 0).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 0x55);
    hart.regs.write(14, 0x66);
    hart.regs.pc = DRAM_BASE;
    load_code(
        &mut bus,
        &[
            amo(F_LR, D, 11, 10, 0),
            amo(F_SC, D, 11, 10, 12), // first SC: succeeds, consumes reservation
            amo(F_SC, D, 13, 10, 14), // second SC: no reservation, fails
        ],
    );
    for _ in 0..3 {
        hart.step(&mut bus).unwrap();
    }
    assert_eq!(hart.regs.read(11), 0, "first SC succeeds");
    assert_eq!(hart.regs.read(13), 1, "second SC fails");
    assert_eq!(bus.load64(DATA).unwrap(), 0x55, "only the first SC wrote");
}

#[test]
fn width_mismatch_sc_fails_without_wrong_width_write() {
    // LR.W then SC.D at the same address: the reservation is (addr, 4) but SC.D wants
    // (addr, 8) → fail, and crucially NO 8-byte write happens.
    let (mut hart, mut bus) = machine();
    bus.store64(DATA, 0x0123_4567_89AB_CDEF).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 0xDEAD_BEEF_DEAD_BEEF);
    hart.regs.pc = DRAM_BASE;
    load_code(
        &mut bus,
        &[amo(F_LR, W, 11, 10, 0), amo(F_SC, D, 11, 10, 12)],
    );
    hart.step(&mut bus).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(
        hart.regs.read(11),
        1,
        "SC.D after LR.W fails (width mismatch)"
    );
    assert_eq!(
        bus.load64(DATA).unwrap(),
        0x0123_4567_89AB_CDEF,
        "no wrong-width write occurred"
    );
}

#[test]
fn mret_clears_the_reservation() {
    // LR, then MRET (jumps to mepc, which points at the SC), then the SC must fail.
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 0x1111_1111).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 0xABCD);
    hart.regs.pc = DRAM_BASE;
    // Point mepc at the SC at DRAM_BASE+8.
    hart.csr
        .access(MEPC, CsrOp::Write, DRAM_BASE + 8, false, false, 0)
        .unwrap();
    load_code(
        &mut bus,
        &[
            amo(F_LR, W, 11, 10, 0),  // DRAM_BASE
            0x3020_0073,              // mret  @ DRAM_BASE+4
            amo(F_SC, W, 11, 10, 12), // DRAM_BASE+8 (mepc target)
        ],
    );
    hart.step(&mut bus).unwrap(); // lr
    hart.step(&mut bus).unwrap(); // mret → pc = DRAM_BASE+8, reservation cleared
    assert_eq!(hart.regs.pc, DRAM_BASE + 8);
    hart.step(&mut bus).unwrap(); // sc → fails
    assert_eq!(hart.regs.read(11), 1, "SC after MRET fails");
    assert_eq!(bus.load32(DATA).unwrap(), 0x1111_1111, "memory untouched");
}

// ── AMO semantics ───────────────────────────────────────────────────────────────

/// Run a single AMO with mem[DATA]=`init`, a2=`rhs`; return (rd value, new mem word).
fn run_amo_w(funct5: u32, init: u32, rhs: u32) -> (u64, u32) {
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, init).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, rhs as u64);
    hart.regs.pc = DRAM_BASE;
    load_code(&mut bus, &[amo(funct5, W, 11, 10, 12)]);
    hart.step(&mut bus).unwrap();
    (hart.regs.read(11), bus.load32(DATA).unwrap())
}

#[test]
fn amoadd_w_wraps_and_sign_extends_old() {
    // old 0xFFFF_FFFF + 1 = 0 (wrap32); rd = sext(old) = all ones.
    let (rd, mem) = run_amo_w(F_ADD, 0xFFFF_FFFF, 1);
    assert_eq!(rd, 0xFFFF_FFFF_FFFF_FFFF, "rd = sign-extended old value");
    assert_eq!(mem, 0, "32-bit wrap");
}

#[test]
fn amo_min_max_w_signedness() {
    // AMOMIN.W signed: min(5, -1) = -1.
    let (rd, mem) = run_amo_w(F_MIN, 5, 0xFFFF_FFFF);
    assert_eq!(rd, 5);
    assert_eq!(mem, 0xFFFF_FFFF, "signed min picks -1");
    // AMOMAX.W signed: max(1, 0x8000_0000 = -2^31) = 1.
    let (_, mem) = run_amo_w(F_MAX, 1, 0x8000_0000);
    assert_eq!(mem, 1, "signed max treats 0x8000_0000 as negative");
    // AMOMAXU.W unsigned: max(1, 0x8000_0000) = 0x8000_0000.
    let (_, mem) = run_amo_w(F_MAXU, 1, 0x8000_0000);
    assert_eq!(mem, 0x8000_0000, "unsigned max treats 0x8000_0000 as large");
    // AMOMINU.W unsigned: min(1, 0x8000_0000) = 1.
    let (_, mem) = run_amo_w(F_MINU, 1, 0x8000_0000);
    assert_eq!(mem, 1);
}

#[test]
fn amo_bitops_and_swap_w() {
    assert_eq!(run_amo_w(F_SWAP, 0xAAAA, 0x5555).1, 0x5555);
    assert_eq!(run_amo_w(F_XOR, 0xF0F0, 0x00FF).1, 0xF00F);
    assert_eq!(run_amo_w(F_AND, 0xF0F0, 0x00FF).1, 0x00F0);
    assert_eq!(run_amo_w(F_OR, 0xF0F0, 0x00FF).1, 0xF0FF);
    // Old value returned regardless of op.
    assert_eq!(run_amo_w(F_SWAP, 0x1234, 0).0, 0x1234);
}

#[test]
fn amo_d_full_width() {
    let (mut hart, mut bus) = machine();
    bus.store64(DATA, 0x1000_0000_0000_0002).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 0x3);
    hart.regs.pc = DRAM_BASE;
    load_code(&mut bus, &[amo(F_ADD, D, 11, 10, 12)]);
    hart.step(&mut bus).unwrap();
    assert_eq!(
        hart.regs.read(11),
        0x1000_0000_0000_0002,
        "rd = old (64-bit)"
    );
    assert_eq!(bus.load64(DATA).unwrap(), 0x1000_0000_0000_0005);
}

#[test]
fn amo_aliasing_old_value_lands_in_rd() {
    // rd == rs2: AMOADD.W a2, a2, (a0). old must land in a2, not the sum.
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 10).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 5);
    hart.regs.pc = DRAM_BASE;
    load_code(&mut bus, &[amo(F_ADD, W, 12, 10, 12)]); // rd=rs2=a2
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(12), 10, "old value in rd even when rd==rs2");
    assert_eq!(bus.load32(DATA).unwrap(), 15, "memory got old+rhs");

    // rd == rs1: AMOADD.W a0, a2, (a0). address used before rd overwrite.
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 10).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 5);
    hart.regs.pc = DRAM_BASE;
    load_code(&mut bus, &[amo(F_ADD, W, 10, 10, 12)]); // rd=rs1=a0
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(10), 10, "old value in rd even when rd==rs1");
    assert_eq!(bus.load32(DATA).unwrap(), 15);
}

// ── misalignment traps ──────────────────────────────────────────────────────────

#[test]
fn misaligned_amo_and_sc_trap_store_cause_no_partial_write() {
    // AMO.W at addr%4 != 0 → StoreAddrMisaligned (cause 6), memory untouched.
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 0xCAFE_F00D).unwrap();
    hart.regs.write(10, DATA + 1); // misaligned
    hart.regs.write(12, 0);
    hart.regs.pc = DRAM_BASE;
    load_code(&mut bus, &[amo(F_ADD, W, 11, 10, 12)]);
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::StoreAddrMisaligned);
    assert_eq!(t.cause as u64, 6);
    assert_eq!(t.tval, DATA + 1, "mtval = faulting address");
    assert_eq!(bus.load32(DATA).unwrap(), 0xCAFE_F00D, "no partial write");

    // SC.D at addr%8 != 0 → cause 6.
    let (mut hart, mut bus) = machine();
    hart.regs.write(10, DATA + 4); // 8-misaligned
    hart.regs.pc = DRAM_BASE;
    load_code(&mut bus, &[amo(F_SC, D, 11, 10, 12)]);
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::StoreAddrMisaligned);
    assert_eq!(t.tval, DATA + 4);
}

#[test]
fn misaligned_lr_traps_load_cause() {
    // LR faults on the load side → LoadAddrMisaligned (cause 4).
    let (mut hart, mut bus) = machine();
    hart.regs.write(10, DATA + 2); // 4-misaligned
    hart.regs.pc = DRAM_BASE;
    load_code(&mut bus, &[amo(F_LR, W, 11, 10, 0)]);
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::LoadAddrMisaligned);
    assert_eq!(t.cause as u64, 4);
    assert_eq!(t.tval, DATA + 2);
    // LR.D 8-misaligned likewise.
    let (mut hart, mut bus) = machine();
    hart.regs.write(10, DATA + 4);
    hart.regs.pc = DRAM_BASE;
    load_code(&mut bus, &[amo(F_LR, D, 11, 10, 0)]);
    assert_eq!(
        hart.step(&mut bus).unwrap_err().cause,
        Exception::LoadAddrMisaligned
    );
}
