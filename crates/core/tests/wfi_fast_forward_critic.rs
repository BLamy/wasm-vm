//! E2-T23b adversarial critic tests: deterministic WFI fast-forward edge cases.
//! The feature shipped with NO dedicated unit tests (only whole-suite non-regression +
//! a Playwright wall-clock measurement). These pin the hostile edges from the task's
//! adversarial-verification section: due-deadline (must fire immediately, no jump),
//! exact-jump (no overshoot past mtimecmp), nearest-of-two deadlines, no-timer no-op,
//! and the pending-but-masked-interrupt case (WFI must wake without time passing —
//! does it?).

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};
use wasm_vm_core::dev::virtio::net::{NetBackend, PcapBackend};

const CODE: u64 = DRAM_BASE;
const HANDLER: u64 = DRAM_BASE + 0x2000;
const WFI: u32 = 0x1050_0073;
const JAL_SELF: u32 = 0x0000_006F; // jal x0, 0
const JAL_BACK4: u32 = 0xFFDF_F06F; // jal x0, -4  (back to the preceding wfi)

fn set_csr(m: &mut Machine, addr: u16, v: u64) {
    m.hart_mut()
        .csr
        .access(addr, CsrOp::Write, v, false, false, 0)
        .unwrap();
}

/// wfi ; jal x0,-4 idle loop + a self-looping handler at MTVEC.
fn idle_machine() -> Machine {
    let mut m = Machine::new(1024 * 1024);
    m.bus_mut().store32(CODE, WFI).unwrap();
    m.bus_mut().store32(CODE + 4, JAL_BACK4).unwrap();
    m.bus_mut().store32(HANDLER, JAL_SELF).unwrap();
    set_csr(&mut m, MTVEC, HANDLER);
    m.hart_mut().regs.pc = CODE;
    m
}

/// Idle WFI with a far-future mtimecmp: mtime must jump to the deadline and the timer must
/// fire on the very next boundary — within a handful of instructions, not deadline*div spins.
#[test]
fn idle_wfi_jumps_to_deadline_and_timer_fires_immediately() {
    let mut m = idle_machine();
    let clint = m.enable_clint(100); // 100 retires per tick: 100_000 ticks = 10M retires unassisted
    clint.borrow_mut().mtimecmp = 100_000;
    set_csr(&mut m, MIE, 1 << 7); // MTIE
    set_csr(&mut m, MSTATUS, 1 << 3); // mstatus.MIE
    let _ = m.run(20); // WITHOUT fast-forward this could never reach the deadline
    assert_eq!(
        m.hart_mut().regs.pc,
        HANDLER,
        "timer interrupt delivered within 20 boundary iterations (fast-forward worked)"
    );
    let mt = clint.borrow().mtime;
    assert!(
        mt >= 100_000,
        "mtime reached the deadline via the jump: mtime={mt}"
    );
}

/// No overshoot: the jump lands mtime EXACTLY on mtimecmp, never past it. run(2) =
/// [boundary: no int; WFI retires; fast-forward] + [boundary: MTIP fires]. The WFI retire
/// itself adds 1 to tick_accum (div=100 → no whole tick), so mtime must equal the deadline.
#[test]
fn jump_lands_exactly_on_mtimecmp_no_overshoot() {
    let mut m = idle_machine();
    let clint = m.enable_clint(100);
    clint.borrow_mut().mtimecmp = 500_000;
    set_csr(&mut m, MIE, 1 << 7);
    set_csr(&mut m, MSTATUS, 1 << 3);
    let _ = m.run(2);
    assert_eq!(
        clint.borrow().mtime,
        500_000,
        "fast-forward must land exactly on the deadline (waking LATER would be a missed deadline)"
    );
    assert_eq!(
        m.hart_mut().regs.pc,
        HANDLER,
        "MTIP delivered on the next boundary"
    );
}

/// Deadline already due (mtimecmp <= mtime): the interrupt must fire IMMEDIATELY at the first
/// boundary — the WFI never even executes, and no jump happens (mtime stays near 0).
#[test]
fn due_mtimecmp_fires_before_wfi_no_jump() {
    let mut m = idle_machine();
    let clint = m.enable_clint(100);
    clint.borrow_mut().mtimecmp = 0; // due from the start
    set_csr(&mut m, MIE, 1 << 7);
    set_csr(&mut m, MSTATUS, 1 << 3);
    let _ = m.run(10);
    assert_eq!(
        m.hart_mut().regs.pc,
        HANDLER,
        "due deadline fired immediately"
    );
    let mt = clint.borrow().mtime;
    assert!(
        mt < 10,
        "no fast-forward jump for an already-due deadline: mtime={mt}"
    );
}

/// No timer armed: WFI spins as a plain retire-count idle (the E2-T20 watchdog covers the
/// deadlock report). mtime must advance ONLY by the retire count — any jump here would leap
/// past a genuine hang.
#[test]
fn no_timer_armed_means_no_jump() {
    let mut m = idle_machine();
    let clint = m.enable_clint(100);
    // mtimecmp stays u64::MAX (cancelled sentinel); nothing enabled.
    let _ = m.run(1_000);
    let mt = clint.borrow().mtime;
    assert!(
        mt <= 1_000 / 100 + 1,
        "mtime advanced only by retires (no silent jump past a hang): mtime={mt}"
    );
    assert_ne!(m.hart_mut().regs.pc, HANDLER, "no interrupt was delivered");
}

