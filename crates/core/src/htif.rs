//! Berkeley HTIF `tohost` exit convention (E0-T11), as implemented by Spike and the
//! riscv-test-env — host policy, not CPU architecture, so it lives OUTSIDE the hart and
//! is consulted by the runner after each retired store.
//!
//! Convention: `tohost` is a 64-bit doubleword in guest memory located via ELF symbol.
//! A write of `(code << 1) | 1` requests exit with status `code` (so `1` = exit 0 / test
//! pass; riscv-tests failures write `(test_num << 1) | 1`). Writes with LSB = 0 are
//! device/syscall commands we do not support at Level 0 — logged once and ignored, never
//! treated as exit.
//!
//! WATCH RULE (documented, tested): [`Htif::check`] reads the FULL 64-bit word at
//! `tohost` after any store, regardless of the store's width. So a 32-bit `sw` of an odd
//! value into the low word triggers exit (its bytes land in the doubleword and bit 0 is
//! set); a store to `tohost + 4` alone does not (bit 0 lives in the low word). This
//! matches Spike, which likewise polls the doubleword.

use crate::bus::Bus;

/// A decoded guest-requested exit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Exit {
    pub code: u64,
}

/// Watches the guest's `tohost` doubleword for the exit convention.
#[derive(Debug, Clone, Copy)]
pub struct Htif {
    tohost: u64,
}

impl Htif {
    /// Watch `tohost_addr` (from [`crate::loader::LoadedImage::tohost`]).
    pub fn new(tohost_addr: u64) -> Self {
        Self {
            tohost: tohost_addr,
        }
    }

    /// The watched address.
    pub fn tohost(&self) -> u64 {
        self.tohost
    }

    /// Read and decode the current `tohost` word. A bus fault (e.g. `tohost` not
    /// backed by RAM) decodes as [`HtifStatus::Idle`], never a panic — the
    /// "graceful when unmapped" contract; such a machine simply never exits via HTIF.
    pub fn check(&self, bus: &mut impl Bus) -> HtifStatus {
        match bus.load64(self.tohost) {
            Ok(v) => HtifStatus::decode(v),
            Err(_) => HtifStatus::Idle,
        }
    }
}

/// What a `tohost` word encodes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HtifStatus {
    /// Zero — nothing pending.
    Idle,
    /// `(code << 1) | 1` — the guest requested exit with `code`.
    Exit(Exit),
    /// LSB-clear non-zero value — an unsupported device command (log once, ignore).
    Command(u64),
}

impl HtifStatus {
    /// Decode a raw `tohost` doubleword per the convention.
    pub const fn decode(v: u64) -> Self {
        if v == 0 {
            HtifStatus::Idle
        } else if v & 1 == 1 {
            HtifStatus::Exit(Exit { code: v >> 1 })
        } else {
            HtifStatus::Command(v)
        }
    }

    /// The raw doubleword this status came from (0 for `Idle`, the reconstructed
    /// value otherwise) — used by the runner's change-detection watch.
    pub const fn raw_or_zero(self) -> u64 {
        match self {
            HtifStatus::Idle => 0,
            HtifStatus::Exit(e) => (e.code << 1) | 1,
            HtifStatus::Command(v) => v,
        }
    }
}
