//! A bounded, `no_std` hot-PC histogram (E4-T01).
//!
//! Answers "where is the guest spending its instructions?" in FIXED memory, regardless of how
//! large the guest is. A full per-PC map of a multi-GiB guest is unbounded, so instead of a
//! `HashMap` (banned — allocation + non-determinism) this is a direct-mapped tag table over
//! 64-byte PC *regions*: a power-of-two slot array, each slot holding the region it currently owns
//! and a count. Aliasing (two hot regions hashing to one slot) is made VISIBLE via a `collisions`
//! counter and a small-incumbent eviction policy — never silently merged into a wrong PC.
//!
//! # Memory bound
//! [`SIZE`] slots × `size_of::<Slot>()` (8-byte tag + 4-byte count, 16 bytes with alignment
//! padding) = ~128 KiB, plus counters. This is the WHOLE cost — a 4 KiB guest and a 4 GiB guest
//! pay the identical fixed footprint. (~96–128 KiB depending on `Slot` layout.)

use alloc::vec::Vec;

/// A physical PC is bucketed into a 64-byte region: `region = pc >> REGION_SHIFT`. 64 bytes is a
/// cache-line-ish granularity — coarse enough that a tight loop's handful of instructions land in
/// one or two regions (so hotness concentrates), fine enough to name a specific code path.
pub const REGION_SHIFT: u32 = 6;

/// Number of direct-mapped slots. Power of two so the hash reduction is a shift, and sized so a
/// realistic hot working set (a few thousand distinct regions) fits with few collisions.
pub const SIZE: usize = 8192;

/// `log2(SIZE)` — the number of top hash bits used as the slot index.
const LOG2_SIZE: u32 = 13; // 2^13 == 8192
const _: () = assert!(1usize << LOG2_SIZE == SIZE, "LOG2_SIZE must match SIZE");

/// Fibonacci-hashing multiplier (2^64 / golden ratio). Multiplying the region by this and taking
/// the TOP `LOG2_SIZE` bits scatters sequential regions (a straight-line run of PCs) across the
/// table far better than the low bits alone would, so adjacent code doesn't collide in a clump.
const GOLDEN64: u64 = 0x9E3779B97F4A7C15;

/// Incumbent count at or below which a colliding newcomer EVICTS the incumbent rather than being
/// dropped. Keeps the table biased toward genuinely hot regions: a one-off region squatting on a
/// slot is displaced by the next arrival, but an established hot region (count > threshold) holds
/// its slot and the newcomer is instead recorded as a collision.
const EVICT_THRESHOLD: u32 = 2;

/// One direct-mapped bucket. `count == 0` marks the slot empty (no valid `tag`).
#[derive(Clone, Copy)]
struct Slot {
    /// The region id (`pc >> REGION_SHIFT`) this slot currently owns; meaningless when empty.
    tag: u64,
    /// Samples attributed to `tag`. Zero ⇒ empty.
    count: u32,
}

/// The fixed-size hot-PC histogram. See the module docs for the memory bound.
pub struct HotHistogram {
    slots: Vec<Slot>,
    /// Total [`record`](Self::record) calls (the denominator for percentages).
    samples: u64,
    /// Records that hit an occupied slot owned by a DIFFERENT, above-threshold region — i.e. real
    /// aliasing we refused to misattribute. Non-zero means the table is under-sized for the
    /// working set and the top list may be missing a hot region (aliasing is VISIBLE, not silent).
    collisions: u64,
}

impl Default for HotHistogram {
    fn default() -> Self {
        Self::new()
    }
}

impl HotHistogram {
    /// A fresh, empty histogram with all [`SIZE`] slots allocated (fixed footprint up front).
    pub fn new() -> Self {
        Self {
            slots: alloc::vec![Slot { tag: 0, count: 0 }; SIZE],
            samples: 0,
            collisions: 0,
        }
    }

    /// The slot index for a region: Fibonacci hash, keep the top `LOG2_SIZE` bits.
    #[inline]
    fn index_of(region: u64) -> usize {
        (region.wrapping_mul(GOLDEN64) >> (64 - LOG2_SIZE)) as usize
    }

    /// Record one sample at physical PC `phys_pc`. Buckets to the 64-byte region, then:
    /// - **tag match** → increment (saturating);
    /// - **empty slot** → claim it for this region (count 1);
    /// - **collision** (occupied by a different region): if the incumbent is weak
    ///   (`count <= EVICT_THRESHOLD`) evict + replace it; otherwise leave the hot incumbent alone
    ///   and bump the global `collisions` counter so the aliasing is observable.
    #[inline]
    pub fn record(&mut self, phys_pc: u64) {
        self.samples += 1;
        let region = phys_pc >> REGION_SHIFT;
        let idx = Self::index_of(region);
        let slot = &mut self.slots[idx];
        if slot.count == 0 {
            // Empty → claim.
            slot.tag = region;
            slot.count = 1;
        } else if slot.tag == region {
            // Ours → count it (saturate rather than wrap: a pinned-hot region never rolls to 0).
            slot.count = slot.count.saturating_add(1);
        } else if slot.count <= EVICT_THRESHOLD {
            // A weak squatter loses the slot to the newcomer (bias the table toward hot regions).
            slot.tag = region;
            slot.count = 1;
        } else {
            // A genuinely hot incumbent holds the slot; the newcomer is aliased away — record it so
            // the miss is visible instead of being folded into the wrong region's count.
            self.collisions += 1;
        }
    }

    /// The `k` hottest regions as `(region_base_phys_pc, count)`, sorted by count descending;
    /// ties break on the LOWER pc first (a stable, deterministic order). `region_base_phys_pc` is
    /// `region << REGION_SHIFT` — the first byte of the 64-byte region. Allocates (the only method
    /// that does); intended for report assembly, not the hot path.
    pub fn top(&self, k: usize) -> Vec<(u64, u32)> {
        let mut live: Vec<(u64, u32)> = self
            .slots
            .iter()
            .filter(|s| s.count > 0)
            .map(|s| (s.tag << REGION_SHIFT, s.count))
            .collect();
        // Descending by count; ties → lower pc first. `sort_by` is stable, but the explicit pc tie
        // break makes the order total (independent of the slot scan order above).
        live.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        live.truncate(k);
        live
    }

    /// Total samples recorded (the percentage denominator).
    pub fn samples(&self) -> u64 {
        self.samples
    }

    /// Count of aliased records refused to a hot incumbent (see [`record`](Self::record)). Non-zero
    /// ⇒ the table is under-sized for the working set; the top list may omit a hot region.
    pub fn collisions(&self) -> u64 {
        self.collisions
    }
}
