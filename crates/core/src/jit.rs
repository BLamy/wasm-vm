//! E4-T10: the platform boundary between the `no_std` core dispatch loop and a compiled-block
//! executor.
//!
//! `crates/core` is `no_std` and cannot host a WASM engine, so it never *runs* translated blocks
//! itself. Instead it defines the [`CompiledBlockExecutor`] trait: the run loop asks the executor
//! (a) whether the block at a physical PC is compiled ([`CompiledBlockExecutor::is_compiled`]) and,
//! if so, (b) to execute it against the live [`Hart`] + [`SystemBus`]
//! ([`CompiledBlockExecutor::execute`]), returning the frozen E4-T06 [`JitExit`] protocol. A native
//! crate (`wasm-vm-jit-runtime`) implements the trait with wasmtime; the browser executor
//! (`WebAssembly.Module`) is a later ticket (E4-T19). Core holds no engine and stays `no_std`.
//!
//! The executor reaches guest memory through the SAME [`Hart`]/[`SystemBus`] the interpreter uses
//! ([`Hart::jit_load`] / [`Hart::jit_store`]), so a JIT load/store is translated, PMP-checked, and
//! routed to RAM/MMIO byte-identically to the interpreter — and a faulting access unwinds the block
//! (executor returns `None`) so the run loop falls back to interpreting it, leaving hart state
//! untouched (precise deopt for the E4-T09 translator's never-faulting memory ABI).

use crate::dispatch::DecodedBlock;
use crate::hart::Hart;
use crate::mmio::SystemBus;
use alloc::boxed::Box;

/// The frozen `CpuState` linear-memory offsets (`docs/jit-architecture.md` §3.1). These MUST match
/// `jit_translate::Abi::FROZEN`; the executor syncs guest registers to `XREG_BASE` and reads the
/// exit protocol back from `EXIT_*`.
pub mod abi {
    /// Base of the `x[0..32]` guest integer register array (each register 8 bytes).
    pub const XREG_BASE: u32 = 0x000;
    /// `exit_reason` — the [`super::ExitCode`] the block wrote before returning.
    pub const EXIT_REASON: u32 = 0x218;
    /// `exit_pc` — the guest PC to resume at.
    pub const EXIT_PC: u32 = 0x220;
    /// `exit_info` — aux payload (trap cause for `ecall`/`ebreak`).
    pub const EXIT_INFO: u32 = 0x228;
    /// E4-T16 `entry_pc` — the guest VIRTUAL PC the block is entered at. The executor writes the
    /// live `hart.regs.pc` here before each `run` call; the compiled block reads it and emits every
    /// guest-visible PC relative to it, so translated control flow is correct under paging (guest
    /// virtual PC != physical block key) and when a physically-keyed block is reused from a new VA.
    pub const ENTRY_PC: u32 = 0x230;
}

/// The frozen exit-code enum (`docs/jit-architecture.md` §3.3). The E4-T09 translator emits only
/// the first three; the rest are reserved for later tickets and surfaced here so the run loop can
/// fall back defensively if it ever sees one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitCode {
    /// Block ran to its end; resume at `next_pc`.
    Fallthrough,
    /// Taken conditional branch / `jal` / `jalr`; resume at `next_pc`.
    BranchTaken,
    /// A guest trap (`ecall`/`ebreak`) must be delivered at `next_pc`.
    Trap,
    /// Any reserved variant (MMIO/MMU_MISS/CALL_INTERP/NOT_COMPILED/BUDGET/INTERRUPT_POLL) — not
    /// produced by the E4-T09 translator; treated as a fall-back-to-interpreter signal.
    Reserved(i32),
}

impl ExitCode {
    /// Decode the `i32` a compiled `run` returns.
    pub fn from_i32(v: i32) -> Self {
        match v {
            0 => ExitCode::Fallthrough,
            1 => ExitCode::BranchTaken,
            2 => ExitCode::Trap,
            other => ExitCode::Reserved(other),
        }
    }
}

