//! # `jit-translate` — E4-T09: RV64I basic-block → WASM function translation
//!
//! The heart of the WASM JIT (`docs/jit-architecture.md` §3–§4). [`translate_block`] turns exactly
//! one predecoded [`DecodedBlock`] (RV64I only) into one WASM *module* exporting a single function
//! `run(state_base: i32) -> i32` that implements the frozen E4-T06 ABI:
//!
//! * **Register mapping — lazy load, eager writeback.** Guest x1..x31 live in WASM `i64` locals. A
//!   register is loaded from the `CpuState` region of linear memory (`state_base + 8*r`) on first
//!   read in the block and kept in its local thereafter; `x0` reads fold to `i64.const 0` and writes
//!   are discarded. Every register a block dirties is written back to linear memory at *every* exit
//!   point (the correct-and-simple discipline of §3.2 — writeback the whole dirty set before any
//!   exit / any op that could be observed by the runtime).
//! * **Exits.** The block writes `exit_pc` (next guest PC) + `exit_reason` into the header and
//!   returns an [`ExitCode`]: straight-line end / not-taken branch → [`ExitCode::Fallthrough`];
//!   taken branch / `jal` / `jalr` → [`ExitCode::BranchTaken`]; `ecall`/`ebreak` → [`ExitCode::Trap`].
//! * **Loads/stores** side-exit to two runtime imports (`env.load` / `env.store`) — the real inline
//!   TLB fast path is E4-T11. The imports carry the effective address + width, matching the
//!   interpreter's memory effects exactly.
//!
//! Semantics are taken verbatim from `wasm-vm-core`'s `Hart::execute` (the reference), not guessed:
//! `*W` ops compute in i32 then sign-extend, RV64 shifts mask to 6 bits (5 for `*W`), `jalr` clears
//! bit 0, `slt`/`sltu` are signed/unsigned. The differential harness (`tests/differential.rs`) proves
//! byte-identity under wasmtime against `Hart::exec_oracle`.
//!
//! Scope is **RV64I base integer + the M (multiply/divide) extension** (E4-T13 added M with exact
//! RISC-V corner-case semantics — the div/rem trap guards + the composed MULH* high-multiply). C
//! (compressed) ops arrive pre-expanded to their 32-bit form from the E4-T05 predecoder, each with a
//! per-op 2-byte length, so all PC arithmetic (fall-through, branch/jal targets, `pc+2` link values,
//! block byte-ranges) is length-driven and correct for mixed-width blocks. A/F/D and CSR/system
//! instructions remain out of scope (later tickets); [`translate_block`] returns
//! [`TranslateError::Unsupported`] for them so the caller keeps interpreting the block.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

use alloc::vec::Vec;
use wasm_emit::{
    BlockType, ExportKind, FuncBuilder, FuncType, Limits, MemType, ModuleBuilder, RefType,
    TableType, ValType,
};
use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::{DecodedBlock, is_terminator};

// ── E4-T25 test-only mutation hooks ─────────────────────────────────────────
//
// The verification doctrine (E4-T25) must PROVE its lockstep/fuzz rig can actually catch a
// mis-translation, not just hope so. To do that without ever shipping a broken translator, this
// crate carries a set of DELIBERATE mis-translations behind the `mutation-testing` cargo feature
// (OFF by default → the entire mechanism compiles to `false` and is optimized away, so the shipped
// translator is byte-for-byte unchanged). When the feature is on, a test sets the active mutation
// via the `mutation` module and every generated block for the process emits the buggy form at the
// hooked codegen site, so the fuzzer/lockstep comparator observes a JIT-vs-interpreter divergence.
//
// The registry is a single process-global atomic (works in `no_std` via `core::sync::atomic`; the
// tests drive it single-threaded). Each hook is a `#[inline]` predicate that is a literal `false`
// when the feature is off, so no shipping code path branches on it.
#[allow(dead_code)] // NONE + ACTIVE are only read under the `mutation-testing` feature.
pub(crate) mod mut_hooks {
    use core::sync::atomic::AtomicU8;
    /// No mutation — the correct translator.
    pub const NONE: u8 = 0;
    /// SRAW emitted as a 64-bit arithmetic shift (wrong operand width + shift mask: 6-bit mod-64 on
    /// the full 64-bit `rs1` instead of a 5-bit mod-32 on `(i32)rs1`). The ticket's named
    /// "off-by-one shift mask" / "mis-translate SRAW" bug.
    pub const SHIFT_MASK_WRONG: u8 = 1;
    /// LW lowered with the LWU (zero-extending) load kind — the dropped sign-extension bug.
    pub const LW_DROP_SEXT: u8 = 2;
    /// A conditional branch's TAKEN exit skips the dirty-register writeback — the "wrong writeback on
    /// a taken-branch exit" bug (a register dirtied before the branch is not flushed to memory).
    pub const TAKEN_BRANCH_NO_WRITEBACK: u8 = 3;
    /// DIV/REM drop the architectural divide-by-zero override `select`, so `x/0` yields the sanitized
    /// `x/1 == x` instead of the RISC-V-defined `-1` (div) / dividend (rem). A semantic-mine bug.
    pub const DIV_ZERO_WRONG: u8 = 4;
    /// JALR omits the mandatory `target & !1` bit-0 clear — diverges only on odd computed targets.
    pub const JALR_NO_CLEAR_BIT0: u8 = 5;
    pub(crate) static ACTIVE: AtomicU8 = AtomicU8::new(NONE);
}

/// E4-T25: the process-global mutation registry (test-only, `mutation-testing` feature). Setting a
/// non-`NONE` mutation makes every subsequently-translated block emit that deliberate bug.
#[cfg(feature = "mutation-testing")]
pub mod mutation {
    use super::mut_hooks;
    pub use super::mut_hooks::{
        DIV_ZERO_WRONG, JALR_NO_CLEAR_BIT0, LW_DROP_SEXT, NONE, SHIFT_MASK_WRONG,
        TAKEN_BRANCH_NO_WRITEBACK,
    };
    use core::sync::atomic::Ordering;
    /// Human-readable name for a mutation code (for repro reports).
    pub fn name(m: u8) -> &'static str {
        match m {
            NONE => "none",
            SHIFT_MASK_WRONG => "sraw-wrong-shift-mask",
            LW_DROP_SEXT => "lw-dropped-sign-extension",
            TAKEN_BRANCH_NO_WRITEBACK => "taken-branch-skips-writeback",
            DIV_ZERO_WRONG => "div-by-zero-wrong-result",
            JALR_NO_CLEAR_BIT0 => "jalr-omits-bit0-clear",
            _ => "unknown",
        }
    }
    /// The full set of injected bugs the adversarial mutation-adequacy sweep runs over.
    pub const ALL: [u8; 5] = [
        SHIFT_MASK_WRONG,
        LW_DROP_SEXT,
        TAKEN_BRANCH_NO_WRITEBACK,
        DIV_ZERO_WRONG,
        JALR_NO_CLEAR_BIT0,
    ];
    /// Activate mutation `m` for all subsequent translations in this process.
    pub fn set(m: u8) {
        mut_hooks::ACTIVE.store(m, Ordering::SeqCst);
    }
    /// Restore the correct translator.
    pub fn clear() {
        set(NONE);
    }
    /// The currently-active mutation.
    pub fn active() -> u8 {
        mut_hooks::ACTIVE.load(Ordering::SeqCst)
    }
}

#[inline(always)]
fn mutation_is(_m: u8) -> bool {
    #[cfg(feature = "mutation-testing")]
    {
        mut_hooks::ACTIVE.load(core::sync::atomic::Ordering::SeqCst) == _m
    }
    #[cfg(not(feature = "mutation-testing"))]
    {
        false
    }
}

/// The frozen `CpuState` linear-memory layout (subset E4-T09 touches), byte offsets from the
/// `state_base` argument (`docs/jit-architecture.md` §3.1). Kept as a struct — not scattered
/// literals — so the one authoritative definition is here and the harness reads back through the
/// *same* offsets a mutation would have to change in lock-step (adversarial #3 pins the literals
/// independently in the test).
#[derive(Clone, Copy, Debug)]
pub struct Abi {
    /// Base of the `x[0..32]` guest integer register array (each register is 8 bytes).
    pub xreg_base: u32,
    /// `exit_reason` — the [`ExitCode`] the block wrote before returning.
    pub exit_reason: u32,
    /// `exit_pc` — the guest PC to resume at.
    pub exit_pc: u32,
    /// `exit_info` — aux payload (trap cause for `ecall`/`ebreak`).
    pub exit_info: u32,
    /// E4-T16: `entry_pc` — the guest VIRTUAL PC the block was entered at, written by the runtime
    /// before each `run` call. The block emits every guest-visible PC relative to this (see
    /// `push_pc_rel`) so compiled code is correct under paging and when reused from a new VA.
    pub entry_pc: u32,
    /// E4-T19: `chain_enabled` — a one-byte flag in the CpuState header the runtime writes before a
    /// `run` call. When ZERO (the deterministic native default), an intra-batch statically-known edge
    /// takes the plain "write exit protocol + return" path — byte-for-byte the E4-T18 per-block
    /// behavior, so the retire clock / interrupt batching stay exactly as proven. When NON-zero (the
    /// browser in-wasm chaining path, deferred to E4-T25's differential harness) the same edge instead
    /// makes a DIRECT `call` to the successor block's function in the SAME module (no `call_indirect`,
    /// no dispatch bounce), tail-returning its exit code. The direct call is emitted unconditionally
    /// into the bytes (AC3), gated at runtime by this flag.
    pub chain_enabled: u32,
    /// E4-T34: shared accumulator for the exact number of guest instructions retired by a direct
    /// in-module chain.
    pub chain_retired: u32,
    /// E4-T34: shared guest-work fuel consumed at each compiled-function entry. A successor that
    /// cannot fit returns [`ExitCode::Budget`] without executing an instruction.
    pub chain_budget: u32,
    /// E4-T34: byte-sized side-effect barrier set by host imports that require a Rust boundary
    /// before another compiled successor can run.
    pub chain_abort: u32,
    /// E4-T34: count of raw inline-RAM stores waiting for host-side commit.
    pub store_log_count: u32,
    /// E4-T34: base of the raw inline-RAM store log in the shared state image.
    pub store_log_base: u32,
    /// E4-T34: capacity of the raw inline-RAM store log. Zero keeps the standalone inline-TLB
    /// translator in its historical raw-store mode without claiming host-side commit semantics.
    pub store_log_capacity: u32,
    /// Whether this ABI emits the bounded chain-fuel and retirement protocol. The frozen native
    /// ABI keeps it false; the browser imported-memory ABI opts in explicitly.
    pub direct_chain: bool,
    /// E4-T34: base of the browser's direct-mapped virtual-target cache. A matching entry contains
    /// the target virtual PC and a one-based imported funcref-table index. Zero means no guarded
    /// dynamic successor is currently published.
    pub dynamic_map_base: u32,
    /// E4-T34: `dynamic_map_base` slot mask; the map has power-of-two entries and 16-byte slots.
    pub dynamic_map_mask: u32,
    /// E4-T34: whether translated `jalr` exits may use the guarded dynamic table path.
    pub dynamic_chain: bool,
    /// E4-T34: imported funcref table index used by guarded dynamic calls.
    pub chain_table: u32,
    /// How generated loads/stores reach guest memory (E4-T11).
    pub mem: MemModel,
    /// E4-T11 inline-TLB layout (only consulted when `mem == InlineTlb`). Byte offsets into the ONE
    /// shared linear memory; the runtime lays the memory out at exactly these offsets.
    pub tlb: TlbLayout,
}

