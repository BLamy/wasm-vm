//! E3-T03 BlockCache tests: budget bound, CLOCK second-chance, pinning under pressure, oversized-chunk
//! admission, metrics, and a proptest of read-correctness + byte accounting vs a reference model.
use super::*;
use crate::ChunkSource;
use alloc::vec;

/// The actual resident byte total, summed from the entries — the internal accounting must match.
fn actual_resident(c: &BlockCache) -> u64 {
    c.entries.values().map(|e| e.bytes.len() as u64).sum()
}

#[test]
fn stays_within_budget_and_counts_evictions() {
    // 3 slots of 100 bytes = 300 budget.
    let mut c = BlockCache::new(300);
    for i in 0..3 {
        c.insert(i, vec![i as u8; 100]);
    }
    assert_eq!(c.resident_bytes(), 300);
    // A 4th 100-byte chunk forces exactly one eviction; residency stays at budget.
    c.insert(3, vec![3; 100]);
    assert_eq!(c.resident_bytes(), 300);
    assert_eq!(c.resident_bytes(), actual_resident(&c));
    assert_eq!(c.metrics().evictions, 1);
    // Five more inserts keep it pinned to budget (never exceed).
    for i in 4..9 {
        c.insert(i, vec![i as u8; 100]);
        assert!(
            c.resident_bytes() <= 300,
            "residency {} > budget",
            c.resident_bytes()
        );
    }
}

#[test]
fn clock_gives_a_referenced_chunk_a_second_chance() {
    // 3 slots. Insert 0,1,2 (all start referenced).
    let mut c = BlockCache::new(300);
    for i in 0..3 {
        c.insert(i, vec![i as u8; 100]);
    }
    // Insert 3 → a full sweep clears every ref bit then evicts chunk 0 (the hand's first). Now 1 and 2
    // have ref=0; 3 is referenced.
    c.insert(3, vec![3; 100]);
    assert!(!c.contains(0));
    // Touch chunk 1 → its ref bit is set again.
    assert_eq!(c.lookup(1), Some(&[1u8; 100][..]));
    // Insert 4 → the hand clears chunk 1's ref (second chance — it survives) and evicts chunk 2 (ref 0).
    c.insert(4, vec![4; 100]);
    assert!(c.contains(1), "referenced chunk survived eviction");
    assert!(!c.contains(2), "unreferenced chunk was evicted");
    assert!(c.contains(3) && c.contains(4));
}

#[test]
fn pinned_chunks_never_evicted_even_over_budget() {
    let mut c = BlockCache::new(300);
    c.insert(7, vec![0xAB; 100]);
    c.pin(7); // an in-flight guest read holds chunk 7
    // Flood the cache well past budget; chunk 7 must remain, with intact bytes.
    for i in 100..120 {
        c.insert(i, vec![i as u8; 100]);
    }
    assert!(c.contains(7), "pinned chunk must survive pressure");
    assert_eq!(c.lookup(7), Some(&[0xAB; 100][..]), "pinned bytes intact");
    // Unpin, then more pressure evicts it like any other entry.
    c.unpin(7);
    for i in 200..230 {
        c.insert(i, vec![i as u8; 100]);
    }
    assert!(!c.contains(7), "after unpin it is evictable again");
}

#[test]
fn all_pinned_allows_bounded_overshoot() {
    // If every entry is pinned, an insert cannot evict — residency exceeds budget rather than corrupt
    // an in-flight read. Bounded by the pinned set (one pin per concurrently-awaited chunk).
    let mut c = BlockCache::new(150); // 1.5 slots
    c.insert(0, vec![0; 100]);
    c.pin(0);
    c.insert(1, vec![1; 100]);
    c.pin(1);
    assert!(c.contains(0) && c.contains(1));
    assert_eq!(
        c.resident_bytes(),
        200,
        "over budget, but no pinned chunk evicted"
    );
}

#[test]
fn single_chunk_larger_than_budget_is_admitted() {
    // The cache must be able to serve any one chunk, even one bigger than the whole budget.
    let mut c = BlockCache::new(50);
    c.insert(0, vec![9; 100]);
    assert_eq!(c.lookup(0), Some(&[9u8; 100][..]));
    assert_eq!(c.resident_bytes(), 100); // documented single-chunk overshoot
    // The next insert evicts the oversized chunk back down.
    c.insert(1, vec![1; 40]);
    assert_eq!(c.resident_bytes(), 40);
    assert!(!c.contains(0));
}

