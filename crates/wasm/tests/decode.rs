//! wasm32 mirror of the E0-T06 decoder suite (`wasm-pack test --node`) — a subset of
//! the assembler-derived golden table plus negatives, executed on the real target.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::decode::{Instr, decode};

#[wasm_bindgen_test]
fn golden_subset_on_wasm32() {
    use Instr::*;
    let table: &[(u32, Instr)] = &[
        (
            0xfff00093,
            Addi {
                rd: 1,
                rs1: 0,
                imm: -1,
            },
        ),
        (
            0x123452b7,
            Lui {
                rd: 5,
                imm: 0x12345000,
            },
        ),
        (0x008000ef, Jal { rd: 1, imm: 8 }),
        (
            0x7ffff06f,
            Jal {
                rd: 0,
                imm: 1048574,
            },
        ),
        (
            0x8000006f,
            Jal {
                rd: 0,
                imm: -1048576,
            },
        ),
        (
            0x7e000fe3,
            Beq {
                rs1: 0,
                rs2: 0,
                imm: 4094,
            },
        ),
        (
            0x80000063,
            Beq {
                rs1: 0,
                rs2: 0,
                imm: -4096,
            },
        ),
        (
            0x80743023,
            Sd {
                rs1: 8,
                rs2: 7,
                imm: -2048,
            },
        ),
        (
            0x43f55493,
            Srai {
                rd: 9,
                rs1: 10,
                shamt: 63,
            },
        ),
        (
            0x41f5549b,
            Sraiw {
                rd: 9,
                rs1: 10,
                shamt: 31,
            },
        ),
        (
            0x8330000f,
            Fence {
                rd: 0,
                rs1: 0,
                fm: 0x8,
                pred: 0x3,
                succ: 0x3,
            },
        ),
        (0x00000073, Ecall),
        (0x00100073, Ebreak),
    ];
    for &(word, expected) in table {
        assert_eq!(decode(word), Ok(expected), "word {word:#010x}");
    }
}

#[wasm_bindgen_test]
fn negatives_on_wasm32() {
    for w in [
        0x00000000u32,
        0xFFFFFFFF,
        0x00000001,
        // FENCE.I (0x0000100F) and CSRRW (0x00101073) became LEGAL in the default Zicsr
        // decoder (E1-T02) — no longer illegal probes here.
        0x02208033, // MUL — still illegal until E1-T03
        0x0201109B, // SLLIW imm[5]=1
        0x0000200F, // MISC-MEM funct3=010, reserved
    ] {
        assert!(decode(w).is_err(), "{w:#010x} must be illegal");
    }
}

#[wasm_bindgen_test]
fn random_sweep_never_panics_on_wasm32() {
    let mut state: u64 = 0x5EED_2026_0702_0616;
    for _ in 0..200_000 {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let _ = decode((state >> 24) as u32);
    }
}
