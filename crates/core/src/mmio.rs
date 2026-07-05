//! MMIO dispatch: [`SystemBus`] implements [`Bus`] by routing each access either to
//! guest RAM or to a registered [`MmioDevice`] window — the single seam through which
//! every future device (UART, CLINT, PLIC, virtio-mmio) attaches.
//!
//! Routing policy (extends the E0-T03 bus policy):
//!
//! - An access routes to a region only when **every byte** of it lies inside that
//!   region. An access straddling a window edge (or the RAM edge, or two windows)
//!   faults `Access` and the device is **never invoked** — no partial side effects.
//! - Fault precedence is unchanged: containment (range) is checked before alignment,
//!   so a straddling misaligned access faults `Access`, an in-window misaligned access
//!   faults `Misaligned` (again without invoking the device).
//! - Unmapped holes fault `Access` at every width.
//! - Device read results are masked to the access width; a buggy device returning
//!   stray high bits cannot corrupt a narrow load.
//!
//! Hot path: RAM is tried first, and RAM's own checked bounds arithmetic doubles as
//! the routing test — `Err(Access)` means "not fully inside RAM", which is exactly the
//! fall-to-devices condition under this policy (`Misaligned` can only mean "in RAM,
//! misaligned", since windows may not overlap RAM). RAM traffic therefore pays zero
//! dispatch overhead beyond one predictable branch on the result; the device scan runs
//! only on RAM misses, so registered devices add nothing to fetch/execute traffic.

use alloc::boxed::Box;
use alloc::rc::Rc;
use alloc::vec::Vec;
use core::cell::RefCell;

use crate::bus::{Bus, BusFault};
use crate::ram::Ram;

/// MMIO access width. Devices receive the architectural width of the access —
/// a `store16` arrives as one `B2` write, never two `B1` writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Width {
    B1,
    B2,
    B4,
    B8,
}

impl Width {
    /// Width in bytes.
    pub const fn bytes(self) -> u64 {
        match self {
            Width::B1 => 1,
            Width::B2 => 2,
            Width::B4 => 4,
            Width::B8 => 8,
        }
    }

    /// Value mask for this width (`B8` masks nothing).
    pub const fn mask(self) -> u64 {
        match self {
            Width::B1 => 0xFF,
            Width::B2 => 0xFFFF,
            Width::B4 => 0xFFFF_FFFF,
            Width::B8 => u64::MAX,
        }
    }
}

/// A memory-mapped device. Offsets are window-relative (not absolute addresses).
///
/// The bus guarantees: the full access fits inside the window, and the *address* was
/// naturally aligned. It does **not** guarantee the offset is aligned when the window
/// itself is attached at an unaligned base — attach devices at width-aligned bases.
pub trait MmioDevice {
    fn read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault>;
    fn write(&mut self, offset: u64, width: Width, value: u64) -> Result<(), BusFault>;
}

/// Why [`SystemBus::attach`] rejected a window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachError {
    /// Zero-length windows are meaningless and would never match an access.
    ZeroLength,
    /// `base + len` does not fit in the u64 address space (end-exclusive bound).
    AddressOverflow,
    /// The window overlaps guest RAM or an already-attached device window.
    Overlap,
}

struct Window {
    start: u64,
    /// Inclusive last byte — precomputed so dispatch needs no arithmetic that can wrap.
    last: u64,
    dev: Box<dyn MmioDevice>,
}

/// The system bus: guest RAM plus attached MMIO device windows.
pub struct SystemBus {
    ram: Ram,
    windows: Vec<Window>,
}

impl SystemBus {
    pub fn new(ram: Ram) -> Self {
        Self {
            ram,
            windows: Vec::new(),
        }
    }

