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
}

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
    use alloc::string::String;

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
        let mut expected = String::from("pc        = 0x0000000080000000\n");
        for n in 0..32u8 {
            let v = r.read(n);
            expected.push_str(&format!(
                "x{n:02}({:>4}) = {v:#018x}\n",
                ABI_NAMES[n as usize]
            ));
        }
        // Golden prefix pinned literally (belt) + full reconstruction (suspenders):
        assert!(dump.starts_with("pc        = 0x0000000080000000\nx00(zero) = 0x0000000000000000\nx01(  ra) = 0x00000000deadbeef\nx02(  sp) = 0x0000000080001000\n"));
        assert!(dump.ends_with("x31(  t6) = 0xffffffffffffffff\n"));
        assert_eq!(dump, expected);
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
