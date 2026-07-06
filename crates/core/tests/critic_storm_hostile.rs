//! VERIFICATION-DEBT SWEEP (E2-T20) — hostile tests the implementer didn't write.
//! These probe the storm detector's window mechanics and the WFI watchdog's "armed" signal.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::{DRAM_BASE, UART0_BASE};
use wasm_vm_core::csr::{CsrOp, MIE, MTVEC};
use wasm_vm_core::platform::virt::PLIC_BASE;

const CODE: u64 = DRAM_BASE;

fn set_csr(m: &mut Machine, addr: u16, v: u64) {
    m.hart_mut()
        .csr
        .access(addr, CsrOp::Write, v, false, false, 0)
        .unwrap();
}

/// HOSTILE 1 — the WORST storm (zero forward progress) is structurally invisible.
/// mtvec points AT an illegal instruction, so the handler itself re-traps forever and
/// NOTHING ever retires. check_storm's window only closes after 10^6 RETIRED instructions,
/// so with retired frozen the window never closes and the detector never fires — 10M traps,
/// zero progress, zero diagnosis. This is the exact "trap rate >> instruction progress"
/// symptom the task names, at its limit (progress = 0).
#[test]
fn zero_progress_trap_loop_evades_the_detector() {
    const HANDLER: u64 = DRAM_BASE + 0x2000;
    let mut m = Machine::new(1024 * 1024);
    set_csr(&mut m, MTVEC, HANDLER);
    m.bus_mut().store32(CODE, 0x0000_007F).unwrap(); // reserved opcode -> illegal
    m.bus_mut().store32(HANDLER, 0x0000_007F).unwrap(); // the HANDLER is illegal too
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(10_000_000);
    let s = m.irq_stats();
    assert!(
        s.exc[2] > 9_000_000,
        "10M budget = ~10M illegal-instruction traps: exc[2]={}",
        s.exc[2]
    );
    assert_eq!(s.retired, 0, "zero instructions ever retired");
    // THE REFUTATION TARGET: a detector true to its mission fires here.
    assert!(
        s.last_storm.is_some(),
        "FALSE NEGATIVE: 10M traps with ZERO retired never close a retire-count window, \
         so the storm detector stays silent on the most total storm possible"
    );
}

/// HOSTILE 2 — WFI watchdog false NEGATIVE: a timer that is armed but can never be
/// DELIVERED (mie=0) counts as a wakeup forever. mtimecmp=50 fires early in mtime;
/// MTIP goes pending but MTIE=0 means next_interrupt() never delivers it; the guest
/// wfi-spins forever. any_wakeup_armed() returns true purely because mtimecmp != u64::MAX,
/// so the watchdog never reports this genuine never-wakes deadlock.
/// (Arguable-by-design if you assume a polling guest reads mip — recorded here as the
/// detector's actual contract, which the task text does not state.)
#[test]
fn wfi_watchdog_misses_armed_but_never_deliverable_timer() {
    let mut m = Machine::new(1024 * 1024);
    let clint = m.enable_clint(1);
    clint.borrow_mut().mtimecmp = 50; // armed; will be "due" almost immediately
    // mie stays 0 (reset): the timer interrupt can NEVER be delivered.
    m.bus_mut().store32(CODE, 0x1050_0073).unwrap(); // wfi
    m.bus_mut().store32(CODE + 4, 0xffdf_f06f).unwrap(); // jal x0,-4 -> back to wfi
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(200_000);
    let s = m.irq_stats();
    assert!(s.wfi > 50_000, "guest is wfi-spinning: wfi={}", s.wfi);
    assert_eq!(
        s.int.iter().sum::<u64>(),
        0,
        "no interrupt was ever delivered (mie=0)"
    );
    // THE REFUTATION TARGET: this guest idles forever, yet:
    assert!(
        s.last_wfi_report.is_some(),
        "FALSE NEGATIVE: mtimecmp!=MAX counts as 'armed' even though MTIE=0 means \
         the wakeup can never be delivered — the deadlock is never reported"
    );
}

/// HOSTILE 3 — WFI watchdog false POSITIVE: a guest idling for FUTURE external input.
/// UART rx interrupt fully plumbed (IER.ERBFI=1, PLIC priority+enable for IRQ 10,
/// mie.MEIE=1): a host keystroke WOULD wake this guest — proven in part 2 of the test.
/// But any_wakeup_armed() only sees PENDING interrupts (mip&mie) and timers, so before
/// the input arrives it reports a "deadlock" that isn't one.
#[test]
fn wfi_watchdog_false_positive_waiting_for_uart_input() {
    let mut m = Machine::new(1024 * 1024);
    m.enable_plic();
    let uart = m.enable_uart16550();
    // Guest-side setup done host-side for brevity (equivalent MMIO state):
    m.bus_mut().store8(UART0_BASE + 1, 0x01).unwrap(); // IER.ERBFI: rx-data interrupt on
    m.bus_mut().store32(PLIC_BASE + 4 * 10, 1).unwrap(); // priority[UART irq 10] = 1
    m.bus_mut().store32(PLIC_BASE + 0x2000, 1 << 10).unwrap(); // ctx0 (M) enable bit 10
    set_csr(&mut m, MIE, 1 << 11); // MEIE
    set_csr(&mut m, 0x300, 1 << 3); // mstatus.MIE
    set_csr(&mut m, MTVEC, DRAM_BASE + 0x2000);
    m.bus_mut()
        .store32(DRAM_BASE + 0x2000, 0x3020_0073)
        .unwrap(); // handler: mret
    m.bus_mut().store32(CODE, 0x1050_0073).unwrap(); // wfi
    m.bus_mut().store32(CODE + 4, 0xffdf_f06f).unwrap(); // jal x0,-4
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(10_000);
    let fired_before_input = m.irq_stats().last_wfi_report.is_some();
    // Part 2: prove the wakeup was genuinely possible — a keystroke arrives and IS delivered.
    uart.borrow_mut().push_input(b"x");
    let _ = m.run(10_000);
    let delivered = m.irq_stats().int[11]; // mcause 11 = machine external
    assert!(
        delivered > 0,
        "the keystroke wakes the guest via PLIC/MEIP: int[11]={delivered}"
    );
    assert!(
        fired_before_input,
        "(if this fails, the watchdog did NOT false-positive — good)"
    );
    // Both asserts passing = the report before input was a FALSE POSITIVE:
    // the guest was legitimately waiting for input that could (and did) arrive.
}
