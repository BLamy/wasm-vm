//! E1-T11: the interrupt architecture — mie/mip enable/pending, mideleg/medeleg delegation,
//! priority ordering, instruction-boundary sampling, vectored dispatch, and the WFI idiom.
//! Exercises the real CSR file + run-loop delivery, so it is default-build native only.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{
    CsrOp, Csrs, MEDELEG, MIDELEG, MIE, MIP, MSTATUS, MTVEC, Priv, SCAUSE, SEPC, SSTATUS, STVEC,
};
use wasm_vm_core::{Machine, RunOutcome};

const CODE: u64 = DRAM_BASE;

// Interrupt bit positions.
const SSI: u64 = 1;
const MSI: u64 = 3;
const STI: u64 = 5;
const MTI: u64 = 7;
const SEI: u64 = 9;
const MEI: u64 = 11;
const MIE_GLOBAL: u64 = 1 << 3; // mstatus.MIE
const SIE_GLOBAL: u64 = 1 << 1; // mstatus.SIE
const INT_BIT: u64 = 1 << 63;

/// A CSR handle in M-mode. The `wr`/`set`/`rd` helpers temporarily elevate to M so CSR setup
/// bypasses the privilege check regardless of the current test mode (like privilege.rs).
fn m_csrs() -> Csrs {
    Csrs::at_reset() // resets to M-mode
}
fn wr(c: &mut Csrs, addr: u16, v: u64) {
    let save = c.mode;
    c.mode = Priv::M;
    c.access(addr, CsrOp::Write, v, false, false, 0).unwrap();
    c.mode = save;
}
fn set(c: &mut Csrs, addr: u16, v: u64) {
    let save = c.mode;
    c.mode = Priv::M;
    c.access(addr, CsrOp::Set, v, false, false, 0).unwrap();
    c.mode = save;
}
fn rd(c: &mut Csrs, addr: u16) -> u64 {
    let save = c.mode;
    c.mode = Priv::M;
    let v = c.access(addr, CsrOp::Set, 0, true, false, 0).unwrap();
    c.mode = save;
    v
}

// ── priority matrix ─────────────────────────────────────────────────────────────

#[test]
fn full_priority_chain_in_m_with_mie() {
    // All six lines pending+enabled in M-mode with MIE=1 and no delegation → they all target M.
    // Peel them off highest-priority first: MEI > MSI > MTI > SEI > SSI > STI.
    let mut c = m_csrs();
    set(&mut c, MSTATUS, MIE_GLOBAL);
    wr(&mut c, MIE, 0xAAA); // enable all six
    for bit in [SSI, MSI, STI, MTI, SEI, MEI] {
        c.set_mip_bit(bit, true);
    }
    for expected in [MEI, MSI, MTI, SEI, SSI, STI] {
        let (cause, to_s) = c.next_interrupt().expect("an interrupt is pending");
        assert_eq!(cause, INT_BIT | expected, "priority winner");
        assert!(!to_s, "undelegated → targets M");
        c.set_mip_bit(expected, false); // clear the winner, expose the next
    }
    assert_eq!(c.next_interrupt(), None, "all drained");
}

#[test]
fn m_mode_with_mie_clear_takes_nothing() {
    // MIE=0 in M-mode masks every M-targeted interrupt.
    let mut c = m_csrs();
    wr(&mut c, MIE, 0xAAA);
    for bit in [MSI, MTI, MEI] {
        c.set_mip_bit(bit, true);
    }
    assert_eq!(c.next_interrupt(), None, "MIE=0 masks M interrupts");
}

// ── delegation ──────────────────────────────────────────────────────────────────

#[test]
fn delegated_stimer_fires_in_u_not_in_m() {
    // mideleg[5]=1 (STIP delegated). A pending+enabled supervisor timer in U-mode targets S;
    // the SAME interrupt while in M-mode does NOT fire (M > delegated target S).
    let mut c = m_csrs();
    wr(&mut c, MIDELEG, 1 << STI);
    wr(&mut c, MIE, 1 << STI);
    c.set_mip_bit(STI, true);

    c.mode = Priv::U;
    let (cause, to_s) = c.next_interrupt().expect("delegated S timer fires in U");
    assert_eq!(cause, INT_BIT | STI);
    assert!(to_s, "targets S");

    c.mode = Priv::M;
    assert_eq!(
        c.next_interrupt(),
        None,
        "delegated S interrupt never fires while in M"
    );

    // In S-mode it fires only when SIE=1.
    c.mode = Priv::S;
    assert_eq!(c.next_interrupt(), None, "S-mode with SIE=0 masks it");
    set(&mut c, MSTATUS, SIE_GLOBAL);
    assert!(c.next_interrupt().is_some(), "S-mode with SIE=1 takes it");
}

