//! wasm32 mirror of the E0-T09 control-flow suite (`wasm-pack test --node`).

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const RAM: u64 = 64 * 1024;
const CODE: u64 = DRAM_BASE + 0x1000;

fn machine() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.regs.pc = CODE;
    (hart, SystemBus::new(Ram::new(RAM as usize).unwrap()))
}

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn jal(rd: u8, imm: i64) -> u32 {
    let u = imm as u32;
    (((u >> 20) & 1) << 31)
        | (((u >> 1) & 0x3FF) << 21)
        | (((u >> 11) & 1) << 20)
        | (((u >> 12) & 0xFF) << 12)
        | ((rd as u32) << 7)
        | 0b1101111
}
fn b_type(f3: u32, rs1: u8, rs2: u8, imm: i64) -> u32 {
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

#[wasm_bindgen_test]
fn jal_jalr_and_loop_on_wasm32() {
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, jal(1, 8)).unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(1), CODE + 4);
    assert_eq!(hart.regs.pc, CODE + 8);

    // jalr rd==rs1 uses old value
    let target = DRAM_BASE + 0x200;
    hart.regs.pc = CODE;
    hart.regs.write(5, target);
    bus.store32(CODE, i_type(0, 5, 0b000, 5, 0b1100111))
        .unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.pc, target);
    assert_eq!(hart.regs.read(5), CODE + 4);

    // countdown loop: exact retirement count
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
    assert_eq!(steps, 11);
}

#[wasm_bindgen_test]
fn misaligned_target_semantics_on_wasm32() {
    // taken beq to pc+2 traps cause 0; link-free, pc unmoved
    let (mut hart, mut bus) = machine();
    bus.store32(CODE, b_type(0b000, 0, 0, 2)).unwrap();
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::InstrAddrMisaligned);
    assert_eq!(t.tval, CODE + 2);
    assert_eq!(hart.regs.pc, CODE);

    // jalr bit-0 clear then trap, link unwritten
    let (mut hart, mut bus) = machine();
    hart.regs.write(1, 0xC0DE);
    hart.regs.write(2, DRAM_BASE + 0x100);
    bus.store32(CODE, i_type(3, 2, 0b000, 1, 0b1100111))
        .unwrap();
    let t = hart.step(&mut bus).unwrap_err();
    assert_eq!(t.cause, Exception::InstrAddrMisaligned);
    assert_eq!(t.tval, DRAM_BASE + 0x102);
    assert_eq!(hart.regs.read(1), 0xC0DE);
}
