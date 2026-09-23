//! E4-T05 Phase A: the predecoded basic-block cache (the JIT's future block-discovery
//! front end, built here in the interpreter where lockstep debugging is easy).
//!
//! A [`MicroOp`] is the memoized front half of `step_traced`: the already-decoded
//! [`Instr`] (fields extracted, C forms pre-expanded) plus the guest length (2/4) and the
//! raw fetched bits (for the trace record). A [`DecodedBlock`] is a contiguous run of
//! micro-ops from an entry PC to the first terminator, never crossing a physical page.
//! The [`BlockCache`] memoizes blocks keyed by PHYSICAL PC (TCG `tb_phys_hash` style, so a
//! paging remap of the same physical code reuses the block with no flush).
//!
//! PHASE A IS SEMANTICALLY IDENTICAL TO THE LEGACY PATH. The cache memoizes ONLY decode:
//! execution still feeds every micro-op through the SAME `execute()`, and the run loop
//! still re-syncs devices + samples interrupts PER RETIRE (interrupt batching is Phase C).
//! Invalidation is the conservative Phase-A route: a whole-cache flush (an O(1) generation
//! bump) on `fence.i` and on ANY guest store. This is correct but slow; Phase B refines it
//! with a page-level has-code bitmap. See E4-T05 for the phased plan.

use crate::decode::Instr;
use alloc::collections::VecDeque;
use alloc::rc::Rc;
use alloc::vec::Vec;
use core::cell::Cell;

/// A deterministic open-addressed map from `u64` keys (physical PCs / page frames) to `V`.
///
/// The run loop consults the discovery and code-page maps on EVERY block entry and after EVERY
/// guest store, where the former `BTreeMap`s cost an O(log n) pointer chase each. This table is
/// linear-probing with backward-shift deletion (no tombstones), a fixed Fibonacci hash (no
/// per-process seed, so native and wasm behave identically), and a load factor kept <= 5/8 so a
/// lookup is typically one or two key compares. Each key is stored next to its value, so a hit —
/// the common case for the per-entry discovery lookup — reads one record. `u64::MAX` is the
/// empty-slot sentinel; a genuine `u64::MAX` key is held out of line so the map accepts every key.
/// Nothing in the emulator iterates these maps to make a decision, so the (unordered) layout is
/// unobservable.
pub(crate) struct U64Map<V> {
    slots: Vec<(u64, V)>,
    len: usize,
    shift: u32,
    max_key: Option<V>,
}

const U64MAP_EMPTY: u64 = u64::MAX;

impl<V: Default> Default for U64Map<V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<V: Default> U64Map<V> {
    /// An empty map (no allocation until the first insert).
    pub(crate) fn new() -> Self {
        Self {
            slots: Vec::new(),
            len: 0,
            shift: 64,
            max_key: None,
        }
    }

    #[inline(always)]
    fn home(&self, key: u64) -> usize {
        // Fibonacci hashing: the multiply mixes every key bit into the high bits we keep.
        (key.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> self.shift) as usize
    }

    #[inline(always)]
    fn mask(&self) -> usize {
        self.slots.len().wrapping_sub(1)
    }

    /// Slot index holding `key`, if present (never called for the sentinel key).
    #[inline(always)]
    fn find(&self, key: u64) -> Option<usize> {
        if self.slots.is_empty() {
            return None;
        }
        let mask = self.mask();
        let mut i = self.home(key);
        loop {
            let k = self.slots[i].0;
            if k == key {
                return Some(i);
            }
            if k == U64MAP_EMPTY {
                return None;
            }
            i = (i + 1) & mask;
        }
    }

    /// Number of live entries.
    pub(crate) fn len(&self) -> usize {
        self.len + usize::from(self.max_key.is_some())
    }

    #[inline]
    pub(crate) fn get(&self, key: &u64) -> Option<&V> {
        if *key == U64MAP_EMPTY {
            return self.max_key.as_ref();
        }
        self.find(*key).map(|i| &self.slots[i].1)
    }

    #[inline]
    pub(crate) fn get_mut(&mut self, key: &u64) -> Option<&mut V> {
        if *key == U64MAP_EMPTY {
            return self.max_key.as_mut();
        }
        self.find(*key).map(|i| &mut self.slots[i].1)
    }

    fn grow(&mut self) {
        let new_cap = (self.slots.len() * 2).max(16);
        let mut fresh = Vec::with_capacity(new_cap);
        fresh.resize_with(new_cap, || (U64MAP_EMPTY, V::default()));
        let old = core::mem::replace(&mut self.slots, fresh);
        self.shift = 64 - new_cap.trailing_zeros();
        let mask = new_cap - 1;
        for (k, v) in old {
            if k == U64MAP_EMPTY {
                continue;
            }
            let mut i = self.home(k);
            while self.slots[i].0 != U64MAP_EMPTY {
                i = (i + 1) & mask;
            }
            self.slots[i] = (k, v);
        }
    }

    /// Return the value for `key`, inserting `make()` first when absent.
    #[inline]
    pub(crate) fn get_or_insert_with(&mut self, key: u64, make: impl FnOnce() -> V) -> &mut V {
        if key == U64MAP_EMPTY {
            return self.max_key.get_or_insert_with(make);
        }
        if let Some(i) = self.find(key) {
            return &mut self.slots[i].1;
        }
        if (self.len + 1) * 8 > self.slots.len() * 5 {
            self.grow();
        }
        let mask = self.mask();
        let mut i = self.home(key);
        while self.slots[i].0 != U64MAP_EMPTY {
            i = (i + 1) & mask;
        }
        self.slots[i] = (key, make());
        self.len += 1;
        &mut self.slots[i].1
    }

    /// Insert or replace `key`'s value, returning the previous value.
    #[inline]
    pub(crate) fn insert(&mut self, key: u64, value: V) -> Option<V> {
        if key == U64MAP_EMPTY {
            return self.max_key.replace(value);
        }
        if let Some(i) = self.find(key) {
            return Some(core::mem::replace(&mut self.slots[i].1, value));
        }
        *self.get_or_insert_with(key, V::default) = value;
        None
    }

    /// Remove `key`, returning its value. Backward-shift deletion keeps every probe chain intact
    /// without tombstones, so lookups never slow down as entries churn.
    pub(crate) fn remove(&mut self, key: &u64) -> Option<V> {
        if *key == U64MAP_EMPTY {
            return self.max_key.take();
        }
        let i = self.find(*key)?;
        let mask = self.mask();
        let (_, value) = core::mem::replace(&mut self.slots[i], (U64MAP_EMPTY, V::default()));
        self.len -= 1;
        let mut hole = i;
        let mut j = (i + 1) & mask;
        while self.slots[j].0 != U64MAP_EMPTY {
            let home = self.home(self.slots[j].0);
            // Move the entry at `j` into the hole iff the hole lies on its probe path [home, j).
            if (j.wrapping_sub(home) & mask) >= (j.wrapping_sub(hole) & mask) {
                self.slots[hole] =
                    core::mem::replace(&mut self.slots[j], (U64MAP_EMPTY, V::default()));
                hole = j;
            }
            j = (j + 1) & mask;
        }
        Some(value)
    }

    /// Remove every entry (capacity is retained, like `HashMap::clear`).
    pub(crate) fn clear(&mut self) {
        if self.len != 0 {
            for slot in &mut self.slots {
                *slot = (U64MAP_EMPTY, V::default());
            }
            self.len = 0;
        }
        self.max_key = None;
    }

    /// Keep only the entries for which `keep` returns true (a rare bulk path: collects the doomed
    /// keys, then removes each through the ordinary backward-shift delete).
    pub(crate) fn retain(&mut self, mut keep: impl FnMut(u64, &V) -> bool) {
        let doomed: Vec<u64> = self
            .iter()
            .filter(|(k, v)| !keep(*k, v))
            .map(|(k, _)| k)
            .collect();
        for k in doomed {
            self.remove(&k);
        }
    }

    /// Iterate `(key, &value)` in unspecified order.
    pub(crate) fn iter(&self) -> impl Iterator<Item = (u64, &V)> {
        self.slots
            .iter()
            .filter(|(k, _)| *k != U64MAP_EMPTY)
            .map(|(k, v)| (*k, v))
            .chain(self.max_key.as_ref().map(|v| (U64MAP_EMPTY, v)))
    }
}

impl<V: Default + Clone> Clone for U64Map<V> {
    fn clone(&self) -> Self {
        Self {
            slots: self.slots.clone(),
            len: self.len,
            shift: self.shift,
            max_key: self.max_key.clone(),
        }
    }
}

/// Map equality is set equality of `(key, value)` pairs, independent of table layout.
impl<V: Default + PartialEq> PartialEq for U64Map<V> {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len() && self.iter().all(|(k, v)| other.get(&k) == Some(v))
    }
}

impl<V: Default + Eq> Eq for U64Map<V> {}

impl<V: Default + core::fmt::Debug> core::fmt::Debug for U64Map<V> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let mut entries: Vec<(u64, &V)> = self.iter().collect();
        entries.sort_unstable_by_key(|(k, _)| *k);
        f.debug_map().entries(entries).finish()
    }
}

/// Guest page granularity used for block boundaries + code-page keying. 4 KiB — the Sv39
/// base page. Using the base page (rather than a superpage) only makes blocks stop *more*
/// often, which is always safe.
pub const PAGE: u64 = 4096;

/// The memoized front half of a `step_traced`: a decoded instruction plus the metadata the
/// retire path needs. `Copy` (every field is `Copy`) so the executor lifts one out of a
/// borrowed block and drops the borrow before touching the bus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MicroOp {
    /// The decoded instruction (already field-extracted; C forms pre-expanded to 32-bit).
    pub instr: Instr,
    /// Guest instruction length in bytes: 2 (compressed) or 4.
    pub len: u8,
    /// The RAW fetched bits for the trace record: the 16-bit parcel (zero-extended) for a
    /// compressed op, or the 32-bit word — exactly `step_traced`'s `trace_insn`.
    pub raw: u32,
}

/// `true` for an instruction that ENDS a basic block (it is the last op IN the block):
/// any control transfer, environment call/break, a return, WFI, a fence that may reorder
/// or invalidate (`fence`/`fence.i`/`sfence.vma`), or ANY CSR read-write (a CSR write can
/// change `mstatus`/`satp`/`mie`, so the interpreter must re-sample at that boundary).
pub fn is_terminator(instr: &Instr) -> bool {
    use Instr::*;
    matches!(
        instr,
        Beq { .. }
            | Bne { .. }
            | Blt { .. }
            | Bge { .. }
            | Bltu { .. }
            | Bgeu { .. }
            | Jal { .. }
            | Jalr { .. }
            | Ecall
            | Ebreak
            | FenceI
            | Mret
            | Sret
            | Wfi
            | SfenceVma { .. }
            | Fence { .. }
            | Csrrw { .. }
            | Csrrs { .. }
            | Csrrc { .. }
            | Csrrwi { .. }
            | Csrrsi { .. }
            | Csrrci { .. }
    )
}

/// A contiguous run of predecoded micro-ops from `phys_start` to (and including) the first
/// terminator — or up to (not across) a physical page boundary, or 128 ops. No op straddles
/// a page (debug-asserted at build). `page_frame` is `phys_start >> 12` (all ops share it).
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
    /// Bit `i` set ⇔ op `i` is [`retire_deferrable`] (derived from `ops`, never serialized).
    deferrable: u128,
    /// The block's cached discovery decision (see [`BlockDiscovery::on_block_entry_memo`]).
    /// Derived host state, never serialized.
    pub(crate) disc: Cell<DiscMemo>,
}

