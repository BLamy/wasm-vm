//! E1-T03: RV64M multiply/divide semantics, with a heavy emphasis on the spec's
//! trap-free division edge cases and the W-form sign-extension rules.
//!
//! Expected values are the exact results defined by the Unprivileged ISA "M" chapter
//! (divide-by-zero → all-ones quotient / dividend remainder; signed MIN/-1 overflow →
//! dividend quotient / zero remainder; *W forms operate on the low 32 bits and
//! sign-extend the 32-bit result). They are what Spike produces; the ≥1M-instruction
//! Spike differential is the separate adversarial-verification leg.
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const OP: u32 = 0b0110011;
const OP32: u32 = 0b0111011;
const MEXT: u32 = 0b0000001; // M-extension funct7

fn r_word(op: u32, f3: u32, f7: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (f7 << 25) | ((rs2 as u32) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}

/// Execute a single R-type M op with rd=x3, rs1=x1←a, rs2=x2←b; return x3.
fn run(op: u32, f3: u32, a: u64, b: u64) -> u64 {
    let mut hart = Hart::new();
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    hart.regs.write(1, a);
    hart.regs.write(2, b);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, r_word(op, f3, MEXT, 3, 1, 2))
        .unwrap();
    hart.step(&mut bus).expect("M ops never trap");
    hart.regs.read(3)
}

// funct3 codes.
const MUL: u32 = 0b000;
const MULH: u32 = 0b001;
const MULHSU: u32 = 0b010;
const MULHU: u32 = 0b011;
const DIV: u32 = 0b100;
const DIVU: u32 = 0b101;
const REM: u32 = 0b110;
const REMU: u32 = 0b111;
// W forms reuse funct3: MULW=000, DIVW=100, DIVUW=101, REMW=110, REMUW=111.

const IMIN: u64 = 0x8000_0000_0000_0000; // i64::MIN
const IMAX: u64 = 0x7FFF_FFFF_FFFF_FFFF; // i64::MAX
const ALL1: u64 = 0xFFFF_FFFF_FFFF_FFFF; // -1

// ── products ──────────────────────────────────────────────────────────────────

#[test]
fn mul_low_bits() {
    assert_eq!(run(OP, MUL, ALL1, ALL1), 1); // (-1)(-1)
    assert_eq!(run(OP, MUL, IMIN, IMIN), 0); // 2^63·2^63 = 2^126, low 64 = 0
    assert_eq!(run(OP, MUL, 6, 7), 42);
    assert_eq!(run(OP, MUL, ALL1, 2), 0xFFFF_FFFF_FFFF_FFFE); // -2
}

#[test]
fn mulh_signed_high() {
    // (-2^63)·(-2^63) = 2^126 → high 64 = 2^62.
    assert_eq!(run(OP, MULH, IMIN, IMIN), 0x4000_0000_0000_0000);
    assert_eq!(run(OP, MULH, ALL1, ALL1), 0); // 1 → high 0
    assert_eq!(run(OP, MULH, ALL1, 1), ALL1); // -1 → high = -1
    // (2^63-1)^2 = 2^126 - 2^64 + 1 → high 64 = 2^62 - 1.
    assert_eq!(run(OP, MULH, IMAX, IMAX), 0x3FFF_FFFF_FFFF_FFFF);
}

#[test]
fn mulhu_unsigned_high() {
    assert_eq!(run(OP, MULHU, IMIN, IMIN), 0x4000_0000_0000_0000); // 2^63·2^63
    // (2^64-1)^2 high 64 = 2^64-2.
    assert_eq!(run(OP, MULHU, ALL1, ALL1), 0xFFFF_FFFF_FFFF_FFFE);
    assert_eq!(run(OP, MULHU, ALL1, 2), 1); // (2^64-1)·2 = 2^65-2 → high 1
    assert_eq!(run(OP, MULHU, 3, 5), 0);
}

#[test]
fn mulhsu_mixed_sign_high() {
    // The one everyone gets wrong. rs1 signed, rs2 unsigned.
    // (-1)·(2^64-1) = -(2^64-1); arithmetic >>64 floors to -1.
    assert_eq!(run(OP, MULHSU, ALL1, ALL1), ALL1);
    // (-2^63)·(2^64-1) = -2^127 + 2^63; >>64 floors to -2^63 = i64::MIN.
    assert_eq!(run(OP, MULHSU, IMIN, ALL1), IMIN);
    // Positive rs1 with huge unsigned rs2: (1)·(2^64-1) high = 0.
    assert_eq!(run(OP, MULHSU, 1, ALL1), 0);
    // rs2 = 0 → product 0.
    assert_eq!(run(OP, MULHSU, ALL1, 0), 0);
    // Contrast MULHU(-1 as unsigned, -1) = 2^64-2 vs MULHSU(-1 signed, -1) = -1: the
    // sign of rs1 must flip the high word.
    assert_ne!(run(OP, MULHU, ALL1, ALL1), run(OP, MULHSU, ALL1, ALL1));
}

// ── signed divide/remainder + edge cases ────────────────────────────────────────

#[test]
fn div_rem_by_zero() {
    for x in [0u64, 1, ALL1, IMIN, IMAX, 0x1234_5678_9ABC_DEF0] {
        assert_eq!(run(OP, DIV, x, 0), ALL1, "div/0 → -1");
        assert_eq!(run(OP, DIVU, x, 0), ALL1, "divu/0 → 2^64-1");
        assert_eq!(run(OP, REM, x, 0), x, "rem/0 → dividend");
        assert_eq!(run(OP, REMU, x, 0), x, "remu/0 → dividend");
    }
}

