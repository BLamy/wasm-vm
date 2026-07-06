//! E3-T02 pass 3: `ChunkedBackend` — a [`BlockBackend`] that serves a disk image out of a lazily
//! populated [`ChunkStore`]. A guest read whose backing chunk is not yet resident returns
//! [`BlockError::WouldBlock`], which the virtio-blk device (pass 2) parks until the wasm fetch layer
//! populates the chunk; then a later boundary re-serves the read from cache.
//!
//! This adapter is deliberately `web-sys`-free so it compiles and unit-tests natively (the house
//! rule: emulator logic that can't be tested natively doesn't belong in this crate). The actual
//! `fetch` lives in [`crate::http_fetch`] behind the wasm32 cfg.
//!
//! Guest writes go through a formal copy-on-write [`OverlayDisk`] (E3-T04): the streamed base is
//! immutable, writes land in a 4 KiB-block write overlay bound to the base by manifest hash, and reads
//! merge overlay-over-base. A read (or a partial-block write's read-modify-write) whose base chunk is
//! not yet resident returns [`BlockError::WouldBlock`], which the device model parks. Durable
//! persistence of the overlay (IndexedDB/OPFS) is a later task; the overlay is in-memory for now.

use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::block::{BlockBackend, BlockError, SECTOR_SIZE, check_range};
use wasm_vm_storage::{
    BlockCache, ImageManifest, MemOverlay, OverlayBackend, OverlayDisk, OverlayOutcome,
};

/// A virtio-blk backend over a chunked image with a copy-on-write overlay. Reads merge the overlay
/// over the base (parking on an absent base chunk); writes land in the overlay (a partial-block write
/// parks if the block's base chunk is not resident, since it must read-modify-write the block).
///
/// Generic over the overlay backend `B`: the default [`MemOverlay`] is the ephemeral in-memory overlay
/// (`newChunkedDisk`); the durable IndexedDB path (`newChunkedDiskPersistent`, E3-T05) builds it over a
/// `WriteBackOverlay` via [`Self::from_disk`].
pub struct ChunkedBackend<B: OverlayBackend = MemOverlay> {
    /// The base chunk cache, shared with the fetch layer which verifies+inserts chunks (E3-T03).
    store: Rc<RefCell<BlockCache>>,
    /// The E3-T04 copy-on-write overlay over the base.
    disk: OverlayDisk<B>,
    capacity_sectors: u64,
    /// E3-T08: the durability barrier held by an in-flight (parked) FLUSH — the exact block set
    /// that FLUSH covers. Held across `flush()` retries so continuous guest writes cannot extend
    /// the wait; dropped once every barrier block has durably committed.
    flush_barrier: Option<Vec<u64>>,
    /// E3-T09/E3-T10: read-only mode. Set at construction when another tab holds the writer
    /// Web Lock (E3-T09); flipped at RUNTIME when the user chooses "continue read-only" after a
    /// storage-quota hit (E3-T10). A shared `Rc<Cell>` so the wasm boundary can flip it live.
    /// Writes are rejected at THIS seam (`BlockError::ReadOnly`) and the device advertises
    /// `VIRTIO_BLK_F_RO` — the guest sees EIO/EROFS instead of a silently-undurable write.
    read_only: Rc<std::cell::Cell<bool>>,
}

impl ChunkedBackend<MemOverlay> {
    /// An ephemeral backend over the base described by `manifest` (in-memory `MemOverlay`), reading
    /// verified chunk bytes from the shared bounded `store`. Capacity is the whole-sector floor of the
    /// image length.
    pub fn new(
        manifest: &ImageManifest,
        store: Rc<RefCell<BlockCache>>,
    ) -> ChunkedBackend<MemOverlay> {
        let overlay = MemOverlay::new(manifest);
        // A fresh overlay is bound to exactly this manifest, so `attach` cannot fail here.
        let disk = OverlayDisk::attach(overlay, manifest)
            .expect("a fresh overlay binds to the manifest it was created from");
        ChunkedBackend::from_disk(disk, store)
    }
}

