//! wasm32 mirror of the E0-T08 load/store matrix (`wasm-pack test --node`).

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const RAM: u64 = 64 * 1024;
const CODE: u64 = DRAM_BASE;
const DATA: u64 = DRAM_BASE + 0x1000;

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn s_type(imm: i32, rs2: u8, rs1: u8, f3: u32) -> u32 {
    let iu = (imm as u32) & 0xFFF;
    ((iu >> 5) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((iu & 0x1F) << 7)
        | 0b0100011
}

fn machine() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.regs.pc = CODE;
    (hart, SystemBus::new(Ram::new(RAM as usize).unwrap()))
}

#[wasm_bindgen_test]
fn extension_and_roundtrip_on_wasm32() {
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 0xFFFF_FFFF).unwrap();
    hart.regs.write(2, DATA);

    // lw sign-extends
    bus.store32(CODE, i_type(0, 2, 0b010, 1, 0b0000011))
        .unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(1), 0xFFFF_FFFF_FFFF_FFFF);

    // lwu zero-extends
    hart.regs.pc = CODE;
    bus.store32(CODE, i_type(0, 2, 0b110, 1, 0b0000011))
        .unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(1), 0x0000_0000_FFFF_FFFF);

    // sd then ld roundtrip
    hart.regs.pc = CODE;
    hart.regs.write(3, 0xDEAD_BEEF_CAFE_F00D);
    bus.store32(CODE, s_type(8, 3, 2, 0b011)).unwrap();
    hart.step(&mut bus).unwrap();
    hart.regs.pc = CODE;
    bus.store32(CODE, i_type(8, 2, 0b011, 4, 0b0000011))
        .unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(4), 0xDEAD_BEEF_CAFE_F00D);
}

#[wasm_bindgen_test]
fn misaligned_ram_succeeds_and_fault_purity_on_wasm32() {
    // E1-T26: misaligned scalar loads/stores to RAM now SUCCEED on wasm too (byte-decomposed),
    // identical to native — this test used to expect *AddrMisaligned faults.
    let (mut hart, mut bus) = machine();
    hart.regs.write(2, DATA);
    hart.regs.write(3, 0x0123_4567_89AB_CDEF);
    bus.store32(CODE, s_type(4, 3, 2, 0b011)).unwrap(); // sd x3, 4(x2) — misaligned, in RAM
    hart.step(&mut bus).unwrap();
    hart.regs.pc = CODE;
    bus.store32(CODE, i_type(4, 2, 0b011, 1, 0b0000011))
        .unwrap(); // ld x1, 4(x2) — misaligned
    hart.step(&mut bus).unwrap();
    assert_eq!(
        hart.regs.read(1),
        0x0123_4567_89AB_CDEF,
        "misaligned sd→ld round-trip on wasm"
    );

    // Purity on a GENUINE fault: an ALIGNED, out-of-range (wrapped) access faults ACCESS and
    // leaves rd + pc untouched (rs1 = MAX-7, imm = +16 → wraps to 0x8, unmapped).
    let (mut hart, mut bus) = machine();
    hart.regs.write(1, 0xC0DE); // rd sentinel
    hart.regs.write(2, 0xFFFF_FFFF_FFFF_FFF8);
    bus.store32(CODE, i_type(16, 2, 0b011, 1, 0b0000011))
        .unwrap();
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::LoadAccessFault);
    assert_eq!(t.tval, 0x8);
    assert_eq!(hart.regs.read(1), 0xC0DE, "rd untouched on fault");
    assert_eq!(hart.regs.pc, CODE, "pc untouched on fault");
}
