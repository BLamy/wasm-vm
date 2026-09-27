//! The shipped browser module: a cdylib-only re-export of [`wasm_vm_wasm`].
//!
//! `crates/wasm` is also an rlib (its integration tests link it), and cargo skips LTO for any
//! unit that emits an rlib. Building the browser bundle from this crate instead lets
//! `[profile.wasm-release]` apply fat LTO. The `#[wasm_bindgen]` exports are defined in
//! `wasm_vm_wasm`; the `pub use` keeps the crate linked so they reach the final module.

pub use wasm_vm_wasm::*;
