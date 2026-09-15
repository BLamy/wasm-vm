#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;
#[path = "../../../tests/support/jit_fp_memory_verifier.rs"]
mod proof;

fn private(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new())
}
fn shared(m: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new_inline(m).unwrap())
}

#[wasm_bindgen_test]
fn verifier_private_raw_memory_and_permissions() {
    proof::seeded_raw_aliases(private, false);
    proof::compressed_maxima(private, false);
    proof::pmp_interior(private, false);
    proof::mprv_revokes_warm_page(private, false);
    proof::page_edges_and_triggers(private, false);
}

#[wasm_bindgen_test]
fn verifier_shared_raw_memory_and_permissions() {
    proof::seeded_raw_aliases(shared, true);
    proof::compressed_maxima(shared, true);
    proof::pmp_interior(shared, true);
    proof::mprv_revokes_warm_page(shared, true);
    proof::page_edges_and_triggers(shared, true);
}
