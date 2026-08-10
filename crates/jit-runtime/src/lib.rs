//! # `jit-runtime` — E4-T10: the native compiled-block executor (wasmtime)
//!
//! Implements [`wasm_vm_core::jit::CompiledBlockExecutor`] with wasmtime. It closes the tier-up loop
//! for RV64I blocks: the `Machine` run loop hands nominated hot [`DecodedBlock`]s to
//! [`WasmtimeExecutor::install`] (which translates them with E4-T09's `translate_block` and compiles
//! the emitted module), and at each block boundary asks whether the current physical PC is compiled
//! before [`WasmtimeExecutor::execute`] runs it. The executor still returns `None` on a defensive
//! lookup miss, preserving the public guarded-execution contract.
//!
//! ## How guest state is presented to the compiled module (`docs/jit-architecture.md` §3)
//!
//! A translated block is a WASM function `run(state_base: i32) -> i32` that reads/writes guest
//! registers through fixed byte offsets into its module's linear memory (the `CpuState` region) and
//! reaches guest memory through two host imports `env.load` / `env.store`. On each [`Self::execute`]:
//!
//! 1. **Register sync-in.** The 32 guest x-registers are copied from `hart.regs` into the module's
//!    linear memory at [`abi::XREG_BASE`].
//! 2. **Bus wiring.** Raw pointers to the live [`Hart`] and [`SystemBus`] are stashed in the store
//!    data for the duration of the call; the `env.load`/`env.store` imports dereference them and call
//!    [`Hart::jit_load`]/[`Hart::jit_store`] — the interpreter's OWN translated + PMP-checked +
//!    bus-routed path — so a JIT load/store hits real guest RAM/MMIO with effects byte-identical to
//!    the interpreter. A faulting access sets a trap flag and unwinds the module call.
//! 3. **Run.** `run(0)` executes; the retire clock and interrupt sampling stay in the run loop
//!    (batched at the boundary, per E4-T05).
//! 4. **Sync-out / exit.** On a clean return the registers are copied back into `hart.regs` and the
//!    frozen exit protocol (`exit_pc` / `exit_reason` / `exit_info`) is read from linear memory. A
//!    recorded guest-memory fault commits its precise dirty-register prefix; an unexpected engine
//!    trap commits nothing and returns `None` for interpreter fallback.
//!
//! The browser executor (`WebAssembly.Module`) and block chaining are later tickets (E4-T19/T18).

use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};

use anyhow::anyhow;
use jit_translate::{Abi, translate_batch};
use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::DecodedBlock;
use wasm_vm_core::hart::{Hart, Trap};

use wasm_vm_core::jit::{
    CHAIN_DEPTH_BUDGET_DEFAULT, CHAIN_DEPTH_HIST_LEN, ChainStats, CompiledBlockExecutor,
    CpuStateHandoff, EvictPolicy, ExitCode, JitCacheBudget, JitCacheStats, JitExit, abi,
};
use wasm_vm_core::mmio::SystemBus;
use wasmtime::{Caller, Engine, Instance, Linker, Memory, Module, Store, TypedFunc};

/// Deterministic integer-key mixer for the JIT's private registries. Physical PCs and compact table
/// ids are already integer identities; SipHash's per-call DOS-hardening is costly at every compiled
/// block boundary. This SplitMix64 finalizer preserves constant-time lookup without using raw
/// identity hashing (aligned or same-low-bit guest addresses still avalanche across the table).
#[derive(Default)]
struct JitKeyHasher(u64);

impl JitKeyHasher {
    #[inline]
    fn mix(mut value: u64) -> u64 {
        value ^= value >> 30;
        value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
        value ^= value >> 27;
        value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
        value ^ (value >> 31)
    }
}

impl Hasher for JitKeyHasher {
    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        // The four registries below use only u64/u32 keys and therefore dispatch to the specialized
        // methods. Keep a deterministic, mixed fallback so the alias remains sound if a small
        // integer-like key type later delegates through `write`.
        let mut value = 0xcbf2_9ce4_8422_2325u64;
        for &byte in bytes {
            value ^= u64::from(byte);
            value = value.wrapping_mul(0x0000_0100_0000_01b3);
        }
        self.0 = Self::mix(value);
    }

    #[inline]
    fn write_u64(&mut self, value: u64) {
        self.0 = Self::mix(value);
    }

    #[inline]
    fn write_u32(&mut self, value: u32) {
        self.0 = Self::mix(u64::from(value));
    }
}

type JitMap<K, V> = HashMap<K, V, BuildHasherDefault<JitKeyHasher>>;

/// Store data: raw pointers to the live guest state, valid only for the duration of one `run` call
/// (set immediately before, cleared immediately after — the module never escapes the call, so the
/// pointers never dangle). `trapped` records whether a load/store import hit a bus fault.
struct HostCtx {
    hart: *mut Hart,
    bus: *mut SystemBus,
    /// E4-T12: the PRECISE trap a faulting load/store produced (cause + `mtval`), recorded by the
    /// import before it unwinds the module call. `None` means "no fault this call". This is what
    /// lets a mem fault side-exit precisely instead of re-interpreting the block from entry.
    trap: Option<Trap>,
}

impl HostCtx {
    const EMPTY: HostCtx = HostCtx {
        hart: std::ptr::null_mut(),
        bus: std::ptr::null_mut(),
        trap: None,
    };
}

