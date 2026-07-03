//! E1-T05: the softfloat backend must be bit-identical on wasm32 — this is the whole
//! determinism argument for not using host floats (whose NaN bits diverge across targets).
//! The results here must match the native `crates/core/tests/softfloat.rs` oracle exactly.
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::softfloat::{F32, F64, Flags, RoundMode, SoftFloat};

const RNE: RoundMode = RoundMode::Rne;

#[wasm_bindgen_test]
fn softfloat_is_deterministic_on_wasm32() {
    // Canonical NaN identical to native.
    assert_eq!(F64::canonical_nan(), 0x7ff8_0000_0000_0000);
    assert_eq!(F32::canonical_nan(), 0x7fc0_0000);

    // Arithmetic.
    assert_eq!(
        F64::add(1.0f64.to_bits(), 2.0f64.to_bits(), RNE).0,
        3.0f64.to_bits()
    );
    assert_eq!(
        F64::div(1.0f64.to_bits(), 0.0f64.to_bits(), RNE).1.0 & Flags::DZ,
        Flags::DZ
    );

    // NaN canonicalization (apfloat would otherwise propagate the payload).
    let snan = 0x7ff0_0000_0000_0001u64;
    let (r, f) = F64::add(snan, 1.0f64.to_bits(), RNE);
    assert_eq!(r, F64::canonical_nan());
    assert_eq!(f.0 & Flags::NV, Flags::NV);

    // Fused multiply-add keeps the low term (double-rounding witness).
    let a = f64::from_bits(0x3ff0_0000_0000_0001).to_bits();
    let c = (-(1.0f64 + 2.0f64.powi(-51))).to_bits();
    assert_eq!(F64::fma(a, a, c, RNE).0, 2.0f64.powi(-104).to_bits());

    // sqrt across all five rounding modes on a non-perfect-square (must match native bits).
    let two = 2.0f64.to_bits();
    assert_eq!(F64::sqrt(two, RoundMode::Rne).0, 0x3ff6_a09e_667f_3bcd);
    assert_eq!(F64::sqrt(two, RoundMode::Rtz).0, 0x3ff6_a09e_667f_3bcc);
    assert_eq!(F64::sqrt(two, RoundMode::Rdn).0, 0x3ff6_a09e_667f_3bcc);
    assert_eq!(F64::sqrt(two, RoundMode::Rup).0, 0x3ff6_a09e_667f_3bcd);
    assert_eq!(F64::sqrt(two, RoundMode::Rmm).0, 0x3ff6_a09e_667f_3bcd);
    // sqrt(-1) = canonical NaN + NV; sqrt(4) exact.
    assert_eq!(
        F64::sqrt((-1.0f64).to_bits(), RNE),
        (F64::canonical_nan(), Flags(Flags::NV))
    );
    assert_eq!(
        F64::sqrt(4.0f64.to_bits(), RNE),
        (2.0f64.to_bits(), Flags::NONE)
    );

    // f32 sqrt.
    assert_eq!(
        F32::sqrt(4.0f32.to_bits(), RNE),
        (2.0f32.to_bits(), Flags::NONE)
    );
}
