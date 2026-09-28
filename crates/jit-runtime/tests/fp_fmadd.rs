#[path = "../../../tests/support/jit_fp_fmadd.rs"]
mod fixture;
fn executor(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}
#[test]
fn fmadd_native_corpus() {
    fixture::corpus(executor);
}
#[test]
fn fmadd_native_handoff_and_faults() {
    fixture::handoff_and_faults(executor);
}
#[test]
fn fmadd_native_runloop() {
    fixture::runloop(executor);
}
