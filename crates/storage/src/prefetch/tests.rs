//! E3-T03 prefetch tests: sequential-run detection, window/clamp behaviour, boot-profile batching
//! with a concurrency cap, and prefetch-accuracy accounting.
use super::*;
use alloc::vec;

#[test]
fn readahead_triggers_only_on_a_three_access_forward_run() {
    let mut ra = Readahead::new(4);
    // A lone access, or two-in-a-row, is not yet a stream.
    assert!(ra.observe(10).is_empty());
    assert!(ra.observe(11).is_empty(), "two consecutive is not enough");
    // The third consecutive access commits: prefetch k+1..=k+4.
    assert_eq!(ra.observe(12), vec![13, 14, 15, 16]);
    // The run continues: each further step reads ahead from the new position.
    assert_eq!(ra.observe(13), vec![14, 15, 16, 17]);
}

#[test]
fn readahead_resets_on_a_non_sequential_jump() {
    let mut ra = Readahead::new(2);
    ra.observe(5);
    ra.observe(6);
    assert_eq!(ra.observe(7), vec![8, 9]); // run of 3 → fires
    // A random jump breaks the run; it must re-accumulate three before firing again.
    assert!(ra.observe(100).is_empty(), "jump resets the run");
    assert!(ra.observe(101).is_empty());
    assert_eq!(ra.observe(102), vec![103, 104]);
    // A backwards step also resets.
    assert!(ra.observe(50).is_empty());
}

#[test]
fn readahead_window_zero_disables() {
    let mut ra = Readahead::new(0);
    for k in 0..10 {
        assert!(ra.observe(k).is_empty(), "window 0 never prefetches");
    }
}

#[test]
fn boot_prefetch_returns_next_needed_chunks_up_to_the_cap() {
    let profile = [0usize, 1, 2, 3, 4, 5, 2, 6]; // note the repeat of 2
    // Nothing resident yet, cap 3 → first three distinct profile chunks.
    let batch = boot_prefetch(&profile, 3, |_| true);
    assert_eq!(batch, vec![0, 1, 2]);
    // Chunks 0,1 now resident (needs_fetch false) → the batch advances past them; 2 is deduped.
    let resident = [0usize, 1];
    let batch = boot_prefetch(&profile, 3, |c| !resident.contains(&c));
    assert_eq!(batch, vec![2, 3, 4]);
    // Cap 0 → nothing.
    assert!(boot_prefetch(&profile, 0, |_| true).is_empty());
    // All resident → nothing to do.
    assert!(boot_prefetch(&profile, 5, |_| false).is_empty());
}

#[test]
fn prefetch_tracker_measures_accuracy() {
    let mut t = PrefetchTracker::new();
    t.record_issued(1);
    t.record_issued(2);
    t.record_issued(3);
    t.record_issued(1); // re-issue of an outstanding chunk is not double-counted
    assert_eq!(t.counts(), (3, 0));

    // Guest reads 1 and 2 (prefetch hits), plus 9 which was never prefetched.
    t.note_access(1);
    t.note_access(2);
    t.note_access(9);
    // A second read of 1 must NOT double-count it as used.
    t.note_access(1);
    assert_eq!(t.counts(), (3, 2));
    assert_eq!(t.accuracy_pct(), 66); // 2/3

    // Empty tracker → 0%, no divide-by-zero.
    assert_eq!(PrefetchTracker::new().accuracy_pct(), 0);
}