/// One compiled block: its wasmtime instance handle, `run` entry, `CpuState` memory, source page
/// frame (for page-granular invalidation), and chaining/batch identity.
struct Compiled {
    run: TypedFunc<i32, i32>,
    mem: Memory,
    page_frame: u64,
    /// E4-T18: this block's stable table index (its funcref-table slot in the browser form; here the
    /// identity a link-slot stores). Freed on invalidation so the entry is never called after death.
    table_index: u32,
    /// E4-T18: base into [`WasmtimeExecutor::slots`] of this block's outgoing link-slots.
    slot_base: u32,
    /// E4-T18: number of outgoing link-slots (2 for a conditional branch — taken + not-taken —
    /// else 1). A dynamic-target `jalr`/single-successor still has 1 slot but it is never linked.
    nslots: u8,
    /// E4-T19: the batch (WASM Module/Instance) this block was compiled into. All blocks sharing a
    /// `batch_id` share one Module, one Instance, and one linear memory. On a page-granular SMC
    /// invalidation touching ANY member, the WHOLE batch is retired (the documented option — no stale
    /// intra-batch direct call can survive because the module is dropped atomically).
    batch_id: u32,
}

/// E4-T19 instance-registry entry: one live WASM Module/Instance holding `members.len()` compiled
/// block functions, with an estimated live-byte cost (emitted code + a fixed per-instance overhead).
struct Batch {
    /// Physical entry PCs of the blocks compiled into this module.
    members: Vec<u64>,
    /// Estimated bytes held live by this Module+Instance (accounting for E4-T20 budgets).
    est_bytes: u64,
    /// E4-T20: coarse tick of the most recent execution of ANY member — the batch-LRU key. Stamped
    /// at each dispatch entry into a member (`execute`); chained execution updates it lazily.
    last_tick: u64,
}

/// E4-T19 registry estimate: fixed per-Instance overhead beyond the emitted code bytes — dominated by
/// the module's one-page (64 KiB) `CpuState` linear memory plus wasmtime instance metadata. A coarse
/// but consistent native estimate; the browser cross-check (performance.memory) is dev debt.
const INSTANCE_OVERHEAD_BYTES: u64 = 64 * 1024;

/// E4-T19 default batching K (`docs/jit-architecture.md` §7 D9/D10: ~64 blocks/module). UA-probed in
/// the browser; the native default and the single override knob ([`WasmtimeExecutor::set_batch_size`])
/// live here.
pub const DEFAULT_BATCH_SIZE: usize = 64;

/// E4-T18: the dispatch-stub sentinel a link-slot holds when NOT linked to a successor — reading it
/// means "return to the dispatch loop". (In the browser in-wasm form this is the funcref-table index
/// of the dispatch stub; here it is an out-of-band marker.)
const STUB: u32 = u32::MAX;

/// The native wasmtime-backed [`CompiledBlockExecutor`].
pub struct WasmtimeExecutor {
    engine: Engine,
    linker: Linker<HostCtx>,
    store: Store<HostCtx>,
    /// Reused exact image of `[abi::XREG_BASE, abi::HANDOFF_END)`, transferred with one direct
    /// fixed-memory slice copy in each direction per committed compiled exit.
    handoff: CpuStateHandoff,
    blocks: JitMap<u64, Compiled>,
    executed_blocks: u64,
    retired_via_jit: u64,
    // ── E4-T18 chaining state ──
    /// A/B flag; on by default so the JIT chains once armed.
    chaining: bool,
    /// Max links per chain before a mandatory dispatch return.
    chain_depth_budget: u32,
    /// The link-slot array (the "fixed linear-memory array" of the design; here a `Vec`). Each slot
    /// holds a successor's `table_index` or [`STUB`]. Indexed by `slot_base + edge`.
    slots: Vec<u32>,
    /// Table index → the physical entry PC of the live block that owns it (`None` = freed).
    table: Vec<Option<u64>>,
    /// Physical entry PC → table index, for the live blocks (mirrors `table`).
    phys_to_index: JitMap<u64, u32>,
    /// Incoming-edge map: target table index → the slot indices that currently point at it. This is
    /// what unlink walks to restore stubs on invalidation; pruned as links are cut.
    incoming: JitMap<u32, Vec<u32>>,
    /// Free lists so table indices and slot ranges are reused after invalidation (bounds growth
    /// under eviction/SMC churn). Slot ranges are size-classed (1 or 2).
    free_table: Vec<u32>,
    free_slots1: Vec<u32>,
    free_slots2: Vec<u32>,
    stats: ChainStats,
    // ── E4-T19 batching + instance registry ──
    /// The batching knob K (max blocks packed into one module).
    batch_size: usize,
    /// Live Modules/Instances by id — the instance registry.
    batches: JitMap<u32, Batch>,
    /// Monotonic batch-id allocator.
    next_batch_id: u32,
    // ── E4-T20 budgets + eviction ──
    /// The translation-cache budget enforced at install time.
    budget: JitCacheBudget,
    /// The active eviction policy (A/B flag).
    policy: EvictPolicy,
    /// Coarse execution tick — the batch-LRU clock, advanced once per `execute`.
    clock: u64,
    /// Eviction/invalidation generation (E4-T08); bumped by every `evict_batch`/flush.
    generation: u64,
    /// Physical entry PCs that have been EVICTED and not yet re-installed — the re-translation
    /// (thrash) detector: installing a block whose phys is in this set counts one re-translation.
    evicted_phys: HashSet<u64>,
    /// Cumulative budget-driven batch evictions.
    evictions: u64,
    /// Cumulative full generational-flush events.
    flushes: u64,
    /// Cumulative blocks recompiled after eviction (thrash numerator).
    retranslations: u64,
    /// Cumulative blocks installed (thrash denominator).
    installs: u64,
    /// Physical entry PCs evicted since the last [`Self::take_evicted`] drain — fed back to block
    /// discovery so an evicted-but-hot block is re-nominated (E4-T20 AC3).
    newly_evicted: Vec<u64>,
}

