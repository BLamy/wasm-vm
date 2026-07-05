//! Goldfish RTC (E2-T16) — the `google,goldfish-rtc` at [`crate::platform::virt::RTC_BASE`],
//! IRQ 11, the same device QEMU `virt` uses. A 64-bit nanoseconds-since-epoch clock read
//! through two 32-bit registers, plus a one-shot alarm that raises a (level) interrupt.
//!
//! **Time source is injected** via [`WallClock`] so `crates/core` stays free of any host
//! clock call (the determinism gate bans `SystemTime`/`Date::now` in core): the CLI passes a
//! `SystemTime`-backed clock, the browser a `Date.now()` shim (E2-T23 owns drift), and tests
//! a mock. The guest sees `now = clock.now_ns() + offset`, where `offset` is what a guest
//! `date -s` sets — the host clock is never mutated.
//!
//! **Register map** (drivers/rtc/rtc-goldfish.c, QEMU hw/rtc/goldfish_rtc.c):
//! - `TIME_LOW` @0x00 — read: sample `now`, latch its high word, return the low word; write:
//!   splice this low word into the guest count and re-derive `offset` (order-independent).
//! - `TIME_HIGH` @0x04 — read: the high word latched by the last `TIME_LOW` read; write:
//!   splice this high word into the guest count and re-derive `offset`. The Linux driver
//!   writes HIGH then LOW; making each write independent (QEMU's scheme) makes order moot.
//! - `ALARM_LOW` @0x08 — write: arm the alarm at `(alarm_high<<32|low)`; read: alarm low word.
//! - `ALARM_HIGH` @0x0c — write: stash the alarm high word; read: alarm high word.
//! - `IRQ_ENABLED` @0x10 — write: gate the interrupt; read back the flag.
//! - `CLEAR_ALARM` @0x14 — write: disarm the alarm (does not clear a raised interrupt).
//! - `ALARM_STATUS` @0x18 — read: 1 while an armed alarm has not yet fired.
//! - `CLEAR_INTERRUPT` @0x1c — write: deassert a fired alarm's interrupt.
//!
//! The LOW-latches-HIGH read protocol is what keeps a 64-bit read coherent across the 2^32 ns
//! (~4.29 s) rollover: a `TIME_LOW` then `TIME_HIGH` pair always reflects one sampled instant.

use crate::bus::BusFault;
use crate::mmio::{MmioDevice, Width};

const TIME_LOW: u64 = 0x00;
const TIME_HIGH: u64 = 0x04;
const ALARM_LOW: u64 = 0x08;
const ALARM_HIGH: u64 = 0x0c;
const IRQ_ENABLED: u64 = 0x10;
const CLEAR_ALARM: u64 = 0x14;
const ALARM_STATUS: u64 = 0x18;
const CLEAR_INTERRUPT: u64 = 0x1c;

/// Injected host wall clock: nanoseconds since the Unix epoch. Kept a trait so `crates/core`
/// never names a host time API (the determinism guard). Implementations: a `SystemTime` clock
/// in the CLI, a `Date.now()` shim in wasm, a mock in tests.
pub trait WallClock {
    /// Nanoseconds since 1970-01-01 UTC. Monotonicity is NOT required (the RTC tolerates a
    /// host clock stepping backwards; it just reads back the stepped value).
    fn now_ns(&self) -> u64;
}

/// A clock frozen at a fixed instant — the deterministic source for tests and any run that
/// must not read the host (so RTC-touching traces stay reproducible).
pub struct FixedClock(pub u64);
impl WallClock for FixedClock {
    fn now_ns(&self) -> u64 {
        self.0
    }
}