/// How translated loads/stores reach guest memory (`docs/jit-architecture.md` §4.2 / E4-T11).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemModel {
    /// E4-T09 default: every load/store side-exits to the `env.load` / `env.store` imports; the
    /// runtime performs the whole translated + PMP-checked access. Simple and always correct; one
    /// host call-out per access.
    SoftmmuImports,
    /// E4-T11: the block inlines a direct-mapped software-TLB probe against arrays in the shared
    /// linear memory. On a hit (page cached with the right permission, naturally aligned) it does a
    /// raw `i64.load`/`store` straight into the guest-RAM window — no host call. On a miss (cold /
    /// tag mismatch / misaligned-or-straddling) it calls `env.softmmu_load` / `env.softmmu_store`,
    /// which runs the interpreter's exact `cload*`/`cstore*` path, fills the TLB, and returns.
    InlineTlb,
    /// Browser integration variant: loads use the inline-TLB probe, while stores always call the
    /// ordinary `env.store` import so the bus records SMC/DMA page writes and the hart applies
    /// LR/SC reservation invalidation. A runtime may promote stores to [`Self::InlineTlb`] only
    /// after providing an equivalent post-store commit log.
    InlineTlbLoads,
}

/// Fixed byte layout of the inline-TLB arrays + guest-RAM window inside the shared linear memory
/// (E4-T11). Three direct-mapped arrays (read / write / execute) of `entries` slots, each slot
/// `{ tag: i64, addend: i64 }` (16 bytes). `tag == (vpage) | VALID` selects the page (VALID is
/// bit 0, free because a 4 KiB page base has zero low bits); `addend` is chosen so the hit-path host
/// linear address is exactly `vaddr + addend`. Separate read/write arrays are what make a store to a
/// read-only page always miss (its write slot is never filled) — the permission distinction the
/// interpreter enforces, encoded structurally.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TlbLayout {
    /// Number of slots per array (power of two; index = `vpn & (entries-1)`).
    pub entries: u32,
    /// Byte base of the LOAD (read-permission) TLB array.
    pub read_base: u32,
    /// Byte base of the STORE (write-permission) TLB array.
    pub write_base: u32,
    /// Byte base of the FETCH (execute-permission) TLB array — reserved; fetch is not JITted.
    pub exec_base: u32,
    /// Byte offset in the linear memory where guest physical `dram_base` maps (page-aligned).
    pub ram_base: u32,
    /// The guest physical address that maps to `ram_base` (normally `DRAM_BASE`).
    pub dram_base: u64,
}

impl TlbLayout {
    /// Bytes per slot (`{tag,addend}` = 2×8).
    pub const SLOT: u32 = 16;
    /// Slot field: the `tag` i64.
    pub const TAG_OFF: u32 = 0;
    /// Slot field: the `addend` i64.
    pub const ADDEND_OFF: u32 = 8;
    /// The tag's VALID bit (bit 0; a page base's low 12 bits are always zero, so bit 0 is free).
    pub const VALID: i64 = 1;

    /// The frozen E4-T11 layout: 256 slots/array, arrays at 0x1000/0x2000/0x3000, guest RAM at
    /// 0x4000. `dram_base` is the canonical `DRAM_BASE` (0x8000_0000). Total linear-memory size the
    /// runtime must allocate is `ram_base + ram_bytes`.
    pub const FROZEN: TlbLayout = TlbLayout {
        entries: 256,
        read_base: 0x1000,
        write_base: 0x2000,
        exec_base: 0x3000,
        ram_base: 0x4000,
        dram_base: 0x8000_0000,
    };
}

impl Abi {
    /// The frozen layout from §3.1: `x[]` at `+0x000`, `exit_reason` `+0x218`, `exit_pc` `+0x220`,
    /// `exit_info` `+0x228`. Memory model defaults to the E4-T09 softmmu imports (the E4-T10
    /// executor and the E4-T09 differential harness use this).
    pub const FROZEN: Abi = Abi {
        xreg_base: 0x000,
        exit_reason: 0x218,
        exit_pc: 0x220,
        exit_info: 0x228,
        entry_pc: 0x230,
        chain_enabled: 0x250,
        chain_retired: 0x238,
        chain_budget: 0x240,
        chain_abort: 0x248,
        store_log_count: 0,
        store_log_base: 0,
        store_log_capacity: 0,
        direct_chain: false,
        dynamic_map_base: 0,
        dynamic_map_mask: 0,
        dynamic_chain: false,
        chain_table: 0,
        mem: MemModel::SoftmmuImports,
        tlb: TlbLayout::FROZEN,
    };

    /// The frozen layout with the E4-T11 inline-TLB memory model selected.
    pub const INLINE_TLB: Abi = Abi {
        xreg_base: 0x000,
        exit_reason: 0x218,
        exit_pc: 0x220,
        exit_info: 0x228,
        entry_pc: 0x230,
        chain_enabled: 0x250,
        chain_retired: 0x238,
        chain_budget: 0x240,
        chain_abort: 0x248,
        store_log_count: 0,
        store_log_base: 0,
        store_log_capacity: 0,
        direct_chain: false,
        dynamic_map_base: 0,
        dynamic_map_mask: 0,
        dynamic_chain: false,
        chain_table: 0,
        mem: MemModel::InlineTlb,
        tlb: TlbLayout::FROZEN,
    };
}

/// The frozen 9-variant exit-code enum (`docs/jit-architecture.md` §3.3). E4-T09 emits the first
/// three; the rest are reserved for later tickets (MMIO/MMU/CALL_INTERP/NOT_COMPILED/BUDGET).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum ExitCode {
    Fallthrough = 0,
    BranchTaken = 1,
    Trap = 2,
    InterruptPoll = 3,
    Mmio = 4,
    MmuMiss = 5,
    CallInterp = 6,
    NotCompiled = 7,
    Budget = 8,
}

/// Why a block could not be translated. The only case E4-T09 raises is an out-of-scope opcode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TranslateError {
    /// An instruction outside the translated ISA (RV64I + M): A/F/D, CSR, xRET, sfence, wfi. The
    /// caller keeps the block in the interpreter (T0/T1).
    Unsupported,
    /// Structural invariant violated (a terminator not at the block end). Should never happen for a
    /// well-formed `DecodedBlock`.
    Malformed,
}

// ── module layout constants ─────────────────────────────────────────────────
const STATE_BASE: u32 = 0; // param local 0 — the CpuState base address (i32)
const LOAD_IMPORT: u32 = 0; // env.load(addr i64, kind i32) -> i64
const STORE_IMPORT: u32 = 1; // env.store(addr i64, val i64, width i32)
// E4-T14 A-extension imports. AMO/LR/SC route through the runtime, which calls the interpreter's
// OWN atomic + reservation code (`Hart::jit_amo/jit_lr/jit_sc`) — byte-identical semantics AND a
// single shared `resv` state, so a JIT/interp tier switch mid-LR/SC is coherent. (The forward-
// looking inline wasm-atomic-RMW form the ticket also envisions needs guest RAM in the wasm linear
// memory, which the integrated executor does not have yet — E4-T11 deferred that — so it is not the
// integrated path; see the module docs.)
const AMO_IMPORT: u32 = 2; // env.amo(addr i64, val i64, op i32, width i32) -> i64 (old value)
const LR_IMPORT: u32 = 3; // env.lr(addr i64, width i32) -> i64 (rd value)
const SC_IMPORT: u32 = 4; // env.sc(addr i64, val i64, width i32) -> i64 (0 success / 1 fail)
const ALIGN8: u32 = 3; // log2(8) memarg alignment hint for i64 loads/stores

/// The `AmoOp` discriminant passed to the `env.amo` import — MUST match the mapping
/// `Hart::jit_amo` decodes (0 swap … 8 maxu).
fn amo_op_code(op: wasm_vm_core::decode::AmoOp) -> i32 {
    use wasm_vm_core::decode::AmoOp::*;
    match op {
        Swap => 0,
        Add => 1,
        Xor => 2,
        And => 3,
        Or => 4,
        Min => 5,
        Max => 6,
        Minu => 7,
        Maxu => 8,
    }
}

/// Load "kind" codes passed to the `env.load` import: width + signedness, matching the
/// interpreter's extension rules for `lb/lh/lw/ld/lbu/lhu/lwu`.
mod load_kind {
    pub const LB: i32 = 0;
    pub const LH: i32 = 1;
    pub const LW: i32 = 2;
    pub const LD: i32 = 3;
    pub const LBU: i32 = 4;
    pub const LHU: i32 = 5;
    pub const LWU: i32 = 6;
}

/// Per-register allocation state for one block translation.
struct Regs {
    /// Local index holding guest register `r`, once materialized (loaded or written).
    local: [Option<u32>; 32],
    /// Whether guest register `r` was modified and must be written back at exits.
    dirty: [bool; 32],
    /// E4-T16: the block's entry PC the compile-time PC constants are relative to (`phys_start`).
    /// Every guest-visible PC the block writes (branch/jal targets, `auipc`, link values, `exit_pc`,
    /// fault mepc) is emitted as `entry_local + (abs - base_pc)` so it is the running guest's VIRTUAL
    /// PC, not the physical block key — the phys-keying invariant requires a block reused from a
    /// DIFFERENT virtual address to produce correct virtual PCs, so the entry VA is a RUNTIME input.
    base_pc: u64,
    /// The WASM local (i64) holding the runtime-supplied entry virtual PC (loaded from
    /// `abi.entry_pc` at the function prologue).
    entry_local: u32,
    /// E4-T34: the chain-retired value observed at this function's entry. Potentially trapping
    /// imports publish a precise prefix from this stable base; a clean exit publishes the full
    /// block span.
    chain_start: Option<u32>,
}

impl Regs {
    fn new(base_pc: u64, entry_local: u32, chain_start: Option<u32>) -> Self {
        Regs {
            local: [None; 32],
            dirty: [false; 32],
            base_pc,
            entry_local,
            chain_start,
        }
    }
}

/// E4-T16: push the guest VIRTUAL PC for compile-time-absolute `abs` onto the stack as an i64 —
/// `entry_local + (abs - base_pc)`. `abs` is a physical-keyed constant (`base_pc`-relative); the
/// delta is a fixed compile-time offset added to the runtime entry VA, so a block reused from a new
/// virtual mapping (the phys-keying reuse case) still writes correct virtual PCs.
fn push_pc_rel(f: &mut FuncBuilder, regs: &Regs, abs: u64) {
    f.local_get(regs.entry_local);
    let delta = abs.wrapping_sub(regs.base_pc) as i64;
    if delta != 0 {
        f.i64_const(delta);
        f.i64_add();
    }
}

/// Publish the exact retirement prefix for a potentially trapping operation. On a successful
/// operation the block's clean exit overwrites this with the full span; on an import exception the
/// runtime reads this value after the wasm stack unwinds.
fn record_chain_retired(f: &mut FuncBuilder, regs: &Regs, abi: &Abi, retired: u64) {
    let Some(chain_start) = regs.chain_start else {
        return;
    };
    f.local_get(STATE_BASE);
    f.local_get(chain_start);
    f.i64_const(retired as i64);
    f.i64_add();
    f.i64_store(ALIGN8, abi.chain_retired);
}

