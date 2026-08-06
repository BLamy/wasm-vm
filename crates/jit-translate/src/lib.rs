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
    BlockType, ExportKind, FuncBuilder, FuncType, Limits, MemType, ModuleBuilder, ValType,
};
use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::{DecodedBlock, is_terminator};

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
        mem: MemModel::SoftmmuImports,
        tlb: TlbLayout::FROZEN,
    };

    /// The frozen layout with the E4-T11 inline-TLB memory model selected.
    pub const INLINE_TLB: Abi = Abi {
        xreg_base: 0x000,
        exit_reason: 0x218,
        exit_pc: 0x220,
        exit_info: 0x228,
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
}

impl Regs {
    fn new() -> Self {
        Regs {
            local: [None; 32],
            dirty: [false; 32],
        }
    }
}

/// Translate one RV64I [`DecodedBlock`] into a complete WASM module (bytes). The module exports:
/// * memory `"mem"` (the CpuState + register-file region — the harness fills it before the call),
/// * function `"run"` with signature `(i32) -> i32` (the block; arg = `state_base`, ret = exit code).
///
/// and imports `env.load` / `env.store` for memory access (the E4-T11 fast path replaces these).
/// The guest PC used for PC-relative ops (`auipc`, `jal`, branch targets) is the block's
/// `phys_start` — under the physical keying the JIT uses, that is the block's entry PC.
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
            // the imports.
            m.add_memory(MemType {
                limits: Limits::new(1),
            });
            m.export("mem", ExportKind::Memory, 0);
        }
        MemModel::InlineTlb => {
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
    emit_body(&mut f, block, abi)?;
    m.add_code(f.finish());
    Ok(m.finish())
}

/// Emit the function body for `block` into `f`.
fn emit_body(f: &mut FuncBuilder, block: &DecodedBlock, abi: &Abi) -> Result<(), TranslateError> {
    // Pre-flight: reject any out-of-scope op before emitting a single byte, so a partially-emitted
    // module can never escape (the caller gets a clean Unsupported and keeps interpreting).
    for op in &block.ops {
        if !supported(&op.instr) {
            return Err(TranslateError::Unsupported);
        }
    }

    let mut regs = Regs::new();
    let base_pc = block.phys_start;
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
            emit_terminator(f, &mut regs, abi, op.instr, pc, pc_next);
            terminated = true;
        } else {
            emit_alu(f, &mut regs, abi, op.instr, pc, pc_next);
        }
        pc = pc_next;
    }

    // Fall-through block (128-op cap / page edge with no architectural terminator): resume at the
    // byte after the block.
    if !terminated {
        let end_pc = base_pc.wrapping_add(block.total_len);
        writeback(f, &regs, abi);
        write_pc_const(f, abi, end_pc);
        write_reason(f, abi, ExitCode::Fallthrough);
        f.i32_const(ExitCode::Fallthrough as i32);
        f.return_();
    }

    Ok(())
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

