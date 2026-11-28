//! E5-T43h verifier (promoted): the host-I/O nap against a backend whose state the host flips —
//! a frame arriving during a nap, the connection closing, a busy guest, a pending interrupt, and
//! another busy device (an armed RTC alarm). Each fails under a sabotage of its guarded line.
#![cfg(not(feature = "zicsr-stub"))]
use std::cell::Cell;
use std::rc::Rc;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};
use wasm_vm_core::dev::virtio::net::{NetBackend, PcapBackend};

const CODE: u64 = DRAM_BASE;
const HANDLER: u64 = DRAM_BASE + 0x2000;

#[derive(Clone, Default)]
struct Flags {
    pending: Rc<Cell<bool>>,
    ready: Rc<Cell<bool>>,
    idle: Rc<Cell<bool>>,
}
struct Flip(Flags);
impl NetBackend for Flip {
    fn external_io_pending(&self) -> bool {
        self.0.pending.get()
    }
    fn tx(&mut self, _f: &[u8]) {}
    fn rx(&mut self) -> Option<Vec<u8>> {
        None
    }
    fn rx_ready(&self) -> bool {
        self.0.ready.get()
    }
    fn idle(&self) -> bool {
        self.0.idle.get()
    }
}
#[derive(Clone, Default)]
struct HostClock(Rc<Cell<u64>>);
impl wasm_vm_core::time::MonotonicClock for HostClock {
    fn now_nanos(&self) -> u64 {
        self.0.get()
    }
}
fn csr(m: &mut Machine, a: u16, v: u64) {
    m.hart_mut()
        .csr
        .access(a, CsrOp::Write, v, false, false, 0)
        .unwrap();
}
fn rig(code: &[u32], mie: u64) -> (Machine, HostClock, Flags) {
    let mut m = Machine::new(1024 * 1024);
    for (i, w) in code.iter().enumerate() {
        m.bus_mut().store32(CODE + 4 * i as u64, *w).unwrap();
    }
    m.bus_mut().store32(HANDLER, 0x0000_006F).unwrap();
    csr(&mut m, MTVEC, HANDLER);
    m.hart_mut().regs.pc = CODE;
    let clint = m.enable_clint(100);
    clint.borrow_mut().mtimecmp = 2_000_000; // 200 ms
    csr(&mut m, MIE, mie);
    csr(&mut m, MSTATUS, 1 << 3);
    m.enable_plic();
    m.enable_virtio_slots(None);
    let f = Flags::default();
    f.pending.set(true);
    let _ = m.enable_virtio_net(Box::new(PcapBackend::new(Flip(f.clone()))));
    let clock = HostClock::default();
    clock.0.set(5_000_000_000);
    m.set_paced_icount_clock(Box::new(clock.clone())).unwrap();
    m.set_paced_idle_policy(true, None);
    (m, clock, f)
}
const IDLE: [u32; 2] = [0x1050_0073, 0xFFDF_F06F];

