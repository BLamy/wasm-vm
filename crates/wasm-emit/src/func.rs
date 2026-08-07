//! The typed function-body encoder. A [`FuncBuilder`] owns one function's local declarations and its
//! instruction stream, and exposes one method per opcode the JIT emits — so a call site writes
//! `f.i64_add()`, never the raw `0x7c`. Two correctness properties matter here and are enforced at
//! *build* time (the ticket's adversarial angle #3, "misuse the API → panic, don't emit garbage"):
//!
//! * **Local indices are checked.** `local.get/set/tee` panic on an out-of-range index rather than
//!   emitting a body `wasmparser` will later reject with a useless offset.
//! * **Control structure is balanced.** Every `block`/`loop`/`if` pushes a frame; `end` pops one and
//!   panics if there is none; `finish` panics unless the frame stack is empty. So an unbalanced body
//!   can never reach the module.
//!
//! Speed (the ticket's hot-path requirement): every method is a couple of `push`es into a single
//! reused `Vec<u8>`; there is no per-instruction allocation and no formatting. Locals are stored
//! compactly and only run-length-compressed once, in `finish`.

use crate::leb128;
use crate::types::{BlockType, ValType};
use alloc::vec::Vec;

/// The kind of a live control frame — tracked only to balance `end`s and to give panics a name.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Frame {
    Block,
    Loop,
    If,
}

/// Builds a single WASM function body: locals declaration + instruction stream + terminating `end`.
pub struct FuncBuilder {
    /// Parameter value types (index space starts here; params are locals 0..param_count).
    params: Vec<ValType>,
    /// Declared locals, in declaration order (each gets the next index after params).
    locals: Vec<ValType>,
    /// The raw instruction bytes (no locals header, no terminating `end`).
    code: Vec<u8>,
    /// Live control frames; must be empty at `finish`.
    frames: Vec<Frame>,
}

impl FuncBuilder {
    /// Start a body for a function whose parameters are `params`. Instruction/locals capacity is
    /// pre-reserved so the common small-block case does no reallocation.
    pub fn new(params: &[ValType]) -> Self {
        FuncBuilder {
            params: params.to_vec(),
            locals: Vec::new(),
            code: Vec::with_capacity(256),
            frames: Vec::with_capacity(8),
        }
    }

    /// Declare one additional local of type `ty`, returning its index in the combined
    /// params+locals space. The JIT calls this once per guest register it materializes.
    pub fn local(&mut self, ty: ValType) -> u32 {
        let idx = self.params.len() as u32 + self.locals.len() as u32;
        self.locals.push(ty);
        idx
    }

    #[inline]
    fn check_local(&self, idx: u32) {
        let n = self.params.len() as u32 + self.locals.len() as u32;
        assert!(idx < n, "local index {idx} out of range (have {n})");
    }

    // ---- raw primitives (crate-internal; call sites use the typed opcode methods) ----
    #[inline]
    fn op(&mut self, byte: u8) {
        self.code.push(byte);
    }
    #[inline]
    fn u32imm(&mut self, v: u32) {
        leb128::write_u32(&mut self.code, v);
    }

    // ================= constants =================
    /// `i32.const`
    pub fn i32_const(&mut self, v: i32) {
        self.op(0x41);
        leb128::write_i32(&mut self.code, v);
    }
    /// `i64.const`
    pub fn i64_const(&mut self, v: i64) {
        self.op(0x42);
        leb128::write_i64(&mut self.code, v);
    }
    /// `f32.const` (raw little-endian IEEE-754, not LEB — Spec §5.4.5)
    pub fn f32_const(&mut self, v: f32) {
        self.op(0x43);
        self.code.extend_from_slice(&v.to_le_bytes());
    }
    /// `f64.const`
    pub fn f64_const(&mut self, v: f64) {
        self.op(0x44);
        self.code.extend_from_slice(&v.to_le_bytes());
    }

    // ================= locals / globals =================
    /// `local.get`
    pub fn local_get(&mut self, idx: u32) {
        self.check_local(idx);
        self.op(0x20);
        self.u32imm(idx);
    }
    /// `local.set`
    pub fn local_set(&mut self, idx: u32) {
        self.check_local(idx);
        self.op(0x21);
        self.u32imm(idx);
    }
    /// `local.tee`
    pub fn local_tee(&mut self, idx: u32) {
        self.check_local(idx);
        self.op(0x22);
        self.u32imm(idx);
    }
    /// `global.get`
    pub fn global_get(&mut self, idx: u32) {
        self.op(0x23);
        self.u32imm(idx);
    }
    /// `global.set`
    pub fn global_set(&mut self, idx: u32) {
        self.op(0x24);
        self.u32imm(idx);
    }

