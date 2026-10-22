//! Guest physical RAM: a heap-allocated, zero-initialized byte array mapped at a base
//! address, implementing [`Bus`] with the E0-T03 fault policy.

use alloc::vec::Vec;

use crate::bus::{Bus, BusFault, mmap};

/// RAM allocation failed (requested size exceeds what the allocator can provide).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutOfMemory;

/// Session keyframes store and deduplicate RAM in fixed 4 KiB pages.
pub const KEYFRAME_PAGE_BYTES: usize = 4096;
/// One independently content-addressed object in the session store.
pub const KEYFRAME_CHUNK_MAX_BYTES: usize = 4 << 20;
const DELTA_MAGIC: &[u8; 8] = b"WVRAMD01";
const DELTA_HEADER_BYTES: usize = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RamDeltaError {
    NotCapturing,
    ReplayActive,
    Bound,
    Malformed,
    WrongRam,
    OutOfMemory,
}

/// A previous dirty-page capture has not yet been committed or abandoned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirtyEpochBusy;

/// Byte-array RAM mapped at `base`, addressed by guest physical address.
pub struct Ram {
    base: u64,
    data: Vec<u8>,
    /// Writes since the last committed keyframe (or since a capture began).
    dirty: Vec<u64>,
    recorder_dirty_enabled: bool,
    /// Frozen page set being persisted. A failed publication unions it back into `dirty`;
    /// writes during publication remain in `dirty` regardless of the outcome.
    pending_dirty: Option<Vec<u64>>,
    /// Diagnostic count of direct browser-JIT stores whose host callback marked a page.
    direct_store_marks: u64,
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
        let pages = bytes.div_ceil(KEYFRAME_PAGE_BYTES);
        let words = pages.div_ceil(64);
        let mut dirty = Vec::new();
        dirty.try_reserve_exact(words).map_err(|_| OutOfMemory)?;
        dirty.resize(words, 0);
        Ok(Self {
            base,
            data,
            dirty,
            recorder_dirty_enabled: true,
            pending_dirty: None,
            direct_store_marks: 0,
        })
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

    /// Softmmu fast path: the `W` bytes at `addr`, which the caller already proved aligned and
    /// inside RAM. Still range-checked — by the slice lookup itself, the only bounds check on this
    /// path — so a broken caller faults instead of misbehaving; the alignment test is left to the
    /// caller's proof. `None` = outside RAM.
    #[inline(always)]
    fn fast_bytes<const W: usize>(&self, addr: u64) -> Option<&[u8; W]> {
        let off = usize::try_from(addr.wrapping_sub(self.base)).ok()?;
        self.data.get(off..off.checked_add(W)?)?.try_into().ok()
    }

