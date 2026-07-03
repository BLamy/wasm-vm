//! E1-T06: RV64F semantics through the decoded instruction path — the acceptance traps
//! (NaN-boxing, FCVT saturation, reserved rounding modes, FMIN/MAX NaN/zero rules,
//! mstatus.FS gating, sticky fflags). rv64uf-p covers the bulk; these pin the corner cases.
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, FFLAGS};
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const OPFP: u32 = 0b1010011;

fn opfp(funct7: u32, funct3: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (funct7 << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (funct3 << 12)
        | ((rd as u32) << 7)
        | OPFP
}
// funct7 selectors.
const FADD: u32 = 0b0000000;
const FMINMAX: u32 = 0b0010100;
const FCVT_TO: u32 = 0b1100000; // rs2: 0=W 1=WU 2=L 3=LU
const FCMP: u32 = 0b1010000; // funct3: 0=LE 1=LT 2=EQ

/// A hart with FP enabled (mstatus.FS = Initial) and pc at DRAM_BASE, plus 64 KiB RAM.
fn fp_machine() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.csr.mstatus |= 1 << 13; // FS = Initial
    hart.regs.pc = DRAM_BASE;
    (hart, SystemBus::new(Ram::new(64 * 1024).unwrap()))
}
fn run1(hart: &mut Hart, bus: &mut SystemBus, word: u32) -> Result<(), wasm_vm_core::hart::Trap> {
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, word).unwrap();
    hart.step(bus)
}

const BOX: u64 = 0xFFFF_FFFF_0000_0000; // NaN-box prefix
const QNAN: u32 = 0x7fc0_0000;

#[test]
fn non_boxed_operand_is_canonical_nan() {
    let (mut hart, mut bus) = fp_machine();
    // f1 holds a non-boxed value (an f64 1.0 pattern sneaked in) → reads as canonical qNaN.
    hart.fregs.write_raw(1, 0x3ff0_0000_0000_0000);
    hart.fregs.write_raw(2, BOX | u64::from(0x3f80_0000u32)); // boxed 1.0f32
    // FADD.S f3, f1, f2 → qNaN + 1.0 = canonical qNaN, boxed.
    run1(&mut hart, &mut bus, opfp(FADD, 0, 3, 1, 2)).unwrap();
    assert_eq!(
        hart.fregs.read_f32(3),
        QNAN,
        "non-boxed operand behaves as qNaN"
    );
    // FEQ.S x5, f1, f1 → qNaN vs qNaN = 0 (and no NV for FEQ on a qNaN... but our f1 reads
    // as a *quiet* NaN, so no NV).
    run1(&mut hart, &mut bus, opfp(FCMP, 2, 5, 1, 1)).unwrap();
    assert_eq!(hart.regs.read(5), 0, "qNaN != qNaN");
}

#[test]
fn fcvt_w_s_saturates_nan_and_neg_inf() {
    let (mut hart, mut bus) = fp_machine();
    // NaN → 0x7FFF_FFFF (sign-extended), NV.
    hart.fregs.write_f32(1, QNAN);
    run1(&mut hart, &mut bus, opfp(FCVT_TO, 0 /*RNE*/, 5, 1, 0 /*W*/)).unwrap();
    assert_eq!(hart.regs.read(5), 0x0000_0000_7FFF_FFFF, "NaN → INT_MAX");
    assert_eq!(hart.csr.fflags & 0x10, 0x10, "NV set");
    // -inf → 0x8000_0000 (sign-extended to 0xFFFFFFFF80000000), NV.
    hart.csr.fflags = 0;
    hart.fregs.write_f32(1, 0xff80_0000);
    run1(&mut hart, &mut bus, opfp(FCVT_TO, 0, 6, 1, 0)).unwrap();
    assert_eq!(
        hart.regs.read(6),
        0xFFFF_FFFF_8000_0000,
        "-inf → INT_MIN, sign-extended"
    );
    assert_eq!(hart.csr.fflags & 0x10, 0x10, "NV set");
}

