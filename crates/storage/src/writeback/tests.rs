//! E3-T05/T06 write-back bookkeeping tests: sync read/write view, generation-guarded unpersisted
//! tracking (incl. the lost-write-on-re-dirty regression), flush snapshot/mark round-trip, reopen,
//! and OverlayDisk correctness over it.
use super::*;
use crate::{ImageManifest, Layout, OVERLAY_BLOCK, OverlayDisk, OverlayOutcome};
use alloc::vec;
use alloc::vec::Vec;

fn manifest(image_len: u64) -> ImageManifest {
    ImageManifest::from_image(&vec![0u8; image_len as usize], 4096, Layout::Blob).unwrap()
}

fn blk(fill: u8) -> [u8; OVERLAY_BLOCK] {
    [fill; OVERLAY_BLOCK]
}

/// The `(block, generation)` pairs of a flush snapshot — what the driver passes back to mark_persisted.
fn pairs(snap: &[(u64, u64, [u8; OVERLAY_BLOCK])]) -> Vec<(u64, u64)> {
    snap.iter().map(|(b, g, _)| (*b, *g)).collect()
}

#[test]
fn writes_are_tracked_unpersisted_until_marked() {
    let m = manifest(3 * OVERLAY_BLOCK as u64);
    let mut wb = WriteBackOverlay::new(&m);
    assert_eq!(wb.unpersisted_count(), 0);

    wb.write_block(0, blk(0xA0));
    wb.write_block(2, blk(0xC2));
    assert_eq!(wb.dirty_block(0), Some(&blk(0xA0)));
    assert_eq!(wb.dirty_block(2), Some(&blk(0xC2)));
    assert_eq!(wb.dirty_block(1), None);
    assert_eq!(wb.unpersisted_count(), 2);

    // Flush snapshot lists them in block order, with the current bytes.
    let snap = wb.pending_flush();
    assert_eq!(
        snap.iter().map(|(b, _, _)| *b).collect::<Vec<_>>(),
        vec![0, 2]
    );
    assert_eq!(snap[0].2, blk(0xA0));

    // After the async store persists exactly these (block, gen) pairs, they clear.
    wb.mark_persisted(&pairs(&snap));
    assert_eq!(wb.unpersisted_count(), 0);
    assert!(wb.pending_flush().is_empty());
    assert_eq!(wb.dirty_block(0), Some(&blk(0xA0))); // persisted ≠ evicted
    assert_eq!(wb.block_count(), 2);
}

#[test]
fn re_dirty_during_flush_is_not_lost() {
    // Critic E3-T05 HIGH bug: the guest re-writes a hot block WHILE its flush transaction is in flight;
    // marking the snapshot's pairs must NOT clear the newer write.
    let m = manifest(2 * OVERLAY_BLOCK as u64);
    let mut wb = WriteBackOverlay::new(&m);
    wb.write_block(0, blk(0x11)); // v1
    let snap = wb.pending_flush(); // driver snapshots [(0, gen=1, v1)], starts the txn
    wb.write_block(0, blk(0x22)); // v2 — guest re-writes mid-txn (gen → 2)
    wb.mark_persisted(&pairs(&snap)); // txn for v1 completes; driver marks the SNAPSHOT's pairs

    // v2 must still be pending (its generation advanced past the flushed one) — never lost.
    assert_eq!(
        wb.unpersisted_count(),
        1,
        "re-written block stays unpersisted"
    );
    let snap2 = wb.pending_flush();
    assert_eq!(snap2.len(), 1);
    assert_eq!(snap2[0].0, 0);
    assert_eq!(
        snap2[0].2,
        blk(0x22),
        "the newer bytes are re-flushed, not the stale ones"
    );
    assert_eq!(wb.dirty_block(0), Some(&blk(0x22)));

    // Flushing v2 (its current pairs) then clears it.
    wb.mark_persisted(&pairs(&snap2));
    assert_eq!(wb.unpersisted_count(), 0);
}

