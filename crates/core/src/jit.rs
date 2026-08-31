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
//! routed to RAM/MMIO byte-identically to the interpreter. A recorded guest fault returns a precise
//! [`JitExit`]; an unclassified engine failure after dispatch must fail closed because an imported
//! access may already have committed a side effect. `None` is reserved for a pre-call cache miss,
//! where interpreting from the same entry is provably replay-safe.

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
    /// End of the integer-register array.
    pub const XREG_END: u32 = XREG_BASE + 32 * 8;
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
    /// Exclusive end of the state transferred between a hart and a compiled module.
    pub const HANDOFF_END: u32 = ENTRY_PC + 8;
    /// Exact byte length of the one-call CPU-state handoff.
    pub const HANDOFF_LEN: usize = (HANDOFF_END - XREG_BASE) as usize;
    /// E4-T34: total retired instructions committed by the current in-module chain. This lives
    /// immediately after the frozen handoff and is not copied to/from the private SoftMMU state
    /// view; browser inline-memory executors use it as a shared chain accumulator.
    pub const CHAIN_RETIRED: u32 = HANDOFF_END;
    /// E4-T34: remaining guest-work fuel for an in-module chain. A successor that cannot fit
    /// returns [`super::ExitCode::Budget`] without executing an instruction.
    pub const CHAIN_BUDGET: u32 = CHAIN_RETIRED + 8;
    /// E4-T34: import-side side-effect barrier. A load that resolves to MMIO/misaligned memory,
    /// a host-visible store/atomic import, or a raw inline-RAM store that targets a live compiled
    /// page sets this byte so the current block returns to Rust before a successor can be called
    /// directly. Pending raw data-page stores are guarded separately before LR/SC/AMO operations.
    pub const CHAIN_ABORT: u32 = CHAIN_BUDGET + 8;
    /// E4-T19/E4-T34 intra-module chaining flag. It is deliberately outside [`HANDOFF_END`]: the
    /// native executor leaves it zero, while the browser inline-memory executor enables it only for
    /// a bounded, interrupt-safe chain.
    pub const CHAIN_ENABLED: u32 = 0x250;
    /// E4-T34: count of raw inline-RAM stores waiting for the host-side reservation and code-write
    /// commit. Stored as an i64 so generated code can update it without widening/narrowing.
    pub const CHAIN_STORE_COUNT: u32 = CHAIN_ENABLED + 8;
    /// E4-T34: remaining compiled-block entries allowed in the current direct chain. The browser
    /// executor initializes this from `CompiledBlockExecutor::chain_depth_budget` and decrements it
    /// at each generated-function entry, so the in-module call stack observes the same bound as the
    /// native dispatch loop.
    pub const CHAIN_DEPTH: u32 = CHAIN_STORE_COUNT + 8;
    /// E4-T34: first `{virtual address, physical address, width}` raw-store record.
    pub const CHAIN_STORE_BASE: u32 = CHAIN_DEPTH + 8;
    /// E4-T34: byte size of one raw-store record.
    pub const CHAIN_STORE_ENTRY_BYTES: u32 = 24;
    /// E4-T34: bounded number of raw stores a direct-chain call can record. The direct-chain fuel is
    /// currently no larger than this, so a full log always takes the exact imported slow path.
    pub const CHAIN_STORE_CAPACITY: u32 = 128;
    /// Exclusive end of the auxiliary chain state retained beside the frozen handoff.
    pub const CHAIN_STATE_END: u32 =
        CHAIN_STORE_BASE + CHAIN_STORE_ENTRY_BYTES * CHAIN_STORE_CAPACITY;
}

/// Reusable transport buffer spanning the compiled module's frozen handoff byte range.
///
/// The current translator consumes x0..x31 plus `entry_pc` on entry and produces x0..x31 plus the
/// exit header on return. Reserved gaps inside the 568-byte range are transported but intentionally
/// carry no architectural claim. The buffer uses words rather than a `repr(C)` field struct so its
/// byte view stays alignment-independent and little-endian-correct on every Rust host.
#[repr(C)]
pub struct CpuStateHandoff {
    // Stored as little-endian words so common little-endian hosts can marshal the whole register
    // file with one native slice copy. Byte accessors expose the identical frozen ABI image.
    words: [u64; abi::HANDOFF_LEN / 8],
    /// E4-T34 browser-only chain state. Keeping this in the same allocation makes the pointer passed
    /// to an imported-memory module cover both the frozen handoff and the auxiliary state while
    /// preserving [`Self::as_bytes`] and its exact 568-byte contract.
    chain: [u64; ((abi::CHAIN_STATE_END - abi::HANDOFF_END) / 8) as usize],
}

