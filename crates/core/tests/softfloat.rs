//! E1-T05: validate the softfloat backend. The `SoftFloat` module itself uses NO host
//! float arithmetic; this TEST is free to use host `f64`/`f32` as an independent oracle —
//! host hardware sqrt is IEEE correctly-rounded (round-to-nearest-ties-even), and IEEE
//! sqrt provably never lands on a rounding tie, so RNE and RMM must both equal it. Directed
//! rounding modes are checked by deriving the expected floor/ceil float from an EXACT
//! integer `r²` vs `x` comparison (no host float in the decision).
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::softfloat::{F32, F64, Flags, RoundMode, SoftFloat};

const RNE: RoundMode = RoundMode::Rne;

// ── apfloat-backed ops: reference vectors + NaN handling ─────────────────────────

#[test]
fn basic_ops_reference_vectors() {
    // 1.0 + 2.0 = 3.0
    let one = 1.0f64.to_bits();
    let two = 2.0f64.to_bits();
    assert_eq!(F64::add(one, two, RNE).0, 3.0f64.to_bits());
    // 2.0 * 3.0 = 6.0 ; 1.0 / 4.0 = 0.25
    assert_eq!(F64::mul(two, 3.0f64.to_bits(), RNE).0, 6.0f64.to_bits());
    assert_eq!(F64::div(one, 4.0f64.to_bits(), RNE).0, 0.25f64.to_bits());
    // 0.1 + 0.2 is inexact (the canonical example) and flags NX.
    let (_, f) = F64::add(0.1f64.to_bits(), 0.2f64.to_bits(), RNE);
    assert_eq!(f.0 & Flags::NX, Flags::NX, "0.1+0.2 is inexact");
    // 1.0 / 0.0 = +inf and raises DZ.
    let (q, f) = F64::div(one, 0.0f64.to_bits(), RNE);
    assert_eq!(q, f64::INFINITY.to_bits());
    assert_eq!(f.0 & Flags::DZ, Flags::DZ);
}

#[test]
fn canonical_nan_and_snan_signaling() {
    assert_eq!(F64::canonical_nan(), 0x7ff8_0000_0000_0000);
    assert_eq!(F32::canonical_nan(), 0x7fc0_0000);
    // A signaling NaN operand → canonical qNaN result + NV.
    let snan = 0x7ff0_0000_0000_0001u64; // exp all-ones, top frac bit 0, payload nonzero
    let (r, f) = F64::add(snan, 1.0f64.to_bits(), RNE);
    assert_eq!(r, F64::canonical_nan(), "NaN result is canonicalized");
    assert_eq!(f.0 & Flags::NV, Flags::NV, "sNaN raises NV");
    // A quiet NaN input → canonical result, NO NV.
    let qnan = 0x7ff8_0000_0000_0007u64;
    let (r, f) = F64::mul(qnan, 2.0f64.to_bits(), RNE);
    assert_eq!(r, F64::canonical_nan());
    assert_eq!(f.0 & Flags::NV, 0, "qNaN does not raise NV in mul");
}

#[test]
fn fma_is_truly_fused_not_double_rounded() {
    // Witness: a = 1 + 2^-52, so the EXACT product a*a = 1 + 2^-51 + 2^-104 (106 bits).
    // With c = -(1 + 2^-51): the exact fused sum a*a + c = 2^-104 — a single power of two,
    // exactly representable. A double-rounded chain instead computes round(a*a) = 1 + 2^-51
    // (the 2^-104 term lost), then + c = 0. So fused = 2^-104 while double-rounded = 0.
    let a = f64::from_bits(0x3ff0_0000_0000_0001); // 1 + 2^-52
    let ab = a.to_bits();
    let c = -(1.0f64 + 2.0f64.powi(-51));
    let fused = F64::fma(ab, ab, c.to_bits(), RNE).0;
    assert_eq!(
        fused,
        2.0f64.powi(-104).to_bits(),
        "fused a*a+c keeps the 2^-104 term"
    );
    // The double-rounded path drops it → 0.
    let (mrnd, _) = F64::mul(ab, ab, RNE); // rounds to 1 + 2^-51
    let dbl = F64::add(mrnd, c.to_bits(), RNE).0; // = 0
    assert_eq!(dbl, 0.0f64.to_bits(), "double-rounded path collapses to 0");
    assert_ne!(fused, dbl, "fused differs from double-rounded");
}

