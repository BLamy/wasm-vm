//! wasm32 mirror of the E2-T05 TIME checks: the same bare-metal S-mode timer guests must
//! behave identically under wasm (`wasm-pack test --node`) — deterministic, instruction-
//! driven clock, so counts match native exactly.

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
const ECALL: u32 = 0x0000_0073;
const SRET: u32 = 0x1020_0073;
const JDOT: u32 = 0x0000_006F;

fn timer_machine(arm_past: bool, budget: u64) -> Machine {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    // prologue: stvec, sie.STIE, sstatus.SIE, a7=TIME
    let mut code = vec![
        lui(5, 0x80201),
        addi(5, 5, -0x800),
        i_type(32, 5, 0b001, 5, 0b0010011),
        i_type(32, 5, 0b101, 5, 0b0010011),
        csrrw(0, 0x105, 5),
        addi(5, 0, 0x20),
        csrrs(0, 0x104, 5),
        addi(5, 0, 0x2),
        csrrs(0, 0x100, 5),
        lui(17, 0x54495),
        addi(17, 17, -0x2BB),
        addi(16, 0, 0),
    ];
    if arm_past {
        code.push(addi(10, 0, 0)); // set_timer(0): past
        code.push(ECALL);
    } else {
        code.push(csrrs(5, 0xC01, 0)); // rdtime
        code.push(addi(10, 5, 1)); // +1 tick
        code.push(ECALL); // arm
        code.push(addi(10, 0, -1));
        code.push(ECALL); // cancel immediately (race)
    }
    code.push(JDOT);
    let handler = [
        addi(28, 28, 1),
        csrrs(29, 0x142, 0),
        lui(17, 0x54495),
        addi(17, 17, -0x2BB),
        addi(16, 0, 0),
        addi(10, 0, -1),
        ECALL,
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
    let outcome = m.run(budget);
    assert_eq!(outcome, RunOutcome::MaxInstrs);
    m
}

#[wasm_bindgen_test]
fn past_deadline_fires_once_on_wasm32() {
    let m = timer_machine(true, 2000);
    assert_eq!(m.hart().regs.read(28), 1, "one delivery");
    assert_eq!(m.hart().regs.read(29), (1u64 << 63) | 5, "scause = S-timer");
}

#[wasm_bindgen_test]
fn cancel_race_zero_deliveries_on_wasm32() {
    let m = timer_machine(false, 200_000);
    assert_eq!(m.hart().regs.read(28), 0, "no late delivery after cancel");
}