#[test]
fn rewrite_after_flush_is_unpersisted_again() {
    let m = manifest(2 * OVERLAY_BLOCK as u64);
    let mut wb = WriteBackOverlay::new(&m);
    wb.write_block(0, blk(1));
    wb.mark_persisted(&pairs(&wb.pending_flush()));
    assert_eq!(wb.unpersisted_count(), 0);
    // Re-writing a persisted block dirties it again → must be re-flushed with its new bytes.
    wb.write_block(0, blk(2));
    assert_eq!(wb.unpersisted_count(), 1);
    assert_eq!(wb.pending_flush()[0].2, blk(2));
}

#[test]
fn mark_persisted_only_clears_matching_generations() {
    let m = manifest(4 * OVERLAY_BLOCK as u64);
    let mut wb = WriteBackOverlay::new(&m);
    for b in 0..4 {
        wb.write_block(b, blk(b as u8));
    }
    let snap = wb.pending_flush();
    // Persist only a subset (a partial-batch completion); the rest stay pending.
    wb.mark_persisted(&[(0, 1), (2, 1)]);
    assert_eq!(
        wb.pending_flush()
            .iter()
            .map(|(b, _, _)| *b)
            .collect::<Vec<_>>(),
        vec![1, 3]
    );
    // Marking a never-written block, or a stale generation, is a harmless no-op.
    wb.mark_persisted(&[(99, 1), (1, 999)]);
    assert_eq!(wb.unpersisted_count(), 2);
    let _ = snap;
}

#[test]
fn from_loaded_reopen_has_all_blocks_persisted() {
    let m = manifest(3 * OVERLAY_BLOCK as u64);
    let mut loaded = BTreeMap::new();
    loaded.insert(0u64, blk(0x11));
    loaded.insert(1u64, blk(0x22));
    let wb = WriteBackOverlay::from_loaded(&m, loaded);
    assert_eq!(wb.dirty_block(0), Some(&blk(0x11)));
    assert_eq!(wb.dirty_block(1), Some(&blk(0x22)));
    assert_eq!(wb.unpersisted_count(), 0);
    assert!(wb.pending_flush().is_empty());
    assert_eq!(wb.base_binding(), &m.base_hash());
}

#[test]
fn a_shared_queue_lets_an_external_persister_drain_the_overlays_writes() {
    // The durable-backend seam: the overlay records writes into a SHARED PersistQueue that the async
    // store drains independently (it never touches the overlay/machine).
    use alloc::rc::Rc;
    use core::cell::RefCell;
    let m = manifest(3 * OVERLAY_BLOCK as u64);
    let queue = Rc::new(RefCell::new(crate::PersistQueue::new()));
    let mut wb = WriteBackOverlay::with_shared_queue(&m, queue.clone(), BTreeMap::new());

    wb.write_block(0, blk(0xD0));
    wb.write_block(2, blk(0xD2));
    // The external persister sees the writes through its own clone of the queue.
    let snap = queue.borrow().pending_flush();
    assert_eq!(
        snap.iter().map(|(b, _, _)| *b).collect::<Vec<_>>(),
        vec![0, 2]
    );
    assert_eq!(snap[0].2, blk(0xD0));
    // It marks them persisted on its side; the overlay observes the drain.
    let flushed: Vec<(u64, u64)> = snap.iter().map(|(b, g, _)| (*b, *g)).collect();
    queue.borrow_mut().mark_persisted(&flushed);
    assert_eq!(wb.unpersisted_count(), 0);
    // A re-write during a hypothetical in-flight flush is still not lost across the shared boundary.
    wb.write_block(0, blk(0xEE));
    queue.borrow_mut().mark_persisted(&flushed); // stale pairs from the FIRST snapshot
    assert_eq!(
        wb.unpersisted_count(),
        1,
        "re-write survives a stale mark across the shared queue"
    );
    assert_eq!(queue.borrow().pending_flush()[0].2, blk(0xEE));
    // The overlay still serves the latest bytes for reads.
    assert_eq!(wb.dirty_block(0), Some(&blk(0xEE)));
}

