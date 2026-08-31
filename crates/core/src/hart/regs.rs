//! Integer register file and PC (E0-T05).
//!
//! RISC-V Unprivileged ISA §2.1: `x0` is hardwired zero. Enormous amounts of real code
//! (`li`, `mv`, `nop`, `j` = `jal x0`, `ret` = `jalr x0`) depend on writes to `x0`
//! being architecturally discarded, and bugs here silently poison every differential
//! trace. The invariant is enforced in exactly ONE place — [`XRegs::write`] — and the
//! backing array is private, so no executor can bypass it (the compiler is the guard).

use core::fmt;

/// ABI register names per the RISC-V psABI, indexed by register number.
pub const ABI_NAMES: [&str; 32] = [
    "zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2", "s0", "s1", "a0", "a1", "a2", "a3", "a4",
    "a5", "a6", "a7", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "t3", "t4",
    "t5", "t6",
];

/// The 31 writable RV64 integer registers plus the PC. `x0` reads zero on every path.
///
/// Index discipline: register numbers come from 5-bit instruction fields (0..=31), so
/// decode can never produce an out-of-range index. Passing `r >= 32` anyway is a caller
/// bug: `debug_assert!` fires in debug builds, and the array bounds check aborts in
/// release builds too — it can never silently alias another register.
#[derive(Clone, Default)]
pub struct XRegs {
    /// `regs[0]` is never written; the x0 invariant lives in [`Self::write`] alone.
    regs: [u64; 32],
    /// The program counter.
    pub pc: u64,
    /// Monotonic mutation stamp for compiled-state handoff elision. This is not architectural
    /// state: equality deliberately ignores it, and snapshots continue to serialize only `pc` and
    /// the register words.
    jit_version: u64,
}

impl PartialEq for XRegs {
    fn eq(&self, other: &Self) -> bool {
        self.regs == other.regs && self.pc == other.pc
    }
}

impl Eq for XRegs {}

impl XRegs {
    /// Read register `r`. `read(0)` is always 0.
    #[inline(always)]
    pub fn read(&self, r: u8) -> u64 {
        debug_assert!(r < 32, "register index {r} out of range");
        self.regs[r as usize]
    }

    /// Write register `r`. A write to `x0` is architecturally discarded — this is the
    /// single enforcement point of the hardwired-zero invariant.
    #[inline(always)]
    pub fn write(&mut self, r: u8, v: u64) {
        debug_assert!(r < 32, "register index {r} out of range");
        if r != 0 {
            self.regs[r as usize] = v;
            self.jit_version = self.jit_version.wrapping_add(1);
        }
    }

    /// Crate-private bulk view used by the compiled-state handoff. The backing x0 word is always
    /// zero because every architectural mutation still goes through [`Self::write`].
    pub(crate) fn jit_words(&self) -> &[u64; 32] {
        &self.regs
    }

    /// Return the non-architectural mutation stamp used to avoid remarshal of an unchanged
    /// register image between adjacent compiled calls.
    pub fn jit_version(&self) -> u64 {
        self.jit_version
    }

    /// Commit a bulk compiled register image while preserving the hardwired x0 word.
    pub(crate) fn jit_commit_words(&mut self, words: &[u64]) {
        debug_assert!(words.len() >= 32);
        self.regs[1..].copy_from_slice(&words[1..32]);
        self.jit_version = self.jit_version.wrapping_add(1);
    }

    /// Commit only the architectural registers named by a generated direct-chain write mask.
    /// `x0` is deliberately ignored even if a malformed mask includes it.
    pub(crate) fn jit_commit_words_mask(&mut self, words: &[u64], mask: u32) {
        debug_assert!(words.len() >= 32);
        let mut changed = false;
        for (offset, word) in words[1..32].iter().copied().enumerate() {
            let register = offset + 1;
            if mask & (1_u32 << register) != 0 {
                self.regs[register] = word;
                changed = true;
            }
        }
        if changed {
            self.jit_version = self.jit_version.wrapping_add(1);
        }
    }
}

