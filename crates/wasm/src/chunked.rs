//! E3-T02 pass 3: `ChunkedBackend` — a [`BlockBackend`] that serves a disk image out of a lazily
//! populated [`ChunkStore`]. A guest read whose backing chunk is not yet resident returns
//! [`BlockError::WouldBlock`], which the virtio-blk device (pass 2) parks until the wasm fetch layer
//! populates the chunk; then a later boundary re-serves the read from cache.
//!
//! This adapter is deliberately `web-sys`-free so it compiles and unit-tests natively (the house
//! rule: emulator logic that can't be tested natively doesn't belong in this crate). The actual
//! `fetch` lives in [`crate::http_fetch`] behind the wasm32 cfg.
//!
//! Guest writes go to an in-memory sector overlay so an `rw`-mounted rootfs can boot; the overlay is
//! consulted ahead of the chunk store on read. This is a per-session write cache, NOT persistence —
//! durable copy-on-write to IndexedDB/OPFS is E3-T04.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use wasm_vm_core::block::{BlockBackend, BlockError, SECTOR_SIZE, check_range};
use wasm_vm_storage::{ChunkIndex, ChunkStore, ReadOutcome};

/// A virtio-blk backend over a chunked image. Reads assemble from `store` (parking on an absent
/// chunk); writes land in `overlay` and shadow the chunk data for the rest of the session.
pub struct ChunkedBackend {
    /// Shared with the fetch layer, which populates verified chunks into it (verify-on-insert).
    store: Rc<RefCell<ChunkStore>>,
    index: ChunkIndex,
    capacity_sectors: u64,
    /// Guest-written sectors (sector index → 512 bytes). In-memory only (E3-T04 makes it durable).
    overlay: BTreeMap<u64, [u8; SECTOR_SIZE]>,
}

impl ChunkedBackend {
    /// A backend over `index`, reading verified chunk bytes from the shared `store`. Capacity is the
    /// whole-sector floor of the image length (a trailing partial sector, if any, is not addressable).
    pub fn new(index: ChunkIndex, store: Rc<RefCell<ChunkStore>>) -> ChunkedBackend {
        ChunkedBackend {
            store,
            index,
            capacity_sectors: index.image_len() / SECTOR_SIZE as u64,
            overlay: BTreeMap::new(),
        }
    }
}

impl BlockBackend for ChunkedBackend {
    fn capacity_sectors(&self) -> u64 {
        self.capacity_sectors
    }

    fn read(&mut self, sector: u64, buf: &mut [u8]) -> Result<(), BlockError> {
        // Validate alignment + range up front (also gives the byte offset). Rejects the same cases
        // MemBackend does, so the device model sees identical error behaviour on bad requests.
        let off = check_range(self.capacity_sectors, sector, buf.len())?;
        let nsec = buf.len() / SECTOR_SIZE;

        // Fast path: every requested sector has been written — serve purely from the overlay, so a
        // sector the guest wrote is readable even if its underlying chunk was never fetched.
        let all_overlaid = (0..nsec as u64).all(|i| self.overlay.contains_key(&(sector + i)));
        if all_overlaid {
            for i in 0..nsec as u64 {
                let s = &self.overlay[&(sector + i)];
                let d = (i as usize) * SECTOR_SIZE;
                buf[d..d + SECTOR_SIZE].copy_from_slice(s);
            }
            return Ok(());
        }

        // Otherwise assemble from the chunk store (parking if any needed chunk is absent), then lay
        // any written sectors on top so a partial write within the span still wins.
        match self
            .index
            .read(&*self.store.borrow(), off, buf.len() as u64)
        {
            Ok(ReadOutcome::Ready(bytes)) => {
                // `index.read` returns exactly `len` bytes for an in-range read (bound-checked above).
                buf.copy_from_slice(&bytes);
                for i in 0..nsec as u64 {
                    if let Some(s) = self.overlay.get(&(sector + i)) {
                        let d = (i as usize) * SECTOR_SIZE;
                        buf[d..d + SECTOR_SIZE].copy_from_slice(s);
                    }
                }
                Ok(())
            }
            Ok(ReadOutcome::NeedChunk(c)) => Err(BlockError::WouldBlock { chunk: c }),
            // A wrong-length chunk handed back by the store, or an out-of-range assembly — the guest
            // sees an I/O error, never a panic.
            Err(_) => Err(BlockError::Io),
        }
    }