    /// [`Self::fast_bytes`], mutable.
    #[inline(always)]
    fn fast_bytes_mut<const W: usize>(&mut self, addr: u64) -> Option<&mut [u8; W]> {
        let off = usize::try_from(addr.wrapping_sub(self.base)).ok()?;
        self.data.get_mut(off..off.checked_add(W)?)?.try_into().ok()
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

    #[inline]
    fn mark_dirty_offset(&mut self, offset: usize, len: usize) {
        if len == 0 || !self.recorder_dirty_enabled {
            return;
        }
        let first = offset / KEYFRAME_PAGE_BYTES;
        let last = (offset + len - 1) / KEYFRAME_PAGE_BYTES;
        for page in first..=last {
            self.dirty[page / 64] |= 1u64 << (page % 64);
        }
    }

    /// Account for stores that bypass the checked `Bus` store methods. The soft-MMU fast
    /// path uses this after writing into its borrowed RAM slice.
    pub fn mark_dirty_physical_range(&mut self, addr: u64, len: u64) -> Result<(), BusFault> {
        let offset = self.range(addr, len)?;
        self.mark_dirty_offset(offset, len as usize);
        Ok(())
    }

    /// Direct browser-JIT stores write through the shared Wasm memory before calling back.
    /// Keep a separate witness so a test can prove this path executed, rather than merely
    /// counting an interpreted fast store.
    pub fn mark_jit_dirty_physical_range(&mut self, addr: u64, len: u64) -> Result<(), BusFault> {
        self.mark_dirty_physical_range(addr, len)?;
        if self.recorder_dirty_enabled {
            self.direct_store_marks = self.direct_store_marks.saturating_add(1);
        }
        Ok(())
    }

    pub fn direct_store_marks(&self) -> u64 {
        self.direct_store_marks
    }

    /// Freeze the dirty set for an asynchronously published keyframe. A second capture cannot
    /// begin until the first one is committed or abandoned. New writes go to a fresh bitmap.
    pub fn recorder_dirty_tracking(&self) -> bool {
        self.recorder_dirty_enabled
    }

    #[cfg(not(feature = "zicsr-stub"))]
    pub(crate) fn disable_recorder_dirty_tracking(&mut self) -> Result<(), DirtyEpochBusy> {
        if self.pending_dirty.is_some() {
            return Err(DirtyEpochBusy);
        }
        self.recorder_dirty_enabled = false;
        self.dirty = Vec::new();
        Ok(())
    }

    pub fn begin_dirty_epoch(&mut self) -> Result<(), DirtyEpochBusy> {
        if !self.recorder_dirty_enabled || self.pending_dirty.is_some() {
            return Err(DirtyEpochBusy);
        }
        let mut fresh = Vec::new();
        fresh
            .try_reserve_exact(self.dirty.len())
            .map_err(|_| DirtyEpochBusy)?;
        fresh.resize(self.dirty.len(), 0);
        self.pending_dirty = Some(core::mem::replace(&mut self.dirty, fresh));
        Ok(())
    }

    /// Commit the frozen set after durable publication, or merge it back on failure.
    pub fn finish_dirty_epoch(&mut self, committed: bool) -> Result<(), DirtyEpochBusy> {
        let pending = self.pending_dirty.take().ok_or(DirtyEpochBusy)?;
        if !committed {
            for (current, old) in self.dirty.iter_mut().zip(pending) {
                *current |= old;
            }
        }
        Ok(())
    }

    /// Frozen dirty-page count; `None` means no capture is active.
    pub fn pending_dirty_pages(&self) -> Option<usize> {
        self.pending_dirty
            .as_ref()
            .map(|bits| bits.iter().map(|word| word.count_ones() as usize).sum())
    }

    /// Return the page's current bytes only if it belongs to the frozen dirty set. The final
    /// page may be shorter than 4 KiB. Callers hold the guest paused until publication.
    pub fn pending_page(&self, page: usize) -> Option<&[u8]> {
        let bits = self.pending_dirty.as_ref()?;
        let word = *bits.get(page / 64)?;
        if word & (1u64 << (page % 64)) == 0 {
            return None;
        }
        let start = page.checked_mul(KEYFRAME_PAGE_BYTES)?;
        self.data.get(
            start
                ..self
                    .data
                    .len()
                    .min(start.saturating_add(KEYFRAME_PAGE_BYTES)),
        )
    }

    /// The number of addressable keyframe pages, including a possibly short final page.
    pub fn page_count(&self) -> usize {
        self.data.len().div_ceil(KEYFRAME_PAGE_BYTES)
    }

    /// Emit at most one 4 MiB object from the frozen dirty bitmap. The cursor is the first
    /// page not yet considered; the returned cursor advances past the last emitted page. This
    /// avoids staging a guest-sized delta in either Rust or the browser main thread.
    pub fn next_pending_delta_chunk(
        &self,
        from_page: usize,
    ) -> Result<Option<(usize, Vec<u8>)>, RamDeltaError> {
        if self.pending_dirty.is_none() {
            return Err(RamDeltaError::NotCapturing);
        }
        if from_page > self.page_count() || self.data.len() > u64::MAX as usize {
            return Err(RamDeltaError::Bound);
        }
        let estimate = self
            .pending_dirty_pages()
            .unwrap_or(0)
            .min((KEYFRAME_CHUNK_MAX_BYTES - DELTA_HEADER_BYTES) / (6 + KEYFRAME_PAGE_BYTES));
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(DELTA_HEADER_BYTES + estimate * (6 + KEYFRAME_PAGE_BYTES))
            .map_err(|_| RamDeltaError::OutOfMemory)?;
        bytes.extend_from_slice(DELTA_MAGIC);
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&(self.data.len() as u64).to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        let mut count = 0u32;
        let mut cursor = from_page;
        while cursor < self.page_count() {
            if let Some(page) = self.pending_page(cursor) {
                if bytes.len() + 6 + page.len() > KEYFRAME_CHUNK_MAX_BYTES {
                    break;
                }
                let index = u32::try_from(cursor).map_err(|_| RamDeltaError::Bound)?;
                let length = u16::try_from(page.len()).map_err(|_| RamDeltaError::Bound)?;
                bytes.extend_from_slice(&index.to_le_bytes());
                bytes.extend_from_slice(&length.to_le_bytes());
                bytes.extend_from_slice(page);
                count += 1;
            }
            cursor += 1;
        }
        if count == 0 {
            return Ok(None);
        }
        bytes[20..24].copy_from_slice(&count.to_le_bytes());
        Ok(Some((cursor, bytes)))
    }

    /// Validate the complete chunk before the first byte changes. The caller authenticates the
    /// object's SHA-256 and ancestor order; this parser enforces canonical page bounds/order.
    pub fn apply_delta_chunk(&mut self, bytes: &[u8]) -> Result<usize, RamDeltaError> {
        if bytes.len() < DELTA_HEADER_BYTES || bytes.len() > KEYFRAME_CHUNK_MAX_BYTES {
            return Err(RamDeltaError::Bound);
        }
        if &bytes[..8] != DELTA_MAGIC || bytes[8..12] != 1u32.to_le_bytes() {
            return Err(RamDeltaError::Malformed);
        }
        let ram_len = u64::from_le_bytes(bytes[12..20].try_into().unwrap());
        if ram_len != self.data.len() as u64 {
            return Err(RamDeltaError::WrongRam);
        }
        let count = u32::from_le_bytes(bytes[20..24].try_into().unwrap()) as usize;
        if count == 0 || count > KEYFRAME_CHUNK_MAX_BYTES / (6 + KEYFRAME_PAGE_BYTES) + 1 {
            return Err(RamDeltaError::Bound);
        }
        let mut slices = Vec::new();
        slices
            .try_reserve_exact(count)
            .map_err(|_| RamDeltaError::OutOfMemory)?;
        let mut at = DELTA_HEADER_BYTES;
        let mut previous = None;
        for _ in 0..count {
            let record = bytes.get(at..at + 6).ok_or(RamDeltaError::Malformed)?;
            let index = u32::from_le_bytes(record[..4].try_into().unwrap()) as usize;
            let length = u16::from_le_bytes(record[4..6].try_into().unwrap()) as usize;
            let start = index
                .checked_mul(KEYFRAME_PAGE_BYTES)
                .ok_or(RamDeltaError::Bound)?;
            if start >= self.data.len() || previous.is_some_and(|old| index <= old) {
                return Err(RamDeltaError::Malformed);
            }
            let expected = KEYFRAME_PAGE_BYTES.min(self.data.len() - start);
            if length != expected {
                return Err(RamDeltaError::Malformed);
            }
            at += 6;
            let end = at.checked_add(length).ok_or(RamDeltaError::Bound)?;
            bytes.get(at..end).ok_or(RamDeltaError::Malformed)?;
            slices.push((start, at, end));
            at = end;
            previous = Some(index);
        }
        if at != bytes.len() {
            return Err(RamDeltaError::Malformed);
        }
        for (start, begin, end) in slices {
            self.data[start..start + end - begin].copy_from_slice(&bytes[begin..end]);
            self.mark_dirty_offset(start, end - begin);
        }
        Ok(count)
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
        self.mark_dirty_offset(off, data.len());
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
            self.mark_dirty_offset(i, W);
            Ok(())
        }
    };
}

