//! E4-T01 phase 3 — per-subsystem host-time accounting (cold-path timing + CPU-by-subtraction).
//!
//! Proves the phase-3 wiring attributes host wall-time correctly WITHOUT touching the hot path:
//! only the cold device dispatch and the once-per-run total are timed, and CPU-interp time is the
//! total minus the measured device+walk time. All deterministic and headless — no browser boot.
//!
//! The timing is made exact-to-the-nanosecond by a device that advances a [`FixedTimer`] by a known
//! amount on each service call: the bus reads the clock immediately before and after `dev.read/write`,
//! so the delta it attributes is precisely that advance. A `FixedTimer` never auto-advances on a
//! read, so the entry/exit total-span reads contribute nothing on their own — the whole measured
//! span is the sum of the device advances, making `CpuInterp = total − device` land exactly at zero.

#![cfg(not(feature = "zicsr-stub"))]

use std::rc::Rc;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::BusFault;
use wasm_vm_core::mmio::{MmioDevice, Width};
use wasm_vm_core::platform::virt::{KERNEL_BASE, UART0_BASE, UART0_LEN};
use wasm_vm_core::prof::{FixedTimer, HostTimer, Subsystem};
use wasm_vm_core::trace::NullSink;

const RAM_BYTES: usize = 8 << 20;

/// A device that consumes a KNOWN amount of host time per access, by advancing a shared
/// [`FixedTimer`]. Every read/write costs exactly `per_call_ns` — so the bus, which brackets the
/// call with two clock reads, attributes exactly `per_call_ns` to this window's subsystem.
struct SlowDevice {
    timer: Rc<FixedTimer>,
    per_call_ns: u64,
}

impl MmioDevice for SlowDevice {
    fn read(&mut self, _offset: u64, _width: Width) -> Result<u64, BusFault> {
        self.timer.advance(self.per_call_ns);
        Ok(0)
    }
    fn write(&mut self, _offset: u64, _width: Width, _value: u64) -> Result<(), BusFault> {
        self.timer.advance(self.per_call_ns);
        Ok(())
    }
}

// A guest that hammers the UART window: build its base once, then loop storing a byte to it.
//   lui  x6, 0x10000     ; x6 = 0x1000_0000 = UART0_BASE
//   sb   x0, 0(x6)       ; a device WRITE (routes to the cold store_device path)
//   jal  x0, -4          ; back to the sb (offset -4 from the jal at +8 → +4)
const HAMMER_CODE: [u32; 3] = [0x1000_0337, 0x0003_0023, 0xffdf_f06f];

/// A machine whose PC sits at the device-hammer loop, with `dev` attached at the UART window.
fn hammer_machine(dev: Box<dyn MmioDevice>) -> Machine {
    let mut m = Machine::new(RAM_BYTES);
    let mut bytes = [0u8; 12];
    for (i, w) in HAMMER_CODE.iter().enumerate() {
        bytes[i * 4..i * 4 + 4].copy_from_slice(&w.to_le_bytes());
    }
    m.bus_mut()
        .ram_mut()
        .write_slice(KERNEL_BASE, &bytes)
        .expect("write hammer loop into RAM");
    m.bus_mut()
        .attach(UART0_BASE, UART0_LEN, dev)
        .expect("attach slow device at the UART window");
    m.hart_mut().regs.pc = KERNEL_BASE;
    m
}

/// Look up one subsystem's attributed nanoseconds in a report.
fn ns_of(rep: &wasm_vm_core::prof::ProfReport, sub: Subsystem) -> u64 {
    rep.subsystem_ns
        .iter()
        .find(|(s, _)| *s == sub)
        .expect("every subsystem is in the report")
        .1
}