impl Default for CpuStateHandoff {
    fn default() -> Self {
        Self {
            words: [0; abi::HANDOFF_LEN / 8],
            chain: [0; ((abi::CHAIN_STATE_END - abi::HANDOFF_END) / 8) as usize],
        }
    }
}

impl CpuStateHandoff {
    /// Marshal the live integer registers and virtual entry PC. Reserved gaps and the prior exit
    /// header need not be initialized because generated code never consumes them on entry.
    pub fn prepare(&mut self, hart: &Hart) {
        #[cfg(target_endian = "little")]
        self.words[..32].copy_from_slice(hart.regs.jit_words());
        #[cfg(target_endian = "big")]
        for register in 0..32u8 {
            self.put_u64(
                abi::XREG_BASE + u32::from(register) * 8,
                hart.regs.read(register),
            );
        }
        self.put_u64(abi::ENTRY_PC, hart.regs.pc);
    }

    /// Commit the compiled module's integer-register image. `x0` is intentionally skipped so the
    /// architectural hardwired-zero invariant remains owned by `XRegs`.
    pub fn commit_registers(&self, hart: &mut Hart) {
        #[cfg(target_endian = "little")]
        hart.regs.jit_commit_words(&self.words[..32]);
        #[cfg(target_endian = "big")]
        for register in 1..32u8 {
            hart.regs.write(
                register,
                self.get_u64(abi::XREG_BASE + u32::from(register) * 8),
            );
        }
    }

    /// Exit reason mirrored by the compiled block in the state header.
    pub fn exit_reason(&self) -> i32 {
        self.get_u64(abi::EXIT_REASON) as i32
    }

    /// Guest PC materialized by the compiled block for its clean or precise-trap exit.
    pub fn exit_pc(&self) -> u64 {
        self.get_u64(abi::EXIT_PC)
    }

    /// Auxiliary exit payload written by the compiled block.
    pub fn exit_info(&self) -> u64 {
        self.get_u64(abi::EXIT_INFO)
    }

    /// Immutable bytes for a bulk engine write.
    pub fn as_bytes(&self) -> &[u8; abi::HANDOFF_LEN] {
        // SAFETY: `words` is fully initialized, exactly HANDOFF_LEN bytes long, and every byte
        // pattern is valid for `u8`. The returned borrow cannot outlive `self`.
        unsafe { &*self.words.as_ptr().cast::<[u8; abi::HANDOFF_LEN]>() }
    }

    /// Mutable bytes for a bulk engine read.
    pub fn as_mut_bytes(&mut self) -> &mut [u8; abi::HANDOFF_LEN] {
        // SAFETY: same layout argument as `as_bytes`; the exclusive borrow prevents aliasing.
        unsafe { &mut *self.words.as_mut_ptr().cast::<[u8; abi::HANDOFF_LEN]>() }
    }

    fn put_u64(&mut self, offset: u32, value: u64) {
        debug_assert_eq!(offset % 8, 0);
        let index = ((offset - abi::XREG_BASE) / 8) as usize;
        self.words[index] = value.to_le();
    }

    fn get_u64(&self, offset: u32) -> u64 {
        debug_assert_eq!(offset % 8, 0);
        let index = ((offset - abi::XREG_BASE) / 8) as usize;
        u64::from_le(self.words[index])
    }

    fn put_chain_u64(&mut self, offset: u32, value: u64) {
        debug_assert_eq!(offset % 8, 0);
        debug_assert!((abi::HANDOFF_END..abi::CHAIN_STATE_END).contains(&offset));
        let index = ((offset - abi::HANDOFF_END) / 8) as usize;
        self.chain[index] = value.to_le();
    }

    fn chain_u64(&self, offset: u32) -> u64 {
        debug_assert_eq!(offset % 8, 0);
        debug_assert!((abi::HANDOFF_END..abi::CHAIN_STATE_END).contains(&offset));
        let index = ((offset - abi::HANDOFF_END) / 8) as usize;
        u64::from_le(self.chain[index])
    }

