#[path = "../../../tests/support/jit_fp_from_integer.rs"]
mod fixture;
fn executor(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}
#[test]
fn from_integer_native_corpus() {
    fixture::corpus(executor);
}
#[test]
fn from_integer_native_handoff_and_faults() {
    fixture::handoff_and_faults(executor);
}
#[test]
fn from_integer_native_runloop() {
    fixture::runloop(executor);
}
