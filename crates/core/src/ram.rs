//! Guest physical RAM: a heap-allocated, zero-initialized byte array mapped at a base
//! address, implementing [`Bus`] with the E0-T03 fault policy.

use alloc::vec::Vec;

use crate::bus::{Bus, BusFault, mmap};

/// RAM allocation failed (requested size exceeds what the allocator can provide).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutOfMemory;

/// Byte-array RAM mapped at `base`, addressed by guest physical address.
pub struct Ram {
    base: u64,
    data: Vec<u8>,
}

impl Ram {
    /// RAM of `bytes` zeroed bytes at the canonical [`mmap::DRAM_BASE`].
    ///
    /// Fails with [`OutOfMemory`] instead of aborting on absurd sizes — the allocation
    /// goes through `try_reserve_exact`, so `Ram::new(usize::MAX)` is an `Err`, not a
    /// process abort. `Ram::new(0)` is allowed: every access simply faults `Access`.
    pub fn new(bytes: usize) -> Result<Self, OutOfMemory> {
        Self::with_base(mmap::DRAM_BASE, bytes)
    }

    /// RAM of `bytes` zeroed bytes at an arbitrary base (test rigs, future regions).
    pub fn with_base(base: u64, bytes: usize) -> Result<Self, OutOfMemory> {
        let mut data = Vec::new();
        data.try_reserve_exact(bytes).map_err(|_| OutOfMemory)?;
        data.resize(bytes, 0);
        Ok(Self { base, data })
    }

    /// Size of this RAM in bytes.
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// True when this RAM has zero bytes (every access faults).
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Base guest physical address of this RAM.
    pub fn base(&self) -> u64 {
        self.base
    }

    /// Bounds-check an access and return the starting offset into `data`.
    ///
    /// Overflow-proof by construction: `checked_sub` rejects addresses below base,
    /// `checked_add` rejects `addr + width` wrapping past `u64::MAX`, and the final
    /// compare rejects anything past the end. Range faults take precedence over
    /// alignment faults (see `bus.rs` policy).
    #[inline(always)]
    fn index(&self, addr: u64, width: u64) -> Result<usize, BusFault> {
        let off = addr.checked_sub(self.base).ok_or(BusFault::Access)?;
        let end = off.checked_add(width).ok_or(BusFault::Access)?;
        if end > self.data.len() as u64 {
            return Err(BusFault::Access);
        }
        if addr & (width - 1) != 0 {
            return Err(BusFault::Misaligned);
        }
        Ok(off as usize)
    }

    /// Range-check (no alignment requirement) for byte-granular slice access.
    #[inline]
    fn range(&self, addr: u64, len: u64) -> Result<usize, BusFault> {
        let off = addr.checked_sub(self.base).ok_or(BusFault::Access)?;
        let end = off.checked_add(len).ok_or(BusFault::Access)?;
        if end > self.data.len() as u64 {
            return Err(BusFault::Access);
        }
        Ok(off as usize)
    }

    /// Loader escape hatch: copy out `buf.len()` bytes starting at `addr`.
    /// Byte-granular (no alignment requirement); fails `Access` without partial reads.
    pub fn read_slice(&self, addr: u64, buf: &mut [u8]) -> Result<(), BusFault> {
        let off = self.range(addr, buf.len() as u64)?;
        buf.copy_from_slice(&self.data[off..off + buf.len()]);
        Ok(())
    }

    /// The whole RAM byte array in address order (offset 0 == guest addr `base`).
    /// The canonical digest input for [`crate::snapshot::Snapshot`] (E0-T17) — device
    /// and hart state live in struct fields, never in this buffer.
    pub fn as_bytes(&self) -> &[u8] {
        &self.data
    }

    /// Loader escape hatch: copy `data` into RAM starting at `addr`.
    /// Byte-granular; fails `Access` without partial writes.
    pub fn write_slice(&mut self, addr: u64, data: &[u8]) -> Result<(), BusFault> {
        let off = self.range(addr, data.len() as u64)?;
        self.data[off..off + data.len()].copy_from_slice(data);
        Ok(())
    }
}

macro_rules! impl_load {
    ($name:ident, $ty:ty) => {
        #[inline(always)]
        fn $name(&mut self, addr: u64) -> Result<$ty, BusFault> {
            const W: usize = size_of::<$ty>();
            let i = self.index(addr, W as u64)?;
            let bytes: [u8; W] = self.data[i..i + W].try_into().unwrap();
            Ok(<$ty>::from_le_bytes(bytes))
        }
    };
}

macro_rules! impl_store {
    ($name:ident, $ty:ty) => {
        #[inline(always)]
        fn $name(&mut self, addr: u64, val: $ty) -> Result<(), BusFault> {
            const W: usize = size_of::<$ty>();
            let i = self.index(addr, W as u64)?;
            self.data[i..i + W].copy_from_slice(&val.to_le_bytes());
            Ok(())
        }
    };
}

impl Bus for Ram {
    impl_load!(load8, u8);
    impl_load!(load16, u16);
    impl_load!(load32, u32);
    impl_load!(load64, u64);
    impl_store!(store8, u8);
    impl_store!(store16, u16);
    impl_store!(store32, u32);
    impl_store!(store64, u64);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bus::mmap::{DRAM_BASE, DRAM_SIZE_DEFAULT};

    const SIZE: u64 = 64 * 1024; // small RAM keeps tests fast; boundaries scale-free
    const END: u64 = DRAM_BASE + SIZE;

    fn ram() -> Ram {
        Ram::with_base(DRAM_BASE, SIZE as usize).unwrap()
    }