/// `true` for a pure integer register op: it reads and writes only integer registers and the PC,
/// never touches the bus (no RAM/MMIO/page-table access), never reads or writes a CSR, cannot
/// trap, and is never a block terminator. Such an op cannot observe the per-retire accounting
/// (the Zicntr `mcycle`/`minstret` counters, the ICount `mtime` clock, the progress counter), so
/// the interpreter may settle that accounting for a run of them in one bulk step before the next
/// op that can observe it. Deliberately an allow-list: any other instruction — memory, AMO, FP,
/// CSR, system, control transfer, or one added later — is settled per retire.
pub(crate) fn retire_deferrable(instr: &Instr) -> bool {
    use Instr::*;
    matches!(
        instr,
        Lui { .. }
            | Auipc { .. }
            | Addi { .. }
            | Slti { .. }
            | Sltiu { .. }
            | Xori { .. }
            | Ori { .. }
            | Andi { .. }
            | Slli { .. }
            | Srli { .. }
            | Srai { .. }
            | Add { .. }
            | Sub { .. }
            | Sll { .. }
            | Slt { .. }
            | Sltu { .. }
            | Xor { .. }
            | Srl { .. }
            | Sra { .. }
            | Or { .. }
            | And { .. }
            | Addiw { .. }
            | Slliw { .. }
            | Srliw { .. }
            | Sraiw { .. }
            | Addw { .. }
            | Subw { .. }
            | Sllw { .. }
            | Srlw { .. }
            | Sraw { .. }
            | Mul { .. }
            | Mulh { .. }
            | Mulhsu { .. }
            | Mulhu { .. }
            | Div { .. }
            | Divu { .. }
            | Rem { .. }
            | Remu { .. }
            | Mulw { .. }
            | Divw { .. }
            | Divuw { .. }
            | Remw { .. }
            | Remuw { .. }
    )
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
        let deferrable = ops
            .iter()
            .take(128)
            .enumerate()
            .filter(|(_, op)| retire_deferrable(&op.instr))
            .fold(0u128, |mask, (i, _)| mask | (1 << i));
        Self {
            phys_start,
            ops,
            total_len,
            page_frame: phys_start >> 12,
            block_gen: 0,
            deferrable,
            disc: Cell::new(DiscMemo::default()),
        }
    }

    /// Whether op `idx` is [`retire_deferrable`] (always `false` past the 128-op mask).
    #[inline(always)]
    pub(crate) fn op_deferrable(&self, idx: usize) -> bool {
        idx < 128 && (self.deferrable >> idx) & 1 != 0
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

/// log2 of the [`CodePageFilter`] bucket count: 2^18 buckets alias frames 1 GiB apart.
const CODE_FILTER_BITS: u32 = 18;
const CODE_FILTER_MASK: usize = (1 << CODE_FILTER_BITS) - 1;

/// A counting presence filter over page frames: bucket `frame & CODE_FILTER_MASK` counts the
/// [`BlockCache::code_slots`] entries whose frame lands in it, and its bit is set while that count
/// is non-zero. A clear bit therefore PROVES the frame has no `code_slots` entry (the map lookup
/// would miss); a set bit only means "maybe" (another frame may alias the bucket). A count that
/// would overflow sticks at the maximum and keeps its bit set forever -- still conservative.
struct CodePageFilter {
    bits: Vec<u64>,
    counts: Vec<u16>,
}

impl CodePageFilter {
    fn new() -> Self {
        Self {
            bits: alloc::vec![0; (CODE_FILTER_MASK + 1) / 64],
            counts: alloc::vec![0; CODE_FILTER_MASK + 1],
        }
    }

    #[inline(always)]
    fn may_contain(&self, frame: u64) -> bool {
        let b = (frame as usize) & CODE_FILTER_MASK;
        self.bits[b >> 6] & (1 << (b & 63)) != 0
    }

    /// A `code_slots` entry for `frame` was created.
    fn add(&mut self, frame: u64) {
        let b = (frame as usize) & CODE_FILTER_MASK;
        let c = &mut self.counts[b];
        *c = c.saturating_add(1);
        self.bits[b >> 6] |= 1 << (b & 63);
    }

    /// The `code_slots` entry for `frame` was removed.
    fn remove(&mut self, frame: u64) {
        let b = (frame as usize) & CODE_FILTER_MASK;
        let c = &mut self.counts[b];
        if *c == u16::MAX {
            return; // saturated: stays (conservatively) present
        }
        *c -= 1;
        if *c == 0 {
            self.bits[b >> 6] &= !(1 << (b & 63));
        }
    }
}

/// One [`BlockCache`] slot, packed so a probe step reads the key, generation and block handle from
/// one 32-byte record (a probe used to touch three parallel arrays).
#[derive(Default)]
struct CacheSlot {
    /// `phys_start` of the resident block; meaningful only while `block` is `Some` (always equal
    /// to that block's own field), so a probe compares keys without dereferencing the block.
    phys: u64,
    /// `block_gen` of the resident block, under the same rule as `phys`.
    block_gen: u64,
    block: Option<Rc<DecodedBlock>>,
    /// Second-chance reference bit: set when an ENTRY re-uses the slot's block
    /// ([`BlockCache::get_rc_touch`]), cleared as the replacement scan passes over it. Only the
    /// choice of victim within a full probe window depends on it — never whether a lookup hits a
    /// resident block — so it shapes hit rate, not behaviour.
    referenced: bool,
    /// Position of this slot's index in its page's [`CodePageSlots::slots`] list while `block` is
    /// `Some`, so replacing the block unlinks it in O(1) instead of scanning the page's list.
    page_pos: u32,
}

/// Open-addressed, physically-keyed block cache with O(1) whole-cache flush.
///
/// Flush is a generation bump: a stored block whose `gen` differs from `generation` is
/// invisible (treated as an empty slot for probing) and will be overwritten on the next
/// insert. Correctness never depends on a hit — any lookup may miss and rebuild.
pub struct BlockCache {
    /// Blocks are reference-counted so the run loop's in-flight cursor can hold the block it is
    /// replaying and step through it with no hash probe per instruction. The cache stays the sole
    /// authority for LIVENESS: every path that drops a live block (generation flush, page flush)
    /// also clears the cursor, so a cursor never outlives its block's cache residency.
    slots: alloc::vec::Vec<CacheSlot>,
    mask: usize,
    generation: u64,
    /// E5.5-T03ba: decoded-cache slots grouped by physical page. A store (guest OR device/DMA)
    /// whose frame is absent is an O(log n) map miss; a code-page store touches only the indexed
    /// slots instead of scanning the whole open-addressed table. Slot indices remain associated
    /// with their page across generation bumps so page-flush accounting stays identical to the
    /// legacy full-table scan, including stale physical slots.
    code_slots: U64Map<CodePageSlots>,
    /// Conservative presence filter over `code_slots` keys, so the store-drain path answers "this
    /// frame holds no cached code" -- the common case, after every guest store -- with one bit test
    /// instead of a map probe. Derived state only (never serialized).
    code_filter: CodePageFilter,
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
        slots.resize_with(cap, CacheSlot::default);
        Self {
            slots,
            mask: cap - 1,
            generation: 1,
            code_slots: U64Map::new(),
            code_filter: CodePageFilter::new(),
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
        // A clear filter bit proves `code_slots` has no entry for `frame` (the lookup below would
        // miss): the common data-store case, answered without a probe.
        if !self.code_filter.may_contain(frame) {
            return false;
        }
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
        self.code_filter.remove(frame);
        for index in indices {
            if self
                .slots
                .get(index)
                .and_then(|slot| slot.block.as_ref())
                .is_some_and(|b| b.page_frame == frame)
            {
                self.slots[index].block = None;
                self.blocks_discarded = self.blocks_discarded.saturating_add(1);
            }
        }
        true
    }

    /// Remove one indexed slot before replacing it. Retain the page entry even when its slot list
    /// becomes empty: the legacy `has_code` membership stayed live until `flush_page`, and callers
    /// use that membership to decide whether a page invalidation occurred.
    fn unlink_code_slot(&mut self, index: usize) {
        let slot = &self.slots[index];
        let Some(block) = slot.block.as_ref() else {
            return;
        };
        let frame = block.page_frame;
        let hint = slot.page_pos as usize;
        let Some(page) = self.code_slots.get_mut(&frame) else {
            return;
        };
        // The back-index names the position directly; the scan is a defensive fallback for a
        // list the index does not describe (never expected: every list edit maintains it).
        let position = if page.slots.get(hint) == Some(&index) {
            Some(hint)
        } else {
            page.slots.iter().position(|&candidate| candidate == index)
        };
        if let Some(position) = position {
            page.slots.swap_remove(position);
            // swap_remove moved the list's last index into `position`: re-point its back-index.
            if let Some(&moved) = page.slots.get(position) {
                self.slots[moved].page_pos = position as u32;
            }
        }
    }

    /// Whether `frame` may hold cached code: `false` proves [`Self::flush_page`] would be a no-op
    /// returning `false`, so the run loop's store drain can skip it with one bit test.
    #[inline(always)]
    pub(crate) fn may_hold_code(&self, frame: u64) -> bool {
        self.code_filter.may_contain(frame)
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
    #[inline]
    pub fn get(&self, phys_start: u64) -> Option<&DecodedBlock> {
        self.get_rc(phys_start).map(|b| &**b)
    }

    /// [`Self::get`], returning the shared handle so a caller can retain the block it is about to
    /// replay (the run loop's block cursor).
    #[inline]
    pub(crate) fn get_rc(&self, phys_start: u64) -> Option<&Rc<DecodedBlock>> {
        self.probe(phys_start)
            .and_then(|idx| self.slots[idx].block.as_ref())
    }

    /// [`Self::get_rc`] for a block ENTRY: a hit also marks the slot referenced, giving the
    /// block a second chance when a full probe window must evict.
    #[inline]
    #[cfg_attr(feature = "zicsr-stub", allow(dead_code))]
    pub(crate) fn get_rc_touch(&mut self, phys_start: u64) -> Option<Rc<DecodedBlock>> {
        let idx = self.probe(phys_start)?;
        let slot = &mut self.slots[idx];
        slot.referenced = true;
        slot.block.clone()
    }

    /// The slot holding the live block keyed `phys_start`, if any.
    #[inline]
    fn probe(&self, phys_start: u64) -> Option<usize> {
        let start = self.hash(phys_start);
        for i in 0..MAX_PROBE {
            let idx = (start + i) & self.mask;
            let slot = &self.slots[idx];
            if slot.block.is_none() || slot.block_gen != self.generation {
                // A `None` or stale-gen slot is a genuine empty — the key was never inserted on
                // this chain, so stop.
                return None;
            }
            if slot.phys == phys_start {
                return Some(idx);
            }
            // A live block for a different key: keep probing.
        }
        None
    }

    /// Iterate the blocks that belong to the current cache generation. This is intentionally a
    /// read-only view for boundary audits such as the PMP privilege-transition check; callers must
    /// not infer that a missing block is an architectural failure because a cache miss is always a
    /// legal rebuild.
    #[cfg_attr(feature = "zicsr-stub", allow(dead_code))]
    pub(crate) fn live_blocks(&self) -> impl Iterator<Item = &DecodedBlock> {
        self.slots.iter().filter_map(|slot| match &slot.block {
            Some(block) if block.block_gen == self.generation => Some(&**block),
            _ => None,
        })
    }

    /// Insert `block` (stamped with the current generation), replacing a stale/empty slot on
    /// its probe chain, or — if the chain is full of live entries — the head slot (simple
    /// replacement; correctness is unaffected).
    pub fn insert(&mut self, block: DecodedBlock) {
        self.insert_rc(block);
    }

    /// [`Self::insert`], returning the shared handle of the block just made resident.
    pub(crate) fn insert_rc(&mut self, block: DecodedBlock) -> Rc<DecodedBlock> {
        self.insert_rc_evicting(block).0
    }

    /// [`Self::insert_rc`], also handing back the block the chosen slot held before (if any), so
    /// the caller can settle state that block carried (its [`DiscMemo`]).
    pub(crate) fn insert_rc_evicting(
        &mut self,
        mut block: DecodedBlock,
    ) -> (Rc<DecodedBlock>, Option<Rc<DecodedBlock>>) {
        block.block_gen = self.generation;
        let start = self.hash(block.phys_start);
        let index = (0..MAX_PROBE)
            .find_map(|i| {
                let idx = (start + i) & self.mask;
                let slot = &self.slots[idx];
                let free = slot.block.is_none()
                    || slot.block_gen != self.generation
                    || slot.phys == block.phys_start;
                if free { Some(idx) } else { None }
            })
            .unwrap_or_else(|| {
                // The whole probe window holds live blocks: evict the first one not re-entered
                // since the scan last passed it (second chance), else the window head.
                (0..MAX_PROBE)
                    .map(|i| (start + i) & self.mask)
                    .find(|&idx| !core::mem::replace(&mut self.slots[idx].referenced, false))
                    .unwrap_or(start)
            });
        self.unlink_code_slot(index);
        let page_frame = block.page_frame;
        let (phys, block_gen) = (block.phys_start, block.block_gen);
        let block = Rc::new(block);
        let evicted = self.slots[index].block.take();
        self.slots[index] = CacheSlot {
            phys,
            block_gen,
            block: Some(Rc::clone(&block)),
            referenced: false,
            page_pos: 0,
        };
        let generation = self.generation;
        let code_filter = &mut self.code_filter;
        let page = self.code_slots.get_or_insert_with(page_frame, || {
            code_filter.add(page_frame);
            CodePageSlots {
                generation,
                slots: Vec::new(),
            }
        });
        page.generation = generation;
        self.slots[index].page_pos = page.slots.len() as u32;
        page.slots.push(index);
        (block, evicted)
    }
}

// ---------------------------------------------------------------------------
// E4-T08: hotness counters + translation-candidate block discovery.
//
// The block cache (above) learns to NOMINATE JIT candidates. Each time a block
// is ENTERED at its physical entry PC (the `next_micro_op` slow path — a cursor
// miss re-keys and rebuilds the block, i.e. one loop iteration = one entry), a
// saturating u32 execution counter is bumped. When the counter crosses the
// design-doc hotness threshold (E4-T06 §1: N = 64) the block is nominated: a
// [`TranslationRequest`] snapshotting the entry PC, the raw instruction BYTES,
// the per-op lengths, and the terminator kind is pushed onto a bounded FIFO.
//
// This is DISCOVERY ONLY. No translator consumes the queue yet (E4-T09/T10). It
// is also OBSERVATION ONLY: counting + nomination never touch the executed
// architectural sequence, so the `predecode_diff` byte-identity gate is
// unaffected (the counters/queue are read only by tests and `ProfStats`).
//
// The single load-bearing safety property (E4-T06 §5, this ticket's adversarial
// AC) is *never install a translation for bytes that no longer match memory*.
// Two independent defenses enforce it: (1) a GENERATION counter bumped by ANY
// invalidation event (fence.i / SMC page-flush / whole-cache flush); a request
// stamped with an older generation is stale. (2) the snapshotted `code_bytes`
// are compared against live guest memory at (mock) install time. Either
// mismatch drops the request. See [`BlockDiscovery::install_check`].
// ---------------------------------------------------------------------------

/// Hotness threshold: promote a block at its `N`-th execution (E4-T06 §1, `N = 64`).
/// A TUNABLE, not a law — the one config point for the promotion policy. Low enough
/// that a boot's hot kernel loops promote early, high enough that one-shot init code
/// never compiles.
pub const HOT_THRESHOLD: u32 = 64;

/// Bounded FIFO capacity for pending [`TranslationRequest`]s. Overflow degrades
/// gracefully (nominations are dropped and counted) — no unbounded growth under a
/// flood of unique hot blocks (`gcc`-style workloads).
pub const MAX_QUEUE: usize = 4096;

/// Cap on the live hotness-counter map (blocks being counted toward the threshold, in
/// the current generation). Bounds memory under a flood of unique COLD blocks: once
/// full, new keys are not tracked (counted as `counts_dropped`) rather than growing
/// without bound. Nominated blocks leave this map, so it only ever holds sub-threshold
/// candidates.
/// The explicit cold-counter recycling trial instead clears only this map when a
/// new key encounters the bound, then counts that entry normally.
pub const MAX_COUNTS: usize = 1 << 16;

/// The classified block terminator, captured in a [`TranslationRequest`] so the
/// translator (E4-T09+) knows how the block exits without re-decoding. `None` means the
/// block hit the 128-op cap or a page edge with no architectural terminator (a
/// fall-through block).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminatorKind {
    /// A conditional branch (`beq`/`bne`/`blt`/`bge`/`bltu`/`bgeu`).
    Branch,
    /// `jal`.
    Jal,
    /// `jalr`.
    Jalr,
    /// `ecall`.
    Ecall,
    /// `ebreak`.
    Ebreak,
    /// `fence.i`.
    FenceI,
    /// `mret`.
    Mret,
    /// `sret`.
    Sret,
    /// `wfi`.
    Wfi,
    /// `sfence.vma`.
    SfenceVma,
    /// `fence`.
    Fence,
    /// Any CSR read-write (`csrrw`/`csrrs`/`csrrc` + immediate forms).
    Csr,
    /// No architectural terminator (fell through the 128-op cap / page edge).
    None,
}

impl TerminatorKind {
    /// Classify a single instruction's terminator kind. Returns [`TerminatorKind::None`]
    /// for any non-terminator (see [`is_terminator`]).
    pub fn of(instr: &Instr) -> Self {
        use Instr::*;
        match instr {
            Beq { .. } | Bne { .. } | Blt { .. } | Bge { .. } | Bltu { .. } | Bgeu { .. } => {
                TerminatorKind::Branch
            }
            Jal { .. } => TerminatorKind::Jal,
            Jalr { .. } => TerminatorKind::Jalr,
            Ecall => TerminatorKind::Ecall,
            Ebreak => TerminatorKind::Ebreak,
            FenceI => TerminatorKind::FenceI,
            Mret => TerminatorKind::Mret,
            Sret => TerminatorKind::Sret,
            Wfi => TerminatorKind::Wfi,
            SfenceVma { .. } => TerminatorKind::SfenceVma,
            Fence { .. } => TerminatorKind::Fence,
            Csrrw { .. }
            | Csrrs { .. }
            | Csrrc { .. }
            | Csrrwi { .. }
            | Csrrsi { .. }
            | Csrrci { .. } => TerminatorKind::Csr,
            _ => TerminatorKind::None,
        }
    }

    /// The terminator kind of a walked block (its last op), or [`TerminatorKind::None`]
    /// for an empty/fall-through block.
    pub fn of_block(ops: &[MicroOp]) -> Self {
        match ops.last() {
            Some(op) => TerminatorKind::of(&op.instr),
            None => TerminatorKind::None,
        }
    }

    /// E4-T06 "what is never JITted": a block whose terminator is a CSR read-write (can
    /// change `mstatus`/`satp`/`mie` mid-stream) or `wfi` (the idle path is runtime-owned)
    /// is EXCLUDED from nomination — it stays in the interpreter (T0/T1). This is the one
    /// config point for the exclusion policy; the other terminators (branch/jal/jalr/ecall/
    /// ebreak/xret/fence) side-exit and are translatable up to the terminator.
    pub fn is_excluded(&self) -> bool {
        matches!(self, TerminatorKind::Csr | TerminatorKind::Wfi)
    }
}

/// A nominated translation candidate: everything the (future) translator needs to compile
/// a block WITHOUT re-reading guest memory, plus the coherence stamp that makes installing
/// stale bytes impossible.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslationRequest {
    /// Physical address of the block's entry instruction (the cache key).
    pub phys_pc: u64,
    /// Raw guest instruction bytes, entry→terminator, little-endian, `sum(op_lens)` long —
    /// the SNAPSHOT compared against live memory at install time (compare-at-install).
    pub code_bytes: Vec<u8>,
    /// Per-op guest lengths (2 or 4), in program order; parallel to the ops the bytes encode.
    pub op_lens: Vec<u8>,
    /// The block's terminator kind (how it exits).
    pub terminator: TerminatorKind,
    /// The discovery generation this request was stamped in. A later invalidation bumps the
    /// live generation; a request whose `generation` no longer matches is stale and dropped.
    pub generation: u64,
}

