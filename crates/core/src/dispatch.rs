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
use alloc::collections::{BTreeMap, BTreeSet, VecDeque};
use alloc::vec::Vec;

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
/// re-nominated afresh (with new bytes + a new generation).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NomState {
    /// Nominated: a request is (or was) enqueued for this block. Suppresses re-nomination.
    Queued,
    /// Excluded from translation (CSR/wfi terminator). Suppresses counting + nomination.
    Excluded,
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

/// The E4-T08 block-discovery front end: hotness counters, the dedup state machine, the
/// bounded nomination FIFO, the invalidation generation, and the observable stats. Owned by
/// the `Machine` alongside the [`BlockCache`]; driven only when the block cache is enabled.
pub struct BlockDiscovery {
    /// Invalidation generation. Bumped by fence.i / SMC page-flush / whole-cache flush; the
    /// stamp every fresh request carries and the value install-time validation compares against.
    generation: u64,
    /// Live per-block execution counters (phys entry PC → saturating count), current generation.
    /// A block leaves this map the moment it is nominated (or excluded).
    counts: BTreeMap<u64, u32>,
    /// Dedup state for blocks past the threshold (phys entry PC → [`NomState`]).
    state: BTreeMap<u64, NomState>,
    /// E4-T21: extra executions observed for a block AFTER it was nominated (Queued) but BEFORE its
    /// compile has been installed — the "how hot is this pending job" signal the compile queue orders
    /// by, so a block still running hot while it waits compiles ahead of a one-shot straggler.
    /// Cleared by every invalidation / renominate (its priority is meaningless once re-nominated).
    queued_hits: BTreeMap<u64, u32>,
    /// Bounded FIFO of pending nominations.
    queue: VecDeque<TranslationRequest>,
    stats: DiscoveryStats,
    queue_cap: usize,
    counts_cap: usize,
    /// Promotion threshold (defaults to [`HOT_THRESHOLD`]). Runtime-tunable — E4-T08 owns the
    /// swept value; the design-doc number is the starting point, falsifiable by a ledger regression.
    threshold: u32,
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
            counts: BTreeMap::new(),
            state: BTreeMap::new(),
            queued_hits: BTreeMap::new(),
            queue: VecDeque::new(),
            stats: DiscoveryStats {
                generation: 1,
                ..DiscoveryStats::default()
            },
            queue_cap: queue_cap.max(1),
            counts_cap: counts_cap.max(1),
            threshold: HOT_THRESHOLD,
        }
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
        self.counts.clear();
        self.state.clear();
        self.queued_hits.clear();
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
        self.counts.remove(&phys_pc);
        self.state.remove(&phys_pc);
        self.queued_hits.remove(&phys_pc);
    }

    /// Record an invalidation (fence.i / SMC page-flush / whole-cache flush): bump the
    /// generation and clear the per-block hotness + dedup state so a re-decoded hot block is
    /// re-nominated from scratch. Pending queued requests are LEFT in place deliberately — they
    /// now carry a stale generation and are dropped at [`Self::install_check`], which is what the
    /// adversarial "never install stale bytes" test observes. Cheap: two `clear`s of typically
    /// small maps.
    pub fn on_invalidate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.stats.generation = self.generation;
        self.counts.clear();
        self.state.clear();
        self.queued_hits.clear();
    }

    /// Note one execution (entry) of the block at physical `phys` whose walked ops are `ops`.
    /// Bumps the saturating counter; on crossing [`HOT_THRESHOLD`] exactly once, nominates the
    /// block (or marks it excluded). Dedup: a block already past the threshold returns
    /// immediately. This is the hot-path hook — cheap for the common (already-decided or
    /// still-cold) block: one map probe plus, while cold, one increment.
    pub fn on_block_entry(&mut self, phys: u64, ops: &[MicroOp]) {
        // Already decided (nominated or excluded): dedup — never re-enqueue.
        if let Some(st) = self.state.get(&phys) {
            self.stats.deduped = self.stats.deduped.saturating_add(1);
            // E4-T21: a still-hot Queued block keeps accruing priority while it waits to compile.
            if *st == NomState::Queued {
                let h = self.queued_hits.entry(phys).or_insert(0);
                *h = h.saturating_add(1);
            }
            return;
        }
        let count = match self.counts.get_mut(&phys) {
            Some(c) => {
                *c = c.saturating_add(1);
                *c
            }
            None => {
                if self.counts.len() >= self.counts_cap {
                    // Counter map full: stop tracking new cold blocks (flood bound).
                    self.stats.counts_dropped = self.stats.counts_dropped.saturating_add(1);
                    return;
                }
                self.counts.insert(phys, 1);
                1
            }
        };
        if count == self.threshold {
            self.nominate(phys, ops);
        }
    }

    /// Transition a block past the threshold: drop it from the counter map, then either exclude
    /// it (CSR/wfi terminator) or push a fresh [`TranslationRequest`]. Marks the block Queued/
    /// Excluded so it never re-nominates within this generation (dedup). Fires EXACTLY once per
    /// block per generation because the caller only reaches here on `count == HOT_THRESHOLD`.
    fn nominate(&mut self, phys: u64, ops: &[MicroOp]) {
        self.counts.remove(&phys);
        let term = TerminatorKind::of_block(ops);
        if term.is_excluded() {
            self.state.insert(phys, NomState::Excluded);
            self.stats.excluded = self.stats.excluded.saturating_add(1);
            return;
        }
        // Mark Queued regardless of whether the push succeeds, so an overflow-dropped block does
        // not re-nominate every subsequent execution (no renomination storm).
        self.state.insert(phys, NomState::Queued);
        if self.queue.len() >= self.queue_cap {
            self.stats.dropped_overflow = self.stats.dropped_overflow.saturating_add(1);
            return;
        }
        self.queue
            .push_back(TranslationRequest::from_block(phys, ops, self.generation));
        self.stats.nominated = self.stats.nominated.saturating_add(1);
        if self.queue.len() > self.stats.queue_hwm {
            self.stats.queue_hwm = self.queue.len();
        }
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
            candidates: self.counts.len(),
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
        self.threshold
            .saturating_add(self.queued_hits.get(&phys).copied().unwrap_or(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decode::Instr;

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
