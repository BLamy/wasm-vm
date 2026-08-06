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
use jit_translate::{Abi, translate_block};
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
}

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
        // Already compiled (dedup): the run loop only nominates once per generation, but be robust.
        if self.blocks.contains_key(&block.phys_start) {
            return;
        }
        // Translate → emitted WASM. An out-of-scope opcode (M/A/F/D, CSR, …) is `Unsupported`: skip,
        // leaving the block to the interpreter.
        let bytes = match translate_block(block, &Abi::FROZEN) {
            Ok(b) => b,
            Err(_) => return,
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
        let run = match instance.get_typed_func::<i32, i32>(&mut self.store, "run") {
            Ok(f) => f,
            Err(_) => return,
        };
        // E4-T18: give the block a table index + stub-initialized link-slots (1 or 2).
        let nslots = Self::nslots_for(block);
        let (table_index, slot_base) = self.alloc_block(block.phys_start, nslots);
        self.blocks.insert(
            block.phys_start,
            Compiled {
                run,
                mem,
                page_frame: block.page_frame,
                nops: block.ops.len() as u64,
                table_index,
                slot_base,
                nslots,
            },
        );
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
    }

    fn invalidate_page(&mut self, frame: u64) {
        // E4-T18: collect the dead blocks first, then unlink+remove each so every incoming edge
        // (from surviving predecessors on OTHER pages) is restored to the dispatch stub — no live
        // slot may point into a block this page just dropped.
        let dead: Vec<u64> = self
            .blocks
            .iter()
            .filter(|(_, c)| c.page_frame == frame)
            .map(|(&p, _)| p)
            .collect();
        for phys in dead {
            self.remove_block(phys);
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