    // ================= memory =================
    #[inline]
    fn memarg(&mut self, align: u32, offset: u32) {
        // memarg = align (log2, in bytes) then offset, both u32 LEB (Spec §5.4.6).
        leb128::write_u32(&mut self.code, align);
        leb128::write_u32(&mut self.code, offset);
    }

    /// `memory.size` (single memory 0).
    pub fn memory_size(&mut self) {
        self.op(0x3f);
        self.op(0x00);
    }
    /// `memory.grow` (single memory 0).
    pub fn memory_grow(&mut self) {
        self.op(0x40);
        self.op(0x00);
    }

    // ================= control flow =================
    /// `block bt`
    pub fn block(&mut self, bt: BlockType) {
        self.op(0x02);
        bt.encode(&mut self.code);
        self.frames.push(Frame::Block);
    }
    /// `loop bt`
    pub fn loop_(&mut self, bt: BlockType) {
        self.op(0x03);
        bt.encode(&mut self.code);
        self.frames.push(Frame::Loop);
    }
    /// `if bt`
    pub fn if_(&mut self, bt: BlockType) {
        self.op(0x04);
        bt.encode(&mut self.code);
        self.frames.push(Frame::If);
    }
    /// `else` — only valid inside an `if` frame.
    pub fn else_(&mut self) {
        assert_eq!(
            self.frames.last().copied(),
            Some(Frame::If),
            "`else` outside an `if`"
        );
        self.op(0x05);
    }
    /// `end` — pops one control frame (panics if there is none: the unbalanced-`end` guard).
    pub fn end(&mut self) {
        assert!(self.frames.pop().is_some(), "`end` with no open block");
        self.op(0x0b);
    }
    /// `br depth`
    pub fn br(&mut self, depth: u32) {
        self.op(0x0c);
        self.u32imm(depth);
    }
    /// `br_if depth`
    pub fn br_if(&mut self, depth: u32) {
        self.op(0x0d);
        self.u32imm(depth);
    }
    /// `br_table targets default`
    pub fn br_table(&mut self, targets: &[u32], default: u32) {
        self.op(0x0e);
        self.u32imm(targets.len() as u32);
        for &t in targets {
            self.u32imm(t);
        }
        self.u32imm(default);
    }
    /// `return`
    pub fn return_(&mut self) {
        self.op(0x0f);
    }
    /// `unreachable`
    pub fn unreachable(&mut self) {
        self.op(0x00);
    }
    /// `nop`
    pub fn nop(&mut self) {
        self.op(0x01);
    }
    /// `drop` — the WASM stack-drop opcode. Named to mirror the instruction mnemonic; it is not the
    /// `std::ops::Drop` destructor (this method takes `&mut self` and emits a byte).
    #[allow(clippy::should_implement_trait)]
    pub fn drop(&mut self) {
        self.op(0x1a);
    }
    /// `select` (untyped).
    pub fn select(&mut self) {
        self.op(0x1b);
    }

    // ================= calls =================
    /// `call funcidx`
    pub fn call(&mut self, func: u32) {
        self.op(0x10);
        self.u32imm(func);
    }
    /// `call_indirect (type typeidx) (table tableidx)` — the block-chaining dispatch primitive.
    pub fn call_indirect(&mut self, type_idx: u32, table_idx: u32) {
        self.op(0x11);
        self.u32imm(type_idx);
        self.u32imm(table_idx);
    }

