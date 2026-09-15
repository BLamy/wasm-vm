#[path = "../../../tests/support/jit_fp_memory_verifier.rs"]
mod proof;

fn native(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}

#[test]
fn verifier_native_raw_memory_and_permissions() {
    proof::seeded_raw_aliases(native, false);
    proof::compressed_maxima(native, false);
    proof::pmp_interior(native, false);
    proof::mprv_revokes_warm_page(native, false);
    proof::page_edges_and_triggers(native, false);
}
