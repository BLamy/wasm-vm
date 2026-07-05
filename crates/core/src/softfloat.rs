//! IEEE-754 arithmetic backend (E1-T05).
//!
//! # Why not host `f32`/`f64`
//! RISC-V mandates a canonical NaN payload (`0x7fc0_0000` / `0x7ff8_0000_0000_0000`),
//! five sticky exception flags, and five rounding modes — none of which host float ops
//! expose portably, and whose NaN bit patterns diverge between native and wasm32, breaking
//! the determinism guarantee (E0-T22). So the guest FP datapath uses NO host float
//! arithmetic — this module is `#![deny(clippy::float_arithmetic)]`, a compile-time proof.
//!
//! # Backend decision (see `docs/design/softfloat.md`)
//! Berkeley SoftFloat (C) is reference-quality but cannot compile to
//! `wasm32-unknown-unknown` with the available toolchain; `simple-soft-float` no longer
//! builds on current Rust. `rustc_apfloat` (the LLVM APFloat port) is pure-Rust, `no_std`,
//! builds on both targets, and produces the RISC-V-canonical NaN with correct rounding and
//! flags — but has **no `sqrt`**. So: add/sub/mul/div/fma/compare/convert delegate to
//! `rustc_apfloat`; `sqrt` is a hand-rolled *correctly-rounded* integer-only implementation
//! ([`ieee_sqrt`]) built on [`u128::isqrt`] — exact, deterministic, no host float.
#![deny(clippy::float_arithmetic)]

use rustc_apfloat::ieee::{Double, Single};
use rustc_apfloat::{Float, FloatConvert, Round, Status};

/// RISC-V accrued exception flags (`fflags`), bit-positioned exactly as the CSR:
/// NX=0, UF=1, OF=2, DZ=3, NV=4.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Flags(pub u8);

impl Flags {
    pub const NX: u8 = 0x01; // inexact
    pub const UF: u8 = 0x02; // underflow
    pub const OF: u8 = 0x04; // overflow
    pub const DZ: u8 = 0x08; // divide by zero
    pub const NV: u8 = 0x10; // invalid operation

    pub const NONE: Flags = Flags(0);

    /// Map an apfloat operation status to RISC-V `fflags` bits.
    fn from_status(s: Status) -> Flags {
        let mut f = 0u8;
        if s.contains(Status::INVALID_OP) {
            f |= Self::NV;
        }
        if s.contains(Status::DIV_BY_ZERO) {
            f |= Self::DZ;
        }
        if s.contains(Status::OVERFLOW) {
            f |= Self::OF;
        }
        if s.contains(Status::UNDERFLOW) {
            f |= Self::UF;
        }
        if s.contains(Status::INEXACT) {
            f |= Self::NX;
        }
        Flags(f)
    }
}

/// The five RISC-V rounding modes (`frm` field values 0..=4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoundMode {
    /// 000 — round to nearest, ties to even.
    Rne,
    /// 001 — round toward zero.
    Rtz,
    /// 010 — round down (toward −∞).
    Rdn,
    /// 011 — round up (toward +∞).
    Rup,
    /// 100 — round to nearest, ties to max magnitude (away from zero).
    Rmm,
}

impl RoundMode {
    /// Decode a 3-bit `frm`/instruction `rm` field; `None` for the reserved values
    /// (101, 110 reserved; 111 = "dynamic", resolved against `frm` by the caller).
    pub const fn from_bits(rm: u8) -> Option<RoundMode> {
        match rm {
            0b000 => Some(RoundMode::Rne),
            0b001 => Some(RoundMode::Rtz),
            0b010 => Some(RoundMode::Rdn),
            0b011 => Some(RoundMode::Rup),
            0b100 => Some(RoundMode::Rmm),
            _ => None,
        }
    }

    const fn to_apfloat(self) -> Round {
        match self {
            RoundMode::Rne => Round::NearestTiesToEven,
            RoundMode::Rtz => Round::TowardZero,
            RoundMode::Rdn => Round::TowardNegative,
            RoundMode::Rup => Round::TowardPositive,
            RoundMode::Rmm => Round::NearestTiesToAway,
        }
    }
}

/// One IEEE format's operations. Bits are the raw storage integer (`u32`/`u64`); every op
/// returns the result bits paired with the accrued [`Flags`]. No host float arithmetic is
/// used on any path — the guest FP datapath (E1-T06/T07) is built entirely on this trait.
pub trait SoftFloat {
    /// The raw bit storage type (`u32` for f32, `u64` for f64).
    type Bits: Copy + PartialEq;