macro_rules! impl_fast_load {
    ($name:ident, $ty:ty) => {
        #[inline(always)]
        fn $name(&mut self, addr: u64) -> Result<$ty, BusFault> {
            const W: usize = size_of::<$ty>();
            debug_assert!(
                addr.is_multiple_of(W as u64),
                "fast-path access must be aligned"
            );
            match self.fast_bytes::<W>(addr) {
                Some(bytes) => Ok(<$ty>::from_le_bytes(*bytes)),
                None => Err(BusFault::Access),
            }
        }
    };
}

macro_rules! impl_fast_store {
    ($name:ident, $ty:ty) => {
        #[inline(always)]
        fn $name(&mut self, addr: u64, val: $ty) -> Result<(), BusFault> {
            const W: usize = size_of::<$ty>();
            debug_assert!(
                addr.is_multiple_of(W as u64),
                "fast-path access must be aligned"
            );
            match self.fast_bytes_mut::<W>(addr) {
                Some(bytes) => {
                    *bytes = val.to_le_bytes();
                    self.mark_dirty_physical_range(addr, W as u64)?;
                    Ok(())
                }
                None => Err(BusFault::Access),
            }
        }
    };
}

impl Bus for Ram {
    impl_fast_load!(ram_load8, u8);
    impl_fast_load!(ram_load16, u16);
    impl_fast_load!(ram_load32, u32);
    impl_fast_load!(ram_load64, u64);
    impl_fast_store!(ram_store8, u8);
    impl_fast_store!(ram_store16, u16);
    impl_fast_store!(ram_store32, u32);
    impl_fast_store!(ram_store64, u64);