    /// Attach `dev` at `[base, base + len)`. Rejects zero-length windows, windows whose
    /// end overflows the address space, and windows overlapping RAM or another device.
    pub fn attach(
        &mut self,
        base: u64,
        len: u64,
        dev: Box<dyn MmioDevice>,
    ) -> Result<(), AttachError> {
        if len == 0 {
            return Err(AttachError::ZeroLength);
        }
        // End-exclusive bound must be representable: base + len <= 2^64 - 1.
        // (A window containing byte u64::MAX is thus unattachable; devices live in
        // low memory in every real memory map, so we trade that corner for arithmetic
        // that provably cannot wrap.)
        let end = base.checked_add(len).ok_or(AttachError::AddressOverflow)?;
        let last = end - 1;

        // Overlap checks in u128 so RAM's possibly-past-u64::MAX extent is exact.
        let new = (base as u128, base as u128 + len as u128); // [start, end)
        if !self.ram.is_empty() {
            let ram = (
                self.ram.base() as u128,
                self.ram.base() as u128 + self.ram.len() as u128,
            );
            if new.0 < ram.1 && ram.0 < new.1 {
                return Err(AttachError::Overlap);
            }
        }
        for w in &self.windows {
            let existing = (w.start as u128, w.last as u128 + 1);
            if new.0 < existing.1 && existing.0 < new.1 {
                return Err(AttachError::Overlap);
            }
        }

        self.windows.push(Window {
            start: base,
            last,
            dev,
        });
        Ok(())
    }

    /// The RAM behind this bus (loader escape hatches live on [`Ram`]).
    pub fn ram(&self) -> &Ram {
        &self.ram
    }

    /// Mutable access to RAM for loaders (`write_slice`) and test rigs.
    pub fn ram_mut(&mut self) -> &mut Ram {
        &mut self.ram
    }

    /// True when every byte of `[addr, addr + width)` lies in `[start, last]`.
    /// Plain u64 compares; cannot wrap (width - 1 <= 7, and addr <= last).
    #[inline(always)]
    fn contains(start: u64, last: u64, addr: u64, width: u64) -> bool {
        addr >= start && addr <= last && width - 1 <= last - addr
    }
}

// The cold device paths are free functions taking ONLY `&mut [Window]` — never
// `&mut SystemBus`. This is deliberate hot-path engineering: if these calls took the
// whole bus, the optimizer would have to assume they can move `ram`'s buffer and
// re-load its pointer/length after every potential device call, taxing pure-RAM
// traffic. With split borrows, `ram` provably survives any fallback call unchanged.

/// Full containment → alignment → device read, masked to width (a buggy device
/// returning stray high bits cannot corrupt a narrow load).
#[cold]
fn load_device(windows: &mut [Window], addr: u64, width: Width) -> Result<u64, BusFault> {
    let w = width.bytes();
    let Some(win) = windows
        .iter_mut()
        .find(|win| SystemBus::contains(win.start, win.last, addr, w))
    else {
        return Err(BusFault::Access);
    };
    if addr & (w - 1) != 0 {
        return Err(BusFault::Misaligned);
    }
    win.dev
        .read(addr - win.start, width)
        .map(|v| v & width.mask())
}

/// Full containment → alignment → device write. Mirrors [`load_device`].
#[cold]
fn store_device(
    windows: &mut [Window],
    addr: u64,
    width: Width,
    value: u64,
) -> Result<(), BusFault> {
    let w = width.bytes();
    let Some(win) = windows
        .iter_mut()
        .find(|win| SystemBus::contains(win.start, win.last, addr, w))
    else {
        return Err(BusFault::Access);
    };
    if addr & (w - 1) != 0 {
        return Err(BusFault::Misaligned);
    }
    win.dev.write(addr - win.start, width, value)
}

// RAM first: Ok and Misaligned are final (Misaligned proves full containment in RAM,
// and windows cannot overlap RAM); Access means "not RAM" — fall through to the #[cold]
// device scan. RAM accesses are side-effect-safe to probe: loads have no side effects
// and a faulting store writes nothing (E0-T03). Each width calls Ram's same-width
// accessor directly so the hot path adds no u64 widening/narrowing — only the cold
// device fallback goes through the generic (u64, Width) form.
macro_rules! sysbus_load {
    ($name:ident, $ty:ty, $width:expr) => {
        #[inline(always)]
        fn $name(&mut self, addr: u64) -> Result<$ty, BusFault> {
            match self.ram.$name(addr) {
                Err(BusFault::Access) => {
                    load_device(&mut self.windows, addr, $width).map(|v| v as $ty)
                }
                ram_result => ram_result,
            }
        }
    };
}

