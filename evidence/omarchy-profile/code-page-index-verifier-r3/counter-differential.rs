extern crate alloc;
mod baseline { use alloc::collections::{BTreeMap,BTreeSet}; const PAGE:u64=4096; #[derive(Debug,Clone)]pub struct MicroOp;
#[derive(Debug, Clone)]
pub struct DecodedBlock {
    /// Physical address of the entry instruction — the cache key.
    pub phys_start: u64,
    /// The predecoded ops, in program order (`<= 128`).
    pub ops: alloc::vec::Vec<MicroOp>,
    /// Sum of the ops' guest lengths (bytes covered by the block).
    pub total_len: u64,
    /// `phys_start >> 12`; every op in the block lives in this physical page.
    pub page_frame: u64,
    /// Generation this block was built in; a mismatch with the cache generation means the
    /// block was logically flushed and must be ignored (an O(1) whole-cache invalidation).
    block_gen: u64,
}

impl DecodedBlock {
    /// Build a block from its walked ops. `block_gen` is set to 0 and stamped with the live
    /// generation on [`BlockCache::insert`]. Debug-asserts the invariants: at least one op, at
    /// most [`MAX_BLOCK_OPS`], and every op inside `phys_start`'s physical page.
    pub fn new(phys_start: u64, ops: alloc::vec::Vec<MicroOp>, total_len: u64) -> Self {
        debug_assert!(!ops.is_empty() && ops.len() <= MAX_BLOCK_OPS);
        debug_assert!(
            total_len <= PAGE,
            "a single-page block cannot cover more than one page of bytes"
        );
        Self {
            phys_start,
            ops,
            total_len,
            page_frame: phys_start >> 12,
            block_gen: 0,
        }
    }
}

/// Max ops in a block (also the interrupt-latency bound target in Phase C).
pub const MAX_BLOCK_OPS: usize = 128;

/// Probe length for the open-addressed table. A miss only costs a rebuild (always correct),
/// so a short bounded probe keeps lookup O(1) with a simple replace-on-full policy.
const MAX_PROBE: usize = 8;

/// Open-addressed, physically-keyed block cache with O(1) whole-cache flush.
///
/// Flush is a generation bump: a stored block whose `gen` differs from `generation` is
/// invisible (treated as an empty slot for probing) and will be overwritten on the next
/// insert. Correctness never depends on a hit — any lookup may miss and rebuild.
pub struct BlockCache {
    slots: alloc::vec::Vec<Option<DecodedBlock>>,
    mask: usize,
    generation: u64,
    /// E4-T05 Phase B: the page-level "has-code" set (the E4-T17 SMC precursor). Every physical
    /// page frame that has ever held ≥1 inserted block in the CURRENT generation. A store (guest
    /// OR device/DMA) whose frame is NOT in this set cannot have hit cached code, so it needs no
    /// scan — this is what lets the cache RETAIN blocks across ordinary data stores instead of the
    /// Phase-A whole-cache flush. Cleared on a full `flush` (all blocks become invisible anyway);
    /// stale membership is only ever a wasted scan (conservative-safe), never a missed flush.
    has_code: BTreeSet<u64>,
    /// E4-T16 invalidation-event stats: whole-cache flushes performed (`fence.i` / reset /
    /// snapshot-restore / toggle — the QEMU `tb_flush` analog).
    flushes: u64,
    /// E4-T16 invalidation-event stats: live blocks dropped by page-granular invalidation
    /// (`flush_page`, i.e. self-modifying code / DMA-into-code). SFENCE.VMA is deliberately
    /// ABSENT here — a virtual remap never discards a physically-keyed block (the phys-keying
    /// argument this ticket proves by test), so this counter staying flat across an SFENCE.VMA
    /// storm is itself the "SFENCE.VMA didn't nuke the translation cache" evidence.
    blocks_discarded: u64,
    /// E4-T17 invalidation-event stats: `fence.i` instructions retired while the page bitmap is
    /// authoritative. `fence.i` is now NEAR-FREE — a no-op-plus-this-counter — because every
    /// code-writing store (guest / DMA / host) has ALREADY invalidated its physical page eagerly at
    /// store time (the `has_code` bitmap → `flush_page` path), so by the time a `fence.i` retires the
    /// I-fetch stream is already coherent and there is nothing left to flush. Un-dirtied pages' blocks
    /// therefore SURVIVE a `fence.i` (the E4-T16 whole-cache flush no longer fires). A rising value
    /// with a FLAT `flushes` across a `fence.i`-heavy workload is the "fence.i is near-free" evidence.
    fence_i_noops: u64,
}

impl BlockCache {
    /// Actual slot count, including rounding by the unrestricted test resize path.
    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    /// A cache with `capacity` slots (rounded up to a power of two, min 1). `capacity == 1`
    /// is the adversarial pathological-eviction mode.
    pub fn with_capacity(capacity: usize) -> Self {
        let cap = capacity.max(1).next_power_of_two();
        let mut slots = alloc::vec::Vec::with_capacity(cap);
        slots.resize_with(cap, || None);
        Self {
            slots,
            mask: cap - 1,
            generation: 1,
            has_code: BTreeSet::new(),
            flushes: 0,
            blocks_discarded: 0,
            fence_i_noops: 0,
        }
    }