#[test]
fn m_interrupt_not_masked_from_below() {
    // A machine interrupt (MTI) is never maskable from S/U — it fires regardless of SIE.
    let mut c = m_csrs();
    wr(&mut c, MIE, 1 << MTI);
    c.set_mip_bit(MTI, true);
    c.mode = Priv::S; // SIE=0
    let (cause, to_s) = c.next_interrupt().expect("M timer fires in S");
    assert_eq!(cause, INT_BIT | MTI);
    assert!(!to_s, "M interrupt targets M");
}

#[test]
fn higher_priority_but_untakeable_is_skipped() {
    // In S-mode with SIE=0: a delegated SEI (higher priority among S) can't be taken, but an
    // undelegated M timer (MTI) always can — so MTI fires, not SEI.
    let mut c = m_csrs();
    wr(&mut c, MIDELEG, 1 << SEI);
    wr(&mut c, MIE, (1 << SEI) | (1 << MTI));
    c.set_mip_bit(SEI, true);
    c.set_mip_bit(MTI, true);
    c.mode = Priv::S; // SIE=0 → SEI unt­akeable
    let (cause, _) = c.next_interrupt().expect("MTI takeable");
    assert_eq!(cause, INT_BIT | MTI, "skip untakeable SEI, take MTI");
}

// ── WARL masks ──────────────────────────────────────────────────────────────────

#[test]
fn deleg_and_enable_warl_masks() {
    let mut c = m_csrs();
    wr(&mut c, MIE, u64::MAX);
    assert_eq!(rd(&mut c, MIE), 0xAAA, "mie: only the six implemented bits");
    wr(&mut c, MIDELEG, u64::MAX);
    assert_eq!(
        rd(&mut c, MIDELEG),
        0x222,
        "mideleg: only S-interrupt bits delegable"
    );
    wr(&mut c, MEDELEG, u64::MAX);
    let md = rd(&mut c, MEDELEG);
    assert_eq!(md & (1 << 11), 0, "medeleg[11] (ecall-from-M) hardwired 0");
    assert_eq!(md & (1 << 10), 0, "medeleg[10] reserved");
    assert_eq!(md & (1 << 14), 0, "medeleg[14] reserved");
    assert_ne!(md & (1 << 8), 0, "medeleg[8] (ecall-from-U) delegable");
    assert_ne!(md & (1 << 13), 0, "medeleg[13] (load page fault) delegable");
}

#[test]
fn mip_mtip_software_write_ignored_device_bit_survives() {
    // MSIP/MTIP/MEIP are read-only to software; SSIP/STIP/SEIP are writable from M.
    let mut c = m_csrs();
    wr(&mut c, MIP, (1 << MTI) | (1 << STI)); // try to set MTIP + STIP
    assert_eq!(
        rd(&mut c, MIP) & (1 << MTI),
        0,
        "MTIP software-write ignored"
    );
    assert_ne!(rd(&mut c, MIP) & (1 << STI), 0, "STIP writable from M");

    // The device path drives MTIP; a later software csrw must not clear it (RMW).
    c.set_mip_bit(MTI, true);
    wr(&mut c, MIP, 0); // csrw mip, 0
    assert_ne!(
        rd(&mut c, MIP) & (1 << MTI),
        0,
        "device-driven MTIP survives a software write"
    );
}

// ── end-to-end delivery through the run loop ─────────────────────────────────────

fn machine() -> Machine {
    Machine::new(1024 * 1024)
}
fn set_csr(m: &mut Machine, addr: u16, op: CsrOp, v: u64) {
    m.hart_mut()
        .csr
        .access(addr, op, v, false, false, 0)
        .unwrap();
}