#[test]
fn compares_signaling_vs_quiet() {
    let nan = F64::canonical_nan();
    let one = 1.0f64.to_bits();
    // FEQ is quiet: qNaN vs 1.0 → false, no NV.
    assert_eq!(F64::eq(nan, one), (false, Flags::NONE));
    // FLT/FLE signal on any NaN.
    assert_eq!(F64::lt(nan, one).1.0 & Flags::NV, Flags::NV);
    assert_eq!(F64::le(one, nan).1.0 & Flags::NV, Flags::NV);
    assert_eq!(F64::lt(one, 2.0f64.to_bits()), (true, Flags::NONE));
    assert_eq!(F64::eq(one, one), (true, Flags::NONE));
}

// ── sqrt: specials ───────────────────────────────────────────────────────────────

#[test]
fn sqrt_specials() {
    assert_eq!(
        F64::sqrt(0.0f64.to_bits(), RNE),
        (0.0f64.to_bits(), Flags::NONE)
    );
    assert_eq!(
        F64::sqrt((-0.0f64).to_bits(), RNE),
        ((-0.0f64).to_bits(), Flags::NONE),
        "sqrt(-0) = -0"
    );
    assert_eq!(
        F64::sqrt(f64::INFINITY.to_bits(), RNE),
        (f64::INFINITY.to_bits(), Flags::NONE)
    );
    // sqrt(negative) = canonical NaN + NV.
    let (r, f) = F64::sqrt((-4.0f64).to_bits(), RNE);
    assert_eq!(r, F64::canonical_nan());
    assert_eq!(f.0, Flags::NV);
    // sqrt(-inf) = NaN + NV.
    assert_eq!(F64::sqrt(f64::NEG_INFINITY.to_bits(), RNE).1.0, Flags::NV);
    // sqrt(qNaN) canonical, no NV; sqrt(sNaN) canonical + NV.
    assert_eq!(
        F64::sqrt(F64::canonical_nan(), RNE),
        (F64::canonical_nan(), Flags::NONE)
    );
    assert_eq!(
        F64::sqrt(0x7ff0_0000_0000_0001, RNE),
        (F64::canonical_nan(), Flags(Flags::NV))
    );
}

#[test]
fn sqrt_perfect_squares_are_exact() {
    // Values whose square is EXACTLY representable (so sqrt is exact).
    for v in [1.0f64, 4.0, 9.0, 16.0, 2.25, 6.25, 0.25, 1024.0, 0.0625] {
        let sq = v * v;
        assert_eq!(sq.sqrt(), v, "test premise: {v}² is exact");
        let (r, f) = F64::sqrt(sq.to_bits(), RNE);
        assert_eq!(r, v.to_bits(), "sqrt({sq}) exact");
        assert_eq!(f.0, 0, "perfect square is not inexact");
    }
    // Irrational sqrt raises NX.
    assert_eq!(F64::sqrt(2.0f64.to_bits(), RNE).1.0 & Flags::NX, Flags::NX);
}

// ── sqrt: correctness vs oracles over a random sweep ─────────────────────────────

/// Deterministic LCG over u64 (same generator style as the decode fuzz tests).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0
    }
}

/// Exact comparison of `r² * 2^0` (r a positive finite f64) against x, both as integer·2^exp.
/// Returns Ordering of r² vs x. Uses only integer arithmetic.
fn sq_cmp_f64(rbits: u64, xbits: u64) -> core::cmp::Ordering {
    fn decompose(bits: u64) -> (u128, i32) {
        let exp = ((bits >> 52) & 0x7ff) as i32;
        let frac = (bits & ((1 << 52) - 1)) as u128;
        if exp == 0 {
            (frac, 1 - 1023 - 52)
        } else {
            ((1u128 << 52) | frac, exp - 1023 - 52)
        }
    }
    let (mr, er) = decompose(rbits);
    let (mx, ex) = decompose(xbits);
    // r² = mr² · 2^(2er). Compare mr²·2^(2er) vs mx·2^ex.
    let sq = mr * mr; // ≤ 2^106
    let (a, ea, b, eb) = (sq, 2 * er, mx, ex);
    let lo = ea.min(eb);
    let sa = (ea - lo) as u32;
    let sb = (eb - lo) as u32;
    // exponents are close (r≈sqrt(x)); shifts stay small, but guard anyway.
    let av = a.checked_shl(sa).map(|v| (v, false)).unwrap_or((a, true));
    let bv = b.checked_shl(sb).map(|v| (v, false)).unwrap_or((b, true));
    match (av.1, bv.1) {
        (true, false) => core::cmp::Ordering::Greater,
        (false, true) => core::cmp::Ordering::Less,
        _ => av.0.cmp(&bv.0),
    }
}

