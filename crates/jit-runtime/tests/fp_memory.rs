#[path = "../../../tests/support/jit_fp_memory.rs"]
mod fixture;
fn executor(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}
#[test]
fn fp_memory_native_transfers() {
    fixture::transfers(executor);
}
#[test]
fn fp_memory_native_virtual_pages() {
    fixture::virtual_pages(executor);
}
#[test]
fn fp_memory_native_mmio_faults() {
    fixture::mmio_and_faults(executor);
}
#[test]
fn fp_memory_native_runloop() {
    fixture::runloop(executor);
}
