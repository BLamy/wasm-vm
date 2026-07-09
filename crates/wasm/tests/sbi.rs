//! wasm32 mirror of the E2-T03 SBI dispatch skeleton (`wasm-pack test --node`).

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::sbi::{EID_BASE, EID_DBCN, SBI_ERR_NOT_SUPPORTED, dispatch};

#[wasm_bindgen_test]
fn unknown_eid_not_supported_on_wasm32() {
    for eid in [0u64, EID_BASE, EID_DBCN, 0xDEAD_BEEF, u64::MAX] {
        let ret = dispatch(eid, 3, &[9, 8, 7, 6, 5, 4]);
        assert_eq!(ret.error, SBI_ERR_NOT_SUPPORTED);
        assert_eq!(ret.value, 0);
    }
}
