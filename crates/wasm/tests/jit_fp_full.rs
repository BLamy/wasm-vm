//! Full F/D + fflags/frm/fcsr coverage on the browser executor, both memory models (shared
//! fixture: `tests/support/jit_fp_full.rs`). Exercises the `__jit_fp_op32` / `__jit_fp_op64` /
//! `__jit_fp_flags` direct imports.
#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;
#[path = "../../../tests/support/jit_fp_full.rs"]
mod fixture;
fn private(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new())
}
fn inline(m: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new_inline(m).unwrap())
}
#[wasm_bindgen_test]
fn fp_full_browser_private() {
    fixture::single_ops(private);
    fixture::random_blocks(private);
    fixture::fcsr_sequence(private);
    fixture::fp_image_elision(private);
    fixture::partial_prefix(private);
}
#[wasm_bindgen_test]
fn fp_full_browser_inline() {
    fixture::single_ops(inline);
    fixture::random_blocks(inline);
    fixture::fcsr_sequence(inline);
    fixture::fp_image_elision(inline);
    fixture::partial_prefix(inline);
}
