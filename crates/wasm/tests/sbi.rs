//! wasm32 mirror of the E2-T04 SBI Base/DBCN/legacy checks (`wasm-pack test --node`).

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;
use wasm_vm_core::sbi::{
    EID_BASE, EID_DBCN, EID_HSM, EID_TIME, SBI_ERR_INVALID_PARAM, SBI_ERR_NOT_SUPPORTED,
    SBI_SUCCESS, SbiState, base::SPEC_VERSION, handle, probe,
};

fn bus() -> SystemBus {
    SystemBus::new(Ram::new(64 * 1024).unwrap())
}

#[wasm_bindgen_test]
fn base_and_probe_on_wasm32() {
    let mut st = SbiState::default();
    let mut b = bus();
    let mut h = Hart::new();
    // get_spec_version → 2.0
    let r = handle(&mut st, &mut b, &mut h, EID_BASE, 0, &[0; 6]);
    assert_eq!((r.error, r.value), (SBI_SUCCESS, SPEC_VERSION));
    // probe: DBCN present, TIME/HSM pending, PMU absent
    for (eid, want) in [(EID_DBCN, 1i64), (EID_TIME, 1), (EID_HSM, 1), (0x0A, 0)] {
        let r = handle(&mut st, &mut b, &mut h, EID_BASE, 3, &[eid, 0, 0, 0, 0, 0]);
        assert_eq!((r.error, r.value), (SBI_SUCCESS, want));
    }
    assert_eq!(probe(EID_BASE), 1);
}

#[wasm_bindgen_test]
fn dbcn_validation_on_wasm32() {
    let mut st = SbiState::default();
    let mut b = bus();
    let mut h = Hart::new();
    // write_byte: fine without a sink (dropped).
    let r = handle(
        &mut st,
        &mut b,
        &mut h,
        EID_DBCN,
        2,
        &[b'x' as u64, 0, 0, 0, 0, 0],
    );
    assert_eq!(r.error, SBI_SUCCESS);
    // console_write with a wrapping range → INVALID_PARAM, no host fault.
    let r = handle(
        &mut st,
        &mut b,
        &mut h,
        EID_DBCN,
        0,
        &[u64::MAX, DRAM_BASE, 0, 0, 0, 0],
    );
    assert_eq!(r.error, SBI_ERR_INVALID_PARAM);
}

#[wasm_bindgen_test]
fn legacy_and_unknown_on_wasm32() {
    let mut st = SbiState::default();
    let mut b = bus();
    let mut h = Hart::new();
    // legacy getchar, empty queue → -1 in a0, non-blocking.
    let r = handle(&mut st, &mut b, &mut h, 0x02, 0, &[0; 6]);
    assert_eq!(r.error, -1);
    // unknown EID → NOT_SUPPORTED.
    let r = handle(&mut st, &mut b, &mut h, 0xDEAD_BEEF, 0, &[0; 6]);
    assert_eq!(r.error, SBI_ERR_NOT_SUPPORTED);
}