#[test]
fn div_rem_signed_overflow() {
    // i64::MIN / -1 overflows: quotient = dividend, remainder = 0 (no trap, no panic).
    assert_eq!(run(OP, DIV, IMIN, ALL1), IMIN);
    assert_eq!(run(OP, REM, IMIN, ALL1), 0);
    // DIVU has no overflow case: 2^63 / (2^64-1) = 0, remu = 2^63.
    assert_eq!(run(OP, DIVU, IMIN, ALL1), 0);
    assert_eq!(run(OP, REMU, IMIN, ALL1), IMIN);
}

#[test]
fn div_rem_truncate_toward_zero() {
    // -7 / 2 = -3 rem -1 (remainder takes the dividend's sign).
    assert_eq!(run(OP, DIV, (-7i64) as u64, 2), (-3i64) as u64);
    assert_eq!(run(OP, REM, (-7i64) as u64, 2), (-1i64) as u64);
    // 7 / -2 = -3 rem 1.
    assert_eq!(run(OP, DIV, 7, (-2i64) as u64), (-3i64) as u64);
    assert_eq!(run(OP, REM, 7, (-2i64) as u64), 1);
    assert_eq!(run(OP, DIVU, 7, 2), 3);
    assert_eq!(run(OP, REMU, 7, 2), 1);
}

// ── W forms: low-32 operation, sign-extended 32-bit result ───────────────────────

#[test]
fn w_forms_ignore_upper_bits_and_sign_extend() {
    // Seed the sources with non-canonical upper 32 bits; *W must ignore them.
    let a = 0xDEAD_BEEF_0000_0007;
    let b = 0xCAFE_BABE_0000_0002;
    assert_eq!(run(OP32, MUL, a, b), 14); // 7·2, sext(14)
    assert_eq!(run(OP32, DIV, a, b), 3); // 7/2
    assert_eq!(run(OP32, REM, a, b), 1); // 7%2
    // MULW result with bit 31 set is sign-extended: 0xFFFF·0xFFFF = 0xFFFE0001.
    assert_eq!(
        run(OP32, MUL, 0x0000_FFFF, 0x0000_FFFF),
        0xFFFF_FFFF_FFFE_0001
    );
}

#[test]
fn divw_remw_edges() {
    // i32::MIN / -1 overflow → 0x80000000 sign-extended; remw = 0.
    assert_eq!(run(OP32, DIV, 0x8000_0000, ALL1), 0xFFFF_FFFF_8000_0000);
    assert_eq!(run(OP32, REM, 0x8000_0000, ALL1), 0);
    // divw / 0 → -1 (all ones, sign-extended).
    assert_eq!(run(OP32, DIV, 12345, 0), ALL1);
    assert_eq!(run(OP32, REM, 12345, 0), 12345);
}

#[test]
fn divuw_remuw_sign_extend_from_bit31() {
    // A 0xFFFF_FFFF unsigned quotient/rem must read back sign-extended to all-ones.
    assert_eq!(run(OP32, DIVU, 0xFFFF_FFFF, 1), 0xFFFF_FFFF_FFFF_FFFF);
    assert_eq!(run(OP32, DIVU, 12345, 0), 0xFFFF_FFFF_FFFF_FFFF); // /0 → 2^32-1, sext
    // remuw producing 0xFFFF_FFFE sign-extends to ...FFFE.
    assert_eq!(
        run(OP32, REMU, 0xFFFF_FFFE, 0xFFFF_FFFF),
        0xFFFF_FFFF_FFFF_FFFE
    );
    // A small positive quotient does NOT get spuriously sign-extended.
    assert_eq!(run(OP32, DIVU, 0xFFFF_FFFF, 2), 0x7FFF_FFFF);
}

// ── operand aliasing (rd == rs1 == rs2) ─────────────────────────────────────────

#[test]
fn rd_rs1_rs2_aliasing() {
    // MUL x5, x5, x5 with x5 = 5 → 25 (sources read before the write-back).
    let mut hart = Hart::new();
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    hart.regs.write(5, 5);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, r_word(OP, MUL, MEXT, 5, 5, 5))
        .unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(5), 25);
    // DIV x6, x6, x6 with x6 = -9 → 1.
    let mut hart = Hart::new();
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    hart.regs.write(6, (-9i64) as u64);
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, r_word(OP, DIV, MEXT, 6, 6, 6))
        .unwrap();
    hart.step(&mut bus).unwrap();
    assert_eq!(hart.regs.read(6), 1);
}

// ── no panic on any operand pair (boundary-biased fuzz) ─────────────────────────

#[test]
fn no_panic_on_boundary_biased_operands() {
    let seeds = [
        0u64,
        1,
        ALL1,
        IMIN,
        IMAX,
        2,
        0x8000_0000,
        0x7FFF_FFFF,
        0xFFFF_FFFF,
    ];
    let op_f3s = [MUL, MULH, MULHSU, MULHU, DIV, DIVU, REM, REMU];
    // OP-32 only defines MULW(000)/DIVW(100)/DIVUW(101)/REMW(110)/REMUW(111).
    let op32_f3s = [MUL, DIV, DIVU, REM, REMU];
    for &a in &seeds {
        for &b in &seeds {
            for &f3 in &op_f3s {
                let _ = run(OP, f3, a, b);
            }
            for &f3 in &op32_f3s {
                let _ = run(OP32, f3, a, b);
            }
        }
    }
}
