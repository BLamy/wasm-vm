//! CLINT — the SiFive/QEMU-virt Core-Local Interruptor (E1-T12), at `0x0200_0000`.
//!
//! Provides the two machine-local interrupt sources OpenSBI and the Linux timer tick ride
//! through:
//!
//! - **`msip`** (offset 0x0000, 32-bit, only bit 0 significant for hart 0) → drives `mip.MSIP`.
//!   A software interrupt: writing 1 raises it, 0 clears it, mirrored directly into the pending
//!   bit (a *level*, not an edge).
//! - **`mtimecmp`** (offset 0x4000, 64-bit) and **`mtime`** (offset 0xBFF8, 64-bit) → the machine
//!   timer. `mip.MTIP` is pending **iff `mtime >= mtimecmp`** (unsigned) — a continuously
//!   re-evaluated level, so writing `mtimecmp` above `mtime` clears MTIP with no CSR access, and
//!   writing it into the past raises MTIP immediately (Priv §3.2.1).
//!
//! The device owns these bits: a `csrw mip` from software cannot set MSIP/MTIP (E1-T11 masks them
//! read-only) — only the CLINT does, via [`crate::csr::Csrs::set_mip_bit`], which the run loop
//! calls each instruction boundary from this shared state.
//!
//! **Clock source.** `mtime` advances deterministically from the retired-instruction count with a
//! configurable divider (the [`crate::Machine`] owns the counter; the device just holds the
//! register). Determinism is the point: native and wasm retire the same instructions, so a timer
//! interrupt lands at the same retire index on both — the property Level-1 tests assert. `mtime`
//! is also directly writable (spec: it is writable memory-mapped), and software writes coexist
//! with the tick advance.
//!
//! 32-bit half accesses to `mtime`/`mtimecmp` are supported (QEMU-virt behavior): the canonical
//! idiom for a 32-bit hart writing a 64-bit `mtimecmp` — write the high half to all-ones first,
//! then the low half, then the real high half — never transiently strobes a spurious interrupt,
//! because a high half of 0xFFFF_FFFF keeps `mtimecmp` above `mtime` throughout.

use alloc::rc::Rc;
use core::cell::RefCell;

use crate::bus::BusFault;
use crate::mmio::{MmioDevice, Width};

/// CLINT register offsets from the device base (hart 0).
const MSIP: u64 = 0x0000;
const MTIMECMP: u64 = 0x4000;
const MTIME: u64 = 0xBFF8;

/// The standard CLINT window length (QEMU-virt): 64 KiB. Re-exported from the authoritative
/// [`crate::platform::virt`] map (E2-T01).
pub use crate::platform::virt::CLINT_LEN;

/// The register state a [`Clint`] device shares with the [`crate::Machine`] that drives its
/// clock and samples its interrupt levels. Hart-0 only for now (single hart).
#[derive(Debug, Clone, Copy, Default)]
pub struct ClintState {
    /// The machine timer, advanced by the retire-count clock and directly writable.
    pub mtime: u64,
    /// Timer compare: `mip.MTIP` is pending iff `mtime >= mtimecmp` (unsigned).
    pub mtimecmp: u64,
    /// Software-interrupt request (bit 0) → `mip.MSIP`.
    pub msip: bool,
}

impl ClintState {
    /// The timer-interrupt level right now: `mtime >= mtimecmp` (unsigned compare, so a
    /// near-`u64::MAX` `mtime` with a small `mtimecmp` does NOT fire until wrap).
    pub const fn mtip(&self) -> bool {
        self.mtime >= self.mtimecmp
    }
}

/// The memory-mapped CLINT device. Holds a shared handle to [`ClintState`]; the machine holds
/// the other handle to advance `mtime` and read the MTIP/MSIP levels.
pub struct Clint {
    state: Rc<RefCell<ClintState>>,
}

impl Clint {
    /// Create the device plus the shared-state handle the machine keeps. `mtimecmp` resets to
    /// `u64::MAX` (no timer interrupt until software programs it) and `mtime` to 0.
    pub fn new() -> (Self, Rc<RefCell<ClintState>>) {
        let state = Rc::new(RefCell::new(ClintState {
            mtime: 0,
            mtimecmp: u64::MAX,
            msip: false,
        }));
        (
            Self {
                state: Rc::clone(&state),
            },
            state,
        )
    }
}

/// Read `bytes`-wide little-endian slice of a 64-bit register at half-offset `off` (0 = low
/// 32 bits, 4 = high 32 bits, and the whole 64 bits when `width == B8` at offset 0).
fn read_reg(reg: u64, half: u64, width: Width) -> u64 {
    match width {
        Width::B8 => reg,
        Width::B4 => (reg >> (half * 8)) & 0xFFFF_FFFF,
        // 1-/2-byte reads: extract the addressed bytes (QEMU services sub-word CLINT reads).
        Width::B2 => (reg >> (half * 8)) & 0xFFFF,
        Width::B1 => (reg >> (half * 8)) & 0xFF,
    }
}

/// Merge a `width`-wide write of `value` at byte-offset `half` into 64-bit register `reg`.
fn write_reg(reg: u64, half: u64, width: Width, value: u64) -> u64 {
    let shift = half * 8;
    let mask = width.mask() << shift;
    (reg & !mask) | ((value << shift) & mask)
}

impl MmioDevice for Clint {
    fn read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault> {
        let s = self.state.borrow();
        match offset {
            // msip: 32-bit, bit 0 significant (hart 0). Sub-word reads see the byte(s).
            o if (MSIP..MSIP + 4).contains(&o) => Ok(u64::from(s.msip) & width.mask()),
            o if (MTIMECMP..MTIMECMP + 8).contains(&o) => {
                Ok(read_reg(s.mtimecmp, o - MTIMECMP, width))
            }
            o if (MTIME..MTIME + 8).contains(&o) => Ok(read_reg(s.mtime, o - MTIME, width)),
            // Unmapped CLINT interior (other harts' registers): reads as 0 on QEMU.
            _ => Ok(0),
        }
    }

    fn write(&mut self, offset: u64, width: Width, value: u64) -> Result<(), BusFault> {
        let mut s = self.state.borrow_mut();
        match offset {
            o if (MSIP..MSIP + 4).contains(&o) => {
                // Only bit 0 of msip is implemented; the rest is WPRI/0.
                s.msip = value & 1 != 0;
            }
            o if (MTIMECMP..MTIMECMP + 8).contains(&o) => {
                s.mtimecmp = write_reg(s.mtimecmp, o - MTIMECMP, width, value);
            }
            o if (MTIME..MTIME + 8).contains(&o) => {
                s.mtime = write_reg(s.mtime, o - MTIME, width, value);
            }
            _ => {}
        }
        Ok(())
    }
}
