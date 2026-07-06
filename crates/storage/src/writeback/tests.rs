//! E3-T05/T06 write-back bookkeeping tests: sync read/write view, unpersisted tracking, flush
//! snapshot/mark round-trip, reopen via `from_loaded`, and OverlayDisk correctness over it.
use super::*;
use crate::{ImageManifest, Layout, OVERLAY_BLOCK, OverlayDisk, OverlayOutcome};
use alloc::vec;
use alloc::vec::Vec;

fn manifest(image_len: u64) -> ImageManifest {
    // A tiny synthetic base; base_hash only needs to be stable for binding.
    ImageManifest::from_image(&vec![0u8; image_len as usize], 4096, Layout::Blob).unwrap()
}

fn blk(fill: u8) -> [u8; OVERLAY_BLOCK] {
    [fill; OVERLAY_BLOCK]
}

#[test]
fn writes_are_tracked_unpersisted_until_marked() {
    let m = manifest(3 * OVERLAY_BLOCK as u64);
    let mut wb = WriteBackOverlay::new(&m);
    assert_eq!(wb.unpersisted_count(), 0);

    wb.write_block(0, blk(0xA0));
    wb.write_block(2, blk(0xC2));
    // Both are readable immediately (synchronous view) and both need flushing.
    assert_eq!(wb.dirty_block(0), Some(&blk(0xA0)));
    assert_eq!(wb.dirty_block(2), Some(&blk(0xC2)));
    assert_eq!(wb.dirty_block(1), None);
    assert_eq!(wb.unpersisted_count(), 2);

    // The flush snapshot lists them in block order.
    let batch = wb.pending_flush();
    assert_eq!(
        batch.iter().map(|(b, _)| *b).collect::<Vec<_>>(),
        vec![0, 2]
    );
    assert_eq!(batch[0].1, blk(0xA0));

    // After the async store persists them, they clear.
    wb.mark_persisted(&[0, 2]);
    assert_eq!(wb.unpersisted_count(), 0);
    assert!(wb.pending_flush().is_empty());
    // But they stay readable (persisted ≠ evicted).
    assert_eq!(wb.dirty_block(0), Some(&blk(0xA0)));
    assert_eq!(wb.block_count(), 2);
}

#[test]
fn rewrite_after_flush_is_unpersisted_again() {
    let m = manifest(2 * OVERLAY_BLOCK as u64);
    let mut wb = WriteBackOverlay::new(&m);
    wb.write_block(0, blk(1));
    wb.mark_persisted(&[0]);
    assert_eq!(wb.unpersisted_count(), 0);
    // Re-writing a persisted block dirties it again → must be re-flushed.
    wb.write_block(0, blk(2));
    assert_eq!(wb.unpersisted_count(), 1);
    assert_eq!(wb.pending_flush(), vec![(0u64, blk(2))]);
    assert_eq!(wb.dirty_block(0), Some(&blk(2)));
}

#[test]
fn mark_persisted_only_clears_named_blocks() {
    let m = manifest(4 * OVERLAY_BLOCK as u64);
    let mut wb = WriteBackOverlay::new(&m);
    for b in 0..4 {
        wb.write_block(b, blk(b as u8));
    }
    // Snapshot, persist only a subset (a partial-batch completion), the rest stay pending.
    wb.mark_persisted(&[0, 2]);
    assert_eq!(
        wb.pending_flush()
            .iter()
            .map(|(b, _)| *b)
            .collect::<Vec<_>>(),
        vec![1, 3]
    );
    // Marking a never-written block is a harmless no-op.
    wb.mark_persisted(&[99]);
    assert_eq!(wb.unpersisted_count(), 2);
}

#[test]
fn from_loaded_reopen_has_all_blocks_persisted() {
    let m = manifest(3 * OVERLAY_BLOCK as u64);
    // Simulate a durable store handing back blocks 0 and 1 on reopen.
    let mut loaded = BTreeMap::new();
    loaded.insert(0u64, blk(0x11));
    loaded.insert(1u64, blk(0x22));
    let wb = WriteBackOverlay::from_loaded(&m, loaded);
    assert_eq!(wb.dirty_block(0), Some(&blk(0x11)));
    assert_eq!(wb.dirty_block(1), Some(&blk(0x22)));
    // Nothing to flush — a freshly reopened overlay is already durable.
    assert_eq!(wb.unpersisted_count(), 0);
    assert!(wb.pending_flush().is_empty());
    assert_eq!(wb.base_binding(), &m.base_hash());
}

#[test]
fn overlay_disk_reads_merge_over_base_through_write_back() {
    // WriteBackOverlay must behave exactly like MemOverlay under OverlayDisk (it is just a different
    // OverlayBackend). One 4 KiB block image; base is all 0xEE (a resident ChunkSource).
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

    // Unwritten read hits the base.
    assert_eq!(
        disk.read(&base, 0, 8).unwrap(),
        OverlayOutcome::Done(vec![0xEE; 8])
    );
    // Write 4 bytes at offset 100 (partial block → RMW), read back merged.
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