    impl_load!(load8, u8);
    impl_load!(load16, u16);
    impl_load!(load32, u32);
    impl_load!(load64, u64);
    impl_store!(store8, u8);
    impl_store!(store16, u16);
    impl_store!(store32, u32);
    impl_store!(store64, u64);

    fn ram_contains(&self, addr: u64, len: u64) -> bool {
        // [addr, addr+len) ⊆ [base, base+len_bytes). Wide compares (checked_add) so a range
        // ending past u64::MAX cannot wrap into a false positive.
        match addr.checked_add(len) {
            Some(end) => addr >= self.base() && end <= self.base() + self.len() as u64,
            None => false,
        }
    }
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
    fn dirty_epochs_keep_cpu_dma_and_intervening_writes_until_commit() {
        let mut r = Ram::new(KEYFRAME_PAGE_BYTES * 3 + 7).unwrap();
        let base = r.base();
        r.store32(base, 0x1020_3040).unwrap();
        r.ram_store8(base + KEYFRAME_PAGE_BYTES as u64, 0x5a)
            .unwrap();
        r.write_slice(base + (KEYFRAME_PAGE_BYTES * 2 - 2) as u64, &[1, 2, 3, 4])
            .unwrap();
        assert!(r.begin_dirty_epoch().is_ok());
        assert_eq!(r.pending_dirty_pages(), Some(3));
        assert_eq!(r.begin_dirty_epoch(), Err(DirtyEpochBusy));
        assert_eq!(&r.pending_page(0).unwrap()[..4], &[0x40, 0x30, 0x20, 0x10]);
        assert_eq!(r.pending_page(3), None);

        // A raw browser JIT store has already written memory; the physical-store log still
        // marks it for the *next* epoch while the previous capture is in flight.
        r.mark_jit_dirty_physical_range(base + (KEYFRAME_PAGE_BYTES * 3) as u64, 1)
            .unwrap();
        assert_eq!(r.direct_store_marks(), 1);
        assert_eq!(r.pending_dirty_pages(), Some(3));
        r.finish_dirty_epoch(true).unwrap();
        r.begin_dirty_epoch().unwrap();
        assert_eq!(r.pending_dirty_pages(), Some(1));
        assert_eq!(r.pending_page(3).unwrap().len(), 7);
        r.finish_dirty_epoch(false).unwrap();
        r.begin_dirty_epoch().unwrap();
        assert_eq!(r.pending_dirty_pages(), Some(1));
        r.finish_dirty_epoch(true).unwrap();
    }

    #[test]
    fn restored_ram_and_write_back_to_old_value_stay_dirty() {
        use crate::resume::ComponentSnapshot;
        let mut r = Ram::new(KEYFRAME_PAGE_BYTES * 2).unwrap();
        let base = r.base();
        r.store8(base + 10, 0x77).unwrap();
        r.store8(base + 10, 0).unwrap();
        r.begin_dirty_epoch().unwrap();
        assert_eq!(r.pending_dirty_pages(), Some(1));
        assert_eq!(r.pending_page(0).unwrap()[10], 0);
        r.finish_dirty_epoch(true).unwrap();

        let bytes = r.to_snapshot();
        r.restore(&bytes).unwrap();
        r.begin_dirty_epoch().unwrap();
        assert_eq!(r.pending_dirty_pages(), Some(2));
        r.finish_dirty_epoch(true).unwrap();
    }