impl TranslationRequest {
    /// Build a request snapshotting a walked block's raw bytes + lengths + terminator.
    fn from_block(phys_pc: u64, ops: &[MicroOp], generation: u64) -> Self {
        let mut code_bytes = Vec::with_capacity(ops.len() * 4);
        let mut op_lens = Vec::with_capacity(ops.len());
        for op in ops {
            op_lens.push(op.len);
            // Little-endian raw parcel: `len` bytes of `raw` (2 for compressed, 4 for full).
            for b in 0..op.len {
                code_bytes.push((op.raw >> (8 * u32::from(b))) as u8);
            }
        }
        Self {
            phys_pc,
            code_bytes,
            op_lens,
            terminator: TerminatorKind::of_block(ops),
            generation,
        }
    }
}

/// Per-block nomination state (the dedup state machine): a block is COLD until its counter
/// crosses the threshold, then it transitions once and never re-nominates within a
/// generation. Any invalidation clears the state so a re-decoded hot block can be
/// re-nominated afresh (with new bytes + a new generation). Held as [`DiscEntry`]'s decided
/// variants; this enum remains the unit tests' view of that state.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum NomState {
    /// Nominated: a request is (or was) enqueued for this block. Suppresses re-nomination.
    #[default]
    Queued,
    /// Excluded from translation (CSR/wfi terminator). Suppresses counting + nomination.
    Excluded,
}

/// One block's discovery record, keyed by physical entry PC in [`BlockDiscovery::entries`]. It
/// merges what were three parallel maps -- the hotness counter (`Counting`), the dedup state
/// (`Queued`/`Excluded`) and the queued-hit priority (`Queued::hits`) -- whose key sets were always
/// disjoint (a counter is dropped before its block is decided) or nested (hits only ever accrue to
/// a Queued block), so a block entry costs ONE probe instead of two.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DiscEntry {
    /// Below the threshold: the saturating execution count (always >= 1 while stored).
    Counting(u32),
    /// Nominated: a request is (or was) enqueued; suppresses re-nomination. `hits` are the extra
    /// entries observed since (E4-T21 priority), 0 until the first one. `serial` is unique to
    /// this nomination, so hits a block buffered against it (see [`DiscMemo`]) can never be
    /// folded into a later re-nomination of the same PC.
    Queued { hits: u32, serial: u64 },
    /// Excluded from translation (CSR/wfi terminator); suppresses counting + nomination.
    Excluded,
}

impl Default for DiscEntry {
    fn default() -> Self {
        DiscEntry::Counting(0)
    }
}

const MEMO_NONE: u8 = 0;
const MEMO_QUEUED: u8 = 1;
const MEMO_EXCLUDED: u8 = 2;