/// Goldfish RTC state. `now = clock.now_ns() (+ offset)`; the alarm fires once when `now`
/// reaches `alarm_deadline`, latching `alarm_fired` (a level the run loop mirrors to the PLIC
/// until `CLEAR_INTERRUPT`).
pub struct GoldfishRtc {
    clock: alloc::boxed::Box<dyn WallClock>,
    /// Guest `date -s` adjustment: added to the host clock (wrapping, so a guest time before
    /// the host epoch is representable). Signed semantics via wrapping u64 arithmetic.
    offset: u64,
    /// High word latched by the last `TIME_LOW` read (read-coherency contract).
    time_high_latch: u32,
    /// Last-programmed alarm deadline (guest-ns); readable back via ALARM_LOW/HIGH even after
    /// the alarm has fired (QEMU keeps the register value; only `alarm_armed` clears).
    alarm: u64,
    /// Whether the alarm will still fire (cleared on fire or by CLEAR_ALARM).
    alarm_armed: bool,
    /// High word stashed by an `ALARM_HIGH` write, consumed by the arming `ALARM_LOW` write.
    alarm_high_write: u32,
    /// Interrupt enable gate.
    irq_enabled: bool,
    /// Latched "alarm fired" — the interrupt level, cleared by `CLEAR_INTERRUPT`.
    alarm_fired: bool,
}

impl GoldfishRtc {
    pub fn new(clock: alloc::boxed::Box<dyn WallClock>) -> Self {
        Self {
            clock,
            offset: 0,
            time_high_latch: 0,
            alarm: 0,
            alarm_armed: false,
            alarm_high_write: 0,
            irq_enabled: false,
            alarm_fired: false,
        }
    }

    /// Guest-visible time: host clock + guest offset (wrapping).
    fn now(&self) -> u64 {
        self.clock.now_ns().wrapping_add(self.offset)
    }

    /// Advance the alarm state machine: fire (latch `alarm_fired`) once `now` reaches an armed
    /// deadline. Called every run-loop boundary by the machine; idempotent. Returns the
    /// current interrupt level (`alarm_fired && irq_enabled`).
    pub fn poll(&mut self) -> bool {
        if self.alarm_armed && self.now() >= self.alarm {
            self.alarm_armed = false; // one-shot
            self.alarm_fired = true;
        }
        self.irq_level()
    }

    /// The interrupt LEVEL the PLIC line should track: a fired alarm, gated by the enable.
    pub fn irq_level(&self) -> bool {
        self.alarm_fired && self.irq_enabled
    }
}

impl MmioDevice for GoldfishRtc {
    fn read(&mut self, offset: u64, _width: Width) -> Result<u64, BusFault> {
        let val: u32 = match offset {
            TIME_LOW => {
                let now = self.now();
                self.time_high_latch = (now >> 32) as u32;
                now as u32
            }
            TIME_HIGH => self.time_high_latch,
            ALARM_LOW => self.alarm as u32,
            ALARM_HIGH => (self.alarm >> 32) as u32,
            IRQ_ENABLED => u32::from(self.irq_enabled),
            ALARM_STATUS => u32::from(self.alarm_armed),
            _ => 0,
        };
        Ok(u64::from(val))
    }

    fn write(&mut self, offset: u64, _width: Width, value: u64) -> Result<(), BusFault> {
        let v = value as u32;
        match offset {
            // Time-set: ORDER-INDEPENDENT, like QEMU. Each 32-bit write splices its half into
            // the current guest count and re-derives the offset, so it doesn't matter that the
            // Linux driver writes TIME_HIGH *then* TIME_LOW (goldfish_rtc_set_time). A stash/
            // commit scheme keyed on one register would drop the other half under the driver's
            // order — writing back only ~4 s of resolution.
            TIME_LOW => {
                let now = self.now();
                let new = (now & 0xffff_ffff_0000_0000) | u64::from(v);
                self.offset = self.offset.wrapping_add(new.wrapping_sub(now));
            }
            TIME_HIGH => {
                let now = self.now();
                let new = (now & 0x0000_0000_ffff_ffff) | (u64::from(v) << 32);
                self.offset = self.offset.wrapping_add(new.wrapping_sub(now));
            }
            // Alarm: HIGH stashes, LOW arms at (high<<32|low) — driver writes HIGH then LOW.
            ALARM_HIGH => self.alarm_high_write = v,
            ALARM_LOW => {
                self.alarm = (u64::from(self.alarm_high_write) << 32) | u64::from(v);
                self.alarm_armed = true;
                self.poll(); // an already-past deadline fires immediately
            }
            IRQ_ENABLED => self.irq_enabled = v != 0,
            CLEAR_ALARM => self.alarm_armed = false, // disarm; keep the value for readback
            CLEAR_INTERRUPT => self.alarm_fired = false,
            _ => {}
        }
        Ok(())
    }
}

