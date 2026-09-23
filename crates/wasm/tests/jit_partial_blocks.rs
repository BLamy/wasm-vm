//! Partial-block translation, FP/fcsr coverage and the device-access chain break on the browser
//! executor (inline-TLB imported memory with direct in-module chaining, and the private SoftMMU
//! form), held to the batched interpreter in the run loop (shared fixture:
//! `tests/support/jit_partial_blocks.rs`).
#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;
#[path = "../../../tests/support/jit_partial_blocks.rs"]
mod fixture;
fn private(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new())
}
fn inline(m: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new_inline(m).unwrap())
}
#[wasm_bindgen_test]
fn partial_blocks_browser_private() {
    fixture::partial_csr_loop(private, false);
    fixture::fp_fcsr_loop(private, false);
    fixture::fp_prefix_loop(private, false);
    fixture::device_access_chain(private);
}
#[wasm_bindgen_test]
fn partial_blocks_browser_inline() {
    fixture::partial_csr_loop(inline, false);
    fixture::fp_fcsr_loop(inline, false);
    fixture::fp_prefix_loop(inline, false);
    fixture::device_access_chain(inline);
}
/// Verifier jitcov r1 finding: an in-module direct chain into a partial block whose decoded block
/// the bounded decoded cache has evicted must still resume the block cursor at the untranslated
/// op (re-decoding the block from physical memory), matching the batched interpreter across a
/// timer-deadline sweep. The private form runs one block per host call and never needs it.
#[wasm_bindgen_test]
fn partial_block_reached_by_direct_chain_after_decoded_eviction() {
    fixture::evicted_partial_chain(inline, true);
    fixture::evicted_partial_chain(private, false);
}