#[test]
fn reserved_rounding_modes_trap_at_execution() {
    let (mut hart, mut bus) = fp_machine();
    hart.fregs.write_f32(1, 0x3f80_0000);
    hart.fregs.write_f32(2, 0x4000_0000);
    // Static rm=5 and rm=6 are reserved → illegal instruction at execution.
    for rm in [5u32, 6] {
        let t = run1(&mut hart, &mut bus, opfp(FADD, rm, 3, 1, 2)).unwrap_err();
        assert_eq!(
            t.cause,
            Exception::IllegalInstruction,
            "static rm={rm} illegal"
        );
    }
    // rm=DYN(7) with a reserved frm also traps — at execution, not decode.
    hart.csr.frm = 5;
    let t = run1(&mut hart, &mut bus, opfp(FADD, 0b111, 3, 1, 2)).unwrap_err();
    assert_eq!(
        t.cause,
        Exception::IllegalInstruction,
        "DYN with frm=5 illegal"
    );
    // With a valid frm, DYN works.
    hart.csr.frm = 0;
    run1(&mut hart, &mut bus, opfp(FADD, 0b111, 3, 1, 2)).unwrap();
    assert_eq!(hart.fregs.read_f32(3), 0x4040_0000, "1.0+2.0 = 3.0");
}

#[test]
fn fmin_fmax_zero_and_snan_rules() {
    let (mut hart, mut bus) = fp_machine();
    // FMIN.S(-0.0, +0.0) = -0.0.
    hart.fregs.write_f32(1, 0x8000_0000); // -0.0
    hart.fregs.write_f32(2, 0x0000_0000); // +0.0
    run1(&mut hart, &mut bus, opfp(FMINMAX, 0 /*min*/, 3, 1, 2)).unwrap();
    assert_eq!(hart.fregs.read_f32(3), 0x8000_0000, "min(-0,+0) = -0");
    // FMAX.S(sNaN, 1.0) = 1.0 with NV set.
    hart.csr.fflags = 0;
    hart.fregs.write_f32(1, 0x7f80_0001); // sNaN
    hart.fregs.write_f32(2, 0x3f80_0000); // 1.0
    run1(&mut hart, &mut bus, opfp(FMINMAX, 1 /*max*/, 3, 1, 2)).unwrap();
    assert_eq!(hart.fregs.read_f32(3), 0x3f80_0000, "max(sNaN,1.0) = 1.0");
    assert_eq!(hart.csr.fflags & 0x10, 0x10, "sNaN raises NV");
}

#[test]
fn fs_off_traps_and_any_fp_op_marks_dirty() {
    // FS = Off (mstatus.FS = 0): FLW and an fcsr read both trap illegal.
    let mut hart = Hart::new();
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    hart.regs.pc = DRAM_BASE;
    assert_eq!(hart.csr.fs(), 0, "reset FS = Off");
    // FLW f1, 0(x0) — LOAD-FP funct3=010.
    let flw = (0b010 << 12) | (1 << 7) | 0b0000111;
    assert_eq!(
        run1(&mut hart, &mut bus, flw).unwrap_err().cause,
        Exception::IllegalInstruction
    );
    // csrr x1, fflags (csrrs x1, fflags, x0) with FS=Off → illegal.
    assert_eq!(
        hart.csr
            .access(FFLAGS, CsrOp::Set, 0, true, false, 0)
            .unwrap_err()
            .cause,
        Exception::IllegalInstruction
    );
    // Enable FP, run an FADD → FS becomes Dirty (3) and SD (bit 63) is set.
    hart.csr.mstatus |= 1 << 13;
    hart.fregs.write_f32(1, 0x3f80_0000);
    hart.fregs.write_f32(2, 0x3f80_0000);
    run1(&mut hart, &mut bus, opfp(FADD, 0, 3, 1, 2)).unwrap();
    assert_eq!(hart.csr.fs(), 3, "FP op marks FS Dirty");
    assert_ne!(hart.csr.mstatus & (1 << 63), 0, "SD bit set");
}

#[test]
fn fflags_are_sticky_until_cleared() {
    let (mut hart, mut bus) = fp_machine();
    // An inexact op sets NX; a later exact op must NOT clear it.
    hart.fregs.write_f32(1, 0x3f80_0000); // 1.0
    hart.fregs.write_f32(2, 0x4040_0000); // 3.0
    run1(&mut hart, &mut bus, opfp(0b0001100, 0, 3, 1, 2)).unwrap(); // fdiv.s → 1/3 inexact
    assert_eq!(hart.csr.fflags & 0x01, 0x01, "NX set");
    run1(&mut hart, &mut bus, opfp(FADD, 0, 4, 1, 1)).unwrap(); // 1.0+1.0 exact
    assert_eq!(
        hart.csr.fflags & 0x01,
        0x01,
        "NX still sticky after an exact op"
    );
    // Explicit fflags write clears.
    hart.csr
        .access(FFLAGS, CsrOp::Write, 0, false, true, 0)
        .unwrap();
    assert_eq!(hart.csr.fflags, 0, "explicit write clears fflags");
}