    /// Consume the builder, returning the function-body bytes for the code section: the
    /// run-length-compressed locals declaration, the instruction stream, and the terminating `end`.
    /// Panics if any control frame is still open (the balance guard).
    pub fn finish(mut self) -> Vec<u8> {
        assert!(
            self.frames.is_empty(),
            "{} control frame(s) left open at finish()",
            self.frames.len()
        );
        // Function body's implicit outer block is closed with `end`.
        self.op(0x0b);

        let mut body = Vec::with_capacity(self.code.len() + 8);

        // Locals declaration = vec of (count, valtype) runs, run-length-compressed by type
        // (Spec §5.5.9). This is the compact form validators/engines expect and keeps the header a
        // handful of bytes even for the >50k-locals adversarial case.
        let mut runs: Vec<(u32, ValType)> = Vec::new();
        for &ty in &self.locals {
            match runs.last_mut() {
                Some((count, run_ty)) if *run_ty == ty => *count += 1,
                _ => runs.push((1, ty)),
            }
        }
        leb128::write_u32(&mut body, runs.len() as u32);
        for (count, ty) in runs {
            leb128::write_u32(&mut body, count);
            body.push(ty.byte());
        }

        body.extend_from_slice(&self.code);
        body
    }
}

// A macro to declare the many single-byte numeric/comparison/conversion opcodes without 200 lines of
// near-identical hand-written methods — each expands to `pub fn name(&mut self){ self.op(byte) }`.
macro_rules! simple_ops {
    ($($name:ident = $byte:expr, $doc:literal;)*) => {
        impl FuncBuilder {
            $(
                #[doc = $doc]
                #[inline]
                pub fn $name(&mut self) { self.op($byte); }
            )*
        }
    };
}

