//! The system bus: every memory access in the machine — fetch, load/store, MMIO, the
//! ELF loader — goes through [`Bus`].
//!
//! Policy decisions locked here (E0-T03):
//!
//! - **Little-endian only.** RV64 guests are LE; accessors take/return native integers
//!   and do the LE byte marshalling internally.
//! - **Natural alignment is required.** A misaligned access faults with
//!   [`BusFault::Misaligned`] (matching Spike's default of raising misaligned
//!   exceptions); the CPU maps bus faults to architectural traps in E0-T07/T08.
//! - **Fault precedence: `Access` beats `Misaligned`.** If any byte of the access lies
//!   outside backing memory, the fault is [`BusFault::Access`] even when the address is
//!   also misaligned (e.g. a `load64` straddling the end of RAM at `base + size - 4`).
//!   Range is checked with overflow-proof `u64` arithmetic first; alignment second.

/// Why a bus access failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BusFault {
    /// Some byte of the access is outside any mapped region.
    Access,
    /// The address is not naturally aligned for the access width.
    Misaligned,
}

/// The canonical guest physical memory map.
///
/// These are re-exported from the authoritative [`crate::platform::virt`] definition (E2-T01)
/// so the whole machine has a single source of truth for addresses — `mmap::DRAM_BASE` and
/// `platform::virt::DRAM_BASE` are the same constant. `DRAM_BASE` matches QEMU `virt` and Spike
/// defaults, so differential traces (E0-T20) need no address translation.
pub mod mmap {
    pub use crate::platform::virt::{
        CLINT_BASE, DRAM_BASE, DRAM_SIZE_DEFAULT, PLIC_BASE, UART0_BASE, UART0_LEN,
    };
}

/// Fallible little-endian accessors at every RV64 access width.
///
/// Loads take `&mut self` deliberately: reads can have side effects on devices
/// (e.g. a UART RX register), and E0-T04's MMIO dispatch implements this same trait.
pub trait Bus {
    fn load8(&mut self, addr: u64) -> Result<u8, BusFault>;
    fn load16(&mut self, addr: u64) -> Result<u16, BusFault>;
    fn load32(&mut self, addr: u64) -> Result<u32, BusFault>;
    fn load64(&mut self, addr: u64) -> Result<u64, BusFault>;
    fn store8(&mut self, addr: u64, val: u8) -> Result<(), BusFault>;
    fn store16(&mut self, addr: u64, val: u16) -> Result<(), BusFault>;
    fn store32(&mut self, addr: u64, val: u32) -> Result<(), BusFault>;
    fn store64(&mut self, addr: u64, val: u64) -> Result<(), BusFault>;

    /// True iff `[addr, addr + len)` lies entirely within a region that supports MISALIGNED
    /// accesses — i.e. main memory (RAM). The E1-T26 misaligned-access path uses this to
    /// decide whether a misaligned data access may be handled by byte decomposition (RAM) or
    /// must trap `*AddrMisaligned` per §3.7.1 (MMIO / cross-region / unmapped). The default is
    /// conservative (`false`: nothing supports misaligned) so a bus that forgets to override
    /// simply keeps the strict-alignment behavior. `len` is a power-of-two access width.
    fn ram_contains(&self, addr: u64, len: u64) -> bool {
        let _ = (addr, len);
        false
    }
}
