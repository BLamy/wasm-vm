use wasm_vm_core::softfloat::{F32, Flags, RoundMode, SoftFloat};

#[test]
fn single_add_mul_finite_overflow_and_threshold_flags() {
    let modes = [
        RoundMode::Rne,
        RoundMode::Rtz,
        RoundMode::Rdn,
        RoundMode::Rup,
        RoundMode::Rmm,
    ];
    let mut cases = 0;
    for (i, mode) in modes.into_iter().enumerate() {
        for negative in [false, true] {
            let sign = if negative { 0x8000_0000 } else { 0 };
            let expected = if i == 1 || i == (if negative { 3 } else { 2 }) {
                0x7f7f_ffff | sign
            } else {
                0x7f80_0000 | sign
            };
            assert_eq!(
                F32::mul(0x7f7f_ffff | sign, 0x4000_0000, mode),
                (expected, Flags(5))
            );
            assert_eq!(
                F32::add(0x7f7f_ffff | sign, 0x7f7f_ffff | sign, mode),
                (expected, Flags(5))
            );
            cases += 2;
        }
        // max finite + 2^103 is halfway toward 2^128. Directed truncation
        // must remain NX only; merely seeing an inexact maximum is not overflow.
        let (bits, flags) = if [0, 3, 4].contains(&i) {
            (0x7f80_0000, 5)
        } else {
            (0x7f7f_ffff, 1)
        };
        assert_eq!(
            F32::add(0x7f7f_ffff, 0x7300_0000, mode),
            (bits, Flags(flags))
        );
        // Largest single value below 2^104 leaves the sum just below 2^128.
        assert_eq!(
            F32::add(0x7f7f_ffff, 0x737f_ffff, RoundMode::Rtz),
            (0x7f7f_ffff, Flags(1))
        );
        assert_eq!(
            F32::add(0x7f7f_ffff, 0x7380_0000, RoundMode::Rtz),
            (0x7f7f_ffff, Flags(5))
        );
        assert_eq!(
            F32::mul(0x7f7f_ffff, 0x3f80_0000, mode),
            (0x7f7f_ffff, Flags(0))
        );
        // Tininess is tested after rounding: a rounded minimum normal has NX
        // without UF, whereas an inexact subnormal has both.
        let (tiny, flags) = if [0, 3, 4].contains(&i) {
            (0x0080_0000, 1)
        } else {
            (0x007f_ffff, 3)
        };
        assert_eq!(
            F32::mul(0x0080_0000, 0x3f7f_ffff, mode),
            (tiny, Flags(flags))
        );
        cases += 5;
    }
    assert_eq!(cases, 45);
    eprintln!("FP_ARITH backend literal overflow/threshold/tininess cases={cases}");
}
