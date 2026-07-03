//! E1-T07: RV64D must be bit-identical on wasm32 (determinism pre-test for T22) — the F64
//! softfloat backend is host-float-free, so decoded D execution matches native exactly.
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const OPFP: u32 = 0b1010011;
fn opfp(f7: u32, f3: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (f7 << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((rd as u32) << 7)
        | OPFP
}
fn machine() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.csr.mstatus |= 1 << 13;
    hart.regs.pc = DRAM_BASE;
    (hart, SystemBus::new(Ram::new(64 * 1024).unwrap()))
}
fn run1(hart: &mut Hart, bus: &mut SystemBus, w: u32) {
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, w).unwrap();
    hart.step(bus).unwrap();
}

#[wasm_bindgen_test]
fn rv64d_is_deterministic_on_wasm32() {
    let (mut hart, mut bus) = machine();
    hart.fregs.write_raw(1, 1.0f64.to_bits());
    hart.fregs.write_raw(2, 3.0f64.to_bits());
    // FDIV.D f3 = 1/3 (inexact) — matches native bits + NX.
    run1(&mut hart, &mut bus, opfp(0b0001101, 0, 3, 1, 2));
    assert_eq!(hart.fregs.read_raw(3), 0x3fd5_5555_5555_5555);
    assert_eq!(hart.csr.fflags & 0x01, 0x01);

    // FSQRT.D(2.0) matches native.
    hart.fregs.write_raw(4, 2.0f64.to_bits());
    run1(&mut hart, &mut bus, opfp(0b0101101, 0, 5, 4, 0));
    assert_eq!(hart.fregs.read_raw(5), 0x3ff6_a09e_667f_3bcd, "sqrt(2)");

    // FCVT.S.D(1e300) → +inf f32, NaN-boxed, OF|NX.
    hart.csr.fflags = 0;
    hart.fregs.write_raw(6, 1e300f64.to_bits());
    run1(&mut hart, &mut bus, opfp(0b0100000, 0, 7, 6, 1));
    assert_eq!(hart.fregs.read_f32(7), 0x7f80_0000);
    assert_eq!(hart.fregs.read_raw(7) >> 32, 0xFFFF_FFFF, "boxed");
    assert_eq!(hart.csr.fflags & 0x05, 0x05, "OF|NX");

    // FCVT.D.S widening is exact (box-checked input).
    hart.csr.fflags = 0;
    hart.fregs.write_f32(8, 0x3f80_0000); // 1.0f32
    run1(&mut hart, &mut bus, opfp(0b0100001, 0, 9, 8, 0));
    assert_eq!(hart.fregs.read_raw(9), 1.0f64.to_bits());
    assert_eq!(hart.csr.fflags, 0, "widening is exact");
}
