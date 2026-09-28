#[path = "../../../tests/support/jit_fp_comparisons_verifier.rs"]
mod proof;

fn native(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}

#[test]
fn verifier_native_literal_comparison_goldens() {
    eprintln!(
        "CRITIC_NATIVE_GOLDENS {:?}",
        proof::literal_goldens(native, false)
    );
}

#[test]
fn verifier_native_seeded_comparisons_and_fs() {
    eprintln!(
        "CRITIC_NATIVE_SEEDED {:?}",
        proof::seeded_aliases_and_fs(native, false)
    );
}

#[test]
fn verifier_native_control_handoff_and_faults() {
    eprintln!(
        "CRITIC_NATIVE_CONTROL {:?}",
        proof::control_handoff_and_faults(native, false)
    );
}