#[test]
fn m_mode_exception_is_never_delegated_downward() {
    // Priv §3.1.8: a trap taken while executing in M-mode is ALWAYS taken in M, even when its
    // medeleg bit is set — delegation only routes traps to a LOWER privilege. Set medeleg[2]
    // (illegal-instruction) and raise an illegal from M: it must vector to mtvec with mcause
    // (not scause), mode staying M. (Kills the mutation that drops the `< M` guard in
    // delegates_to_s.)
    const MHANDLER: u64 = DRAM_BASE + 0x3000;
    const SHANDLER: u64 = DRAM_BASE + 0x5000;
    let mut m = machine();
    set_csr(&mut m, MTVEC, CsrOp::Write, MHANDLER);
    set_csr(&mut m, STVEC, CsrOp::Write, SHANDLER);
    set_csr(&mut m, MEDELEG, CsrOp::Write, 1 << 2); // delegate illegal-instruction
    // A reserved 32-bit encoding (opcode 0x7F) → illegal; we are in M (reset).
    m.bus_mut().store32(CODE, 0x0000_007F).unwrap();
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(1);
    assert_eq!(
        m.hart().csr.mode,
        Priv::M,
        "M-mode trap stays in M despite medeleg"
    );
    assert_eq!(m.hart().regs.pc, MHANDLER, "vectored to mtvec, not stvec");
    assert_eq!(m.hart_mut().csr.read(0x342), 2, "mcause = illegal (M path)");
    assert_eq!(
        m.hart_mut().csr.read(0x142),
        0,
        "scause untouched (not delegated)"
    );
}

#[test]
fn delegated_interrupt_delivers_to_stvec_with_scause_and_spp() {
    // mideleg[5]=1; in U-mode a pending S timer vectors to stvec, scause = 0x8000…0005, SPP=0.
    const HANDLER: u64 = DRAM_BASE + 0x3000;
    let mut m = machine();
    set_csr(&mut m, STVEC, CsrOp::Write, HANDLER); // MODE 0 (direct)
    set_csr(&mut m, MIDELEG, CsrOp::Write, 1 << STI);
    set_csr(&mut m, MIE, CsrOp::Write, 1 << STI);
    m.hart_mut().csr.set_mip_bit(STI, true);
    m.hart_mut().csr.mode = Priv::U;
    // A NOP at CODE so the loop has something to (not) run — the interrupt fires first.
    m.bus_mut().store32(CODE, 0x0000_0013).unwrap(); // addi x0,x0,0
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(1);
    assert_eq!(
        m.hart_mut()
            .csr
            .access(SCAUSE, CsrOp::Set, 0, true, false, 0)
            .unwrap(),
        INT_BIT | STI,
        "scause = interrupt | 5"
    );
    assert_eq!(
        m.hart_mut()
            .csr
            .access(SEPC, CsrOp::Set, 0, true, false, 0)
            .unwrap(),
        CODE,
        "sepc = first unexecuted instruction"
    );
    let sstatus = m
        .hart_mut()
        .csr
        .access(SSTATUS, CsrOp::Set, 0, true, false, 0)
        .unwrap();
    assert_eq!(sstatus & (1 << 8), 0, "SPP = 0 (interrupted U-mode)");
    assert_eq!(m.hart().csr.mode, Priv::S, "took the trap in S");
    assert_eq!(m.hart().regs.pc, HANDLER, "vectored to stvec BASE (direct)");
}

#[test]
fn vectored_stvec_interrupt_enters_at_base_plus_4x_cause() {
    // stvec MODE=1: a delegated timer interrupt (cause 5) enters at BASE + 4×5 = BASE+20;
    // a synchronous trap (an ecall) still enters at BASE.
    const HANDLER: u64 = DRAM_BASE + 0x3000;
    let mut m = machine();
    set_csr(&mut m, STVEC, CsrOp::Write, HANDLER | 1); // Vectored
    set_csr(&mut m, MIDELEG, CsrOp::Write, 1 << STI);
    set_csr(&mut m, MEDELEG, CsrOp::Write, 1 << 8); // delegate ecall-from-U to S
    set_csr(&mut m, MIE, CsrOp::Write, 1 << STI);
    m.hart_mut().csr.set_mip_bit(STI, true);
    m.hart_mut().csr.mode = Priv::U;
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(1);
    assert_eq!(
        m.hart().regs.pc,
        HANDLER + 20,
        "vectored interrupt cause 5 → BASE + 20"
    );

    // Now a synchronous ecall-from-U (delegated) enters at BASE, not BASE+4×8.
    let mut m = machine();
    set_csr(&mut m, STVEC, CsrOp::Write, HANDLER | 1);
    set_csr(&mut m, MEDELEG, CsrOp::Write, 1 << 8);
    m.hart_mut().csr.pmp.allow_all(); // E1-T15: grant U-mode fetch/access to RAM
    m.hart_mut().csr.mode = Priv::U;
    m.bus_mut().store32(CODE, 0x0000_0073).unwrap(); // ecall
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(1);
    assert_eq!(
        m.hart().regs.pc,
        HANDLER,
        "synchronous trap enters at BASE even in vectored mode"
    );
}

