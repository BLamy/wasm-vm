//! LEB128 correctness: hand-computed golden bytes for the edge/boundary values (0, 127, 128,
//! i32::MIN, u64::MAX, the signed sign-boundary at ±64), property-based round-trip against an
//! independent reference decoder, and a *minimality* check — the spec forbids over-long encodings,
//! so the encoder must always produce the shortest form.

use proptest::prelude::*;
use wasm_emit::leb128;

// ---- independent reference decoders (NOT the encoder's inverse copy-pasted) ----

fn decode_u64(bytes: &[u8]) -> (u64, usize) {
    let mut result: u64 = 0;
    let mut shift = 0;
    for (i, &b) in bytes.iter().enumerate() {
        result |= ((b & 0x7f) as u64) << shift;
        if b & 0x80 == 0 {
            return (result, i + 1);
        }
        shift += 7;
    }
    panic!("truncated uleb");
}

fn decode_i64(bytes: &[u8]) -> (i64, usize) {
    let mut result: i64 = 0;
    let mut shift = 0u32;
    for (i, &b) in bytes.iter().enumerate() {
        result |= ((b & 0x7f) as i64) << shift;
        shift += 7;
        if b & 0x80 == 0 {
            // sign-extend if the sign bit (0x40) of the last byte is set and there is room
            if shift < 64 && (b & 0x40) != 0 {
                result |= -1i64 << shift;
            }
            return (result, i + 1);
        }
    }
    panic!("truncated sleb");
}

#[test]
fn golden_unsigned() {
    let cases: &[(u64, &[u8])] = &[
        (0, &[0x00]),
        (1, &[0x01]),
        (127, &[0x7f]),
        (128, &[0x80, 0x01]),
        (255, &[0xff, 0x01]),
        (16384, &[0x80, 0x80, 0x01]),
        (u32::MAX as u64, &[0xff, 0xff, 0xff, 0xff, 0x0f]),
        (
            u64::MAX,
            &[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01],
        ),
    ];
    for (v, expected) in cases {
        let mut buf = Vec::new();
        leb128::write_u64(&mut buf, *v);
        assert_eq!(&buf[..], *expected, "u64 {v} encoded wrong");
    }
}

#[test]
fn golden_signed() {
    let cases: &[(i64, &[u8])] = &[
        (0, &[0x00]),
        (1, &[0x01]),
        (-1, &[0x7f]),
        (63, &[0x3f]),
        (64, &[0xc0, 0x00]), // sign-boundary: +64 needs a trailing 0 byte
        (-64, &[0x40]),      // -64 fits in one byte (bit6 = sign)
        (-65, &[0xbf, 0x7f]),
        (127, &[0xff, 0x00]),
        (-128, &[0x80, 0x7f]),
        (i32::MIN as i64, &[0x80, 0x80, 0x80, 0x80, 0x78]),
        (
            i64::MIN,
            &[0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x7f],
        ),
        (
            i64::MAX,
            &[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00],
        ),
    ];
    for (v, expected) in cases {
        let mut buf = Vec::new();
        leb128::write_i64(&mut buf, *v);
        assert_eq!(&buf[..], *expected, "i64 {v} encoded wrong");
    }
}

// Minimality: the encoded length must be the shortest possible (no redundant 0x80/0xff run).
fn is_minimal_unsigned(bytes: &[u8]) -> bool {
    // last byte must be nonzero unless the whole value is a single 0x00
    bytes.len() == 1 || *bytes.last().unwrap() != 0x00
}
fn is_minimal_signed(bytes: &[u8]) -> bool {
    if bytes.len() == 1 {
        return true;
    }
    let last = *bytes.last().unwrap();
    let prev = bytes[bytes.len() - 2];
    // last byte is redundant if it just sign-extends the previous byte's sign bit
    let prev_sign = prev & 0x40 != 0;
    !((last == 0x00 && !prev_sign) || (last == 0x7f && prev_sign))
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(20_000))]

    #[test]
    fn roundtrip_u32(v: u32) {
        let mut buf = Vec::new();
        leb128::write_u32(&mut buf, v);
        let (d, n) = decode_u64(&buf);
        prop_assert_eq!(d, v as u64);
        prop_assert_eq!(n, buf.len());
        prop_assert!(is_minimal_unsigned(&buf));
    }

    #[test]
    fn roundtrip_u64(v: u64) {
        let mut buf = Vec::new();
        leb128::write_u64(&mut buf, v);
        let (d, n) = decode_u64(&buf);
        prop_assert_eq!(d, v);
        prop_assert_eq!(n, buf.len());
        prop_assert!(is_minimal_unsigned(&buf));
    }

    #[test]
    fn roundtrip_i32(v: i32) {
        let mut buf = Vec::new();
        leb128::write_i32(&mut buf, v);
        let (d, n) = decode_i64(&buf);
        prop_assert_eq!(d, v as i64);
        prop_assert_eq!(n, buf.len());
        prop_assert!(is_minimal_signed(&buf));
    }

    #[test]
    fn roundtrip_i64(v: i64) {
        let mut buf = Vec::new();
        leb128::write_i64(&mut buf, v);
        let (d, n) = decode_i64(&buf);
        prop_assert_eq!(d, v);
        prop_assert_eq!(n, buf.len());
        prop_assert!(is_minimal_signed(&buf));
    }
}

// Exhaustive-ish boundary sweep near every 7-bit shift boundary for both signednesses.
#[test]
fn boundary_sweep() {
    for shift in 0..64 {
        for delta in -2i64..=2 {
            let base = 1i64 << shift;
            let v = base.wrapping_add(delta);
            let mut buf = Vec::new();
            leb128::write_i64(&mut buf, v);
            assert_eq!(
                decode_i64(&buf).0,
                v,
                "signed boundary at 2^{shift}{delta:+}"
            );
            if v >= 0 {
                let mut ub = Vec::new();
                leb128::write_u64(&mut ub, v as u64);
                assert_eq!(
                    decode_u64(&ub).0,
                    v as u64,
                    "unsigned boundary at 2^{shift}{delta:+}"
                );
            }
        }
    }
}