/// Bus adapter: shares one [`GoldfishRtc`] between the MMIO window and the run loop (which
/// calls [`GoldfishRtc::poll`]/[`GoldfishRtc::irq_level`] each boundary to drive the PLIC).
pub struct SharedRtc(pub alloc::rc::Rc<core::cell::RefCell<GoldfishRtc>>);

impl MmioDevice for SharedRtc {
    fn read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault> {
        self.0.borrow_mut().read(offset, width)
    }
    fn write(&mut self, offset: u64, width: Width, value: u64) -> Result<(), BusFault> {
        self.0.borrow_mut().write(offset, width, value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::cell::Cell;

    /// A mock clock whose time the test drives explicitly.
    struct Mock(alloc::rc::Rc<Cell<u64>>);
    impl WallClock for Mock {
        fn now_ns(&self) -> u64 {
            self.0.get()
        }
    }
    fn rtc_at(t: alloc::rc::Rc<Cell<u64>>) -> GoldfishRtc {
        GoldfishRtc::new(alloc::boxed::Box::new(Mock(t)))
    }

    fn read64(rtc: &mut GoldfishRtc) -> u64 {
        let lo = rtc.read(TIME_LOW, Width::B4).unwrap();
        let hi = rtc.read(TIME_HIGH, Width::B4).unwrap();
        (hi << 32) | lo
    }

    #[test]
    fn reads_injected_time() {
        let t = alloc::rc::Rc::new(Cell::new(1_700_000_000_000_000_000)); // ~2023 in ns
        let mut rtc = rtc_at(t);
        assert_eq!(read64(&mut rtc), 1_700_000_000_000_000_000);
    }

    #[test]
    fn low_high_latch_is_coherent_across_2p32_boundary() {
        // Host time chosen so a naive re-read of HIGH after LOW would straddle the 2^32 ns
        // rollover. The latch must make the pair reflect ONE instant. Step the clock by 1 ns
        // between the LOW read and the HIGH read 10_000 times right at the boundary.
        let boundary = 5u64 << 32; // high word = 5
        for i in 0..10_000u64 {
            let t = alloc::rc::Rc::new(Cell::new(boundary - 1 + i));
            let mut rtc = rtc_at(alloc::rc::Rc::clone(&t));
            let lo = rtc.read(TIME_LOW, Width::B4).unwrap();
            // Clock advances between the two reads — HIGH must still use the LATCHED word.
            t.set(t.get() + 10);
            let hi = rtc.read(TIME_HIGH, Width::B4).unwrap();
            let got = (hi << 32) | lo;
            let truth = boundary - 1 + i; // the instant sampled at the LOW read
            assert!(
                got.abs_diff(truth) < (1 << 32),
                "rollover glitch at i={i}: got {got:#x} truth {truth:#x}"
            );
        }
    }

    #[test]
    fn guest_set_time_offsets_without_touching_host() {
        let host = alloc::rc::Rc::new(Cell::new(1_000_000_000)); // host = 1s
        let mut rtc = rtc_at(alloc::rc::Rc::clone(&host));
        // The Linux driver writes TIME_HIGH THEN TIME_LOW (goldfish_rtc_set_time). Use that
        // order, with BOTH halves non-trivial, so a stash/commit impl keyed on the wrong
        // register (dropping the low word) would be caught.
        let target = (2u64 << 32) | 0x1234_5678;
        rtc.write(TIME_HIGH, Width::B4, target >> 32).unwrap();
        rtc.write(TIME_LOW, Width::B4, target & 0xffff_ffff)
            .unwrap();
        assert_eq!(
            read64(&mut rtc),
            target,
            "guest sees the exact set time (both halves)"
        );
        assert_eq!(host.get(), 1_000_000_000, "host clock untouched");
        // Host advances by 5s → guest advances by 5s too (offset preserved).
        host.set(host.get() + 5_000_000_000);
        assert_eq!(read64(&mut rtc), target + 5_000_000_000, "offset persists");
    }

    #[test]
    fn time_set_is_write_order_independent() {
        // Both driver order (HIGH,LOW) and the reverse must land the exact same time — the
        // QEMU order-independent contract. Regression guard for the critic's finding.
        let target = (7u64 << 32) | 0xABCD_1234;
        for order in [[TIME_HIGH, TIME_LOW], [TIME_LOW, TIME_HIGH]] {
            let host = alloc::rc::Rc::new(Cell::new(3_000_000_000));
            let mut rtc = rtc_at(alloc::rc::Rc::clone(&host));
            for &reg in &order {
                let half = if reg == TIME_HIGH {
                    target >> 32
                } else {
                    target & 0xffff_ffff
                };
                rtc.write(reg, Width::B4, half).unwrap();
            }
            assert_eq!(
                read64(&mut rtc),
                target,
                "order {order:?} must set the same time"
            );
        }
    }

    #[test]
    fn alarm_value_readable_after_fire() {
        // ALARM_LOW/HIGH read back the programmed value even after the alarm fired (QEMU keeps
        // the register; only ALARM_STATUS clears).
        let t = alloc::rc::Rc::new(Cell::new(0));
        let mut rtc = rtc_at(alloc::rc::Rc::clone(&t));
        let deadline = (1u64 << 32) | 0x99;
        rtc.write(ALARM_HIGH, Width::B4, deadline >> 32).unwrap();
        rtc.write(ALARM_LOW, Width::B4, deadline & 0xffff_ffff)
            .unwrap();
        t.set(deadline + 1);
        rtc.poll(); // fires, disarms
        assert_eq!(
            rtc.read(ALARM_STATUS, Width::B4).unwrap(),
            0,
            "disarmed after fire"
        );
        let lo = rtc.read(ALARM_LOW, Width::B4).unwrap();
        let hi = rtc.read(ALARM_HIGH, Width::B4).unwrap();
        assert_eq!(
            (hi << 32) | lo,
            deadline,
            "alarm value still readable after fire"
        );
    }

    #[test]
    fn alarm_fires_raises_irq_and_clears() {
        let t = alloc::rc::Rc::new(Cell::new(1_000));
        let mut rtc = rtc_at(alloc::rc::Rc::clone(&t));
        rtc.write(IRQ_ENABLED, Width::B4, 1).unwrap();
        // Arm 500 ns out: HIGH then LOW.
        let deadline = 1_500u64;
        rtc.write(ALARM_HIGH, Width::B4, deadline >> 32).unwrap();
        rtc.write(ALARM_LOW, Width::B4, deadline & 0xffff_ffff)
            .unwrap();
        assert_eq!(rtc.read(ALARM_STATUS, Width::B4).unwrap(), 1, "armed");
        assert!(!rtc.poll(), "not yet fired");
        // Time reaches the deadline → fires, IRQ asserts and STAYS asserted (level).
        t.set(2_000);
        assert!(rtc.poll(), "alarm fired → IRQ level high");
        assert!(rtc.poll(), "IRQ stays asserted until cleared (no storm)");
        assert_eq!(
            rtc.read(ALARM_STATUS, Width::B4).unwrap(),
            0,
            "disarmed after fire"
        );
        // Clearing the interrupt deasserts the line.
        rtc.write(CLEAR_INTERRUPT, Width::B4, 0).unwrap();
        assert!(!rtc.poll(), "IRQ deasserted after CLEAR_INTERRUPT");
    }

    #[test]
    fn irq_gated_by_enable() {
        let t = alloc::rc::Rc::new(Cell::new(0));
        let mut rtc = rtc_at(alloc::rc::Rc::clone(&t));
        // Alarm armed but IRQ disabled → fires (latches) but line stays low.
        rtc.write(ALARM_LOW, Width::B4, 100).unwrap();
        t.set(200);
        assert!(
            !rtc.poll(),
            "disabled → no line even though the alarm fired"
        );
        // Enabling now exposes the latched fire.
        rtc.write(IRQ_ENABLED, Width::B4, 1).unwrap();
        assert!(rtc.irq_level(), "enable reveals the latched alarm");
    }
}