#[test]
fn vectored_mtvec_m_interrupt_ssi_enters_at_base_plus_4() {
    // The rv64mi-p-illegal `test_vectored_interrupts` scenario: SSIP (software-writable, cause 1)
    // pending+enabled in M-mode with MIE=1 and no delegation → targets M; vectored mtvec sends
    // it to BASE + 4×1.
    const HANDLER: u64 = DRAM_BASE + 0x3000;
    let mut m = machine();
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER | 1); // Vectored
    set_csr(&mut m, MSTATUS, CsrOp::Set, MIE_GLOBAL);
    set_csr(&mut m, MIE, CsrOp::Write, 1 << SSI);
    set_csr(&mut m, MIP, CsrOp::Write, 1 << SSI); // SSIP is software-writable
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(1);
    assert_eq!(
        m.hart_mut().csr.read(0x342) & !INT_BIT,
        SSI,
        "mcause = interrupt | SSI"
    );
    assert_eq!(m.hart().csr.mode, Priv::M, "SSI undelegated → taken in M");
    assert_eq!(m.hart().regs.pc, HANDLER + 4, "vectored SSI → BASE + 4×1");
}

#[test]
fn wfi_with_mie_clear_and_mtip_pending_continues_no_trap() {
    // The classic idiom: WFI with mstatus.MIE=0 but mie.MTIE=1, MTIP pending → WFI must NOT
    // hang and NO trap is taken; execution continues at the instruction after WFI.
    let mut m = machine();
    set_csr(&mut m, MIE, CsrOp::Write, 1 << MTI); // MTIE=1, but mstatus.MIE stays 0
    m.hart_mut().csr.set_mip_bit(MTI, true); // MTIP pending
    // wfi ; addi x5, x0, 42
    m.bus_mut().store32(CODE, 0x1050_0073).unwrap(); // wfi
    m.bus_mut().store32(CODE + 4, 0x02A0_0293).unwrap(); // addi x5, x0, 42
    m.hart_mut().regs.pc = CODE;
    let out = m.run(2); // exactly wfi + addi; stop before the zeroed tail
    assert_eq!(out, RunOutcome::MaxInstrs, "no hang, no trap escape");
    assert_eq!(m.hart().regs.read(5), 42, "instruction after WFI executed");
    assert_eq!(m.hart().csr.mode, Priv::M, "no interrupt was taken (MIE=0)");
}

#[test]
fn interrupt_taken_after_an_instruction_retires_precise_mepc() {
    // Run one instruction, then let an M interrupt fire: mepc must be the NEXT instruction
    // (the retired one is not re-run), and the first instruction's effect is visible.
    const HANDLER: u64 = DRAM_BASE + 0x3000;
    let mut m = machine();
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    set_csr(&mut m, MSTATUS, CsrOp::Set, MIE_GLOBAL);
    set_csr(&mut m, MIE, CsrOp::Write, 1 << MTI);
    // addi x6, x0, 7 ; addi x7, x0, 9
    m.bus_mut().store32(CODE, 0x0070_0313).unwrap(); // addi x6,x0,7
    m.bus_mut().store32(CODE + 4, 0x0090_0393).unwrap(); // addi x7,x0,9
    m.hart_mut().regs.pc = CODE;
    // Step the first instruction (pure), then raise MTIP and run — the interrupt fires at the
    // boundary before the second instruction.
    m.step().unwrap();
    assert_eq!(m.hart().regs.read(6), 7, "first instr retired");
    m.hart_mut().csr.set_mip_bit(MTI, true);
    let _ = m.run(1);
    assert_eq!(
        m.hart_mut()
            .csr
            .access(0x341, CsrOp::Set, 0, true, false, 0)
            .unwrap(),
        CODE + 4,
        "mepc = the first UNexecuted instruction"
    );
    assert_eq!(m.hart().regs.read(7), 0, "second instr did NOT run");
    assert_eq!(m.hart().regs.pc, HANDLER);
}
