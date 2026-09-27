//! Partial-block translation, FP/fcsr coverage and the device-access chain break are
//! timing-transparent on the native wasmtime executor (shared fixture:
//! `tests/support/jit_partial_blocks.rs`).
#[path = "../../../tests/support/jit_partial_blocks.rs"]
mod fixture;
fn executor(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}
#[test]
fn partial_blocks_sample_interrupts_exactly_like_the_batched_interpreter() {
    fixture::partial_csr_loop(executor, true);
}
#[test]
fn fp_loop_with_fcsr_and_double_ops_matches_the_batched_interpreter() {
    fixture::fp_fcsr_loop(executor, true);
}
#[test]
fn fp_loop_with_system_csr_prefix_blocks() {
    fixture::fp_prefix_loop(executor, true);
}
#[test]
fn device_access_ends_the_native_chain_like_a_block_boundary() {
    fixture::device_access_chain(executor);
}
#[test]
fn partial_block_after_decoded_eviction_matches_the_batched_interpreter() {
    // One block per host call: the entry block is always resident, so no re-decode is needed.
    fixture::evicted_partial_chain(executor, false);
}
