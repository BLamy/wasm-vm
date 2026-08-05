//! Block storage backends (E2-T10): the seam between virtio-blk (E2-T11) and storage.
//!
//! The trait is object-safe (`Box<dyn BlockBackend>`), sector-addressed (512-byte units,
//! virtio-blk's fixed unit), and every implementation rejects unaligned lengths and
//! out-of-range access with a [`BlockError`] the device maps to `VIRTIO_BLK_S_IOERR` —
//! never a panic.
//!
//! **The wasm32 trap (the reason this file is paranoid):** `usize` is 32-bit on wasm — ALL
//! sector/byte arithmetic here is `u64` with `checked_mul`/`checked_add`, converted to
//! `usize` only AFTER the bound against the actual storage length is proven. A > 4 GiB
//! image must fail cleanly, not wrap into range ([`SparseMemBackend`] exists precisely to
//! prove 5 GiB capacities on wasm32).
//!
//! Implementations: [`MemBackend`] (browser path — ONE copy out of the fetched
//! ArrayBuffer, made by the caller when constructing the `Vec`; no second copy inside),
//! [`SparseMemBackend`] (huge synthetic capacities, BTreeMap-backed — deterministic, no
//! HashMap), and the native mmap `FileBackend` in `wasm-vm-cli` (E2-T10's third leg).
//! Epic 3's IndexedDB/OPFS copy-on-write overlay plugs in at this same trait.

use alloc::boxed::Box;
use alloc::collections::BTreeMap;
use alloc::vec::Vec;

/// virtio-blk's fixed sector size.
pub const SECTOR_SIZE: usize = 512;

/// Why a block operation failed (the device turns these into `VIRTIO_BLK_S_IOERR`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockError {
    /// `[sector, sector + len/512)` reaches past the capacity (or the math would wrap).
    OutOfRange,
    /// Buffer length is not a multiple of 512.
    Unaligned,
    /// Write/flush on a read-only backend.
    ReadOnly,
    /// Host I/O failure (native file backends).
    Io,
    /// E3-T02: the data for this read is not resident yet — chunk `chunk` must be fetched first.
    /// A lazy/streaming backend returns this instead of blocking; the virtio-blk service PARKS the
    /// request and completes it on a later boundary once the chunk arrives. Synchronous backends
    /// (MemBackend, the native file backend) never return it, so the deferred path stays dead there.
    WouldBlock { chunk: usize },
    /// E3-T08: a FLUSH was accepted but the write-back data it covers has not durably committed
    /// yet (an async store's transaction is still in flight). The virtio-blk service PARKS the
    /// FLUSH request and retries it each boundary; it completes — and only then advances the used
    /// ring — once the backend reports the durability barrier clear. Synchronous backends never
    /// return it (their `flush` IS the barrier).
    FlushPending,
    /// E3-T10: a WRITE has been applied to the synchronous in-memory view, but its durable async
    /// transaction has not committed yet. The virtio-blk service parks the descriptor chain and
    /// must not publish it to the used ring until retry returns `Ok`, or `ReadOnly`/`Io` after a
    /// quota decision. Synchronous and ordinary write-back backends never return this variant.
    WritePending,
}

/// Object-safe storage backend, sector-addressed in 512-byte units.
pub trait BlockBackend {
    fn capacity_sectors(&self) -> u64;
    fn read(&mut self, sector: u64, buf: &mut [u8]) -> Result<(), BlockError>;
    fn write(&mut self, sector: u64, buf: &[u8]) -> Result<(), BlockError>;
    fn flush(&mut self) -> Result<(), BlockError>;
    /// E3-T08: every parked FLUSH request has been DISCARDED (transport reset, or the device
    /// degraded and dropped its in-flight chains) — abandon any held durability barrier, so the
    /// next FLUSH takes a FRESH barrier covering everything pending at that point. Without this,
    /// a write-back backend's barrier from a dead FLUSH goes stale and the next FLUSH can adopt
    /// it and ack while its own coverage is unpersisted (critic BUG 1: the early-ack lie).
    /// Default no-op: synchronous backends hold no barrier.
    fn flush_reset(&mut self) {}
    /// E3-T10: every parked durable-WRITE request has been discarded (transport reset or device
    /// degradation). Drop backend retry identity so a new descriptor chain cannot accidentally
    /// complete the abandoned request. Default no-op: synchronous backends never park writes.
    fn write_reset(&mut self) {}
    fn is_read_only(&self) -> bool {
        false
    }
}