    #[test]
    fn default_map_constants() {
        assert_eq!(DRAM_BASE, 0x8000_0000);
        assert_eq!(DRAM_SIZE_DEFAULT, 128 * 1024 * 1024);
        let r = Ram::new(4096).unwrap();
        assert_eq!(r.base(), DRAM_BASE);
    }

    #[test]
    fn roundtrip_every_width_at_base_and_last_slot() {
        let mut r = ram();
        macro_rules! rt {
            ($store:ident, $load:ident, $ty:ty, $val:expr) => {
                let w = size_of::<$ty>() as u64;
                for addr in [DRAM_BASE, END - w] {
                    r.$store(addr, $val).unwrap();
                    assert_eq!(
                        r.$load(addr).unwrap(),
                        $val,
                        "{} @ {addr:#x}",
                        stringify!($load)
                    );
                }
            };
        }
        rt!(store8, load8, u8, 0xA5);
        rt!(store16, load16, u16, 0xBEEF);
        rt!(store32, load32, u32, 0xDEAD_BEEF);
        rt!(store64, load64, u64, 0x0123_4567_89AB_CDEF);
    }

    #[test]
    fn straddling_the_end_is_access_not_panic() {
        let mut r = ram();
        // base + size - 4 is misaligned for width 8 too; range wins per policy.
        assert_eq!(r.load64(END - 4), Err(BusFault::Access));
        assert_eq!(r.store64(END - 4, 0), Err(BusFault::Access));
        // Aligned straddles at every width.
        assert_eq!(r.load16(END - 1), Err(BusFault::Access));
        assert_eq!(r.load32(END - 2), Err(BusFault::Access));
        assert_eq!(r.load64(END - 8), Ok(0)); // last valid slot, for contrast
    }

    #[test]
    fn misaligned_in_range_faults_misaligned_at_every_width() {
        let mut r = ram();
        assert_eq!(r.load16(DRAM_BASE + 1), Err(BusFault::Misaligned));
        assert_eq!(r.load32(DRAM_BASE + 2), Err(BusFault::Misaligned));
        assert_eq!(r.load64(DRAM_BASE + 4), Err(BusFault::Misaligned));
        assert_eq!(r.store16(DRAM_BASE + 3, 0), Err(BusFault::Misaligned));
        assert_eq!(r.store32(DRAM_BASE + 1, 0), Err(BusFault::Misaligned));
        assert_eq!(r.store64(DRAM_BASE + 2, 0), Err(BusFault::Misaligned));
        // width 1 has no alignment requirement
        assert_eq!(r.load8(DRAM_BASE + 1), Ok(0));
    }

    #[test]
    fn little_endian_byte_order() {
        let mut r = ram();
        let a = DRAM_BASE + 0x100;
        r.store32(a, 0xDEAD_BEEF).unwrap();
        let bytes: [u8; 4] = core::array::from_fn(|i| r.load8(a + i as u64).unwrap());
        assert_eq!(bytes, [0xEF, 0xBE, 0xAD, 0xDE]);
    }

    #[test]
    fn extreme_addresses_fault_without_overflow_panics() {
        // Runs with debug_assertions on in `cargo test` dev profile: any wrapping
        // arithmetic would panic here instead of returning Access.
        let mut r = ram();
        for addr in [0u64, 0x7FFF_FFFF_FFFF_FFF8, u64::MAX - 7, u64::MAX] {
            assert_eq!(
                r.load8(addr).err(),
                Some(BusFault::Access),
                "load8 {addr:#x}"
            );
            assert_eq!(r.load64(addr & !7).err(), Some(BusFault::Access));
            assert_eq!(r.store64(addr & !7, 0).err(), Some(BusFault::Access));
        }
        // below-base addresses
        assert_eq!(r.load32(DRAM_BASE - 4), Err(BusFault::Access));
        assert_eq!(r.load64(DRAM_BASE - 8), Err(BusFault::Access));
    }

    #[test]
    fn faulting_store_leaves_ram_bit_identical() {
        let mut r = ram();
        r.store64(END - 8, 0x1122_3344_5566_7788).unwrap();
        let mut before = alloc::vec![0u8; 16];
        r.read_slice(END - 16, &mut before).unwrap();
        assert_eq!(
            r.store64(END - 4, 0xFFFF_FFFF_FFFF_FFFF),
            Err(BusFault::Access)
        );
        assert_eq!(r.store32(END - 3, 0xFFFF_FFFF), Err(BusFault::Access));
        let mut after = alloc::vec![0u8; 16];
        r.read_slice(END - 16, &mut after).unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn slice_escape_hatch_bounds_and_content() {
        let mut r = ram();
        r.write_slice(DRAM_BASE + 3, &[1, 2, 3, 4, 5]).unwrap(); // no alignment needed
        let mut buf = [0u8; 5];
        r.read_slice(DRAM_BASE + 3, &mut buf).unwrap();
        assert_eq!(buf, [1, 2, 3, 4, 5]);
        // straddle and overflow
        assert_eq!(r.write_slice(END - 2, &[0; 4]), Err(BusFault::Access));
        assert_eq!(r.read_slice(u64::MAX - 1, &mut buf), Err(BusFault::Access));
        // zero-length at end is fine (empty range)
        assert_eq!(r.read_slice(END, &mut []), Ok(()));
    }

    #[test]
    fn zero_and_absurd_sizes_fail_cleanly() {
        let mut z = Ram::new(0).unwrap();
        assert!(z.is_empty());
        assert_eq!(z.load8(DRAM_BASE), Err(BusFault::Access));
        assert_eq!(z.store8(DRAM_BASE, 1), Err(BusFault::Access));
        // capacity overflow is an Err, not an abort
        assert_eq!(Ram::new(usize::MAX).err(), Some(OutOfMemory));
    }
}