    fn add(a: Self::Bits, b: Self::Bits, rm: RoundMode) -> (Self::Bits, Flags);
    fn sub(a: Self::Bits, b: Self::Bits, rm: RoundMode) -> (Self::Bits, Flags);
    fn mul(a: Self::Bits, b: Self::Bits, rm: RoundMode) -> (Self::Bits, Flags);
    fn div(a: Self::Bits, b: Self::Bits, rm: RoundMode) -> (Self::Bits, Flags);
    /// Fused multiply-add: `a * b + c` with a single rounding (no intermediate rounding).
    fn fma(a: Self::Bits, b: Self::Bits, c: Self::Bits, rm: RoundMode) -> (Self::Bits, Flags);
    /// Correctly-rounded square root.
    fn sqrt(a: Self::Bits, rm: RoundMode) -> (Self::Bits, Flags);

    /// FEQ: quiet ordered-equality. Only a signaling NaN input raises NV; qNaN → false.
    fn eq(a: Self::Bits, b: Self::Bits) -> (bool, Flags);
    /// FLT: signaling less-than. Any NaN raises NV and yields false.
    fn lt(a: Self::Bits, b: Self::Bits) -> (bool, Flags);
    /// FLE: signaling less-than-or-equal. Any NaN raises NV and yields false.
    fn le(a: Self::Bits, b: Self::Bits) -> (bool, Flags);

    /// The RISC-V canonical quiet NaN for this format.
    fn canonical_nan() -> Self::Bits;
}

/// Generate the [`SoftFloat`] impl for one format from its apfloat type + geometry.
macro_rules! impl_softfloat {
    ($marker:ident, $ap:ty, $bits:ty, $mant:expr, $exp:expr, $bias:expr) => {
        /// Zero-sized marker selecting this IEEE format.
        pub struct $marker;

        impl $marker {
            #[inline]
            fn of(b: $bits) -> $ap {
                <$ap>::from_bits(b as u128)
            }
            /// Extract result bits, **canonicalizing any NaN** to the RISC-V canonical qNaN.
            /// apfloat (like LLVM) propagates NaN payloads; RISC-V mandates that every
            /// NaN-producing FP op return the single canonical NaN, so we override here.
            #[inline]
            fn bits(f: $ap) -> $bits {
                if f.is_nan() {
                    <$ap>::NAN.to_bits() as $bits
                } else {
                    f.to_bits() as $bits
                }
            }
        }

        impl SoftFloat for $marker {
            type Bits = $bits;

            fn add(a: $bits, b: $bits, rm: RoundMode) -> ($bits, Flags) {
                let r = Float::add_r(Self::of(a), Self::of(b), rm.to_apfloat());
                (Self::bits(r.value), Flags::from_status(r.status))
            }
            fn sub(a: $bits, b: $bits, rm: RoundMode) -> ($bits, Flags) {
                let r = Float::sub_r(Self::of(a), Self::of(b), rm.to_apfloat());
                (Self::bits(r.value), Flags::from_status(r.status))
            }
            fn mul(a: $bits, b: $bits, rm: RoundMode) -> ($bits, Flags) {
                let r = Float::mul_r(Self::of(a), Self::of(b), rm.to_apfloat());
                (Self::bits(r.value), Flags::from_status(r.status))
            }
            fn div(a: $bits, b: $bits, rm: RoundMode) -> ($bits, Flags) {
                let r = Float::div_r(Self::of(a), Self::of(b), rm.to_apfloat());
                (Self::bits(r.value), Flags::from_status(r.status))
            }
            fn fma(a: $bits, b: $bits, c: $bits, rm: RoundMode) -> ($bits, Flags) {
                let r = Float::mul_add_r(Self::of(a), Self::of(b), Self::of(c), rm.to_apfloat());
                (Self::bits(r.value), Flags::from_status(r.status))
            }
            fn sqrt(a: $bits, rm: RoundMode) -> ($bits, Flags) {
                let (bits, f) = ieee_sqrt(a as u128, $mant, $exp, $bias, rm);
                (bits as $bits, f)
            }

            fn eq(a: $bits, b: $bits) -> (bool, Flags) {
                let (x, y) = (Self::of(a), Self::of(b));
                // FEQ is quiet: only a signaling NaN raises NV.
                let nv = x.is_signaling() || y.is_signaling();
                let eq = matches!(x.partial_cmp(&y), Some(core::cmp::Ordering::Equal));
                (eq, if nv { Flags(Flags::NV) } else { Flags::NONE })
            }
            fn lt(a: $bits, b: $bits) -> (bool, Flags) {
                let (x, y) = (Self::of(a), Self::of(b));
                match x.partial_cmp(&y) {
                    Some(core::cmp::Ordering::Less) => (true, Flags::NONE),
                    Some(_) => (false, Flags::NONE),
                    None => (false, Flags(Flags::NV)), // any NaN → NV, false
                }
            }
            fn le(a: $bits, b: $bits) -> (bool, Flags) {
                let (x, y) = (Self::of(a), Self::of(b));
                match x.partial_cmp(&y) {
                    Some(core::cmp::Ordering::Less | core::cmp::Ordering::Equal) => {
                        (true, Flags::NONE)
                    }
                    Some(_) => (false, Flags::NONE),
                    None => (false, Flags(Flags::NV)),
                }
            }

            fn canonical_nan() -> $bits {
                <$ap>::NAN.to_bits() as $bits
            }
        }
    };
}

