//! The authoritative **"wasm-vm virt"** machine platform (E2-T01).
//!
//! One source of truth for the guest physical memory map, device windows, IRQ numbers, hart
//! layout, and the kernel boot contract that Linux will boot on. The layout mirrors QEMU's
//! `virt` board (`hw/riscv/virt.c`) wherever that buys free compatibility with existing kernel
//! `.config`s, device trees, and `qemu-system-riscv64 -machine virt` differential debugging.
//!
//! **Rule:** every Epic-2 device task draws its base / size / IRQ from [`virt`] here — there
//! are no magic addresses elsewhere. `bus::mmap`, `dev::plic`, and `dev::clint` re-export these
//! constants rather than redefining them, so a single edit here moves the whole machine.
//!
//! The map was verified byte-for-byte against a real QEMU `virt` DTB (see `docs/platform.md`
//! for the dump command, the full table, and the explicit list of deviations from QEMU).

use alloc::vec;
use alloc::vec::Vec;

/// Canonical constants for the `virt` platform. Addresses and IRQs match `qemu-system-riscv64
/// -machine virt` (QEMU 8.2) unless noted in `docs/platform.md`.
pub mod virt {
    // ── Main memory ────────────────────────────────────────────────────────────────
    /// Base of guest DRAM. Matches QEMU `virt` and Spike, so differential traces need no
    /// address translation.
    pub const DRAM_BASE: u64 = 0x8000_0000;
    /// Default guest DRAM size (128 MiB). DRAM size is a *construction parameter*
    /// ([`Platform::new`]) — this is only the default; the bus never bakes it in. (QEMU's
    /// own default depends on `-m`; documented as a deviation in `docs/platform.md`.)
    pub const DRAM_SIZE_DEFAULT: u64 = 128 * 1024 * 1024;

    // ── Low MMIO devices (all page-aligned, matching QEMU virt) ──────────────────────
    /// syscon test/finisher device (poweroff + reboot) — `sifive,test`.
    pub const TEST_BASE: u64 = 0x0010_0000;
    pub const TEST_LEN: u64 = 0x1000;
    /// goldfish-rtc.
    pub const RTC_BASE: u64 = 0x0010_1000;
    pub const RTC_LEN: u64 = 0x1000;
    /// CLINT — SiFive/QEMU-virt Core-Local Interruptor (E1-T12): msip / mtimecmp / mtime.
    pub const CLINT_BASE: u64 = 0x0200_0000;
    pub const CLINT_LEN: u64 = 0x1_0000;
    /// PLIC — Platform-Level Interrupt Controller (E1-T13).
    pub const PLIC_BASE: u64 = 0x0C00_0000;
    pub const PLIC_LEN: u64 = 0x0060_0000;
    /// UART0 — 16550A (E0-T12 stub today; a full 16550 lands in E2-T07 at the same address).
    pub const UART0_BASE: u64 = 0x1000_0000;
    pub const UART0_LEN: u64 = 0x100;
    /// virtio-mmio transport slots (E2-T08): `VIRTIO_COUNT` windows of `VIRTIO_LEN` bytes,
    /// `VIRTIO_STRIDE` apart, the first at `VIRTIO_BASE`.
    pub const VIRTIO_BASE: u64 = 0x1000_1000;
    pub const VIRTIO_LEN: u64 = 0x1000;
    pub const VIRTIO_STRIDE: u64 = 0x1000;
    pub const VIRTIO_COUNT: u64 = 8;

    // ── IRQ numbers (PLIC source ids) ────────────────────────────────────────────────
    /// UART0 interrupt line.
    pub const UART0_IRQ: u32 = 10;
    /// goldfish-rtc interrupt line.
    pub const RTC_IRQ: u32 = 11;
    /// First virtio-mmio slot's IRQ; slot `i` (0-based) is `VIRTIO_IRQ_BASE + i` → 1..=8.
    pub const VIRTIO_IRQ_BASE: u32 = 1;
    /// Number of PLIC interrupt sources QEMU advertises (`riscv,ndev`). Source 0 is the
    /// "no interrupt" sentinel, so the highest usable source id is `PLIC_NDEV`.
    pub const PLIC_NDEV: u32 = 95;