/// Shared validation: buffer must be sector-aligned and `[sector, sector+n)` in capacity.
/// Returns the BYTE offset as u64 — the caller converts to `usize` only after its own
/// storage-length bound. All math checked; a wrap is `OutOfRange`, never silent.
/// (Quirk, critic-noted: for absurd capacities where `capacity * 512` itself exceeds u64 —
/// over 16 EiB — sectors ≥ 2^55 reject as `OutOfRange` via the checked multiply rather than
/// wrapping. A clean rejection of an unreachable tail, never a wrap or panic.)
pub fn check_range(capacity_sectors: u64, sector: u64, buf_len: usize) -> Result<u64, BlockError> {
    if !buf_len.is_multiple_of(SECTOR_SIZE) {
        return Err(BlockError::Unaligned);
    }
    let nsectors = (buf_len / SECTOR_SIZE) as u64;
    let end = sector.checked_add(nsectors).ok_or(BlockError::OutOfRange)?;
    if end > capacity_sectors {
        return Err(BlockError::OutOfRange);
    }
    sector
        .checked_mul(SECTOR_SIZE as u64)
        .ok_or(BlockError::OutOfRange)
}

/// In-memory image — the browser path: the rootfs ArrayBuffer is copied ONCE into the
/// `Vec` this wraps (by the wasm boundary constructing it); no further copy happens here.
pub struct MemBackend {
    data: Vec<u8>,
    read_only: bool,
}

impl MemBackend {
    /// Wrap `data` (truncated to whole sectors) as a read-write image.
    pub fn new(mut data: Vec<u8>) -> Self {
        data.truncate(data.len() - data.len() % SECTOR_SIZE);
        Self {
            data,
            read_only: false,
        }
    }

    pub fn new_read_only(data: Vec<u8>) -> Self {
        let mut b = Self::new(data);
        b.read_only = true;
        b
    }

    /// Borrow the raw image (test hashing / snapshotting).
    pub fn data(&self) -> &[u8] {
        &self.data
    }
}

impl BlockBackend for MemBackend {
    fn capacity_sectors(&self) -> u64 {
        (self.data.len() / SECTOR_SIZE) as u64
    }
    fn read(&mut self, sector: u64, buf: &mut [u8]) -> Result<(), BlockError> {
        let off = check_range(self.capacity_sectors(), sector, buf.len())?;
        // Bound proven above: off + len <= data.len() (a usize) — cast is safe.
        let off = off as usize;
        buf.copy_from_slice(&self.data[off..off + buf.len()]);
        Ok(())
    }
    fn write(&mut self, sector: u64, buf: &[u8]) -> Result<(), BlockError> {
        if self.read_only {
            return Err(BlockError::ReadOnly);
        }
        let off = check_range(self.capacity_sectors(), sector, buf.len())?;
        let off = off as usize;
        self.data[off..off + buf.len()].copy_from_slice(buf);
        Ok(())
    }
    fn flush(&mut self) -> Result<(), BlockError> {
        if self.read_only {
            return Err(BlockError::ReadOnly);
        }
        Ok(()) // memory is always "persistent" for the browser session
    }
    fn is_read_only(&self) -> bool {
        self.read_only
    }
}

/// Sparse image with an arbitrary u64 capacity — unwritten sectors read zero. Exists to
/// PROVE the no-usize-truncation property on wasm32 (5 GiB capacities on a 32-bit usize)
/// and as the shape Epic 3's lazy-fetch overlay will take.
pub struct SparseMemBackend {
    capacity: u64,
    sectors: BTreeMap<u64, Box<[u8; SECTOR_SIZE]>>,
    read_only: bool,
}

impl SparseMemBackend {
    pub fn new(capacity_sectors: u64) -> Self {
        Self {
            capacity: capacity_sectors,
            sectors: BTreeMap::new(),
            read_only: false,
        }
    }
    /// Number of sectors actually materialized (footprint check).
    pub fn resident_sectors(&self) -> usize {
        self.sectors.len()
    }
}