// The full i32/i64 ALU + compare set the JIT needs, plus the f32/f64 basics and the int/float
// conversions. Bytes are Core Spec §5.4.6 (numeric instructions).
simple_ops! {
    // ---- i32 comparison ----
    i32_eqz = 0x45, "`i32.eqz`"; i32_eq = 0x46, "`i32.eq`"; i32_ne = 0x47, "`i32.ne`";
    i32_lt_s = 0x48, "`i32.lt_s`"; i32_lt_u = 0x49, "`i32.lt_u`";
    i32_gt_s = 0x4a, "`i32.gt_s`"; i32_gt_u = 0x4b, "`i32.gt_u`";
    i32_le_s = 0x4c, "`i32.le_s`"; i32_le_u = 0x4d, "`i32.le_u`";
    i32_ge_s = 0x4e, "`i32.ge_s`"; i32_ge_u = 0x4f, "`i32.ge_u`";
    // ---- i64 comparison ----
    i64_eqz = 0x50, "`i64.eqz`"; i64_eq = 0x51, "`i64.eq`"; i64_ne = 0x52, "`i64.ne`";
    i64_lt_s = 0x53, "`i64.lt_s`"; i64_lt_u = 0x54, "`i64.lt_u`";
    i64_gt_s = 0x55, "`i64.gt_s`"; i64_gt_u = 0x56, "`i64.gt_u`";
    i64_le_s = 0x57, "`i64.le_s`"; i64_le_u = 0x58, "`i64.le_u`";
    i64_ge_s = 0x59, "`i64.ge_s`"; i64_ge_u = 0x5a, "`i64.ge_u`";
    // ---- f32/f64 comparison ----
    f32_eq = 0x5b, "`f32.eq`"; f32_ne = 0x5c, "`f32.ne`"; f32_lt = 0x5d, "`f32.lt`";
    f32_gt = 0x5e, "`f32.gt`"; f32_le = 0x5f, "`f32.le`"; f32_ge = 0x60, "`f32.ge`";
    f64_eq = 0x61, "`f64.eq`"; f64_ne = 0x62, "`f64.ne`"; f64_lt = 0x63, "`f64.lt`";
    f64_gt = 0x64, "`f64.gt`"; f64_le = 0x65, "`f64.le`"; f64_ge = 0x66, "`f64.ge`";
    // ---- i32 arithmetic / bitwise / shift ----
    i32_clz = 0x67, "`i32.clz`"; i32_ctz = 0x68, "`i32.ctz`"; i32_popcnt = 0x69, "`i32.popcnt`";
    i32_add = 0x6a, "`i32.add`"; i32_sub = 0x6b, "`i32.sub`"; i32_mul = 0x6c, "`i32.mul`";
    i32_div_s = 0x6d, "`i32.div_s`"; i32_div_u = 0x6e, "`i32.div_u`";
    i32_rem_s = 0x6f, "`i32.rem_s`"; i32_rem_u = 0x70, "`i32.rem_u`";
    i32_and = 0x71, "`i32.and`"; i32_or = 0x72, "`i32.or`"; i32_xor = 0x73, "`i32.xor`";
    i32_shl = 0x74, "`i32.shl`"; i32_shr_s = 0x75, "`i32.shr_s`"; i32_shr_u = 0x76, "`i32.shr_u`";
    i32_rotl = 0x77, "`i32.rotl`"; i32_rotr = 0x78, "`i32.rotr`";
    // ---- i64 arithmetic / bitwise / shift ----
    i64_clz = 0x79, "`i64.clz`"; i64_ctz = 0x7a, "`i64.ctz`"; i64_popcnt = 0x7b, "`i64.popcnt`";
    i64_add = 0x7c, "`i64.add`"; i64_sub = 0x7d, "`i64.sub`"; i64_mul = 0x7e, "`i64.mul`";
    i64_div_s = 0x7f, "`i64.div_s`"; i64_div_u = 0x80, "`i64.div_u`";
    i64_rem_s = 0x81, "`i64.rem_s`"; i64_rem_u = 0x82, "`i64.rem_u`";
    i64_and = 0x83, "`i64.and`"; i64_or = 0x84, "`i64.or`"; i64_xor = 0x85, "`i64.xor`";
    i64_shl = 0x86, "`i64.shl`"; i64_shr_s = 0x87, "`i64.shr_s`"; i64_shr_u = 0x88, "`i64.shr_u`";
    i64_rotl = 0x89, "`i64.rotl`"; i64_rotr = 0x8a, "`i64.rotr`";
    // ---- f32/f64 arithmetic (basics) ----
    f32_abs = 0x8b, "`f32.abs`"; f32_neg = 0x8c, "`f32.neg`"; f32_sqrt = 0x91, "`f32.sqrt`";
    f32_add = 0x92, "`f32.add`"; f32_sub = 0x93, "`f32.sub`"; f32_mul = 0x94, "`f32.mul`";
    f32_div = 0x95, "`f32.div`"; f32_min = 0x96, "`f32.min`"; f32_max = 0x97, "`f32.max`";
    f64_abs = 0x99, "`f64.abs`"; f64_neg = 0x9a, "`f64.neg`"; f64_sqrt = 0x9f, "`f64.sqrt`";
    f64_add = 0xa0, "`f64.add`"; f64_sub = 0xa1, "`f64.sub`"; f64_mul = 0xa2, "`f64.mul`";
    f64_div = 0xa3, "`f64.div`"; f64_min = 0xa4, "`f64.min`"; f64_max = 0xa5, "`f64.max`";
    // ---- conversions (the ones the RISC-V lowering needs) ----
    i32_wrap_i64 = 0xa7, "`i32.wrap_i64`";
    i64_extend_i32_s = 0xac, "`i64.extend_i32_s`"; i64_extend_i32_u = 0xad, "`i64.extend_i32_u`";
    // sign-extension proposal (widely supported; RISC-V byte/half ops lower to these)
    i32_extend8_s = 0xc0, "`i32.extend8_s`"; i32_extend16_s = 0xc1, "`i32.extend16_s`";
    i64_extend8_s = 0xc2, "`i64.extend8_s`"; i64_extend16_s = 0xc3, "`i64.extend16_s`";
    i64_extend32_s = 0xc4, "`i64.extend32_s`";
}

// Loads and stores all take a memarg (align, offset); a second macro generates the width variants.
macro_rules! mem_ops {
    ($($name:ident = $byte:expr, $doc:literal;)*) => {
        impl FuncBuilder {
            $(
                #[doc = $doc]
                #[inline]
                pub fn $name(&mut self, align: u32, offset: u32) {
                    self.op($byte);
                    self.memarg(align, offset);
                }
            )*
        }
    };
}

