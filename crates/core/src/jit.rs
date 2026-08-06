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
}

/// A boxed executor, held by [`Machine`](crate::Machine). Aliased for readability at the field.
pub type BoxedExecutor = Box<dyn CompiledBlockExecutor>;
