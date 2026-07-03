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

// ── directed-mode ARITHMETIC rounding (RTZ/RDN/RUP/RMM) ──────────────────────────
// The RNE-only assertions above leave the directed-mode `to_apfloat` mapping untested — a
// swapped RDN↔RUP or an RTZ→RNE mapping would ship silently. These lock it down with an
// INDEPENDENT oracle: host float gives the correctly-rounded RNE result, and the exact
// residual (true product/quotient vs the RNE result, computed in u128 integers) tells us
// which of the two adjacent floats is the floor/ceil for the directed modes. Positive
// operands ⇒ positive result, so RDN=RTZ=lo, RUP=hi.

fn decompose_pos_f64(bits: u64) -> (u128, i32) {
    let exp = ((bits >> 52) & 0x7ff) as i32;
    let frac = (bits & ((1u64 << 52) - 1)) as u128;
    if exp == 0 {
        (frac, 1 - 1023 - 52)
    } else {
        ((1u128 << 52) | frac, exp - 1023 - 52)
    }
}

/// Compare `a·2^ea` vs `b·2^eb` for non-negative a,b (exponents are close for our use).
fn cmp_scaled(a: u128, ea: i32, b: u128, eb: i32) -> core::cmp::Ordering {
    use core::cmp::Ordering::*;
    if a == 0 || b == 0 {
        return a.cmp(&b);
    }
    let lo = ea.min(eb);
    let sa = (ea - lo) as u32;
    let sb = (eb - lo) as u32;
    match (a.checked_shl(sa), b.checked_shl(sb)) {
        (Some(x), Some(y)) => x.cmp(&y),
        (None, Some(_)) => Greater,
        (Some(_), None) => Less,
        (None, None) => (sa + (128 - a.leading_zeros())).cmp(&(sb + (128 - b.leading_zeros()))),
    }
}

#[test]
fn mul_div_directed_modes_match_independent_oracle() {
    let mut rng = Rng(0x0705_2026_D1EC_7ED0);
    let mut checked = 0u64;
    for _ in 0..150_000 {
        // Positive normal operands in a mid exponent range (products/quotients stay normal
        // and finite — keeps next_up/next_down a simple ±1 on the bit pattern).
        let mk = |r: u64| -> u64 {
            let frac = r & ((1u64 << 52) - 1);
            let exp = 0x380 + (r >> 55) % 0x100; // exponent field ~[0x380,0x480)
            (exp << 52) | frac
        };
        let a = mk(rng.next());
        let b = mk(rng.next());
        let (sa, ea) = decompose_pos_f64(a);
        let (sb, eb) = decompose_pos_f64(b);

        for op in 0..2 {
            // Host RNE (correctly rounded) is the independent nearest-value oracle.
            let host = if op == 0 {
                f64::from_bits(a) * f64::from_bits(b)
            } else {
                f64::from_bits(a) / f64::from_bits(b)
            };
            if !host.is_normal() || host <= 0.0 {
                continue;
            }
            let rne = host.to_bits();
            let (sr, er) = decompose_pos_f64(rne);
            // Residual sign of the TRUE result vs rne, exact:
            //   mul: true = sa·sb·2^(ea+eb)          vs rne = sr·2^er
            //   div: true>rne ⇔ a > rne·b ⇔ sa·2^ea vs (sr·sb)·2^(er+eb)
            let ord = if op == 0 {
                cmp_scaled(sa * sb, ea + eb, sr, er)
            } else {
                cmp_scaled(sa, ea, sr * sb, er + eb)
            };
            let (lo, hi) = match ord {
                core::cmp::Ordering::Equal => (rne, rne),
                core::cmp::Ordering::Greater => (rne, rne + 1), // true > rne ⇒ rne is floor
                core::cmp::Ordering::Less => (rne - 1, rne),    // true < rne ⇒ rne is ceil
            };
            let f = |rm| {
                if op == 0 {
                    F64::mul(a, b, rm).0
                } else {
                    F64::div(a, b, rm).0
                }
            };
            let name = if op == 0 { "mul" } else { "div" };
            assert_eq!(f(RoundMode::Rne), rne, "{name} RNE {a:#018x},{b:#018x}");
            assert_eq!(f(RoundMode::Rtz), lo, "{name} RTZ {a:#018x},{b:#018x}");
            assert_eq!(
                f(RoundMode::Rdn),
                lo,
                "{name} RDN (toward -inf, +result=floor)"
            );
            assert_eq!(f(RoundMode::Rup), hi, "{name} RUP (toward +inf = ceil)");
            checked += 1;
        }
    }
    assert!(
        checked > 200_000,
        "swept {checked} directed-mode arith cases"
    );
}