    /// E4-T17: record a NEAR-FREE `fence.i` — the page bitmap already made the fetch stream coherent
    /// at store time, so `fence.i` drops NO blocks and only bumps this counter. See `fence_i_noops`.
    pub fn note_fence_i(&mut self) {
        self.fence_i_noops = self.fence_i_noops.saturating_add(1);
    }

    /// E4-T17: number of near-free `fence.i` events retired (no whole-cache flush performed).
    pub fn fence_i_noops(&self) -> u64 {
        self.fence_i_noops
    }

    /// E4-T16 invalidation-event stats: `(whole_cache_flushes, blocks_discarded_by_page_flush)`.
    /// Surfaced through [`DiscoveryStats`] in the profiling report so the adversarial "SFENCE.VMA
    /// must NOT nuke the translation cache" check can assert `blocks_discarded` stays flat across a
    /// remap storm.
    pub fn invalidation_stats(&self) -> (u64, u64) {
        (self.flushes, self.blocks_discarded)
    }

    /// Invalidate the entire cache in O(1) (generation bump). Every block built in an older
    /// generation becomes invisible. The has-code set is cleared too: every frame's blocks are
    /// now invisible, so no frame "has code" until the next insert re-populates it.
    pub fn flush(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.has_code.clear();
        self.flushes = self.flushes.saturating_add(1);
    }

    /// E4-T05 Phase B: page-granular invalidation. Drop every live block whose `page_frame` ==
    /// `frame` (self-modifying code / DMA-into-code precursor). Returns `true` iff `frame` was a
    /// code page (had ≥1 cached block) — the caller uses that to decide whether an in-flight block
    /// cursor may now be stale. A frame with no cached code is an O(1) set-miss: the common case
    /// for an ordinary data store, so the cache is retained. When `frame` DID have code, the slot
    /// table is scanned once (O(capacity)) and matching blocks are dropped — including any stale
    /// (older-generation) leftovers in that frame, which is harmless cleanup.
    pub fn flush_page(&mut self, frame: u64) -> bool {
        if !self.has_code.remove(&frame) {
            return false;
        }
        for slot in self.slots.iter_mut() {
            if slot.as_ref().is_some_and(|b| b.page_frame == frame) {
                *slot = None;
                self.blocks_discarded = self.blocks_discarded.saturating_add(1);
            }
        }
        true
    }

    #[inline]
    fn hash(&self, phys: u64) -> usize {
        // Fibonacci-ish mix of the physical PC; low bits are always 0/2-aligned so fold the
        // whole address. Cheap and adequate for a bounded-probe table.
        let h = phys.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        ((h >> 32) as usize) & self.mask
    }

    /// Look up a live block whose entry is `phys_start`. Returns `None` on a miss (including
    /// a stale-generation slot), so the caller rebuilds.
    pub fn get(&self, phys_start: u64) -> Option<&DecodedBlock> {
        let start = self.hash(phys_start);
        for i in 0..MAX_PROBE {
            let idx = (start + i) & self.mask;
            match &self.slots[idx] {
                Some(b) if b.block_gen == self.generation && b.phys_start == phys_start => {
                    return Some(b);
                }
                // A live block for a different key: keep probing. A `None` or stale-gen slot
                // is a genuine empty — the key was never inserted on this chain, so stop.
                Some(b) if b.block_gen == self.generation => continue,
                _ => return None,
            }
        }
        None
    }

    /// Iterate the blocks that belong to the current cache generation. This is intentionally a
    /// read-only view for boundary audits such as the PMP privilege-transition check; callers must
    /// not infer that a missing block is an architectural failure because a cache miss is always a
    /// legal rebuild.
    pub(crate) fn live_blocks(&self) -> impl Iterator<Item = &DecodedBlock> {
        self.slots.iter().filter_map(|slot| match slot {
            Some(block) if block.block_gen == self.generation => Some(block),
            _ => None,
        })
    }