impl_softfloat!(F32, Single, u32, 23, 8, 127);
impl_softfloat!(F64, Double, u64, 52, 11, 1023);

/// Widen f32 → f64 (exact; never loses info). A NaN result is canonicalized; a signaling
/// NaN input additionally raises NV (RISC-V FCVT.D.S).
pub fn f32_to_f64(bits: u32) -> (u64, Flags) {
    let mut lost = false;
    let src = Single::from_bits(bits as u128);
    let nv = src.is_signaling();
    let r: rustc_apfloat::StatusAnd<Double> = src.convert(&mut lost);
    let mut f = Flags::from_status(r.status);
    if nv {
        f.0 |= Flags::NV;
    }
    let out = if r.value.is_nan() {
        F64::canonical_nan()
    } else {
        r.value.to_bits() as u64
    };
    (out, f)
}

/// Narrow f64 → f32 with rounding and flags; NaN result canonicalized, sNaN raises NV.
pub fn f64_to_f32(bits: u64, rm: RoundMode) -> (u32, Flags) {
    let mut lost = false;
    let src = Double::from_bits(bits as u128);
    let nv = src.is_signaling();
    let r: rustc_apfloat::StatusAnd<Single> = src.convert_r(rm.to_apfloat(), &mut lost);
    let mut f = Flags::from_status(r.status);
    if nv {
        f.0 |= Flags::NV;
    }
    let out = if r.value.is_nan() {
        F32::canonical_nan()
    } else {
        r.value.to_bits() as u32
    };
    (out, f)
}

// ── correctly-rounded integer-only sqrt ─────────────────────────────────────────

/// Bit length (position of the highest set bit, 0 for `v == 0`).
#[inline]
const fn bitlen(v: u128) -> u32 {
    128 - v.leading_zeros()
}

/// Compare `a·2^ea` vs `b·2^eb` for non-negative `a,b` without precision loss.
fn cmp_scaled(a: u128, ea: i32, b: u128, eb: i32) -> core::cmp::Ordering {
    use core::cmp::Ordering::*;
    if a == 0 && b == 0 {
        return Equal;
    }
    if a == 0 {
        return Less;
    }
    if b == 0 {
        return Greater;
    }
    // Bring both to a common exponent = min(ea, eb) by left-shifting the higher one; if a
    // shift would exceed u128, that side is unambiguously larger.
    let lo = ea.min(eb);
    let sa = (ea - lo) as u32;
    let sb = (eb - lo) as u32;
    // Would the shift overflow? (a << sa) fits iff sa + bitlen(a) <= 128.
    let a_of = sa + bitlen(a) > 128;
    let b_of = sb + bitlen(b) > 128;
    match (a_of, b_of) {
        (true, false) => Greater,
        (false, true) => Less,
        (true, true) => {
            // Compare magnitudes by total bit position of the MSB.
            (sa + bitlen(a)).cmp(&(sb + bitlen(b)))
        }
        (false, false) => (a << sa).cmp(&(b << sb)),
    }
}