impl Default for WasmtimeExecutor {
    fn default() -> Self {
        Self::new()
    }
}

impl WasmtimeExecutor {
    /// Build a fresh executor: one engine + one linker whose `env.load`/`env.store` imports bridge
    /// to the live guest through the store data, and one store shared by every compiled block.
    pub fn new() -> Self {
        let engine = Engine::default();
        let mut linker: Linker<HostCtx> = Linker::new(&engine);
        linker
            .func_wrap(
                "env",
                "load",
                |mut caller: Caller<'_, HostCtx>, addr: i64, kind: i32| -> anyhow::Result<i64> {
                    let (hart, bus) = {
                        let c = caller.data();
                        (c.hart, c.bus)
                    };
                    // SAFETY: `hart`/`bus` are set to live `&mut` borrows for the enclosing `run`
                    // call and cleared after; the module is single-threaded and cannot re-enter, so
                    // there is exactly one live mutable use at a time.
                    let hart = unsafe { &mut *hart };
                    let bus = unsafe { &mut *bus };
                    match hart.jit_load(bus, addr as u64, kind) {
                        Ok(v) => Ok(v),
                        Err(t) => {
                            // Record the PRECISE trap and unwind: `execute` reads it back and
                            // delivers the trap from the block's already-written-back state.
                            caller.data_mut().trap = Some(t);
                            Err(anyhow!("jit load fault"))
                        }
                    }
                },
            )
            .expect("register env.load");
        linker
            .func_wrap(
                "env",
                "store",
                |mut caller: Caller<'_, HostCtx>,
                 addr: i64,
                 val: i64,
                 width: i32|
                 -> anyhow::Result<()> {
                    let (hart, bus) = {
                        let c = caller.data();
                        (c.hart, c.bus)
                    };
                    // SAFETY: see `env.load` above.
                    let hart = unsafe { &mut *hart };
                    let bus = unsafe { &mut *bus };
                    match hart.jit_store(bus, addr as u64, val, width) {
                        Ok(()) => Ok(()),
                        Err(t) => {
                            caller.data_mut().trap = Some(t);
                            Err(anyhow!("jit store fault"))
                        }
                    }
                },
            )
            .expect("register env.store");
        // E4-T14: the A-extension imports. Each bridges to the interpreter's OWN atomic +
        // reservation code (`Hart::jit_amo/jit_lr/jit_sc`) through the same live-guest pointers
        // env.load/env.store use — byte-identical semantics and a single shared `resv` state, so a
        // JIT/interpreter tier switch mid-LR/SC stays coherent. A fault records the precise trap and
        // unwinds the module, exactly like env.load/env.store.
        linker
            .func_wrap(
                "env",
                "amo",
                |mut caller: Caller<'_, HostCtx>,
                 addr: i64,
                 val: i64,
                 op: i32,
                 width: i32|
                 -> anyhow::Result<i64> {
                    let (hart, bus) = {
                        let c = caller.data();
                        (c.hart, c.bus)
                    };
                    // SAFETY: see env.load above.
                    let hart = unsafe { &mut *hart };
                    let bus = unsafe { &mut *bus };
                    match hart.jit_amo(bus, addr as u64, val, op, width) {
                        Ok(v) => Ok(v),
                        Err(t) => {
                            caller.data_mut().trap = Some(t);
                            Err(anyhow!("jit amo fault"))
                        }
                    }
                },
            )
            .expect("register env.amo");
        linker
            .func_wrap(
                "env",
                "lr",
                |mut caller: Caller<'_, HostCtx>, addr: i64, width: i32| -> anyhow::Result<i64> {
                    let (hart, bus) = {
                        let c = caller.data();
                        (c.hart, c.bus)
                    };
                    // SAFETY: see env.load above.
                    let hart = unsafe { &mut *hart };
                    let bus = unsafe { &mut *bus };
                    match hart.jit_lr(bus, addr as u64, width) {
                        Ok(v) => Ok(v),
                        Err(t) => {
                            caller.data_mut().trap = Some(t);
                            Err(anyhow!("jit lr fault"))
                        }
                    }
                },
            )
            .expect("register env.lr");
        linker
            .func_wrap(
                "env",
                "sc",
                |mut caller: Caller<'_, HostCtx>,
                 addr: i64,
                 val: i64,
                 width: i32|
                 -> anyhow::Result<i64> {
                    let (hart, bus) = {
                        let c = caller.data();
                        (c.hart, c.bus)
                    };
                    // SAFETY: see env.load above.
                    let hart = unsafe { &mut *hart };
                    let bus = unsafe { &mut *bus };
                    match hart.jit_sc(bus, addr as u64, val, width) {
                        Ok(v) => Ok(v),
                        Err(t) => {
                            caller.data_mut().trap = Some(t);
                            Err(anyhow!("jit sc fault"))
                        }
                    }
                },
            )
            .expect("register env.sc");
        let store = Store::new(&engine, HostCtx::EMPTY);
        WasmtimeExecutor {
            engine,
            linker,
            store,
            handoff: CpuStateHandoff::default(),
            blocks: JitMap::default(),
            executed_blocks: 0,
            retired_via_jit: 0,
            chaining: true,
            chain_depth_budget: CHAIN_DEPTH_BUDGET_DEFAULT,
            slots: Vec::new(),
            table: Vec::new(),
            phys_to_index: JitMap::default(),
            incoming: JitMap::default(),
            free_table: Vec::new(),
            free_slots1: Vec::new(),
            free_slots2: Vec::new(),
            stats: ChainStats::default(),
            batch_size: DEFAULT_BATCH_SIZE,
            batches: JitMap::default(),
            next_batch_id: 0,
            budget: JitCacheBudget::DEFAULT,
            policy: EvictPolicy::default(),
            clock: 0,
            generation: 0,
            evicted_phys: HashSet::new(),
            evictions: 0,
            flushes: 0,
            retranslations: 0,
            installs: 0,
            newly_evicted: Vec::new(),
        }
    }

    /// E4-T20: estimated metadata bytes — the link-slot array, the block table, and the
    /// incoming-edge map. Coarse but consistent (matches the budget's `metadata_bytes` meaning).
    fn metadata_bytes_est(&self) -> u64 {
        let slots = (self.slots.len() * 4) as u64;
        let table = (self.table.len() * 8) as u64;
        let incoming: u64 = self.incoming.values().map(|v| (v.len() * 4) as u64).sum();
        slots + table + incoming
    }

    /// E4-T20: pick the least-recently-executed batch (smallest `last_tick`) — the batch-LRU victim.
    fn lru_victim(&self) -> Option<u32> {
        self.batches
            .iter()
            .min_by_key(|(id, b)| (b.last_tick, **id))
            .map(|(id, _)| *id)
    }

    /// E4-T20 — THE eviction correctness core. A SINGLE ordered path that discharges every eviction
    /// obligation for one batch, in this DOCUMENTED order (`docs/jit-architecture.md` §5 eviction
    /// row); both policies and the directed AC3 hook call exactly this. Ordering is load-bearing:
    /// edges MUST be unlinked before the table entry is freed, or a live link-slot could reach a
    /// freed/re-used table slot (the ordering attack in the ticket's adversarial §2).
    ///
    /// 1. **Unlink incoming + outgoing edges** (E4-T18): `remove_block` restores the dispatch stub in
    ///    every incoming slot from live predecessors AND clears this block's own outgoing slots.
    /// 2. **Uninstall the table entry / slot range** (E4-T18): `remove_block` frees the table index
    ///    and slot range so no `call_indirect` can reach the dead block.
    /// 3. **Clear the SMC page registration** (E4-T17): dropping the block from `self.blocks` removes
    ///    its `page_frame` membership, so a later `invalidate_page` no longer scans it.
    /// 4. **Drop the Instance references + decrement the registry** (`batches.remove`). The wasm
    ///    Instance memory itself is freed only when the Store drops — the GC reality the budget
    ///    accounts for with OUR byte estimate, never observed engine memory.
    /// 5. **Bump the generation** (E4-T08) so any stale cached reference is refused.
    ///
    /// Post-conditions (debug-asserted): the batch is gone; no evicted member is live or in the
    /// table map; and NO live link-slot points into any of the evicted members' (now-freed) table
    /// indices.
    fn evict_batch(&mut self, batch_id: u32) -> bool {
        let Some(b) = self.batches.remove(&batch_id) else {
            return false;
        };
        let members = b.members;
        // Capture the members' table indices BEFORE unlink, for the post-condition scan.
        #[cfg(debug_assertions)]
        let dead_tis: Vec<u32> = members
            .iter()
            .filter_map(|p| self.phys_to_index.get(p).copied())
            .collect();
        // Steps 1–3 per member, in order, via the audited E4-T18 unlink core.
        for &phys in &members {
            self.remove_block(phys);
            // Step: retranslation bookkeeping — this block may come back hot later.
            self.evicted_phys.insert(phys);
            // Feed the evicted PC back to discovery (via the run loop) so it can be re-nominated.
            self.newly_evicted.push(phys);
        }
        // Step 4: registry decrement already done by `batches.remove` above.
        // Step 5: bump the generation.
        self.generation = self.generation.wrapping_add(1);
        self.evictions += 1;
        // Post-conditions.
        debug_assert!(!self.batches.contains_key(&batch_id));
        #[cfg(debug_assertions)]
        {
            for &phys in &members {
                debug_assert!(
                    !self.blocks.contains_key(&phys),
                    "evicted member still live in block cache"
                );
                debug_assert!(
                    !self.phys_to_index.contains_key(&phys),
                    "evicted member still in table map"
                );
            }
            debug_assert!(
                self.slots.iter().all(|s| !dead_tis.contains(s)),
                "a live link-slot still points into the evicted batch (unlink/uninstall ordering bug)"
            );
        }
        true
    }

    /// E4-T20: enforce the budget for a would-be install of `incoming_bytes` and `incoming_batches`
    /// new batches. If any dimension would cross its high-water mark, evict per the active policy
    /// down to the low-water mark (hysteresis) so admission does not immediately re-trigger.
    fn enforce_budget(&mut self, incoming_bytes: u64, incoming_batches: usize) {
        let bud = self.budget;
        let over_high = |s: &Self| {
            s.batches.len() + incoming_batches > bud.max_batches
                || s.estimated_bytes() + incoming_bytes > bud.code_bytes
                || s.table.len() > bud.table_slots
                || s.metadata_bytes_est() > bud.metadata_bytes
        };
        if !over_high(self) {
            return;
        }
        match self.policy {
            EvictPolicy::Flush => {
                // Full generational flush (QEMU tb_flush): drop the whole cache through the one
                // ordered path, then it is a single flush event.
                let ids: Vec<u32> = self.batches.keys().copied().collect();
                for id in ids {
                    self.evict_batch(id);
                }
                self.flushes += 1;
            }
            EvictPolicy::BatchLru => {
                // Evict the least-recently-executed batch repeatedly down to the low-water mark
                // (75% of each budget), always leaving room for the incoming batch.
                let low_batches = ((bud.max_batches * 3) / 4)
                    .min(bud.max_batches.saturating_sub(incoming_batches));
                let low_bytes = (bud.code_bytes / 4) * 3;
                while !self.batches.is_empty()
                    && (self.batches.len() + incoming_batches > low_batches
                        || self.estimated_bytes() + incoming_bytes > low_bytes
                        || self.table.len() > bud.table_slots
                        || self.metadata_bytes_est() > bud.metadata_bytes)
                {
                    let Some(victim) = self.lru_victim() else {
                        break;
                    };
                    self.evict_batch(victim);
                }
            }
        }
    }

    /// E4-T19: retire an entire batch (Module/Instance) — remove every member block (E4-T18 unlink so
    /// no live slot points into or out of it) and drop the registry entry. The unit of SMC/eviction
    /// invalidation, so a stale intra-batch direct call can never run dead bytes: the whole module
    /// goes at once.
    fn retire_batch(&mut self, batch_id: u32) {
        if let Some(b) = self.batches.remove(&batch_id) {
            for phys in b.members {
                self.remove_block(phys);
            }
        }
    }

    /// E4-T18: how many outgoing link-slots a block needs — 2 for a conditional branch (taken +
    /// not-taken edges are both statically known), else 1.
    fn nslots_for(block: &DecodedBlock) -> u8 {
        match block.ops.last().map(|o| &o.instr) {
            Some(
                Instr::Beq { .. }
                | Instr::Bne { .. }
                | Instr::Blt { .. }
                | Instr::Bge { .. }
                | Instr::Bltu { .. }
                | Instr::Bgeu { .. },
            ) => 2,
            _ => 1,
        }
    }

    /// E4-T18: allocate a table index + a stub-initialized slot range for a freshly compiled block,
    /// registering it in `table`/`phys_to_index`. Reuses freed entries first.
    fn alloc_block(&mut self, phys: u64, nslots: u8) -> (u32, u32) {
        let table_index = self.free_table.pop().unwrap_or_else(|| {
            let i = self.table.len() as u32;
            self.table.push(None);
            i
        });
        self.table[table_index as usize] = Some(phys);
        self.phys_to_index.insert(phys, table_index);
        let free = if nslots == 1 {
            &mut self.free_slots1
        } else {
            &mut self.free_slots2
        };
        let slot_base = match free.pop() {
            Some(b) => {
                for e in 0..u32::from(nslots) {
                    self.slots[(b + e) as usize] = STUB;
                }
                b
            }
            None => {
                let b = self.slots.len() as u32;
                for _ in 0..nslots {
                    self.slots.push(STUB);
                }
                b
            }
        };
        (table_index, slot_base)
    }

    /// E4-T18 unlink core: remove the block at `phys` and PROVABLY cut every edge touching it —
    /// restore the dispatch stub in every incoming slot (from live predecessors) AND clear this
    /// block's own outgoing slots (pruning their targets' incoming lists), then free its table index
    /// and slot range. After this returns no live slot points into (or out of) the dead block.
    fn remove_block(&mut self, phys: u64) {
        let Some(c) = self.blocks.remove(&phys) else {
            return;
        };
        let di = c.table_index;
        // 1. Every slot that pointed AT this dead block → stub.
        if let Some(incoming) = self.incoming.remove(&di) {
            for s in incoming {
                if self.slots[s as usize] != STUB {
                    self.slots[s as usize] = STUB;
                    self.stats.links_cut += 1;
                }
            }
        }
        // 2. This block's own outgoing slots → stub, pruning the target's incoming list.
        for e in 0..u32::from(c.nslots) {
            let s = c.slot_base + e;
            let cur = self.slots[s as usize];
            if cur != STUB {
                if let Some(v) = self.incoming.get_mut(&cur) {
                    v.retain(|x| *x != s);
                }
                self.slots[s as usize] = STUB;
                self.stats.links_cut += 1;
            }
        }
        // 3. Free the table entry + slot range so a call can never reach the dead block again.
        self.table[di as usize] = None;
        self.phys_to_index.remove(&phys);
        self.free_table.push(di);
        if c.nslots == 1 {
            self.free_slots1.push(c.slot_base);
        } else {
            self.free_slots2.push(c.slot_base);
        }
    }
}