/// Enter the E4-T34 direct-chain protocol. The first block is checked by the core before dispatch,
/// but direct successors must repeat this guard so a chained call never consumes more guest work
/// than the enclosing `Machine::run` budget.
fn emit_chain_prologue(f: &mut FuncBuilder, abi: &Abi, entry_local: u32, nops: u64) {
    f.local_get(STATE_BASE);
    f.i64_load(ALIGN8, abi.chain_budget);
    f.i64_const(nops as i64);
    f.i64_lt_u();
    f.if_(BlockType::Empty);
    write_pc_local(f, abi, entry_local);
    write_reason(f, abi, ExitCode::Budget);
    f.i32_const(ExitCode::Budget as i32);
    f.return_();
    f.else_();
    f.local_get(STATE_BASE);
    f.local_get(STATE_BASE);
    f.i64_load(ALIGN8, abi.chain_budget);
    f.i64_const(nops as i64);
    f.i64_sub();
    f.i64_store(ALIGN8, abi.chain_budget);
    f.end();
}

/// Translate one RV64I [`DecodedBlock`] into a complete WASM module (bytes). The module exports:
/// * memory `"mem"` (the CpuState + register-file region — the harness fills it before the call),
/// * function `"run"` with signature `(i32) -> i32` (the block; arg = `state_base`, ret = exit code).
///
/// and imports `env.load` / `env.store` for memory access (the E4-T11 fast path replaces these).
/// PC-relative ops (`auipc`, `jal`, branch targets, link values, fault mepc) are emitted relative to
/// the runtime-supplied entry VIRTUAL PC (`abi.entry_pc`, written before each call), NOT the block's
/// physical `phys_start` key — so translated control flow is correct under paging (virtual PC !=
/// physical key, E4-T16) and when a physically-keyed block is reused from a new virtual mapping.
pub fn translate_block(block: &DecodedBlock, abi: &Abi) -> Result<Vec<u8>, TranslateError> {
    let mut m = ModuleBuilder::new();
    // Both memory models expose the same two memory-access imports (`(va,kind)->val` load,
    // `(va,val,width)->()` store) as function indices 0 and 1. In `SoftmmuImports` mode EVERY access
    // calls them; in `InlineTlb` mode only a fast-path MISS does. Keeping the signatures identical
    // means the runtime registers one pair of host functions for both.
    let load_ty = m.add_type(FuncType::new(
        &[ValType::I64, ValType::I32],
        &[ValType::I64],
    ));
    let store_ty = m.add_type(FuncType::new(
        &[ValType::I64, ValType::I64, ValType::I32],
        &[],
    ));
    let (load_name, store_name) = match abi.mem {
        MemModel::SoftmmuImports => ("load", "store"),
        MemModel::InlineTlb => ("softmmu_load", "softmmu_store"),
        MemModel::InlineTlbLoads => ("softmmu_load", "store"),
    };
    let _l = m.import_func("env", load_name, load_ty);
    let _s = m.import_func("env", store_name, store_ty);
    debug_assert_eq!(_l, LOAD_IMPORT);
    debug_assert_eq!(_s, STORE_IMPORT);
    // E4-T14: the A-extension imports (always declared; the runtime + harness register all three).
    let amo_ty = m.add_type(FuncType::new(
        &[ValType::I64, ValType::I64, ValType::I32, ValType::I32],
        &[ValType::I64],
    ));
    let lr_ty = m.add_type(FuncType::new(
        &[ValType::I64, ValType::I32],
        &[ValType::I64],
    ));
    let sc_ty = m.add_type(FuncType::new(
        &[ValType::I64, ValType::I64, ValType::I32],
        &[ValType::I64],
    ));
    let _a = m.import_func("env", "amo", amo_ty);
    let _lr = m.import_func("env", "lr", lr_ty);
    let _sc = m.import_func("env", "sc", sc_ty);
    debug_assert_eq!(_a, AMO_IMPORT);
    debug_assert_eq!(_lr, LR_IMPORT);
    debug_assert_eq!(_sc, SC_IMPORT);

    let run_ty = m.add_type(FuncType::new(&[ValType::I32], &[ValType::I32]));
    let run_idx = m.add_function(run_ty);
    match abi.mem {
        MemModel::SoftmmuImports => {
            // The module owns a private one-page linear memory (CpuState only); guest RAM is behind
            // the imports. Pinning max=1 makes a cached browser Uint8Array view stable: generated
            // SoftMMU code never grows this private state memory.
            m.add_memory(MemType {
                limits: Limits::bounded(1, 1),
            });
            m.export("mem", ExportKind::Memory, 0);
        }
        MemModel::InlineTlb | MemModel::InlineTlbLoads => {
            // The block accesses guest RAM directly, so it IMPORTS the one shared linear memory the
            // runtime lays out (CpuState + TLB arrays + guest RAM at the frozen offsets). Min 1 page;
            // the host supplies a memory large enough for `ram_base + ram_bytes`.
            m.import_memory(
                "env",
                "mem",
                MemType {
                    limits: Limits::new(1),
                },
            );
        }
    }
    m.export("run", ExportKind::Func, run_idx);

    let mut f = FuncBuilder::new(&[ValType::I32]); // param 0 = state_base
    emit_body(&mut f, block, abi, [None, None], run_ty)?;
    m.add_code(f.finish());
    Ok(m.finish())
}

/// The wasm function index of the first defined block function in a module: the five `env.*` imports
/// (`load`, `store`, `amo`, `lr`, `sc`) occupy indices 0..5, so the first `run` function is index 5.
/// In `InlineTlb` mode the shared memory is imported too, but that lives in a separate index space
/// and does not shift function indices.
const RUN_FUNC_BASE: u32 = 5;

/// E4-T19: translate a GROUP of blocks (a connected component of the observed-edge graph) into ONE
/// WASM module exporting one function per block (`run0`, `run1`, …) plus the shared memory `mem`.
/// This is the batching unit (`docs/jit-architecture.md` §7): K blocks share a single Module +
/// Instance, amortizing the per-Module/`WebAssembly.compile` fixed cost the browser is bound by.
///
/// `intra[i][e]` is `Some(local)` iff block `i`'s outgoing edge `e` (0 = taken / sole / fall-through,
/// 1 = a conditional branch's not-taken side) targets another block `local` IN THIS SAME group — in
/// which case that edge is lowered to a DIRECT `call run{local}` (opcode `0x10`, NOT `call_indirect`
/// `0x11`), gated by the `chain_enabled` header flag (§ABI). Cross-batch / dynamic edges are `None`
/// and return to the dispatch loop, where E4-T18's funcref-table link-slots take over.
///
/// Returns `Unsupported` if ANY block contains an out-of-scope op (the caller falls back to
/// installing the supported blocks singly), so a partly-untranslatable group never yields a
/// half-built module.
pub fn translate_batch(
    blocks: &[DecodedBlock],
    abi: &Abi,
    intra: &[[Option<usize>; 2]],
) -> Result<Vec<u8>, TranslateError> {
    debug_assert_eq!(blocks.len(), intra.len());
    // Pre-flight the WHOLE group first: one out-of-scope op fails the batch cleanly.
    for block in blocks {
        for op in &block.ops {
            if !supported(&op.instr) {
                return Err(TranslateError::Unsupported);
            }
        }
    }
    let mut m = ModuleBuilder::new();
    let load_ty = m.add_type(FuncType::new(
        &[ValType::I64, ValType::I32],
        &[ValType::I64],
    ));
    let store_ty = m.add_type(FuncType::new(
        &[ValType::I64, ValType::I64, ValType::I32],
        &[],
    ));
    let (load_name, store_name) = match abi.mem {
        MemModel::SoftmmuImports => ("load", "store"),
        MemModel::InlineTlb => ("softmmu_load", "softmmu_store"),
        MemModel::InlineTlbLoads => ("softmmu_load", "store"),
    };
    m.import_func("env", load_name, load_ty);
    m.import_func("env", store_name, store_ty);
    let amo_ty = m.add_type(FuncType::new(
        &[ValType::I64, ValType::I64, ValType::I32, ValType::I32],
        &[ValType::I64],
    ));
    let lr_ty = m.add_type(FuncType::new(
        &[ValType::I64, ValType::I32],
        &[ValType::I64],
    ));
    let sc_ty = m.add_type(FuncType::new(
        &[ValType::I64, ValType::I64, ValType::I32],
        &[ValType::I64],
    ));
    m.import_func("env", "amo", amo_ty);
    m.import_func("env", "lr", lr_ty);
    m.import_func("env", "sc", sc_ty);

    let run_ty = m.add_type(FuncType::new(&[ValType::I32], &[ValType::I32]));
    if abi.direct_chain && abi.dynamic_chain {
        let table = m.import_table(
            "env",
            "table",
            TableType {
                elem: RefType::FuncRef,
                limits: Limits::new(1),
            },
        );
        debug_assert_eq!(table, abi.chain_table);
    }
    // One defined function per block; capture their indices (they are RUN_FUNC_BASE + i).
    for i in 0..blocks.len() {
        let idx = m.add_function(run_ty);
        debug_assert_eq!(idx, RUN_FUNC_BASE + i as u32);
    }
    match abi.mem {
        MemModel::SoftmmuImports => {
            m.add_memory(MemType {
                // See `translate_block`: a fixed private memory is the browser view-lifetime
                // contract. InlineTlb's imported guest memory deliberately remains growable.
                limits: Limits::bounded(1, 1),
            });
            m.export("mem", ExportKind::Memory, 0);
        }
        MemModel::InlineTlb | MemModel::InlineTlbLoads => {
            m.import_memory(
                "env",
                "mem",
                MemType {
                    limits: Limits::new(1),
                },
            );
        }
    }
    // Export each block function under a stable per-index name the executor looks up.
    let mut name = alloc::string::String::new();
    for i in 0..blocks.len() {
        use core::fmt::Write;
        name.clear();
        let _ = write!(name, "run{i}");
        m.export(&name, ExportKind::Func, RUN_FUNC_BASE + i as u32);
    }
    // Emit each block body, resolving its intra-group successors to concrete wasm func indices.
    for (i, block) in blocks.iter().enumerate() {
        let resolved = [
            intra[i][0]
                .filter(|&l| !abi.direct_chain || !ends_with_fence_i(&blocks[l]))
                .map(|l| RUN_FUNC_BASE + l as u32),
            intra[i][1]
                .filter(|&l| !abi.direct_chain || !ends_with_fence_i(&blocks[l]))
                .map(|l| RUN_FUNC_BASE + l as u32),
        ];
        let mut f = FuncBuilder::new(&[ValType::I32]);
        emit_body(&mut f, block, abi, resolved, run_ty)?;
        m.add_code(f.finish());
    }
    Ok(m.finish())
}

fn ends_with_fence_i(block: &DecodedBlock) -> bool {
    matches!(block.ops.last().map(|op| op.instr), Some(Instr::FenceI))
}