    fn write(&mut self, sector: u64, buf: &[u8]) -> Result<(), BlockError> {
        // Same alignment/range validation as read; writes are captured in the overlay.
        check_range(self.capacity_sectors, sector, buf.len())?;
        let nsec = buf.len() / SECTOR_SIZE;
        for i in 0..nsec as u64 {
            let mut s = [0u8; SECTOR_SIZE];
            let src = (i as usize) * SECTOR_SIZE;
            s.copy_from_slice(&buf[src..src + SECTOR_SIZE]);
            self.overlay.insert(sector + i, s);
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<(), BlockError> {
        Ok(()) // The overlay is already in memory; nothing to push. Durability is E3-T04.
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
        Rc<RefCell<ChunkStore>>,
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
        let store = Rc::new(RefCell::new(ChunkStore::new()));
        let backend = ChunkedBackend::new(m.index(), store.clone());
        (data, m, store, backend)
    }

    /// Provide chunk `c` of `data` into `store` (verified).
    fn give(store: &Rc<RefCell<ChunkStore>>, m: &ImageManifest, data: &[u8], c: usize, cs: usize) {
        let lo = c * cs;
        let hi = (lo + cs).min(data.len());
        store
            .borrow_mut()
            .provide(m, c, data[lo..hi].to_vec())
            .unwrap();
    }

    #[test]
    fn absent_chunk_parks_then_resident_read_returns_bytes() {
        // 4 sectors, 1024-byte chunks → 2 chunks of 2 sectors each.
        let (data, m, store, mut be) = setup(4, 1024);
        assert_eq!(be.capacity_sectors(), 4);

        // Sector 0 lives in chunk 0 (absent) → WouldBlock{0}.
        let mut buf = [0u8; SECTOR_SIZE];
        assert_eq!(
            be.read(0, &mut buf),
            Err(BlockError::WouldBlock { chunk: 0 })
        );
        // Sector 2 lives in chunk 1 (absent) → WouldBlock{1}.
        assert_eq!(
            be.read(2, &mut buf),
            Err(BlockError::WouldBlock { chunk: 1 })
        );

        // Provide chunk 0; sector 0 now reads its real bytes, sector 2 still parks.
        give(&store, &m, &data, 0, 1024);
        be.read(0, &mut buf).unwrap();
        assert_eq!(&buf[..], &data[0..SECTOR_SIZE]);
        assert_eq!(
            be.read(2, &mut buf),
            Err(BlockError::WouldBlock { chunk: 1 })
        );

        // Provide chunk 1; a multi-sector read spanning both chunks now succeeds.
        give(&store, &m, &data, 1, 1024);
        let mut big = [0u8; 4 * SECTOR_SIZE];
        be.read(0, &mut big).unwrap();
        assert_eq!(&big[..], &data[..]);
    }

    #[test]
    fn a_read_spanning_present_and_absent_chunks_parks_on_the_absent_one() {
        let (data, m, store, mut be) = setup(4, 1024);
        give(&store, &m, &data, 0, 1024); // chunk 0 present, chunk 1 absent
        let mut big = [0u8; 4 * SECTOR_SIZE];
        assert_eq!(
            be.read(0, &mut big),
            Err(BlockError::WouldBlock { chunk: 1 }),
            "spanning read parks on the first absent chunk"
        );
    }

    #[test]
    fn written_sector_reads_back_without_fetching_its_chunk() {
        let (_data, _m, _store, mut be) = setup(4, 1024);
        // Write sector 3 (in chunk 1, which is NOT resident) then read it back: the overlay fast
        // path serves it with no chunk fetch — proving a written sector never parks.
        let payload = [0xABu8; SECTOR_SIZE];
        be.write(3, &payload).unwrap();
        let mut buf = [0u8; SECTOR_SIZE];
        be.read(3, &mut buf).unwrap();
        assert_eq!(&buf[..], &payload[..]);
    }

    #[test]
    fn overlay_shadows_chunk_data_within_a_spanning_read() {
        let (data, m, store, mut be) = setup(4, 1024);
        give(&store, &m, &data, 0, 1024);
        give(&store, &m, &data, 1, 1024);
        // Overwrite just sector 1; a 4-sector read returns chunk data for 0,2,3 and the write for 1.
        let payload = [0x5Au8; SECTOR_SIZE];
        be.write(1, &payload).unwrap();
        let mut big = [0u8; 4 * SECTOR_SIZE];
        be.read(0, &mut big).unwrap();
        assert_eq!(&big[0..SECTOR_SIZE], &data[0..SECTOR_SIZE]);
        assert_eq!(&big[SECTOR_SIZE..2 * SECTOR_SIZE], &payload[..]);
        assert_eq!(&big[2 * SECTOR_SIZE..], &data[2 * SECTOR_SIZE..]);
    }

    #[test]
    fn bad_requests_are_typed_errors_not_panics() {
        let (_data, _m, _store, mut be) = setup(4, 1024);
        // Unaligned buffer length.
        let mut odd = [0u8; SECTOR_SIZE + 1];
        assert_eq!(be.read(0, &mut odd), Err(BlockError::Unaligned));
        // Past capacity.
        let mut buf = [0u8; SECTOR_SIZE];
        assert_eq!(be.read(4, &mut buf), Err(BlockError::OutOfRange));
        assert_eq!(be.write(4, &buf), Err(BlockError::OutOfRange));
    }
}