    /// Initialize the browser-only bounded direct-chain header before one compiled invocation.
    /// The frozen register/exit handoff remains unchanged and is still the only state copied into
    /// private SoftMMU memories.
    pub fn begin_chain(&mut self, enabled: bool, budget: u64, depth: u64) {
        self.put_chain_u64(abi::CHAIN_RETIRED, 0);
        self.put_chain_u64(abi::CHAIN_BUDGET, budget);
        self.put_chain_u64(abi::CHAIN_ABORT, 0);
        self.put_chain_u64(abi::CHAIN_DEPTH, depth);
        self.put_chain_u64(abi::CHAIN_ENABLED, enabled as u64);
        self.put_chain_u64(abi::CHAIN_STORE_COUNT, 0);
    }

    /// Total retired instructions recorded by the current direct chain.
    pub fn chain_retired(&self) -> u64 {
        self.chain_u64(abi::CHAIN_RETIRED)
    }

    /// Pointer to the byte-sized import-side abort flag in the auxiliary chain header.
    pub fn chain_abort_ptr(&mut self) -> *mut u8 {
        // SAFETY: `chain` is a live, aligned array in this allocation and the selected word is
        // addressable for the entire duration of the compiled call.
        self.chain.as_mut_ptr().cast::<u8>().wrapping_add(16)
    }

    /// Number of raw inline-RAM stores recorded by the current compiled call.
    pub fn jit_store_count(&self) -> u64 {
        self.chain_u64(abi::CHAIN_STORE_COUNT)
    }

    /// Read one raw inline-RAM store record as `(virtual_addr, physical_addr, width_bytes)`.
    pub fn jit_store_record(&self, index: u64) -> Option<(u64, u64, u64)> {
        if index >= self.jit_store_count() || index >= u64::from(abi::CHAIN_STORE_CAPACITY) {
            return None;
        }
        let index = u32::try_from(index).ok()?;
        let base = abi::CHAIN_STORE_BASE + index * abi::CHAIN_STORE_ENTRY_BYTES;
        Some((
            self.chain_u64(base),
            self.chain_u64(base + 8),
            self.chain_u64(base + 16),
        ))
    }

    /// Drop the raw-store records after the host has applied their architectural side effects.
    pub fn clear_jit_store_log(&mut self) {
        self.put_chain_u64(abi::CHAIN_STORE_COUNT, 0);
    }
}

/// The frozen exit-code enum (`docs/jit-architecture.md` §3.3). The E4-T09 translator emits only
/// the first three; the rest are reserved for later tickets and surfaced here so the run loop can
/// preserve the already-committed compiled state defensively if it ever sees one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitCode {
    /// Block ran to its end; resume at `next_pc`.
    Fallthrough,
    /// Taken conditional branch / `jal` / `jalr`; resume at `next_pc`.
    BranchTaken,
    /// A guest trap (`ecall`/`ebreak`) must be delivered at `next_pc`.
    Trap,
    /// Any reserved variant (MMIO/MMU_MISS/CALL_INTERP/NOT_COMPILED/INTERRUPT_POLL) — not produced
    /// by the current translator; treated as a benign unlinked fall-through because the module
    /// register image has already been committed.
    Reserved(i32),
    /// The browser direct-chain fuel was exhausted before the next successor began. The compiled
    /// prefix has already committed and `JitExit::retired` reports its exact span.
    Budget,
}

