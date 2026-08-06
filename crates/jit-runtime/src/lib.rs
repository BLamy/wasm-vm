//! # `jit-runtime` — E4-T10: the native compiled-block executor (wasmtime)
//!
//! Implements [`wasm_vm_core::jit::CompiledBlockExecutor`] with wasmtime. It closes the tier-up loop
//! for RV64I blocks: the `Machine` run loop hands nominated hot [`DecodedBlock`]s to
//! [`WasmtimeExecutor::install`] (which translates them with E4-T09's `translate_block` and compiles
//! the emitted module), and at each block boundary asks whether the block at the current physical PC
//! is compiled — if so, [`WasmtimeExecutor::execute`] runs it against the live guest state instead of
//! interpreting.
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
//!    frozen exit protocol (`exit_pc` / `exit_reason` / `exit_info`) is read from linear memory. On a
//!    faulted-out call NOTHING is committed (the run loop re-interprets the block from its entry).
//!
//! The browser executor (`WebAssembly.Module`) and block chaining are later tickets (E4-T19/T18).

use std::collections::HashMap;

use anyhow::anyhow;
use jit_translate::{Abi, translate_batch};
use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::DecodedBlock;
use wasm_vm_core::hart::{Hart, Trap};
use wasm_vm_core::jit::{
    CHAIN_DEPTH_BUDGET_DEFAULT, CHAIN_DEPTH_HIST_LEN, ChainStats, CompiledBlockExecutor, ExitCode,
    JitExit, abi,
};
use wasm_vm_core::mmio::SystemBus;
use wasmtime::{Caller, Engine, Instance, Linker, Memory, Module, Store, TypedFunc};

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
/// frame (for page-granular invalidation), and guest op count (for the retire-clock accounting the
/// run loop performs).
struct Compiled {
    run: TypedFunc<i32, i32>,
    mem: Memory,
    page_frame: u64,
    nops: u64,
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
    blocks: HashMap<u64, Compiled>,
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
    phys_to_index: HashMap<u64, u32>,
    /// Incoming-edge map: target table index → the slot indices that currently point at it. This is
    /// what unlink walks to restore stubs on invalidation; pruned as links are cut.
    incoming: HashMap<u32, Vec<u32>>,
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
    batches: HashMap<u32, Batch>,
    /// Monotonic batch-id allocator.
    next_batch_id: u32,
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
            blocks: HashMap::new(),
            executed_blocks: 0,
            retired_via_jit: 0,
            chaining: true,
            chain_depth_budget: CHAIN_DEPTH_BUDGET_DEFAULT,
            slots: Vec::new(),
            table: Vec::new(),
            phys_to_index: HashMap::new(),
            incoming: HashMap::new(),
            free_table: Vec::new(),
            free_slots1: Vec::new(),
            free_slots2: Vec::new(),
            stats: ChainStats::default(),
            batch_size: DEFAULT_BATCH_SIZE,
            batches: HashMap::new(),
            next_batch_id: 0,
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

    fn read_u64(&mut self, mem: Memory, off: u32) -> u64 {
        let mut b = [0u8; 8];
        mem.read(&self.store, off as usize, &mut b)
            .expect("CpuState read in bounds");
        u64::from_le_bytes(b)
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
            let nslots = Self::nslots_for(b);
            let (table_index, slot_base) = self.alloc_block(b.phys_start, nslots);
            self.blocks.insert(
                b.phys_start,
                Compiled {
                    run,
                    mem,
                    page_frame: b.page_frame,
                    nops: b.ops.len() as u64,
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
        let est_bytes = bytes.len() as u64 + INSTANCE_OVERHEAD_BYTES;
        self.batches.insert(batch_id, Batch { members, est_bytes });
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
        let (run, mem, nops) = {
            let c = self.blocks.get(&phys_pc)?;
            (c.run.clone(), c.mem, c.nops)
        };
        // Sync guest registers into the module's CpuState region (x0..x31; x0 is a hardwired 0).
        for r in 0..32u8 {
            let off = abi::XREG_BASE + u32::from(r) * 8;
            mem.write(
                &mut self.store,
                off as usize,
                &hart.regs.read(r).to_le_bytes(),
            )
            .expect("CpuState reg write in bounds");
        }
        // E4-T16: write the guest VIRTUAL entry PC so the block emits PC-relative (virtual) targets.
        // Under paging the physical block key `phys_pc` != the guest virtual PC; the compiled block
        // computes every guest-visible PC as `entry_pc + delta`, so control flow, `auipc`, link
        // values, and fault mepc are the running guest's virtual addresses — and a physically-keyed
        // block reused from a NEW virtual mapping still produces correct PCs.
        mem.write(
            &mut self.store,
            abi::ENTRY_PC as usize,
            &hart.regs.pc.to_le_bytes(),
        )
        .expect("CpuState entry_pc write in bounds");
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
                for r in 1..32u8 {
                    let off = abi::XREG_BASE + u32::from(r) * 8;
                    let mut b = [0u8; 8];
                    mem.read(&self.store, off as usize, &mut b)
                        .expect("CpuState reg read in bounds");
                    hart.regs.write(r, u64::from_le_bytes(b));
                }
                let faulting_pc = self.read_u64(mem, abi::EXIT_PC);
                self.executed_blocks += 1;
                return Some(JitExit {
                    code: ExitCode::Trap,
                    next_pc: faulting_pc,
                    exit_info: trap.cause as u64,
                    trap: Some(trap),
                });
            }
        };
        // Clean return: sync registers back (skip x0), then read the frozen exit protocol.
        for r in 1..32u8 {
            let off = abi::XREG_BASE + u32::from(r) * 8;
            let mut b = [0u8; 8];
            mem.read(&self.store, off as usize, &mut b)
                .expect("CpuState reg read in bounds");
            hart.regs.write(r, u64::from_le_bytes(b));
        }
        let next_pc = self.read_u64(mem, abi::EXIT_PC);
        let exit_info = self.read_u64(mem, abi::EXIT_INFO);
        // The return value is the authoritative exit code; `exit_reason` in memory mirrors it.
        debug_assert_eq!(code, self.read_u64(mem, abi::EXIT_REASON) as i32);
        self.executed_blocks += 1;
        self.retired_via_jit += nops;
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
}