    #[test]
    fn delta_chunks_round_trip_and_late_corruption_is_atomic() {
        let size = KEYFRAME_PAGE_BYTES * 1025 + 17;
        let mut source = Ram::new(size).unwrap();
        let base = source.base();
        for page in 0..1025 {
            source
                .write_slice(base + (page * KEYFRAME_PAGE_BYTES) as u64, &[page as u8])
                .unwrap();
        }
        source
            .write_slice(base + (1025 * KEYFRAME_PAGE_BYTES) as u64, &[0x71; 17])
            .unwrap();
        source.begin_dirty_epoch().unwrap();
        let mut chunks = Vec::new();
        let mut cursor = 0;
        while let Some((next, chunk)) = source.next_pending_delta_chunk(cursor).unwrap() {
            assert!(next > cursor && chunk.len() <= KEYFRAME_CHUNK_MAX_BYTES);
            chunks.push(chunk);
            cursor = next;
        }
        assert_eq!(chunks.len(), 2);
        let mut restored = Ram::new(size).unwrap();
        for chunk in &chunks {
            restored.apply_delta_chunk(chunk).unwrap();
        }
        assert_eq!(restored.as_bytes(), source.as_bytes());

        let before = restored.as_bytes().to_vec();
        let mut corrupt = chunks[0].clone();
        // The last record's length is checked after every earlier record was parsed, before
        // any page may change. A content-addressed store would also reject this hash change.
        let last = corrupt.len() - KEYFRAME_PAGE_BYTES - 2;
        corrupt[last..last + 2].copy_from_slice(&1u16.to_le_bytes());
        assert_eq!(
            restored.apply_delta_chunk(&corrupt),
            Err(RamDeltaError::Malformed)
        );
        assert_eq!(restored.as_bytes(), before);
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

    #[test]
    fn fast_path_accessors_match_the_checked_ones_and_still_range_check() {
        let mut r = ram();
        // Same bytes, same values, every width, at both ends of RAM.
        for addr in [DRAM_BASE, END - 8] {
            r.ram_store64(addr, 0x0123_4567_89AB_CDEF).unwrap();
            assert_eq!(r.load64(addr), Ok(0x0123_4567_89AB_CDEF));
            assert_eq!(r.ram_load64(addr), Ok(0x0123_4567_89AB_CDEF));
            assert_eq!(r.ram_load32(addr + 4), r.load32(addr + 4));
            assert_eq!(r.ram_load16(addr + 6), r.load16(addr + 6));
            assert_eq!(r.ram_load8(addr + 7), r.load8(addr + 7));
            r.ram_store32(addr, 0xDEAD_BEEF).unwrap();
            r.ram_store16(addr + 4, 0xCAFE).unwrap();
            r.ram_store8(addr + 6, 0x5A).unwrap();
            assert_eq!(r.load64(addr), Ok(0x015A_CAFE_DEAD_BEEF));
        }
        // A broken caller outside RAM faults instead of touching memory (no wrap-around alias).
        let before = r.as_bytes().to_vec();
        for addr in [
            END,
            DRAM_BASE - 8,
            0,
            u64::MAX - 7,
            DRAM_BASE + (1u64 << 40),
        ] {
            assert_eq!(r.ram_load64(addr), Err(BusFault::Access), "{addr:#x}");
            assert_eq!(r.ram_store64(addr, 0), Err(BusFault::Access), "{addr:#x}");
        }
        assert_eq!(r.as_bytes(), &before[..]);
        let mut z = Ram::new(0).unwrap();
        assert_eq!(z.ram_load8(DRAM_BASE), Err(BusFault::Access));
    }
}

/// E3-T12: RAM snapshots as its entire byte array through the zero-elision codec (a mostly-idle
/// guest RAM doesn't serialize to its full size). RAM state IS its bytes — nothing hidden — so this
/// is complete by construction. `base` is fixed platform config (bound by the header's base-image
/// hash), not dynamic state, so it isn't part of the payload. Restore into a RAM of a DIFFERENT size
/// is refused: the sparse parser requires exactly the current length, so a snapshot of
/// a differently-sized RAM cannot be applied.
impl crate::resume::ComponentSnapshot for Ram {
    const SECTION: u32 = crate::resume::section::RAM;

    fn to_snapshot(&self) -> alloc::vec::Vec<u8> {
        crate::resume::encode_sparse(&self.data)
    }

    fn restore(&mut self, payload: &[u8]) -> Result<(), crate::resume::SnapshotError> {
        // Validate every run before modifying existing RAM; do not allocate a second guest-sized
        // growable buffer whose reallocation can exhaust the wasm32 address space at1GiB.
        crate::resume::restore_sparse_into(payload, &mut self.data)?;
        for word in &mut self.dirty {
            *word = u64::MAX;
        }
        // Remove bits beyond the final addressable page so a later capture never exports them.
        let remaining = self.page_count() % 64;
        if let Some(last) = self.dirty.last_mut()
            && remaining != 0
        {
            *last = (1u64 << remaining) - 1;
        }
        Ok(())
    }
}

#[cfg(test)]
mod resume_snapshot_tests {
    use super::Ram;
    use crate::resume::{ComponentSnapshot, SnapshotError, section};

