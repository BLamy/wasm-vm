//! Helper test: when WASM_VM_EMIT_DTB is set, write the virt DTB to that path so external
//! tools (the dtc round-trip gate and the E2-T02 verifier) can inspect the real blob.

use wasm_vm_core::fdt::build_virt_dtb;
use wasm_vm_core::platform::Platform;

#[test]
fn emit_dtb_if_requested() {
    if let Ok(path) = std::env::var("WASM_VM_EMIT_DTB") {
        let blob = build_virt_dtb(&Platform::default(), "console=ttyS0 earlycon=sbi", None);
        std::fs::write(&path, &blob).unwrap();
        eprintln!("wrote {} bytes to {path}", blob.len());
    }
}