impl CompiledBlockExecutor for WasmtimeExecutor {
    fn install(&mut self, block: &DecodedBlock) {
        // A lone block is a one-function batch — route through the same path so the registry, the
        // per-function export naming, and the batch retirement invariant all stay consistent.
        self.install_batch(std::slice::from_ref(block), &[[None, None]]);
    }

    fn install_batch(&mut self, blocks: &[DecodedBlock], intra: &[[Option<usize>; 2]]) {
        debug_assert_eq!(blocks.len(), intra.len());
        // Drop already-compiled members (dedup) and re-index the intra edges onto the kept set.
        let keep: Vec<usize> = (0..blocks.len())
            .filter(|&i| !self.blocks.contains_key(&blocks[i].phys_start))
            .collect();
        if keep.is_empty() {
            return;
        }
        let mut new_local = vec![None; blocks.len()];
        for (nl, &oi) in keep.iter().enumerate() {
            new_local[oi] = Some(nl);
        }
        let kept_blocks: Vec<DecodedBlock> = keep.iter().map(|&i| blocks[i].clone()).collect();
        let kept_intra: Vec<[Option<usize>; 2]> = keep
            .iter()
            .map(|&i| {
                let mut e = [None, None];
                for k in 0..2 {
                    // An edge that pointed at a now-dropped (already-compiled) member becomes a
                    // cross-batch edge (dispatch / funcref link), which is always correct.
                    e[k] = intra[i][k].and_then(|t| new_local.get(t).copied().flatten());
                }
                e
            })
            .collect();

        let bytes = match translate_batch(&kept_blocks, &Abi::FROZEN, &kept_intra) {
            Ok(b) => b,
            Err(_) => {
                // An out-of-scope op failed the whole group. Fall back to installing each member as
                // its own one-block module; a member that is itself untranslatable is simply skipped.
                if kept_blocks.len() > 1 {
                    for b in &kept_blocks {
                        self.install_batch(std::slice::from_ref(b), &[[None, None]]);
                    }
                }
                return;
            }
        };
        // E4-T20: enforce the budget BEFORE admitting the new batch, so eviction makes room for it
        // (rather than evicting the batch we just installed). One batch of `est_bytes` incoming.
        let est_bytes = bytes.len() as u64 + INSTANCE_OVERHEAD_BYTES;
        self.enforce_budget(est_bytes, 1);
        let module = match Module::new(&self.engine, &bytes) {
            Ok(m) => m,
            Err(_) => return,
        };
        let instance: Instance = match self.linker.instantiate(&mut self.store, &module) {
            Ok(i) => i,
            Err(_) => return,
        };
        let mem = match instance.get_memory(&mut self.store, "mem") {
            Some(m) => m,
            None => return,
        };
        let batch_id = self.next_batch_id;
        self.next_batch_id = self.next_batch_id.wrapping_add(1);
        let mut members = Vec::with_capacity(kept_blocks.len());
        for (nl, b) in kept_blocks.iter().enumerate() {
            let name = format!("run{nl}");
            let run = match instance.get_typed_func::<i32, i32>(&mut self.store, &name) {
                Ok(f) => f,
                Err(_) => continue,
            };
            // E4-T20: thrash accounting — a block coming back after having been evicted is a
            // re-translation.
            if self.evicted_phys.remove(&b.phys_start) {
                self.retranslations += 1;
            }
            self.installs += 1;
            let nslots = Self::nslots_for(b);
            let (table_index, slot_base) = self.alloc_block(b.phys_start, nslots);
            self.blocks.insert(
                b.phys_start,
                Compiled {
                    run,
                    mem,
                    page_frame: b.page_frame,
                    table_index,
                    slot_base,
                    nslots,
                    batch_id,
                },
            );
            members.push(b.phys_start);
        }
        if members.is_empty() {
            return;
        }
        // Registry accounting: emitted code bytes + one fixed per-instance overhead per module.
        self.batches.insert(
            batch_id,
            Batch {
                members,
                est_bytes,
                last_tick: self.clock,
            },
        );
    }

