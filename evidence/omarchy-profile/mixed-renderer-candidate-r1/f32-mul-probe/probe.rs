use std::hint::black_box;
use std::time::Instant;

use wasm_vm_core::softfloat::{F32, Flags, RoundMode, SoftFloat};

fn normal(bits: u32) -> bool {
    let exp = (bits >> 23) & 0xff;
    exp != 0 && exp != 0xff
}

fn round_product(product: u64, shift: u32) -> (u64, bool) {
    let remainder = product & ((1u64 << shift) - 1);
    let halfway = 1u64 << (shift - 1);
    let mut significand = product >> shift;
    if remainder > halfway || (remainder == halfway && (significand & 1) != 0) {
        significand += 1;
    }
    (significand, remainder != 0)
}

// Diagnostic candidate only: normal finite inputs, normal result, RNE only.
fn normal_rne_mul(a: u32, b: u32) -> Option<(u32, Flags)> {
    if !normal(a) || !normal(b) {
        return None;
    }
    let ea = ((a >> 23) & 0xff) as i32 - 127;
    let eb = ((b >> 23) & 0xff) as i32 - 127;
    let ma = u64::from((a & 0x7f_ffff) | 0x80_0000);
    let mb = u64::from((b & 0x7f_ffff) | 0x80_0000);
    let product = ma * mb;
    let high = (product >> 47) != 0;
    let shift = if high { 24 } else { 23 };
    let mut exponent = ea + eb + if high { 1 } else { 0 };
    if !(-126..=127).contains(&exponent) {
        return None;
    }
    let remainder = product & ((1u64 << shift) - 1);
    let (mut significand, _) = round_product(product, shift);
    if significand == 1u64 << 24 {
        significand = 1u64 << 23;
        exponent += 1;
    }
    if !(-126..=127).contains(&exponent) {
        return None;
    }
    let sign = (a ^ b) & 0x8000_0000;
    let bits = sign | (((exponent + 127) as u32) << 23) | (significand as u32 & 0x7f_ffff);
    Some((bits, if remainder == 0 { Flags::NONE } else { Flags(Flags::NX) }))
}

fn reference(a: u32, b: u32) -> (u32, Flags) {
    F32::mul(a, b, RoundMode::Rne)
}

fn find_tie(want_odd: bool) -> (u32, u32) {
    let ma = 0xC0_0000u32;
    for mb in (0x80_0001u32..=0x80_0fff).step_by(2) {
        let product = u64::from(ma) * u64::from(mb);
        let q = product >> 23;
        if product & ((1 << 23) - 1) == 1 << 22 && (q & 1 != 0) == want_odd {
            return ((127u32 << 23) | (ma & 0x7f_ffff), (127u32 << 23) | (mb & 0x7f_ffff));
        }
    }
    panic!("directed tie case not found");
}

fn main() {
    let (tie_even_a, tie_even_b) = find_tie(false);
    let (tie_odd_a, tie_odd_b) = find_tie(true);
    let carry_a = (126u32 << 23) | 0x7f_ffff;
    let carry_b = 127u32 << 23;
    for (a, b, label) in [
        (tie_even_a, tie_even_b, "tie-even"),
        (tie_odd_a, tie_odd_b, "tie-odd"),
        (carry_a, carry_b, "carry"),
        (carry_a | 0x8000_0000, carry_b, "negative-sign"),
    ] {
        let candidate = normal_rne_mul(a, b).expect(label);
        assert_eq!(candidate, reference(a, b), "{label}: {a:08x} × {b:08x}");
        if label.starts_with("tie") {
            assert_ne!(candidate.1 .0 & Flags::NX, 0);
        }
        println!("directed {label}: {a:08x} × {b:08x} -> {:08x} flags={:02x}", candidate.0, candidate.1 .0);
    }
    let (synthetic_carry, synthetic_nx) = round_product((1u64 << 47) - 1, 23);
    assert_eq!(synthetic_carry, 1u64 << 24);
    assert!(synthetic_nx);
    println!("synthetic carry: rounded_significand={synthetic_carry:08x} nx={synthetic_nx}");

    let mut seed = 0x9e37_79b9u32;
    let mut fast = 0u32;
    for _ in 0..100_000 {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        let a = (seed & 0x807f_ffff) | (((seed >> 23) % 254 + 1) << 23);
        seed = seed.rotate_left(11);
        let b = (seed & 0x807f_ffff) | (((seed >> 23) % 254 + 1) << 23);
        if let Some(actual) = normal_rne_mul(a, b) {
            assert_eq!(actual, reference(a, b), "seeded mismatch {a:08x} × {b:08x}");
            fast += 1;
        }
    }
    println!("differential: checked=100000 fast_normal_results={fast} mismatches=0");

    let mut acc = 0u32;
    let start = Instant::now();
    for i in 0..2_000_000u32 {
        let a = 0x3f00_0000 | (i & 0x00ff_ffff);
        let b = 0x3f80_0000 | ((i.wrapping_mul(17)) & 0x007f_ffff);
        if let Some((bits, _)) = normal_rne_mul(black_box(a), black_box(b)) { acc ^= bits; }
    }
    let candidate_elapsed = start.elapsed();
    let start = Instant::now();
    for i in 0..2_000_000u32 {
        let a = 0x3f00_0000 | (i & 0x00ff_ffff);
        let b = 0x3f80_0000 | ((i.wrapping_mul(17)) & 0x007f_ffff);
        acc ^= reference(black_box(a), black_box(b)).0;
    }
    let reference_elapsed = start.elapsed();
    black_box(acc);
    println!("benchmark: iterations=2000000 candidate_ns={candidate_elapsed:?} reference_ns={reference_elapsed:?} sink={acc:08x}");
}