/// A decoded block's cached copy of its discovery decision, so a block entry of an already
/// decided block (every hot block, in a run without an executor) skips the discovery map.
///
/// Valid while `epoch` equals [`BlockDiscovery`]'s `decided_epoch`, which every operation that
/// can remove or reset a decided entry (renominate, invalidate, reset) bumps. A Queued block
/// buffers its E4-T21 queued hits here (`pending_hits`); they are folded into the entry — only if
/// it is still the same nomination (`serial`) — before the block's next slow-path entry, when it
/// leaves the cache, and whenever the compile queue reads the block's hotness. The dedup counter
/// itself is always counted immediately.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct DiscMemo {
    epoch: u64,
    serial: u64,
    pending_hits: u32,
    kind: u8,
}

/// Diagnostic first-seen refusal sample, never an admission-policy capacity.
pub const MAX_ADMISSION_WITNESSES: usize = 32;

/// Mutually exclusive decisions at an actual interpreted block entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AdmissionReason {
    CountsFull,
    Counting,
    Nominated,
    Excluded,
    DedupQueued,
    DedupExcluded,
    FifoOverflow,
}

/// Entry counts since this exact identity's first retained full-map refusal.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AdmissionReasons {
    pub counts_full: u64,
    pub counting: u64,
    pub nominated: u64,
    pub excluded: u64,
    pub dedup_queued: u64,
    pub dedup_excluded: u64,
    pub fifo_overflow: u64,
}

impl AdmissionReasons {
    fn record(&mut self, reason: AdmissionReason) {
        let counter = match reason {
            AdmissionReason::CountsFull => &mut self.counts_full,
            AdmissionReason::Counting => &mut self.counting,
            AdmissionReason::Nominated => &mut self.nominated,
            AdmissionReason::Excluded => &mut self.excluded,
            AdmissionReason::DedupQueued => &mut self.dedup_queued,
            AdmissionReason::DedupExcluded => &mut self.dedup_excluded,
            AdmissionReason::FifoOverflow => &mut self.fifo_overflow,
        };
        *counter = counter.saturating_add(1);
    }
}

/// Exact retained entry identity. Ops are retained for the outer translator's predicate;
/// observation never re-reads guest memory or decides whether to nominate/compile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmissionWitness {
    pub request: TranslationRequest,
    pub ops: Vec<MicroOp>,
    pub entries: u64,
    pub first_entry: u64,
    pub last_entry: u64,
    pub first_counts_len: usize,
    pub last_counts_len: usize,
    pub reasons: AdmissionReasons,
    /// Exact request membership at report time, NOT NomState::Queued.
    pub discovery_queued: bool,
    pub compile_queued: bool,
    /// PC-only residency at report time. None means no executor; never an install receipt.
    pub executor_resident_at_report: Option<bool>,
}

/// Bounded, generation-local diagnostic data. Overflow counts refused ENTRIES, not
/// distinct identities; the first-seen sample cannot establish absence/heavy hitters.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AdmissionProbeStats {
    pub enabled: bool,
    pub generation: u64,
    pub generation_resets: u64,
    pub observed_entries: u64,
    pub full_map_refusals: u64,
    pub overflow_refusals: u64,
    pub invalid_blocks: u64,
    pub counts_len: usize,
    pub counts_capacity: usize,
    pub threshold: u32,
    pub records: Vec<AdmissionWitness>,
}

impl AdmissionProbeStats {
    fn observe(&mut self, phys: u64, ops: &[MicroOp], reason: AdmissionReason, counts_len: usize) {
        self.observed_entries = self.observed_entries.saturating_add(1);
        if reason == AdmissionReason::CountsFull {
            self.full_map_refusals = self.full_map_refusals.saturating_add(1);
        }
        if reason != AdmissionReason::CountsFull && self.records.is_empty() {
            return;
        }
        // Real walked blocks meet these bounds. Fail closed for malformed diagnostic/test calls,
        // without changing the underlying discovery decision or allocating for invalid input.
        if ops.is_empty()
            || ops.len() > MAX_BLOCK_OPS
            || ops.iter().any(|op| !matches!(op.len, 2 | 4))
        {
            self.invalid_blocks = self.invalid_blocks.saturating_add(1);
            return;
        }
        let index = self.records.iter().position(|row| {
            row.request.phys_pc == phys
                && row.request.generation == self.generation
                && row.ops == ops
        });
        let index = match index {
            Some(index) => index,
            None if reason != AdmissionReason::CountsFull => return,
            None if self.records.len() == MAX_ADMISSION_WITNESSES => {
                self.overflow_refusals = self.overflow_refusals.saturating_add(1);
                return;
            }
            None => {
                self.records.push(AdmissionWitness {
                    request: TranslationRequest::from_block(phys, ops, self.generation),
                    ops: ops.to_vec(),
                    entries: 0,
                    first_entry: self.observed_entries,
                    last_entry: self.observed_entries,
                    first_counts_len: counts_len,
                    last_counts_len: counts_len,
                    reasons: AdmissionReasons::default(),
                    discovery_queued: false,
                    compile_queued: false,
                    executor_resident_at_report: None,
                });
                self.records.len() - 1
            }
        };
        let row = &mut self.records[index];
        row.entries = row.entries.saturating_add(1);
        row.last_entry = self.observed_entries;
        row.last_counts_len = counts_len;
        row.reasons.record(reason);
    }
}

/// A snapshot of the discovery counters, exported through the profiling stats (E4-T01).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DiscoveryStats {
    /// Blocks successfully nominated (a request pushed onto the queue).
    pub nominated: u64,
    /// Re-nomination attempts suppressed by dedup (block already Queued/Excluded).
    pub deduped: u64,
    /// Requests found stale at (mock) install time — old generation OR bytes no longer
    /// matching live guest memory — and dropped rather than installed.
    pub dropped_stale: u64,
    /// Nominations dropped because the FIFO was full (graceful overflow).
    pub dropped_overflow: u64,
    /// Cold candidates not tracked because the counter map was full (flood bound).
    pub counts_dropped: u64,
    /// Blocks excluded from nomination by policy (CSR/wfi terminator).
    pub excluded: u64,
    /// Current pending-queue depth.
    pub queue_depth: usize,
    /// High-water mark of the pending queue over the run.
    pub queue_hwm: usize,
    /// Live sub-threshold candidates currently being counted.
    pub candidates: usize,
    /// The current discovery generation (bumped by every invalidation).
    pub generation: u64,
    /// E4-T16: whole block-cache flushes performed over the run (`fence.i` / reset — QEMU
    /// `tb_flush` analog). Filled from [`BlockCache::invalidation_stats`] by the profiling report.
    pub cache_flushes: u64,
    /// E4-T16: live decoded blocks discarded by page-granular invalidation (SMC / DMA-into-code).
    /// SFENCE.VMA never contributes here (phys-keying), so a flat value across a remap storm is the
    /// "SFENCE.VMA didn't kill translations" proof-in-stats.
    pub blocks_discarded: u64,
    /// E4-T17: near-free `fence.i` events (no whole-cache flush; the page bitmap was already
    /// authoritative). A rising `fence_i` with a FLAT `cache_flushes` is the "fence.i near-free"
    /// evidence — un-dirtied pages' blocks survive the fence. Filled from
    /// [`BlockCache::fence_i_noops`] by [`crate::Machine::discovery_stats`] / the profiling report.
    pub fence_i: u64,
}

/// Lifetime accounting for the default-off cold-counter recycling trial. Toggling
/// selection, discovery reset, and code invalidation do not erase this accounting.
/// Epochs count map clears, not code generations; discarded counters count keys,
/// not the execution counts stored in those keys. Both totals saturate.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ColdCounterRecyclingStats {
    pub enabled: bool,
    pub epochs: u64,
    pub discarded_counters: u64,
    /// Current selection, filled from discovery at report time (not an observer).
    pub threshold: u32,
    pub capacity: usize,
}

/// The E4-T08 block-discovery front end: hotness counters, the dedup state machine, the
/// bounded nomination FIFO, the invalidation generation, and the observable stats. Owned by
/// the `Machine` alongside the [`BlockCache`]; driven only when the block cache is enabled.
pub struct BlockDiscovery {
    /// Invalidation generation. Bumped by fence.i / SMC page-flush / whole-cache flush; the
    /// stamp every fresh request carries and the value install-time validation compares against.
    generation: u64,
    /// Per-block discovery records (phys entry PC → [`DiscEntry`]), current generation:
    /// * `Counting` — the live execution counter; a block leaves this state the moment it is
    ///   nominated (or excluded), and only `counting_len` of these are ever held (`counts_cap`).
    /// * `Queued`/`Excluded` — the dedup state for blocks past the threshold.
    /// * `Queued { hits }` — E4-T21: extra executions observed for a block AFTER it was nominated
    ///   but BEFORE its compile has been installed — the "how hot is this pending job" signal the
    ///   compile queue orders by, so a block still running hot while it waits compiles ahead of a
    ///   one-shot straggler. Cleared by every invalidation / renominate.
    entries: U64Map<DiscEntry>,
    /// Number of `Counting` entries (the former counter map's length).
    counting_len: usize,
    /// Validity epoch of every [`DiscMemo`]: bumped whenever a decided entry may be removed or
    /// reset (renominate, invalidate, reset).
    decided_epoch: u64,
    /// Next [`DiscEntry::Queued`] serial (unique per nomination).
    next_serial: u64,
    /// Bounded FIFO of pending nominations.
    queue: VecDeque<TranslationRequest>,
    stats: DiscoveryStats,
    queue_cap: usize,
    counts_cap: usize,
    /// Promotion threshold (defaults to [`HOT_THRESHOLD`]). Runtime-tunable — E4-T08 owns the
    /// swept value; the design-doc number is the starting point, falsifiable by a ledger regression.
    threshold: u32,
    /// No allocation, byte comparison, or guest-memory access while absent (the default).
    admission_probe: Option<AdmissionProbeStats>,
    cold_counter_recycling: ColdCounterRecyclingStats,
}

impl Default for BlockDiscovery {
    fn default() -> Self {
        Self::new()
    }
}

impl BlockDiscovery {
    /// A fresh discovery front end at generation 1 with the default bounds.
    pub fn new() -> Self {
        Self::with_bounds(MAX_QUEUE, MAX_COUNTS)
    }

    /// A discovery front end with explicit bounds (tests use small caps to exercise overflow).
    pub fn with_bounds(queue_cap: usize, counts_cap: usize) -> Self {
        Self {
            generation: 1,
            entries: U64Map::new(),
            counting_len: 0,
            decided_epoch: 1,
            next_serial: 1,
            queue: VecDeque::new(),
            stats: DiscoveryStats {
                generation: 1,
                ..DiscoveryStats::default()
            },
            queue_cap: queue_cap.max(1),
            counts_cap: counts_cap.max(1),
            threshold: HOT_THRESHOLD,
            admission_probe: None,
            cold_counter_recycling: ColdCounterRecyclingStats::default(),
        }
    }

    /// Select the experiment without changing any current counter, queue, decision,
    /// threshold, or generation. Only a later full-map new entry can recycle.
    pub fn set_cold_counter_recycling(&mut self, enabled: bool) {
        self.cold_counter_recycling.enabled = enabled;
    }

    pub fn cold_counter_recycling_stats(&self) -> ColdCounterRecyclingStats {
        ColdCounterRecyclingStats {
            threshold: self.threshold,
            capacity: self.counts_cap,
            ..self.cold_counter_recycling
        }
    }

    /// Explicit diagnostic toggle only. Repeated enable preserves the current window;
    /// disabling discards it. Does not reset discovery, queues, profiler, or guest state.
    pub fn set_admission_probe(&mut self, enabled: bool) {
        if enabled && self.admission_probe.is_none() {
            self.admission_probe = Some(AdmissionProbeStats {
                enabled: true,
                generation: self.generation,
                ..AdmissionProbeStats::default()
            });
        } else if !enabled {
            self.admission_probe = None;
        }
    }