    fn set_batch_size(&mut self, k: usize) {
        self.batch_size = k.max(1);
    }

    fn batch_size(&self) -> usize {
        self.batch_size
    }

    fn module_count(&self) -> usize {
        self.batches.len()
    }

    fn estimated_bytes(&self) -> u64 {
        self.batches.values().map(|b| b.est_bytes).sum()
    }

    fn is_compiled(&self, phys_pc: u64) -> bool {
        self.blocks.contains_key(&phys_pc)
    }

    fn execute(&mut self, phys_pc: u64, hart: &mut Hart, bus: &mut SystemBus) -> Option<JitExit> {
        let compiled = self.blocks.get(&phys_pc)?;
        let run = &compiled.run;
        let mem = compiled.mem;
        let batch_id = compiled.batch_id;
        // E4-T20: stamp the batch-LRU clock at this dispatch entry (chained execution updates the
        // owning batch's tick lazily, on each re-entry through `execute`).
        self.clock = self.clock.wrapping_add(1);
        if let Some(b) = self.batches.get_mut(&batch_id) {
            b.last_tick = self.clock;
        }
        // One direct fixed-memory slice copy transfers all integer registers plus the guest VIRTUAL
        // entry PC. Under paging `phys_pc` differs from this virtual PC; generated code derives every
        // guest-visible address from the value in the handoff.
        self.handoff.prepare(hart);
        mem.data_mut(&mut self.store)[abi::XREG_BASE as usize..abi::HANDOFF_END as usize]
            .copy_from_slice(self.handoff.as_bytes());
        // Present the live guest to the load/store imports for the duration of the call.
        {
            let ctx = self.store.data_mut();
            ctx.hart = hart as *mut Hart;
            ctx.bus = bus as *mut SystemBus;
            ctx.trap = None;
        }
        let call = run.call(&mut self.store, 0);
        // Clear the pointers before doing anything else (they must never outlive the borrows), and
        // take the precise trap (if a load/store faulted) out of the context.
        let fault = {
            let ctx = self.store.data_mut();
            ctx.hart = std::ptr::null_mut();
            ctx.bus = std::ptr::null_mut();
            ctx.trap.take()
        };
        let code = match call {
            Ok(c) => c,
            Err(_) => {
                // The block unwound. If it was a PRECISE memory fault (E4-T12), deliver it exactly:
                // the translator wrote back every dirty register AND `exit_pc = faulting PC` BEFORE
                // the access (§4), so the module's CpuState region holds architecturally-precise
                // registers as of the prior instruction and `exit_pc` is the faulting PC. Sync those
                // back and hand the interpreter-produced Trap to the run loop — NO re-interpretation
                // from entry, so any earlier committing side-effect (an MMIO store) is never
                // re-executed (the MMIO-write-then-fault double-execute corner E4-T10 flagged).
                let trap = fault?; // no recorded trap ⇒ unexpected wasm trap: fall back (re-interp)
                self.handoff.as_mut_bytes().copy_from_slice(
                    &mem.data(&self.store)[abi::XREG_BASE as usize..abi::HANDOFF_END as usize],
                );
                self.handoff.commit_registers(hart);
                let faulting_pc = self.handoff.exit_pc();
                self.executed_blocks += 1;
                return Some(JitExit {
                    code: ExitCode::Trap,
                    next_pc: faulting_pc,
                    exit_info: trap.cause as u64,
                    trap: Some(trap),
                });
            }
        };
        // One direct fixed-memory slice copy returns dirty registers and the frozen exit header.
        self.handoff.as_mut_bytes().copy_from_slice(
            &mem.data(&self.store)[abi::XREG_BASE as usize..abi::HANDOFF_END as usize],
        );
        self.handoff.commit_registers(hart);
        let next_pc = self.handoff.exit_pc();
        let exit_info = self.handoff.exit_info();
        // The return value is the authoritative exit code; `exit_reason` in memory mirrors it.
        debug_assert_eq!(code, self.handoff.exit_reason());
        self.executed_blocks += 1;
        Some(JitExit {
            code: ExitCode::from_i32(code),
            next_pc,
            exit_info,
            trap: None,
        })
    }

