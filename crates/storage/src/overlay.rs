//! E3-T04: copy-on-write block overlay. The streamed base image (E3-T01 chunks) is IMMUTABLE; every
//! guest write lands in a local write layer at 4 KiB granularity. Reads merge overlay-over-base per
//! block. See `docs/design/cow-overlay.md` for the format, the granularity rationale, the base-binding
//! rule, and the commit contract.
//!
//! Layering: [`OverlayBackend`] is the write-layer persistence trait (in-memory now via [`MemOverlay`];
//! IndexedDB/OPFS later implement the same trait). [`OverlayDisk`] composes an overlay backend with a
//! base [`ChunkSource`] + [`ChunkIndex`] and does the merge. This is distinct from the core crate's
//! device-facing `BlockBackend` (512-byte sectors, read/write/flush) — the wasm layer adapts one to
//! the other.

use crate::{ChunkIndex, ChunkSource, ImageManifest, ReadOutcome};
use alloc::collections::BTreeMap;
use alloc::vec::Vec;

/// Overlay write-block size. 4 KiB (the guest's typical page/sector-cluster) keeps small writes cheap
/// — a 4 KiB write dirties one block — whereas dirtying at the 128 KiB fetch-chunk granularity would
/// force a read-modify-write of a whole chunk per small write. The cost is more index entries; a
/// BTreeMap keyed by block index keeps that sparse and ordered (deterministic, no_std, no HashMap).
pub const OVERLAY_BLOCK: usize = 4096;

/// The overlay on-storage format version (see `docs/design/cow-overlay.md`). Bumped only on an
/// incompatible change; a durable backend that finds a newer version than it understands must refuse
/// to attach rather than reinterpret. `MemOverlay` is in-memory and carries no serialized header, but
/// durable backends (IndexedDB/OPFS) stamp this into theirs.
pub const OVERLAY_FORMAT_VERSION: u32 = 1;

/// Copy-on-write overlay errors — every failure is typed, never a panic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OverlayError {
    /// The overlay's recorded base binding does not match the manifest it is being attached to.
    BaseMismatch,
    /// A read/write range is at or beyond the image length.
    OutOfRange {
        offset: u64,
        len: u64,
        image_len: u64,
    },
    /// The base chunk source returned an error assembling base bytes.
    Base,
    /// A persisted overlay's on-storage format version is not understood (E3-T05 durable backends must
    /// refuse rather than silently reinterpret an incompatible layout).
    UnsupportedFormat { found: u32 },
    /// A persisted overlay meta record is malformed (bad magic / truncated / inconsistent geometry).
    BadMeta,
}

/// The outcome of an overlay read/write: complete, or blocked on a base chunk that must be fetched
/// first (the base is lazily streamed — E3-T02 deferred completion). Mirrors [`ReadOutcome`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OverlayOutcome<T> {
    Done(T),
    NeedChunk(usize),
}

/// The write-layer persistence trait: where dirty overlay blocks live and how they are made durable.
/// `MemOverlay` is the in-memory reference; a browser backend (IndexedDB/OPFS) implements the same
/// shape. A block is exactly [`OVERLAY_BLOCK`] bytes (the tail block's bytes past `image_len` are
/// unspecified padding — never read).
pub trait OverlayBackend {
    /// The dirty bytes of overlay block `block`, or `None` if that block has never been written (read
    /// falls through to the base).
    fn dirty_block(&self, block: u64) -> Option<&[u8; OVERLAY_BLOCK]>;
    /// Store (or replace) the full contents of overlay block `block`.
    fn write_block(&mut self, block: u64, bytes: [u8; OVERLAY_BLOCK]);
    /// Durability barrier. On `Ok` return, every prior `write_block` is durably persisted (for
    /// `MemOverlay`, memory is always "durable" for the session — a no-op). This is exactly what a
    /// virtio-blk `VIRTIO_BLK_T_FLUSH` maps onto (E3-T08).
    fn commit(&mut self) -> Result<(), OverlayError>;
    /// E3-T08: take a durability barrier — an opaque snapshot of the writes that a FLUSH issued
    /// *now* must wait on. `None` = everything already durable (synchronous backends). Async
    /// write-back backends (E3-T05 IndexedDB) return the set of block indices still awaiting
    /// their durable transaction.
    fn durability_barrier(&self) -> Option<Vec<u64>> {
        None
    }
    /// E3-T08: whether a previously-taken [`Self::durability_barrier`] has fully reached durable
    /// storage. Synchronous backends are always clear.
    fn barrier_clear(&self, barrier: &[u64]) -> bool {
        let _ = barrier;
        true
    }
    /// The 32-byte binding to the base image this overlay belongs to ([`ImageManifest::base_hash`]).
    fn base_binding(&self) -> &[u8; 32];
    /// The total image length in bytes (same as the base).
    fn image_len(&self) -> u64;
}