fn write_pc_const(f: &mut FuncBuilder, abi: &Abi, pc: u64) {
    f.local_get(STATE_BASE);
    f.i64_const(pc as i64);
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

fn emit_alu(f: &mut FuncBuilder, regs: &mut Regs, abi: &Abi, instr: Instr, pc: u64, _pc_next: u64) {
    use Instr::*;
    match instr {
        // ── U-type ──
        Lui { rd, imm } => {
            f.i64_const(imm);
            set_reg(f, regs, rd);
        }
        Auipc { rd, imm } => {
            f.i64_const(pc.wrapping_add(imm as u64) as i64);
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
            push_reg_i32(f, regs, abi, rs1);
            push_reg_i32(f, regs, abi, rs2);
            f.i32_shr_s();
            f.i64_extend_i32_s();
            set_reg(f, regs, rd);
        }
        // ── loads (side-exit to env.load) ──
        Lb { rd, rs1, imm } => emit_load(f, regs, abi, rd, rs1, imm, load_kind::LB, pc),
        Lh { rd, rs1, imm } => emit_load(f, regs, abi, rd, rs1, imm, load_kind::LH, pc),
        Lw { rd, rs1, imm } => emit_load(f, regs, abi, rd, rs1, imm, load_kind::LW, pc),
        Ld { rd, rs1, imm } => emit_load(f, regs, abi, rd, rs1, imm, load_kind::LD, pc),
        Lbu { rd, rs1, imm } => emit_load(f, regs, abi, rd, rs1, imm, load_kind::LBU, pc),
        Lhu { rd, rs1, imm } => emit_load(f, regs, abi, rd, rs1, imm, load_kind::LHU, pc),
        Lwu { rd, rs1, imm } => emit_load(f, regs, abi, rd, rs1, imm, load_kind::LWU, pc),
        // ── stores (side-exit to env.store) ──
        Sb { rs1, rs2, imm } => emit_store(f, regs, abi, rs1, rs2, imm, 1, pc),
        Sh { rs1, rs2, imm } => emit_store(f, regs, abi, rs1, rs2, imm, 2, pc),
        Sw { rs1, rs2, imm } => emit_store(f, regs, abi, rs1, rs2, imm, 4, pc),
        Sd { rs1, rs2, imm } => emit_store(f, regs, abi, rs1, rs2, imm, 8, pc),
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
        LrW { rd, rs1, .. } => emit_lr(f, regs, abi, rd, rs1, 4, pc),
        LrD { rd, rs1, .. } => emit_lr(f, regs, abi, rd, rs1, 8, pc),
        ScW { rd, rs1, rs2, .. } => emit_sc(f, regs, abi, rd, rs1, rs2, 4, pc),
        ScD { rd, rs1, rs2, .. } => emit_sc(f, regs, abi, rd, rs1, rs2, 8, pc),
        AmoW {
            op, rd, rs1, rs2, ..
        } => emit_amo(f, regs, abi, rd, rs1, rs2, amo_op_code(op), 4, pc),
        AmoD {
            op, rd, rs1, rs2, ..
        } => emit_amo(f, regs, abi, rd, rs1, rs2, amo_op_code(op), 8, pc),
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
) {
    writeback(f, regs, abi);
    write_pc_const(f, abi, pc);
    match abi.mem {
        MemModel::SoftmmuImports => {
            // effective address = rs1 + imm (wrapping u64)
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_add();
            f.i32_const(kind);
            f.call(LOAD_IMPORT);
            set_reg(f, regs, rd);
        }
        MemModel::InlineTlb => emit_load_tlb(f, regs, abi, rd, rs1, imm, kind),
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
) {
    writeback(f, regs, abi);
    write_pc_const(f, abi, pc);
    match abi.mem {
        MemModel::SoftmmuImports => {
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_add();
            push_reg(f, regs, abi, rs2);
            f.i32_const(width);
            f.call(STORE_IMPORT);
        }
        MemModel::InlineTlb => emit_store_tlb(f, regs, abi, rs1, rs2, imm, width),
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
fn emit_lr(f: &mut FuncBuilder, regs: &mut Regs, abi: &Abi, rd: u8, rs1: u8, width: i32, pc: u64) {
    writeback(f, regs, abi);
    write_pc_const(f, abi, pc);
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
) {
    writeback(f, regs, abi);
    write_pc_const(f, abi, pc);
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
) {
    writeback(f, regs, abi);
    write_pc_const(f, abi, pc);
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

fn emit_load_tlb(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rd: u8,
    rs1: u8,
    imm: i64,
    kind: i32,
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
    f.local_get(va);
    f.i32_const(kind);
    f.call(LOAD_IMPORT);
    f.end();
    set_reg(f, regs, rd);
}

fn emit_store_tlb(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rs1: u8,
    rs2: u8,
    imm: i64,
    width: i32,
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
    // HIT: raw store [host_addr, value]. Address must be pushed before the value.
    emit_hit_host_addr(f, va, eaddr);
    f.local_get(sval);
    match width {
        1 => f.i64_store8(0, 0),
        2 => f.i64_store16(0, 0),
        4 => f.i64_store32(0, 0),
        8 => f.i64_store(0, 0),
        _ => unreachable!("bad store width"),
    }
    f.else_();
    // MISS: softmmu performs the access + fills the TLB.
    f.local_get(va);
    f.local_get(sval);
    f.i32_const(width);
    f.call(STORE_IMPORT);
    f.end();
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
    // Architectural override for the zero-divisor case. (Overflow is already correct: with denom==1,
    // Div gives a/1==INT_MIN and Rem gives a%1==0.)
    match kind {
        DivKind::Div | DivKind::Divu => f.i64_const(-1), // div/0 → all-ones (−1 == u64::MAX)
        DivKind::Rem | DivKind::Remu => f.local_get(a),  // rem/0 → dividend
    }
    f.local_get(q);
    f.local_get(b);
    f.i64_eqz(); // cond: divisor was zero
    f.select();
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

fn emit_terminator(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    instr: Instr,
    pc: u64,
    pc_next: u64,
) {
    use Instr::*;
    match instr {
        Beq { rs1, rs2, imm } => emit_branch(f, regs, abi, rs1, rs2, imm, pc, pc_next, Cmp::Eq),
        Bne { rs1, rs2, imm } => emit_branch(f, regs, abi, rs1, rs2, imm, pc, pc_next, Cmp::Ne),
        Blt { rs1, rs2, imm } => emit_branch(f, regs, abi, rs1, rs2, imm, pc, pc_next, Cmp::Lt),
        Bge { rs1, rs2, imm } => emit_branch(f, regs, abi, rs1, rs2, imm, pc, pc_next, Cmp::Ge),
        Bltu { rs1, rs2, imm } => emit_branch(f, regs, abi, rs1, rs2, imm, pc, pc_next, Cmp::Ltu),
        Bgeu { rs1, rs2, imm } => emit_branch(f, regs, abi, rs1, rs2, imm, pc, pc_next, Cmp::Geu),
        Jal { rd, imm } => {
            // link = pc + insn_len; target = pc + imm
            if rd != 0 {
                f.i64_const(pc_next as i64);
                set_reg(f, regs, rd);
            }
            writeback(f, regs, abi);
            write_pc_const(f, abi, pc.wrapping_add(imm as u64));
            write_reason(f, abi, ExitCode::BranchTaken);
            f.i32_const(ExitCode::BranchTaken as i32);
            f.return_();
        }
        Jalr { rd, rs1, imm } => {
            // target = (rs1 + imm) & !1, computed from the OLD rs1 before the link overwrites rd.
            let scratch = f.local(ValType::I64);
            push_reg(f, regs, abi, rs1);
            f.i64_const(imm);
            f.i64_add();
            f.i64_const(-2); // 0xFFFF_FFFF_FFFF_FFFE == !1 — clears bit 0
            f.i64_and();
            f.local_set(scratch);
            if rd != 0 {
                f.i64_const(pc_next as i64);
                set_reg(f, regs, rd);
            }
            writeback(f, regs, abi);
            write_pc_local(f, abi, scratch);
            write_reason(f, abi, ExitCode::BranchTaken);
            f.i32_const(ExitCode::BranchTaken as i32);
            f.return_();
        }
        Ecall => emit_trap(f, regs, abi, pc, 11), // EcallFromM (default oracle mode = M), tval 0
        Ebreak => emit_trap(f, regs, abi, pc, 3), // Breakpoint, tval = pc
        // FENCE / FENCE.I retire as a no-op in the single-thread model; resume at the next PC.
        Fence { .. } | FenceI => {
            writeback(f, regs, abi);
            write_pc_const(f, abi, pc_next);
            write_reason(f, abi, ExitCode::Fallthrough);
            f.i32_const(ExitCode::Fallthrough as i32);
            f.return_();
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
    // Taken path: resume at pc + imm.
    f.if_(BlockType::Empty);
    writeback(f, regs, abi);
    write_pc_const(f, abi, pc.wrapping_add(imm as u64));
    write_reason(f, abi, ExitCode::BranchTaken);
    f.i32_const(ExitCode::BranchTaken as i32);
    f.return_();
    f.end();
    // Not-taken fall-through: resume at pc + insn_len. The dirty set is identical on both edges
    // (a branch reads but never writes registers), so both exits flush the same registers.
    writeback(f, regs, abi);
    write_pc_const(f, abi, pc_next);
    write_reason(f, abi, ExitCode::Fallthrough);
    f.i32_const(ExitCode::Fallthrough as i32);
    f.return_();
}

fn emit_trap(f: &mut FuncBuilder, regs: &mut Regs, abi: &Abi, pc: u64, cause: i64) {
    writeback(f, regs, abi);
    write_pc_const(f, abi, pc); // trap leaves PC at the faulting instruction
    write_info_const(f, abi, cause);
    write_reason(f, abi, ExitCode::Trap);
    f.i32_const(ExitCode::Trap as i32);
    f.return_();
}