    // ── Hart layout & boot contract ──────────────────────────────────────────────────
    /// Harts present in Epic 2 (single-hart; SMP arrives in Epic 6).
    pub const NUM_HARTS: usize = 1;
    /// The hart that runs firmware/kernel entry.
    pub const BOOT_HART: u64 = 0;
    /// Kernel/firmware entry register contract (per the E2-T03 firmware decision): the boot
    /// hart enters with `a0 = hartid` and `a1 = DTB physical address`. Named here so device
    /// and boot code share one definition.
    pub const BOOT_A0_IS_HARTID: bool = true;
    /// UART reference clock QEMU virt advertises (`clock-frequency`), Hz.
    pub const UART_CLOCK_HZ: u32 = 3_686_400;
}

/// A named physical-address window `[base, base + len)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Region {
    pub name: &'static str,
    pub base: u64,
    pub len: u64,
}

impl Region {
    /// One past the last byte, or `None` if `base + len` overflows the address space.
    pub const fn end(&self) -> Option<u64> {
        self.base.checked_add(self.len)
    }
    /// Whether `addr` lies inside this window.
    pub fn contains(&self, addr: u64) -> bool {
        match self.end() {
            Some(end) => addr >= self.base && addr < end,
            None => addr >= self.base, // overflowing region runs to the top of the space
        }
    }
    /// Whether two windows share any byte. Overflow-safe (a wrapping `end` is treated as the
    /// top of the address space, so it never falsely reads as disjoint).
    pub fn overlaps(&self, other: &Region) -> bool {
        let a_end = self.end().unwrap_or(u64::MAX);
        let b_end = other.end().unwrap_or(u64::MAX);
        self.base < b_end && other.base < a_end
    }
}

/// Why a proposed platform map is invalid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlatformError {
    /// DRAM size is zero, or `DRAM_BASE + size` overflows the 64-bit address space.
    DramSize(u64),
    /// Two regions share a byte.
    Overlap(Region, Region),
    /// A device window's base or length is not 4 KiB page-aligned.
    Misaligned(Region),
}

/// The `virt` machine platform for a given DRAM size. Construction validates the whole map, so
/// a `Platform` value is a proof that the memory map is consistent (no overlaps, page-aligned
/// device windows, DRAM that fits the address space).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Platform {
    dram_size: u64,
}

impl Default for Platform {
    fn default() -> Self {
        Self::new(virt::DRAM_SIZE_DEFAULT)
    }
}

impl Platform {
    /// Build the platform with `dram_size` bytes of DRAM, validating the resulting map.
    ///
    /// Panics (in every build, so a bad map can never boot) if the map is inconsistent — the
    /// acceptance calls for a debug panic on overlap; we make it unconditional because an
    /// overlapping map is never recoverable. Use [`Platform::try_new`] to test the check
    /// itself without unwinding.
    pub fn new(dram_size: u64) -> Self {
        match Self::try_new(dram_size) {
            Ok(p) => p,
            Err(e) => panic!("invalid wasm-vm virt platform map: {e:?}"),
        }
    }

    /// Fallible constructor: returns the first inconsistency instead of panicking.
    pub fn try_new(dram_size: u64) -> Result<Self, PlatformError> {
        // DRAM must be non-empty and fit under the top of the address space.
        if dram_size == 0 || virt::DRAM_BASE.checked_add(dram_size).is_none() {
            return Err(PlatformError::DramSize(dram_size));
        }
        let p = Platform { dram_size };
        let regions = p.regions();
        // Every device window (i.e. everything but DRAM) must sit on a 4 KiB-aligned base and
        // be non-empty. Lengths need not be a whole page (QEMU's UART window is 0x100), but a
        // sub-page window still occupies its own page for placement, so bases stay page-aligned.
        for r in &regions {
            if r.name != "dram" && (r.len == 0 || r.base % 0x1000 != 0) {
                return Err(PlatformError::Misaligned(*r));
            }
        }
        // No two regions may share a byte.
        for i in 0..regions.len() {
            for j in (i + 1)..regions.len() {
                if regions[i].overlaps(&regions[j]) {
                    return Err(PlatformError::Overlap(regions[i], regions[j]));
                }
            }
        }
        Ok(p)
    }

    /// The configured DRAM size in bytes.
    pub const fn dram_size(&self) -> u64 {
        self.dram_size
    }

    /// The DRAM region.
    pub const fn dram(&self) -> Region {
        Region {
            name: "dram",
            base: virt::DRAM_BASE,
            len: self.dram_size,
        }
    }

    /// Base address of virtio-mmio slot `i` (`0..VIRTIO_COUNT`).
    pub const fn virtio_base(i: u64) -> u64 {
        virt::VIRTIO_BASE + i * virt::VIRTIO_STRIDE
    }

