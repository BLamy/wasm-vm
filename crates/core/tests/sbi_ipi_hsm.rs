//! E2-T06 integration: real S-mode guests exercising IPI (self-IPI → SSIP delivery through
//! stvec), RFENCE (ecall reaches the TLB), HSM (status via ecall), and SRST (shutdown ends
//! the run) — all through the run-loop dispatch, not direct handler calls.

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
fn csrrc(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b011 << 12) | ((rd as u32) << 7) | 0b1110011
}
const ECALL: u32 = 0x0000_0073;
const SRET: u32 = 0x1020_0073;
const JDOT: u32 = 0x0000_006F;
const A0: u8 = 10;
const A6: u8 = 16;
const A7: u8 = 17;
const T0: u8 = 5;
const T3: u8 = 28;
const T4: u8 = 29;

fn boot(code: &[u32], handler: Option<&[u32]>) -> Machine {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    for (i, insn) in code.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
            .unwrap();
    }
    if let Some(h) = handler {
        for (i, insn) in h.iter().enumerate() {
            m.bus_mut()
                .store32(virt::KERNEL_BASE + 0x800 + 4 * i as u64, *insn)
                .unwrap();
        }
    }
    m
}

/// stvec=KERNEL_BASE+0x800, sie |= `sie_bits`, sstatus.SIE=1.
fn trap_prologue(sie_bits: i32) -> Vec<u32> {
    vec![
        lui(T0, 0x80201),
        addi(T0, T0, -0x800),
        i_type(32, T0, 0b001, T0, 0b0010011),
        i_type(32, T0, 0b101, T0, 0b0010011),
        csrrw(0, 0x105, T0), // stvec
        addi(T0, 0, sie_bits),
        csrrs(0, 0x104, T0), // sie
        addi(T0, 0, 0x2),
        csrrs(0, 0x100, T0), // sstatus.SIE
    ]
}

/// Self-IPI: send_ipi(mask=1, base=0) → SSI delivered (scause 1), handler clears SSIP via
/// its own sip write (S-writable) and counts; exactly one delivery.
#[test]
fn self_ipi_delivers_ssi_once() {
    let mut code = trap_prologue(0x2); // SSIE
    // a7 = IPI 0x735049 (lo12 0x049 < 0x800)
    code.push(lui(A7, 0x735));
    code.push(addi(A7, A7, 0x049));
    code.push(addi(A6, 0, 0)); // fid 0 send_ipi
    code.push(addi(A0, 0, 1)); // mask bit0
    code.push(addi(11, 0, 0)); // base 0
    code.push(ECALL);
    code.push(JDOT);
    let handler = [
        addi(T3, T3, 1),
        csrrs(T4, 0x142, 0), // scause
        addi(T0, 0, 0x2),
        csrrc(0, 0x144, T0), // sip.SSIP CLEAR — S-writable, guest acks its own IPI
        SRET,
    ];
    let mut m = boot(&code, Some(&handler));
    assert_eq!(m.run(4000), RunOutcome::MaxInstrs);
    assert_eq!(m.hart().regs.read(T3), 1, "exactly one SSI delivery");
    assert_eq!(m.hart().regs.read(T4), (1u64 << 63) | 1, "scause = S-soft");
    assert_eq!(m.hart().regs.read(A0), 0, "send_ipi returned SBI_SUCCESS");
}

/// RFENCE sfence_vma via real ecall reaches the TLB (flush observed host-side) and
/// returns SUCCESS. (Full remap-under-satp scenario is covered by the E1-T17 TLB suite;
/// this proves the SBI plumbing path.)
#[test]
fn rfence_ecall_flushes_tlb() {
    // a7 = RFENCE 0x52464E43 (lo12 0xE43 ≥ 0x800 → addi -0x1BD, hi 0x52465)
    let mut code = vec![lui(A7, 0x52465), addi(A7, A7, -0x1BD)];
    code.push(addi(A6, 0, 1)); // fid 1 sfence_vma
    code.push(addi(A0, 0, 1)); // mask bit0
    code.push(addi(11, 0, 0)); // base 0
    code.push(addi(12, 0, 0)); // start 0
    code.push(addi(13, 0, -1)); // size u64::MAX → full flush
    code.push(ECALL);
    code.push(JDOT);
    let mut m = boot(&code, None);
    let f0 = m.hart().tlb.flush_count();
    assert_eq!(m.run(64), RunOutcome::MaxInstrs);
    assert!(m.hart().tlb.flush_count() > f0, "ecall reached tlb.sfence");
    assert_eq!(m.hart().regs.read(A0), 0, "SBI_SUCCESS");
}

/// HSM get_status(0) via real ecall → (SUCCESS, STARTED=0); get_status(1) → INVALID_PARAM.
#[test]
fn hsm_status_via_ecall() {
    // a7 = HSM 0x48534D (lo12 0x34D)
    let mut code = vec![lui(A7, 0x485), addi(A7, A7, 0x34D)];
    code.push(addi(A6, 0, 2)); // fid 2 get_status
    code.push(addi(A0, 0, 0)); // hart 0
    code.push(ECALL);
    code.push(addi(T3, A0, 0)); // t3 = error
    code.push(addi(T4, 11, 0)); // t4 = value
    code.push(addi(A0, 0, 1)); // hart 1
    code.push(ECALL);
    code.push(JDOT);
    let mut m = boot(&code, None);
    assert_eq!(m.run(64), RunOutcome::MaxInstrs);
    assert_eq!(m.hart().regs.read(T3), 0, "hart0: SBI_SUCCESS");
    assert_eq!(m.hart().regs.read(T4), 0, "hart0: STARTED");
    assert_eq!(m.hart().regs.read(A0) as i64, -3, "hart1: INVALID_PARAM");
}

/// SRST shutdown via real ecall ends the run as Exited(0); the guest never executes the
/// poison instruction after the ecall.
#[test]
fn srst_shutdown_exits_the_run() {
    // a7 = SRST 0x53525354 (lo12 0x354)
    let mut code = vec![lui(A7, 0x53525), addi(A7, A7, 0x354)];
    code.push(addi(A6, 0, 0)); // fid 0 system_reset
    code.push(addi(A0, 0, 0)); // type: shutdown
    code.push(addi(11, 0, 0)); // reason: none
    code.push(ECALL);
    code.push(0x0000_0000); // poison: illegal instruction — must never execute
    let mut m = boot(&code, None);
    assert_eq!(
        m.run(64),
        RunOutcome::Exited(0),
        "shutdown, not the poison trap"
    );
}