    /// Insert `block` (stamped with the current generation), replacing a stale/empty slot on
    /// its probe chain, or — if the chain is full of live entries — the head slot (simple
    /// replacement; correctness is unaffected).
    pub fn insert(&mut self, mut block: DecodedBlock) {
        block.block_gen = self.generation;
        // Record the block's physical page as "has code" so a later store into it is caught by
        // `flush_page` (Phase-B page-granular SMC/DMA invalidation).
        self.has_code.insert(block.page_frame);
        let start = self.hash(block.phys_start);
        for i in 0..MAX_PROBE {
            let idx = (start + i) & self.mask;
            let free = match &self.slots[idx] {
                None => true,
                Some(b) => b.block_gen != self.generation || b.phys_start == block.phys_start,
            };
            if free {
                self.slots[idx] = Some(block);
                return;
            }
        }
        self.slots[start] = Some(block);
    }
}


}
mod candidate { use alloc::collections::{BTreeMap,BTreeSet}; const PAGE:u64=4096; #[derive(Debug,Clone)]pub struct MicroOp;
#[derive(Debug, Clone)]
pub struct DecodedBlock {
    /// Physical address of the entry instruction — the cache key.
    pub phys_start: u64,
    /// The predecoded ops, in program order (`<= 128`).
    pub ops: alloc::vec::Vec<MicroOp>,
    /// Sum of the ops' guest lengths (bytes covered by the block).
    pub total_len: u64,
    /// `phys_start >> 12`; every op in the block lives in this physical page.
    pub page_frame: u64,
    /// Generation this block was built in; a mismatch with the cache generation means the
    /// block was logically flushed and must be ignored (an O(1) whole-cache invalidation).
    block_gen: u64,
}

impl DecodedBlock {
    /// Build a block from its walked ops. `block_gen` is set to 0 and stamped with the live
    /// generation on [`BlockCache::insert`]. Debug-asserts the invariants: at least one op, at
    /// most [`MAX_BLOCK_OPS`], and every op inside `phys_start`'s physical page.
    pub fn new(phys_start: u64, ops: alloc::vec::Vec<MicroOp>, total_len: u64) -> Self {
        debug_assert!(!ops.is_empty() && ops.len() <= MAX_BLOCK_OPS);
        debug_assert!(
            total_len <= PAGE,
            "a single-page block cannot cover more than one page of bytes"
        );
        Self {
            phys_start,
            ops,
            total_len,
            page_frame: phys_start >> 12,
            block_gen: 0,
        }
    }
}

/// Max ops in a block (also the interrupt-latency bound target in Phase C).
pub const MAX_BLOCK_OPS: usize = 128;

/// Probe length for the open-addressed table. A miss only costs a rebuild (always correct),
/// so a short bounded probe keeps lookup O(1) with a simple replace-on-full policy.
const MAX_PROBE: usize = 8;

/// Physical cache slots owned by one code page.
///
/// The indices remain associated with the page across whole-cache generation bumps. The legacy
/// page scan counted stale physical slots too, so retaining ownership here preserves the public
/// discard counter without bringing back an O(capacity) scan.
#[derive(Debug, Default)]
struct CodePageSlots {
    generation: u64,
    slots: Vec<usize>,
}

/// Open-addressed, physically-keyed block cache with O(1) whole-cache flush.
///
/// Flush is a generation bump: a stored block whose `gen` differs from `generation` is
/// invisible (treated as an empty slot for probing) and will be overwritten on the next
/// insert. Correctness never depends on a hit — any lookup may miss and rebuild.
pub struct BlockCache {
    slots: alloc::vec::Vec<Option<DecodedBlock>>,
    mask: usize,
    generation: u64,
    /// E5.5-T03ba: decoded-cache slots grouped by physical page. A store (guest OR device/DMA)
    /// whose frame is absent is an O(log n) map miss; a code-page store touches only the indexed
    /// slots instead of scanning the whole open-addressed table. Slot indices remain associated
    /// with their page across generation bumps so page-flush accounting stays identical to the
    /// legacy full-table scan, including stale physical slots.
    code_slots: BTreeMap<u64, CodePageSlots>,
    /// E4-T16 invalidation-event stats: whole-cache flushes performed (`fence.i` / reset /
    /// snapshot-restore / toggle — the QEMU `tb_flush` analog).
    flushes: u64,
    /// E4-T16 invalidation-event stats: live blocks dropped by page-granular invalidation
    /// (`flush_page`, i.e. self-modifying code / DMA-into-code). SFENCE.VMA is deliberately
    /// ABSENT here — a virtual remap never discards a physically-keyed block (the phys-keying
    /// argument this ticket proves by test), so this counter staying flat across an SFENCE.VMA
    /// storm is itself the "SFENCE.VMA didn't nuke the translation cache" evidence.
    blocks_discarded: u64,
    /// E4-T17 invalidation-event stats: `fence.i` instructions retired while the page bitmap is
    /// authoritative. `fence.i` is now NEAR-FREE — a no-op-plus-this-counter — because every
    /// code-writing store (guest / DMA / host) has ALREADY invalidated its physical page eagerly at
    /// store time (the `has_code` bitmap → `flush_page` path), so by the time a `fence.i` retires the
    /// I-fetch stream is already coherent and there is nothing left to flush. Un-dirtied pages' blocks
    /// therefore SURVIVE a `fence.i` (the E4-T16 whole-cache flush no longer fires). A rising value
    /// with a FLAT `flushes` across a `fence.i`-heavy workload is the "fence.i is near-free" evidence.
    fence_i_noops: u64,
}

impl BlockCache {
    /// Actual slot count, including rounding by the unrestricted test resize path.
    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    /// A cache with `capacity` slots (rounded up to a power of two, min 1). `capacity == 1`
    /// is the adversarial pathological-eviction mode.
    pub fn with_capacity(capacity: usize) -> Self {
        let cap = capacity.max(1).next_power_of_two();
        let mut slots = alloc::vec::Vec::with_capacity(cap);
        slots.resize_with(cap, || None);
        Self {
            slots,
            mask: cap - 1,
            generation: 1,
            code_slots: BTreeMap::new(),
            flushes: 0,
            blocks_discarded: 0,
            fence_i_noops: 0,
        }
    }

