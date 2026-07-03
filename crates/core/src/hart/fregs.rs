//! Floating-point register file (E1-T06): 32 × 64-bit `f` registers with **NaN-boxing** of
//! narrower (32-bit) values.
//!
//! Unprivileged ISA §11.3 (NaN boxing): when FLEN > 32, a 32-bit value held in an f-register
//! is stored as `{ all-ones upper bits, the 32-bit value }`. Any single-precision *operand*
//! whose upper 32 bits are not all-ones is **not** a valid boxed f32 and must be treated as
//! the canonical single-precision qNaN (`0x7fc0_0000`). Writing an f32 result boxes it.
//!
//! Unlike `x0`, `f0` is an ordinary register (no hardwired zero).

/// The canonical single-precision quiet NaN (RISC-V).
pub const CANONICAL_NAN_F32: u32 = 0x7fc0_0000;

/// The 32 FLEN=64 floating-point registers.
#[derive(Clone, PartialEq, Eq, Default)]
pub struct FRegs {
    f: [u64; 32],
}

impl FRegs {
    /// Raw 64-bit read (the stored bit pattern) — used by FLD/FSD/FMV and f64 ops (E1-T07).
    #[inline(always)]
    pub fn read_raw(&self, r: u8) -> u64 {
        debug_assert!(r < 32, "f-register index {r} out of range");
        self.f[r as usize]
    }

    /// Raw 64-bit write (no boxing) — FLD/FSD and f64 results.
    #[inline(always)]
    pub fn write_raw(&mut self, r: u8, bits: u64) {
        debug_assert!(r < 32, "f-register index {r} out of range");
        self.f[r as usize] = bits;
    }

    /// Read a single-precision operand with NaN-box checking: a value whose upper 32 bits
    /// are not all-ones is not a valid boxed f32 and reads as the canonical qNaN.
    #[inline(always)]
    pub fn read_f32(&self, r: u8) -> u32 {
        let bits = self.read_raw(r);
        if bits >> 32 == 0xFFFF_FFFF {
            bits as u32
        } else {
            CANONICAL_NAN_F32
        }
    }

    /// Write a single-precision result, NaN-boxing it into the 64-bit register.
    #[inline(always)]
    pub fn write_f32(&mut self, r: u8, bits: u32) {
        self.write_raw(r, 0xFFFF_FFFF_0000_0000 | u64::from(bits));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_f32_boxes_and_read_f32_unboxes() {
        let mut f = FRegs::default();
        f.write_f32(3, 0x4048_0000); // 3.125f32
        assert_eq!(
            f.read_raw(3),
            0xFFFF_FFFF_4048_0000,
            "upper bits are all-ones box"
        );
        assert_eq!(f.read_f32(3), 0x4048_0000);
    }

    #[test]
    fn non_boxed_value_reads_as_canonical_nan() {
        let mut f = FRegs::default();
        // A raw 64-bit pattern whose upper 32 bits are not all-ones (e.g. an f64 sneaked in).
        f.write_raw(5, 0x3ff0_0000_0000_0000); // 1.0f64
        assert_eq!(f.read_f32(5), CANONICAL_NAN_F32, "unboxed → canonical qNaN");
        // Even upper bits that are almost all-ones but not exactly.
        f.write_raw(6, 0xFFFF_FFFE_1234_5678);
        assert_eq!(f.read_f32(6), CANONICAL_NAN_F32);
        // Exactly all-ones upper → valid box, passes through (even if the low 32 are a NaN).
        f.write_raw(7, 0xFFFF_FFFF_7FC0_0001);
        assert_eq!(f.read_f32(7), 0x7FC0_0001);
    }

    #[test]
    fn f0_is_an_ordinary_register() {
        let mut f = FRegs::default();
        f.write_f32(0, 0x1234_5678);
        assert_eq!(f.read_f32(0), 0x1234_5678, "f0 is not hardwired zero");
    }

    #[test]
    fn registers_are_independent() {
        let mut f = FRegs::default();
        for n in 0..32u8 {
            f.write_raw(n, 0x0101_0101_0101_0101u64.wrapping_mul(u64::from(n) + 1));
        }
        for n in 0..32u8 {
            assert_eq!(
                f.read_raw(n),
                0x0101_0101_0101_0101u64.wrapping_mul(u64::from(n) + 1)
            );
        }
    }
}