/// Emit the function body for `block` into `f`. `intra[e]` is the wasm function index of the
/// same-module successor for edge `e` (0 = taken/sole/fall-through, 1 = branch not-taken), or `None`
/// when the edge leaves the batch / is dynamic (a `jalr` target).
fn emit_body(
    f: &mut FuncBuilder,
    block: &DecodedBlock,
    abi: &Abi,
    intra: [Option<u32>; 2],
    run_ty: u32,
) -> Result<(), TranslateError> {
    // Pre-flight: reject any out-of-scope op before emitting a single byte, so a partially-emitted
    // module can never escape (the caller gets a clean Unsupported and keeps interpreting).
    for op in &block.ops {
        if !supported(&op.instr) {
            return Err(TranslateError::Unsupported);
        }
    }

    let base_pc = block.phys_start;
    // E4-T16: load the runtime-supplied entry VIRTUAL PC into a local at the prologue. Every PC the
    // block writes is computed relative to it (see `push_pc_rel`), so the compiled block is correct
    // under paging (guest virtual PC != physical block key) AND when reused from a new virtual
    // mapping. Emitted first, so it is always initialized before any branch.
    let entry_local = f.local(ValType::I64);
    f.local_get(STATE_BASE);
    f.i64_load(ALIGN8, abi.entry_pc);
    f.local_set(entry_local);
    let chain_start = if abi.direct_chain {
        let local = f.local(ValType::I64);
        f.local_get(STATE_BASE);
        f.i64_load(ALIGN8, abi.chain_retired);
        f.local_set(local);
        emit_chain_prologue(f, abi, entry_local, block.ops.len() as u64);
        Some(local)
    } else {
        None
    };
    let mut regs = Regs::new(base_pc, entry_local, chain_start);
    let mut pc = base_pc;
    let n = block.ops.len();
    let mut terminated = false;

    for (i, op) in block.ops.iter().enumerate() {
        let len = op.len as u64;
        let pc_next = pc.wrapping_add(len);
        let last = i == n - 1;
        if is_terminator(&op.instr) {
            if !last {
                return Err(TranslateError::Malformed);
            }
            emit_terminator(
                f, &mut regs, abi, op.instr, pc, pc_next, intra, n as u64, run_ty,
            );
            terminated = true;
        } else {
            emit_alu(f, &mut regs, abi, op.instr, pc, pc_next, i as u64);
        }
        pc = pc_next;
    }

    // Fall-through block (128-op cap / page edge with no architectural terminator): resume at the
    // byte after the block (edge 0, the sole successor).
    if !terminated {
        let end_pc = base_pc.wrapping_add(block.total_len);
        emit_exit(
            f,
            &regs,
            abi,
            ExitCode::Fallthrough,
            PcSrc::Const(end_pc),
            intra[0],
            n as u64,
            run_ty,
        );
    }

    Ok(())
}

/// Where a block's resume PC comes from at an exit: a compile-time constant (virtual, PC-relative)
/// or an already-materialized WASM local (a `jalr` register target).
enum PcSrc {
    Const(u64),
    Local(u32),
}

/// E4-T19: the shared exit epilogue. Writes back dirty registers, sets `exit_pc` + `exit_reason`,
/// then EITHER returns the exit code (the deterministic native path, and every cross-batch / dynamic
/// edge) OR — for a statically-known intra-batch successor `intra` — emits a `chain_enabled`-gated
/// DIRECT `call` to that successor, tail-returning its exit code. The direct `call` (opcode `0x10`)
/// is always present in the emitted bytes; `chain_enabled == 0` (native) simply takes the plain
/// return arm, so behavior is byte-identical to E4-T18 per-block execution.
#[allow(clippy::too_many_arguments)]
fn emit_exit(
    f: &mut FuncBuilder,
    regs: &Regs,
    abi: &Abi,
    code: ExitCode,
    pc: PcSrc,
    intra: Option<u32>,
    retired: u64,
    run_ty: u32,
) {
    writeback(f, regs, abi);
    match pc {
        PcSrc::Const(v) => write_pc_const(f, regs, abi, v),
        PcSrc::Local(l) => write_pc_local(f, abi, l),
    }
    write_reason(f, abi, code);
    record_chain_retired(f, regs, abi, retired);
    match (intra, pc) {
        (None, PcSrc::Local(target)) if abi.direct_chain && abi.dynamic_chain => {
            emit_dynamic_exit(f, abi, target, code, run_ty);
        }
        (None, _) => {
            f.i32_const(code as i32);
            f.return_();
        }
        (Some(func_index), _) => {
            // if (chain_enabled && !chain_abort) { entry_pc := exit_pc; return call run{succ} }
            // else { return code }
            f.local_get(STATE_BASE);
            f.i32_load8_u(0, abi.chain_enabled);
            f.local_get(STATE_BASE);
            f.i32_load8_u(0, abi.chain_abort);
            f.i32_eqz();
            f.i32_and();
            f.if_(BlockType::Value(ValType::I32));
            // The successor reads its entry virtual PC from `entry_pc`; hand it this exit_pc.
            f.local_get(STATE_BASE);
            f.local_get(STATE_BASE);
            f.i64_load(ALIGN8, abi.exit_pc);
            f.i64_store(ALIGN8, abi.entry_pc);
            f.local_get(STATE_BASE);
            f.call(func_index);
            f.else_();
            f.i32_const(code as i32);
            f.end();
            f.return_();
        }
    }
}

/// Emit the guarded dynamic-target half of E4-T34. The target is a virtual `jalr` result. A
/// runtime-installed direct-mapped entry pairs that exact virtual PC with a live table index; a
/// miss, collision, disabled chain, or import-side effect takes the ordinary host exit. This keeps
/// the fast path speculative but makes it self-invalidating: the browser executor clears the entry
/// before freeing or remapping its compiled target.
fn emit_dynamic_exit(f: &mut FuncBuilder, abi: &Abi, target: u32, code: ExitCode, run_ty: u32) {
    let slot = f.local(ValType::I32);
    let table_index = f.local(ValType::I32);
    // slot = dynamic_map_base + (((target >> 2) ^ (target >> 12) ^ target) & mask) * 16.
    f.local_get(target);
    f.i64_const(2);
    f.i64_shr_u();
    f.local_get(target);
    f.i64_const(12);
    f.i64_shr_u();
    f.i64_xor();
    f.local_get(target);
    f.i64_xor();
    f.i64_const(i64::from(abi.dynamic_map_mask));
    f.i64_and();
    f.i64_const(16);
    f.i64_mul();
    f.i32_wrap_i64();
    f.i32_const(abi.dynamic_map_base as i32);
    f.i32_add();
    f.local_set(slot);

    // Guard: chain is enabled, no host-side barrier was raised, and both the key and one-based
    // table index match the publication. The table-index load is repeated below only on the taken
    // arm, keeping the miss path to two byte loads and three integer comparisons.
    f.local_get(STATE_BASE);
    f.i32_load8_u(0, abi.chain_enabled);
    f.local_get(STATE_BASE);
    f.i32_load8_u(0, abi.chain_abort);
    f.i32_eqz();
    f.i32_and();
    f.local_get(slot);
    f.i64_load(ALIGN8, 0);
    f.local_get(target);
    f.i64_eq();
    f.i32_and();
    f.local_get(slot);
    f.i64_load(ALIGN8, 8);
    f.i64_eqz();
    f.i32_eqz();
    f.i32_and();
    f.if_(BlockType::Value(ValType::I32));
    f.local_get(slot);
    f.i64_load(ALIGN8, 8);
    f.i64_const(1);
    f.i64_sub();
    f.i32_wrap_i64();
    f.local_set(table_index);
    // The caller already wrote `exit_pc = target`; make it the callee's virtual entry PC.
    f.local_get(STATE_BASE);
    f.local_get(STATE_BASE);
    f.i64_load(ALIGN8, abi.exit_pc);
    f.i64_store(ALIGN8, abi.entry_pc);
    f.local_get(STATE_BASE);
    f.local_get(table_index);
    f.call_indirect(run_ty, abi.chain_table);
    f.else_();
    f.i32_const(code as i32);
    f.end();
    f.return_();
}

/// Whether an instruction is inside E4-T09's RV64I base scope.
fn supported(instr: &Instr) -> bool {
    use Instr::*;
    matches!(
        instr,
        Lui { .. }
            | Auipc { .. }
            | Jal { .. }
            | Jalr { .. }
            | Beq { .. }
            | Bne { .. }
            | Blt { .. }
            | Bge { .. }
            | Bltu { .. }
            | Bgeu { .. }
            | Lb { .. }
            | Lh { .. }
            | Lw { .. }
            | Ld { .. }
            | Lbu { .. }
            | Lhu { .. }
            | Lwu { .. }
            | Sb { .. }
            | Sh { .. }
            | Sw { .. }
            | Sd { .. }
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
            // ── M extension (E4-T13) ──
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
            // ── A extension (E4-T14) ──
            | LrW { .. }
            | LrD { .. }
            | ScW { .. }
            | ScD { .. }
            | AmoW { .. }
            | AmoD { .. }
            | Ecall
            | Ebreak
            | Fence { .. }
            | FenceI
    )
}

// ── register materialization ────────────────────────────────────────────────

/// Push guest register `r`'s live value onto the WASM stack as an `i64`. `x0` folds to a constant 0;
/// any other register is lazily loaded from `state_base + 8*r` into its local on first use.
fn push_reg(f: &mut FuncBuilder, regs: &mut Regs, abi: &Abi, r: u8) {
    if r == 0 {
        f.i64_const(0);
        return;
    }
    let local = match regs.local[r as usize] {
        Some(l) => l,
        None => {
            let l = f.local(ValType::I64);
            f.local_get(STATE_BASE);
            f.i64_load(ALIGN8, abi.xreg_base + u32::from(r) * 8);
            f.local_set(l);
            regs.local[r as usize] = Some(l);
            l
        }
    };
    f.local_get(local);
}

/// Push guest register `r` truncated to its low 32 bits (`i32`) — the operand form for `*W` ops.
fn push_reg_i32(f: &mut FuncBuilder, regs: &mut Regs, abi: &Abi, r: u8) {
    push_reg(f, regs, abi, r);
    f.i32_wrap_i64();
}

/// Consume the `i64` on top of the stack as the new value of guest register `rd`. Writes to `x0`
/// are discarded (the value is dropped); otherwise the register's local is set and marked dirty.
fn set_reg(f: &mut FuncBuilder, regs: &mut Regs, rd: u8) {
    if rd == 0 {
        f.drop();
        return;
    }
    let local = match regs.local[rd as usize] {
        Some(l) => l,
        None => {
            // Written before ever read: allocate a local but emit no load (fully overwritten).
            let l = f.local(ValType::I64);
            regs.local[rd as usize] = Some(l);
            l
        }
    };
    f.local_set(local);
    regs.dirty[rd as usize] = true;
}

/// Write every dirty register back to the `x[]` array in linear memory. Called at every exit point,
/// before the block returns (the eager-writeback discipline). `x0` is never written back.
fn writeback(f: &mut FuncBuilder, regs: &Regs, abi: &Abi) {
    for r in 1..32u8 {
        if regs.dirty[r as usize] {
            let l = regs.local[r as usize].expect("dirty register must have a local");
            f.local_get(STATE_BASE);
            f.local_get(l);
            f.i64_store(ALIGN8, abi.xreg_base + u32::from(r) * 8);
        }
    }
}

fn write_pc_const(f: &mut FuncBuilder, regs: &Regs, abi: &Abi, pc: u64) {
    f.local_get(STATE_BASE);
    push_pc_rel(f, regs, pc); // E4-T16: virtual PC = entry_pc + (pc - base_pc)
    f.i64_store(ALIGN8, abi.exit_pc);
}

fn write_pc_local(f: &mut FuncBuilder, abi: &Abi, local: u32) {
    f.local_get(STATE_BASE);
    f.local_get(local);
    f.i64_store(ALIGN8, abi.exit_pc);
}