    /// E4-T17: record a NEAR-FREE `fence.i` — the page bitmap already made the fetch stream coherent
    /// at store time, so `fence.i` drops NO blocks and only bumps this counter. See `fence_i_noops`.
    pub fn note_fence_i(&mut self) {
        self.fence_i_noops = self.fence_i_noops.saturating_add(1);
    }

    /// E4-T17: number of near-free `fence.i` events retired (no whole-cache flush performed).
    pub fn fence_i_noops(&self) -> u64 {
        self.fence_i_noops
    }

    /// E4-T16 invalidation-event stats: `(whole_cache_flushes, blocks_discarded_by_page_flush)`.
    /// Surfaced through [`DiscoveryStats`] in the profiling report so the adversarial "SFENCE.VMA
    /// must NOT nuke the translation cache" check can assert `blocks_discarded` stays flat across a
    /// remap storm.
    pub fn invalidation_stats(&self) -> (u64, u64) {
        (self.flushes, self.blocks_discarded)
    }

    /// Invalidate the entire cache in O(1) (generation bump). Every block built in an older
    /// generation becomes invisible. The page index remains in place with its old generation and
    /// slot ownership; a later insertion can reactivate that page without losing stale slots that
    /// the legacy page scan would still count.
    pub fn flush(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.flushes = self.flushes.saturating_add(1);
    }

    /// E4-T05 Phase B / E5.5-T03ba: page-granular invalidation. Drop every live block whose
    /// `page_frame` == `frame` (self-modifying code / DMA-into-code precursor). Returns `true` iff
    /// `frame` was a code page (had ≥1 indexed cached block) — the caller uses that to decide
    /// whether an in-flight block cursor may now be stale. A frame with no cached code is a map
    /// miss: the common case for an ordinary data store, so the cache is retained. A hit removes
    /// only the slots recorded for that page; it never scans unrelated cache entries.
    pub fn flush_page(&mut self, frame: u64) -> bool {
        let indices = {
            let Some(page) = self.code_slots.get_mut(&frame) else {
                return false;
            };
            if page.generation != self.generation {
                return false;
            }
            core::mem::take(&mut page.slots)
        };
        self.code_slots.remove(&frame);
        for index in indices {
            if self
                .slots
                .get(index)
                .and_then(Option::as_ref)
                .is_some_and(|b| b.page_frame == frame)
            {
                self.slots[index] = None;
                self.blocks_discarded = self.blocks_discarded.saturating_add(1);
            }
        }
        true
    }

