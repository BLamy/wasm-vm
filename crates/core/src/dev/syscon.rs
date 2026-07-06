//! Syscon test finisher (E2-T17) — the `sifive,test0`/`sifive,test1` device QEMU `virt`
//! exposes at [`crate::platform::virt::TEST_BASE`] (`0x100000`). A 32-bit write is a
//! platform command:
//!
//! - `0x5555` → power off (clean) → [`ExitReason::PowerOff`]
//! - `0x3333 | (code << 16)` → power off (failure), `code` in the upper 16 bits → [`ExitReason::Fail`]
//! - `0x7777` → reboot → [`ExitReason::Reboot`]
//! - anything else → ignored (no exit), matching QEMU's finisher.
//!
//! Linux reaches it generically via `syscon-poweroff`/`syscon-reboot` (the DTB child nodes
//! carry `value = 0x5555`/`0x7777`). The device does NOT call `process::exit` — it records
//! the [`ExitReason`] into a shared cell the run loop drains and returns as
//! [`crate::RunOutcome::Reset`], so both the native CLI and the wasm boundary decide what to
//! do (exit vs. re-boot vs. fire a JS event).

use alloc::rc::Rc;
use core::cell::RefCell;

use crate::ExitReason;
use crate::bus::BusFault;
use crate::mmio::{MmioDevice, Width};

const CMD_PASS: u32 = 0x5555; // FINISHER_PASS
const CMD_FAIL: u32 = 0x3333; // FINISHER_FAIL (code in the upper 16 bits)
const CMD_RESET: u32 = 0x7777; // FINISHER_RESET (reboot)

/// Shared latch: the run loop reads (and clears) this to end the run with a [`RunOutcome`].
pub type ResetCell = Rc<RefCell<Option<ExitReason>>>;

/// The MMIO finisher. Recognized writes set `pending`; the machine consumes it each boundary.
pub struct SysconFinisher {
    pending: ResetCell,
}

impl SysconFinisher {
    /// Returns the device and the shared cell the machine polls.
    pub fn new() -> (Self, ResetCell) {
        let pending: ResetCell = Rc::new(RefCell::new(None));
        (
            Self {
                pending: Rc::clone(&pending),
            },
            pending,
        )
    }

    /// Decode a finisher command word into an [`ExitReason`], or `None` for an ignored value.
    fn decode(word: u32) -> Option<ExitReason> {
        match word & 0xFFFF {
            CMD_PASS => Some(ExitReason::PowerOff),
            CMD_RESET => Some(ExitReason::Reboot),
            CMD_FAIL => Some(ExitReason::Fail((word >> 16) as u16)),
            _ => None,
        }
    }
}

impl MmioDevice for SysconFinisher {
    fn read(&mut self, _offset: u64, _width: Width) -> Result<u64, BusFault> {
        // The finisher is write-only in practice; reads return 0 (QEMU reads back 0).
        Ok(0)
    }

    fn write(&mut self, offset: u64, _width: Width, value: u64) -> Result<(), BusFault> {
        // Sweep-critic (E2-T17 LOW, QEMU parity): sifive_test acts only at register offset 0;
        // a command word written elsewhere in the window is a guest error, logged-and-ignored
        // by QEMU — never a poweroff. Linux's DTB nodes use offset 0, so this is unreachable
        // from a conforming guest.
        if offset != 0 {
            return Ok(());
        }
        if let Some(reason) = Self::decode(value as u32) {
            // First recognized command wins; a later write can't override a pending reset.
            let mut slot = self.pending.borrow_mut();
            if slot.is_none() {
                *slot = Some(reason);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_cmd(dev: &mut SysconFinisher, cell: &ResetCell, word: u64) -> Option<ExitReason> {
        dev.write(0, Width::B4, word).unwrap();
        *cell.borrow()
    }

    #[test]
    fn recognized_commands_decode() {
        let (mut dev, cell) = SysconFinisher::new();
        assert_eq!(
            write_cmd(&mut dev, &cell, 0x5555),
            Some(ExitReason::PowerOff)
        );
        let (mut dev, cell) = SysconFinisher::new();
        assert_eq!(write_cmd(&mut dev, &cell, 0x7777), Some(ExitReason::Reboot));
        let (mut dev, cell) = SysconFinisher::new();
        // Fail with code 7 in the upper 16 bits.
        assert_eq!(
            write_cmd(&mut dev, &cell, 0x3333 | (7 << 16)),
            Some(ExitReason::Fail(7))
        );
    }

    #[test]
    fn unrecognized_values_are_ignored() {
        let (mut dev, cell) = SysconFinisher::new();
        for junk in [0u64, 1, 0x1234, 0x5556, 0xDEAD_BEEF, 0x4444] {
            assert_eq!(
                write_cmd(&mut dev, &cell, junk),
                None,
                "junk {junk:#x} ignored"
            );
        }
    }

    #[test]
    fn first_command_wins() {
        let (mut dev, cell) = SysconFinisher::new();
        assert_eq!(
            write_cmd(&mut dev, &cell, 0x5555),
            Some(ExitReason::PowerOff)
        );
        // A later reboot write does not override the latched poweroff.
        assert_eq!(
            write_cmd(&mut dev, &cell, 0x7777),
            Some(ExitReason::PowerOff)
        );
    }

    #[test]
    fn reads_return_zero() {
        let (mut dev, _cell) = SysconFinisher::new();
        assert_eq!(dev.read(0, Width::B4).unwrap(), 0);
    }
}
