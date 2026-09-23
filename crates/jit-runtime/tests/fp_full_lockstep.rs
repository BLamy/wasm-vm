//! Full F/D + fflags/frm/fcsr coverage on the native wasmtime executor (shared fixture:
//! `tests/support/jit_fp_full.rs`).
#[path = "../../../tests/support/jit_fp_full.rs"]
mod fixture;
fn executor(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}
#[test]
fn every_new_fp_op_matches_the_interpreter_across_rounding_modes_and_specials() {
    fixture::single_ops(executor);
}
#[test]
fn random_fp_blocks_accumulate_flags_and_alias_exactly() {
    fixture::random_blocks(executor);
}
#[test]
fn fcsr_write_then_read_in_one_chainless_sequence() {
    fixture::fcsr_sequence(executor);
}
#[test]
fn partial_blocks_compile_their_prefix_and_exit_precisely() {
    let e = fixture::partial_prefix(executor);
    let coverage = e.translation_coverage();
    assert_eq!(coverage.partial_blocks, 1);
    assert_eq!(coverage.rejected_blocks, 1);
    assert!(coverage.partial_exits > 0);
    assert_eq!(coverage.first_unsupported, vec![("csr:sstatus", 2)]);
}
