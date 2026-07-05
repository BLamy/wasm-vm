//! wasm32 mirror of the E0-T05 register-file suite (`wasm-pack test --node`).
//! Verifies the x0 invariant, fresh-instance zeroing, and the dump format on the
//! actual wasm32 target.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::hart::regs::{ABI_NAMES, XRegs};

#[wasm_bindgen_test]
fn fresh_instance_is_all_zero_on_wasm32() {
    let r = XRegs::default();
    for n in 0..32 {
        assert_eq!(r.read(n), 0);
    }
    assert_eq!(r.pc, 0);
}

#[wasm_bindgen_test]
fn x0_invariant_under_lcg_sequence() {
    let mut r = XRegs::default();
    let mut oracle = [0u64; 32];
    let mut state: u64 = 0x5EED_2026_0702_0005;
    for _ in 0..10_000 {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let reg = (state >> 33) as u8 & 31;
        let val = state ^ (state << 13);
        r.write(reg, val);
        oracle[reg as usize] = val;
        oracle[0] = 0;
        assert_eq!(
            r.read((state >> 27) as u8 & 31),
            oracle[((state >> 27) as u8 & 31) as usize]
        );
        assert_eq!(r.read(0), 0);
    }
}

#[wasm_bindgen_test]
fn dump_format_stable_on_wasm32() {
    let mut r = XRegs::default();
    r.pc = 0x8000_0000;
    r.write(1, 0xDEAD_BEEF);
    let dump = format!("{r}");
    assert!(dump.starts_with(
        "pc        = 0x0000000080000000\nx00(zero) = 0x0000000000000000\nx01(  ra) = 0x00000000deadbeef\n"
    ));
    assert_eq!(dump.lines().count(), 33);
    assert_eq!(ABI_NAMES[31], "t6");
}
