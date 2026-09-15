#[path = "../../../tests/support/jit_fp_moves.rs"]
mod fixture;

#[test]
fn fp_moves_native_directed() {
    fixture::directed(&mut jit_runtime::WasmtimeExecutor::new());
}

#[test]
fn fp_moves_native_handoff_reuse() {
    fixture::handoff_reuse(&mut jit_runtime::WasmtimeExecutor::new());
}

#[test]
fn fp_moves_native_precise_runloop() {
    fixture::runloop(Box::new(jit_runtime::WasmtimeExecutor::new()));
}
