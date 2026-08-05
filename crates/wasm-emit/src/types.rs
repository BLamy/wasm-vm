//! The small closed set of WASM *types* the JIT needs to name — value types, reference/table
//! element types, block signatures, and the limits/mutability flags — plus their binary encodings
//! (Core Spec §5.3). Kept as plain `Copy` enums so the builder API is typed end-to-end: a caller
//! writes `ValType::I64`, never the raw `0x7e`, which is what makes malformed modules hard to emit.

use crate::leb128;
use alloc::vec::Vec;

/// A WASM value type. `V128` is included for completeness (E4-T15 vector paths) though the integer
/// JIT uses only `I32`/`I64` for guest registers and `F32`/`F64` for the FP mirror.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ValType {
    I32,
    I64,
    F32,
    F64,
    V128,
    FuncRef,
    ExternRef,
}

impl ValType {
    /// The single-byte encoding (Spec §5.3.1 / §5.3.2 reftypes share the value-type space).
    #[inline]
    pub fn byte(self) -> u8 {
        match self {
            ValType::I32 => 0x7f,
            ValType::I64 => 0x7e,
            ValType::F32 => 0x7d,
            ValType::F64 => 0x7c,
            ValType::V128 => 0x7b,
            ValType::FuncRef => 0x70,
            ValType::ExternRef => 0x6f,
        }
    }
}

/// A table's element type. The JIT's block-chaining design (§2/§4.4) dispatches successors through a
/// mutable `funcref` table, so `FuncRef` is the one that matters; `ExternRef` is here for symmetry.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RefType {
    FuncRef,
    ExternRef,
}

impl RefType {
    #[inline]
    pub fn byte(self) -> u8 {
        match self {
            RefType::FuncRef => 0x70,
            RefType::ExternRef => 0x6f,
        }
    }
}

/// The signature of a structured control block (`block`/`loop`/`if`). Three forms per Spec §5.3.5:
/// empty (`0x40`), a single result value type, or a full function type by index — the last encoded
/// as a *signed* 33-bit LEB (so a positive index can never collide with the negative `0x40`/valtype
/// sentinels), which is exactly the sleb edge the ticket's golden tests pin.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BlockType {
    Empty,
    Value(ValType),
    FuncType(u32),
}

impl BlockType {
    pub(crate) fn encode(self, out: &mut Vec<u8>) {
        match self {
            BlockType::Empty => out.push(0x40),
            BlockType::Value(v) => out.push(v.byte()),
            // Positive type index as signed LEB128 (the "s33" of the spec).
            BlockType::FuncType(idx) => leb128::write_i64(out, idx as i64),
        }
    }
}

/// Mutability of a global (Spec §5.3.7).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mutability {
    Const,
    Var,
}

impl Mutability {
    #[inline]
    pub fn byte(self) -> u8 {
        match self {
            Mutability::Const => 0x00,
            Mutability::Var => 0x01,
        }
    }
}

/// A resizable-limits descriptor, shared by memory and table types (Spec §5.3.4). `shared` sets the
/// threads-proposal `0x03` flag and is only valid for a memory *with* a maximum — the shared guest
/// RAM the JIT and interpreter both address lives behind a `SharedArrayBuffer` (§6), which requires
/// this flag on the imported memory.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Limits {
    pub min: u32,
    pub max: Option<u32>,
    pub shared: bool,
}

impl Limits {
    /// `min` pages, no maximum, not shared.
    pub fn new(min: u32) -> Self {
        Limits {
            min,
            max: None,
            shared: false,
        }
    }
    /// `min`..=`max` pages, not shared.
    pub fn bounded(min: u32, max: u32) -> Self {
        Limits {
            min,
            max: Some(max),
            shared: false,
        }
    }
    /// A shared memory `min`..=`max` (the flag-`0x03` form; `max` is mandatory when shared).
    pub fn shared(min: u32, max: u32) -> Self {
        Limits {
            min,
            max: Some(max),
            shared: true,
        }
    }

    pub(crate) fn encode(&self, out: &mut Vec<u8>) {
        // flags: bit0 = has-max, bit1 = shared. Encodable combos: 0x00, 0x01, 0x03.
        let flag = match (self.max, self.shared) {
            (None, false) => 0x00u8,
            (Some(_), false) => 0x01,
            // A shared memory without a max is invalid per the threads proposal; we clamp callers
            // to `Limits::shared` which always supplies a max, so this arm always has `Some`.
            (Some(_), true) => 0x03,
            (None, true) => panic!("shared memory requires a maximum (threads proposal §limits)"),
        };
        out.push(flag);
        leb128::write_u32(out, self.min);
        if let Some(m) = self.max {
            leb128::write_u32(out, m);
        }
    }
}

/// A memory type is just its limits (Spec §5.3.8).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct MemType {
    pub limits: Limits,
}

/// A table type: element ref-type + limits (Spec §5.3.9). Tables cannot be shared, so `limits.shared`
/// must be false here.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TableType {
    pub elem: RefType,
    pub limits: Limits,
}

impl TableType {
    pub(crate) fn encode(&self, out: &mut Vec<u8>) {
        out.push(self.elem.byte());
        self.limits.encode(out);
    }
}

/// A global's type: value type + mutability (Spec §5.3.7).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct GlobalType {
    pub val: ValType,
    pub mutability: Mutability,
}

impl GlobalType {
    pub(crate) fn encode(&self, out: &mut Vec<u8>) {
        out.push(self.val.byte());
        out.push(self.mutability.byte());
    }
}
