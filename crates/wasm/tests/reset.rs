//! E1-T01: the reset state must be identical on wasm32 — in particular the 64-bit `misa`
//! and `pc` must survive the bindgen/64-bit boundary without truncation (verifier angle 3).
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{MISA_RV64GC_SU, Priv};
use wasm_vm_core::hart::Hart;

#[wasm_bindgen_test]
fn reset_state_is_identical_on_wasm32() {
    let h = Hart::new();
    assert_eq!(h.regs.pc, DRAM_BASE);
    for r in 0..32 {
        assert_eq!(h.regs.read(r), 0);
    }
    assert_eq!(h.csr.mode, Priv::M);
    assert_eq!(h.csr.mstatus, 0);
    assert!(!h.csr.mie());
    assert!(!h.csr.mprv());
    assert_eq!(h.csr.mcause, 0);
    // The 64-bit constant must not truncate through the wasm boundary.
    assert_eq!(h.csr.misa(), 0x8000_0000_0014_112D);
    assert_eq!(h.csr.misa(), MISA_RV64GC_SU);
    assert_eq!(
        h.csr.misa() >> 62,
        2,
        "MXL = 2 (RV64) high bits intact on wasm32"
    );
    assert_eq!(h.csr.mhartid(), 0);

    // reset determinism holds on wasm32 too.
    let mut d = Hart::new();
    d.regs.write(5, 0xDEAD_BEEF_CAFE_F00D);
    d.regs.pc = 0x1234;
    d.csr.mstatus = u64::MAX;
    d.csr.mode = Priv::U;
    d.reset(DRAM_BASE);
    assert!(d == Hart::new(), "reset is bit-identical on wasm32");
}