impl ExitCode {
    /// Decode the `i32` a compiled `run` returns.
    pub fn from_i32(v: i32) -> Self {
        match v {
            0 => ExitCode::Fallthrough,
            1 => ExitCode::BranchTaken,
            2 => ExitCode::Trap,
            8 => ExitCode::Budget,
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
    /// E4-T34: exact number of guest instructions retired by the compiled call, including any
    /// direct in-module successors. Zero means the legacy one-block executor did not provide the
    /// optional count; the core then derives the count from the decoded block as before.
    pub retired: u64,
}

/// E4-T20: the translation-cache budget (`docs/jit-architecture.md` §7 D10). Enforced at install
/// time; when a would-be install pushes any dimension over its high-water mark, eviction runs down
/// to a low-water mark (hysteresis) before the new batch is admitted. Because dropping a wasm
/// Instance's references does NOT free its memory synchronously (browser GC / wasmtime Store
/// reality), enforcement uses OUR OWN byte estimates ([`CompiledBlockExecutor::estimated_bytes`]),
/// never observed engine/browser memory.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JitCacheBudget {
    /// Max estimated live translated-code bytes (emitted WASM + per-instance overhead).
    pub code_bytes: u64,
    /// Max live Modules/Instances (batches). Eviction granularity is the batch (E4-T19): you cannot
    /// free half a Module.
    pub max_batches: usize,
    /// Max allocated funcref-table slots (block table indices).
    pub table_slots: usize,
    /// Max estimated metadata bytes (link-slot array + table + incoming-edge maps).
    pub metadata_bytes: u64,
}

impl JitCacheBudget {
    /// The `docs/jit-architecture.md` §7 default: 32 MiB code, 256 Modules. `table_slots` /
    /// `metadata_bytes` are generous headroom around those (≈128 blocks/batch × 256 batches).
    pub const DEFAULT: JitCacheBudget = JitCacheBudget {
        code_bytes: 32 * 1024 * 1024,
        max_batches: 256,
        table_slots: 256 * 128,
        metadata_bytes: 8 * 1024 * 1024,
    };
}

impl Default for JitCacheBudget {
    fn default() -> Self {
        JitCacheBudget::DEFAULT
    }
}

/// E4-T20: the two eviction policies A/B'd behind a flag. Both drive the SAME single
/// [`evict_batch`](CompiledBlockExecutor::evict_batch_containing) obligation path; they differ only
/// in WHICH batches they pick at the high-water mark.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvictPolicy {
    /// (a) Full generational flush at high-water — QEMU `tb_flush` style: drop the whole cache, let
    /// hot code re-translate. Simple, correct, competitive.
    Flush,
    /// (b) Batch-LRU by last-executed coarse tick (stamped at dispatch entries; chained execution
    /// updates lazily). Evicts the least-recently-run batch repeatedly down to the low-water mark.
    BatchLru,
}

impl Default for EvictPolicy {
    /// Provisional default pending the A/B ledger (deferred to dev). `BatchLru` is the more graceful
    /// degrader under a working set that fits after a little churn; the choice is recorded as debt.
    fn default() -> Self {
        EvictPolicy::BatchLru
    }
}

/// E4-T20: a snapshot of the JIT translation-cache accounting — current usage vs budget, eviction
/// activity, and the re-translation rate (blocks recompiled after eviction — the thrash signal).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct JitCacheStats {
    /// Current estimated live code bytes.
    pub code_bytes: u64,
    /// Current live batch (Module/Instance) count.
    pub batches: usize,
    /// Current allocated table slots.
    pub table_slots: usize,
    /// Current estimated metadata bytes.
    pub metadata_bytes: u64,
    /// The active budget.
    pub budget: JitCacheBudget,
    /// The active policy.
    pub policy: EvictPolicy,
    /// Cumulative batches evicted (budget-driven, through the single `evict_batch` path).
    pub evictions: u64,
    /// Cumulative full generational-flush events.
    pub flushes: u64,
    /// Cumulative blocks recompiled AFTER having been evicted — the thrash numerator. Divide by
    /// `installs` for the re-translation rate.
    pub retranslations: u64,
    /// Cumulative blocks installed (compiled) — the re-translation-rate denominator.
    pub installs: u64,
    /// The eviction/invalidation generation counter (E4-T08); bumped on every evict/flush so any
    /// stale cached reference is refused.
    pub generation: u64,
}

impl JitCacheStats {
    /// Re-translation rate = retranslations / installs (the thrash signal). `0.0` before any install.
    pub fn retranslation_rate(&self) -> f64 {
        if self.installs == 0 {
            0.0
        } else {
            self.retranslations as f64 / self.installs as f64
        }
    }
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

    /// E4-T19: translate + compile a GROUP of blocks (a connected component of the observed-edge
    /// graph) into ONE module of K functions — the batching unit (`docs/jit-architecture.md` §7),
    /// which amortizes per-Module / `WebAssembly.compile` fixed cost the browser is bound by.
    /// `intra[i][e]` is `Some(local)` iff block `i`'s edge `e` (0 = taken/sole/fall-through,
    /// 1 = branch not-taken) targets block `local` IN THIS SAME group — that edge is lowered to an
    /// intra-batch direct call; cross-batch edges reuse E4-T18's funcref-table link slots. The
    /// default impl installs each block singly (a valid non-batching executor); the wasmtime executor
    /// overrides it to build one module. A group whose translation fails (an out-of-scope op in ANY
    /// member) falls back to per-block installation of the translatable members.
    fn install_batch(&mut self, blocks: &[DecodedBlock], _intra: &[[Option<usize>; 2]]) {
        for b in blocks {
            self.install(b);
        }
    }

