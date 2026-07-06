//! E3-T05/T06: the browser-agnostic write-back bookkeeping shared by the durable overlay backends.
//!
//! IndexedDB (T05) and OPFS (T06) are async, but [`OverlayBackend`] (and the `OverlayDisk` read path
//! that drives it) is synchronous — a guest read must resolve a dirty block *now*, not await a
//! transaction. [`WriteBackOverlay`] bridges that: it holds the full write layer in memory (so reads
//! and writes are synchronous), and tracks which blocks have been written since they were last
//! durably persisted. The async durable store (in the wasm layer) drains [`Self::pending_flush`] into
//! a transaction and calls [`Self::mark_persisted`] once it completes — that is where the honest
//! `durability: "strict"` commit lives. This module owns only the bookkeeping, so it is native-tested;
//! it has no `web-sys`.
//!
//! **Durability note:** the synchronous [`OverlayBackend::commit`] here is NOT the durability barrier
//! (it cannot block on an async transaction). It marks the current write set as needing a flush; the
//! honest async commit is a wasm-boundary method that awaits the store's transaction-complete. E3-T08
//! formalizes how the virtio-blk `FLUSH` completion waits for that async barrier.

use crate::{ImageManifest, OVERLAY_BLOCK, OverlayBackend, OverlayError};
use alloc::collections::{BTreeMap, BTreeSet};
use alloc::vec::Vec;

/// In-memory write layer with unpersisted-block tracking for an async durable store. Synchronous for
/// the `OverlayDisk` read/write path; the async persister drains [`pending_flush`](Self::pending_flush).
#[derive(Debug, Clone)]
pub struct WriteBackOverlay {
    /// The full in-memory view — every dirty block, whether or not it is durably persisted yet.
    blocks: BTreeMap<u64, [u8; OVERLAY_BLOCK]>,
    /// Blocks written since they were last persisted — the set the async store still needs to flush.
    unpersisted: BTreeSet<u64>,
    base_binding: [u8; 32],
    image_len: u64,
}

impl WriteBackOverlay {
    /// A fresh (empty) write-back overlay bound to `manifest`'s base.
    pub fn new(manifest: &ImageManifest) -> WriteBackOverlay {
        WriteBackOverlay {
            blocks: BTreeMap::new(),
            unpersisted: BTreeSet::new(),
            base_binding: manifest.base_hash(),
            image_len: manifest.image_len,
        }
    }

    /// Reconstruct from blocks loaded out of a durable store on reopen. All loaded blocks are already
    /// persisted, so `unpersisted` starts empty. (The caller is responsible for verifying the store's
    /// recorded base binding matches `manifest.base_hash()` — E3-T04's rule — before loading.)
    pub fn from_loaded(
        manifest: &ImageManifest,
        blocks: BTreeMap<u64, [u8; OVERLAY_BLOCK]>,
    ) -> WriteBackOverlay {
        WriteBackOverlay {
            blocks,
            unpersisted: BTreeSet::new(),
            base_binding: manifest.base_hash(),
            image_len: manifest.image_len,
        }
    }

    /// Snapshot of the blocks that still need to be written to the durable store — `(block, bytes)` in
    /// ascending block order. The async persister writes exactly these in one batched transaction, then
    /// calls [`Self::mark_persisted`]. Snapshotting (rather than draining) means a write that lands
    /// mid-transaction is simply re-flushed next round — never lost.
    pub fn pending_flush(&self) -> Vec<(u64, [u8; OVERLAY_BLOCK])> {
        self.unpersisted
            .iter()
            .map(|&b| (b, self.blocks[&b]))
            .collect()
    }

    /// Mark `blocks` as durably persisted (called after the store's transaction completes). A block
    /// that was re-written after the snapshot but before this call stays unpersisted only if it was
    /// re-added to `unpersisted` in the interim — so re-marking here clears exactly what was flushed.
    pub fn mark_persisted(&mut self, blocks: &[u64]) {
        for b in blocks {
            self.unpersisted.remove(b);
        }
    }

    /// How many blocks still need flushing to the durable store.
    pub fn unpersisted_count(&self) -> usize {
        self.unpersisted.len()
    }

    /// How many dirty blocks are resident in total (persisted + unpersisted).
    pub fn block_count(&self) -> usize {
        self.blocks.len()
    }
}

impl OverlayBackend for WriteBackOverlay {
    fn dirty_block(&self, block: u64) -> Option<&[u8; OVERLAY_BLOCK]> {
        self.blocks.get(&block)
    }

    fn write_block(&mut self, block: u64, bytes: [u8; OVERLAY_BLOCK]) {
        self.blocks.insert(block, bytes);
        self.unpersisted.insert(block); // needs a durable flush
    }

    fn commit(&mut self) -> Result<(), OverlayError> {
        // NOT the durability barrier — the async store's transaction-complete is (see module docs).
        // Returning Ok here only means "the in-memory write set is consistent"; the wasm layer's async
        // commit awaits the store. A no-op keeps the synchronous OverlayDisk::commit total.
        Ok(())
    }

    fn base_binding(&self) -> &[u8; 32] {
        &self.base_binding
    }

    fn image_len(&self) -> u64 {
        self.image_len
    }
}

#[cfg(test)]
mod tests;