fn write_reason(f: &mut FuncBuilder, abi: &Abi, code: ExitCode) {
    f.local_get(STATE_BASE);
    f.i64_const(code as i64);
    f.i64_store(ALIGN8, abi.exit_reason);
}

fn write_info_const(f: &mut FuncBuilder, abi: &Abi, v: i64) {
    f.local_get(STATE_BASE);
    f.i64_const(v);
    f.i64_store(ALIGN8, abi.exit_info);
}

// ── ALU / load / store (non-terminator) lowering ────────────────────────────

fn emit_alu(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    instr: Instr,
    pc: u64,
    _pc_next: u64,
    retired_before: u64,
) {
    use Instr::*;
    match instr {
        // ── U-type ──
        Lui { rd, imm } => {
            f.i64_const(imm);
            set_reg(f, regs, rd);
        }
        Auipc { rd, imm } => {
            // E4-T16: auipc is PC-relative → virtual entry_pc + (pc + imm - base_pc).
            push_pc_rel(f, regs, pc.wrapping_add(imm as u64));
            set_reg(f, regs, rd);
        }
        // ── OP-IMM ──
        Addi { rd, rs1, imm } => {
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_add();
            set_reg(f, regs, rd);
        }
        Slti { rd, rs1, imm } => {
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_lt_s();
            f.i64_extend_i32_u();
            set_reg(f, regs, rd);
        }
        Sltiu { rd, rs1, imm } => {
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm); // `imm as u64` — same bit pattern; i64.lt_u is a 64-bit unsigned cmp
            f.i64_lt_u();
            f.i64_extend_i32_u();
            set_reg(f, regs, rd);
        }
        Xori { rd, rs1, imm } => {
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_xor();
            set_reg(f, regs, rd);
        }
        Ori { rd, rs1, imm } => {
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_or();
            set_reg(f, regs, rd);
        }
        Andi { rd, rs1, imm } => {
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_and();
            set_reg(f, regs, rd);
        }
        Slli { rd, rs1, shamt } => {
            push_reg(f, regs, abi, rs1);
            f.i64_const(i64::from(shamt));
            f.i64_shl();
            set_reg(f, regs, rd);
        }
        Srli { rd, rs1, shamt } => {
            push_reg(f, regs, abi, rs1);
            f.i64_const(i64::from(shamt));
            f.i64_shr_u();
            set_reg(f, regs, rd);
        }
        Srai { rd, rs1, shamt } => {
            push_reg(f, regs, abi, rs1);
            f.i64_const(i64::from(shamt));
            f.i64_shr_s();
            set_reg(f, regs, rd);
        }
        // ── OP-IMM-32 (*W) ──
        Addiw { rd, rs1, imm } => {
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_add();
            f.i32_wrap_i64();
            f.i64_extend_i32_s();
            set_reg(f, regs, rd);
        }
        Slliw { rd, rs1, shamt } => {
            push_reg_i32(f, regs, abi, rs1);
            f.i32_const(i32::from(shamt));
            f.i32_shl();
            f.i64_extend_i32_s();
            set_reg(f, regs, rd);
        }
        Srliw { rd, rs1, shamt } => {
            push_reg_i32(f, regs, abi, rs1);
            f.i32_const(i32::from(shamt));
            f.i32_shr_u();
            f.i64_extend_i32_s();
            set_reg(f, regs, rd);
        }
        Sraiw { rd, rs1, shamt } => {
            push_reg_i32(f, regs, abi, rs1);
            f.i32_const(i32::from(shamt));
            f.i32_shr_s();
            f.i64_extend_i32_s();
            set_reg(f, regs, rd);
        }
        // ── OP (R-type) ──
        Add { rd, rs1, rs2 } => {
            push_reg(f, regs, abi, rs1);
            push_reg(f, regs, abi, rs2);
            f.i64_add();
            set_reg(f, regs, rd);
        }
        Sub { rd, rs1, rs2 } => {
            push_reg(f, regs, abi, rs1);
            push_reg(f, regs, abi, rs2);
            f.i64_sub();
            set_reg(f, regs, rd);
        }
        // RV64 register shifts use rs2[5:0]; i64.shl/shr already mask the count mod 64.
        Sll { rd, rs1, rs2 } => {
            push_reg(f, regs, abi, rs1);
            push_reg(f, regs, abi, rs2);
            f.i64_shl();
            set_reg(f, regs, rd);
        }
        Srl { rd, rs1, rs2 } => {
            push_reg(f, regs, abi, rs1);
            push_reg(f, regs, abi, rs2);
            f.i64_shr_u();
            set_reg(f, regs, rd);
        }
        Sra { rd, rs1, rs2 } => {
            push_reg(f, regs, abi, rs1);
            push_reg(f, regs, abi, rs2);
            f.i64_shr_s();
            set_reg(f, regs, rd);
        }
        Slt { rd, rs1, rs2 } => {
            push_reg(f, regs, abi, rs1);
            push_reg(f, regs, abi, rs2);
            f.i64_lt_s();
            f.i64_extend_i32_u();
            set_reg(f, regs, rd);
        }
        Sltu { rd, rs1, rs2 } => {
            push_reg(f, regs, abi, rs1);
            push_reg(f, regs, abi, rs2);
            f.i64_lt_u();
            f.i64_extend_i32_u();
            set_reg(f, regs, rd);
        }
        Xor { rd, rs1, rs2 } => {
            push_reg(f, regs, abi, rs1);
            push_reg(f, regs, abi, rs2);
            f.i64_xor();
            set_reg(f, regs, rd);
        }
        Or { rd, rs1, rs2 } => {
            push_reg(f, regs, abi, rs1);
            push_reg(f, regs, abi, rs2);
            f.i64_or();
            set_reg(f, regs, rd);
        }
        And { rd, rs1, rs2 } => {
            push_reg(f, regs, abi, rs1);
            push_reg(f, regs, abi, rs2);
            f.i64_and();
            set_reg(f, regs, rd);
        }
        // ── OP-32 (*W), rs2[4:0] shift, 32-bit compute then sign-extend ──
        Addw { rd, rs1, rs2 } => {
            push_reg_i32(f, regs, abi, rs1);
            push_reg_i32(f, regs, abi, rs2);
            f.i32_add();
            f.i64_extend_i32_s();
            set_reg(f, regs, rd);
        }
        Subw { rd, rs1, rs2 } => {
            push_reg_i32(f, regs, abi, rs1);
            push_reg_i32(f, regs, abi, rs2);
            f.i32_sub();
            f.i64_extend_i32_s();
            set_reg(f, regs, rd);
        }
        Sllw { rd, rs1, rs2 } => {
            push_reg_i32(f, regs, abi, rs1);
            push_reg_i32(f, regs, abi, rs2); // i32.shl masks count mod 32 == rs2 & 0x1F
            f.i32_shl();
            f.i64_extend_i32_s();
            set_reg(f, regs, rd);
        }
        Srlw { rd, rs1, rs2 } => {
            push_reg_i32(f, regs, abi, rs1);
            push_reg_i32(f, regs, abi, rs2);
            f.i32_shr_u();
            f.i64_extend_i32_s();
            set_reg(f, regs, rd);
        }
        Sraw { rd, rs1, rs2 } => {
            if mutation_is(mut_hooks::SHIFT_MASK_WRONG) {
                // BUG (E4-T25 injected): 64-bit arithmetic shift of the full rs1 by rs2 mod 64,
                // instead of the *W form (i32 rs1, mask mod 32, then sign-extend).
                push_reg(f, regs, abi, rs1);
                push_reg(f, regs, abi, rs2);
                f.i64_shr_s();
                set_reg(f, regs, rd);
            } else {
                push_reg_i32(f, regs, abi, rs1);
                push_reg_i32(f, regs, abi, rs2);
                f.i32_shr_s();
                f.i64_extend_i32_s();
                set_reg(f, regs, rd);
            }
        }
        // ── loads (side-exit to env.load) ──
        Lb { rd, rs1, imm } => emit_load(
            f,
            regs,
            abi,
            rd,
            rs1,
            imm,
            load_kind::LB,
            pc,
            retired_before,
        ),
        Lh { rd, rs1, imm } => emit_load(
            f,
            regs,
            abi,
            rd,
            rs1,
            imm,
            load_kind::LH,
            pc,
            retired_before,
        ),
        Lw { rd, rs1, imm } => {
            // BUG (E4-T25 injected): lower LW with the zero-extending LWU kind (dropped sign-ext).
            let kind = if mutation_is(mut_hooks::LW_DROP_SEXT) {
                load_kind::LWU
            } else {
                load_kind::LW
            };
            emit_load(f, regs, abi, rd, rs1, imm, kind, pc, retired_before)
        }
        Ld { rd, rs1, imm } => emit_load(
            f,
            regs,
            abi,
            rd,
            rs1,
            imm,
            load_kind::LD,
            pc,
            retired_before,
        ),
        Lbu { rd, rs1, imm } => emit_load(
            f,
            regs,
            abi,
            rd,
            rs1,
            imm,
            load_kind::LBU,
            pc,
            retired_before,
        ),
        Lhu { rd, rs1, imm } => emit_load(
            f,
            regs,
            abi,
            rd,
            rs1,
            imm,
            load_kind::LHU,
            pc,
            retired_before,
        ),
        Lwu { rd, rs1, imm } => emit_load(
            f,
            regs,
            abi,
            rd,
            rs1,
            imm,
            load_kind::LWU,
            pc,
            retired_before,
        ),
        // ── stores (side-exit to env.store) ──
        Sb { rs1, rs2, imm } => emit_store(f, regs, abi, rs1, rs2, imm, 1, pc, retired_before),
        Sh { rs1, rs2, imm } => emit_store(f, regs, abi, rs1, rs2, imm, 2, pc, retired_before),
        Sw { rs1, rs2, imm } => emit_store(f, regs, abi, rs1, rs2, imm, 4, pc, retired_before),
        Sd { rs1, rs2, imm } => emit_store(f, regs, abi, rs1, rs2, imm, 8, pc, retired_before),
        // ── M extension: multiply (E4-T13) ──
        Mul { rd, rs1, rs2 } => {
            // Low 64 bits of the product; signedness is irrelevant for the low half.
            push_reg(f, regs, abi, rs1);
            push_reg(f, regs, abi, rs2);
            f.i64_mul();
            set_reg(f, regs, rd);
        }
        Mulh { rd, rs1, rs2 } => emit_mulh(f, regs, abi, rd, rs1, rs2, MulhKind::Ss),
        Mulhsu { rd, rs1, rs2 } => emit_mulh(f, regs, abi, rd, rs1, rs2, MulhKind::Su),
        Mulhu { rd, rs1, rs2 } => emit_mulh(f, regs, abi, rd, rs1, rs2, MulhKind::Uu),
        Mulw { rd, rs1, rs2 } => {
            // Low 32 bits of the product, then sign-extend to 64.
            push_reg_i32(f, regs, abi, rs1);
            push_reg_i32(f, regs, abi, rs2);
            f.i32_mul();
            f.i64_extend_i32_s();
            set_reg(f, regs, rd);
        }
        // ── M extension: divide / remainder (E4-T13) ──
        Div { rd, rs1, rs2 } => emit_div_rem64(f, regs, abi, rd, rs1, rs2, DivKind::Div),
        Divu { rd, rs1, rs2 } => emit_div_rem64(f, regs, abi, rd, rs1, rs2, DivKind::Divu),
        Rem { rd, rs1, rs2 } => emit_div_rem64(f, regs, abi, rd, rs1, rs2, DivKind::Rem),
        Remu { rd, rs1, rs2 } => emit_div_rem64(f, regs, abi, rd, rs1, rs2, DivKind::Remu),
        Divw { rd, rs1, rs2 } => emit_div_rem32(f, regs, abi, rd, rs1, rs2, DivKind::Div),
        Divuw { rd, rs1, rs2 } => emit_div_rem32(f, regs, abi, rd, rs1, rs2, DivKind::Divu),
        Remw { rd, rs1, rs2 } => emit_div_rem32(f, regs, abi, rd, rs1, rs2, DivKind::Rem),
        Remuw { rd, rs1, rs2 } => emit_div_rem32(f, regs, abi, rd, rs1, rs2, DivKind::Remu),
        // ── A extension (E4-T14): route to the runtime imports (interpreter's own atomic code) ──
        LrW { rd, rs1, .. } => emit_lr(f, regs, abi, rd, rs1, 4, pc, retired_before),
        LrD { rd, rs1, .. } => emit_lr(f, regs, abi, rd, rs1, 8, pc, retired_before),
        ScW { rd, rs1, rs2, .. } => emit_sc(f, regs, abi, rd, rs1, rs2, 4, pc, retired_before),
        ScD { rd, rs1, rs2, .. } => emit_sc(f, regs, abi, rd, rs1, rs2, 8, pc, retired_before),
        AmoW {
            op, rd, rs1, rs2, ..
        } => emit_amo(
            f,
            regs,
            abi,
            rd,
            rs1,
            rs2,
            amo_op_code(op),
            4,
            pc,
            retired_before,
        ),
        AmoD {
            op, rd, rs1, rs2, ..
        } => emit_amo(
            f,
            regs,
            abi,
            rd,
            rs1,
            rs2,
            amo_op_code(op),
            8,
            pc,
            retired_before,
        ),
        // FENCE retires as a no-op mid-block only if it were non-terminating; but FENCE/FENCE.I are
        // terminators handled elsewhere. Anything else was rejected by `supported`.
        _ => unreachable!("emit_alu called on a non-RV64I / terminator op"),
    }
}