/// The result of a compiled-block execution. `next_pc` / `exit_info` mirror the header slots the
/// block wrote before returning.
///
/// E4-T12 adds `trap`: a PRECISE memory-fault side-exit. When a load/store in a compiled block
/// faults, the runtime does NOT unwind-and-re-interpret (which would re-execute any committing
/// side-effect earlier in the block — the MMIO-write-then-fault double-execute bug); instead it
/// reads back the block's already-written-back register file + faulting PC (the writeback-before-
/// any-trapping-op discipline, `docs/jit-architecture.md` §4) and hands the exact interpreter-
/// produced [`Trap`](crate::hart::Trap) here. The run loop delivers it through the normal
/// `take_trap` path, so mcause/mtval/mepc are produced by the ONE trusted trap implementation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JitExit {
    /// The exit code the block returned.
    pub code: ExitCode,
    /// Guest PC to resume at (the header `exit_pc`) — for a `Trap`/mem-fault exit this is the
    /// faulting instruction's PC (→ `mepc`).
    pub next_pc: u64,
    /// Aux payload (the header `exit_info`): trap cause for an `ecall`/`ebreak` `Trap` exit.
    pub exit_info: u64,
    /// `Some` iff a load/store faulted: the precise trap (cause + `mtval`) the interpreter's own
    /// translated/PMP-checked access path produced. The register file in the module's `CpuState`
    /// region is architecturally precise as of the instruction BEFORE the faulting one, and the
    /// runtime has already synced it back into `hart.regs`.
    pub trap: Option<crate::hart::Trap>,
}

/// The platform-boundary trait the run loop calls to run T2 (compiled) blocks. Implemented natively
/// by `wasm-vm-jit-runtime` (wasmtime); the browser impl is E4-T19. Object-safe so [`Machine`] can
/// hold a `Box<dyn CompiledBlockExecutor>` without pulling any engine into `no_std` core.
///
/// [`Machine`]: crate::Machine
pub trait CompiledBlockExecutor {
    /// Translate + compile + register the block keyed by its `phys_start`. A block the executor
    /// cannot translate (out-of-scope opcode) is silently skipped (it stays in the interpreter).
    fn install(&mut self, block: &DecodedBlock);

    /// Is a compiled block registered for physical entry PC `phys_pc`?
    fn is_compiled(&self, phys_pc: u64) -> bool;

    /// Execute the compiled block for `phys_pc` against the live `hart`/`bus`. Guest registers are
    /// synced into the module's `CpuState` region before the call and read back into `hart.regs`
    /// on a clean return; guest memory is reached through `hart`'s translated load/store path so
    /// effects match the interpreter exactly.
    ///
    /// Returns `Some(exit)` on a clean return, or `None` if the block faulted out (a bus fault in a
    /// load/store import) — in which case `hart` state is LEFT UNTOUCHED so the run loop can fall
    /// back to interpreting the block from its entry.
    fn execute(&mut self, phys_pc: u64, hart: &mut Hart, bus: &mut SystemBus) -> Option<JitExit>;

    /// Drop every compiled block (`fence.i` / whole-cache flush / reset / snapshot restore).
    fn invalidate_all(&mut self);

    /// Drop every compiled block whose physical page frame is `frame` (SMC / DMA-into-code).
    fn invalidate_page(&mut self, frame: u64);

    /// Number of blocks currently compiled + registered.
    fn compiled_count(&self) -> usize;

    /// Count of compiled blocks executed via the JIT over this run (the "JIT actually ran" proof).
    fn executed_blocks(&self) -> u64;

    /// Count of guest instructions retired inside JIT-executed blocks (numerator of the
    /// translated-instruction ratio).
    fn retired_via_jit(&self) -> u64;

    // ── E4-T18: block chaining (default impls: a non-chaining executor is a valid degenerate) ──

    /// A/B flag: enable/disable direct block→block chaining. With chaining off every block returns
    /// to the dispatch loop (the E4-T10 behavior); with it on the dispatch loop follows link-slots.
    fn set_chaining(&mut self, _on: bool) {}

    /// Whether chaining is currently enabled.
    fn chaining(&self) -> bool {
        false
    }

    /// Set the chain-depth budget (max links per chain before a mandatory dispatch return, ≥ 1).
    fn set_chain_depth_budget(&mut self, _n: u32) {}

    /// The current chain-depth budget.
    fn chain_depth_budget(&self) -> u32 {
        1
    }

    /// Lazily link `edge` (0 = taken / sole / fall-through successor, 1 = not-taken) of the block at
    /// `from_phys` to the compiled successor at `to_phys`, recording the edge in the incoming-edges
    /// map. A no-op if either block is not live-compiled, `edge` is out of range for the block
    /// (a dynamic `jalr` target passes an out-of-range edge so it is never linked), the edge is
    /// already linked to the same target, or chaining is off. Counts one `links_made` on the
    /// transition from stub → linked.
    fn link_edge(&mut self, _from_phys: u64, _edge: u8, _to_phys: u64) {}

