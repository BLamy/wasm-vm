#![cfg(target_arch = "wasm32")]
#![cfg(not(feature = "zicsr-stub"))]
use wasm_bindgen_test::wasm_bindgen_test;
#[path = "../../../tests/shared/e5_t22f_pmp.rs"]
mod fixture;

#[wasm_bindgen_test]
fn su_guest_trace_parity() {
    fixture::su_guest_trace_parity();
}
#[wasm_bindgen_test]
fn su_revision_revocation() {
    fixture::su_revision_revocation();
}
#[wasm_bindgen_test]
fn su_snapshot_and_host_sequence() {
    fixture::su_snapshot_and_host_sequence();
}

#[wasm_bindgen_test]
fn browser_jit_su_transitions_match_interpreter() {
    use wasm_vm_core::resume::ComponentSnapshot;
    let mut reference = fixture::su_machine(None);
    let mut actual = fixture::su_machine(Some(1024));
    actual.set_executor(Box::new(wasm_vm_wasm::BrowserExecutor::new()));
    actual.set_hotness_threshold(1);
    actual.set_jit(true);
    assert_eq!(reference.run(7001), wasm_vm_core::RunOutcome::MaxInstrs);
    assert_eq!(actual.run(7001), wasm_vm_core::RunOutcome::MaxInstrs);
    assert!(
        actual.executor().unwrap().executed_blocks() > 0,
        "compiled code must actually execute"
    );
    assert_eq!(actual.hart().to_snapshot(), reference.hart().to_snapshot());
    assert_eq!(
        actual.snapshot().hex_digest(),
        reference.snapshot().hex_digest()
    );
}