impl<B: OverlayBackend> ChunkedBackend<B> {
    /// Build over an already-attached [`OverlayDisk`] — the durable path passes an `OverlayDisk` over a
    /// `WriteBackOverlay` (loaded from IndexedDB, sharing a persist queue). Capacity is the whole-sector
    /// floor of the overlay's image length.
    pub fn from_disk(disk: OverlayDisk<B>, store: Rc<RefCell<BlockCache>>) -> ChunkedBackend<B> {
        ChunkedBackend {
            capacity_sectors: disk.len() / SECTOR_SIZE as u64,
            store,
            disk,
            flush_barrier: None,
            read_only: Rc::new(std::cell::Cell::new(false)),
        }
    }

    /// E3-T09: mark this backend read-only (the writer Web Lock is held by another tab). The
    /// overlay's persisted blocks still serve reads; every write is refused at this seam.
    pub fn set_read_only(&mut self) {
        self.read_only.set(true);
    }

    /// E3-T10: the shared read-only flag, so the wasm boundary can flip it at runtime (the
    /// "continue read-only" choice after a storage-quota hit) without a handle to the backend.
    /// (Consumed only by the wasm32 `assemble` path; unused in the native test build.)
    #[allow(dead_code)]
    pub fn read_only_flag(&self) -> Rc<std::cell::Cell<bool>> {
        self.read_only.clone()
    }
}

impl<B: OverlayBackend> BlockBackend for ChunkedBackend<B> {
    fn capacity_sectors(&self) -> u64 {
        self.capacity_sectors
    }

    fn read(&mut self, sector: u64, buf: &mut [u8]) -> Result<(), BlockError> {
        // Validate alignment + range up front (also gives the byte offset). Rejects the same cases
        // MemBackend does, so the device model sees identical error behaviour on bad requests.
        let off = check_range(self.capacity_sectors, sector, buf.len())?;
        // `disk` reads &self; `store` borrows immutably — disjoint fields of `self`.
        match self.disk.read(&*self.store.borrow(), off, buf.len() as u64) {
            Ok(OverlayOutcome::Done(bytes)) => {
                buf.copy_from_slice(&bytes);
                Ok(())
            }
            Ok(OverlayOutcome::NeedChunk(c)) => Err(BlockError::WouldBlock { chunk: c }),
            Err(_) => Err(BlockError::Io),
        }
    }

    fn write(&mut self, sector: u64, buf: &[u8]) -> Result<(), BlockError> {
        // E3-T09: an RO tab must never mutate a disk another tab owns — refused before any
        // range math so no state (overlay, persist queue) is touched.
        if self.read_only.get() {
            return Err(BlockError::ReadOnly);
        }
        let off = check_range(self.capacity_sectors, sector, buf.len())?;
        // `disk.write` is &mut self.disk; the base cache borrows self.store immutably (disjoint fields).
        let cache = self.store.borrow();
        match self.disk.write(&*cache, off, buf) {
            Ok(OverlayOutcome::Done(())) => Ok(()),
            // A partial-block RMW needs a base chunk that isn't resident yet — park (the write mutated
            // nothing, E3-T04 atomicity, so re-execution after the fetch is safe).
            Ok(OverlayOutcome::NeedChunk(c)) => Err(BlockError::WouldBlock { chunk: c }),
            Err(_) => Err(BlockError::Io),
        }
    }

    fn is_read_only(&self) -> bool {
        self.read_only.get()
    }