/// In-memory reference [`OverlayBackend`]: a sparse map of dirty blocks. `commit` is a no-op (memory
/// persists for the session; durable backends override it). This is the implementation the proptest
/// pins `OverlayDisk` against.
#[derive(Debug, Clone)]
pub struct MemOverlay {
    blocks: BTreeMap<u64, [u8; OVERLAY_BLOCK]>,
    base_binding: [u8; 32],
    image_len: u64,
}

impl MemOverlay {
    /// A fresh (empty) overlay bound to `manifest`'s base.
    pub fn new(manifest: &ImageManifest) -> MemOverlay {
        MemOverlay {
            blocks: BTreeMap::new(),
            base_binding: manifest.base_hash(),
            image_len: manifest.image_len,
        }
    }

    /// How many overlay blocks are dirty (instrumentation / tests).
    pub fn dirty_count(&self) -> usize {
        self.blocks.len()
    }
}

impl OverlayBackend for MemOverlay {
    fn dirty_block(&self, block: u64) -> Option<&[u8; OVERLAY_BLOCK]> {
        self.blocks.get(&block)
    }
    fn write_block(&mut self, block: u64, bytes: [u8; OVERLAY_BLOCK]) {
        self.blocks.insert(block, bytes);
    }
    fn commit(&mut self) -> Result<(), OverlayError> {
        Ok(()) // in-memory: already "durable" for the session
    }
    fn base_binding(&self) -> &[u8; 32] {
        &self.base_binding
    }
    fn image_len(&self) -> u64 {
        self.image_len
    }
}

/// A copy-on-write disk: reads merge the write overlay over the immutable base at [`OVERLAY_BLOCK`]
/// granularity; writes land in the overlay (read-modify-write for partial blocks). Generic over the
/// overlay backend `B`; the base is supplied as a [`ChunkSource`] at each call (the wasm layer's shared
/// chunk cache), so a base read can report a not-yet-fetched chunk.
pub struct OverlayDisk<B: OverlayBackend> {
    overlay: B,
    index: ChunkIndex,
}

impl<B: OverlayBackend> OverlayDisk<B> {
    /// Attach `overlay` to the base described by `manifest`. Fails with [`OverlayError::BaseMismatch`]
    /// BEFORE any I/O if the overlay was bound to a different base (by manifest hash) — an overlay
    /// must never ride the wrong geometry/content.
    pub fn attach(overlay: B, manifest: &ImageManifest) -> Result<OverlayDisk<B>, OverlayError> {
        if overlay.base_binding() != &manifest.base_hash() {
            return Err(OverlayError::BaseMismatch);
        }
        Ok(OverlayDisk {
            overlay,
            index: manifest.index(),
        })
    }

    /// Total image length in bytes.
    pub fn len(&self) -> u64 {
        self.index.image_len()
    }

    /// Whether the image is zero-length.
    pub fn is_empty(&self) -> bool {
        self.index.image_len() == 0
    }

    /// The base binding (manifest hash) this overlay is bound to.
    pub fn base_binding(&self) -> &[u8; 32] {
        self.overlay.base_binding()
    }

    /// Durability barrier — see [`OverlayBackend::commit`].
    pub fn commit(&mut self) -> Result<(), OverlayError> {
        self.overlay.commit()
    }

    /// E3-T08: take a durability barrier from the backend (see
    /// [`OverlayBackend::durability_barrier`]).
    pub fn durability_barrier(&self) -> Option<Vec<u64>> {
        self.overlay.durability_barrier()
    }

    /// E3-T08: whether a previously-taken barrier has fully reached durable storage.
    pub fn barrier_clear(&self, barrier: &[u64]) -> bool {
        self.overlay.barrier_clear(barrier)
    }

    /// The valid byte length of overlay block `block` — [`OVERLAY_BLOCK`] for every block but the tail
    /// one, which is short when `image_len` is not a multiple of the block size.
    fn block_valid_len(&self, block: u64) -> usize {
        let start = block * OVERLAY_BLOCK as u64;
        (self.index.image_len() - start).min(OVERLAY_BLOCK as u64) as usize
    }

