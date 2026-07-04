//! A deterministic, host-independent PRNG for the differential fuzzer (E1-T21).
//!
//! SplitMix64 — the same algorithm and constants Vigna specifies. It is chosen for one
//! property above all: **reproducibility**. The stream is a pure function of the u64 seed
//! and uses only wrapping integer arithmetic, so a given `--seed N` produces a
//! bit-identical instruction stream on every host, every build, forever (acceptance
//! criterion #1). We deliberately do NOT pull in the `rand` crate — its algorithms and
//! seeding have changed across versions, which would silently invalidate checked-in
//! regression seeds.

/// SplitMix64 state. Clone to fork an independent-but-reproducible substream.
#[derive(Clone)]
pub struct Rng {
    state: u64,
}

impl Rng {
    /// Seed the generator. Every seed yields a distinct, fully reproducible stream.
    pub const fn new(seed: u64) -> Self {
        Rng { state: seed }
    }

    /// Next 64-bit value (SplitMix64 — Vigna's finalizer over a Weyl sequence).
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `[0, n)`. `n == 0` returns 0 (a generator using a 0 bound has a bug, but
    /// we never panic mid-campaign). Uses the fast Lemire-style multiply-shift, which is
    /// deterministic given the stream.
    pub fn below(&mut self, n: u32) -> u32 {
        if n == 0 {
            return 0;
        }
        // 64-bit product of a fresh draw and n, take the high 32 bits: uniform in [0,n).
        ((self.next_u64() as u128 * u128::from(n)) >> 64) as u32 % n.max(1)
    }

    /// Pick one element of `slice` uniformly. Caller guarantees non-empty.
    pub fn pick<'a, T>(&mut self, slice: &'a [T]) -> &'a T {
        &slice[self.below(slice.len() as u32) as usize]
    }

    /// Weighted pick: returns the index `i` with probability `weights[i] / sum`. Used for
    /// the opcode distribution. Falls back to the last index if rounding leaves a gap.
    pub fn weighted(&mut self, weights: &[u32]) -> usize {
        let total: u32 = weights.iter().copied().sum();
        if total == 0 {
            return 0;
        }
        let mut r = self.below(total);
        for (i, &w) in weights.iter().enumerate() {
            if r < w {
                return i;
            }
            r -= w;
        }
        weights.len() - 1
    }

    /// A 64-bit immediate biased hard toward boundary values, where integer bugs live:
    /// 0, ±1, INT_MIN/MAX (32- and 64-bit), small values, and single-bit patterns — with
    /// a minority of full-width random draws. Boundary bias is what makes a small stream
    /// probe sign-extension, overflow, and shift-amount masking instead of wandering the
    /// interior of the value space.
    pub fn biased_imm(&mut self) -> u64 {
        const BOUNDARIES: &[u64] = &[
            0,
            1,
            u64::MAX,              // -1
            0x7FFF_FFFF,           // i32::MAX
            0xFFFF_FFFF_8000_0000, // i32::MIN sign-extended
            0x8000_0000_0000_0000, // i64::MIN
            0x7FFF_FFFF_FFFF_FFFF, // i64::MAX
            0xFFFF_FFFF,           // u32::MAX
            0x0000_0000_FFFF_FFFF, // low word set
            2,
            0x3F, // shift-amount boundary (RV64)
            0x40, // shift-amount overflow boundary
            0x20, // 32-bit shift-amount boundary
        ];
        match self.below(10) {
            0..=5 => *self.pick(BOUNDARIES),
            6 => 1u64 << (self.below(64)), // single set bit
            7 => (self.next_u64() & 0xFFF).wrapping_sub(0x800), // small signed (12-bit)
            _ => self.next_u64(),          // full-width random
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_is_reproducible_for_a_seed() {
        let a: Vec<u64> = (0..8)
            .scan(Rng::new(0xDEAD_BEEF), |r, _| Some(r.next_u64()))
            .collect();
        let b: Vec<u64> = (0..8)
            .scan(Rng::new(0xDEAD_BEEF), |r, _| Some(r.next_u64()))
            .collect();
        assert_eq!(a, b, "same seed must yield the same stream");
    }

    #[test]
    fn distinct_seeds_diverge() {
        let mut x = Rng::new(1);
        let mut y = Rng::new(2);
        assert_ne!(x.next_u64(), y.next_u64());
    }

    #[test]
    fn below_stays_in_range() {
        let mut r = Rng::new(42);
        for n in 1..64u32 {
            for _ in 0..100 {
                assert!(r.below(n) < n, "below({n}) escaped its bound");
            }
        }
    }

    #[test]
    fn below_zero_is_zero_not_panic() {
        let mut r = Rng::new(7);
        assert_eq!(r.below(0), 0);
    }

    #[test]
    fn weighted_respects_zero_weight_arms() {
        let mut r = Rng::new(99);
        // Only index 2 has weight — every draw must land there.
        for _ in 0..200 {
            assert_eq!(r.weighted(&[0, 0, 5, 0]), 2);
        }
    }

    #[test]
    fn biased_imm_hits_known_boundaries() {
        // Over enough draws the boundary set must all appear — proves the bias is live.
        let mut r = Rng::new(0x1234);
        let mut seen = std::collections::HashSet::new();
        for _ in 0..10_000 {
            seen.insert(r.biased_imm());
        }
        for b in [0u64, 1, u64::MAX, 0x8000_0000_0000_0000, 0x7FFF_FFFF] {
            assert!(seen.contains(&b), "boundary {b:#x} never generated");
        }
    }
}
