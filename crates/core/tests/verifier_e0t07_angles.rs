//! E0-T07 adversarial verifier: trap-purity (angle 3) and shamt (angle 4) attacks,
//! with the verifier's own seeds — not the worker's.
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::{Exception, Hart};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const RAM: usize = 64 * 1024;

/// x2's sentinel per the formula in `seeded_hart` — the effective address the
/// E0-T08 load/store fault cases must report in tval.
const X2_SENTINEL: u64 = 0x5EAF_00D5_0000_0000 ^ (2 * 0x0101_0101_0101);

fn seeded_hart(pc: u64) -> Hart {
    let mut hart = Hart::new();
    hart.regs.pc = pc;
    for n in 1..32u8 {
        // verifier's own sentinel pattern, distinct per register
        hart.regs
            .write(n, 0x5EAF_00D5_0000_0000 ^ (u64::from(n) * 0x0101_0101_0101));
    }
    hart
}

/// Angle 3: every trap type reachable at Level 0 must leave the FULL dump
/// (pc + 32 registers) bit-identical. Covers the execute-internal placeholder
/// arms, which the worker's suite never purity-checks.
#[test]
fn all_reachable_traps_leave_state_untouched() {
    // (description, pc, word-to-plant (None = pc unmapped), expected cause, expected tval)
    let _jal_retires_now = 0x008000EFu32; // kept for provenance
    let lb = 0x00010083u32;
    let sd = 0x00113023u32; // sd x1, 0(x2)
    let ecall = 0x00000073u32;
    let ebreak = 0x00100073u32;

    let cases: &[(&str, u64, Option<u32>, Exception, u64)] = &[
        (
            "fetch access (unmapped low)",
            0x0,
            None,
            Exception::InstrAccessFault,
            0x0,
        ),
        (
            "fetch access (hole)",
            0x4000,
            None,
            Exception::InstrAccessFault,
            0x4000,
        ),
        (
            "fetch access (past ram end)",
            DRAM_BASE + RAM as u64,
            None,
            Exception::InstrAccessFault,
            DRAM_BASE + RAM as u64,
        ),
        (
            "fetch misaligned (odd pc in ram)",
            DRAM_BASE + 1,
            None,
            Exception::InstrAddrMisaligned,
            DRAM_BASE + 1,
        ),
        (
            "fetch misaligned (pc+2 in ram)",
            DRAM_BASE + 2,
            None,
            Exception::InstrAddrMisaligned,
            DRAM_BASE + 2,
        ),
        (
            "decode illegal all-zero",
            DRAM_BASE,
            Some(0),
            Exception::IllegalInstruction,
            0,
        ),
        (
            "decode illegal all-ones",
            DRAM_BASE,
            Some(0xFFFF_FFFF),
            Exception::IllegalInstruction,
            0xFFFF_FFFF,
        ),
        // E0-T09 UPDATE (worker edit, marked for the E0-T09 critic's audit):
        // jal/jalr/beq left the placeholder set when control flow landed — the jal/
        // jalr/beq words above now RETIRE, so they cannot sit in a trap table. The
        // purity property transfers to the new §2.5 misaligned-target traps
        // (cause 0, tval = target, link register unwritten):
        (
            "taken beq to pc+2: instr-misaligned (was: placeholder beq)",
            DRAM_BASE,
            Some(0x0000_0163), // beq x0, x0, +2 — always taken, target % 4 == 2
            Exception::InstrAddrMisaligned,
            DRAM_BASE + 2,
        ),
        (
            "jalr to odd sentinel: instr-misaligned (was: placeholder jal/jalr)",
            DRAM_BASE,
            Some(0x0011_00E7), // jalr x1, 1(x2): target = (X2_SENTINEL+1) & !1 ≡ 2 mod 4
            Exception::InstrAddrMisaligned,
            X2_SENTINEL,
        ),
        // E0-T08 UPDATE (worker edit to critic-authored suite, re-verified by the
        // E0-T08 critic): lb/sd left the placeholder set when loads/stores landed.
        // The SAME purity property now checks the real load/store fault paths: the
        // sentinel in x2 is an unmapped address, so these fault with causes 5/7 and
        // tval = the effective address — and must still mutate nothing.
        (
            "load access fault at sentinel address (was: placeholder lb)",
            DRAM_BASE,
            Some(lb),
            Exception::LoadAccessFault,
            X2_SENTINEL,
        ),
        (
            "store access fault at sentinel address (was: placeholder sd)",
            DRAM_BASE,
            Some(sd),
            Exception::StoreAccessFault,
            X2_SENTINEL,
        ),
        (
            "placeholder ecall",
            DRAM_BASE,
            Some(ecall),
            Exception::IllegalInstruction,
            ecall as u64,
        ),
        (
            "placeholder ebreak",
            DRAM_BASE,
            Some(ebreak),
            Exception::IllegalInstruction,
            ebreak as u64,
        ),
    ];
    for &(desc, pc, word, cause, tval) in cases {
        let mut bus = SystemBus::new(Ram::new(RAM).unwrap());
        if let Some(w) = word {
            bus.store32(pc, w).unwrap();
        }
        let mut hart = seeded_hart(pc);
        let before = format!("{}", hart.regs);
        let trap = hart.step(&mut bus).expect_err(desc);
        assert_eq!(trap.cause, cause, "{desc}: cause");
        assert_eq!(trap.tval, tval, "{desc}: tval");
        assert_eq!(hart.regs.pc, pc, "{desc}: pc must not move");
        assert_eq!(format!("{}", hart.regs), before, "{desc}: state mutated");
    }
}