/// Correctly-rounded IEEE square root, integer-only (no host float). `mant` = fraction
/// bits, `exp` = exponent bits, `bias` = exponent bias. Returns `(result_bits, flags)`.
///
/// Method: decompose `x = m·2^e` (integer significand). Because `sqrt` never under/overflows
/// a normal input (`sqrt(2^-1074) = 2^-537`, still normal), the result is always normal — so
/// only NX (inexact) and NV (invalid: sqrt of a negative) ever fire. Scale `m` by an even
/// shift so `q = isqrt(R)` yields exactly `p = mant+1` significand bits; `q` and `q+1` are
/// the two adjacent candidate floats bracketing the true root, and the correctly-rounded
/// result is chosen by comparing `x` to the candidates' *exact* squares.
fn ieee_sqrt(bits: u128, mant: u32, exp: u32, bias: i32, rm: RoundMode) -> (u128, Flags) {
    let p = mant + 1; // significand precision incl. implicit bit
    let sign = (bits >> (mant + exp)) & 1;
    let exp_mask = (1u128 << exp) - 1;
    let mant_mask = (1u128 << mant) - 1;
    let exp_field = (bits >> mant) & exp_mask;
    let frac = bits & mant_mask;

    let qnan = (exp_mask << mant) | (1u128 << (mant - 1)); // +canonical quiet NaN

    // Specials.
    if exp_field == exp_mask {
        // inf / NaN
        if frac == 0 {
            return if sign == 0 {
                (bits, Flags::NONE) // sqrt(+inf) = +inf
            } else {
                (qnan, Flags(Flags::NV)) // sqrt(-inf) = NaN
            };
        }
        // NaN input → canonical qNaN; a signaling NaN also raises NV.
        let is_snan = (frac >> (mant - 1)) & 1 == 0;
        return (
            qnan,
            if is_snan {
                Flags(Flags::NV)
            } else {
                Flags::NONE
            },
        );
    }
    if exp_field == 0 && frac == 0 {
        return (bits, Flags::NONE); // sqrt(±0) = ±0 (sign preserved)
    }
    if sign == 1 {
        return (qnan, Flags(Flags::NV)); // sqrt(negative) = NaN, NV
    }

    // Positive finite: x = m · 2^e with m an integer significand.
    let (mut m, mut e) = if exp_field == 0 {
        (frac, 1 - bias - mant as i32) // subnormal
    } else {
        (
            (1u128 << mant) | frac,
            exp_field as i32 - bias - mant as i32,
        )
    };
    // Make e even (shift keeps value: m·2^e unchanged).
    if e & 1 != 0 {
        m <<= 1;
        e -= 1;
    }
    // Scale m left by an even amount so the radicand has 2p-1 or 2p bits (→ isqrt has
    // exactly p bits). Parity of the target must match bitlen(m) so the shift stays even.
    let lm = bitlen(m);
    let target = if lm.is_multiple_of(2) {
        2 * p
    } else {
        2 * p - 1
    };
    let s = target - lm; // even, ≥ 0
    let r = m << s;
    let q = r.isqrt(); // floor(sqrt(r)); exactly p bits
    let exact = q * q == r;

    // The floor candidate `lo` has significand q at binary exponent glo = (e - s)/2.
    let glo = (e - s as i32) / 2;

    // Choose significand (q or q+1) per rounding mode, deciding ties by comparing x to the
    // midpoint's exact square. x = m·2^e; mid = (2q+1)·2^(glo-1) → mid² = (2q+1)²·2^(2glo-2).
    let up = if exact {
        false
    } else {
        match rm {
            RoundMode::Rtz | RoundMode::Rdn => false, // x > 0: truncate toward lo
            RoundMode::Rup => true,
            RoundMode::Rne | RoundMode::Rmm => {
                let mid2 = (2 * q + 1) * (2 * q + 1);
                match cmp_scaled(m, e, mid2, 2 * glo - 2) {
                    core::cmp::Ordering::Less => false,
                    core::cmp::Ordering::Greater => true,
                    core::cmp::Ordering::Equal => {
                        // Exact tie (only reachable in principle): RNE → even, RMM → up.
                        match rm {
                            RoundMode::Rmm => true,
                            _ => q & 1 == 1, // ties to even
                        }
                    }
                }
            }
        }
    };

    let mut sig = if up { q + 1 } else { q };
    let mut uexp = glo + (p as i32 - 1); // unbiased exponent (MSB of a p-bit sig at p-1)
    // A round-up carry (q+1 == 2^p) renormalizes to 2^(p-1) with exponent +1.
    if sig >> p != 0 {
        sig >>= 1;
        uexp += 1;
    }

    let biased = (uexp + bias) as u128;
    let out = (sig & mant_mask) | (biased << mant); // sign is +, always normal
    (out, if exact { Flags::NONE } else { Flags(Flags::NX) })
}