#[test]
fn frame_during_nap_ends_the_nap_and_closing_restores_full_wait() {
    let (mut m, clock, f) = rig(&IDLE, 1 << 7);
    clock.0.set(5_030_000_000); // 30 ms in
    let _ = m.run(64);
    let nap = m.take_idle_wait_nanos();
    eprintln!("A1 nap1={nap:?} mtime={}", m.clint_mtime());
    assert!(matches!(nap, Some(n) if n > 0 && n <= 4_000_000), "{nap:?}");
    // A frame arrives in the browser during the nap; the host comes back after 4 ms.
    clock.0.set(5_034_000_000);
    f.ready.set(true);
    let _ = m.run(64);
    let nap2 = m.take_idle_wait_nanos();
    eprintln!("A1 nap2(frame ready)={nap2:?} mtime={}", m.clint_mtime());
    assert_eq!(nap2, None, "a ready frame must not be napped past");
    let mt = m.clint_mtime();
    assert!(
        (335_000..=341_000).contains(&mt),
        "guest time follows the host: {mt}"
    );
    // Frame consumed, the connection closes: the backend is idle -> full wait offered.
    f.ready.set(false);
    f.pending.set(false);
    f.idle.set(true);
    clock.0.set(5_040_000_000);
    let _ = m.run(64);
    let full = m.take_idle_wait_nanos();
    eprintln!("A1 full={full:?}");
    assert!(matches!(full, Some(n) if n > 150_000_000), "{full:?}");
    assert_ne!(m.hart_mut().regs.pc, HANDLER);
    // Connection reopens: back to naps. Past the deadline the timer fires.
    f.pending.set(true);
    f.idle.set(false);
    clock.0.set(5_100_000_000);
    let _ = m.run(64);
    let nap3 = m.take_idle_wait_nanos();
    assert!(matches!(nap3, Some(n) if n <= 4_000_000), "{nap3:?}");
    clock.0.set(5_201_000_000);
    let _ = m.run(64);
    assert_eq!(
        m.hart_mut().regs.pc,
        HANDLER,
        "timer fires once the host reaches it"
    );
    assert!(m.clint_mtime() >= 2_000_000 && m.clint_mtime() <= 2_011_000);
}

#[test]
fn busy_guest_with_external_io_forever_never_naps() {
    let (mut m, clock, _f) = rig(&[0x0000_006F], 1 << 7); // jal x0,0 : never wfi
    for i in 1..20u64 {
        clock.0.set(5_000_000_000 + i * 1_000_000);
        let _ = m.run(256);
        assert_eq!(m.take_idle_wait_nanos(), None, "iteration {i}");
    }
}

#[test]
fn pending_enabled_interrupt_is_not_napped_past() {
    // MSIE enabled and MSIP raised by the host between run calls; mstatus.MIE=1 -> handler.
    let (mut m, clock, _f) = rig(&IDLE, (1 << 7) | (1 << 3));
    clock.0.set(5_030_000_000);
    let _ = m.run(64);
    assert!(m.take_idle_wait_nanos().is_some());
    m.bus_mut()
        .store32(wasm_vm_core::platform::virt::CLINT_BASE, 1)
        .unwrap(); // msip
    clock.0.set(5_031_000_000);
    let _ = m.run(64);
    assert_eq!(m.take_idle_wait_nanos(), None);
    assert_eq!(
        m.hart_mut().regs.pc,
        HANDLER,
        "software interrupt taken, not napped"
    );
}

struct FixedWall;
impl wasm_vm_core::dev::rtc::WallClock for FixedWall {
    fn now_ns(&self) -> u64 {
        1_700_000_000_000_000_000
    }
}

/// Another device with work (an armed RTC alarm) while the network waits on the host: the
/// host-I/O nap needs EVERY other device idle, so no wait is offered at all.
#[test]
fn busy_other_device_with_network_waiting_is_not_napped() {
    let (mut m, clock, _f) = rig(&IDLE, 1 << 7);
    let _rtc = m.enable_rtc(Box::new(FixedWall));
    let base = wasm_vm_core::platform::virt::RTC_BASE;
    m.bus_mut().store32(base + 0x0c, 0x7fff_ffff).unwrap(); // alarm far in the future
    m.bus_mut().store32(base + 0x08, 0).unwrap();
    clock.0.set(5_030_000_000);
    let _ = m.run(64);
    assert_eq!(
        m.take_idle_wait_nanos(),
        None,
        "an armed alarm is device work"
    );
    // Disarm: the network alone waits on the host again -> short nap.
    m.bus_mut().store32(base + 0x14, 1).unwrap();
    clock.0.set(5_031_000_000);
    let _ = m.run(64);
    let nap = m.take_idle_wait_nanos();
    assert!(matches!(nap, Some(n) if n <= 4_000_000), "{nap:?}");
}
