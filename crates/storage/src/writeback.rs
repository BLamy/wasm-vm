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
use alloc::collections::BTreeMap;
use alloc::rc::Rc;
use alloc::vec::Vec;
use core::cell::RefCell;

/// A shared handle to a [`PersistQueue`] — cloned into both the in-memory overlay (which records every
/// write) and the async durable store (which drains it), so the store never reaches into the machine.
pub type SharedPersistQueue = Rc<RefCell<PersistQueue>>;

/// The blocks not yet durably persisted, with the bytes to write and a per-block dirty generation.
/// This is the single source of truth for write-back durability; a durable backend shares one of these
/// with its in-memory overlay and drains it asynchronously.
#[derive(Debug, Default, Clone)]
pub struct PersistQueue {
    /// `block -> (generation, bytes)` for every block awaiting a durable flush.
    pending: BTreeMap<u64, (u64, [u8; OVERLAY_BLOCK])>,
    /// Monotonic per-block dirty generation (never decreases), so a block re-written between a flush
    /// snapshot and its mark is detectable.
    generation: BTreeMap<u64, u64>,
}

impl PersistQueue {
    pub fn new() -> PersistQueue {
        PersistQueue::default()
    }

    /// Record a written block (its post-RMW bytes) as needing a durable flush; advances its generation.
    fn record(&mut self, block: u64, bytes: [u8; OVERLAY_BLOCK]) {
        let g = {
            let e = self.generation.entry(block).or_insert(0);
            *e += 1;
            *e
        };
        self.pending.insert(block, (g, bytes));
    }

    /// Snapshot of the blocks to flush — `(block, generation, bytes)` in ascending block order. The
    /// async store writes exactly these, then passes the same `(block, generation)` pairs to
    /// [`Self::mark_persisted`].
    pub fn pending_flush(&self) -> Vec<(u64, u64, [u8; OVERLAY_BLOCK])> {
        self.pending
            .iter()
            .map(|(&b, &(g, bytes))| (b, g, bytes))
            .collect()
    }

    /// Clear flushed blocks whose generation is UNCHANGED since the snapshot — a block re-written
    /// mid-flush (higher generation) stays pending so its new bytes are flushed next round. This
    /// generation guard is the E3-T05 lost-write fix.
    pub fn mark_persisted(&mut self, persisted: &[(u64, u64)]) {
        for &(b, g) in persisted {
            if self.pending.get(&b).is_some_and(|&(pg, _)| pg == g) {
                self.pending.remove(&b);
            }
        }
    }

    /// How many blocks still need flushing.
    pub fn unpersisted_count(&self) -> usize {
        self.pending.len()
    }

    /// Whether nothing is pending a flush.
    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
}

/// In-memory write layer for the `OverlayDisk` path (synchronous reads/writes), with durability
/// tracking delegated to a (possibly shared) [`PersistQueue`]. The `blocks` map is owned — so
/// `dirty_block` returns a borrow with no interior-mutability gymnastics — while the durability queue
/// can be shared with an async store (see [`Self::with_shared_queue`]/[`Self::shared_queue`]).
#[derive(Debug)]
pub struct WriteBackOverlay {
    /// The full in-memory view — every dirty block, whether or not it is durably persisted yet.
    blocks: BTreeMap<u64, [u8; OVERLAY_BLOCK]>,
    /// Durability tracking — the source of truth for `pending_flush`/`mark_persisted`; may be shared.
    queue: SharedPersistQueue,
    base_binding: [u8; 32],
    image_len: u64,
}

impl WriteBackOverlay {
    /// A fresh (empty) write-back overlay bound to `manifest`'s base, with its own private queue.
    pub fn new(manifest: &ImageManifest) -> WriteBackOverlay {
        WriteBackOverlay::with_shared_queue(
            manifest,
            Rc::new(RefCell::new(PersistQueue::new())),
            BTreeMap::new(),
        )
    }

    /// Reconstruct from blocks loaded out of a durable store on reopen. All loaded blocks are already
    /// persisted, so the queue starts empty. (The caller must verify the store's recorded base binding
    /// matches `manifest.base_hash()` — E3-T04's rule — before loading.)
    pub fn from_loaded(
        manifest: &ImageManifest,
        blocks: BTreeMap<u64, [u8; OVERLAY_BLOCK]>,
    ) -> WriteBackOverlay {
        WriteBackOverlay::with_shared_queue(
            manifest,
            Rc::new(RefCell::new(PersistQueue::new())),
            blocks,
        )
    }

    /// Build over a SHARED persist queue (the async durable store holds the other `Rc` clone) and
    /// pre-loaded `blocks` (already persisted — the queue starts reflecting only new writes). This is
    /// how a durable backend wires the in-memory overlay to its flush loop.
    pub fn with_shared_queue(
        manifest: &ImageManifest,
        queue: SharedPersistQueue,
        blocks: BTreeMap<u64, [u8; OVERLAY_BLOCK]>,
    ) -> WriteBackOverlay {
        WriteBackOverlay {
            blocks,
            queue,
            base_binding: manifest.base_hash(),
            image_len: manifest.image_len,
        }
    }

    /// A clone of the shared persist-queue handle — the async store drains this while the overlay keeps
    /// serving reads/writes.
    pub fn shared_queue(&self) -> SharedPersistQueue {
        self.queue.clone()
    }

    /// Snapshot of blocks awaiting a durable flush (delegates to the queue).
    pub fn pending_flush(&self) -> Vec<(u64, u64, [u8; OVERLAY_BLOCK])> {
        self.queue.borrow().pending_flush()
    }

    /// Mark flushed `(block, generation)` pairs persisted (delegates to the queue; generation-guarded).
    pub fn mark_persisted(&mut self, persisted: &[(u64, u64)]) {
        self.queue.borrow_mut().mark_persisted(persisted);
    }

    /// How many blocks still need flushing to the durable store.
    pub fn unpersisted_count(&self) -> usize {
        self.queue.borrow().unpersisted_count()
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
        self.queue.borrow_mut().record(block, bytes); // needs a durable flush (generation advanced)
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