#[test]
fn metrics_track_hits_misses_and_replace_in_place() {
    let mut c = BlockCache::new(300);
    c.insert(0, vec![0; 100]);
    assert_eq!(c.lookup(0), Some(&[0u8; 100][..])); // hit
    assert_eq!(c.lookup(1), None); // miss
    assert_eq!(c.lookup(0), Some(&[0u8; 100][..])); // hit
    let m = c.metrics();
    assert_eq!((m.hits, m.misses, m.inserts), (2, 1, 1));
    // Replace-in-place updates bytes + accounting without a new ring slot.
    c.insert(0, vec![7; 120]);
    assert_eq!(c.lookup(0), Some(&[7u8; 120][..]));
    assert_eq!(c.resident_bytes(), 120);
    assert_eq!(c.resident_bytes(), actual_resident(&c));
    assert_eq!(c.metrics().inserts, 1, "replace is not a new insert");
}

#[test]
fn growing_replace_still_honours_the_budget() {
    // Critic F1: replacing a chunk with a LARGER blob must evict others to stay within budget, not
    // overshoot silently. (Same-size replace is the norm; this guards the growing edge.)
    let mut c = BlockCache::new(300);
    for i in 0..3 {
        c.insert(i, vec![i as u8; 100]); // at budget: 3×100
    }
    // Grow chunk 0 to 250 B → evicts the two others to fit; the replaced chunk is never self-evicted.
    c.insert(0, vec![9; 250]);
    assert!(
        c.contains(0),
        "the just-written chunk survives its own budget sweep"
    );
    assert_eq!(c.lookup(0), Some(&[9u8; 250][..]), "correct grown bytes");
    assert!(
        c.resident_bytes() <= 300,
        "residency {} within budget",
        c.resident_bytes()
    );
    assert_eq!(c.resident_bytes(), actual_resident(&c));
    // A growing replace past the whole budget falls back to the documented single-oversized overshoot.
    let mut c2 = BlockCache::new(300);
    c2.insert(0, vec![0; 100]);
    c2.insert(0, vec![1; 5000]);
    assert_eq!(c2.resident_bytes(), 5000); // only the oversized chunk; still accounted exactly
    assert_eq!(c2.resident_bytes(), actual_resident(&c2));
}

#[test]
fn chunk_source_impl_reads_current_bytes() {
    let mut c = BlockCache::new(300);
    c.insert(5, vec![0x55; 64]);
    // Via the ChunkSource trait (how ChunkedBackend reads it).
    assert_eq!(ChunkSource::get(&c, 5), Some(&[0x55u8; 64][..]));
    assert_eq!(ChunkSource::get(&c, 6), None);
}

// ── proptest: read-correctness + accounting under random op traces ──────────────────────────────
use proptest::prelude::*;

#[derive(Debug, Clone)]
enum Op {
    Insert(usize, u8, usize), // chunk, fill byte, len
    Lookup(usize),
    Pin(usize),
    Unpin(usize),
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        (0usize..8, any::<u8>(), 1usize..64).prop_map(|(c, b, l)| Op::Insert(c, b, l)),
        (0usize..8).prop_map(Op::Lookup),
        (0usize..8).prop_map(Op::Pin),
        (0usize..8).prop_map(Op::Unpin),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]
    #[test]
    fn random_trace_never_serves_wrong_bytes_and_accounting_holds(
        budget in 32u64..256,
        ops in prop::collection::vec(op_strategy(), 0..400),
    ) {
        let mut cache = BlockCache::new(budget);
        // Reference model: the last bytes inserted for each chunk (regardless of eviction).
        let mut model: alloc::collections::BTreeMap<usize, alloc::vec::Vec<u8>> = Default::default();
        let mut pinned: alloc::collections::BTreeMap<usize, u32> = Default::default();
        for op in ops {
            match op {
                Op::Insert(c, b, l) => {
                    let bytes = alloc::vec![b; l];
                    model.insert(c, bytes.clone());
                    cache.insert(c, bytes);
                }
                Op::Lookup(c) => {
                    // Read-correctness: a resident chunk must return EXACTLY its last-inserted bytes.
                    if let Some(got) = cache.lookup(c) {
                        prop_assert_eq!(got, model.get(&c).unwrap().as_slice());
                    }
                }
                Op::Pin(c) => { cache.pin(c); *pinned.entry(c).or_insert(0) += 1; }
                Op::Unpin(c) => { cache.unpin(c); if let Some(p) = pinned.get_mut(&c) { *p = p.saturating_sub(1); } }
            }
            // Accounting: the tracked total always equals the real sum of resident bytes.
            prop_assert_eq!(cache.resident_bytes(), actual_resident(&cache));
        }
    }
}