fn next_up_f64(bits: u64) -> u64 {
    bits + 1 // for positive finite normals, next representable up
}
fn next_down_f64(bits: u64) -> u64 {
    bits - 1
}

#[test]
fn sqrt_f64_matches_host_and_directed_modes_bracket() {
    let mut rng = Rng(0x5EED_2026_0705_1234);
    let mut checked = 0u64;
    for _ in 0..300_000 {
        let raw = rng.next();
        // Positive finite: clear sign, avoid exp all-ones (inf/nan).
        let mut x = raw & 0x7fff_ffff_ffff_ffff;
        if (x >> 52) & 0x7ff == 0x7ff {
            x &= 0x7fee_ffff_ffff_ffff; // knock exponent below all-ones
        }
        if x == 0 {
            continue;
        }
        checked += 1;

        // RNE and RMM must equal the host's correctly-rounded sqrt.
        let host = f64::from_bits(x).sqrt().to_bits();
        let (rne, frne) = F64::sqrt(x, RoundMode::Rne);
        let (rmm, _) = F64::sqrt(x, RoundMode::Rmm);
        assert_eq!(rne, host, "RNE sqrt of {x:#018x} != host");
        assert_eq!(
            rmm, host,
            "RMM sqrt of {x:#018x} != host (sqrt has no ties)"
        );

        // Derive floor(lo)/ceil(hi) from an exact r²-vs-x comparison at the host result.
        let ord = sq_cmp_f64(host, x);
        let (lo, hi, exact) = match ord {
            core::cmp::Ordering::Equal => (host, host, true),
            core::cmp::Ordering::Less => (host, next_up_f64(host), false), // host² < x → host is floor
            core::cmp::Ordering::Greater => (next_down_f64(host), host, false), // host² > x → host is ceil
        };
        // NX flag: set iff inexact.
        assert_eq!(
            (frne.0 & Flags::NX != 0),
            !exact,
            "NX flag mismatch at {x:#018x}"
        );
        // Directed modes.
        let rtz = F64::sqrt(x, RoundMode::Rtz).0;
        let rdn = F64::sqrt(x, RoundMode::Rdn).0;
        let rup = F64::sqrt(x, RoundMode::Rup).0;
        assert_eq!(rtz, lo, "RTZ sqrt of {x:#018x}");
        assert_eq!(rdn, lo, "RDN sqrt of {x:#018x} (x>0 ⇒ toward -inf = floor)");
        assert_eq!(rup, hi, "RUP sqrt of {x:#018x}");
    }
    assert!(checked > 250_000, "sanity: swept {checked} values");
}

#[test]
fn sqrt_f32_matches_host_rne() {
    let mut rng = Rng(0xABCD_2026_0705_9999);
    for _ in 0..300_000 {
        let mut x = (rng.next() as u32) & 0x7fff_ffff;
        if (x >> 23) & 0xff == 0xff {
            x &= 0x7f6f_ffff;
        }
        if x == 0 {
            continue;
        }
        let host = f32::from_bits(x).sqrt().to_bits();
        assert_eq!(
            F32::sqrt(x, RoundMode::Rne).0,
            host,
            "f32 RNE sqrt of {x:#010x}"
        );
        assert_eq!(
            F32::sqrt(x, RoundMode::Rmm).0,
            host,
            "f32 RMM sqrt of {x:#010x}"
        );
    }
}

#[test]
fn sqrt_subnormals_and_tiny() {
    // Smallest subnormal and a range of tiny values — result is always normal.
    for x in [
        1u64,
        2,
        3,
        0x000f_ffff_ffff_ffff,
        0x0010_0000_0000_0000,
        0x0000_0000_0000_00FF,
    ] {
        let host = f64::from_bits(x).sqrt().to_bits();
        assert_eq!(
            F64::sqrt(x, RoundMode::Rne).0,
            host,
            "sqrt subnormal {x:#018x}"
        );
    }
}
