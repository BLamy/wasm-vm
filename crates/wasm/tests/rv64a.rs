//! E1-T04: the A-extension reservation lifecycle and AMO semantics must hold identically
//! on wasm32 (no native 64-bit atomics involved — these are plain RMWs — but the reservation
//! bookkeeping and sign-handling are re-verified on the real target).
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const AMO: u32 = 0b0101111;
const W: u32 = 0b010;
const D: u32 = 0b011;
const F_LR: u32 = 0b00010;
const F_SC: u32 = 0b00011;
const F_ADD: u32 = 0b00000;
const F_MAXU: u32 = 0b11100;
const DATA: u64 = DRAM_BASE + 0x800;

fn amo(funct5: u32, f3: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (funct5 << 27)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((rd as u32) << 7)
        | AMO
}
fn machine() -> (Hart, SystemBus) {
    (Hart::new(), SystemBus::new(Ram::new(1024 * 1024).unwrap()))
}

#[wasm_bindgen_test]
fn rv64a_reservation_and_amo_on_wasm32() {
    // LR → SC success.
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 0x1111_1111).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 0xABCD);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, amo(F_LR, W, 11, 10, 0)).unwrap();
    bus.store32(DRAM_BASE + 4, amo(F_SC, W, 11, 10, 12))
        .unwrap();
    hart.step(&mut bus).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(11), 0);
    assert_eq!(bus.load32(DATA).unwrap(), 0xABCD);

    // SC without LR fails.
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 0x42).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 0x99);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, amo(F_SC, W, 11, 10, 12)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(11), 1);
    assert_eq!(bus.load32(DATA).unwrap(), 0x42, "no store on SC failure");

    // AMOADD.W wrap + sign-extended old; AMOMAXU.W unsigned compare.
    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 0xFFFF_FFFF).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 1);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, amo(F_ADD, W, 11, 10, 12)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(11), 0xFFFF_FFFF_FFFF_FFFF);
    assert_eq!(bus.load32(DATA).unwrap(), 0);

    let (mut hart, mut bus) = machine();
    bus.store32(DATA, 1).unwrap();
    hart.regs.write(10, DATA);
    hart.regs.write(12, 0x8000_0000);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, amo(F_MAXU, W, 11, 10, 12)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(bus.load32(DATA).unwrap(), 0x8000_0000, "unsigned max");

    // Misaligned AMO.D → store-address-misaligned (cause 6).
    let (mut hart, mut bus) = machine();
    hart.regs.write(10, DATA + 4);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, amo(F_ADD, D, 11, 10, 12)).unwrap();
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::StoreAddrMisaligned);
    assert_eq!(t.tval, DATA + 4);
}