    fn reset_admission_generation(&mut self) {
        if let Some(probe) = self.admission_probe.as_mut() {
            *probe = AdmissionProbeStats {
                enabled: true,
                generation: self.generation,
                generation_resets: probe.generation_resets.saturating_add(1),
                ..AdmissionProbeStats::default()
            };
        }
    }

    /// Read-only exact-request lookup; never removes/reorders queued work.
    pub fn contains_request(&self, request: &TranslationRequest) -> bool {
        self.queue.iter().any(|queued| queued == request)
    }

    pub fn admission_probe_stats(&self) -> AdmissionProbeStats {
        let mut result = self.admission_probe.clone().unwrap_or_default();
        result.generation = self.generation;
        result.counts_len = self.counting_len;
        result.counts_capacity = self.counts_cap;
        result.threshold = self.threshold;
        for row in &mut result.records {
            row.discovery_queued = self.contains_request(&row.request);
        }
        result
    }

    /// Set the promotion threshold (minimum 1). Used to sweep the tunable and to exercise
    /// nomination with short guests in tests.
    pub fn set_threshold(&mut self, threshold: u32) {
        self.threshold = threshold.max(1);
    }

    /// The current promotion threshold.
    pub fn threshold(&self) -> u32 {
        self.threshold
    }

    /// Reset ALL discovery state (a config change: cache toggle / resize / snapshot restore).
    /// Bumps the generation so any request already handed to a consumer is treated as stale.
    pub fn reset(&mut self) {
        let hwm = self.stats.queue_hwm;
        self.generation = self.generation.wrapping_add(1);
        self.reset_admission_generation();
        self.entries.clear();
        self.counting_len = 0;
        self.decided_epoch = self.decided_epoch.wrapping_add(1);
        self.queue.clear();
        self.stats = DiscoveryStats {
            generation: self.generation,
            queue_hwm: hwm,
            ..DiscoveryStats::default()
        };
    }

    /// E4-T20: reset the hotness + dedup state for ONE block (its physical entry PC) WITHOUT a
    /// generation bump, so a block whose compiled batch was budget-EVICTED is re-nominated from cold
    /// the next time it runs hot. Unlike [`Self::on_invalidate`] this is surgical — other blocks'
    /// counters and the decoded-block cache are untouched (a batch-LRU eviction must not flush the
    /// whole decoded cache). The still-valid decoded bytes stay cached; only the "already nominated"
    /// suppression is cleared so re-translation can happen.
    pub fn renominate(&mut self, phys_pc: u64) {
        if let Some(DiscEntry::Counting(_)) = self.entries.remove(&phys_pc) {
            self.counting_len -= 1;
        }
        self.decided_epoch = self.decided_epoch.wrapping_add(1);
    }