#[test]
fn add_and_fma_directed_modes() {
    // 0.1 + 0.2: the exact sum sits between two doubles; RNE rounds UP to ...334, so RTZ/RDN
    // (toward zero / −∞, positive) truncate DOWN to ...333, RUP/RMM = ...334. An RTZ→RNE or
    // RDN↔RUP mapping bug flips these. Values independently known (the classic case).
    let a = 0.1f64.to_bits();
    let b = 0.2f64.to_bits();
    assert_eq!(F64::add(a, b, RoundMode::Rne).0, 0x3fd3_3333_3333_3334);
    assert_eq!(
        F64::add(a, b, RoundMode::Rtz).0,
        0x3fd3_3333_3333_3333,
        "RTZ down"
    );
    assert_eq!(
        F64::add(a, b, RoundMode::Rdn).0,
        0x3fd3_3333_3333_3333,
        "RDN floor"
    );
    assert_eq!(
        F64::add(a, b, RoundMode::Rup).0,
        0x3fd3_3333_3333_3334,
        "RUP ceil"
    );
    assert_eq!(
        F64::add(a, b, RoundMode::Rmm).0,
        0x3fd3_3333_3333_3334,
        "RMM nearest"
    );

    // 1.0/3.0 lies just above the RNE result ...555, so RUP = ...556, RTZ/RDN = ...555.
    let (one, three) = (1.0f64.to_bits(), 3.0f64.to_bits());
    assert_eq!(
        F64::div(one, three, RoundMode::Rup).0,
        0x3fd5_5555_5555_5556,
        "1/3 RUP up"
    );
    assert_eq!(
        F64::div(one, three, RoundMode::Rtz).0,
        0x3fd5_5555_5555_5555,
        "1/3 RTZ trunc"
    );

    // fma must also honor the rounding mode on an inexact fused result.
    let third = 0x3fd5_5555_5555_5555u64; // < 1/3
    let seven = 7.0f64.to_bits();
    let zero = 0.0f64.to_bits();
    let ftz = F64::fma(third, seven, zero, RoundMode::Rtz).0;
    let fup = F64::fma(third, seven, zero, RoundMode::Rup).0;
    assert!(ftz <= fup, "fma RTZ ≤ RUP on a positive inexact result");
    assert_ne!(ftz, fup, "fma honors the rounding mode (RTZ ≠ RUP here)");

    // Exact HALFWAY tie to pin RMM (ties-away) vs RNE (ties-even) — the one mapping the
    // directed sweeps can't reach (they hit no ties). 1.0 + 2^-53 sits exactly between 1.0
    // (even mantissa) and 1.0 + 2^-52. RNE → 1.0; RMM → 1.0 + 2^-52 (away from zero).
    let half_ulp = 2.0f64.powi(-53).to_bits(); // 2^-53
    let one_b = 1.0f64.to_bits();
    assert_eq!(
        F64::add(one_b, half_ulp, RoundMode::Rne).0,
        one_b,
        "tie → even (1.0)"
    );
    assert_eq!(
        F64::add(one_b, half_ulp, RoundMode::Rmm).0,
        one_b + 1, // 1.0 + 2^-52
        "tie → away (RMM) distinguishes it from RNE"
    );
}
