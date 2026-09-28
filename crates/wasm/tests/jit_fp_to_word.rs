#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;
#[path = "../../../tests/support/jit_fp_to_word.rs"]
mod fixture;
fn private(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new())
}
fn inline(m: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new_inline(m).unwrap())
}
#[wasm_bindgen_test]
fn to_word_browser_private() {
    fixture::corpus(private);
    fixture::handoff_and_faults(private);
    fixture::runloop(private);
}
#[wasm_bindgen_test]
fn to_word_browser_inline() {
    fixture::corpus(inline);
    fixture::handoff_and_faults(inline);
    fixture::runloop(inline);
}
