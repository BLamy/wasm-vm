//! E1-T06: RV64F must behave identically on wasm32 — the softfloat backend is deterministic
//! (no host float), so decoded FP execution matches native bit-for-bit.
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
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

fn machine() -> (Hart, SystemBus) {
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

#[wasm_bindgen_test]
fn rv64f_is_deterministic_on_wasm32() {
    let (mut hart, mut bus) = machine();
    hart.fregs.write_f32(1, 0x3f80_0000); // 1.0
    hart.fregs.write_f32(2, 0x4040_0000); // 3.0
    // FDIV.S f3 = 1/3 (inexact) → matches native bits, NX set.
    run1(&mut hart, &mut bus, opfp(0b0001100, 0, 3, 1, 2));
    assert_eq!(hart.fregs.read_f32(3), 0x3eaa_aaab);
    assert_eq!(hart.csr.fflags & 0x01, 0x01);

    // Non-boxed operand → canonical qNaN.
    hart.fregs.write_raw(4, 0x3ff0_0000_0000_0000);
    run1(&mut hart, &mut bus, opfp(0b0000000, 0, 5, 4, 1)); // fadd.s f5, f4, f1
    assert_eq!(hart.fregs.read_f32(5), 0x7fc0_0000);

    // FCVT.W.S of NaN → 0x7FFF_FFFF + NV.
    hart.csr.fflags = 0;
    hart.fregs.write_f32(6, 0x7fc0_0000);
    run1(&mut hart, &mut bus, opfp(0b1100000, 0, 7, 6, 0));
    assert_eq!(hart.regs.read(7), 0x0000_0000_7FFF_FFFF);
    assert_eq!(hart.csr.fflags & 0x10, 0x10);

    // FSQRT.S(2.0) matches native.
    hart.fregs.write_f32(8, 0x4000_0000); // 2.0
    run1(&mut hart, &mut bus, opfp(0b0101100, 0, 9, 8, 0));
    assert_eq!(hart.fregs.read_f32(9), 0x3fb5_04f3, "sqrt(2)");
}