/// `rd = extend(mem[rs1 + imm])`. Registers are written back AND the faulting-instruction PC is
/// materialized into `exit_pc` before any access (the "materialize before a potentially-trapping
/// op" rule, `docs/jit-architecture.md` §4). So if the access faults, the runtime sees the precise
/// register file (as of the prior instruction) plus `exit_pc = pc` (→ `mepc`), and delivers the
/// trap without re-interpreting the block from entry (which would replay any earlier side-effect).
/// Dispatches on the memory model: always-call-out (E4-T09) or the inline-TLB fast path (E4-T11).
#[allow(clippy::too_many_arguments)]
fn emit_load(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rd: u8,
    rs1: u8,
    imm: i64,
    kind: i32,
    pc: u64,
    retired_before: u64,
) {
    match abi.mem {
        MemModel::SoftmmuImports => {
            writeback(f, regs, abi);
            write_pc_const(f, regs, abi, pc);
            record_chain_retired(f, regs, abi, retired_before);
            // effective address = rs1 + imm (wrapping u64)
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_add();
            f.i32_const(kind);
            f.call(LOAD_IMPORT);
            set_reg(f, regs, rd);
        }
        MemModel::InlineTlb | MemModel::InlineTlbLoads => {
            emit_load_tlb(f, regs, abi, rd, rs1, imm, kind, pc, retired_before)
        }
    }
}

/// `mem[rs1 + imm] = rs2` (low `width` bytes). Same precise-state discipline as [`emit_load`]:
/// writeback + `exit_pc = pc` before the access, so a fault side-exits precisely and any earlier
/// committing store (e.g. an MMIO write) is never re-executed.
#[allow(clippy::too_many_arguments)]
fn emit_store(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rs1: u8,
    rs2: u8,
    imm: i64,
    width: i32,
    pc: u64,
    retired_before: u64,
) {
    match abi.mem {
        MemModel::SoftmmuImports => {
            writeback(f, regs, abi);
            write_pc_const(f, regs, abi, pc);
            record_chain_retired(f, regs, abi, retired_before);
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_add();
            push_reg(f, regs, abi, rs2);
            f.i32_const(width);
            f.call(STORE_IMPORT);
        }
        MemModel::InlineTlb => {
            emit_store_tlb(f, regs, abi, rs1, rs2, imm, width, pc, retired_before)
        }
        MemModel::InlineTlbLoads => {
            writeback(f, regs, abi);
            write_pc_const(f, regs, abi, pc);
            record_chain_retired(f, regs, abi, retired_before);
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_add();
            push_reg(f, regs, abi, rs2);
            f.i32_const(width);
            f.call(STORE_IMPORT);
        }
    }
}

// ── A extension (E4-T14): LR / SC / AMO via runtime imports ─────────────────
//
// All three route to a host import that calls the interpreter's OWN atomic + reservation code, so
// the memory effect, the returned value, AND the shared `resv` state are byte-identical to the
// interpreter — which is what makes an interpreter/JIT tier switch mid-LR/SC coherent. The address
// is `rs1` (the A extension has no offset immediate). Like loads/stores, each op can trap
// (misalignment / access fault), so it obeys the precise-state discipline: flush the dirty set and
// materialize `exit_pc = pc` BEFORE the call, so a fault side-exits precisely (no re-interpretation
// of the block from entry, which would replay any earlier committing store).

/// `rd = sext(LR.width(mem[rs1]))`, setting the reservation. → `env.lr(addr, width) -> i64`.
#[allow(clippy::too_many_arguments)]
fn emit_lr(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rd: u8,
    rs1: u8,
    width: i32,
    pc: u64,
    retired_before: u64,
) {
    writeback(f, regs, abi);
    write_pc_const(f, regs, abi, pc);
    record_chain_retired(f, regs, abi, retired_before);
    push_reg(f, regs, abi, rs1);
    f.i32_const(width);
    f.call(LR_IMPORT);
    set_reg(f, regs, rd);
}

/// `rd = SC.width(mem[rs1], rs2)` (0 success / 1 fail). → `env.sc(addr, val, width) -> i64`.
#[allow(clippy::too_many_arguments)]
fn emit_sc(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rd: u8,
    rs1: u8,
    rs2: u8,
    width: i32,
    pc: u64,
    retired_before: u64,
) {
    writeback(f, regs, abi);
    write_pc_const(f, regs, abi, pc);
    record_chain_retired(f, regs, abi, retired_before);
    push_reg(f, regs, abi, rs1);
    push_reg(f, regs, abi, rs2);
    f.i32_const(width);
    f.call(SC_IMPORT);
    set_reg(f, regs, rd);
}

/// `rd = sext(old); mem[rs1] = amo_op(old, rs2)`. → `env.amo(addr, val, op, width) -> i64`.
#[allow(clippy::too_many_arguments)]
fn emit_amo(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rd: u8,
    rs1: u8,
    rs2: u8,
    op: i32,
    width: i32,
    pc: u64,
    retired_before: u64,
) {
    writeback(f, regs, abi);
    write_pc_const(f, regs, abi, pc);
    record_chain_retired(f, regs, abi, retired_before);
    push_reg(f, regs, abi, rs1);
    push_reg(f, regs, abi, rs2);
    f.i32_const(op);
    f.i32_const(width);
    f.call(AMO_IMPORT);
    set_reg(f, regs, rd);
}

// ── E4-T11 inline direct-mapped TLB fast path ───────────────────────────────
//
// The load-`kind` codes double as the width (in bytes) + signedness selector. The width guards the
// natural-alignment test (an aligned access to a 4 KiB-divisible width can never straddle a page, so
// the single alignment check subsumes the straddle check); the raw wasm opcode does the extension.
fn load_kind_width(kind: i32) -> i64 {
    match kind {
        load_kind::LB | load_kind::LBU => 1,
        load_kind::LH | load_kind::LHU => 2,
        load_kind::LW | load_kind::LWU => 4,
        load_kind::LD => 8,
        _ => unreachable!("bad load kind"),
    }
}

/// Emit `eaddr = base + ((va >> 12) & (entries-1)) * SLOT` (an i32 linear address of the TLB slot for
/// `va`'s page) into local `eaddr`. `va_local` holds the effective address.
fn emit_slot_addr(f: &mut FuncBuilder, tlb: &TlbLayout, va_local: u32, base: u32, eaddr: u32) {
    f.local_get(va_local);
    f.i64_const(12);
    f.i64_shr_u();
    f.i64_const(i64::from(tlb.entries - 1));
    f.i64_and();
    f.i64_const(i64::from(TlbLayout::SLOT));
    f.i64_mul();
    f.i32_wrap_i64();
    f.i32_const(base as i32);
    f.i32_add();
    f.local_set(eaddr);
}

/// Push the i32 boolean `aligned(va,width) && slot.tag == want_tag(va)` — the fast-path-taken
/// predicate. `eaddr` must already hold the slot address.
fn emit_hit_predicate(f: &mut FuncBuilder, va_local: u32, eaddr: u32, width: i64) {
    // aligned: (va & (width-1)) == 0. Width 1 is always aligned.
    if width == 1 {
        f.i32_const(1);
    } else {
        f.local_get(va_local);
        f.i64_const(width - 1);
        f.i64_and();
        f.i64_eqz();
    }
    // tag match: slot.tag == (va & ~0xFFF) | VALID
    f.local_get(eaddr);
    f.i64_load(0, TlbLayout::TAG_OFF);
    f.local_get(va_local);
    f.i64_const(!0xFFF_i64);
    f.i64_and();
    f.i64_const(TlbLayout::VALID);
    f.i64_or();
    f.i64_eq();
    f.i32_and();
}

/// Push the i32 host linear address `wrap((va + slot.addend))` for a fast-path hit. `eaddr` holds the
/// slot address; the addend is chosen so this lands exactly on the guest byte in the RAM window.
fn emit_hit_host_addr(f: &mut FuncBuilder, va_local: u32, eaddr: u32) {
    f.local_get(va_local);
    f.local_get(eaddr);
    f.i64_load(0, TlbLayout::ADDEND_OFF);
    f.i64_add();
    f.i32_wrap_i64();
}

#[allow(clippy::too_many_arguments)]
fn emit_load_tlb(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rd: u8,
    rs1: u8,
    imm: i64,
    kind: i32,
    pc: u64,
    retired_before: u64,
) {
    let tlb = &abi.tlb;
    let width = load_kind_width(kind);
    let va = f.local(ValType::I64);
    let eaddr = f.local(ValType::I32);
    // va = rs1 + imm
    push_reg(f, regs, abi, rs1);
    f.i64_const(imm);
    f.i64_add();
    f.local_set(va);
    emit_slot_addr(f, tlb, va, tlb.read_base, eaddr);
    emit_hit_predicate(f, va, eaddr, width);
    f.if_(BlockType::Value(ValType::I64));
    // HIT: raw width/sign-extending load at the host address.
    emit_hit_host_addr(f, va, eaddr);
    match kind {
        load_kind::LB => f.i64_load8_s(0, 0),
        load_kind::LBU => f.i64_load8_u(0, 0),
        load_kind::LH => f.i64_load16_s(0, 0),
        load_kind::LHU => f.i64_load16_u(0, 0),
        load_kind::LW => f.i64_load32_s(0, 0),
        load_kind::LWU => f.i64_load32_u(0, 0),
        load_kind::LD => f.i64_load(0, 0),
        _ => unreachable!("bad load kind"),
    }
    f.else_();
    // MISS: the softmmu does the whole access (translate + PMP + RAM/MMIO) and fills the TLB.
    writeback(f, regs, abi);
    write_pc_const(f, regs, abi, pc);
    record_chain_retired(f, regs, abi, retired_before);
    f.local_get(va);
    f.i32_const(kind);
    f.call(LOAD_IMPORT);
    f.end();
    set_reg(f, regs, rd);
}

