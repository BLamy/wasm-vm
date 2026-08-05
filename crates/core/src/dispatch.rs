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
}

impl BlockCache {
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
        }
    }

    /// Invalidate the entire cache in O(1) (generation bump). Every block built in an older
    /// generation becomes invisible.
    pub fn flush(&mut self) {
        self.generation = self.generation.wrapping_add(1);
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

    /// Insert `block` (stamped with the current generation), replacing a stale/empty slot on
    /// its probe chain, or — if the chain is full of live entries — the head slot (simple
    /// replacement; correctness is unaffected).
    pub fn insert(&mut self, mut block: DecodedBlock) {
        block.block_gen = self.generation;
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