macro_rules! sysbus_store {
    ($name:ident, $ty:ty, $width:expr) => {
        #[inline(always)]
        fn $name(&mut self, addr: u64, val: $ty) -> Result<(), BusFault> {
            match self.ram.$name(addr, val) {
                Err(BusFault::Access) => {
                    store_device(&mut self.windows, addr, $width, u64::from(val))
                }
                ram_result => ram_result,
            }
        }
    };
}

impl Bus for SystemBus {
    sysbus_load!(load8, u8, Width::B1);
    sysbus_load!(load16, u16, Width::B2);
    sysbus_load!(load32, u32, Width::B4);
    sysbus_load!(load64, u64, Width::B8);
    sysbus_store!(store8, u8, Width::B1);
    sysbus_store!(store16, u16, Width::B2);
    sysbus_store!(store32, u32, Width::B4);
    sysbus_store!(store64, u64, Width::B8);

    fn ram_contains(&self, addr: u64, len: u64) -> bool {
        // Only the RAM region supports misaligned accesses (E1-T26). Device windows never do
        // — a misaligned access touching a window (or straddling out of RAM) keeps the
        // `*AddrMisaligned` trap. Delegates to the RAM's own containment check.
        self.ram.ram_contains(addr, len)
    }
}

/// Everything a [`RecordingDevice`] captured, shared with the test via `Rc<RefCell<_>>`.
#[derive(Default)]
pub struct RecordingLog {
    pub reads: Vec<(u64, Width)>,
    pub writes: Vec<(u64, Width, u64)>,
}

/// Test double: records every call it receives; reads return a fixed value.
///
/// Lives in the crate (not behind `cfg(test)`) so the wasm mirror tests and
/// adversarial verifiers can use the same double.
pub struct RecordingDevice {
    log: Rc<RefCell<RecordingLog>>,
    read_value: u64,
}

impl RecordingDevice {
    /// A device whose reads all return `read_value`, plus the shared log handle.
    pub fn new(read_value: u64) -> (Self, Rc<RefCell<RecordingLog>>) {
        let log = Rc::new(RefCell::new(RecordingLog::default()));
        (
            Self {
                log: Rc::clone(&log),
                read_value,
            },
            log,
        )
    }
}

impl MmioDevice for RecordingDevice {
    fn read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault> {
        self.log.borrow_mut().reads.push((offset, width));
        Ok(self.read_value)
    }