#[test]
fn overlay_disk_reads_merge_over_base_through_write_back() {
    // WriteBackOverlay is a drop-in OverlayBackend: OverlayDisk merges over base identically.
    let data = vec![0xEEu8; OVERLAY_BLOCK];
    let m = ImageManifest::from_image(&data, 4096, Layout::Blob).unwrap();
    struct Base(Vec<u8>);
    impl crate::ChunkSource for Base {
        fn get(&self, chunk: usize) -> Option<&[u8]> {
            (chunk == 0).then_some(self.0.as_slice())
        }
    }
    let base = Base(data.clone());
    let mut disk = OverlayDisk::attach(WriteBackOverlay::new(&m), &m).unwrap();

    assert_eq!(
        disk.read(&base, 0, 8).unwrap(),
        OverlayOutcome::Done(vec![0xEE; 8])
    );
    assert_eq!(
        disk.write(&base, 100, &[1, 2, 3, 4]).unwrap(),
        OverlayOutcome::Done(())
    );
    let mut expect = vec![0xEEu8; 200];
    expect[100..104].copy_from_slice(&[1, 2, 3, 4]);
    assert_eq!(
        disk.read(&base, 0, 200).unwrap(),
        OverlayOutcome::Done(expect)
    );
}

// ── E3-T08: FLUSH durability barriers ───────────────────────────────────────────────────────

/// A barrier is exactly the pending block set; a full persist round clears it.
#[test]
fn barrier_taken_and_cleared_by_persist_round() {
    let m = manifest(4 * OVERLAY_BLOCK as u64);
    let mut ov = WriteBackOverlay::new(&m);
    assert!(ov.durability_barrier().is_none(), "durable when empty");

    ov.write_block(0, blk(1));
    ov.write_block(2, blk(2));
    let barrier = ov.durability_barrier().expect("pending data → barrier");
    assert_eq!(barrier, vec![0, 2]);
    assert!(!ov.barrier_clear(&barrier), "not durable yet");

    // The async store drains + marks (simulated).
    let snap = ov.shared_queue().borrow().pending_flush();
    let p = pairs(&snap);
    ov.shared_queue().borrow_mut().mark_persisted(&p);
    assert!(ov.barrier_clear(&barrier), "barrier clear after the round");
    assert!(ov.durability_barrier().is_none(), "queue empty again");
}

/// Writes AFTER the barrier don't extend it: draining only the barrier blocks satisfies the
/// FLUSH even while newer writes remain pending (a flush covers only writes completed before
/// it was issued).
#[test]
fn post_barrier_writes_do_not_extend_the_barrier() {
    let m = manifest(4 * OVERLAY_BLOCK as u64);
    let mut ov = WriteBackOverlay::new(&m);
    ov.write_block(0, blk(1));
    let barrier = ov.durability_barrier().unwrap();
    assert_eq!(barrier, vec![0]);

    // Snapshot FIRST (covers only block 0), THEN a post-barrier write to block 3 lands.
    let snap = ov.shared_queue().borrow().pending_flush();
    ov.write_block(3, blk(3));
    let p = pairs(&snap);
    ov.shared_queue().borrow_mut().mark_persisted(&p);

    assert!(
        ov.barrier_clear(&barrier),
        "barrier satisfied though block 3 still pending"
    );
    assert_eq!(ov.shared_queue().borrow().unpersisted_count(), 1);
}

/// The honesty case (mirrors the E3-T05 lost-write guard): a barrier block RE-written mid-flush
/// keeps the barrier held — the pre-flush version never became durable, so acking would lie.
/// The barrier releases only when the coalesced newer version persists.
#[test]
fn re_dirtied_barrier_block_keeps_flush_waiting() {
    let m = manifest(4 * OVERLAY_BLOCK as u64);
    let mut ov = WriteBackOverlay::new(&m);
    ov.write_block(0, blk(1));
    let barrier = ov.durability_barrier().unwrap();

    // The store snapshots gen-1, but the guest re-writes block 0 (gen-2) before the txn lands.
    let snap = ov.shared_queue().borrow().pending_flush();
    ov.write_block(0, blk(9));
    let p = pairs(&snap);
    ov.shared_queue().borrow_mut().mark_persisted(&p); // gen guard: block 0 stays pending

    assert!(
        !ov.barrier_clear(&barrier),
        "hostile-commit guard: the barrier must NOT clear — gen-1 never reached disk"
    );

    // The next round persists gen-2 → now the flush is honestly durable.
    let snap2 = ov.shared_queue().borrow().pending_flush();
    let p2 = pairs(&snap2);
    ov.shared_queue().borrow_mut().mark_persisted(&p2);
    assert!(ov.barrier_clear(&barrier));
}
