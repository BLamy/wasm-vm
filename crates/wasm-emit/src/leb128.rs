//! LEB128 — the variable-length integer encoding the WASM binary format uses for *every* count,
//! index, size prefix, and integer immediate (Core Spec §5.2.2). Everything else in this crate is
//! built on these four functions, so they are the correctness foundation: a single off-by-one in the
//! continuation-bit logic silently corrupts every module. Two facts drive the code below:
//!
//! * **Unsigned** (`u32`/`u64`) uses plain base-128: 7 payload bits per byte, high bit = "more".
//! * **Signed** (`i32`/`i64`, and the signed-33 blocktype) uses two's-complement with *sign
//!   extension*: the terminating byte's bit 6 must equal the sign, otherwise the decoder would
//!   sign-extend the wrong way. This is the classic edge case (`i32::MIN`, `-1`, `+64`) the golden
//!   tests in `tests/` pin.
//!
//! The spec also *requires minimal* (canonical) encodings for the length-prefix positions and
//! forbids over-long encodings for LEB immediates in a validated module; the loops below always
//! produce the minimal form (they stop as soon as the remaining value is all-sign), which the
//! `minimality` property test asserts.

use alloc::vec::Vec;

/// Encode `v` as unsigned LEB128 (u32) into `out`. Minimal-length by construction.
#[inline]
pub fn write_u32(out: &mut Vec<u8>, v: u32) {
    write_u64(out, v as u64);
}

/// Encode `v` as unsigned LEB128 (u64) into `out`. Minimal-length by construction.
#[inline]
pub fn write_u64(out: &mut Vec<u8>, mut v: u64) {
    loop {
        let mut byte = (v as u8) & 0x7f;
        v >>= 7;
        if v != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if v == 0 {
            break;
        }
    }
}

/// Encode `v` as signed LEB128 (i32) into `out`. Uses two's-complement sign extension.
#[inline]
pub fn write_i32(out: &mut Vec<u8>, v: i32) {
    write_i64(out, v as i64);
}

/// Encode `v` as signed LEB128 (i64) into `out`. Uses two's-complement sign extension; the
/// terminating byte's bit 6 carries the sign so decoders extend correctly. Minimal-length.
#[inline]
pub fn write_i64(out: &mut Vec<u8>, mut v: i64) {
    loop {
        let byte = (v as u8) & 0x7f;
        // Arithmetic shift keeps the sign bits streaming in for negative values.
        v >>= 7;
        let sign_bit_set = byte & 0x40 != 0;
        // Done when the remaining value is all-sign AND the sign we just emitted matches it.
        let done = (v == 0 && !sign_bit_set) || (v == -1 && sign_bit_set);
        if done {
            out.push(byte);
            break;
        } else {
            out.push(byte | 0x80);
        }
    }
}