    /// Remove one indexed slot before replacing it. Retain the page entry even when its slot list
    /// becomes empty: the legacy `has_code` membership stayed live until `flush_page`, and callers
    /// use that membership to decide whether a page invalidation occurred.
    fn unlink_code_slot(&mut self, index: usize) {
        let Some(block) = self.slots[index].as_ref() else {
            return;
        };
        let frame = block.page_frame;
        if let Some(page) = self.code_slots.get_mut(&frame)
            && let Some(position) = page.slots.iter().position(|&candidate| candidate == index)
        {
            page.slots.swap_remove(position);
        }
    }

    #[inline]
    fn hash(&self, phys: u64) -> usize {
        // Fibonacci-ish mix of the physical PC; low bits are always 0/2-aligned so fold the
        // whole address. Cheap and adequate for a bounded-probe table.
        let h = phys.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        ((h >> 32) as usize) & self.mask
    }

    /// Look up a live block whose entry is `phys_start`. Returns `None` on a miss (including
    /// a stale-generation slot), so the caller rebuilds.
    pub fn get(&self, phys_start: u64) -> Option<&DecodedBlock> {
        let start = self.hash(phys_start);
        for i in 0..MAX_PROBE {
            let idx = (start + i) & self.mask;
            match &self.slots[idx] {
                Some(b) if b.block_gen == self.generation && b.phys_start == phys_start => {
                    return Some(b);
                }
                // A live block for a different key: keep probing. A `None` or stale-gen slot
                // is a genuine empty — the key was never inserted on this chain, so stop.
                Some(b) if b.block_gen == self.generation => continue,
                _ => return None,
            }
        }
        None
    }

    /// Iterate the blocks that belong to the current cache generation. This is intentionally a
    /// read-only view for boundary audits such as the PMP privilege-transition check; callers must
    /// not infer that a missing block is an architectural failure because a cache miss is always a
    /// legal rebuild.
    pub(crate) fn live_blocks(&self) -> impl Iterator<Item = &DecodedBlock> {
        self.slots.iter().filter_map(|slot| match slot {
            Some(block) if block.block_gen == self.generation => Some(block),
            _ => None,
        })
    }

    /// Insert `block` (stamped with the current generation), replacing a stale/empty slot on
    /// its probe chain, or — if the chain is full of live entries — the head slot (simple
    /// replacement; correctness is unaffected).
    pub fn insert(&mut self, mut block: DecodedBlock) {
        block.block_gen = self.generation;
        let start = self.hash(block.phys_start);
        let index = (0..MAX_PROBE)
            .find_map(|i| {
                let idx = (start + i) & self.mask;
                let free = match &self.slots[idx] {
                    None => true,
                    Some(b) => b.block_gen != self.generation || b.phys_start == block.phys_start,
                };
                if free { Some(idx) } else { None }
            })
            .unwrap_or(start);
        self.unlink_code_slot(index);
        self.slots[index] = Some(block);
        let page_frame = self.slots[index]
            .as_ref()
            .expect("inserted block")
            .page_frame;
        let generation = self.generation;
        let page = self
            .code_slots
            .entry(page_frame)
            .or_insert_with(|| CodePageSlots {
                generation,
                slots: Vec::new(),
            });
        page.generation = generation;
        page.slots.push(index);
    }
}


}
fn main(){
 for capacity in [1,2,8,64,16384] {for seed in [0x129u64,0x71ec,0x5eed] {
 let(mut old,mut new)=(baseline::BlockCache::with_capacity(capacity),candidate::BlockCache::with_capacity(capacity));
 let mut state=seed;let mut history=alloc::vec::Vec::new();
 for step in 0..100000 {state=state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
 let addr=0x80000000+((state>>24)%13)*4096+((state>>32)%128)*2;
 match state%17 {0=>{old.flush();new.flush();history.push(format!("flush()"));},1|2|3|4=>{let x=old.flush_page(addr>>12);let y=new.flush_page(addr>>12);assert_eq!(x,y,"page membership diverged");history.push(format!("flush_page({:#x}) returns {:?}/{:?}",addr>>12,x,y));},_=>{old.insert(baseline::DecodedBlock::new(addr,alloc::vec![baseline::MicroOp],2));new.insert(candidate::DecodedBlock::new(addr,alloc::vec![candidate::MicroOp],2));history.push(format!("insert({:#x})",addr));}}
 if old.invalidation_stats()!=new.invalidation_stats(){println!("FAILED cap={capacity} seed={seed} step={step} baseline={:?} candidate={:?}",old.invalidation_stats(),new.invalidation_stats());for(i,op)in history.iter().enumerate(){println!("{i}: {op}");}std::process::exit(1);}
 }
 println!("HELD counter differential cap={capacity} seed={seed} operations=100000");}}
}
