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

/// Open-addressed, physically-keyed block cache with O(1) whole-cache flush.
///
/// Flush is a generation bump: a stored block whose `gen` differs from `generation` is
/// invisible (treated as an empty slot for probing) and will be overwritten on the next
/// insert. Correctness never depends on a hit — any lookup may miss and rebuild.
pub struct BlockCache {
    slots: alloc::vec::Vec<Option<DecodedBlock>>,
    mask: usize,
    generation: u64,
    /// E5.5-T03ba: live decoded-cache slots grouped by physical page. A store (guest OR
    /// device/DMA) whose frame is absent is an O(log n) map miss; a code-page store touches only
    /// the indexed slots instead of scanning the whole open-addressed table. The index is rebuilt
    /// incrementally on insert. Historical slots are counted separately so a later active-page
    /// flush preserves the pre-index `blocks_discarded` accounting without a capacity scan.
    code_slots: BTreeMap<u64, Vec<usize>>,
    /// Slots made stale by a whole-cache generation flush, grouped by physical page. These blocks
    /// are already invisible to lookup; the counts preserve the old page-flush counter behavior
    /// when a page is repopulated in a later generation.
    stale_code_counts: BTreeMap<u64, u64>,
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
            stale_code_counts: BTreeMap::new(),
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
    /// generation becomes invisible. Current page-index entries become stale counts: every frame
    /// remains a map miss until a new current-generation block repopulates it, while a later active
    /// page flush still preserves the old discarded-block accounting.
    pub fn flush(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        let code_slots = core::mem::take(&mut self.code_slots);
        for (frame, indices) in code_slots {
            let count = indices.len() as u64;
            self.stale_code_counts
                .entry(frame)
                .and_modify(|existing| *existing = existing.saturating_add(count))
                .or_insert(count);
        }
        self.flushes = self.flushes.saturating_add(1);
    }

    /// E4-T05 Phase B / E5.5-T03ba: page-granular invalidation. Drop every live block whose
    /// `page_frame` == `frame` (self-modifying code / DMA-into-code precursor). Returns `true` iff
    /// `frame` was a code page (had ≥1 indexed cached block) — the caller uses that to decide
    /// whether an in-flight block cursor may now be stale. A frame with no cached code is a map
    /// miss: the common case for an ordinary data store, so the cache is retained. A hit removes
    /// only the slots recorded for that page; it never scans unrelated cache entries.
    pub fn flush_page(&mut self, frame: u64) -> bool {
        let Some(indices) = self.code_slots.remove(&frame) else {
            return false;
        };
        let stale_count = self.stale_code_counts.remove(&frame).unwrap_or_default();
        let mut discarded = stale_count;
        for index in indices {
            if self.slots[index]
                .as_ref()
                .is_some_and(|b| b.block_gen == self.generation && b.page_frame == frame)
            {
                self.slots[index] = None;
                discarded = discarded.saturating_add(1);
            }
        }
        self.blocks_discarded = self.blocks_discarded.saturating_add(discarded);
        true
    }

    /// Remove one indexed slot before replacing it. A stale-generation replacement decrements the
    /// historical page count because the old implementation would no longer count that slot on a
    /// later page flush either.
    fn unlink_code_slot(&mut self, index: usize) {
        let Some(block) = self.slots[index].as_ref() else {
            return;
        };
        let frame = block.page_frame;
        if block.block_gen == self.generation {
            let mut empty = false;
            if let Some(indices) = self.code_slots.get_mut(&frame) {
                if let Some(position) = indices.iter().position(|&candidate| candidate == index) {
                    indices.swap_remove(position);
                }
                empty = indices.is_empty();
            }
            if empty {
                self.code_slots.remove(&frame);
            }
        } else if let Some(count) = self.stale_code_counts.get_mut(&frame) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                self.stale_code_counts.remove(&frame);
            }
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
        self.code_slots
            .entry(
                self.slots[index]
                    .as_ref()
                    .expect("inserted block")
                    .page_frame,
            )
            .or_default()
            .push(index);
    }
}


}


#[derive(Clone,Debug)]enum Op{Insert(u64),Flush,Page(u64)}
fn replay(ops:&[Op],verbose:bool)->bool{let(mut a,mut b)=(baseline::BlockCache::with_capacity(8),candidate::BlockCache::with_capacity(8));for(opno,op)in ops.iter().enumerate(){match op{Op::Insert(p)=>{a.insert(baseline::DecodedBlock::new(*p,alloc::vec![baseline::MicroOp],2));b.insert(candidate::DecodedBlock::new(*p,alloc::vec![candidate::MicroOp],2));},Op::Flush=>{a.flush();b.flush();},Op::Page(p)=>{a.flush_page(*p);b.flush_page(*p);}}if verbose{println!("{opno}: {op:?} => baseline={:?} candidate={:?}",a.invalidation_stats(),b.invalidation_stats());}}a.invalidation_stats()!=b.invalidation_stats()}
fn main(){let mut ops=Vec::new();let mut state=24301u64;for _ in 0..=31884{state=state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);let addr=0x80000000+((state>>24)%13)*4096+((state>>32)%128)*2;ops.push(match state%17{0=>Op::Flush,1|2|3|4=>Op::Page(addr>>12),_=>Op::Insert(addr)});}
assert!(replay(&ops,false));let original=ops.len();let mut n=2;
while ops.len()>=2{let chunk=ops.len().div_ceil(n);let mut shrunk=false;for start in (0..ops.len()).step_by(chunk){let end=(start+chunk).min(ops.len());let test=ops[..start].iter().chain(ops[end..].iter()).cloned().collect::<Vec<_>>();if replay(&test,false){ops=test;n=(n-1).max(2);shrunk=true;break;}}if !shrunk{if n>=ops.len(){break;}n=(n*2).min(ops.len());}}
println!("Reduced {original} operations to {}",ops.len());assert!(replay(&ops,true));}