    /// Read `[offset, offset+len)`, merging dirty overlay blocks over base bytes. Returns
    /// [`OverlayOutcome::NeedChunk`] if a base block that must be consulted is not yet resident.
    pub fn read<S: ChunkSource>(
        &self,
        base: &S,
        offset: u64,
        len: u64,
    ) -> Result<OverlayOutcome<Vec<u8>>, OverlayError> {
        let end = self.range_end(offset, len)?;
        let mut out = Vec::with_capacity(len as usize);
        let mut pos = offset;
        while pos < end {
            let block = pos / OVERLAY_BLOCK as u64;
            let block_start = block * OVERLAY_BLOCK as u64;
            let lo = (pos - block_start) as usize;
            let hi = ((end - block_start).min(OVERLAY_BLOCK as u64)) as usize;
            match self.overlay.dirty_block(block) {
                Some(bytes) => out.extend_from_slice(&bytes[lo..hi]),
                None => match self
                    .index
                    .read(base, block_start + lo as u64, (hi - lo) as u64)
                {
                    Ok(ReadOutcome::Ready(bs)) => out.extend_from_slice(&bs),
                    Ok(ReadOutcome::NeedChunk(c)) => return Ok(OverlayOutcome::NeedChunk(c)),
                    Err(_) => return Err(OverlayError::Base),
                },
            }
            pos = block_start + hi as u64;
        }
        Ok(OverlayOutcome::Done(out))
    }

    /// Write `data` (`data.len()` == `len`) at `offset`, copying affected blocks into the overlay. A
    /// partial block is read-modify-written: its current content (dirty overlay block, else base) is
    /// materialized, the written bytes patched in, and the full block stored. If a base block needed
    /// for a partial RMW is not resident, returns [`OverlayOutcome::NeedChunk`] having written nothing.
    pub fn write<S: ChunkSource>(
        &mut self,
        base: &S,
        offset: u64,
        data: &[u8],
    ) -> Result<OverlayOutcome<()>, OverlayError> {
        let len = data.len() as u64;
        let end = self.range_end(offset, len)?;

        // First pass: materialize every affected block (may report NeedChunk before mutating anything,
        // so a blocked write is atomic — no partial application).
        let mut staged: Vec<(u64, [u8; OVERLAY_BLOCK])> = Vec::new();
        let mut pos = offset;
        while pos < end {
            let block = pos / OVERLAY_BLOCK as u64;
            let block_start = block * OVERLAY_BLOCK as u64;
            let lo = (pos - block_start) as usize;
            let hi = ((end - block_start).min(OVERLAY_BLOCK as u64)) as usize;
            let valid = self.block_valid_len(block);

            // Start from the block's current full contents (only [0,valid) is meaningful).
            let mut buf = [0u8; OVERLAY_BLOCK];
            let covers_whole_block = lo == 0 && hi == valid;
            if !covers_whole_block {
                match self.overlay.dirty_block(block) {
                    Some(cur) => buf = *cur,
                    None => match self.index.read(base, block_start, valid as u64) {
                        Ok(ReadOutcome::Ready(bs)) => buf[..valid].copy_from_slice(&bs),
                        Ok(ReadOutcome::NeedChunk(c)) => return Ok(OverlayOutcome::NeedChunk(c)),
                        Err(_) => return Err(OverlayError::Base),
                    },
                }
            }
            // Patch in the written slice for this block.
            let d0 = (pos - offset) as usize;
            buf[lo..hi].copy_from_slice(&data[d0..d0 + (hi - lo)]);
            staged.push((block, buf));
            pos = block_start + hi as u64;
        }

        for (block, buf) in staged {
            self.overlay.write_block(block, buf);
        }
        Ok(OverlayOutcome::Done(()))
    }

    /// Validate `[offset, offset+len)` against the image and return the exclusive end. A zero-length
    /// request is valid (returns `offset`); a past-the-end one is [`OverlayError::OutOfRange`].
    fn range_end(&self, offset: u64, len: u64) -> Result<u64, OverlayError> {
        let image_len = self.index.image_len();
        let end = offset.checked_add(len).filter(|&e| e <= image_len).ok_or(
            OverlayError::OutOfRange {
                offset,
                len,
                image_len,
            },
        )?;
        Ok(end)
    }
}

#[cfg(test)]
mod tests;