/// Angle 4: shamt masking with the verifier's own vectors.
#[test]
fn shamt_masking_verifier_vectors() {
    let run = |word: u32, seeds: &[(u8, u64)]| -> u64 {
        let mut hart = Hart::new();
        hart.regs.pc = DRAM_BASE;
        let mut bus = SystemBus::new(Ram::new(RAM).unwrap());
        bus.store32(DRAM_BASE, word).unwrap();
        for &(r, v) in seeds {
            hart.regs.write(r, v);
        }
        hart.step(&mut bus).unwrap();
        hart.regs.read(1)
    };
    let r_type = |f7: u32, rs2: u8, rs1: u8, f3: u32, rd: u8, op: u32| {
        (f7 << 25)
            | ((rs2 as u32) << 20)
            | ((rs1 as u32) << 15)
            | (f3 << 12)
            | ((rd as u32) << 7)
            | op
    };
    let sll = r_type(0, 2, 3, 0b001, 1, 0b0110011);
    assert_eq!(
        run(sll, &[(3, 1), (2, u64::MAX)]),
        1u64 << 63,
        "sll rs2=u64::MAX -> shift 63"
    );
    assert_eq!(
        run(sll, &[(3, 0xABCD), (2, 64)]),
        0xABCD,
        "sll rs2=64 -> shift 0"
    );
    assert_eq!(
        run(sll, &[(3, 1), (2, 0x40 | 0x3F)]),
        1u64 << 63,
        "sll rs2=0x7F -> shift 63"
    );
    let srl = r_type(0, 2, 3, 0b101, 1, 0b0110011);
    assert_eq!(
        run(srl, &[(3, u64::MAX), (2, 128)]),
        u64::MAX,
        "srl rs2=128 -> shift 0"
    );
    let sllw = r_type(0, 2, 3, 0b001, 1, 0b0111011);
    assert_eq!(run(sllw, &[(3, 5), (2, 32)]), 5, "sllw rs2=32 -> shift 0");
    assert_eq!(
        run(sllw, &[(3, 1), (2, 0xFFFF_FFFF_FFFF_FFFF)]),
        0xFFFF_FFFF_8000_0000,
        "sllw rs2=-1 -> shift 31, sext"
    );
    let sraw = r_type(0b0100000, 2, 3, 0b101, 1, 0b0111011);
    assert_eq!(
        run(sraw, &[(3, 0x8000_0000), (2, 0x20)]),
        0xFFFF_FFFF_8000_0000,
        "sraw rs2=32 -> shift 0, sext"
    );
}
