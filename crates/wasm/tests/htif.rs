//! wasm32 mirror of the E0-T11 ECALL/EBREAK + HTIF run-loop suite.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Exception;
use wasm_vm_core::{Machine, RunOutcome};

const CODE: u64 = DRAM_BASE;
const TOHOST: u64 = DRAM_BASE + 0x1000;

fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | ((rd as u32) << 7) | 0b0010011
}
fn sd(rs2: u8, rs1: u8) -> u32 {
    ((rs2 as u32) << 20) | ((rs1 as u32) << 15) | (0b011 << 12) | 0b0100011
}

#[wasm_bindgen_test]
fn htif_exit_on_wasm32() {
    let mut m = Machine::new(64 * 1024);
    m.bus_mut().store32(CODE, addi(5, 0, 85)).unwrap(); // t0 = 85 = (42<<1)|1
    m.bus_mut().store32(CODE + 4, sd(5, 6)).unwrap();
    m.bus_mut().store32(CODE + 8, 0x0000_006F).unwrap();
    m.hart_mut().regs.pc = CODE;
    m.hart_mut().regs.write(6, TOHOST);
    m.set_htif(TOHOST);
    assert_eq!(m.run(100), RunOutcome::Exited(42));
}

#[wasm_bindgen_test]
fn ecall_ebreak_and_maxinstrs_on_wasm32() {
    let mut m = Machine::new(64 * 1024);
    m.bus_mut().store32(CODE, 0x0000_0073).unwrap();
    m.hart_mut().regs.pc = CODE;
    match m.run(10) {
        RunOutcome::Trapped(t) => assert_eq!(t.cause, Exception::EcallFromM),
        o => panic!("expected ECALL trap, got {o:?}"),
    }

    let mut m = Machine::new(64 * 1024);
    m.bus_mut().store32(CODE, 0x0000_006F).unwrap(); // self-loop
    m.hart_mut().regs.pc = CODE;
    assert_eq!(m.run(500), RunOutcome::MaxInstrs);
}

#[wasm_bindgen_test]
fn load_elf_arms_htif_on_wasm32() {
    const ELF: &[u8] = include_bytes!("../../core/tests/fixtures/minimal.elf");
    let mut m = Machine::new(64 * 1024);
    m.load_elf(ELF).unwrap();
    assert_eq!(m.hart().regs.pc, 0x8000_0000);
    assert_eq!(m.run(100), RunOutcome::MaxInstrs);
}