#[test]
fn device_time_is_attributed_to_the_right_subsystem_and_cpu_is_by_subtraction() {
    const PER_CALL_NS: u64 = 500;
    let timer = Rc::new(FixedTimer::new(0));
    let dev = SlowDevice {
        timer: Rc::clone(&timer),
        per_call_ns: PER_CALL_NS,
    };
    let mut m = hammer_machine(Box::new(dev));
    m.set_host_timer(timer); // arms profiling AND hands the bus the clock

    let _ = m.run_traced(40_000, &mut NullSink);

    // The window was hit once per `sb` retire; each hit is one timed device write.
    let hits = m
        .bus_mut()
        .device_hits()
        .into_iter()
        .find(|(base, _)| *base == UART0_BASE)
        .expect("uart window present")
        .1;
    assert!(
        hits > 100,
        "expected the loop to hammer the device; hits={hits}"
    );

    let rep = m.prof_report(m.prof_total_ns(), 8);
    let uart_ns = ns_of(&rep, Subsystem::Uart);
    let cpu_ns = ns_of(&rep, Subsystem::CpuInterp);

    // Every device write cost exactly PER_CALL_NS, attributed to UART (not absorbed into CpuInterp).
    assert_eq!(
        uart_ns,
        hits * PER_CALL_NS,
        "UART device time is exactly hits*per_call"
    );
    // The whole measured span WAS the device time, so CPU-by-subtraction is exactly zero — and, the
    // point of the acceptance test, NON-NEGATIVE.
    assert_eq!(rep.total_ns, uart_ns, "total span equals the device time");
    assert_eq!(cpu_ns, 0, "CpuInterp = total - device = 0 here");
    // Device time dominates; nothing leaked to other device buckets.
    assert!(uart_ns > 0);
    assert_eq!(ns_of(&rep, Subsystem::Clint), 0, "no CLINT time");
    assert_eq!(ns_of(&rep, Subsystem::VirtioBlk), 0, "no virtio-blk time");
    assert_eq!(
        ns_of(&rep, Subsystem::MmuWalk),
        0,
        "no paging → no walk time"
    );

    // Idempotent: a second report (same total) is identical, never double-subtracting CpuInterp.
    let rep2 = m.prof_report(m.prof_total_ns(), 8);
    assert_eq!(ns_of(&rep2, Subsystem::Uart), uart_ns);
    assert_eq!(ns_of(&rep2, Subsystem::CpuInterp), cpu_ns);
}

#[test]
fn profiling_off_reads_no_clock_and_records_zero_ns() {
    const PER_CALL_NS: u64 = 500;
    let timer = Rc::new(FixedTimer::new(0));
    let dev = SlowDevice {
        timer: Rc::clone(&timer),
        per_call_ns: PER_CALL_NS,
    };
    let mut m = hammer_machine(Box::new(dev));
    // Deliberately DO NOT set_host_timer: profiling disabled, the bus holds no clock.

    let _ = m.run_traced(40_000, &mut NullSink);

    // The device WAS accessed (its own timer advanced), proving the path ran…
    assert!(
        timer.now_ns() > 0,
        "the device was hit, so its private timer advanced"
    );
    let hits = m
        .bus_mut()
        .device_hits()
        .into_iter()
        .find(|(base, _)| *base == UART0_BASE)
        .unwrap()
        .1;
    assert!(hits > 100, "device was hammered; hits={hits}");

    // …yet the profiler read no clock: every subsystem bucket, and the total span, are zero.
    let rep = m.prof_report(m.prof_total_ns(), 8);
    assert_eq!(m.prof_total_ns(), 0, "no timer injected → no total span");
    for (sub, ns) in &rep.subsystem_ns {
        assert_eq!(*ns, 0, "{} recorded ns while profiling was off", sub.name());
    }
}

// MMU-walk timing (Subsystem::MmuWalk + walk_count) is exercised by the SAME cold-path mechanism as
// device timing — `walk_leaf` brackets itself with `bus.prof_timer_now()` exactly as the device
// dispatch does. A dedicated guest test would need a full Sv39 page-table + S-mode setup driven to a
// TLB miss, which is disproportionately heavy for a unit test; that leg is DEFERRED to the phase-6
// browser/Alpine evidence run (real paging), where walk_count naturally goes non-zero. The wiring is
// covered here indirectly: `no paging → no walk time` above asserts the path stays silent when it
// must, and the device test proves the identical timer-bracket mechanism attributes correctly.