    fn flush(&mut self) -> Result<(), BlockError> {
        // virtio-blk FLUSH → the overlay durability barrier (E3-T04 commit contract; E3-T08 made
        // it HONEST for async write-back backends). First call under unpersisted data takes a
        // barrier (the exact block set this FLUSH covers) and reports FlushPending — the device
        // parks the request and re-calls flush() each boundary. Retries re-check the SAME held
        // barrier (never re-take it, or continuous guest writes would extend the wait forever);
        // once every barrier block has durably committed (the async store's transaction-complete
        // → mark_persisted), the barrier drops and the FLUSH acks. Synchronous backends
        // (MemOverlay) have no barrier and ack immediately.
        if let Some(b) = &self.flush_barrier {
            if self.disk.barrier_clear(b) {
                self.flush_barrier = None;
            } else {
                return Err(BlockError::FlushPending);
            }
        } else if let Some(b) = self.disk.durability_barrier() {
            self.flush_barrier = Some(b);
            return Err(BlockError::FlushPending);
        }
        self.disk.commit().map_err(|_| BlockError::Io)
    }

    fn flush_reset(&mut self) {
        // E3-T08 (critic BUG 1): the parked FLUSH holding our barrier was discarded (transport
        // reset / device degradation). Drop it so the NEXT flush takes a FRESH barrier covering
        // everything pending at that point — adopting the stale, narrower barrier could ack a
        // new FLUSH while its own coverage is unpersisted.
        self.flush_barrier = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use wasm_vm_storage::{FORMAT_VERSION, ImageManifest, Layout};

    fn sha_hex(bytes: &[u8]) -> String {
        let d = Sha256::digest(bytes);
        d.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// An image of `nsec` sectors with `chunk_size`-byte chunks, plus a shared empty store and a
    /// backend over it. Returns (image bytes, manifest, store, backend).
    fn setup(
        nsec: usize,
        chunk_size: u32,
    ) -> (
        Vec<u8>,
        ImageManifest,
        Rc<RefCell<BlockCache>>,
        ChunkedBackend,
    ) {
        let data: Vec<u8> = (0..nsec * SECTOR_SIZE).map(|i| (i % 251) as u8).collect();
        let chunks: Vec<String> = data.chunks(chunk_size as usize).map(sha_hex).collect();
        let m = ImageManifest {
            version: FORMAT_VERSION,
            image_len: data.len() as u64,
            chunk_size,
            layout: Layout::Split,
            chunks,
        };
        assert_eq!(m.validate(), Ok(()));
        // A generous budget so these correctness tests never see eviction (the cache's own suite
        // covers eviction/pinning). The fetch layer verifies before inserting; here we insert the
        // real slice directly.
        let store = Rc::new(RefCell::new(BlockCache::new(1 << 30)));
        let backend = ChunkedBackend::new(&m, store.clone());
        (data, m, store, backend)
    }

    /// Insert the real bytes of chunk `c` of `data` into the cache (the fetch layer's verify+insert).
    fn give(store: &Rc<RefCell<BlockCache>>, _m: &ImageManifest, data: &[u8], c: usize, cs: usize) {
        let lo = c * cs;
        let hi = (lo + cs).min(data.len());
        store.borrow_mut().insert(c, data[lo..hi].to_vec());
    }

    // 16 sectors = 8192 bytes; 4096-byte chunks so chunk `b` == overlay block `b` (2 of each).
    const NSEC: usize = 16;
    const CS: u32 = 4096;

    #[test]
    fn absent_chunk_parks_then_resident_read_returns_bytes() {
        let (data, m, store, mut be) = setup(NSEC, CS);
        assert_eq!(be.capacity_sectors(), 16);

        // Sector 0 → block/chunk 0 (absent) → WouldBlock{0}. Sector 8 (byte 4096) → chunk 1.
        let mut buf = [0u8; SECTOR_SIZE];
        assert_eq!(
            be.read(0, &mut buf),
            Err(BlockError::WouldBlock { chunk: 0 })
        );
        assert_eq!(
            be.read(8, &mut buf),
            Err(BlockError::WouldBlock { chunk: 1 })
        );

        // Provide chunk 0; sector 0 reads its real bytes, sector 8 still parks.
        give(&store, &m, &data, 0, CS as usize);
        be.read(0, &mut buf).unwrap();
        assert_eq!(&buf[..], &data[0..SECTOR_SIZE]);
        assert_eq!(
            be.read(8, &mut buf),
            Err(BlockError::WouldBlock { chunk: 1 })
        );

        // Provide chunk 1; a full 16-sector read spanning both blocks succeeds.
        give(&store, &m, &data, 1, CS as usize);
        let mut big = [0u8; NSEC * SECTOR_SIZE];
        be.read(0, &mut big).unwrap();
        assert_eq!(&big[..], &data[..]);
    }

    #[test]
    fn a_read_spanning_present_and_absent_chunks_parks_on_the_absent_one() {
        let (data, m, store, mut be) = setup(NSEC, CS);
        give(&store, &m, &data, 0, CS as usize); // chunk 0 present, chunk 1 absent
        let mut big = [0u8; NSEC * SECTOR_SIZE];
        assert_eq!(
            be.read(0, &mut big),
            Err(BlockError::WouldBlock { chunk: 1 }),
            "spanning read parks on the first absent chunk"
        );
    }

    #[test]
    fn partial_block_write_parks_until_its_base_chunk_is_resident() {
        // A CoW write of a partial block must read-modify-write, so it needs the block's base chunk.
        let (data, m, store, mut be) = setup(NSEC, CS);
        let payload = [0xABu8; SECTOR_SIZE];
        // Sector 3 is inside block 0 (partial) — base chunk 0 absent → the WRITE parks.
        assert_eq!(
            be.write(3, &payload),
            Err(BlockError::WouldBlock { chunk: 0 })
        );
        // Provide chunk 0; the write now completes and reads back merged over the base.
        give(&store, &m, &data, 0, CS as usize);
        be.write(3, &payload).unwrap();
        let mut buf = [0u8; SECTOR_SIZE];
        be.read(3, &mut buf).unwrap();
        assert_eq!(&buf[..], &payload[..]);
        // The rest of block 0 still reads the base (write did not clobber the untouched bytes).
        be.read(2, &mut buf).unwrap();
        assert_eq!(&buf[..], &data[2 * SECTOR_SIZE..3 * SECTOR_SIZE]);
    }

    #[test]
    fn overlay_shadows_base_within_a_spanning_read() {
        let (data, m, store, mut be) = setup(NSEC, CS);
        give(&store, &m, &data, 0, CS as usize);
        give(&store, &m, &data, 1, CS as usize);
        // Overwrite just sector 1; a full read returns base for every sector but 1.
        let payload = [0x5Au8; SECTOR_SIZE];
        be.write(1, &payload).unwrap();
        let mut big = [0u8; NSEC * SECTOR_SIZE];
        be.read(0, &mut big).unwrap();
        assert_eq!(&big[0..SECTOR_SIZE], &data[0..SECTOR_SIZE]);
        assert_eq!(&big[SECTOR_SIZE..2 * SECTOR_SIZE], &payload[..]);
        assert_eq!(&big[2 * SECTOR_SIZE..], &data[2 * SECTOR_SIZE..]);
    }

    #[test]
    fn flush_commits_the_overlay() {
        let (data, m, store, mut be) = setup(NSEC, CS);
        give(&store, &m, &data, 0, CS as usize);
        be.write(0, &[0x11u8; SECTOR_SIZE]).unwrap();
        assert_eq!(be.flush(), Ok(())); // commit barrier (in-memory: no-op success)
        // Content survives the commit.
        let mut buf = [0u8; SECTOR_SIZE];
        be.read(0, &mut buf).unwrap();
        assert_eq!(&buf[..], &[0x11u8; SECTOR_SIZE][..]);
    }

    #[test]
    fn bad_requests_are_typed_errors_not_panics() {
        let (_data, _m, _store, mut be) = setup(NSEC, CS);
        // Unaligned buffer length.
        let mut odd = [0u8; SECTOR_SIZE + 1];
        assert_eq!(be.read(0, &mut odd), Err(BlockError::Unaligned));
        // Past capacity.
        let mut buf = [0u8; SECTOR_SIZE];
        assert_eq!(be.read(16, &mut buf), Err(BlockError::OutOfRange));
        assert_eq!(be.write(16, &buf), Err(BlockError::OutOfRange));
    }
}

#[cfg(test)]
mod flush_tests {
    use super::tests_support::*;
    use super::*;

    /// E3-T08: the full FLUSH-barrier glue over a WriteBackOverlay — FlushPending until the
    /// simulated async store drains the queue, then Ok; a post-barrier write does NOT extend the
    /// held barrier; MemOverlay (ephemeral) flush stays synchronous-Ok.
    #[test]
    fn flush_barrier_over_writeback_overlay() {
        let (m, store) = tiny_manifest_store();
        let queue = std::rc::Rc::new(RefCell::new(wasm_vm_storage::PersistQueue::new()));
        let overlay = wasm_vm_storage::WriteBackOverlay::with_shared_queue(
            &m,
            queue.clone(),
            std::collections::BTreeMap::new(),
        );
        let disk = wasm_vm_storage::OverlayDisk::attach(overlay, &m).unwrap();
        let mut be = ChunkedBackend::from_disk(disk, store.clone());

        // Nothing written yet → flush is immediately durable.
        assert_eq!(be.flush(), Ok(()));

        // A whole-sector write (block-aligned so no base RMW needed) → data pending durability.
        let buf = [0xCDu8; SECTOR_SIZE]; // 512
        assert_eq!(be.write(0, &buf), Ok(()));
        assert_eq!(be.flush(), Err(BlockError::FlushPending), "barrier taken");
        // Retries keep reporting pending, and do NOT re-take the barrier.
        assert_eq!(be.flush(), Err(BlockError::FlushPending));

        // A post-barrier write to a DIFFERENT region must not extend the held barrier.
        assert_eq!(be.write(16, &buf), Ok(())); // sector 16 = a different 4KiB overlay block

        // The async store drains ONLY the first snapshot... but pending_flush() now holds both
        // blocks. Drain everything pending at snapshot time — the barrier only tracks its own
        // block set, so full-drain also proves the simpler path.
        let snap = queue.borrow().pending_flush();
        // Simulate persisting ONLY the barrier block (the first write's overlay block 0):
        let only_first: Vec<(u64, u64)> = snap
            .iter()
            .filter(|(b, _, _)| *b == 0)
            .map(|(b, g, _)| (*b, *g))
            .collect();
        queue.borrow_mut().mark_persisted(&only_first);
        assert_eq!(
            be.flush(),
            Ok(()),
            "barrier satisfied though the post-barrier write is still pending"
        );
        assert_eq!(
            queue.borrow().unpersisted_count(),
            1,
            "newer write still queued"
        );

        // A NEW flush now covers the newer write.
        assert_eq!(be.flush(), Err(BlockError::FlushPending));
        let snap2 = queue.borrow().pending_flush();
        let p2: Vec<(u64, u64)> = snap2.iter().map(|(b, g, _)| (*b, *g)).collect();
        queue.borrow_mut().mark_persisted(&p2);
        assert_eq!(be.flush(), Ok(()));
    }
}

#[cfg(test)]
mod tests_support {
    //! Shared fixtures for the flush tests (mirrors `tests::setup` for a tiny image with the
    //! whole base resident, so writes never park on chunks).
    use super::*;
    use sha2::{Digest, Sha256};
    use wasm_vm_storage::{FORMAT_VERSION, ImageManifest, Layout};

    pub fn tiny_manifest_store() -> (ImageManifest, Rc<RefCell<BlockCache>>) {
        let data: Vec<u8> = vec![0u8; 16 * 4096]; // 16 overlay blocks
        let chunks: Vec<String> = data
            .chunks(4096)
            .map(|c| {
                let d = Sha256::digest(c);
                d.iter().map(|b| format!("{b:02x}")).collect()
            })
            .collect();
        let m = ImageManifest {
            version: FORMAT_VERSION,
            image_len: data.len() as u64,
            chunk_size: 4096,
            layout: Layout::Split,
            chunks,
        };
        assert_eq!(m.validate(), Ok(()));
        let store = Rc::new(RefCell::new(BlockCache::new(1 << 30)));
        for (i, c) in data.chunks(4096).enumerate() {
            store.borrow_mut().insert(i, c.to_vec());
        }
        (m, store)
    }
}

#[cfg(test)]
mod ro_tests {
    use super::tests_support::*;
    use super::*;

    /// E3-T09: an RO backend serves reads (incl. previously persisted overlay blocks) but
    /// refuses every write at the seam with a typed ReadOnly — no overlay/queue mutation —
    /// and reports is_read_only so the device advertises VIRTIO_BLK_F_RO.
    #[test]
    fn read_only_backend_serves_reads_refuses_writes() {
        let (m, store) = tiny_manifest_store();
        let queue = std::rc::Rc::new(RefCell::new(wasm_vm_storage::PersistQueue::new()));
        // A pre-existing dirty block, as if loaded from another tab's persisted overlay.
        let mut loaded = std::collections::BTreeMap::new();
        loaded.insert(0u64, [0xAAu8; wasm_vm_storage::OVERLAY_BLOCK]);
        let overlay =
            wasm_vm_storage::WriteBackOverlay::with_shared_queue(&m, queue.clone(), loaded);
        let disk = wasm_vm_storage::OverlayDisk::attach(overlay, &m).unwrap();
        let mut be = ChunkedBackend::from_disk(disk, store);
        be.set_read_only();

        assert!(be.is_read_only(), "device will advertise VIRTIO_BLK_F_RO");
        // Reads work — including the other tab's flushed data (overlay block 0).
        let mut buf = [0u8; SECTOR_SIZE];
        be.read(0, &mut buf).unwrap();
        assert_eq!(
            buf, [0xAA; SECTOR_SIZE],
            "persisted overlay data readable in RO"
        );
        // Writes are refused with the typed error, and nothing reaches the persist queue.
        let w = [0x55u8; SECTOR_SIZE];
        assert_eq!(be.write(0, &w), Err(BlockError::ReadOnly));
        assert_eq!(queue.borrow().unpersisted_count(), 0, "no queue mutation");
        // The data is untouched.
        be.read(0, &mut buf).unwrap();
        assert_eq!(buf, [0xAA; SECTOR_SIZE]);
        // Flush on an RO backend is trivially durable (nothing pending).
        assert_eq!(be.flush(), Ok(()));
    }

    /// CRITIC HOSTILE (E3-T09): the RO check must fire BEFORE range validation, so even an
    /// out-of-range / misaligned write on an RO backend reports ReadOnly — proving the check is
    /// truly first and no range math or state is reachable. Also: repeated writes after repeated
    /// reads never leak anything into the persist queue (reads share no path with record()).
    #[test]
    fn ro_check_precedes_range_validation_and_reads_never_dirty_queue() {
        let (m, store) = tiny_manifest_store();
        let queue = std::rc::Rc::new(RefCell::new(wasm_vm_storage::PersistQueue::new()));
        let overlay = wasm_vm_storage::WriteBackOverlay::with_shared_queue(
            &m,
            queue.clone(),
            std::collections::BTreeMap::new(),
        );
        let disk = wasm_vm_storage::OverlayDisk::attach(overlay, &m).unwrap();
        let mut be = ChunkedBackend::from_disk(disk, store);
        be.set_read_only();
        // Way out of range — on a WRITABLE backend this is OutOfRange; RO must win first.
        let w = [0u8; SECTOR_SIZE];
        assert_eq!(be.write(u64::MAX, &w), Err(BlockError::ReadOnly));
        // Misaligned length — same.
        assert_eq!(be.write(0, &[0u8; 100]), Err(BlockError::ReadOnly));
        // Reads across the disk never touch the queue.
        let mut buf = [0u8; SECTOR_SIZE];
        for s in 0..(m.image_len / SECTOR_SIZE as u64) {
            be.read(s, &mut buf).unwrap();
        }
        assert_eq!(queue.borrow().unpersisted_count(), 0);
        assert!(
            queue.borrow().is_empty(),
            "reads must never dirty the queue"
        );
    }

    /// CRITIC HOSTILE (E3-T09): documents WHY the "RO backend has an empty queue" invariant is
    /// load-bearing. If pending entries COULD exist in an RO backend (they cannot via the wasm
    /// construction path: the queue is created fresh and every write is refused), flush() would
    /// take a durability barrier and return FlushPending forever — no persist pump exists in an
    /// RO tab to drain it, so the guest's sync would hang. This test pins that behaviour so any
    /// future path that lets an RO backend see a dirty queue fails loudly here.
    #[test]
    fn ro_backend_with_forged_dirty_queue_would_park_flush_forever() {
        let (m, store) = tiny_manifest_store();
        let queue = std::rc::Rc::new(RefCell::new(wasm_vm_storage::PersistQueue::new()));
        // Forge a pending entry BEFORE set_read_only (no wasm-layer path does this for an RO
        // boot; note PersistQueue::record itself is private — write_block is the only door).
        let mut overlay = wasm_vm_storage::WriteBackOverlay::with_shared_queue(
            &m,
            queue.clone(),
            std::collections::BTreeMap::new(),
        );
        use wasm_vm_storage::OverlayBackend as _;
        overlay.write_block(0, [0x11u8; wasm_vm_storage::OVERLAY_BLOCK]);
        let disk = wasm_vm_storage::OverlayDisk::attach(overlay, &m).unwrap();
        let mut be = ChunkedBackend::from_disk(disk, store);
        be.set_read_only();
        // FlushPending forever: no pump exists in an RO tab, nothing will mark_persisted.
        assert_eq!(be.flush(), Err(BlockError::FlushPending));
        assert_eq!(be.flush(), Err(BlockError::FlushPending));
        // The invariant that protects the guest: the wasm layer builds RO backends over a FRESH
        // queue and refuses every write, so this state is unreachable there (see lib.rs).
        assert_eq!(be.write(0, &[0u8; SECTOR_SIZE]), Err(BlockError::ReadOnly));
        assert_eq!(
            queue.borrow().unpersisted_count(),
            1,
            "still only the forged entry"
        );
    }
}

#[cfg(test)]
mod reset_scope_tests {
    use super::tests_support::*;
    use wasm_vm_storage::{ImageManifest, overlay_store_name};

    /// E3-T10 reset scoping: the overlay DB name is derived from the image's base hash, so two
    /// different images map to DIFFERENT databases — deleting one cannot touch the other. This is
    /// the naming-layer proof behind "reset wipes only the current image's overlay".
    #[test]
    fn overlay_db_name_is_per_image_and_stable() {
        let (m1, _s1) = tiny_manifest_store();
        let n1a = overlay_store_name(&m1.base_hash());
        let n1b = overlay_store_name(&m1.base_hash());
        assert_eq!(n1a, n1b, "same image → stable DB name");
        assert!(n1a.starts_with("wvov-"), "namespaced: {n1a}");

        // A second, different image (different chunk contents → different base hash).
        let data2 = std::vec![0x33u8; 16 * 4096];
        let chunks2: std::vec::Vec<String> = data2
            .chunks(4096)
            .map(|c| {
                use sha2::{Digest, Sha256};
                Sha256::digest(c)
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect()
            })
            .collect();
        let m2 = ImageManifest {
            version: wasm_vm_storage::FORMAT_VERSION,
            image_len: data2.len() as u64,
            chunk_size: 4096,
            layout: wasm_vm_storage::Layout::Split,
            chunks: chunks2,
        };
        assert_ne!(
            n1a,
            overlay_store_name(&m2.base_hash()),
            "different image → different DB name (reset cannot cross images)"
        );
    }
}