    /// E4-T19: set the batching knob K — the maximum number of blocks packed into one module. `1`
    /// is the adversarial one-block-per-module mode (registry-accounting stress). Default no-op.
    fn set_batch_size(&mut self, _k: usize) {}

    /// E4-T19: the current batching K.
    fn batch_size(&self) -> usize {
        1
    }

    /// Maximum number of newly translated blocks this executor may install during one public
    /// [`Machine::run`](crate::Machine::run) / `run_traced` call. Browser `runChunk` calls are the
    /// Worker scheduler's cooperative slices: allowing every periodic pump plus the final flush to
    /// install without a shared per-call ceiling turns one nominally bounded CPU quantum into an
    /// unbounded synchronous `WebAssembly.Module` compile stall. Native/mock executors retain the
    /// historical 64-block ceiling; the browser overrides this with a smaller latency budget.
    fn max_translation_attempts_per_run(&self) -> usize {
        64
    }

    /// Maximum discovery nominations staged into the priority compile queue during one public
    /// cooperative run. Staging a full discovery flood is itself synchronous work (including the
    /// bounded queue's backpressure comparisons), so it needs an aggregate ceiling independent of
    /// the smaller block-submission ceiling.
    fn max_staged_nominations_per_run(&self) -> usize {
        256
    }

    /// E4-T19 instance registry: number of live WASM Modules/Instances (batches) — the raw material
    /// for E4-T20's budgets. With no batching this equals [`Self::compiled_count`].
    fn module_count(&self) -> usize {
        self.compiled_count()
    }

    /// E4-T19 instance registry: estimated bytes held live across all Modules+Instances (emitted
    /// code size plus a fixed per-instance overhead estimate). Accurate accounting is the AC.
    fn estimated_bytes(&self) -> u64 {
        0
    }

    /// Is a compiled block registered for physical entry PC `phys_pc`?
    fn is_compiled(&self, phys_pc: u64) -> bool;

    /// Execute the compiled block for `phys_pc` against the live `hart`/`bus`. Guest registers are
    /// synced into the module's `CpuState` region before the call and read back into `hart.regs`
    /// on a clean return; guest memory is reached through `hart`'s translated load/store path so
    /// effects match the interpreter exactly.
    ///
    /// Returns `Some(exit)` on a clean return or a recorded precise guest fault. A defensive cache
    /// miss returns `None` before calling compiled code and without committing a module register
    /// image, allowing the guarded run loop to interpret from the same entry. Once the call has been
    /// attempted, an unclassified engine failure must fail closed rather than return `None`: an
    /// imported access may already have changed RAM, MMIO, or reservation state.
    fn execute(&mut self, phys_pc: u64, hart: &mut Hart, bus: &mut SystemBus) -> Option<JitExit>;

    /// Execute a compiled block with an optional bounded in-module chain. The default preserves the
    /// historical one-block call for native and test executors; the browser inline-memory executor
    /// overrides it to pass the remaining outer work budget and report an exact retired span that
    /// may include direct same-module successors.
    fn execute_with_budget(
        &mut self,
        phys_pc: u64,
        hart: &mut Hart,
        bus: &mut SystemBus,
        _remaining_work: u64,
        _chain_budget: u64,
        _allow_chaining: bool,
    ) -> Option<JitExit> {
        self.execute(phys_pc, hart, bus)
    }

    /// Drop every compiled block (`fence.i` / whole-cache flush / reset / snapshot restore).
    fn invalidate_all(&mut self);

    /// Publish a guarded virtual `jalr` target after the core has resolved it to a compiled
    /// physical block. Native executors keep the historical dispatch path; the browser imported
    /// memory executor may use the publication to call a matching funcref directly on a later hit.
    fn link_dynamic_target(&mut self, _virtual_pc: u64, _phys_pc: u64) {}

    /// Drop every compiled block whose physical page frame is `frame` (SMC / DMA-into-code).
    fn invalidate_page(&mut self, frame: u64);

    /// Number of blocks currently compiled + registered.
    fn compiled_count(&self) -> usize;

    /// Count of compiled blocks executed via the JIT over this run (the "JIT actually ran" proof).
    fn executed_blocks(&self) -> u64;

    /// Count of guest instructions retired inside JIT-executed blocks (numerator of the
    /// translated-instruction ratio).
    fn retired_via_jit(&self) -> u64;

    /// E4-T31: record the exact retirement count the core committed for a compiled exit. The core,
    /// not the executor, owns this count because it can distinguish a clean block from a precise
    /// mid-block trap. Default no-op keeps simple/mock executors source-compatible.
    fn note_jit_retired(&mut self, _retired: u64) {}