    fn invalidate_all(&mut self) {
        // E4-T18: tear down every live link (count them cut) then drop all chaining state. The
        // stats counters persist so an A/B report survives a whole-cache flush.
        let live_links = self.slots.iter().filter(|&&s| s != STUB).count() as u64;
        self.stats.links_cut += live_links;
        self.blocks.clear();
        self.slots.clear();
        self.table.clear();
        self.phys_to_index.clear();
        self.incoming.clear();
        self.free_table.clear();
        self.free_slots1.clear();
        self.free_slots2.clear();
        self.batches.clear();
        // E4-T20: a whole-cache flush bumps the generation and clears the post-eviction
        // re-translation tracking (those blocks are gone by reset/fence.i, not by budget churn).
        self.generation = self.generation.wrapping_add(1);
        self.evicted_phys.clear();
    }

    fn invalidate_page(&mut self, frame: u64) {
        // E4-T19: whole-batch retirement. A page-granular SMC store that hits ANY block in a batch
        // retires the ENTIRE batch (Module/Instance) — because intra-batch edges are DIRECT calls
        // baked into one module, a partial kill could leave a live block direct-calling dead bytes;
        // dropping the whole module atomically makes that impossible. The surviving members fall back
        // to T1 and recompile (into fresh batches) on re-execution. `remove_block` (E4-T18) restores
        // every incoming link-slot from surviving predecessors on OTHER pages to the dispatch stub.
        let dead_batches: Vec<u32> = {
            let mut ids: Vec<u32> = self
                .blocks
                .values()
                .filter(|c| c.page_frame == frame)
                .map(|c| c.batch_id)
                .collect();
            ids.sort_unstable();
            ids.dedup();
            ids
        };
        for bid in dead_batches {
            self.retire_batch(bid);
        }
    }

