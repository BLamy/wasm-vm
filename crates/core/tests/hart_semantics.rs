//! E0-T07 semantic matrix for the hart step loop and all computational RV64I ops.
//!
//! Expected values come from an INDEPENDENT reference model built on i128 arithmetic
//! and explicit spec rules (Unprivileged ISA Ch. 5) — deliberately not the
//! implementation's u64/wrapping formulation, so a shared bug cannot self-license.
//! Instruction words are built by local encoders (decode itself was adversarially
//! verified in E0-T06 with assembler-derived tables).

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

// ── encoders (spec §2.2 layouts, test-local) ────────────────────────────────

fn r_type(f7: u32, rs2: u8, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (f7 << 25) | ((rs2 as u32) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    assert!((-2048..=2047).contains(&imm));
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn u_type(imm20: u32, rd: u8, op: u32) -> u32 {
    assert!(imm20 < (1 << 20));
    (imm20 << 12) | ((rd as u32) << 7) | op
}

// ── harness ─────────────────────────────────────────────────────────────────

// 4 KiB under miri: the matrix allocates a fresh machine per vector, and zeroing
// 64 KiB x ~700 machines dominates interpreted runtime. Native keeps 64 KiB (the
// pinned checksum depends on the pc-wrap boundary).
const RAM: u64 = if cfg!(miri) { 4096 } else { 64 * 1024 };

fn machine() -> (Hart, SystemBus) {
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    (hart, SystemBus::new(Ram::new(RAM as usize).unwrap()))
}

/// Execute one instruction word with seeded registers; return the hart on retire.
fn exec(word: u32, seed: &[(u8, u64)]) -> Result<Hart, Trap> {
    let (mut hart, mut bus) = machine();
    bus.store32(DRAM_BASE, word).unwrap();
    for &(reg, val) in seed {
        hart.regs.write(reg, val);
    }
    hart.step(&mut bus).map(|()| hart)
}

fn exec_rd(word: u32, seed: &[(u8, u64)]) -> u64 {
    let hart = exec(word, seed).expect("instruction must retire");
    assert_eq!(
        hart.regs.pc,
        DRAM_BASE + 4,
        "PC must advance by 4 on retirement"
    );
    hart.regs.read(1) // rd = x1 by convention in this matrix
}

// ── independent reference model (i128 + explicit spec rules) ────────────────

const EDGES: [u64; 6] = [
    0,
    1,
    u64::MAX, // -1
    i64::MIN as u64,
    0x7FFF_FFFF,
    0x8000_0000,
];

fn ref_sext32(bits: u128) -> u64 {
    let low = (bits & 0xFFFF_FFFF) as u64;
    if low & 0x8000_0000 != 0 {
        low | 0xFFFF_FFFF_0000_0000
    } else {
        low
    }
}

// ── acceptance-criteria anchors ─────────────────────────────────────────────

#[test]
fn addiw_sign_boundary_acceptance() {
    // addiw x1, x2, 1 with x2 = 0x7FFF_FFFF → 0xFFFF_FFFF_8000_0000
    let w = i_type(1, 2, 0b000, 1, 0b0011011);
    assert_eq!(exec_rd(w, &[(2, 0x7FFF_FFFF)]), 0xFFFF_FFFF_8000_0000);
}

#[test]
fn shift_amount_masking_acceptance() {
    // sll uses only rs2[5:0]: rs2 = ...FFC1 → shift by 1
    let sll = r_type(0, 3, 2, 0b001, 1, 0b0110011);
    assert_eq!(
        exec_rd(sll, &[(2, 0x0F0F), (3, 0xFFFF_FFFF_FFFF_FFC1)]),
        0x0F0F << 1
    );
    // sllw uses only rs2[4:0]: rs2 = 0x2F → shift by 15
    let sllw = r_type(0, 3, 2, 0b001, 1, 0b0111011);
    assert_eq!(exec_rd(sllw, &[(2, 1), (3, 0x2F)]), 1 << 15);
}

#[test]
fn arithmetic_shifts_on_negatives_acceptance() {
    let sra = r_type(0b0100000, 3, 2, 0b101, 1, 0b0110011);
    assert_eq!(
        exec_rd(sra, &[(2, (-64i64) as u64), (3, 4)]),
        (-4i64) as u64
    );
    let sraw = r_type(0b0100000, 3, 2, 0b101, 1, 0b0111011);
    // 32-bit -64 >> 4 = -4, sign-extended
    assert_eq!(exec_rd(sraw, &[(2, 0xFFFF_FFC0), (3, 4)]), (-4i64) as u64);
}

#[test]
fn sltu_x0_is_snez_acceptance() {
    let sltu = r_type(0, 2, 0, 0b011, 1, 0b0110011); // sltu x1, x0, x2
    assert_eq!(exec_rd(sltu, &[(2, 0)]), 0);
    assert_eq!(exec_rd(sltu, &[(2, 5)]), 1);
    assert_eq!(exec_rd(sltu, &[(2, u64::MAX)]), 1);
}

#[test]
fn fetch_fault_purity_acceptance() {
    let (mut hart, mut bus) = machine();
    hart.regs.pc = 0x1000; // unmapped hole
    for n in 1..32u8 {
        hart.regs.write(n, 0xC0DE_0000_0000_0000 | u64::from(n)); // sentinels
    }
    let before = format!("{}", hart.regs);
    let trap = hart.step(&mut bus).unwrap_err();
    assert_eq!(trap.cause, Exception::InstrAccessFault);
    assert_eq!(trap.tval, 0x1000, "tval must be the faulting PC");
    assert_eq!(
        hart.regs.pc, 0x1000,
        "PC must still point at the faulting instruction"
    );
    assert_eq!(
        format!("{}", hart.regs),
        before,
        "trap mutated architectural state"
    );
}

#[test]
fn illegal_instruction_cause_and_tval() {
    let (mut hart, mut bus) = machine();
    bus.store32(DRAM_BASE, 0x0000_0000).unwrap(); // defined illegal
    let before = format!("{}", hart.regs);
    let trap = hart.step(&mut bus).unwrap_err();
    assert_eq!(trap.cause, Exception::IllegalInstruction);
    assert_eq!(trap.tval, 0, "tval must be the raw instruction word");
    assert_eq!(hart.regs.pc, DRAM_BASE);
    assert_eq!(format!("{}", hart.regs), before);

    bus.store32(DRAM_BASE, 0x0000_100F).unwrap(); // FENCE.I
    let trap = hart.step(&mut bus).unwrap_err();
    assert_eq!(trap.cause, Exception::IllegalInstruction);
    assert_eq!(trap.tval, 0x100F);
}

#[test]
fn ecall_ebreak_now_execute_no_placeholders_remain() {
    // The placeholder-trap list is EMPTY as of E0-T11: lb/sb left at E0-T08,
    // jal/jalr/beq at E0-T09, ecall/ebreak here. The whole RV64I set retires or
    // traps with its own architectural cause. This test pins that ecall/ebreak
    // are NO LONGER IllegalInstruction (E0-T11 owns their real semantics in
    // tests/htif_run.rs; here we just guard against regression to placeholders).
    let ecall = exec(0x0000_0073, &[]).unwrap_err();
    assert_eq!(ecall.cause, Exception::EcallFromM);
    assert_eq!(ecall.tval, 0);
    let ebreak = exec(0x0010_0073, &[]).unwrap_err();
    assert_eq!(ebreak.cause, Exception::Breakpoint);
    assert_eq!(ebreak.tval, DRAM_BASE, "EBREAK tval = pc");
}

#[test]
fn fence_retires_as_nop() {
    let hart = exec(0x0FF0_000F, &[(5, 42)]).expect("fence must retire");
    assert_eq!(hart.regs.pc, DRAM_BASE + 4);
    assert_eq!(hart.regs.read(5), 42);
    assert_eq!(hart.regs.read(0), 0);
}

#[test]
fn x0_writes_discarded_for_every_computational_op() {
    // rd = x0 for one representative of every computational opcode family + LUI/AUIPC.
    let words = [
        u_type(0x12345, 0, 0b0110111),                // lui x0
        u_type(0x12345, 0, 0b0010111),                // auipc x0
        i_type(123, 2, 0b000, 0, 0b0010011),          // addi x0
        i_type(123, 2, 0b010, 0, 0b0010011),          // slti x0
        i_type(123, 2, 0b011, 0, 0b0010011),          // sltiu x0
        i_type(123, 2, 0b100, 0, 0b0010011),          // xori x0
        i_type(123, 2, 0b110, 0, 0b0010011),          // ori x0
        i_type(123, 2, 0b111, 0, 0b0010011),          // andi x0
        r_type(0, 5, 2, 0b001, 0, 0b0010011),         // slli x0 (shamt 5)
        r_type(0, 5, 2, 0b101, 0, 0b0010011),         // srli x0
        i_type(77, 2, 0b000, 0, 0b0011011),           // addiw x0
        r_type(0, 3, 2, 0b000, 0, 0b0110011),         // add x0
        r_type(0b0100000, 3, 2, 0b000, 0, 0b0110011), // sub x0
        r_type(0, 3, 2, 0b000, 0, 0b0111011),         // addw x0
    ];
    for word in words {
        let hart = exec(word, &[(2, 0xDEAD), (3, 0xBEEF)]).expect("must retire");
        assert_eq!(hart.regs.read(0), 0, "{word:#010x} leaked into x0");
        assert_eq!(hart.regs.pc, DRAM_BASE + 4);
    }
}

// ── edge-vector matrix vs the independent reference model ───────────────────

#[test]
fn binary_op_matrix_vs_reference() {
    // (name, funct7, funct3, opcode, reference)
    type Ref = fn(u64, u64) -> u64;
    let ops: &[(&str, u32, u32, u32, Ref)] = &[
        ("add", 0, 0b000, 0b0110011, |a, b| {
            ((a as i128 + b as i128) & 0xFFFF_FFFF_FFFF_FFFF) as u64
        }),
        ("sub", 0b0100000, 0b000, 0b0110011, |a, b| {
            ((a as i128 - b as i128) & 0xFFFF_FFFF_FFFF_FFFF) as u64
        }),
        ("sll", 0, 0b001, 0b0110011, |a, b| a << (b & 63)),
        ("slt", 0, 0b010, 0b0110011, |a, b| {
            (((a as i64) as i128) < ((b as i64) as i128)) as u64
        }),
        ("sltu", 0, 0b011, 0b0110011, |a, b| {
            ((a as u128) < (b as u128)) as u64
        }),
        ("xor", 0, 0b100, 0b0110011, |a, b| a ^ b),
        ("srl", 0, 0b101, 0b0110011, |a, b| a >> (b & 63)),
        ("sra", 0b0100000, 0b101, 0b0110011, |a, b| {
            (((a as i64) as i128) >> (b & 63)) as u64
        }),
        ("or", 0, 0b110, 0b0110011, |a, b| a | b),
        ("and", 0, 0b111, 0b0110011, |a, b| a & b),
        ("addw", 0, 0b000, 0b0111011, |a, b| {
            ref_sext32((a as u128 & 0xFFFF_FFFF) + (b as u128 & 0xFFFF_FFFF))
        }),
        ("subw", 0b0100000, 0b000, 0b0111011, |a, b| {
            ref_sext32(
                ((a as u128 & 0xFFFF_FFFF) + 0x1_0000_0000 - (b as u128 & 0xFFFF_FFFF))
                    & 0xFFFF_FFFF,
            )
        }),
        ("sllw", 0, 0b001, 0b0111011, |a, b| {
            ref_sext32(((a as u128 & 0xFFFF_FFFF) << (b & 31)) & 0xFFFF_FFFF)
        }),
        ("srlw", 0, 0b101, 0b0111011, |a, b| {
            ref_sext32((a as u128 & 0xFFFF_FFFF) >> (b & 31))
        }),
        ("sraw", 0b0100000, 0b101, 0b0111011, |a, b| {
            let x = ((a as u32) as i32) as i128; // interpret low 32 signed
            ref_sext32(((x >> (b & 31)) as u128) & 0xFFFF_FFFF)
        }),
    ];
    for &(name, f7, f3, op, reference) in ops {
        for &a in &EDGES {
            for &b in &EDGES {
                let word = r_type(f7, 3, 2, f3, 1, op);
                let got = exec_rd(word, &[(2, a), (3, b)]);
                assert_eq!(got, reference(a, b), "{name}(a={a:#x}, b={b:#x})");
            }
        }
    }
}

#[test]
fn imm_op_matrix_vs_reference() {
    type RefI = fn(u64, i64) -> u64;
    let ops: &[(&str, u32, u32, RefI)] = &[
        ("addi", 0b000, 0b0010011, |a, i| {
            ((a as i128 + i as i128) & 0xFFFF_FFFF_FFFF_FFFF) as u64
        }),
        ("slti", 0b010, 0b0010011, |a, i| {
            (((a as i64) as i128) < (i as i128)) as u64
        }),
        ("sltiu", 0b011, 0b0010011, |a, i| {
            ((a as u128) < ((i as u64) as u128)) as u64
        }),
        ("xori", 0b100, 0b0010011, |a, i| a ^ (i as u64)),
        ("ori", 0b110, 0b0010011, |a, i| a | (i as u64)),
        ("andi", 0b111, 0b0010011, |a, i| a & (i as u64)),
        ("addiw", 0b000, 0b0011011, |a, i| {
            ref_sext32(((a as i128 + i as i128) as u128) & 0xFFFF_FFFF)
        }),
    ];
    for &(name, f3, op, reference) in ops {
        for &a in &EDGES {
            for imm in [-2048i32, -1, 0, 1, 2047] {
                let word = i_type(imm, 2, f3, 1, op);
                let got = exec_rd(word, &[(2, a)]);
                assert_eq!(
                    got,
                    reference(a, i64::from(imm)),
                    "{name}(a={a:#x}, imm={imm})"
                );
            }
        }
    }
}

#[test]
fn shift_imm_matrix_vs_reference() {
    for &a in &EDGES {
        for shamt in [0u8, 1, 31, 32, 63] {
            // shamt6 encodes across rs2 and funct7's low bit; top6 selects the op
            let slli = ((shamt as u32) << 20) | (2 << 15) | (0b001 << 12) | (1 << 7) | 0b0010011;
            assert_eq!(
                exec_rd(slli, &[(2, a)]),
                a << shamt,
                "slli a={a:#x} sh={shamt}"
            );
            let srli = ((shamt as u32) << 20) | (2 << 15) | (0b101 << 12) | (1 << 7) | 0b0010011;
            assert_eq!(exec_rd(srli, &[(2, a)]), a >> shamt, "srli");
            let srai = (0b010000u32 << 26)
                | ((shamt as u32) << 20)
                | (2 << 15)
                | (0b101 << 12)
                | (1 << 7)
                | 0b0010011;
            assert_eq!(
                exec_rd(srai, &[(2, a)]),
                ((a as i64) >> shamt) as u64,
                "srai"
            );
        }
        for shamt in [0u8, 1, 15, 31] {
            let slliw = ((shamt as u32) << 20) | (2 << 15) | (0b001 << 12) | (1 << 7) | 0b0011011;
            assert_eq!(
                exec_rd(slliw, &[(2, a)]),
                ref_sext32(((a as u128 & 0xFFFF_FFFF) << shamt) & 0xFFFF_FFFF),
                "slliw a={a:#x} sh={shamt}"
            );
            let srliw = ((shamt as u32) << 20) | (2 << 15) | (0b101 << 12) | (1 << 7) | 0b0011011;
            assert_eq!(
                exec_rd(srliw, &[(2, a)]),
                ref_sext32((a as u128 & 0xFFFF_FFFF) >> shamt),
                "srliw"
            );
            let sraiw = (0b0100000u32 << 25)
                | ((shamt as u32) << 20)
                | (2 << 15)
                | (0b101 << 12)
                | (1 << 7)
                | 0b0011011;
            let x = ((a as u32) as i32) as i128;
            assert_eq!(
                exec_rd(sraiw, &[(2, a)]),
                ref_sext32(((x >> shamt) as u128) & 0xFFFF_FFFF),
                "sraiw"
            );
        }
    }
}

#[test]
fn lui_auipc_vs_reference() {
    for imm20 in [0u32, 1, 0x7FFFF, 0x80000, 0xFFFFF, 0x12345] {
        let lui = u_type(imm20, 1, 0b0110111);
        let expect = ref_sext32((imm20 as u128) << 12);
        assert_eq!(exec_rd(lui, &[]), expect, "lui {imm20:#x}");
        let auipc = u_type(imm20, 1, 0b0010111);
        let expect =
            ((DRAM_BASE as i128 + ((expect as i64) as i128)) & 0xFFFF_FFFF_FFFF_FFFF) as u64;
        assert_eq!(exec_rd(auipc, &[]), expect, "auipc {imm20:#x}");
    }
}

// ── srliw sign-of-result attack (adversarial angle 2, done proactively) ─────

#[test]
fn srliw_sign_extends_the_32bit_result() {
    // srliw by 0 on a value with bit 31 set: 32-bit result has bit 31 set → the
    // 64-bit rd must sign-extend it even though the shift was LOGICAL.
    let srliw = (2u32 << 15) | (0b101 << 12) | (1 << 7) | 0b0011011; // shamt=0
    assert_eq!(exec_rd(srliw, &[(2, 0x8000_0000)]), 0xFFFF_FFFF_8000_0000);
    // subw producing 0x8000_0000 must read back negative.
    let subw = r_type(0b0100000, 3, 2, 0b000, 1, 0b0111011);
    let got = exec_rd(subw, &[(2, 0), (3, 0x8000_0000)]);
    assert_eq!(got, 0xFFFF_FFFF_8000_0000);
    assert!((got as i64) < 0);
}

// ── determinism checksum (angle 5): identical stream on native and wasm ─────

/// Fold 20k pseudo-random computational instructions into a hash. The wasm mirror
/// runs the identical generator and asserts the identical constant.
pub fn determinism_checksum() -> u64 {
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    let mut bus = SystemBus::new(Ram::new(RAM as usize).unwrap());
    let mut state: u64 = 0x5EED_2026_0702_0007;
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for _ in 0..20_000 {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let rd = 1 + ((state >> 10) % 31) as u8;
        let rs1 = ((state >> 20) % 32) as u8;
        let rs2 = ((state >> 25) % 32) as u8;
        let f3 = ((state >> 30) & 7) as u32;
        // Alternate among OP (with legal funct7 for the slot), OP-32 subset, OP-IMM.
        let word = match (state >> 33) % 3 {
            0 => {
                let f7 = match f3 {
                    0b000 | 0b101 if state & 1 == 1 => 0b0100000,
                    _ => 0,
                };
                r_type(f7, rs2, rs1, f3, rd, 0b0110011)
            }
            1 => {
                let (f7, f3w) = match f3 & 1 {
                    0 => (if state & 2 == 2 { 0b0100000 } else { 0 }, 0b000),
                    _ => (0, 0b001),
                };
                r_type(f7, rs2, rs1, f3w, rd, 0b0111011)
            }
            _ => i_type(
                ((state >> 40) as i32 & 0xFFF) - 2048,
                rs1,
                f3,
                rd,
                0b0010011,
            ),
        };
        // Skip encodings that are shift-immediates with illegal top bits.
        if wasm_vm_core::decode::decode(word).is_err() {
            continue;
        }
        bus.store32(hart.regs.pc, word).unwrap();
        if hart.step(&mut bus).is_err() {
            continue;
        }
        if hart.regs.pc >= DRAM_BASE + RAM - 8 {
            hart.regs.pc = DRAM_BASE;
        }
        hash = (hash ^ hart.regs.read(rd)).wrapping_mul(0x100_0000_01b3);
        hash = (hash ^ hart.regs.pc).wrapping_mul(0x100_0000_01b3);
    }
    hash
}

#[test]
#[cfg_attr(miri, ignore)] // 20k interpreted fetch-decode-execute cycles take HOURS
// under miri (measured: >86 CPU-min). This is a cross-target determinism gate, not a
// UB probe — the matrix tests above walk the same code paths under miri in minutes.
fn determinism_checksum_matches_pinned_native_value() {
    // Pinned from the first native run; the wasm mirror asserts the same constant.
    // If this changes, semantics changed — that is the point.
    assert_eq!(determinism_checksum(), PINNED_CHECKSUM);
}

pub const PINNED_CHECKSUM: u64 = 0x6CF5_617F_8ABB_9804; // pinned from first native run
