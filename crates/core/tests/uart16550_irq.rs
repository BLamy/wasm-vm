//! E2-T07 acceptance #1: bare-metal INTERRUPT-DRIVEN echo — no polling. The S-mode guest
//! configures the PLIC (priority/enable/threshold for IRQ 10, context 1) and the UART
//! (IER=0x03, FIFOs on), then parks; every byte moves through the S-external-interrupt
//! handler via PLIC claim → IIR → RBR → THR → complete → sret.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::platform::virt;
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 8 * 1024 * 1024;

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
/// beq rs1, x0, +offset (B-type, offset in bytes, positive, small).
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
const T0: u8 = 5;
const T1: u8 = 6;
const T2: u8 = 7;
const T3: u8 = 28; // claim counter
const T4: u8 = 29; // last IIR
const T5: u8 = 30;
const T6: u8 = 31;

#[test]
fn interrupt_driven_echo_via_plic_claim_complete() {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let uart = m.enable_uart16550();
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    uart.borrow_mut().push_input(b"hi");

    // ── main: stvec, sie.SEIE, sstatus.SIE, PLIC(prio[10]=1, en ctx1 bit10, thresh 0),
    //          UART IER=0x03, FCR=0x01, park.
    let mut code = vec![
        lui(T0, 0x80201),
        addi(T0, T0, -0x800),
        i_type(32, T0, 0b001, T0, 0b0010011),
        i_type(32, T0, 0b101, T0, 0b0010011),
        csrrw(0, 0x105, T0), // stvec = KERNEL_BASE+0x800
        addi(T0, 0, 0x200),  // SEIE (bit 9)
        csrrs(0, 0x104, T0),
        addi(T0, 0, 0x2),
        csrrs(0, 0x100, T0), // sstatus.SIE
        // PLIC priority[10] = 1  (0x0C00_0000 + 0x28)
        lui(T0, 0x0C000),
        addi(T1, 0, 1),
        sw(T1, T0, 0x28),
        // PLIC enable ctx1 bit 10 (0x0C00_2080) = 0x400
        lui(T0, 0x0C002),
        addi(T1, 0, 0x400),
        sw(T1, T0, 0x80),
        // PLIC threshold ctx1 = 0 (0x0C20_1000)
        lui(T0, 0x0C201),
        sw(0, T0, 0),
        // UART: IER = 0x03 (ERBFI|ETBEI) @ +1, FCR = 0x01 @ +2
        lui(T2, 0x10000),
        addi(T1, 0, 0x03),
        sb(T1, T2, 1),
        addi(T1, 0, 0x01),
        sb(T1, T2, 2),
        JDOT,
    ];
    code.push(JDOT);

    // ── handler @ +0x800: claim → IIR → (DR? echo RBR→THR) → complete → sret
    let handler = vec![
        addi(T3, T3, 1),                     // count
        lui(T0, 0x0C201),                    // claim/complete @ 0x0C20_1004
        lw(T1, T0, 4),                       // t1 = claim (expect 10)
        lui(T2, 0x10000),                    // UART base
        lb(T4, T2, 2),                       // IIR (clears THRE when highest)
        lb(T5, T2, 5),                       // LSR
        i_type(1, T5, 0b111, T5, 0b0010011), // andi t5, t5, 1 (DR)
        beqz(T5, 12),                        // no data → skip echo
        lb(T6, T2, 0),                       // RBR
        sb(T6, T2, 0),                       // THR (echo)
        sw(T1, T0, 4),                       // complete
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
    let out = uart.borrow_mut().take_output();
    assert_eq!(
        String::from_utf8_lossy(&out),
        "hi",
        "both bytes echoed, interrupt-only"
    );
    assert!(
        m.hart().regs.read(T3) >= 2,
        "multiple claims serviced (got {})",
        m.hart().regs.read(T3)
    );
    assert!(
        !uart.borrow().irq_level(),
        "line not wedged high after drain (starvation-attack guard)"
    );
}

/// Charter starvation attack: leave IRQ 10 DISABLED at the PLIC while input arrives, then
/// enable it — the pending level must fire exactly once (echo still completes).
#[test]
fn starvation_unmask_fires_once() {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let uart = m.enable_uart16550();
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    uart.borrow_mut().push_input(b"x");

    // Same as above but PLIC enable comes LAST (after UART IER) — input + UART interrupt
    // pend while masked; the enable store is the "unmask" event.
    let mut code = vec![
        lui(T0, 0x80201),
        addi(T0, T0, -0x800),
        i_type(32, T0, 0b001, T0, 0b0010011),
        i_type(32, T0, 0b101, T0, 0b0010011),
        csrrw(0, 0x105, T0),
        addi(T0, 0, 0x200),
        csrrs(0, 0x104, T0),
        addi(T0, 0, 0x2),
        csrrs(0, 0x100, T0),
        lui(T0, 0x0C000),
        addi(T1, 0, 1),
        sw(T1, T0, 0x28), // priority
        lui(T0, 0x0C201),
        sw(0, T0, 0), // threshold
        // UART first: IER=0x01 (RX only), FCR=1 — interrupt now PENDS at the PLIC gateway
        lui(T2, 0x10000),
        addi(T1, 0, 0x01),
        sb(T1, T2, 1),
        addi(T1, 0, 0x01),
        sb(T1, T2, 2),
        // ~long masked window, then unmask (enable ctx1 bit 10)
        lui(T0, 0x0C002),
        addi(T1, 0, 0x400),
        sw(T1, T0, 0x80),
        JDOT,
    ];
    code.push(JDOT);
    let handler = vec![
        addi(T3, T3, 1),
        lui(T0, 0x0C201),
        lw(T1, T0, 4),
        lui(T2, 0x10000),
        lb(T4, T2, 2),
        lb(T5, T2, 5),
        i_type(1, T5, 0b111, T5, 0b0010011),
        beqz(T5, 12),
        lb(T6, T2, 0),
        sb(T6, T2, 0),
        sw(T1, T0, 4),
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
    assert_eq!(m.run(100_000), RunOutcome::MaxInstrs);
    assert_eq!(
        String::from_utf8_lossy(&uart.borrow_mut().take_output()),
        "x",
        "pending interrupt delivered after unmask"
    );
    assert_eq!(m.hart().regs.read(T3), 1, "fired exactly once");
    assert!(!uart.borrow().irq_level(), "line settled");
}
