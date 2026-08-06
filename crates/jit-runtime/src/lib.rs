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
use wasm_vm_core::dispatch::DecodedBlock;
use wasm_vm_core::hart::{Hart, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode, JitExit, abi};
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
}

/// The native wasmtime-backed [`CompiledBlockExecutor`].
pub struct WasmtimeExecutor {
    engine: Engine,
    linker: Linker<HostCtx>,
    store: Store<HostCtx>,
    blocks: HashMap<u64, Compiled>,
    executed_blocks: u64,
    retired_via_jit: u64,
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
        self.blocks.insert(
            block.phys_start,
            Compiled {
                run,
                mem,
                page_frame: block.page_frame,
                nops: block.ops.len() as u64,
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
        self.blocks.clear();
    }

    fn invalidate_page(&mut self, frame: u64) {
        self.blocks.retain(|_, c| c.page_frame != frame);
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
}