    fn write(&mut self, offset: u64, width: Width, value: u64) -> Result<(), BusFault> {
        self.log.borrow_mut().writes.push((offset, width, value));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bus::mmap::DRAM_BASE;

    const RAM_SIZE: u64 = 64 * 1024;
    const WIN_BASE: u64 = 0x1000_0000;
    const WIN_LEN: u64 = 0x100;
    const WIN_END: u64 = WIN_BASE + WIN_LEN;
    const HOLE: u64 = 0x2000_0000;

    fn bus_with_device(read_value: u64) -> (SystemBus, Rc<RefCell<RecordingLog>>) {
        let mut bus = SystemBus::new(Ram::new(RAM_SIZE as usize).unwrap());
        let (dev, log) = RecordingDevice::new(read_value);
        bus.attach(WIN_BASE, WIN_LEN, Box::new(dev)).unwrap();
        (bus, log)
    }

    #[test]
    fn ram_accesses_pass_through_unchanged() {
        let (mut bus, log) = bus_with_device(0);
        bus.store64(DRAM_BASE, 0x0123_4567_89AB_CDEF).unwrap();
        assert_eq!(bus.load64(DRAM_BASE), Ok(0x0123_4567_89AB_CDEF));
        assert_eq!(bus.load8(DRAM_BASE), Ok(0xEF)); // little-endian preserved
        // RAM policy preserved through delegation.
        assert_eq!(bus.load64(DRAM_BASE + 4), Err(BusFault::Misaligned));
        assert_eq!(
            bus.load64(DRAM_BASE + RAM_SIZE - 4),
            Err(BusFault::Access) // straddles RAM end; range beats alignment
        );
        // The device saw none of it.
        assert!(log.borrow().reads.is_empty() && log.borrow().writes.is_empty());
    }

    #[test]
    fn window_access_reaches_device_with_offset_width_value() {
        let (mut bus, log) = bus_with_device(0);
        bus.store32(WIN_BASE + 0x40, 0xDEAD_BEEF).unwrap();
        bus.store16(WIN_BASE + 0x10, 0xCAFE).unwrap();
        bus.store8(WIN_BASE, 0x5A).unwrap();
        bus.store64(WIN_BASE + 0xF8, 0x1122_3344_5566_7788).unwrap();
        assert_eq!(
            log.borrow().writes,
            [
                (0x40, Width::B4, 0xDEAD_BEEF),
                (0x10, Width::B2, 0xCAFE),
                (0x00, Width::B1, 0x5A),
                (0xF8, Width::B8, 0x1122_3344_5566_7788),
            ]
        );
        bus.load16(WIN_BASE + 0x20).unwrap();
        assert_eq!(log.borrow().reads, [(0x20, Width::B2)]);
    }

    #[test]
    fn width_forwarding_is_exact_never_split() {
        let (mut bus, log) = bus_with_device(0);
        bus.store16(WIN_BASE + 2, 0xBEEF).unwrap();
        let log = log.borrow();
        assert_eq!(
            log.writes.len(),
            1,
            "store16 must be ONE B2 call, not split"
        );
        assert_eq!(log.writes[0], (2, Width::B2, 0xBEEF));
    }

    #[test]
    fn unmapped_hole_faults_access_at_every_width() {
        let (mut bus, log) = bus_with_device(0);
        assert_eq!(bus.load8(HOLE), Err(BusFault::Access));
        assert_eq!(bus.load16(HOLE), Err(BusFault::Access));
        assert_eq!(bus.load32(HOLE), Err(BusFault::Access));
        assert_eq!(bus.load64(HOLE), Err(BusFault::Access));
        assert_eq!(bus.store8(HOLE, 0), Err(BusFault::Access));
        assert_eq!(bus.store16(HOLE, 0), Err(BusFault::Access));
        assert_eq!(bus.store32(HOLE, 0), Err(BusFault::Access));
        assert_eq!(bus.store64(HOLE, 0), Err(BusFault::Access));
        assert!(log.borrow().reads.is_empty() && log.borrow().writes.is_empty());
    }

    #[test]
    fn straddling_window_edge_faults_and_never_invokes_device() {
        let (mut bus, log) = bus_with_device(0);
        // First byte inside the window, tail past its end.
        assert_eq!(bus.load64(WIN_END - 4), Err(BusFault::Access));
        assert_eq!(bus.store64(WIN_END - 4, 0), Err(BusFault::Access));
        // First byte is the LAST byte of the window (task attack 2 shape).
        assert_eq!(bus.load16(WIN_END - 1), Err(BusFault::Access));
        // Head just before the window, tail inside.
        assert_eq!(bus.load32(WIN_BASE - 2), Err(BusFault::Access));
        assert_eq!(
            log.borrow().reads.len() + log.borrow().writes.len(),
            0,
            "straddling access must not partially invoke the device"
        );
    }

    #[test]
    fn misaligned_in_window_faults_without_invoking_device() {
        let (mut bus, log) = bus_with_device(0);
        assert_eq!(bus.load32(WIN_BASE + 2), Err(BusFault::Misaligned));
        assert_eq!(bus.store16(WIN_BASE + 1, 0), Err(BusFault::Misaligned));
        assert!(log.borrow().reads.is_empty() && log.borrow().writes.is_empty());
    }

    #[test]
    fn attach_rejects_overlap_with_ram_and_devices() {
        let (mut bus, _log) = bus_with_device(0);
        let reject = |bus: &mut SystemBus, base: u64, len: u64| {
            let (dev, _) = RecordingDevice::new(0);
            bus.attach(base, len, Box::new(dev))
        };
        // Overlaps RAM head (task attack 1 shape: DRAM_BASE - 4, len 8).
        assert_eq!(
            reject(&mut bus, DRAM_BASE - 4, 8),
            Err(AttachError::Overlap)
        );
        // Fully inside RAM.
        assert_eq!(
            reject(&mut bus, DRAM_BASE + 8, 8),
            Err(AttachError::Overlap)
        );
        // Overlaps the existing window: partial low, partial high, contained, identical.
        assert_eq!(reject(&mut bus, WIN_BASE - 4, 8), Err(AttachError::Overlap));
        assert_eq!(reject(&mut bus, WIN_END - 4, 8), Err(AttachError::Overlap));
        assert_eq!(reject(&mut bus, WIN_BASE + 4, 4), Err(AttachError::Overlap));
        assert_eq!(
            reject(&mut bus, WIN_BASE, WIN_LEN),
            Err(AttachError::Overlap)
        );
        // Adjacent (touching, not overlapping) is legal on both sides.
        assert_eq!(reject(&mut bus, WIN_END, 0x10), Ok(()));
        assert_eq!(reject(&mut bus, WIN_BASE - 0x10, 0x10), Ok(()));
    }

    #[test]
    fn attach_rejects_zero_length_and_overflow_without_panic() {
        let (mut bus, _log) = bus_with_device(0);
        let (d1, _) = RecordingDevice::new(0);
        assert_eq!(
            bus.attach(0x3000_0000, 0, Box::new(d1)),
            Err(AttachError::ZeroLength)
        );
        // Task attack 5 shape: base = u64::MAX - 2, len = 8.
        let (d2, _) = RecordingDevice::new(0);
        assert_eq!(
            bus.attach(u64::MAX - 2, 8, Box::new(d2)),
            Err(AttachError::AddressOverflow)
        );
        // base + len == 2^64 exactly is also unrepresentable (end-exclusive bound).
        let (d3, _) = RecordingDevice::new(0);
        assert_eq!(
            bus.attach(u64::MAX - 7, 8, Box::new(d3)),
            Err(AttachError::AddressOverflow)
        );
    }

    #[test]
    fn device_read_results_are_masked_to_width() {
        let (mut bus, _log) = bus_with_device(u64::MAX); // device returns all-ones
        assert_eq!(bus.load8(WIN_BASE), Ok(0xFF));
        assert_eq!(bus.load16(WIN_BASE), Ok(0xFFFF));
        assert_eq!(bus.load32(WIN_BASE), Ok(0xFFFF_FFFF));
        assert_eq!(bus.load64(WIN_BASE), Ok(u64::MAX));
    }

    #[test]
    fn multiple_devices_route_independently() {
        let mut bus = SystemBus::new(Ram::new(RAM_SIZE as usize).unwrap());
        let (d1, log1) = RecordingDevice::new(0x11);
        let (d2, log2) = RecordingDevice::new(0x22);
        bus.attach(0x1000_0000, 0x100, Box::new(d1)).unwrap();
        bus.attach(0x1000_1000, 0x100, Box::new(d2)).unwrap();
        assert_eq!(bus.load8(0x1000_0000), Ok(0x11));
        assert_eq!(bus.load8(0x1000_1040), Ok(0x22));
        assert_eq!(log1.borrow().reads, [(0x00, Width::B1)]);
        assert_eq!(log2.borrow().reads, [(0x40, Width::B1)]);
    }

    #[test]
    fn device_faults_propagate() {
        struct Faulty;
        impl MmioDevice for Faulty {
            fn read(&mut self, _: u64, _: Width) -> Result<u64, BusFault> {
                Err(BusFault::Access)
            }
            fn write(&mut self, _: u64, _: Width, _: u64) -> Result<(), BusFault> {
                Err(BusFault::Access)
            }
        }
        let mut bus = SystemBus::new(Ram::new(RAM_SIZE as usize).unwrap());
        bus.attach(WIN_BASE, WIN_LEN, Box::new(Faulty)).unwrap();
        assert_eq!(bus.load32(WIN_BASE), Err(BusFault::Access));
        assert_eq!(bus.store32(WIN_BASE, 1), Err(BusFault::Access));
    }

    #[test]
    fn zero_size_ram_bus_still_routes_devices() {
        let mut bus = SystemBus::new(Ram::new(0).unwrap());
        let (dev, log) = RecordingDevice::new(0x7);
        bus.attach(WIN_BASE, WIN_LEN, Box::new(dev)).unwrap();
        assert_eq!(bus.load8(WIN_BASE + 1), Ok(0x7));
        assert_eq!(log.borrow().reads, [(0x1, Width::B1)]);
        assert_eq!(bus.load8(DRAM_BASE), Err(BusFault::Access));
        // With no RAM, a window over the DRAM range is legal.
        let (d2, _) = RecordingDevice::new(0);
        assert_eq!(bus.attach(DRAM_BASE, 0x100, Box::new(d2)), Ok(()));
    }
}
