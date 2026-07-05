//! E1-T07: RV64D and the F↔D interaction corners — where the bugs live (NaN-boxing across
//! precisions, FCVT exactness/saturation, the format-conversion pair). rv64ud-p covers the
//! bulk; these pin the acceptance criteria.
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Hart;
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
// Selected D / conversion encodings.
fn fcvt_d_s(rd: u8, rs1: u8) -> u32 {
    opfp(0b0100001, 0, rd, rs1, 0)
}
fn fcvt_s_d(rd: u8, rs1: u8) -> u32 {
    opfp(0b0100000, 0, rd, rs1, 1)
}
fn fmv_x_d(rd: u8, rs1: u8) -> u32 {
    opfp(0b1110001, 0b000, rd, rs1, 0)
}
fn fcvt_to_int_d(rd: u8, rs1: u8, width: u8) -> u32 {
    opfp(0b1100001, 0, rd, rs1, width) // 0=W 1=WU 2=L 3=LU
}
fn fadd_s(rd: u8, rs1: u8, rs2: u8) -> u32 {
    opfp(0b0000000, 0, rd, rs1, rs2)
}
fn fclass_s(rd: u8, rs1: u8) -> u32 {
    opfp(0b1110000, 0b001, rd, rs1, 0)
}
fn fclass_d(rd: u8, rs1: u8) -> u32 {
    opfp(0b1110001, 0b001, rd, rs1, 0)
}
fn fminmax_d(is_max: bool, rd: u8, rs1: u8, rs2: u8) -> u32 {
    opfp(0b0010101, u32::from(is_max), rd, rs1, rs2)
}

fn fp_machine() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.csr.mstatus |= 1 << 13; // FS = Initial
    hart.regs.pc = DRAM_BASE;
    (hart, SystemBus::new(Ram::new(64 * 1024).unwrap()))
}
fn run1(hart: &mut Hart, bus: &mut SystemBus, w: u32) {
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, w).unwrap();
    hart.step(bus).unwrap();
}

const F64_QNAN: u64 = 0x7ff8_0000_0000_0000;

#[test]
fn fcvt_d_s_of_box_violating_operand_is_canonical_nan() {
    let (mut hart, mut bus) = fp_machine();
    // f1 holds a non-boxed value → the f32 read canonicalizes → widened f64 canonical qNaN.
    hart.fregs.write_raw(1, 0x1234_5678_9abc_def0);
    run1(&mut hart, &mut bus, fcvt_d_s(2, 1));
    assert_eq!(
        hart.fregs.read_raw(2),
        F64_QNAN,
        "box-violating f32 → f64 canonical qNaN"
    );
}

#[test]
fn fcvt_s_d_result_is_nan_boxed_and_overflows() {
    let (mut hart, mut bus) = fp_machine();
    // FCVT.S.D of 1e300 → +inf (OF|NX), and the f32 result is NaN-boxed.
    hart.fregs.write_raw(4, 1e300f64.to_bits());
    run1(&mut hart, &mut bus, fcvt_s_d(3, 4));
    assert_eq!(hart.fregs.read_f32(3), 0x7f80_0000, "1e300 → +inf f32");
    assert_eq!(hart.csr.fflags & 0x04, 0x04, "OF set");
    assert_eq!(hart.csr.fflags & 0x01, 0x01, "NX set");
    // FMV.X.D reads the raw 64-bit register: upper 32 bits must be all-ones (boxed).
    run1(&mut hart, &mut bus, fmv_x_d(5, 3));
    assert_eq!(hart.regs.read(5) >> 32, 0xFFFF_FFFF, "result NaN-boxed");
}