/// Pending-but-globally-masked interrupt at the WFI (MSIP pending, MSIE set, mstatus.MIE=0):
/// per the ISA, WFI wakes on pending-even-if-disabled interrupts — no guest time should need
/// to pass. Execution DOES resume (WFI is a retiring nop here), but does fast-forward still
/// jump mtime to the unrelated future timer deadline? This test documents the current
/// behavior; a jump here is a (deterministic) time distortion, not a hang.
#[test]
fn masked_pending_interrupt_wfi_time_behavior() {
    let mut m = idle_machine();
    let clint = m.enable_clint(100);
    {
        let mut c = clint.borrow_mut();
        c.msip = true; // MSIP pending
        c.mtimecmp = 1_000_000; // unrelated future deadline
    }
    set_csr(&mut m, MIE, 1 << 3); // MSIE: pending & locally enabled
    // mstatus.MIE = 0: globally masked → next_interrupt() returns None → "idle" WFI path.
    let _ = m.run(4);
    let mt = clint.borrow().mtime;
    // Execution resumed (the loop is spinning, no interrupt taken) — that part is correct.
    assert_ne!(m.hart_mut().regs.pc, HANDLER);
    // FIXED (sweep): a pending+enabled wakeup (mip & mie != 0) satisfies WFI immediately —
    // no time passes, so the fast-forward must NOT jump. mtime advances only by retires.
    assert!(
        mt < 1_000,
        "masked-pending WFI must not fast-forward the clock (mtime={mt})"
    );
}

struct ExternalIoPending;

impl NetBackend for ExternalIoPending {
    fn external_io_pending(&self) -> bool {
        true
    }

    fn tx(&mut self, _frame: &[u8]) {}

    fn rx(&mut self) -> Option<Vec<u8>> {
        None
    }

    fn rx_ready(&self) -> bool {
        false
    }
}

/// A browser WebSocket can deliver a packet only after `runChunk` returns to JavaScript. If WFI
/// jumps straight to a socket timeout first, a reply already in flight loses the race by
/// construction. External-I/O-pending backends therefore suppress the jump; the ordinary
/// instruction budget becomes the deterministic host-yield boundary.
#[test]
fn external_network_io_suppresses_wfi_deadline_jump() {
    let mut m = idle_machine();
    let clint = m.enable_clint(100);
    clint.borrow_mut().mtimecmp = 500_000;
    set_csr(&mut m, MIE, 1 << 7);
    set_csr(&mut m, MSTATUS, 1 << 3);
    m.enable_plic();
    m.enable_virtio_slots(None);
    let _ = m.enable_virtio_net(Box::new(PcapBackend::new(ExternalIoPending)));

    let _ = m.run(20);

    assert!(
        clint.borrow().mtime < 500_000,
        "host I/O must get a chunk boundary before the guest timer deadline"
    );
    assert_ne!(
        m.hart_mut().regs.pc,
        HANDLER,
        "the timer must not fire before the host can deliver pending I/O"
    );
}

#[derive(Clone, Default)]
struct HostClock(std::rc::Rc<std::cell::Cell<u64>>);

impl wasm_vm_core::time::MonotonicClock for HostClock {
    fn now_nanos(&self) -> u64 {
        self.0.get()
    }
}

/// The machine of `external_network_io_suppresses_wfi_deadline_jump`, but on the paced clock.
fn paced_machine_with_open_connection(mtimecmp: u64) -> (Machine, HostClock) {
    let mut m = idle_machine();
    let clint = m.enable_clint(100);
    clint.borrow_mut().mtimecmp = mtimecmp;
    set_csr(&mut m, MIE, 1 << 7);
    set_csr(&mut m, MSTATUS, 1 << 3);
    m.enable_plic();
    m.enable_virtio_slots(None);
    let _ = m.enable_virtio_net(Box::new(PcapBackend::new(ExternalIoPending)));
    let clock = HostClock::default();
    clock.0.set(1_000_000_000);
    m.set_paced_icount_clock(Box::new(clock.clone())).unwrap();
    (m, clock)
}

/// E5-T43h: under the paced clock an idle guest with a connection open keeps real time. The jump
/// follows the host clock (10 MHz timebase: 20 ms = 200_000 ticks) and never passes it, so the
/// guest's timer fires only once the host has reached it; without the jump the guest's time
/// moved only with its idle loop's retirements (a few ticks here).
#[test]
fn paced_clock_follows_the_host_with_network_io_pending() {
    let (mut m, clock) = paced_machine_with_open_connection(500_000);
    let _ = m.run(20);
    let start = m.clint_mtime();
    assert!(start < 1_000, "no host time has passed yet: mtime={start}");

    clock.0.set(1_020_000_000); // 20 ms of host time
    let _ = m.run(20);
    let after = m.clint_mtime();
    assert!(
        (199_000..=201_000).contains(&(after - start)),
        "guest time followed the host's 20 ms: {} ticks",
        after - start
    );
    assert_ne!(
        m.hart_mut().regs.pc,
        HANDLER,
        "the timer is still 30 ms away"
    );

    clock.0.set(1_060_000_000); // past the deadline
    let _ = m.run(20);
    assert!(m.clint_mtime() >= 500_000, "mtime reached the deadline");
    assert_eq!(
        m.hart_mut().regs.pc,
        HANDLER,
        "the timer fired once the host reached it"
    );
}

/// E5-T43h: with no host time passing, the paced guest does not run ahead either: a reply in
/// flight still arrives before any guest timeout that real time has not reached.
#[test]
fn paced_clock_never_passes_a_stalled_host_with_network_io_pending() {
    let (mut m, _clock) = paced_machine_with_open_connection(500_000);
    for _ in 0..50 {
        let _ = m.run(20);
    }
    assert!(m.clint_mtime() < 1_000, "mtime={}", m.clint_mtime());
    assert_ne!(m.hart_mut().regs.pc, HANDLER);
}
