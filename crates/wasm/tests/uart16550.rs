//! wasm32 mirror of the E2-T07 UART checks (`wasm-pack test --node`): identical register
//! semantics and an identical interrupt-driven echo run (deterministic clock ⇒ identical
//! counts) — acceptance #5.

#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::platform::virt;
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 4 * 1024 * 1024;

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, 0b0010011)
}
fn lui(rd: u8, imm20: u32) -> u32 {
    (imm20 << 12) | ((rd as u32) << 7) | 0b0110111
}
fn csrrw(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b001 << 12) | ((rd as u32) << 7) | 0b1110011
}
fn csrrs(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b010 << 12) | ((rd as u32) << 7) | 0b1110011
}
fn lw(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b010, rd, 0b0000011)
}
fn lb(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, 0b0000011)
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
fn sw(rs2: u8, rs1: u8, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 0b010)
}
fn sb(rs2: u8, rs1: u8, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 0b000)
}
fn beqz(rs1: u8, offset: u32) -> u32 {
    let imm = offset;
    ((imm >> 12) & 1) << 31
        | ((imm >> 5) & 0x3F) << 25
        | ((rs1 as u32) << 15)
        | (((imm >> 1) & 0xF) << 8)
        | (((imm >> 11) & 1) << 7)
        | 0b1100011
}
const SRET: u32 = 0x1020_0073;
const JDOT: u32 = 0x0000_006F;

#[wasm_bindgen_test]
fn interrupt_driven_echo_on_wasm32() {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let uart = m.enable_uart16550();
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    uart.borrow_mut().push_input(b"hi");

    let mut code = vec![
        lui(5, 0x80201),
        addi(5, 5, -0x800),
        i_type(32, 5, 0b001, 5, 0b0010011),
        i_type(32, 5, 0b101, 5, 0b0010011),
        csrrw(0, 0x105, 5),
        addi(5, 0, 0x200),
        csrrs(0, 0x104, 5),
        addi(5, 0, 0x2),
        csrrs(0, 0x100, 5),
        lui(5, 0x0C000),
        addi(6, 0, 1),
        sw(6, 5, 0x28),
        lui(5, 0x0C002),
        addi(6, 0, 0x400),
        sw(6, 5, 0x80),
        lui(5, 0x0C201),
        sw(0, 5, 0),
        lui(7, 0x10000),
        addi(6, 0, 0x03),
        sb(6, 7, 1),
        addi(6, 0, 0x01),
        sb(6, 7, 2),
        JDOT,
    ];
    code.push(JDOT);
    let handler = [
        addi(28, 28, 1),
        lui(5, 0x0C201),
        lw(6, 5, 4),
        lui(7, 0x10000),
        lb(29, 7, 2),
        lb(30, 7, 5),
        i_type(1, 30, 0b111, 30, 0b0010011),
        beqz(30, 12),
        lb(31, 7, 0),
        sb(31, 7, 0),
        sw(6, 5, 4),
        SRET,
    ];
    for (i, insn) in code.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
            .unwrap();
    }
    for (i, insn) in handler.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 0x800 + 4 * i as u64, *insn)
            .unwrap();
    }
    assert_eq!(m.run(200_000), RunOutcome::MaxInstrs);
    assert_eq!(uart.borrow_mut().take_output(), b"hi", "echo on wasm32");
    assert!(m.hart().regs.read(28) >= 2);
    assert!(!uart.borrow().irq_level(), "line settled on wasm32");
}

#[wasm_bindgen_test]
fn overrun_and_dlab_on_wasm32() {
    // Register-level semantics via the bus (no guest code): flood 100 bytes → cap 16 + OE.
    let mut m = Machine::new(RAM);
    m.enable_plic();
    let uart = m.enable_uart16550();
    let flood: Vec<u8> = (0u8..100).collect();
    uart.borrow_mut().push_input(&flood);
    let lsr = m.bus_mut().load8(virt::UART0_BASE + 5).unwrap();
    assert_ne!(lsr & 0x02, 0, "OE set");
    let lsr2 = m.bus_mut().load8(virt::UART0_BASE + 5).unwrap();
    assert_eq!(lsr2 & 0x02, 0, "OE cleared by read");
    for i in 0u8..16 {
        assert_eq!(m.bus_mut().load8(virt::UART0_BASE).unwrap(), i);
    }
    // DLAB banking.
    m.bus_mut().store8(virt::UART0_BASE + 3, 0x80).unwrap();
    m.bus_mut().store8(virt::UART0_BASE, 0x23).unwrap();
    assert_eq!(m.bus_mut().load8(virt::UART0_BASE).unwrap(), 0x23);
    m.bus_mut().store8(virt::UART0_BASE + 3, 0x03).unwrap();
}
