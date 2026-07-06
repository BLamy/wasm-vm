//! E2-T20 interrupt-storm / WFI-deadlock detection — end-to-end wiring tests. These drive real
//! guests through the run loop (not the [`IrqStats`] detector in isolation, which its own unit
//! tests cover) to prove the counters increment and the detectors fire on the real thing.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};

const CODE: u64 = DRAM_BASE;

fn set_csr(m: &mut Machine, addr: u16, v: u64) {
    m.hart_mut()
        .csr
        .access(addr, CsrOp::Write, v, false, false, 0)
        .unwrap();
}

/// A trap STORM: an illegal instruction whose handler is just `mret`, so every return lands
/// back on the illegal insn and re-traps forever. The detector must fire, and the
/// illegal-instruction counter (scause 2) must be large.
#[test]
fn exception_storm_fires_and_is_counted() {
    const HANDLER: u64 = DRAM_BASE + 0x2000;
    let mut m = Machine::new(1024 * 1024);
    set_csr(&mut m, MTVEC, HANDLER);
    m.bus_mut().store32(CODE, 0x0000_007F).unwrap(); // reserved opcode → illegal
    m.bus_mut().store32(HANDLER, 0x3020_0073).unwrap(); // mret → returns to the illegal insn
    m.hart_mut().regs.pc = CODE;
    // Fire needs 3 windows × 10^6 retired. Each cycle is [illegal→trap]+[mret→retire] = 2
    // run-loop iterations, so ~7M iterations clears >3M retires.
    let _ = m.run(7_000_000);
    let s = m.irq_stats();
    assert!(
        s.exc[2] > 3_000_000,
        "illegal-instruction (scause 2) storm counted: exc[2]={}",
        s.exc[2]
    );
    let storm = s.last_storm.clone().expect("storm detector fired");
    assert!(
        storm.window_traps > 5_000,
        "the firing window was hot: {} traps",
        storm.window_traps
    );
}

/// An INTERRUPT storm (critic #1: these were structurally undetectable before — `storm_check`
/// was wired only to the exception path). A CLINT timer with `mtimecmp=0` keeps MTIP pending
/// forever; the handler is just `mret`, so every return re-takes the timer interrupt. The
/// detector must fire, and the timer-interrupt (mcause 7) counter must be large.
#[test]
fn timer_interrupt_storm_is_detected() {
    const HANDLER: u64 = DRAM_BASE + 0x2000;
    let mut m = Machine::new(1024 * 1024);
    let clint = m.enable_clint(1); // mtime advances one tick per retire
    clint.borrow_mut().mtimecmp = 0; // MTIP = (mtime >= 0) = always pending
    set_csr(&mut m, MTVEC, HANDLER);
    set_csr(&mut m, MIE, 1 << 7); // MTIE
    set_csr(&mut m, MSTATUS, 1 << 3); // mstatus.MIE
    m.bus_mut().store32(HANDLER, 0x3020_0073).unwrap(); // mret → re-takes the pending timer
    m.bus_mut().store32(CODE, 0x0000_006F).unwrap(); // jal x0,0 (never actually runs)
    m.hart_mut().regs.pc = CODE;
    // 3M retires (mrets) needed to fire; each cycle is [timer-int]+[mret] = 2 iterations.
    let _ = m.run(8_000_000);
    let s = m.irq_stats();
    assert!(
        s.int[7] > 1_000_000,
        "timer (mcause 7) interrupt storm counted: int[7]={}",
        s.int[7]
    );
    assert!(
        s.last_storm.is_some(),
        "an INTERRUPT storm fires the detector (was undetectable — critic #1)"
    );
}

/// A WFI DEADLOCK: `wfi ; jal x0,0` with no timer and nothing pending+enabled — the guest idles
/// forever. The watchdog must report it (and name the failure).
#[test]
fn wfi_deadlock_watchdog_fires_with_nothing_armed() {
    let mut m = Machine::new(1024 * 1024);
    m.bus_mut().store32(CODE, 0x1050_0073).unwrap(); // wfi
    m.bus_mut().store32(CODE + 4, 0x0000_006F).unwrap(); // jal x0,0 (spin)
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(100);
    let rep = m.irq_stats().last_wfi_report.clone();
    let rep = rep.expect("WFI-deadlock watchdog reported");
    assert!(
        rep.contains("no wakeup source armed"),
        "names the failure: {rep}"
    );
    assert_eq!(
        m.irq_stats().wfi,
        1,
        "exactly one WFI retired before the spin"
    );
}

/// The SAME WFI, but a CLINT timer deadline is armed → a wakeup IS coming, so the watchdog must
/// stay silent (no false positive). This is the adversarial "don't fire when a timer IS armed".
#[test]
fn wfi_watchdog_silent_when_timer_armed() {
    let mut m = Machine::new(1024 * 1024);
    let clint = m.enable_clint(1);
    clint.borrow_mut().mtimecmp = 1_000_000; // a finite future deadline = an armed wakeup
    // Sweep contract update (E2-T20 BUG 2): a wakeup only counts if DELIVERABLE — the armed
    // timer must be enabled in mie (MTIE, bit 7) to silence the watchdog. An armed-but-masked
    // timer is now correctly reported as a deadlock (see critic_storm_hostile.rs).
    m.hart_mut()
        .csr
        .access(wasm_vm_core::csr::MIE, wasm_vm_core::csr::CsrOp::Write, 1 << 7, false, false, 0)
        .unwrap();
    m.bus_mut().store32(CODE, 0x1050_0073).unwrap(); // wfi
    m.bus_mut().store32(CODE + 4, 0x0000_006F).unwrap(); // jal x0,0
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(100);
    assert!(
        m.irq_stats().last_wfi_report.is_none(),
        "an armed DELIVERABLE timer is a wakeup source → no deadlock report"
    );
}

/// A quiet, healthy run must produce ZERO false positives — no storm, no WFI report.
#[test]
fn quiet_run_no_false_positive() {
    let mut m = Machine::new(1024 * 1024);
    // A pure `addi x1, x1, 1 ; jal x0,-4` loop: retires forever, never traps, never WFIs.
    m.bus_mut().store32(CODE, 0x0010_8093).unwrap(); // addi x1,x1,1
    m.bus_mut().store32(CODE + 4, 0xffdf_f06f).unwrap(); // jal x0,-4 (back to the addi)
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(5_000_000);
    let s = m.irq_stats();
    assert!(s.last_storm.is_none(), "no storm on a quiet loop");
    assert!(s.last_wfi_report.is_none(), "no WFI report on a quiet loop");
    assert_eq!(s.exc.iter().sum::<u64>(), 0, "no exceptions");
}
