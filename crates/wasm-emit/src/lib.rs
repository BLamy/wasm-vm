//! # `wasm-emit` — E4-T07: the hand-rolled WebAssembly module emitter for the JIT
//!
//! The JIT (E4-T09…T20) translates a hot guest basic block into WASM bytecode *at runtime, inside a
//! wasm module in the browser*, and instantiates it via `WebAssembly.compile` (one module per batch
//! of ~64 blocks — `docs/jit-architecture.md` §7). This crate is the byte-level backend it calls: it
//! turns typed instruction/section calls into a valid `.wasm` binary. It does **not** do RISC-V →
//! WASM lowering (that is the JIT's job) — it is the generic, correct, fast builder underneath.
//!
//! Design constraints, all from the ticket:
//! * **`no_std + alloc`, zero runtime dependencies.** Compiles for `wasm32-unknown-unknown` because
//!   it runs inside the browser JIT. `wasmparser`/`wasmtime` are dev-dependencies (tests only).
//! * **Typed, hard-to-misuse API.** [`FuncBuilder`] has one method per opcode and checks local
//!   indices + control-flow balance at build time; [`ModuleBuilder`] emits sections in canonical
//!   order with size prefixes measured from the finished bytes (never a stale pre-computed prefix).
//! * **Fast.** Every instruction is a couple of `push`es into a reused buffer — no per-op allocation.
//!
//! ## Shape
//! ```ignore
//! let mut m = ModuleBuilder::new();
//! let t = m.add_type(FuncType::new(&[ValType::I64, ValType::I64], &[ValType::I64]));
//! let f = m.add_function(t);
//! m.export("add", ExportKind::Func, f);
//! let mut b = FuncBuilder::new(&[ValType::I64, ValType::I64]);
//! b.local_get(0); b.local_get(1); b.i64_add();
//! m.add_code(b.finish());
//! let bytes = m.finish(); // a valid wasm binary
//! ```
//!
//! Module map: [`leb128`] (the variable-int foundation), [`types`] (value/ref/block/limits types),
//! [`module`] ([`ModuleBuilder`] + sections), [`func`] ([`FuncBuilder`] + the opcode API).

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

pub mod func;
pub mod leb128;
pub mod module;
pub mod types;

pub use func::FuncBuilder;
pub use module::{ExportKind, FuncType, ImportDesc, ModuleBuilder};
pub use types::{BlockType, GlobalType, Limits, MemType, Mutability, RefType, TableType, ValType};
