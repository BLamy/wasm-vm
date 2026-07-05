//! Adversarial verifier attack suite for E0-T05 (fresh session, own seeds).
//! Uses ONLY the public API. Not the worker's tests.

use wasm_vm_core::hart::regs::XRegs;

/// Verifier's own psABI table, written out independently from the RISC-V psABI
/// (calling convention chapter), NOT copied from the implementation.
const PSABI: [&str; 32] = [
    "zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2", "s0", "s1", "a0", "a1", "a2", "a3", "a4",
    "a5", "a6", "a7", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "t3", "t4",
    "t5", "t6",
];

/// P2: 20k random ops with the VERIFIER's seed and a different PRNG (xorshift64)
/// vs a raw [u64;32] oracle that re-zeroes index 0. Forces periodic x0 writes.
#[test]
fn verifier_oracle_xorshift_20k() {
    let mut r = XRegs::default();
    let mut oracle = [0u64; 32];
    let mut s: u64 = 0x0B5E_77A4_17C0_FFEE;
    for i in 0..20_000u32 {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        let reg = if i % 16 == 0 { 0 } else { (s >> 41) as u8 & 31 };
        let val = s.wrapping_mul(0x2545_F491_4F6C_DD1D);
        r.write(reg, val);
        oracle[reg as usize] = val;
        oracle[0] = 0;
        // full-state probe every step
        for n in 0..32u8 {
            assert_eq!(
                r.read(n),
                oracle[n as usize],
                "divergence at op {i} reg x{n}"
            );
        }
        assert_eq!(r.read(0), 0, "x0 poisoned at op {i}");
    }
}

/// P3: parse the dump with rules derived from the TASK SPEC string
/// `x{n:02}({abi:>4}) = 0x{v:016x}`, not from the code. Also: pc line present,
/// ABI names match the verifier's own psABI table, values match read(n).
#[test]
fn verifier_dump_matches_task_spec() {
    let mut r = XRegs::default();
    r.pc = 0xDEAD_0000_BEEF_1234;
    let mut s: u64 = 0xFACE_2026_0702_0001;
    for n in 1..32u8 {
        s = s.wrapping_mul(6364136223846793005).wrapping_add(1);
        r.write(n, s);
    }
    r.write(5, u64::MAX);
    r.write(6, 0);
    let dump = format!("{r}");
    let lines: Vec<&str> = dump.lines().collect();
    assert_eq!(lines.len(), 33, "expected pc + 32 register lines");

    // acceptance: dump includes PC, as 0x + 16 lowercase hex of the actual pc
    assert!(
        lines[0].contains("pc") && lines[0].ends_with("0xdead0000beef1234"),
        "pc line wrong: {:?}",
        lines[0]
    );

    for n in 0..32usize {
        let line = lines[n + 1];
        // spec: x{n:02}
        assert_eq!(&line[0..1], "x", "line {n}: {line:?}");
        assert_eq!(
            line[1..3].parse::<usize>().expect("2-digit index"),
            n,
            "index field wrong on line: {line:?}"
        );
        // spec: ({abi:>4})  -> '(' + name right-aligned in width 4 + ')'
        assert_eq!(&line[3..4], "(", "{line:?}");
        let abi_field = &line[4..8];
        assert_eq!(&line[8..9], ")", "{line:?}");
        assert_eq!(
            abi_field.trim_start(),
            PSABI[n],
            "ABI name drift at x{n}: {line:?}"
        );
        assert_eq!(abi_field.len(), 4, "abi field not width 4: {line:?}");
        assert!(
            abi_field
                .chars()
                .all(|c| c == ' ' || c.is_ascii_lowercase() || c.is_ascii_digit()),
            "{line:?}"
        );
        // spec: ` = 0x{v:016x}`
        assert_eq!(&line[9..14], " = 0x", "{line:?}");
        let hex = &line[14..];
        assert_eq!(hex.len(), 16, "value not 16 hex digits: {line:?}");
        let v = u64::from_str_radix(hex, 16).expect("hex value");
        assert!(
            hex.chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
            "uppercase or bad hex: {line:?}"
        );
        assert_eq!(v, r.read(n as u8), "dumped value != read({n})");
    }
    // x8 must be s0 per the task text (not fp)
    assert!(
        lines[9].starts_with("x08(  s0)"),
        "x8 not s0: {:?}",
        lines[9]
    );
}

/// P4: out-of-range indices panic — 32 (first OOB) and 255 (u8 max).
#[test]
#[should_panic]
fn verifier_read_32_panics() {
    let r = XRegs::default();
    let _ = r.read(32);
}

#[test]
#[should_panic]
fn verifier_write_32_panics() {
    let mut r = XRegs::default();
    r.write(32, 0x55);
}

#[test]
#[should_panic]
fn verifier_read_255_panics() {
    let r = XRegs::default();
    let _ = r.read(255);
}

#[test]
#[should_panic]
fn verifier_write_255_panics() {
    let mut r = XRegs::default();
    r.write(255, 1);
}

/// Novel attack: Clone must deep-copy (no shared state) and cannot launder an
/// invariant break — mutate the clone hard, original unchanged, x0 zero in both.
#[test]
fn verifier_clone_is_deep_and_invariant_preserving() {
    let mut a = XRegs::default();
    a.write(3, 0xAAAA);
    a.pc = 99;
    let mut b = a.clone();
    b.write(3, 0xBBBB);
    b.write(0, u64::MAX);
    b.pc = 1;
    assert_eq!(a.read(3), 0xAAAA);
    assert_eq!(a.pc, 99);
    assert_eq!(b.read(3), 0xBBBB);
    assert_eq!(b.read(0), 0);
    assert_eq!(a.read(0), 0);
}