    /// Record an invalidation (fence.i / SMC page-flush / whole-cache flush): bump the
    /// generation and clear the per-block hotness + dedup state so a re-decoded hot block is
    /// re-nominated from scratch. Pending queued requests are LEFT in place deliberately — they
    /// now carry a stale generation and are dropped at [`Self::install_check`], which is what the
    /// adversarial "never install stale bytes" test observes. Cheap: two `clear`s of typically
    /// small maps.
    pub fn on_invalidate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.reset_admission_generation();
        self.stats.generation = self.generation;
        self.entries.clear();
        self.counting_len = 0;
        self.decided_epoch = self.decided_epoch.wrapping_add(1);
    }

    /// Note one execution (entry) of the block at physical `phys` whose walked ops are `ops`.
    /// Bumps the saturating counter; on crossing [`HOT_THRESHOLD`] exactly once, nominates the
    /// block (or marks it excluded). Dedup: a block already past the threshold returns
    /// immediately. This is the hot-path hook — cheap for the common (already-decided or
    /// still-cold) block: one map probe plus, while cold, one increment.
    pub fn on_block_entry(&mut self, phys: u64, ops: &[MicroOp]) {
        if self.admission_probe.is_none() {
            self.on_block_entry_decision(phys, ops);
            return;
        }
        let counts_len = self.counting_len;
        let reason = self.on_block_entry_decision(phys, ops);
        if let Some(probe) = self.admission_probe.as_mut() {
            probe.observe(phys, ops, reason, counts_len);
        }
    }

    fn on_block_entry_decision(&mut self, phys: u64, ops: &[MicroOp]) -> AdmissionReason {
        // One probe answers every case: decided (dedup), counting, or absent.
        let count = match self.entries.get_mut(&phys) {
            // Already decided (nominated or excluded): dedup — never re-enqueue.
            Some(DiscEntry::Queued { hits, .. }) => {
                self.stats.deduped = self.stats.deduped.saturating_add(1);
                // E4-T21: a still-hot Queued block keeps accruing priority while it waits to compile.
                *hits = hits.saturating_add(1);
                return AdmissionReason::DedupQueued;
            }
            Some(DiscEntry::Excluded) => {
                self.stats.deduped = self.stats.deduped.saturating_add(1);
                return AdmissionReason::DedupExcluded;
            }
            Some(DiscEntry::Counting(c)) => {
                *c = c.saturating_add(1);
                *c
            }
            None => {
                if self.counting_len >= self.counts_cap {
                    if !self.cold_counter_recycling.enabled {
                        // Unselected control: preserve the existing refusal and observer reason.
                        self.stats.counts_dropped = self.stats.counts_dropped.saturating_add(1);
                        return AdmissionReason::CountsFull;
                    }
                    // Bounded by counts_cap. Do not reset discovery: decisions, queued-hit
                    // priorities, exact FIFO requests, and generation must all survive.
                    self.cold_counter_recycling.epochs =
                        self.cold_counter_recycling.epochs.saturating_add(1);
                    self.cold_counter_recycling.discarded_counters = self
                        .cold_counter_recycling
                        .discarded_counters
                        .saturating_add(self.counting_len as u64);
                    self.entries
                        .retain(|_, e| !matches!(e, DiscEntry::Counting(_)));
                    self.counting_len = 0;
                }
                self.entries.insert(phys, DiscEntry::Counting(1));
                self.counting_len += 1;
                1
            }
        };
        if count == self.threshold {
            return self.nominate(phys, ops);
        }
        AdmissionReason::Counting
    }

    /// Transition a block past the threshold: drop it from the counter map, then either exclude
    /// it (CSR/wfi terminator) or push a fresh [`TranslationRequest`]. Marks the block Queued/
    /// Excluded so it never re-nominates within this generation (dedup). Fires EXACTLY once per
    /// block per generation because the caller only reaches here on `count == HOT_THRESHOLD`.
    fn nominate(&mut self, phys: u64, ops: &[MicroOp]) -> AdmissionReason {
        // The caller just counted `phys` to the threshold, so its entry is `Counting`: it leaves
        // the counter set and becomes decided in place.
        self.counting_len -= 1;
        let term = TerminatorKind::of_block(ops);
        if term.is_excluded() {
            self.entries.insert(phys, DiscEntry::Excluded);
            self.stats.excluded = self.stats.excluded.saturating_add(1);
            return AdmissionReason::Excluded;
        }
        // Mark Queued regardless of whether the push succeeds, so an overflow-dropped block does
        // not re-nominate every subsequent execution (no renomination storm).
        let serial = self.next_serial;
        self.next_serial = self.next_serial.wrapping_add(1);
        self.entries
            .insert(phys, DiscEntry::Queued { hits: 0, serial });
        if self.queue.len() >= self.queue_cap {
            self.stats.dropped_overflow = self.stats.dropped_overflow.saturating_add(1);
            return AdmissionReason::FifoOverflow;
        }
        self.queue
            .push_back(TranslationRequest::from_block(phys, ops, self.generation));
        self.stats.nominated = self.stats.nominated.saturating_add(1);
        if self.queue.len() > self.stats.queue_hwm {
            self.stats.queue_hwm = self.queue.len();
        }
        AdmissionReason::Nominated
    }

    /// Validate a request at (mock) install time. Returns `true` iff it is safe to install:
    /// the request's generation still matches the live generation AND its snapshotted
    /// `code_bytes` still equal the live guest bytes `live_bytes`. Any mismatch is a stale
    /// request — counted (`dropped_stale`) and refused. This is the single choke point the
    /// "never installs stale bytes" claim rests on.
    pub fn install_check(&mut self, req: &TranslationRequest, live_bytes: &[u8]) -> bool {
        let ok = req.generation == self.generation && req.code_bytes == live_bytes;
        if !ok {
            self.stats.dropped_stale = self.stats.dropped_stale.saturating_add(1);
        }
        ok
    }

    /// Drain the pending queue (a trivial consumer for tests / the future compile queue).
    pub fn take_requests(&mut self) -> Vec<TranslationRequest> {
        self.queue.drain(..).collect()
    }

    /// Remove at most `max` pending nominations, preserving FIFO order and leaving the remainder
    /// queued for a later cooperative host slice. The browser JIT uses this bounded form so moving
    /// a discovery flood into its priority queue cannot monopolize the Worker event loop.
    pub fn take_requests_bounded(&mut self, max: usize) -> Vec<TranslationRequest> {
        let count = max.min(self.queue.len());
        self.queue.drain(..count).collect()
    }

    /// Peek the next pending request without removing it.
    pub fn peek_request(&self) -> Option<&TranslationRequest> {
        self.queue.front()
    }

    /// E4-T19: current pending-queue depth (cheap — the live `VecDeque` length). Used by the run
    /// loop to decide when to drain the queue into a batch (accumulate a connected component before
    /// compiling), without cloning the full stats struct on every block boundary.
    pub fn queue_len(&self) -> usize {
        self.queue.len()
    }

    /// The current observable counters (queue depth reflects the live queue length).
    pub fn stats(&self) -> DiscoveryStats {
        DiscoveryStats {
            queue_depth: self.queue.len(),
            candidates: self.counting_len,
            ..self.stats
        }
    }

    /// The live discovery generation (bumped by every invalidation).
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// E4-T21: the current hotness of the pending (or just-drained) block at `phys` — the promotion
    /// threshold plus any extra executions observed while it waited in the nomination queue. Used by
    /// the compile queue to order compilation (hotter first). A block that has run only exactly the
    /// threshold count reports `threshold`; one that kept spinning reports more.
    pub fn queued_hotness(&self, phys: u64) -> u32 {
        self.queued_hotness_with(phys, None)
    }

    /// [`Self::queued_hotness`] including the queued hits buffered in the memo of the block
    /// currently cached at `phys` (if any), i.e. the value the unbuffered map would hold.
    pub(crate) fn queued_hotness_with(&self, phys: u64, memo: Option<DiscMemo>) -> u32 {
        let hits = match self.entries.get(&phys) {
            Some(DiscEntry::Queued { hits, serial }) => {
                let buffered = memo
                    .filter(|m| m.kind == MEMO_QUEUED && m.serial == *serial)
                    .map_or(0, |m| m.pending_hits);
                hits.saturating_add(buffered)
            }
            _ => 0,
        };
        self.threshold.saturating_add(hits)
    }

    /// [`Self::on_block_entry`] for a cached block carrying a [`DiscMemo`] (the run loop's
    /// path). A still-valid memo of a decided block answers the entry without the map: the dedup
    /// is counted and a Queued block's hit is buffered in the memo. Anything else settles the
    /// memo, takes the ordinary decision, and re-caches the resulting decided state. Equivalent to
    /// `on_block_entry` in every counter, decision, request and (via
    /// [`Self::queued_hotness_with`]) hotness.
    #[inline]
    pub(crate) fn on_block_entry_memo(
        &mut self,
        phys: u64,
        ops: &[MicroOp],
        memo: &Cell<DiscMemo>,
    ) {
        let m = memo.get();
        if m.kind != MEMO_NONE && m.epoch == self.decided_epoch && self.admission_probe.is_none() {
            self.stats.deduped = self.stats.deduped.saturating_add(1);
            if m.kind == MEMO_QUEUED {
                memo.set(DiscMemo {
                    pending_hits: m.pending_hits.saturating_add(1),
                    ..m
                });
            }
            return;
        }
        self.on_block_entry_memo_slow(phys, ops, memo);
    }

    #[inline(never)]
    fn on_block_entry_memo_slow(&mut self, phys: u64, ops: &[MicroOp], memo: &Cell<DiscMemo>) {
        self.settle_memo(phys, memo);
        self.on_block_entry(phys, ops);
        let (kind, serial) = match self.entries.get(&phys) {
            Some(DiscEntry::Queued { serial, .. }) => (MEMO_QUEUED, *serial),
            Some(DiscEntry::Excluded) => (MEMO_EXCLUDED, 0),
            _ => return,
        };
        memo.set(DiscMemo {
            epoch: self.decided_epoch,
            serial,
            pending_hits: 0,
            kind,
        });
    }

    /// Fold the queued hits buffered in a block's memo into its entry — only if that entry is
    /// still the nomination they were counted against — and clear the memo. Called before the
    /// block's next slow-path entry and when the block leaves the decoded cache.
    pub(crate) fn settle_memo(&mut self, phys: u64, memo: &Cell<DiscMemo>) {
        let m = memo.replace(DiscMemo::default());
        if m.kind == MEMO_QUEUED
            && m.pending_hits != 0
            && let Some(DiscEntry::Queued { hits, serial }) = self.entries.get_mut(&phys)
            && *serial == m.serial
        {
            *hits = hits.saturating_add(m.pending_hits);
        }
    }

    /// Test view: the hotness counters as the former `phys → count` map.
    #[cfg(test)]
    fn counts(&self) -> U64Map<u32> {
        let mut m = U64Map::new();
        for (k, e) in self.entries.iter() {
            if let DiscEntry::Counting(c) = e {
                m.insert(k, *c);
            }
        }
        m
    }

    /// Test view: the dedup states as the former `phys → NomState` map.
    #[cfg(test)]
    fn state(&self) -> U64Map<NomState> {
        let mut m = U64Map::new();
        for (k, e) in self.entries.iter() {
            match e {
                DiscEntry::Queued { .. } => {
                    m.insert(k, NomState::Queued);
                }
                DiscEntry::Excluded => {
                    m.insert(k, NomState::Excluded);
                }
                DiscEntry::Counting(_) => {}
            }
        }
        m
    }

    /// Test view: the queued-hit priorities as the former `phys → hits` map (an entry exists once
    /// a Queued block has accrued at least one extra hit).
    #[cfg(test)]
    fn queued_hits(&self) -> U64Map<u32> {
        let mut m = U64Map::new();
        for (k, e) in self.entries.iter() {
            if let DiscEntry::Queued { hits, .. } = e
                && *hits > 0
            {
                m.insert(k, *hits);
            }
        }
        m
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_cache_page_index_invalidates_only_indexed_live_slots() {
        let mut cache = BlockCache::with_capacity(64);
        let page_a = 0x8000_0000;
        let page_b = page_a + PAGE;
        let page_c = page_b + PAGE;
        let ops = block().to_vec();

        cache.insert(DecodedBlock::new(page_a, ops.clone(), 8));
        cache.insert(DecodedBlock::new(page_a + 16, ops.clone(), 8));
        cache.insert(DecodedBlock::new(page_b, ops.clone(), 8));
        assert_eq!(
            cache.code_slots.get(&(page_a >> 12)).unwrap().slots.len(),
            2
        );
        assert_eq!(
            cache.code_slots.get(&(page_b >> 12)).unwrap().slots.len(),
            1
        );

        assert!(cache.flush_page(page_a >> 12));
        assert!(cache.get(page_a).is_none());
        assert!(cache.get(page_a + 16).is_none());
        assert!(cache.get(page_b).is_some());
        assert_eq!(cache.invalidation_stats(), (0, 2));
        assert!(
            !cache.flush_page(page_a >> 12),
            "page index entry was retired"
        );

        // Replacing a live slot must unlink the old index entry rather than leave a duplicate
        // that would make a later page flush report a phantom block.
        cache.insert(DecodedBlock::new(page_c, ops.clone(), 8));
        cache.insert(DecodedBlock::new(page_c, ops, 8));
        assert_eq!(
            cache.code_slots.get(&(page_c >> 12)).unwrap().slots.len(),
            1
        );
        assert!(cache.flush_page(page_c >> 12));
        assert_eq!(cache.invalidation_stats(), (0, 3));
        assert!(!cache.flush_page(page_c >> 12));

        // A whole-cache generation flush leaves the stale physical slot ownership in place, but
        // the old page is a generation miss until a new block reactivates it.
        cache.flush();
        assert_ne!(
            cache.code_slots.get(&(page_b >> 12)).unwrap().generation,
            cache.generation
        );
        assert!(!cache.flush_page(page_b >> 12));
        cache.insert(DecodedBlock::new(page_b, block().to_vec(), 8));
        assert!(cache.flush_page(page_b >> 12));
        assert_eq!(cache.invalidation_stats(), (1, 4));

        // Preserve the historical counter when an older-generation slot on a page survives a
        // generation flush and a later insertion activates that same page at another hash slot.
        let mut parity = BlockCache::with_capacity(64);
        let first = 0x8000_0000;
        parity.insert(DecodedBlock::new(first, block().to_vec(), 8));
        parity.flush();
        parity.insert(DecodedBlock::new(first + 2, block().to_vec(), 8));
        assert!(parity.flush_page(first >> 12));
        assert_eq!(parity.invalidation_stats(), (1, 2));

        // Keep stale physical ownership exact across multiple generations. The first page flush
        // consumes generation 1's slot, while a later replacement of that physical slot must not
        // erase generation 2's slot from the next page accounting.
        let mut generations = BlockCache::with_capacity(8);
        generations.insert(DecodedBlock::new(0x8000_60e2, block().to_vec(), 8));
        generations.flush();
        generations.insert(DecodedBlock::new(0x8000_605e, block().to_vec(), 8));
        assert!(generations.flush_page(0x80006));
        assert_eq!(generations.invalidation_stats(), (1, 2));
        generations.insert(DecodedBlock::new(0x8000_6062, block().to_vec(), 8));
        generations.flush();
        generations.insert(DecodedBlock::new(0x8000_608e, block().to_vec(), 8));
        generations.insert(DecodedBlock::new(0x8000_10ec, block().to_vec(), 8));
        assert!(generations.flush_page(0x80006));
        assert_eq!(generations.invalidation_stats(), (2, 4));

        // A page remains a membership hit after its only slot is evicted by replacement, matching
        // the legacy has-code set; the scan simply finds no block to discard.
        let mut evicted = BlockCache::with_capacity(1);
        evicted.insert(DecodedBlock::new(0x8000_0000, block().to_vec(), 8));
        evicted.insert(DecodedBlock::new(0x8000_1000, block().to_vec(), 8));
        assert!(evicted.flush_page(0x80000));
        assert_eq!(evicted.invalidation_stats(), (0, 0));
    }

    #[test]
    fn cold_counter_recycling_disabled_parity_including_admission_observer() {
        let mut control = BlockDiscovery::with_bounds(4, 3);
        let mut explicit_off = BlockDiscovery::with_bounds(4, 3);
        explicit_off.set_cold_counter_recycling(true);
        explicit_off.set_cold_counter_recycling(false);
        for d in [&mut control, &mut explicit_off] {
            d.set_threshold(4);
            d.set_admission_probe(true);
        }
        let ops = block();
        for phys in (0..80).map(|i| (i % 11) * 4096) {
            control.on_block_entry(phys, &ops);
            explicit_off.on_block_entry(phys, &ops);
            assert_eq!(control.stats(), explicit_off.stats());
            assert_eq!(control.counts(), explicit_off.counts());
            assert_eq!(control.state(), explicit_off.state());
            assert_eq!(control.queued_hits(), explicit_off.queued_hits());
            assert_eq!(control.queue, explicit_off.queue);
            assert_eq!(
                control.admission_probe_stats(),
                explicit_off.admission_probe_stats()
            );
        }
        assert!(control.stats().counts_dropped > 0);
        assert!(control.admission_probe_stats().full_map_refusals > 0);
        assert_eq!(
            control.cold_counter_recycling_stats(),
            ColdCounterRecyclingStats {
                threshold: 4,
                capacity: 3,
                ..ColdCounterRecyclingStats::default()
            }
        );
        assert_eq!(
            control.cold_counter_recycling_stats(),
            explicit_off.cold_counter_recycling_stats()
        );
    }

    #[test]
    fn cold_counter_recycling_finite_real_capacity_flood_then_hot_512() {
        // Exercise both the core default and the shipped browser's unchanged threshold.
        for threshold in [HOT_THRESHOLD, 512] {
            for enabled in [false, true] {
                let mut d = BlockDiscovery::new();
                d.set_threshold(threshold);
                d.set_cold_counter_recycling(enabled);
                let ops = block();
                for phys in 0..MAX_COUNTS as u64 {
                    d.on_block_entry(phys * 16, &ops);
                }
                assert_eq!(d.counting_len, MAX_COUNTS);
                // An already counted key at capacity must not start a new epoch.
                d.on_block_entry(0, &ops);
                assert_eq!(d.cold_counter_recycling_stats().epochs, 0);
                let hot = (MAX_COUNTS as u64 + 1) * 16;
                let generation = d.generation();
                for _ in 1..threshold {
                    d.on_block_entry(hot, &ops);
                    assert!(
                        d.queue.is_empty(),
                        "never nominate before the exact threshold"
                    );
                    assert!(d.counting_len <= MAX_COUNTS);
                }
                d.on_block_entry(hot, &ops);
                assert_eq!(d.generation(), generation);
                assert_eq!(d.threshold(), threshold);
                if enabled {
                    assert_eq!(d.stats().nominated, 1);
                    assert_eq!(d.queue.front().unwrap().phys_pc, hot);
                    assert_eq!(d.stats().counts_dropped, 0);
                    assert_eq!(
                        d.cold_counter_recycling_stats(),
                        ColdCounterRecyclingStats {
                            enabled: true,
                            epochs: 1,
                            discarded_counters: MAX_COUNTS as u64,
                            threshold,
                            capacity: MAX_COUNTS,
                        }
                    );
                } else {
                    assert!(d.queue.is_empty());
                    assert_eq!(d.stats().counts_dropped, u64::from(threshold));
                    assert_eq!(d.cold_counter_recycling_stats().epochs, 0);
                }
            }
        }
    }

    #[test]
    fn cold_counter_recycling_preserves_decisions_fifo_priority_generation_and_observer() {
        let mut d = BlockDiscovery::with_bounds(2, 3);
        d.set_threshold(512);
        d.set_admission_probe(true);
        let ops = block();
        let excluded = [MicroOp {
            instr: Instr::Wfi,
            raw: 0x1050_0073,
            len: 4,
        }];
        for (phys, bytes) in [
            (0, &ops[..]),
            (16, &ops[..]),
            (32, &ops[..]),
            (48, &excluded[..]),
        ] {
            for _ in 0..512 {
                d.on_block_entry(phys, bytes);
            }
        }
        for _ in 0..7 {
            d.on_block_entry(16, &ops);
        }
        for phys in [64, 80, 96] {
            d.on_block_entry(phys, &ops);
        }
        d.on_block_entry(112, &ops); // Retain an actual refusal before selection.
        let state = d.state();
        let hits = d.queued_hits();
        let fifo = d.queue.clone();
        let before = d.stats();
        let probe = d.admission_probe_stats();
        let counters = d.counts();
        d.set_cold_counter_recycling(true);
        assert_eq!(
            d.counts(),
            counters,
            "selection itself does not clear history"
        );
        // Revisit an observed identity, then enough new cold keys for four epochs.
        for phys in (112..272).step_by(16) {
            d.on_block_entry(phys, &ops);
            assert!(d.counting_len <= 3);
        }
        assert_eq!(d.state(), state); // Includes Queued-on-overflow and policy Excluded.
        assert_eq!(d.queued_hits(), hits);
        assert_eq!(d.queue, fifo);
        assert_eq!(d.queued_hotness(16), 519);
        assert_eq!(d.generation(), before.generation);
        assert_eq!(d.threshold(), 512);
        assert_eq!(d.stats().nominated, before.nominated);
        assert_eq!(d.stats().excluded, before.excluded);
        assert_eq!(d.stats().dropped_overflow, 1);
        assert_eq!(d.stats().counts_dropped, before.counts_dropped);
        assert_eq!(
            d.cold_counter_recycling_stats(),
            ColdCounterRecyclingStats {
                enabled: true,
                epochs: 4,
                discarded_counters: 12,
                threshold: 512,
                capacity: 3,
            }
        );
        let after = d.admission_probe_stats();
        assert_eq!(after.generation, probe.generation);
        assert_eq!(after.generation_resets, probe.generation_resets);
        assert_eq!(after.full_map_refusals, probe.full_map_refusals);
        assert_eq!(after.records.len(), 1);
        assert_eq!(after.records[0].reasons.counting, 1);
        // Full map is irrelevant to already decided entries: no recycling or re-nomination.
        let epochs = d.cold_counter_recycling_stats();
        d.on_block_entry(32, &ops);
        d.on_block_entry(48, &excluded);
        assert_eq!(d.cold_counter_recycling_stats(), epochs);
        assert_eq!(d.queue, fifo);
    }

    #[test]
    fn cold_counter_recycling_saturating_lifetime_accounting_and_toggle() {
        let mut d = BlockDiscovery::with_bounds(1, 1);
        d.set_cold_counter_recycling(true);
        d.cold_counter_recycling.epochs = u64::MAX - 1;
        d.cold_counter_recycling.discarded_counters = u64::MAX - 1;
        for phys in 0..4 {
            d.on_block_entry(phys, &block());
        }
        assert_eq!(d.cold_counter_recycling_stats().epochs, u64::MAX);
        assert_eq!(
            d.cold_counter_recycling_stats().discarded_counters,
            u64::MAX
        );
        let before = d.cold_counter_recycling_stats();
        d.set_cold_counter_recycling(true);
        d.on_invalidate();
        d.reset();
        assert_eq!(d.cold_counter_recycling_stats(), before);
        d.on_block_entry(0, &block());
        d.set_cold_counter_recycling(false);
        d.on_block_entry(1, &block());
        assert_eq!(d.counting_len, 1);
        assert_eq!(d.stats().counts_dropped, 1);
        assert_eq!(
            d.cold_counter_recycling_stats(),
            ColdCounterRecyclingStats {
                enabled: false,
                ..before
            }
        );
    }
    use crate::decode::Instr;

    #[test]
    fn admission_probe_recurring_full_refusal_exact_identity() {
        let mut d = BlockDiscovery::with_bounds(2, 1);
        d.set_admission_probe(true);
        let ops = block();
        d.on_block_entry(0x1000, &ops);
        for _ in 0..100 {
            d.on_block_entry(u64::MAX - 4095, &ops);
        }
        let stats = d.admission_probe_stats();
        assert!(stats.enabled);
        assert_eq!(stats.observed_entries, 101);
        assert_eq!(stats.full_map_refusals, 100);
        assert_eq!(stats.records.len(), 1);
        let row = &stats.records[0];
        assert_eq!(
            row.request,
            TranslationRequest::from_block(u64::MAX - 4095, &ops, 1)
        );
        assert_eq!(row.entries, 100);
        assert_eq!(row.reasons.counts_full, 100);
        assert_eq!((row.first_entry, row.last_entry), (2, 101));
        assert_eq!((row.first_counts_len, row.last_counts_len), (1, 1));
        assert!(!row.discovery_queued && !row.compile_queued);
        assert_eq!(d.stats().nominated, 0);
    }

    #[test]
    fn admission_probe_separates_changed_bytes_lengths_and_generation() {
        let mut d = BlockDiscovery::with_bounds(2, 1);
        d.set_admission_probe(true);
        let a = [body(0x0010_0093)];
        let b = [body(0x0020_0093)];
        let c = [MicroOp { len: 2, ..a[0] }];
        d.on_block_entry(0, &a);
        for ops in [&a[..], &b[..], &c[..], &a[..]] {
            d.on_block_entry(4096, ops);
        }
        let stats = d.admission_probe_stats();
        assert_eq!(stats.records.len(), 3);
        assert_eq!(
            stats.records.iter().map(|r| r.entries).collect::<Vec<_>>(),
            [2, 1, 1]
        );
        assert_ne!(
            stats.records[0].request.code_bytes,
            stats.records[1].request.code_bytes
        );
        assert_eq!(stats.records[2].request.op_lens, [2]);
        d.on_invalidate();
        assert!(d.admission_probe_stats().records.is_empty());
        d.on_block_entry(0, &a);
        d.on_block_entry(4096, &a);
        let stats = d.admission_probe_stats();
        assert_eq!(stats.generation_resets, 1);
        assert_eq!(stats.records[0].request.generation, 2);
        assert_eq!(stats.records[0].entries, 1);
        assert_eq!(stats.full_map_refusals, 1);
        d.reset();
        assert_eq!(d.admission_probe_stats().generation_resets, 2);
        assert!(d.admission_probe_stats().records.is_empty());
    }

    #[test]
    fn admission_probe_cap_and_invalid_blocks_are_bounded() {
        let mut d = BlockDiscovery::with_bounds(2, 1);
        d.set_admission_probe(true);
        let ops = alloc::vec![body(0x0010_0093); MAX_BLOCK_OPS];
        d.on_block_entry(0, &ops);
        for phys in 1..=40 {
            d.on_block_entry(phys * 4096, &ops);
        }
        // An unretained identity stays unretained; overflow counts entries, not unique keys.
        d.on_block_entry(40 * 4096, &ops);
        d.on_block_entry(4096, &ops);
        let stats = d.admission_probe_stats();
        assert_eq!(stats.records.len(), MAX_ADMISSION_WITNESSES);
        assert_eq!(stats.records.last().unwrap().request.phys_pc, 32 * 4096);
        assert_eq!(stats.overflow_refusals, 9);
        assert_eq!(stats.records[0].entries, 2);
        assert!(
            stats
                .records
                .iter()
                .all(|r| r.request.code_bytes.len() == 512)
        );
        d.on_block_entry(100 * 4096, &alloc::vec![ops[0]; MAX_BLOCK_OPS + 1]);
        d.on_block_entry(100 * 4096, &[]);
        d.on_block_entry(100 * 4096, &[MicroOp { len: 8, ..ops[0] }]);
        assert_eq!(d.admission_probe_stats().invalid_blocks, 3);
        assert_eq!(d.admission_probe_stats().records.len(), 32);
    }

    #[test]
    fn admission_probe_reasons_and_exact_fifo_membership_not_nominal_queued() {
        for (excluded, overflow) in [(false, false), (false, true), (true, false)] {
            let mut d = BlockDiscovery::with_bounds(1, 1);
            d.set_threshold(2);
            d.set_admission_probe(true);
            let cold = block();
            let watched = if excluded {
                alloc::vec![MicroOp {
                    instr: Instr::Wfi,
                    raw: 0x1050_0073,
                    len: 4
                }]
            } else {
                cold.to_vec()
            };
            d.on_block_entry(0, &cold);
            d.on_block_entry(4096, &watched);
            // Free a counter slot by an ordinary nomination. Optionally leave FIFO full.
            d.on_block_entry(0, &cold);
            if !overflow {
                d.take_requests();
            }
            for _ in 0..3 {
                d.on_block_entry(4096, &watched);
            }
            let row = d.admission_probe_stats().records.remove(0);
            assert_eq!(row.entries, 4);
            assert_eq!(row.reasons.counts_full, 1);
            assert_eq!(row.reasons.counting, 1);
            assert_eq!(row.reasons.excluded, u64::from(excluded));
            assert_eq!(row.reasons.fifo_overflow, u64::from(overflow));
            assert_eq!(row.reasons.nominated, u64::from(!excluded && !overflow));
            assert_eq!(row.reasons.dedup_queued, u64::from(!excluded));
            assert_eq!(row.reasons.dedup_excluded, u64::from(excluded));
            assert_eq!(row.discovery_queued, !excluded && !overflow);
            if row.discovery_queued {
                for field in 0..4 {
                    let mut wrong = row.request.clone();
                    match field {
                        0 => wrong.phys_pc += 2,
                        1 => wrong.generation += 1,
                        2 => wrong.code_bytes[0] ^= 1,
                        _ => wrong.op_lens[0] = 2,
                    }
                    assert!(!d.contains_request(&wrong));
                }
                d.take_requests();
                assert!(!d.admission_probe_stats().records[0].discovery_queued);
                assert_eq!(d.state().get(&4096), Some(&NomState::Queued));
            }
        }
    }

    #[test]
    fn admission_probe_default_off_and_decision_parity() {
        let mut off = BlockDiscovery::with_bounds(2, 2);
        let mut on = BlockDiscovery::with_bounds(2, 2);
        on.set_admission_probe(true);
        for d in [&mut off, &mut on] {
            d.set_threshold(3);
        }
        let ops = block();
        for phys in [
            0, 4096, 8192, 8192, 0, 0, 8192, 8192, 8192, 4096, 4096, 12288, 12288, 12288,
        ] {
            off.on_block_entry(phys, &ops);
            on.on_block_entry(phys, &ops);
            assert_eq!(off.stats(), on.stats());
            assert_eq!(off.counts(), on.counts());
            assert_eq!(off.state(), on.state());
            assert_eq!(off.queue, on.queue);
            assert_eq!(off.queued_hits(), on.queued_hits());
            assert!(off.admission_probe.is_none());
        }
        assert!(!off.admission_probe_stats().enabled);
        assert_eq!(off.admission_probe_stats().records.capacity(), 0);
        assert!(!on.admission_probe_stats().records.is_empty());
        let retained = on.admission_probe_stats();
        on.set_admission_probe(true);
        assert_eq!(retained, on.admission_probe_stats());
        on.set_admission_probe(false);
        assert!(on.admission_probe.is_none());
        assert_eq!(off.take_requests(), on.take_requests());
    }

    /// A non-terminator body op (`addi`), 4 bytes, with a distinguishable raw word.
    fn body(raw: u32) -> MicroOp {
        MicroOp {
            instr: Instr::Addi {
                rd: 1,
                rs1: 0,
                imm: 1,
            },
            len: 4,
            raw,
        }
    }

    /// A `beq` terminator, 4 bytes.
    fn term(raw: u32) -> MicroOp {
        MicroOp {
            instr: Instr::Beq {
                rs1: 0,
                rs2: 0,
                imm: 8,
            },
            len: 4,
            raw,
        }
    }

    /// A minimal hot block: one body op + a branch terminator.
    fn block() -> [MicroOp; 2] {
        [body(0x0010_8093), term(0x0000_0063)]
    }

    /// The block-memo entry path must be indistinguishable from the map path: two front ends fed
    /// the same seeded stream — one through `on_block_entry`, one through `on_block_entry_memo`
    /// with a memo per resident block — must agree on every stat, every hotness (the memo side
    /// through `queued_hotness_with` and the resident block's memo), the FIFO and the admission
    /// observer, across renominations, invalidations, resets, evictions (settle + fresh memo),
    /// memos that survive an invalidation, admission-probe toggles, queue overflow and small caps.
    #[test]
    fn discovery_memo_is_equivalent_to_the_map_path() {
        let wfi = MicroOp {
            instr: Instr::Wfi,
            len: 4,
            raw: 0x1050_0073,
        };
        let hot = block();
        let excluded = [body(0x0010_8093), wfi];
        let phys: alloc::vec::Vec<u64> = (0..12).map(|i| 0x8000_0000 + 0x40 * i).collect();
        let ops = |i: usize| -> &[MicroOp] { if i % 5 == 4 { &excluded } else { &hot } };
        let mut rng = 0x9e37_79b9_7f4a_7c15u64;
        let mut next = move || {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            rng
        };
        for (threshold, queue_cap, counts_cap) in [(1, 64, 64), (3, 4, 64), (7, 64, 5), (2, 2, 3)] {
            let mut plain = BlockDiscovery::with_bounds(queue_cap, counts_cap);
            let mut memo = BlockDiscovery::with_bounds(queue_cap, counts_cap);
            plain.set_threshold(threshold);
            memo.set_threshold(threshold);
            let mut cells: alloc::vec::Vec<Cell<DiscMemo>> = (0..phys.len())
                .map(|_| Cell::new(DiscMemo::default()))
                .collect();
            let mut fast_entries = 0u64;
            for step in 0..40_000u32 {
                let r = next();
                let i = (r % phys.len() as u64) as usize;
                match (r >> 16) % 400 {
                    0 => {
                        plain.renominate(phys[i]);
                        memo.renominate(phys[i]);
                    }
                    1 => {
                        // Blocks on other pages survive an invalidation with their (now stale) memo.
                        plain.on_invalidate();
                        memo.on_invalidate();
                    }
                    2 => {
                        plain.reset();
                        memo.reset();
                    }
                    3..=9 => {
                        // The block leaves the cache; a rebuilt block starts with a fresh memo.
                        memo.settle_memo(phys[i], &cells[i]);
                        cells[i] = Cell::new(DiscMemo::default());
                    }
                    10 => {
                        let n = (r >> 32) as usize % 3;
                        assert_eq!(
                            plain.take_requests_bounded(n),
                            memo.take_requests_bounded(n)
                        );
                    }
                    11 => {
                        let on = (r >> 40) & 1 == 1;
                        plain.set_admission_probe(on);
                        memo.set_admission_probe(on);
                    }
                    _ => {
                        let before = cells[i].get();
                        plain.on_block_entry(phys[i], ops(i));
                        memo.on_block_entry_memo(phys[i], ops(i), &cells[i]);
                        if before.kind != MEMO_NONE && before.epoch == cells[i].get().epoch {
                            fast_entries += 1;
                        }
                    }
                }
                assert_eq!(plain.stats(), memo.stats(), "step {step}");
                assert_eq!(plain.admission_probe_stats(), memo.admission_probe_stats());
                for (j, &p) in phys.iter().enumerate() {
                    assert_eq!(
                        plain.queued_hotness(p),
                        memo.queued_hotness_with(p, Some(cells[j].get())),
                        "step {step} block {j}"
                    );
                }
            }
            assert!(
                fast_entries > 10_000,
                "the memo path must engage: {fast_entries}"
            );
            // Settled, the memo side's maps are exactly the map path's.
            for (j, &p) in phys.iter().enumerate() {
                memo.settle_memo(p, &cells[j]);
            }
            assert_eq!(plain.counts(), memo.counts());
            assert_eq!(plain.state(), memo.state());
            assert_eq!(plain.queued_hits(), memo.queued_hits());
            assert_eq!(plain.take_requests(), memo.take_requests());
        }
    }

    #[test]
    fn counter_increments_and_fires_exactly_once() {
        let mut d = BlockDiscovery::new();
        let ops = block();
        // Execute the block far more than the threshold.
        for _ in 0..1000 {
            d.on_block_entry(0x8000_0000, &ops);
        }
        let s = d.stats();
        // Fires EXACTLY once — one request, not 937.
        assert_eq!(s.nominated, 1, "threshold must fire exactly once");
        assert_eq!(s.queue_depth, 1);
        // Every post-threshold execution was deduped: 1000 - 64 = 936.
        assert_eq!(s.deduped, 1000 - u64::from(HOT_THRESHOLD));
    }

    #[test]
    fn no_nomination_below_threshold() {
        let mut d = BlockDiscovery::new();
        let ops = block();
        for _ in 0..(HOT_THRESHOLD - 1) {
            d.on_block_entry(0x8000_0000, &ops);
        }
        assert_eq!(
            d.stats().nominated,
            0,
            "must not nominate before the 64th entry"
        );
        // The 64th entry nominates.
        d.on_block_entry(0x8000_0000, &ops);
        assert_eq!(d.stats().nominated, 1);
    }

    #[test]
    fn dedup_across_distinct_blocks() {
        let mut d = BlockDiscovery::new();
        let a = block();
        let b = block();
        for _ in 0..HOT_THRESHOLD {
            d.on_block_entry(0x8000_0000, &a);
            d.on_block_entry(0x9000_0000, &b);
        }
        let s = d.stats();
        assert_eq!(
            s.nominated, 2,
            "two distinct hot blocks nominate independently"
        );
        assert_eq!(s.queue_depth, 2);
    }

    #[test]
    fn translation_request_shape() {
        let mut d = BlockDiscovery::new();
        let ops = block();
        for _ in 0..HOT_THRESHOLD {
            d.on_block_entry(0x8000_0000, &ops);
        }
        let reqs = d.take_requests();
        assert_eq!(reqs.len(), 1);
        let r = &reqs[0];
        assert_eq!(r.phys_pc, 0x8000_0000);
        assert_eq!(r.terminator, TerminatorKind::Branch);
        assert_eq!(r.op_lens, alloc::vec![4u8, 4u8]);
        assert_eq!(r.generation, 1);
        // Bytes are the little-endian raw words of the two ops.
        assert_eq!(
            r.code_bytes,
            alloc::vec![0x93, 0x80, 0x10, 0x00, 0x63, 0x00, 0x00, 0x00]
        );
        // Draining emptied the queue.
        assert_eq!(d.stats().queue_depth, 0);
    }

    #[test]
    fn csr_and_wfi_blocks_are_excluded() {
        let mut d = BlockDiscovery::new();
        let csr = [MicroOp {
            instr: Instr::Csrrw {
                rd: 0,
                rs1: 1,
                csr: 0x300,
            },
            len: 4,
            raw: 0x3000_9073,
        }];
        let wfi = [MicroOp {
            instr: Instr::Wfi,
            len: 4,
            raw: 0x1050_0073,
        }];
        for _ in 0..HOT_THRESHOLD {
            d.on_block_entry(0x8000_0000, &csr);
            d.on_block_entry(0x9000_0000, &wfi);
        }
        let s = d.stats();
        assert_eq!(s.nominated, 0, "excluded blocks never enqueue");
        assert_eq!(s.excluded, 2);
        assert_eq!(s.queue_depth, 0);
    }

    #[test]
    fn requeue_after_invalidation_no_stale_survives() {
        let mut d = BlockDiscovery::new();
        let old = block();
        for _ in 0..HOT_THRESHOLD {
            d.on_block_entry(0x8000_0000, &old);
        }
        let stale = d.take_requests().pop().unwrap();
        assert_eq!(stale.generation, 1);

        // Invalidate (fence.i / SMC): the block is re-decoded DIFFERENTLY.
        d.on_invalidate();
        assert_eq!(d.generation(), 2);

        // The OLD request must fail install validation against the NEW bytes AND the bumped gen.
        let new_ops = [body(0xDEAD_BEEF), term(0x0000_0063)];
        let new_bytes: alloc::vec::Vec<u8> = {
            let mut v = alloc::vec::Vec::new();
            for op in &new_ops {
                for b in 0..op.len {
                    v.push((op.raw >> (8 * u32::from(b))) as u8);
                }
            }
            v
        };
        assert!(
            !d.install_check(&stale, &new_bytes),
            "stale request must never install against new bytes"
        );
        assert_eq!(d.stats().dropped_stale, 1);

        // The re-decoded hot block RE-NOMINATES afresh with the new generation + new bytes.
        for _ in 0..HOT_THRESHOLD {
            d.on_block_entry(0x8000_0000, &new_ops);
        }
        let fresh = d.take_requests().pop().unwrap();
        assert_eq!(
            fresh.generation, 2,
            "re-nomination carries the new generation"
        );
        assert_eq!(fresh.code_bytes, new_bytes);
        // A fresh request DOES validate against live (new) bytes.
        assert!(d.install_check(&fresh, &new_bytes));
    }

    #[test]
    fn stale_generation_alone_blocks_install_even_if_bytes_match() {
        // Race the generation check: bytes unchanged but an invalidation bumped the generation.
        let mut d = BlockDiscovery::new();
        let ops = block();
        for _ in 0..HOT_THRESHOLD {
            d.on_block_entry(0x8000_0000, &ops);
        }
        let req = d.take_requests().pop().unwrap();
        let live = req.code_bytes.clone();
        assert!(
            d.install_check(&req, &live),
            "current-gen matching request installs"
        );
        d.on_invalidate();
        assert!(
            !d.install_check(&req, &live),
            "same bytes but stale generation must NOT install"
        );
    }

    #[test]
    fn queue_overflow_degrades_gracefully() {
        // Tiny queue; flood with unique hot blocks — the queue is bounded and overflow counted.
        let mut d = BlockDiscovery::with_bounds(4, 1 << 20);
        let ops = block();
        for i in 0..100u64 {
            let phys = 0x8000_0000 + i * 0x1000;
            for _ in 0..HOT_THRESHOLD {
                d.on_block_entry(phys, &ops);
            }
        }
        let s = d.stats();
        assert_eq!(s.queue_depth, 4, "queue never exceeds its bound");
        assert_eq!(s.nominated, 4);
        assert_eq!(
            s.dropped_overflow, 96,
            "excess nominations dropped + counted"
        );
    }

    #[test]
    fn counter_map_is_bounded_under_cold_flood() {
        // Tiny counter cap; flood with unique COLD blocks (each entered once) — the map is bounded
        // and untracked cold blocks are counted, never leaking.
        let mut d = BlockDiscovery::with_bounds(1 << 20, 8);
        let ops = block();
        for i in 0..1000u64 {
            d.on_block_entry(0x8000_0000 + i * 0x1000, &ops);
        }
        let s = d.stats();
        assert!(s.candidates <= 8, "counter map stays within its cap");
        assert_eq!(s.counts_dropped, 1000 - 8);
        assert_eq!(s.nominated, 0);
    }

    #[test]
    fn reset_clears_state_and_bumps_generation() {
        let mut d = BlockDiscovery::new();
        let ops = block();
        for _ in 0..HOT_THRESHOLD {
            d.on_block_entry(0x8000_0000, &ops);
        }
        assert_eq!(d.stats().nominated, 1);
        d.reset();
        let s = d.stats();
        assert_eq!(s.nominated, 0);
        assert_eq!(s.queue_depth, 0);
        assert_eq!(s.generation, 2);
    }
}