/// Stable dump format (consumed by the CLI in E0-T18, snapshots in E0-T17, and trace
/// tooling in E0-T16 — golden-tested byte-for-byte):
///
/// ```text
/// pc        = 0x0000000000000000
/// x00(zero) = 0x0000000000000000
/// ...
/// x31(  t6) = 0x0000000000000000
/// ```
impl fmt::Display for XRegs {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "pc        = {:#018x}", self.pc)?;
        for (n, v) in self.regs.iter().enumerate() {
            writeln!(f, "x{n:02}({:>4}) = {v:#018x}", ABI_NAMES[n])?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::format;

    #[test]
    fn default_is_all_zero_including_pc() {
        let r = XRegs::default();
        for n in 0..32 {
            assert_eq!(r.read(n), 0);
        }
        assert_eq!(r.pc, 0);
    }

    #[test]
    fn x0_writes_are_discarded() {
        let mut r = XRegs::default();
        for v in [1u64, 0xFFFF_FFFF_FFFF_FFFF, 0x8000_0000_0000_0000, 42] {
            r.write(0, v);
            assert_eq!(r.read(0), 0, "x0 must stay hardwired zero");
        }
    }

    #[test]
    fn x1_to_x31_roundtrip_distinct_values() {
        let mut r = XRegs::default();
        for n in 1..32u8 {
            r.write(n, 0x1111_1111_1111_1111u64.wrapping_mul(u64::from(n)));
        }
        for n in 1..32u8 {
            assert_eq!(
                r.read(n),
                0x1111_1111_1111_1111u64.wrapping_mul(u64::from(n)),
                "x{n} clobbered by a neighboring write"
            );
        }
        assert_eq!(r.read(0), 0);
    }

    #[test]
    fn compiled_register_mask_commit_preserves_unmasked_words_and_x0() {
        let mut r = XRegs::default();
        r.write(1, 0x11);
        r.write(2, 0x22);
        let before = r.jit_version();
        let mut words = [0_u64; 32];
        words[0] = 0xDEAD;
        words[1] = 0x101;
        words[2] = 0x202;
        words[3] = 0x303;
        r.jit_commit_words_mask(&words, (1_u32 << 0) | (1_u32 << 2));

        assert_eq!(r.read(0), 0, "a malformed x0 bit must remain harmless");
        assert_eq!(r.read(1), 0x11, "unmasked x1 was overwritten");
        assert_eq!(r.read(2), 0x202, "masked x2 was not committed");
        assert_eq!(r.jit_version(), before + 1);
    }

    #[test]
    fn jit_version_is_not_architectural_equality() {
        let mut changed = XRegs::default();
        let same_words = changed.jit_words().to_owned();
        changed.jit_commit_words(&same_words);

        assert!(changed == XRegs::default());
        assert_ne!(changed.jit_version(), XRegs::default().jit_version());
    }

    #[test]
    #[should_panic]
    fn out_of_range_read_panics() {
        let r = XRegs::default();
        let _ = r.read(32);
    }

    #[test]
    #[should_panic]
    fn out_of_range_write_panics() {
        let mut r = XRegs::default();
        r.write(32, 1);
    }

    #[test]
    fn abi_names_match_psabi() {
        assert_eq!(ABI_NAMES.len(), 32);
        assert_eq!(ABI_NAMES[0], "zero");
        assert_eq!(ABI_NAMES[1], "ra");
        assert_eq!(ABI_NAMES[2], "sp");
        assert_eq!(ABI_NAMES[8], "s0"); // fp alias, psABI canonical name is s0
        assert_eq!(ABI_NAMES[10], "a0");
        assert_eq!(ABI_NAMES[17], "a7");
        assert_eq!(ABI_NAMES[27], "s11");
        assert_eq!(ABI_NAMES[31], "t6");
    }

    #[test]
    fn dump_format_is_byte_stable() {
        let mut r = XRegs {
            pc: 0x8000_0000,
            ..Default::default()
        };
        r.write(1, 0xDEAD_BEEF);
        r.write(2, 0x8000_1000);
        r.write(31, u64::MAX);
        let dump = format!("{r}");
        // FULL 33-line pinned literal. The earlier version reconstructed the expected
        // string from ABI_NAMES — self-licking for register names, refuted by the
        // E0-T05 verifier (an a3/a4 swap survived the whole suite). Every byte of the
        // format and every ABI name is now pinned independently of the implementation.
        let golden = "pc        = 0x0000000080000000\n\
                      x00(zero) = 0x0000000000000000\n\
                      x01(  ra) = 0x00000000deadbeef\n\
                      x02(  sp) = 0x0000000080001000\n\
                      x03(  gp) = 0x0000000000000000\n\
                      x04(  tp) = 0x0000000000000000\n\
                      x05(  t0) = 0x0000000000000000\n\
                      x06(  t1) = 0x0000000000000000\n\
                      x07(  t2) = 0x0000000000000000\n\
                      x08(  s0) = 0x0000000000000000\n\
                      x09(  s1) = 0x0000000000000000\n\
                      x10(  a0) = 0x0000000000000000\n\
                      x11(  a1) = 0x0000000000000000\n\
                      x12(  a2) = 0x0000000000000000\n\
                      x13(  a3) = 0x0000000000000000\n\
                      x14(  a4) = 0x0000000000000000\n\
                      x15(  a5) = 0x0000000000000000\n\
                      x16(  a6) = 0x0000000000000000\n\
                      x17(  a7) = 0x0000000000000000\n\
                      x18(  s2) = 0x0000000000000000\n\
                      x19(  s3) = 0x0000000000000000\n\
                      x20(  s4) = 0x0000000000000000\n\
                      x21(  s5) = 0x0000000000000000\n\
                      x22(  s6) = 0x0000000000000000\n\
                      x23(  s7) = 0x0000000000000000\n\
                      x24(  s8) = 0x0000000000000000\n\
                      x25(  s9) = 0x0000000000000000\n\
                      x26( s10) = 0x0000000000000000\n\
                      x27( s11) = 0x0000000000000000\n\
                      x28(  t3) = 0x0000000000000000\n\
                      x29(  t4) = 0x0000000000000000\n\
                      x30(  t5) = 0x0000000000000000\n\
                      x31(  t6) = 0xffffffffffffffff\n";
        assert_eq!(dump, golden);
        assert_eq!(dump.lines().count(), 33); // pc + 32 registers
    }

    /// Deterministic 10k-op interleaving vs an independent oracle (a raw array that
    /// re-zeroes index 0 after every write). Runs under miri too.
    #[test]
    fn interleavings_vs_oracle_lcg() {
        let mut r = XRegs::default();
        let mut oracle = [0u64; 32];
        let mut state: u64 = 0x5EED_2026_0702_0005;
        for _ in 0..10_000 {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let reg = (state >> 33) as u8 & 31;
            let val = state ^ (state << 13);
            r.write(reg, val);
            oracle[reg as usize] = val;
            oracle[0] = 0;
            let probe = (state >> 27) as u8 & 31;
            assert_eq!(r.read(probe), oracle[probe as usize]);
            assert_eq!(r.read(0), 0);
        }
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        /// Arbitrary write/read interleavings never make read(0) non-zero, and every
        /// register tracks an independent oracle exactly.
        #[test]
        #[cfg_attr(miri, ignore)] // proptest's RNG plumbing is glacial under miri; the
                                  // LCG test above covers the same property there
        fn writes_track_oracle_and_x0_stays_zero(ops in prop::collection::vec((0u8..32, any::<u64>()), 1..200)) {
            let mut r = XRegs::default();
            let mut oracle = [0u64; 32];
            for (reg, val) in ops {
                r.write(reg, val);
                oracle[reg as usize] = val;
                oracle[0] = 0;
                prop_assert_eq!(r.read(0), 0);
                for n in 0..32u8 {
                    prop_assert_eq!(r.read(n), oracle[n as usize]);
                }
            }
        }
    }
}
