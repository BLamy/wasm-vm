use wasm_vm_core::softfloat::{F32, RoundMode, SoftFloat};
#[path = "../../../tests/support/fmadd_goldens.rs"]
mod literals;

#[test]
fn independent_fmadd_literal_bits_and_flags() {
    let canonical = |value: u64| {
        if value >> 32 == 0xffff_ffff {
            value as u32
        } else {
            0x7fc0_0000
        }
    };
    let mut mismatches = 0;
    for &(a, b, c, bits, flags) in literals::GOLDENS {
        for mode in 0..5 {
            let actual = F32::fma(
                canonical(a),
                canonical(b),
                canonical(c),
                RoundMode::from_bits(mode).unwrap(),
            );
            let expected = (bits[usize::from(mode)], flags[usize::from(mode)]);
            if (actual.0, actual.1.0) != expected {
                mismatches += 1;
                eprintln!(
                    "FMA_MISMATCH a={a:016x} b={b:016x} c={c:016x} rm={mode} actual={:08x}/{:02x} expected={:08x}/{:02x}",
                    actual.0, actual.1.0, expected.0, expected.1
                );
            }
        }
    }
    assert_eq!(mismatches, 0);
    eprintln!(
        "FMADD independent literal results={}",
        literals::GOLDENS.len() * 5
    );
}