    fn compiled_count(&self) -> usize {
        self.blocks.len()
    }

    fn executed_blocks(&self) -> u64 {
        self.executed_blocks
    }

    fn retired_via_jit(&self) -> u64 {
        self.retired_via_jit
    }

    fn note_jit_retired(&mut self, retired: u64) {
        self.retired_via_jit = self.retired_via_jit.wrapping_add(retired);
    }

    // ── E4-T18: chaining ──

    fn set_chaining(&mut self, on: bool) {
        self.chaining = on;
    }

    fn chaining(&self) -> bool {
        self.chaining
    }

    fn set_chain_depth_budget(&mut self, n: u32) {
        self.chain_depth_budget = n.max(1);
    }

    fn chain_depth_budget(&self) -> u32 {
        self.chain_depth_budget
    }

    fn link_edge(&mut self, from_phys: u64, edge: u8, to_phys: u64) {
        if !self.chaining {
            return;
        }
        // Both endpoints must be live-compiled; the successor's table index is what the slot holds.
        let Some(&ti) = self.phys_to_index.get(&to_phys) else {
            return;
        };
        let (slot_base, nslots) = match self.blocks.get(&from_phys) {
            Some(c) => (c.slot_base, c.nslots),
            None => return,
        };
        if edge >= nslots {
            // Out-of-range edge (a dynamic `jalr` target) — never statically linked.
            return;
        }
        let slot = slot_base + u32::from(edge);
        let cur = self.slots[slot as usize];
        if cur == ti {
            return; // already linked to this successor — count the edge only once.
        }
        if cur != STUB {
            // Re-target: drop the stale incoming record (shouldn't happen for a static edge, but
            // keep the map exact).
            if let Some(v) = self.incoming.get_mut(&cur) {
                v.retain(|x| *x != slot);
            }
        }
        self.slots[slot as usize] = ti;
        self.incoming.entry(ti).or_default().push(slot);
        self.stats.links_made += 1;
    }

