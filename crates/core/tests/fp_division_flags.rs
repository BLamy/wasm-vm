use wasm_vm_core::softfloat::{F32, RoundMode, SoftFloat};

#[test]
fn division_literal_boundary_flags() {
    let cases: &[(u32, u32, [u32; 5], [u8; 5])] = &[
        (
            0x00ffffff,
            0x40000000,
            [0x00800000, 0x007fffff, 0x007fffff, 0x00800000, 0x00800000],
            [3, 3, 3, 3, 3],
        ),
        (
            0x80ffffff,
            0x40000000,
            [0x80800000, 0x807fffff, 0x80800000, 0x807fffff, 0x80800000],
            [3, 3, 3, 3, 3],
        ),
        (
            0x7f7fffff,
            0x3f000000,
            [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
            [5, 5, 5, 5, 5],
        ),
        (
            0xff7fffff,
            0x3f000000,
            [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
            [5, 5, 5, 5, 5],
        ),
        (
            0x7f7fffff,
            0x3f7fffff,
            [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
            [5, 5, 5, 5, 5],
        ),
        (
            0xff7fffff,
            0x3f7fffff,
            [0xff800000, 0xff7fffff, 0xff800000, 0xff7fffff, 0xff800000],
            [5, 5, 5, 5, 5],
        ),
        (
            0x7f7ffffe,
            0x3f7fffff,
            [0x7f7fffff, 0x7f7ffffe, 0x7f7ffffe, 0x7f7fffff, 0x7f7fffff],
            [1, 1, 1, 1, 1],
        ),
        (
            0xff7ffffe,
            0x3f7fffff,
            [0xff7fffff, 0xff7ffffe, 0xff7fffff, 0xff7ffffe, 0xff7fffff],
            [1, 1, 1, 1, 1],
        ),
        (
            0x7f7fffff,
            0x00000001,
            [0x7f800000, 0x7f7fffff, 0x7f7fffff, 0x7f800000, 0x7f800000],
            [5, 5, 5, 5, 5],
        ),
        (
            0x00000001,
            0x34000001,
            [0x007fffff, 0x007fffff, 0x007fffff, 0x00800000, 0x007fffff],
            [3, 3, 3, 3, 3],
        ),
    ];
    let mut failures = 0;
    for &(a, b, bits, flags) in cases {
        for mode in 0..5 {
            let actual = F32::div(a, b, RoundMode::from_bits(mode as u8).unwrap());
            if actual != (bits[mode], wasm_vm_core::softfloat::Flags(flags[mode])) {
                failures += 1;
                eprintln!(
                    "DIVISION_FLAG_MISMATCH a={a:08x} b={b:08x} rm={mode} actual={:08x}/{:02x} expected={:08x}/{:02x}",
                    actual.0, actual.1.0, bits[mode], flags[mode]
                );
            }
        }
    }
    assert_eq!(failures, 0, "independent literal division boundary flags");
}