#[test]
fn fcvt_d_s_is_flag_clean_for_finite_f32() {
    // Property: widening any finite f32 to f64 is exact (no flags), over a random sweep.
    let (mut hart, mut bus) = fp_machine();
    let mut s: u64 = 0x5EED_2026_0707_0001;
    for _ in 0..200_000 {
        s = s.wrapping_mul(6364136223846793005).wrapping_add(1);
        let mut x = s as u32;
        if (x >> 23) & 0xFF == 0xFF {
            x &= 0x7f6f_ffff; // avoid inf/nan → those legitimately produce a NaN result
        }
        hart.fregs.write_f32(1, x);
        hart.csr.fflags = 0;
        run1(&mut hart, &mut bus, fcvt_d_s(2, 1));
        assert_eq!(
            hart.csr.fflags, 0,
            "FCVT.D.S of finite f32 {x:#010x} must be flag-clean"
        );
    }
}

#[test]
fn fcvt_to_int_d_saturation() {
    let (mut hart, mut bus) = fp_machine();
    // FCVT.L.D(NaN) → 0x7FFF_FFFF_FFFF_FFFF + NV.
    hart.fregs.write_raw(1, F64_QNAN);
    run1(&mut hart, &mut bus, fcvt_to_int_d(5, 1, 2 /*L*/));
    assert_eq!(hart.regs.read(5), 0x7FFF_FFFF_FFFF_FFFF, "NaN → i64::MAX");
    assert_eq!(hart.csr.fflags & 0x10, 0x10, "NV set");
    // FCVT.LU.D(-1.0) → 0 + NV.
    hart.csr.fflags = 0;
    hart.fregs.write_raw(1, (-1.0f64).to_bits());
    run1(&mut hart, &mut bus, fcvt_to_int_d(6, 1, 3 /*LU*/));
    assert_eq!(hart.regs.read(6), 0, "-1.0 → 0 (unsigned)");
    assert_eq!(hart.csr.fflags & 0x10, 0x10, "NV set");
}

#[test]
fn fmin_fmax_d_two_qnan_is_canonical() {
    let (mut hart, mut bus) = fp_machine();
    hart.fregs.write_raw(1, F64_QNAN);
    hart.fregs.write_raw(2, 0x7ff8_0000_0000_0007); // another qNaN
    run1(&mut hart, &mut bus, fminmax_d(false, 3, 1, 2));
    assert_eq!(
        hart.fregs.read_raw(3),
        F64_QNAN,
        "min(qNaN,qNaN) = canonical"
    );
    run1(&mut hart, &mut bus, fminmax_d(true, 4, 1, 2));
    assert_eq!(
        hart.fregs.read_raw(4),
        F64_QNAN,
        "max(qNaN,qNaN) = canonical"
    );
}

#[test]
fn f_d_register_aliasing() {
    let (mut hart, mut bus) = fp_machine();
    // Write an f64 into f1; an f32 op sees it as canonical qNaN, and FCLASS.S reports qNaN.
    hart.fregs.write_raw(1, 3.5f64.to_bits()); // upper bits not all-ones
    run1(&mut hart, &mut bus, fadd_s(2, 1, 1));
    assert_eq!(
        hart.fregs.read_f32(2),
        0x7fc0_0000,
        "f32 op on an f64 reg → qNaN"
    );
    run1(&mut hart, &mut bus, fclass_s(3, 1));
    assert_eq!(hart.regs.read(3), 1 << 9, "FCLASS.S → qNaN (bit 9)");
    // Reverse: a boxed f32 read as f64 uses the FULL 64-bit pattern (a negative NaN-space
    // value): 0xFFFFFFFF_xxxxxxxx has sign=1, exp=0x7FF, so FCLASS.D reports a NaN.
    hart.fregs.write_f32(4, 0x3f80_0000); // boxed 1.0f32 → raw 0xFFFFFFFF3F800000
    run1(&mut hart, &mut bus, fclass_d(5, 4));
    let cls = hart.regs.read(5);
    assert!(
        cls & ((1 << 8) | (1 << 9)) != 0,
        "boxed f32 as f64 classifies as a NaN, got {cls:#x}"
    );
}
