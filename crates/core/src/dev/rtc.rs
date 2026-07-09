//! Goldfish RTC (E2-T15 stub) — the `google,goldfish-rtc` the DTB advertises at
//! [`crate::platform::virt::RTC_BASE`]. The Linux `rtc-goldfish` driver reads the time at
//! probe (`goldfish_rtc_read_time`); with nothing backing the window that load takes an
//! access fault and aborts the boot. This device answers those reads.
//!
//! **Scope.** E2-T15 only needs the boot not to fault, so the clock reads back a fixed epoch
//! of 0 → the guest's `date` shows 1970, exactly as the milestone predicts. E2-T16 replaces
//! the constant with a real host-clock source; the register interface and the TIME_LOW→
//! TIME_HIGH latch below are already correct, so that change is a one-line time source swap.
//!
//! Register map (drivers/rtc/rtc-goldfish.c): reading `TIME_LOW` samples the 64-bit
//! nanosecond counter and latches its high half; `TIME_HIGH` returns that latched half, so a
//! LOW-then-HIGH pair is a coherent 64-bit read even though the bus is 32 bits wide.

use crate::bus::BusFault;
use crate::mmio::{MmioDevice, Width};

const TIME_LOW: u64 = 0x00;
const TIME_HIGH: u64 = 0x04;
const ALARM_LOW: u64 = 0x08;
const ALARM_HIGH: u64 = 0x0c;
const CLEAR_INTERRUPT: u64 = 0x1c;

/// A read-only goldfish RTC. `now_ns()` is the time source — fixed at 0 for E2-T15.
#[derive(Default)]
pub struct GoldfishRtc {
    /// High 32 bits latched by the last `TIME_LOW` read (goldfish coherency contract).
    time_high_latch: u32,
}

impl GoldfishRtc {
    pub fn new() -> Self {
        Self::default()
    }

    /// The nanosecond wall clock the guest sees. E2-T15: epoch 0 (1970). E2-T16 swaps this
    /// for a real host-time source.
    fn now_ns(&self) -> u64 {
        0
    }
}

impl MmioDevice for GoldfishRtc {
    fn read(&mut self, offset: u64, _width: Width) -> Result<u64, BusFault> {
        // The driver uses 32-bit accessors; answer any width from the 32-bit register value.
        let val = match offset {
            TIME_LOW => {
                let now = self.now_ns();
                self.time_high_latch = (now >> 32) as u32;
                now as u32
            }
            TIME_HIGH => self.time_high_latch,
            // Alarm/IRQ registers: no alarm is ever pending in the stub.
            ALARM_LOW | ALARM_HIGH => 0,
            _ => 0,
        };
        Ok(u64::from(val))
    }

    fn write(&mut self, offset: u64, _width: Width, _value: u64) -> Result<(), BusFault> {
        // Time is read-only; alarm programming and interrupt-clear are accepted and dropped
        // (no alarm interrupt is ever raised by the stub).
        match offset {
            ALARM_LOW | ALARM_HIGH | CLEAR_INTERRUPT => Ok(()),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_time_is_epoch_zero_and_coherent() {
        let mut rtc = GoldfishRtc::new();
        // LOW latches HIGH; both zero at epoch 0 → a coherent 64-bit 0.
        let low = rtc.read(TIME_LOW, Width::B4).unwrap();
        let high = rtc.read(TIME_HIGH, Width::B4).unwrap();
        assert_eq!((high << 32) | low, 0);
    }

    #[test]
    fn writes_never_fault() {
        let mut rtc = GoldfishRtc::new();
        assert!(rtc.write(ALARM_LOW, Width::B4, 123).is_ok());
        assert!(rtc.write(CLEAR_INTERRUPT, Width::B4, 1).is_ok());
    }
}