    /// The successor a block's link-slot currently points at, or `None` if the slot holds the
    /// dispatch stub / the edge is out of range / the block is not compiled. Used by the dispatch
    /// loop to follow a link and by the unlink-completeness test to assert slot contents.
    fn linked_target(&self, _from_phys: u64, _edge: u8) -> Option<u64> {
        None
    }

    /// Record that a chain of `depth` links returned to the dispatch loop (updates the histogram,
    /// `max_chain_depth`, and `dispatch_entries`).
    fn note_chain(&mut self, _depth: u32) {}

    /// A snapshot of the chaining statistics (links made/cut, dispatch entries, depth histogram).
    fn chain_stats(&self) -> ChainStats {
        ChainStats::default()
    }
}

/// A boxed executor, held by [`Machine`](crate::Machine). Aliased for readability at the field.
pub type BoxedExecutor = Box<dyn CompiledBlockExecutor>;

// ── E4-T18: block chaining (direct linking + safe unlinking) ─────────────────

/// E4-T18 default chain-depth budget: the maximum number of direct block→block links traversed
/// before the chain MUST return to the dispatch loop. This bounds (a) unbounded wasm call-stack
/// growth in the browser in-wasm `call_indirect` epilogue form (the native wasmtime orchestration
/// cannot grow the wasm stack — every `execute` fully returns — but it honors the identical budget
/// so the two backends behave the same), and (b) starvation of the boundary poll. `32` mirrors the
/// order-of-magnitude of the E4-T08 hotness threshold / batching unit and keeps the dispatch-loop
/// re-entry frequent enough that device/interrupt sampling stays responsive; it is a tunable
/// (`Machine::set_chain_depth_budget`), swept against the ledger like the other budgets. Interrupt
/// latency itself does NOT depend on this number — the instruction/interrupt budget is checked at
/// EVERY link (see `Machine::try_jit_block`), so a timer is delivered within one block (≤128 ops)
/// of becoming pending regardless of the chain-depth budget, even at budget = 1 (degenerate).
pub const CHAIN_DEPTH_BUDGET_DEFAULT: u32 = 32;

/// Number of buckets in the chain-depth histogram (`ChainStats::depth_hist`). Depth `d` is counted
/// in bucket `min(d, CHAIN_DEPTH_HIST_LEN - 1)`, so the last bucket is "that-many-or-more links".
pub const CHAIN_DEPTH_HIST_LEN: usize = 65;

/// E4-T18 chaining statistics (A/B + the histogram the ticket asks for). All counters are cumulative
/// across a run; `invalidate_all` tears live links down (counted in `links_cut`) but preserves the
/// counters so an A/B report survives a cache toggle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChainStats {
    /// Edges linked (a link-slot written from the dispatch stub to a live successor's table index).
    /// Counted once per distinct edge — re-traversing an already-linked edge does not re-count.
    pub links_made: u64,
    /// Link-slots restored to the dispatch stub by an invalidation (SMC / fence.i-path / eviction /
    /// reset). The unlink-completeness invariant: after any invalidation NO live slot points into a
    /// dead block, and every such restoration is counted here.
    pub links_cut: u64,
    /// Times a chain ended and control returned to the dispatch loop (the "dispatch-loop entries"
    /// stat — one per chain, however many links it followed).
    pub dispatch_entries: u64,
    /// The deepest chain (most links followed before a dispatch return) seen this run.
    pub max_chain_depth: u32,
    /// Histogram of chain depths: `depth_hist[min(depth, LEN-1)]` incremented per dispatch entry.
    pub depth_hist: [u64; CHAIN_DEPTH_HIST_LEN],
}

impl Default for ChainStats {
    fn default() -> Self {
        ChainStats {
            links_made: 0,
            links_cut: 0,
            dispatch_entries: 0,
            max_chain_depth: 0,
            depth_hist: [0; CHAIN_DEPTH_HIST_LEN],
        }
    }
}

impl ChainStats {
    /// Total links followed across all chains this run (Σ depth) — the numerator of "links per
    /// dispatch entry", the direct measure of how much dispatch-loop bouncing chaining removed.
    pub fn total_links_followed(&self) -> u64 {
        self.depth_hist
            .iter()
            .enumerate()
            .map(|(d, n)| d as u64 * n)
            .sum()
    }
}