    fn linked_target(&self, from_phys: u64, edge: u8) -> Option<u64> {
        let c = self.blocks.get(&from_phys)?;
        if edge >= c.nslots {
            return None;
        }
        let slot = self.slots[(c.slot_base + u32::from(edge)) as usize];
        if slot == STUB {
            return None;
        }
        self.table[slot as usize]
    }

    fn note_chain(&mut self, depth: u32) {
        self.stats.dispatch_entries += 1;
        if depth > self.stats.max_chain_depth {
            self.stats.max_chain_depth = depth;
        }
        let bucket = (depth as usize).min(CHAIN_DEPTH_HIST_LEN - 1);
        self.stats.depth_hist[bucket] += 1;
    }

    fn chain_stats(&self) -> ChainStats {
        self.stats
    }

    // ── E4-T20: budgets, eviction policy, stats ──

    fn set_jit_budget(&mut self, budget: JitCacheBudget) {
        self.budget = budget;
        // A shrunk budget applies immediately: evict down to fit (no incoming batch this call).
        self.enforce_budget(0, 0);
    }

    fn jit_budget(&self) -> JitCacheBudget {
        self.budget
    }

    fn set_evict_policy(&mut self, policy: EvictPolicy) {
        self.policy = policy;
    }

    fn evict_policy(&self) -> EvictPolicy {
        self.policy
    }

    fn jit_cache_stats(&self) -> JitCacheStats {
        JitCacheStats {
            code_bytes: self.estimated_bytes(),
            batches: self.batches.len(),
            table_slots: self.table.len(),
            metadata_bytes: self.metadata_bytes_est(),
            budget: self.budget,
            policy: self.policy,
            evictions: self.evictions,
            flushes: self.flushes,
            retranslations: self.retranslations,
            installs: self.installs,
            generation: self.generation,
        }
    }

    fn take_evicted(&mut self) -> Vec<u64> {
        std::mem::take(&mut self.newly_evicted)
    }

    fn evict_batch_containing(&mut self, phys_pc: u64) -> bool {
        let Some(bid) = self.blocks.get(&phys_pc).map(|c| c.batch_id) else {
            return false;
        };
        self.evict_batch(bid)
    }
}

#[cfg(test)]
mod tests {
    use super::JitMap;

    #[test]
    fn mixed_jit_maps_survive_aligned_same_low_bit_churn() {
        const N: usize = 32 * 1024;

        // Every physical-PC key has the same low 32 bits (and is page aligned), an adversarial
        // pattern for raw-identity hashers. Insert, retrieve in reverse order, then remove a sparse
        // subset and prove all surviving identities remain exact.
        let mut pc_map = JitMap::<u64, u64>::default();
        pc_map.reserve(N);
        for i in 0..N as u64 {
            let key = (i << 32) | 0x1000;
            assert_eq!(pc_map.insert(key, i ^ 0x5a5a_5a5a), None);
        }
        for i in (0..N as u64).rev() {
            let key = (i << 32) | 0x1000;
            assert_eq!(pc_map.get(&key), Some(&(i ^ 0x5a5a_5a5a)));
        }
        for i in (0..N as u64).step_by(3) {
            let key = (i << 32) | 0x1000;
            assert_eq!(pc_map.remove(&key), Some(i ^ 0x5a5a_5a5a));
        }
        for i in 0..N as u64 {
            let key = (i << 32) | 0x1000;
            assert_eq!(pc_map.contains_key(&key), i % 3 != 0);
        }

        // Compact batch/table ids use the u32 hasher entry point. Hold their low 12 bits constant
        // too, so both integer-width implementations are exercised by the churn gate.
        let mut id_map = JitMap::<u32, u32>::default();
        id_map.reserve(N);
        for i in 0..N as u32 {
            let key = (i << 12) | 0x80;
            assert_eq!(id_map.insert(key, i.rotate_left(7)), None);
        }
        for i in (0..N as u32).rev() {
            let key = (i << 12) | 0x80;
            assert_eq!(id_map.remove(&key), Some(i.rotate_left(7)));
        }
        assert!(id_map.is_empty());
    }
}