#[allow(clippy::too_many_arguments)]
fn emit_store_tlb(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rs1: u8,
    rs2: u8,
    imm: i64,
    width: i32,
    pc: u64,
    retired_before: u64,
) {
    let tlb = &abi.tlb;
    let w = i64::from(width);
    let va = f.local(ValType::I64);
    let eaddr = f.local(ValType::I32);
    // Materialize BOTH source registers into locals in the COMMON path, before the branch. If `rs2`
    // were loaded lazily inside one arm, the other arm would see an uninitialized (zero) local — a
    // silent wrong-value store. (This is the store analogue of always pre-loading the address base.)
    push_reg(f, regs, abi, rs1);
    f.i64_const(imm);
    f.i64_add();
    f.local_set(va);
    let sval = f.local(ValType::I64);
    push_reg(f, regs, abi, rs2);
    f.local_set(sval);
    // Store uses the WRITE array — a read-only page is never filled here, so its store always misses
    // to the softmmu, which faults exactly as the interpreter.
    emit_slot_addr(f, tlb, va, tlb.write_base, eaddr);
    emit_hit_predicate(f, va, eaddr, w);
    f.if_(BlockType::Empty);
    if abi.store_log_capacity == 0 {
        // HIT: raw store [host_addr, value]. The standalone translator ABI deliberately keeps
        // this historical mode available for the focused inline-TLB differential harness.
        emit_hit_host_addr(f, va, eaddr);
        f.local_get(sval);
        match width {
            1 => f.i64_store8(0, 0),
            2 => f.i64_store16(0, 0),
            4 => f.i64_store32(0, 0),
            8 => f.i64_store(0, 0),
            _ => unreachable!("bad store width"),
        }
    } else {
        // The integrated browser ABI cannot let a raw store disappear from the host's reservation
        // and code-write accounting. Keep a bounded commit record beside the chain header; when it
        // fills, use the exact imported path for that store instead of risking an unlogged effect.
        let count = f.local(ValType::I64);
        let host_addr = f.local(ValType::I32);
        let record = f.local(ValType::I32);
        f.local_get(STATE_BASE);
        f.i64_load(ALIGN8, abi.store_log_count);
        f.local_tee(count);
        f.i64_const(i64::from(abi.store_log_capacity));
        f.i64_lt_u();
        f.if_(BlockType::Empty);
        emit_hit_host_addr(f, va, eaddr);
        f.local_set(host_addr);
        f.local_get(host_addr);
        f.local_get(sval);
        match width {
            1 => f.i64_store8(0, 0),
            2 => f.i64_store16(0, 0),
            4 => f.i64_store32(0, 0),
            8 => f.i64_store(0, 0),
            _ => unreachable!("bad store width"),
        }

        // record = state_base + store_log_base + count * entry_bytes.
        f.local_get(STATE_BASE);
        f.i32_const(abi.store_log_base as i32);
        f.i32_add();
        f.local_get(count);
        f.i64_const(i64::from(wasm_vm_core::jit::abi::CHAIN_STORE_ENTRY_BYTES));
        f.i64_mul();
        f.i32_wrap_i64();
        f.i32_add();
        f.local_set(record);
        f.local_get(record);
        f.local_get(va);
        f.i64_store(ALIGN8, 0);
        f.local_get(record);
        f.local_get(host_addr);
        f.i64_extend_i32_u();
        f.i64_const(i64::from(abi.tlb.ram_base));
        f.i64_sub();
        f.i64_const(abi.tlb.dram_base as i64);
        f.i64_add();
        f.i64_store(ALIGN8, 8);
        f.local_get(record);
        f.i64_const(i64::from(width));
        f.i64_store(ALIGN8, 16);

        // Publish the record only after the raw store has committed. The host sees the count after
        // the module returns and therefore never processes a speculative/faulting store.
        f.local_get(STATE_BASE);
        f.local_get(count);
        f.i64_const(1);
        f.i64_add();
        f.i64_store(ALIGN8, abi.store_log_count);
        if abi.direct_chain {
            f.local_get(STATE_BASE);
            f.i32_const(1);
            f.i32_store8(0, abi.chain_abort);
        }
        f.else_();
        // A full log takes the exact slow path, which also applies reservation invalidation and
        // code-write logging before the current block returns.
        emit_store_import(f, regs, abi, va, sval, width, pc, retired_before);
        f.end();
    }
    f.else_();
    // MISS: softmmu performs the access + fills the TLB.
    emit_store_import(f, regs, abi, va, sval, width, pc, retired_before);
    f.end();
}

/// Emit the exact imported store slow path, including the precise-state preamble. Inline-TLB hits
/// are non-trapping raw RAM operations and skip this writeback; only a miss or a full commit log
/// needs to expose the current locals before crossing into Rust.
#[allow(clippy::too_many_arguments)]
fn emit_store_import(
    f: &mut FuncBuilder,
    regs: &Regs,
    abi: &Abi,
    va: u32,
    sval: u32,
    width: i32,
    pc: u64,
    retired_before: u64,
) {
    writeback(f, regs, abi);
    write_pc_const(f, regs, abi, pc);
    record_chain_retired(f, regs, abi, retired_before);
    f.local_get(va);
    f.local_get(sval);
    f.i32_const(width);
    f.call(STORE_IMPORT);
}

// ── M extension: multiply-high and guarded divide/remainder (E4-T13) ─────────
//
// The two semantic mines this ticket exists to defuse:
//
// 1. **Divide by zero and INT_MIN/−1 overflow.** wasm `i64.div_s/div_u/rem_s/rem_u` (and the i32
//    forms) *trap* on a zero divisor and on the signed `INT_MIN / -1` overflow, whereas RISC-V
//    *defines* results (`div/0 → -1`, `divu/0 → 2^XLEN-1`, `rem/0 → dividend`, overflow →
//    `div=INT_MIN, rem=0`). A trap here would escape the generated function as a wasm trap — never
//    allowed. So the divisor fed to the wasm op is *sanitized* to `1` in exactly the cases that would
//    trap (making the wasm op total and harmless), and a `select` afterwards substitutes the
//    architectural result. With denom forced to 1: `Div` overflow yields `a/1 == INT_MIN` (already
//    correct, no extra select needed) and `Rem` overflow yields `a%1 == 0` (correct); only the
//    zero-divisor case needs the final `select`.
//
// 2. **MULH / MULHSU / MULHU** have no single wasm opcode. We compose the high 64 bits of the 64×64
//    product from four 32-bit partial products (schoolbook long multiplication, all unsigned), giving
//    the *unsigned* high word; the signed variants then apply the standard two's-complement
//    corrections `high_signed = high_unsigned - (a<0 ? b : 0) - (b<0 ? a : 0)` (MULH) or just
//    `- (a<0 ? b : 0)` (MULHSU, whose rs1 is signed and rs2 unsigned).