// Every load/store width the guest needs, signed + unsigned partial-width loads (Spec §5.4.6).
mem_ops! {
    i32_load = 0x28, "`i32.load`"; i64_load = 0x29, "`i64.load`";
    f32_load = 0x2a, "`f32.load`"; f64_load = 0x2b, "`f64.load`";
    i32_load8_s = 0x2c, "`i32.load8_s`"; i32_load8_u = 0x2d, "`i32.load8_u`";
    i32_load16_s = 0x2e, "`i32.load16_s`"; i32_load16_u = 0x2f, "`i32.load16_u`";
    i64_load8_s = 0x30, "`i64.load8_s`"; i64_load8_u = 0x31, "`i64.load8_u`";
    i64_load16_s = 0x32, "`i64.load16_s`"; i64_load16_u = 0x33, "`i64.load16_u`";
    i64_load32_s = 0x34, "`i64.load32_s`"; i64_load32_u = 0x35, "`i64.load32_u`";
    i32_store = 0x36, "`i32.store`"; i64_store = 0x37, "`i64.store`";
    f32_store = 0x38, "`f32.store`"; f64_store = 0x39, "`f64.store`";
    i32_store8 = 0x3a, "`i32.store8`"; i32_store16 = 0x3b, "`i32.store16`";
    i64_store8 = 0x3c, "`i64.store8`"; i64_store16 = 0x3d, "`i64.store16`";
    i64_store32 = 0x3e, "`i64.store32`";
}

// The threads-proposal atomic subset (0xFE prefix) the E4-T14/T22 A-extension lowering needs. Each
// is `0xFE <sub-opcode(u32 LEB)> <memarg>`. We expose the common RMW/load/store/cmpxchg set; more can
// be added the same way. Kept behind the same typed memarg API so alignment stays explicit (atomics
// require natural alignment, which the emitter does not enforce — the caller passes the right log2).
macro_rules! atomic_ops {
    ($($name:ident = $sub:expr, $doc:literal;)*) => {
        impl FuncBuilder {
            $(
                #[doc = $doc]
                #[inline]
                pub fn $name(&mut self, align: u32, offset: u32) {
                    self.op(0xfe);
                    self.u32imm($sub);
                    self.memarg(align, offset);
                }
            )*
        }
    };
}

atomic_ops! {
    // notify / wait
    memory_atomic_notify = 0x00, "`memory.atomic.notify`";
    memory_atomic_wait32 = 0x01, "`memory.atomic.wait32`";
    memory_atomic_wait64 = 0x02, "`memory.atomic.wait64`";
    // atomic loads / stores
    i32_atomic_load = 0x10, "`i32.atomic.load`"; i64_atomic_load = 0x11, "`i64.atomic.load`";
    i32_atomic_load8_u = 0x12, "`i32.atomic.load8_u`"; i32_atomic_load16_u = 0x13, "`i32.atomic.load16_u`";
    i64_atomic_load8_u = 0x14, "`i64.atomic.load8_u`"; i64_atomic_load16_u = 0x15, "`i64.atomic.load16_u`";
    i64_atomic_load32_u = 0x16, "`i64.atomic.load32_u`";
    i32_atomic_store = 0x17, "`i32.atomic.store`"; i64_atomic_store = 0x18, "`i64.atomic.store`";
    i32_atomic_store8 = 0x19, "`i32.atomic.store8`"; i32_atomic_store16 = 0x1a, "`i32.atomic.store16`";
    i64_atomic_store8 = 0x1b, "`i64.atomic.store8`"; i64_atomic_store16 = 0x1c, "`i64.atomic.store16`";
    i64_atomic_store32 = 0x1d, "`i64.atomic.store32`";
    // rmw add (the representative RMW; full width set)
    i32_atomic_rmw_add = 0x1e, "`i32.atomic.rmw.add`"; i64_atomic_rmw_add = 0x1f, "`i64.atomic.rmw.add`";
    i32_atomic_rmw8_add_u = 0x20, "`i32.atomic.rmw8.add_u`"; i32_atomic_rmw16_add_u = 0x21, "`i32.atomic.rmw16.add_u`";
    i64_atomic_rmw8_add_u = 0x22, "`i64.atomic.rmw8.add_u`"; i64_atomic_rmw16_add_u = 0x23, "`i64.atomic.rmw16.add_u`";
    i64_atomic_rmw32_add_u = 0x24, "`i64.atomic.rmw32.add_u`";
    // rmw cmpxchg (word/doubleword — LR/SC + AMO lowering needs these)
    i32_atomic_rmw_cmpxchg = 0x48, "`i32.atomic.rmw.cmpxchg`";
    i64_atomic_rmw_cmpxchg = 0x49, "`i64.atomic.rmw.cmpxchg`";
}

impl FuncBuilder {
    /// `atomic.fence` (`0xFE 0x03 0x00`) — the ordering-only fence, no memarg.
    pub fn atomic_fence(&mut self) {
        self.op(0xfe);
        self.u32imm(0x03);
        self.op(0x00);
    }
}