    /// A RAM with a mostly-zero body plus a few non-zero spans (the realistic snapshot shape).
    fn patterned(len: usize) -> Ram {
        let mut r = Ram::new(len).unwrap();
        for off in [0usize, 1024, len / 2, len - 4] {
            for k in 0..4 {
                if off + k < len {
                    r.data[off + k] = (off as u8) ^ (k as u8) | 1;
                }
            }
        }
        r
    }

    #[test]
    fn ram_round_trips_completely() {
        let r = patterned(1 << 16);
        assert_eq!(Ram::SECTION, section::RAM);
        let bytes = r.to_snapshot();
        let mut restored = Ram::new(1 << 16).unwrap();
        restored.restore(&bytes).unwrap();
        // Every byte survives — RAM state is exactly its bytes.
        assert_eq!(restored.as_bytes(), r.as_bytes());
    }

    #[test]
    fn sparse_restore_late_refusal_is_atomic_and_valid_zero_runs_replace_old_bytes() {
        let source = patterned(4096);
        let valid = source.to_snapshot();
        let mut destination = Ram::new(4096).unwrap();
        destination.data.fill(0xa7);
        let original = destination.as_bytes().to_vec();
        for suffix in [
            vec![0, 1, 0, 0, 0],
            vec![255, 0, 0, 0, 0],
            vec![1, 3, 0, 0, 0, 9],
        ] {
            let mut invalid = valid.clone();
            invalid.extend_from_slice(&suffix);
            assert!(destination.restore(&invalid).is_err());
            assert_eq!(destination.as_bytes(), original);
        }
        destination.restore(&valid).unwrap();
        assert_eq!(destination.as_bytes(), source.as_bytes());
    }

    #[test]
    fn a_mostly_zero_ram_snapshot_is_far_under_ram_size() {
        // AC #4 at the RAM level: a mostly-idle 1 MiB RAM must serialize to well under 15%.
        let r = patterned(1 << 20);
        let snap = r.to_snapshot();
        let pct = snap.len() * 100 / r.len();
        assert!(pct < 15, "RAM elided to {pct}% (< 15% required)");
        // …and it still round-trips exactly.
        let mut restored = Ram::new(1 << 20).unwrap();
        restored.restore(&snap).unwrap();
        assert_eq!(restored.as_bytes(), r.as_bytes());
    }

    #[test]
    #[cfg_attr(target_arch = "wasm32", ignore = "256 MiB body is host-only")]
    fn a_mostly_zero_256_mib_ram_encodes_under_15_percent_and_restores_byte_identically() {
        // AC #3 verbatim: a mostly-zero 256 MiB RAM model encodes below 15% of raw size and restores
        // byte-identically. In practice a handful of non-zero spans elide to kilobytes, but the test
        // fixes the exact scale the acceptance criterion names rather than extrapolating from 1 MiB.
        const LEN: usize = 256 << 20;
        let r = patterned(LEN);
        let snap = r.to_snapshot();
        let pct = snap.len() * 100 / r.len();
        assert!(pct < 15, "256 MiB RAM elided to {pct}% (< 15% required)");
        let mut restored = Ram::new(LEN).unwrap();
        restored.restore(&snap).unwrap();
        assert_eq!(
            restored.as_bytes(),
            r.as_bytes(),
            "256 MiB RAM restored byte-identically"
        );
    }

    #[test]
    fn restoring_a_wrong_size_snapshot_is_refused_without_mutating() {
        let src = patterned(4096);
        let snap = src.to_snapshot();
        // A RAM of a different size cannot accept this snapshot (decode reconstructs to 8192 ≠ 4096).
        let mut bigger = patterned(8192);
        let before = bigger.as_bytes().to_vec();
        assert_eq!(
            bigger.restore(&snap),
            Err(SnapshotError::BadSparseEncoding),
            "a differently-sized RAM snapshot is rejected"
        );
        assert_eq!(
            bigger.as_bytes(),
            &before[..],
            "rejected restore left RAM untouched"
        );
    }

    #[test]
    fn a_malformed_payload_is_refused_without_mutating() {
        let mut r = patterned(256);
        let before = r.as_bytes().to_vec();
        // A truncated zero-run chunk (kind byte, no length) is malformed.
        assert!(r.restore(&[0u8]).is_err());
        assert!(r.restore(&[1, 0, 0, 0]).is_err()); // data chunk, len word cut short
        assert_eq!(
            r.as_bytes(),
            &before[..],
            "malformed restore left RAM untouched"
        );
    }
}