#[derive(Clone, Copy)]
enum MulhKind {
    /// MULH — both operands signed.
    Ss,
    /// MULHSU — rs1 signed, rs2 unsigned (the asymmetric one).
    Su,
    /// MULHU — both operands unsigned.
    Uu,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DivKind {
    Div,
    Divu,
    Rem,
    Remu,
}

/// Leave the *unsigned* high 64 bits of `a_local * b_local` (both i64) on the wasm stack, composed
/// from four 32-bit partial products so no wider-than-64 arithmetic is needed:
/// `hi = ah*bh + (al*bh>>32) + (ah*bl>>32) + ((al*bl>>32 + (al*bh&M) + (ah*bl&M)) >> 32)`.
fn emit_mul_high_unsigned(f: &mut FuncBuilder, a_local: u32, b_local: u32) {
    const M: i64 = 0xFFFF_FFFF;
    let al = f.local(ValType::I64);
    let ah = f.local(ValType::I64);
    let bl = f.local(ValType::I64);
    let bh = f.local(ValType::I64);
    let lh = f.local(ValType::I64); // al*bh
    let hl = f.local(ValType::I64); // ah*bl
    // Split both operands into 32-bit halves.
    f.local_get(a_local);
    f.i64_const(M);
    f.i64_and();
    f.local_set(al);
    f.local_get(a_local);
    f.i64_const(32);
    f.i64_shr_u();
    f.local_set(ah);
    f.local_get(b_local);
    f.i64_const(M);
    f.i64_and();
    f.local_set(bl);
    f.local_get(b_local);
    f.i64_const(32);
    f.i64_shr_u();
    f.local_set(bh);
    // lh = al*bh, hl = ah*bl (each < 2^64, no overflow).
    f.local_get(al);
    f.local_get(bh);
    f.i64_mul();
    f.local_set(lh);
    f.local_get(ah);
    f.local_get(bl);
    f.i64_mul();
    f.local_set(hl);
    // cross = (al*bl >> 32) + (lh & M) + (hl & M)
    f.local_get(al);
    f.local_get(bl);
    f.i64_mul();
    f.i64_const(32);
    f.i64_shr_u();
    f.local_get(lh);
    f.i64_const(M);
    f.i64_and();
    f.i64_add();
    f.local_get(hl);
    f.i64_const(M);
    f.i64_and();
    f.i64_add();
    // >> 32 → carry into the high word
    f.i64_const(32);
    f.i64_shr_u();
    // + ah*bh
    f.local_get(ah);
    f.local_get(bh);
    f.i64_mul();
    f.i64_add();
    // + lh>>32
    f.local_get(lh);
    f.i64_const(32);
    f.i64_shr_u();
    f.i64_add();
    // + hl>>32
    f.local_get(hl);
    f.i64_const(32);
    f.i64_shr_u();
    f.i64_add();
}

fn emit_mulh(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rd: u8,
    rs1: u8,
    rs2: u8,
    kind: MulhKind,
) {
    let a = f.local(ValType::I64);
    let b = f.local(ValType::I64);
    push_reg(f, regs, abi, rs1);
    f.local_set(a);
    push_reg(f, regs, abi, rs2);
    f.local_set(b);
    emit_mul_high_unsigned(f, a, b);
    // Signed corrections (two's-complement identity). rs1 is `a`, rs2 is `b`.
    match kind {
        MulhKind::Uu => {}
        MulhKind::Su => {
            // high_signed(a signed × b unsigned) = high_unsigned - (a<0 ? b : 0)
            f.local_get(b);
            f.i64_const(0);
            f.local_get(a);
            f.i64_const(0);
            f.i64_lt_s(); // a < 0
            f.select();
            f.i64_sub();
        }
        MulhKind::Ss => {
            // high_signed = high_unsigned - (b<0 ? a : 0) - (a<0 ? b : 0)
            f.local_get(a);
            f.i64_const(0);
            f.local_get(b);
            f.i64_const(0);
            f.i64_lt_s(); // b < 0
            f.select();
            f.i64_sub();
            f.local_get(b);
            f.i64_const(0);
            f.local_get(a);
            f.i64_const(0);
            f.i64_lt_s(); // a < 0
            f.select();
            f.i64_sub();
        }
    }
    set_reg(f, regs, rd);
}

/// Guarded RV64 (XLEN) divide/remainder — see the section header for why the divisor is sanitized.
fn emit_div_rem64(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rd: u8,
    rs1: u8,
    rs2: u8,
    kind: DivKind,
) {
    let a = f.local(ValType::I64);
    let b = f.local(ValType::I64);
    let denom = f.local(ValType::I64);
    let q = f.local(ValType::I64);
    push_reg(f, regs, abi, rs1);
    f.local_set(a);
    push_reg(f, regs, abi, rs2);
    f.local_set(b);
    // denom = sanitize(b): force to 1 in the cases the wasm op would trap on.
    f.i64_const(1); // value chosen when the guard fires
    f.local_get(b); // value otherwise
    match kind {
        DivKind::Div | DivKind::Rem => {
            // guard = (b == 0) | (a == INT64_MIN & b == -1)
            f.local_get(b);
            f.i64_eqz();
            f.local_get(a);
            f.i64_const(i64::MIN);
            f.i64_eq();
            f.local_get(b);
            f.i64_const(-1);
            f.i64_eq();
            f.i32_and();
            f.i32_or();
        }
        DivKind::Divu | DivKind::Remu => {
            // guard = (b == 0) — unsigned ops have no overflow case.
            f.local_get(b);
            f.i64_eqz();
        }
    }
    f.select();
    f.local_set(denom);
    // Raw (now trap-free) wasm op.
    f.local_get(a);
    f.local_get(denom);
    match kind {
        DivKind::Div => f.i64_div_s(),
        DivKind::Divu => f.i64_div_u(),
        DivKind::Rem => f.i64_rem_s(),
        DivKind::Remu => f.i64_rem_u(),
    }
    f.local_set(q);
    if mutation_is(mut_hooks::DIV_ZERO_WRONG) {
        // BUG (E4-T25 injected): drop the architectural divide-by-zero override, so x/0 yields the
        // sanitized x/1 == x instead of the RISC-V-defined -1 (div) / dividend (rem).
        f.local_get(q);
    } else {
        // Architectural override for the zero-divisor case. (Overflow is already correct: with
        // denom==1, Div gives a/1==INT_MIN and Rem gives a%1==0.)
        match kind {
            DivKind::Div | DivKind::Divu => f.i64_const(-1), // div/0 → all-ones (−1 == u64::MAX)
            DivKind::Rem | DivKind::Remu => f.local_get(a),  // rem/0 → dividend
        }
        f.local_get(q);
        f.local_get(b);
        f.i64_eqz(); // cond: divisor was zero
        f.select();
    }
    set_reg(f, regs, rd);
}

/// Guarded 32-bit (`*W`) divide/remainder: compute on the low 32 bits, then sign-extend to 64.
fn emit_div_rem32(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rd: u8,
    rs1: u8,
    rs2: u8,
    kind: DivKind,
) {
    let a = f.local(ValType::I32);
    let b = f.local(ValType::I32);
    let denom = f.local(ValType::I32);
    let q = f.local(ValType::I32);
    push_reg_i32(f, regs, abi, rs1);
    f.local_set(a);
    push_reg_i32(f, regs, abi, rs2);
    f.local_set(b);
    f.i32_const(1);
    f.local_get(b);
    match kind {
        DivKind::Div | DivKind::Rem => {
            // guard = (b == 0) | (a == INT32_MIN & b == -1)
            f.local_get(b);
            f.i32_eqz();
            f.local_get(a);
            f.i32_const(i32::MIN);
            f.i32_eq();
            f.local_get(b);
            f.i32_const(-1);
            f.i32_eq();
            f.i32_and();
            f.i32_or();
        }
        DivKind::Divu | DivKind::Remu => {
            f.local_get(b);
            f.i32_eqz();
        }
    }
    f.select();
    f.local_set(denom);
    f.local_get(a);
    f.local_get(denom);
    match kind {
        DivKind::Div => f.i32_div_s(),
        DivKind::Divu => f.i32_div_u(),
        DivKind::Rem => f.i32_rem_s(),
        DivKind::Remu => f.i32_rem_u(),
    }
    f.local_set(q);
    match kind {
        DivKind::Div | DivKind::Divu => f.i32_const(-1),
        DivKind::Rem | DivKind::Remu => f.local_get(a),
    }
    f.local_get(q);
    f.local_get(b);
    f.i32_eqz();
    f.select();
    // *W results are always sign-extended from bit 31 (DIVUW's 0xFFFF_FFFF reads back as all-ones).
    f.i64_extend_i32_s();
    set_reg(f, regs, rd);
}

// ── terminator lowering ─────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn emit_terminator(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    instr: Instr,
    pc: u64,
    pc_next: u64,
    intra: [Option<u32>; 2],
    retired: u64,
    run_ty: u32,
) {
    use Instr::*;
    match instr {
        Beq { rs1, rs2, imm } => emit_branch(
            f,
            regs,
            abi,
            rs1,
            rs2,
            imm,
            pc,
            pc_next,
            Cmp::Eq,
            intra,
            retired,
            run_ty,
        ),
        Bne { rs1, rs2, imm } => emit_branch(
            f,
            regs,
            abi,
            rs1,
            rs2,
            imm,
            pc,
            pc_next,
            Cmp::Ne,
            intra,
            retired,
            run_ty,
        ),
        Blt { rs1, rs2, imm } => emit_branch(
            f,
            regs,
            abi,
            rs1,
            rs2,
            imm,
            pc,
            pc_next,
            Cmp::Lt,
            intra,
            retired,
            run_ty,
        ),
        Bge { rs1, rs2, imm } => emit_branch(
            f,
            regs,
            abi,
            rs1,
            rs2,
            imm,
            pc,
            pc_next,
            Cmp::Ge,
            intra,
            retired,
            run_ty,
        ),
        Bltu { rs1, rs2, imm } => emit_branch(
            f,
            regs,
            abi,
            rs1,
            rs2,
            imm,
            pc,
            pc_next,
            Cmp::Ltu,
            intra,
            retired,
            run_ty,
        ),
        Bgeu { rs1, rs2, imm } => emit_branch(
            f,
            regs,
            abi,
            rs1,
            rs2,
            imm,
            pc,
            pc_next,
            Cmp::Geu,
            intra,
            retired,
            run_ty,
        ),
        Jal { rd, imm } => {
            // link = pc + insn_len; target = pc + imm (both PC-relative → virtual, E4-T16)
            if rd != 0 {
                push_pc_rel(f, regs, pc_next);
                set_reg(f, regs, rd);
            }
            emit_exit(
                f,
                regs,
                abi,
                ExitCode::BranchTaken,
                PcSrc::Const(pc.wrapping_add(imm as u64)),
                intra[0],
                retired,
                run_ty,
            );
        }
        Jalr { rd, rs1, imm } => {
            // target = (rs1 + imm) & !1, computed from the OLD rs1 before the link overwrites rd.
            let scratch = f.local(ValType::I64);
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_add();
            if !mutation_is(mut_hooks::JALR_NO_CLEAR_BIT0) {
                f.i64_const(-2); // 0xFFFF_FFFF_FFFF_FFFE == !1 — clears bit 0
                f.i64_and();
            }
            // BUG (E4-T25 injected) when JALR_NO_CLEAR_BIT0: the `& !1` above is omitted, leaving the
            // low bit set on an odd computed target.
            f.local_set(scratch);
            if rd != 0 {
                // link = pc + insn_len is PC-relative → virtual (E4-T16). The jalr TARGET in
                // `scratch` came from a register (already a virtual address), so it is unchanged.
                push_pc_rel(f, regs, pc_next);
                set_reg(f, regs, rd);
            }
            // A `jalr` target is a runtime register value — never a static intra-batch edge.
            emit_exit(
                f,
                regs,
                abi,
                ExitCode::BranchTaken,
                PcSrc::Local(scratch),
                None,
                retired,
                run_ty,
            );
        }
        Ecall => emit_trap(f, regs, abi, pc, 11, retired - 1),
        Ebreak => emit_trap(f, regs, abi, pc, 3, retired - 1),
        // FENCE / FENCE.I retire as a no-op in the single-thread model; resume at the next PC (edge 0).
        Fence { .. } | FenceI => {
            emit_exit(
                f,
                regs,
                abi,
                ExitCode::Fallthrough,
                PcSrc::Const(pc_next),
                if abi.direct_chain { None } else { intra[0] },
                retired,
                run_ty,
            );
        }
        _ => unreachable!("emit_terminator on a non-terminator / out-of-scope op"),
    }
}

#[derive(Clone, Copy)]
enum Cmp {
    Eq,
    Ne,
    Lt,
    Ge,
    Ltu,
    Geu,
}

#[allow(clippy::too_many_arguments)]
fn emit_branch(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rs1: u8,
    rs2: u8,
    imm: i64,
    pc: u64,
    pc_next: u64,
    cmp: Cmp,
    intra: [Option<u32>; 2],
    retired: u64,
    run_ty: u32,
) {
    push_reg(f, regs, abi, rs1);
    push_reg(f, regs, abi, rs2);
    match cmp {
        Cmp::Eq => f.i64_eq(),
        Cmp::Ne => f.i64_ne(),
        Cmp::Lt => f.i64_lt_s(),
        Cmp::Ge => f.i64_ge_s(),
        Cmp::Ltu => f.i64_lt_u(),
        Cmp::Geu => f.i64_ge_u(),
    }
    // Taken path (edge 0): resume at pc + imm.
    f.if_(BlockType::Empty);
    if mutation_is(mut_hooks::TAKEN_BRANCH_NO_WRITEBACK) {
        // BUG (E4-T25 injected): the taken exit writes exit_pc + reason but SKIPS the dirty-register
        // writeback, so any register dirtied before the branch is never flushed to memory.
        let target = pc.wrapping_add(imm as u64);
        write_pc_const(f, regs, abi, target);
        write_reason(f, abi, ExitCode::BranchTaken);
        record_chain_retired(f, regs, abi, retired);
        f.i32_const(ExitCode::BranchTaken as i32);
        f.return_();
    } else {
        emit_exit(
            f,
            regs,
            abi,
            ExitCode::BranchTaken,
            PcSrc::Const(pc.wrapping_add(imm as u64)),
            intra[0],
            retired,
            run_ty,
        );
    }
    f.end();
    // Not-taken fall-through (edge 1): resume at pc + insn_len. The dirty set is identical on both
    // edges (a branch reads but never writes registers), so both exits flush the same registers.
    emit_exit(
        f,
        regs,
        abi,
        ExitCode::Fallthrough,
        PcSrc::Const(pc_next),
        intra[1],
        retired,
        run_ty,
    );
}

fn emit_trap(f: &mut FuncBuilder, regs: &mut Regs, abi: &Abi, pc: u64, cause: i64, retired: u64) {
    writeback(f, regs, abi);
    write_pc_const(f, regs, abi, pc); // trap leaves PC at the faulting instruction
    record_chain_retired(f, regs, abi, retired);
    write_info_const(f, abi, cause);
    write_reason(f, abi, ExitCode::Trap);
    f.i32_const(ExitCode::Trap as i32);
    f.return_();
}