    /// PLIC source id for virtio-mmio slot `i` (`0..VIRTIO_COUNT`) → 1..=8.
    pub const fn virtio_irq(i: u64) -> u32 {
        virt::VIRTIO_IRQ_BASE + i as u32
    }

    /// The full region map for this platform, in ascending base order: the fixed device
    /// windows plus DRAM. This is what [`Platform::try_new`] validates and what device tasks
    /// consult when attaching to the bus.
    pub fn regions(&self) -> Vec<Region> {
        let mut v = vec![
            Region { name: "test", base: virt::TEST_BASE, len: virt::TEST_LEN },
            Region { name: "rtc", base: virt::RTC_BASE, len: virt::RTC_LEN },
            Region { name: "clint", base: virt::CLINT_BASE, len: virt::CLINT_LEN },
            Region { name: "plic", base: virt::PLIC_BASE, len: virt::PLIC_LEN },
            Region { name: "uart0", base: virt::UART0_BASE, len: virt::UART0_LEN },
        ];
        for i in 0..virt::VIRTIO_COUNT {
            v.push(Region {
                name: "virtio-mmio",
                base: Self::virtio_base(i),
                len: virt::VIRTIO_LEN,
            });
        }
        v.push(self.dram());
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The default map is self-consistent: page-aligned device windows, no overlaps.
    #[test]
    fn default_platform_is_valid() {
        let p = Platform::default();
        assert!(Platform::try_new(p.dram_size()).is_ok());
        // Every pair of regions is disjoint.
        let r = p.regions();
        for i in 0..r.len() {
            for j in (i + 1)..r.len() {
                assert!(!r[i].overlaps(&r[j]), "{:?} overlaps {:?}", r[i], r[j]);
            }
        }
    }

    /// Region boundaries: first and last byte are inside, one byte past is outside.
    #[test]
    fn region_boundaries() {
        let p = Platform::new(128 * 1024 * 1024);
        for r in p.regions() {
            let end = r.end().expect("no region overflows in the default map");
            assert!(r.contains(r.base), "{}: first byte", r.name);
            assert!(r.contains(end - 1), "{}: last byte", r.name);
            assert!(!r.contains(end), "{}: one past end must be outside", r.name);
            if r.base > 0 {
                assert!(!r.contains(r.base - 1), "{}: one before base", r.name);
            }
        }
    }

    /// Overlap detection actually fires — a crafted colliding pair is caught, and a DRAM size
    /// whose end overflows the address space is rejected (the only way DRAM, sitting at the top
    /// of the map, can collide). Refutes adversarial check (2).
    #[test]
    fn overlap_and_overflow_are_caught() {
        let a = Region { name: "a", base: 0x1000, len: 0x1000 };
        let b = Region { name: "b", base: 0x1800, len: 0x1000 }; // straddles a's end
        assert!(a.overlaps(&b) && b.overlaps(&a));
        let c = Region { name: "c", base: 0x2000, len: 0x1000 }; // touches a end-to-base
        assert!(!a.overlaps(&c), "adjacent (touching) is not overlap");

        assert_eq!(Platform::try_new(0), Err(PlatformError::DramSize(0)));
        // DRAM_BASE + size wraps past u64::MAX → rejected, not silently accepted.
        let huge = u64::MAX - virt::DRAM_BASE + 1;
        assert_eq!(Platform::try_new(huge), Err(PlatformError::DramSize(huge)));
    }

    /// The IRQ table matches the documented constants (refutes adversarial check (4): the doc's
    /// table and the code must agree). virtio slots 0..8 → IRQ 1..8; distinct, ascending bases.
    #[test]
    fn irq_and_virtio_layout() {
        assert_eq!(virt::UART0_IRQ, 10);
        assert_eq!(virt::RTC_IRQ, 11);
        for i in 0..virt::VIRTIO_COUNT {
            assert_eq!(Platform::virtio_irq(i), 1 + i as u32);
            assert_eq!(Platform::virtio_base(i), 0x1000_1000 + i * 0x1000);
        }
        // Slot 7 (last) is IRQ 8, base 0x1000_8000 — matches QEMU virt.
        assert_eq!(Platform::virtio_irq(7), 8);
        assert_eq!(Platform::virtio_base(7), 0x1000_8000);
        // No virtio IRQ collides with UART/RTC.
        assert!(virt::UART0_IRQ > virt::VIRTIO_IRQ_BASE + (virt::VIRTIO_COUNT as u32 - 1));
        // ndev is large enough to route every source we use.
        assert!(virt::PLIC_NDEV >= virt::RTC_IRQ);
    }
}