    // ── E4-T20: cache budgets, eviction policy, and stats (default impls: an executor with no
    //    budget enforcement is a valid degenerate) ──

    /// Set the translation-cache budget enforced at install time.
    fn set_jit_budget(&mut self, _budget: JitCacheBudget) {}

    /// The active budget.
    fn jit_budget(&self) -> JitCacheBudget {
        JitCacheBudget::DEFAULT
    }

    /// Select the eviction policy (A/B flag).
    fn set_evict_policy(&mut self, _policy: EvictPolicy) {}

    /// The active eviction policy.
    fn evict_policy(&self) -> EvictPolicy {
        EvictPolicy::default()
    }

    /// A snapshot of the cache accounting (usage vs budget, evictions, re-translation rate).
    fn jit_cache_stats(&self) -> JitCacheStats {
        JitCacheStats::default()
    }

    /// E4-T20: drain the list of physical entry PCs whose compiled batch was EVICTED (budget-driven
    /// or directed) since the last drain. The run loop feeds these back to block discovery
    /// ([`crate::dispatch::BlockDiscovery::renominate`]) so an evicted-but-still-hot block is
    /// re-nominated and re-translated instead of being suppressed by dedup forever. Default empty.
    fn take_evicted(&mut self) -> alloc::vec::Vec<u64> {
        alloc::vec::Vec::new()
    }

    /// Directed-test / debug hook (AC3 "eviction under fire"): force-evict the batch that owns the
    /// block at `phys_pc`, through the single ordered `evict_batch` obligation path. Returns `true`
    /// iff a batch was evicted. A no-op that returns `false` if no such block is compiled.
    fn evict_batch_containing(&mut self, _phys_pc: u64) -> bool {
        false
    }

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

#[cfg(test)]
mod tests {
    use super::{CpuStateHandoff, abi};
    use crate::hart::Hart;

    #[test]
    fn cpu_state_handoff_pins_frozen_layout_endian_and_x0() {
        assert_eq!(abi::XREG_END, 0x100);
        assert_eq!(abi::HANDOFF_END, 0x238);
        assert_eq!(abi::HANDOFF_LEN, 568);
        const { assert!(abi::HANDOFF_END < abi::CHAIN_ENABLED) };
        assert_eq!(abi::CHAIN_DEPTH, 0x260);
        assert_eq!(abi::CHAIN_STORE_BASE, 0x268);

        let mut hart = Hart::default();
        hart.regs.pc = 0x0123_4567_89ab_cdef;
        for register in 1..32u8 {
            hart.regs.write(
                register,
                0x8000_0000_0000_0000 | (u64::from(register) * 0x0102_0304_0506_0708),
            );
        }
        let mut handoff = CpuStateHandoff::default();
        handoff.prepare(&hart);

        assert_eq!(handoff.as_bytes().len(), 568);
        assert_eq!(&handoff.as_bytes()[0..8], &0u64.to_le_bytes());
        for register in 1..32u8 {
            let start = register as usize * 8;
            assert_eq!(
                &handoff.as_bytes()[start..start + 8],
                &hart.regs.read(register).to_le_bytes()
            );
        }
        assert_eq!(
            &handoff.as_bytes()[abi::ENTRY_PC as usize..abi::HANDOFF_END as usize],
            &hart.regs.pc.to_le_bytes()
        );

        handoff.put_u64(abi::XREG_BASE, u64::MAX);
        for register in 1..32u8 {
            handoff.put_u64(
                abi::XREG_BASE + u32::from(register) * 8,
                0xfedc_ba98_7654_0000 | u64::from(register),
            );
        }
        handoff.put_u64(abi::EXIT_REASON, 2);
        handoff.put_u64(abi::EXIT_PC, 0x8877_6655_4433_2211);
        handoff.put_u64(abi::EXIT_INFO, 0xff00_ee11_dd22_cc33);
        handoff.commit_registers(&mut hart);

        assert_eq!(hart.regs.read(0), 0);
        for register in 1..32u8 {
            assert_eq!(
                hart.regs.read(register),
                0xfedc_ba98_7654_0000 | u64::from(register)
            );
        }
        assert_eq!(handoff.exit_reason(), 2);
        assert_eq!(handoff.exit_pc(), 0x8877_6655_4433_2211);
        assert_eq!(handoff.exit_info(), 0xff00_ee11_dd22_cc33);
    }
}