impl BlockBackend for SparseMemBackend {
    fn capacity_sectors(&self) -> u64 {
        self.capacity
    }
    fn read(&mut self, sector: u64, buf: &mut [u8]) -> Result<(), BlockError> {
        check_range(self.capacity, sector, buf.len())?;
        for (i, chunk) in buf.chunks_mut(SECTOR_SIZE).enumerate() {
            match self.sectors.get(&(sector + i as u64)) {
                Some(s) => chunk.copy_from_slice(&s[..]),
                None => chunk.fill(0),
            }
        }
        Ok(())
    }
    fn write(&mut self, sector: u64, buf: &[u8]) -> Result<(), BlockError> {
        if self.read_only {
            return Err(BlockError::ReadOnly);
        }
        check_range(self.capacity, sector, buf.len())?;
        for (i, chunk) in buf.chunks(SECTOR_SIZE).enumerate() {
            let mut boxed = Box::new([0u8; SECTOR_SIZE]);
            boxed.copy_from_slice(chunk);
            self.sectors.insert(sector + i as u64, boxed);
        }
        Ok(())
    }
    fn flush(&mut self) -> Result<(), BlockError> {
        Ok(())
    }
    fn is_read_only(&self) -> bool {
        self.read_only
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    /// Property test: random (sector, len) read/write round-trips vs a Vec reference
    /// model — boundary sectors and out-of-range rejections included.
    #[test]
    fn mem_backend_matches_reference_model() {
        const CAP: usize = 64; // sectors
        let mut b = MemBackend::new(vec![0u8; CAP * SECTOR_SIZE]);
        let mut model = vec![0u8; CAP * SECTOR_SIZE];
        let mut x = 0xFEED_FACE_CAFE_BEEFu64;
        let mut next = move || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x
        };
        for _ in 0..5_000 {
            let sector = next() % (CAP as u64 + 4); // sometimes out of range
            let nsec = 1 + (next() % 4) as usize;
            let mut buf = vec![0u8; nsec * SECTOR_SIZE];
            if next() % 2 == 0 {
                for byte in buf.iter_mut() {
                    *byte = next() as u8;
                }
                let ours = b.write(sector, &buf);
                if sector + nsec as u64 <= CAP as u64 {
                    ours.unwrap();
                    let off = sector as usize * SECTOR_SIZE;
                    model[off..off + buf.len()].copy_from_slice(&buf);
                } else {
                    assert_eq!(ours, Err(BlockError::OutOfRange));
                }
            } else {
                let ours = b.read(sector, &mut buf);
                if sector + nsec as u64 <= CAP as u64 {
                    ours.unwrap();
                    let off = sector as usize * SECTOR_SIZE;
                    assert_eq!(&buf[..], &model[off..off + buf.len()], "read matches model");
                } else {
                    assert_eq!(ours, Err(BlockError::OutOfRange));
                }
            }
        }
        assert_eq!(b.data(), &model[..], "final images identical");
    }

    /// Boundary + error matrix: capacity-1 succeeds, capacity fails, unaligned fails,
    /// u64::MAX-ish sectors fail cleanly (overflow attack), RO enforced.
    #[test]
    fn boundaries_and_errors() {
        let mut b = MemBackend::new(vec![0u8; 8 * SECTOR_SIZE]);
        let mut sec = [0u8; SECTOR_SIZE];
        b.read(7, &mut sec).unwrap(); // capacity-1
        assert_eq!(b.read(8, &mut sec), Err(BlockError::OutOfRange));
        assert_eq!(b.read(0, &mut [0u8; 100]), Err(BlockError::Unaligned));
        // Overflow attack: sector near u64::MAX must not wrap into range.
        assert_eq!(b.read(u64::MAX - 1, &mut sec), Err(BlockError::OutOfRange));
        assert_eq!(b.write(u64::MAX / 512, &sec), Err(BlockError::OutOfRange));
        // RO backend: writes and flushes rejected, reads fine.
        let mut ro = MemBackend::new_read_only(vec![0xAB; 4 * SECTOR_SIZE]);
        assert!(ro.is_read_only());
        assert_eq!(ro.write(0, &sec), Err(BlockError::ReadOnly));
        assert_eq!(ro.flush(), Err(BlockError::ReadOnly));
        ro.read(3, &mut sec).unwrap();
        assert_eq!(sec[0], 0xAB);
    }

    /// The wasm32-truncation proof shape: a 5 GiB capacity addressed sparsely. On a
    /// 32-bit usize, any unchecked cast in the offset math would wrap into range — the
    /// high-sector write/read round-trip catches it. (Runs on native too; the wasm mirror
    /// runs the same shape on an actual 32-bit usize.)
    #[test]
    fn five_gib_sparse_no_truncation() {
        const CAP: u64 = 10 * 1024 * 1024; // 10M sectors = 5 GiB
        let mut b = SparseMemBackend::new(CAP);
        let mut sec = [0u8; SECTOR_SIZE];
        // Highest valid sector: byte offset ~5 GiB, > u32::MAX.
        sec[0] = 0x5A;
        b.write(CAP - 1, &sec).unwrap();
        // A truncating impl would alias this low sector; it must read ZERO.
        let alias = ((CAP - 1) * SECTOR_SIZE as u64) & 0xFFFF_FFFF; // u32-wrapped offset
        let alias_sector = alias / SECTOR_SIZE as u64;
        let mut low = [0xFFu8; SECTOR_SIZE];
        b.read(alias_sector, &mut low).unwrap();
        assert_eq!(low[0], 0, "no aliasing through 32-bit truncation");
        let mut back = [0u8; SECTOR_SIZE];
        b.read(CAP - 1, &mut back).unwrap();
        assert_eq!(back[0], 0x5A, "high sector round-trips");
        assert_eq!(b.read(CAP, &mut back), Err(BlockError::OutOfRange));
        assert_eq!(
            b.resident_sectors(),
            1,
            "sparse: only one sector materialized"
        );
    }
}
