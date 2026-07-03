//! E0-T21 wasm subset: 1,000 decoder round-trip cases on wasm32 (`wasm-pack test --node`),
//! proving the decoder behaves identically off-native. proptest's forking + entropy
//! machinery does not fit `wasm32-unknown-unknown`, so the same round-trip property is
//! driven by a fixed-seed xorshift generator over field-wise-legal encodings — the encoder
//! is written from the spec, independent of decode.rs (same oracle as the native
//! `decode_props.rs`).
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::decode::{Instr, decode};

// Spec-derived encoders (mirror of the native oracle).
fn r(op: u32, f3: u32, f7: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (f7 << 25) | ((rs2 as u32) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn i_enc(op: u32, f3: u32, rd: u8, rs1: u8, imm: i64) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn s_enc(op: u32, f3: u32, rs1: u8, rs2: u8, imm: i64) -> u32 {
    let u = imm as u32;
    (((u >> 5) & 0x7F) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((u & 0x1F) << 7)
        | op
}
fn u_enc(op: u32, rd: u8, imm20: u32) -> u32 {
    (imm20 << 12) | ((rd as u32) << 7) | op
}

fn encode(instr: &Instr) -> u32 {
    use Instr::*;
    match *instr {
        Add { rd, rs1, rs2 } => r(0b0110011, 0b000, 0, rd, rs1, rs2),
        Sub { rd, rs1, rs2 } => r(0b0110011, 0b000, 0b0100000, rd, rs1, rs2),
        Xor { rd, rs1, rs2 } => r(0b0110011, 0b100, 0, rd, rs1, rs2),
        Sltu { rd, rs1, rs2 } => r(0b0110011, 0b011, 0, rd, rs1, rs2),
        Addi { rd, rs1, imm } => i_enc(0b0010011, 0b000, rd, rs1, imm),
        Ori { rd, rs1, imm } => i_enc(0b0010011, 0b110, rd, rs1, imm),
        Lw { rd, rs1, imm } => i_enc(0b0000011, 0b010, rd, rs1, imm),
        Sw { rs1, rs2, imm } => s_enc(0b0100011, 0b010, rs1, rs2, imm),
        Lui { rd, imm } => u_enc(0b0110111, rd, ((imm >> 12) as u32) & 0xFFFFF),
        _ => unreachable!("generator only builds the covered variants"),
    }
}

#[wasm_bindgen_test]
fn decoder_round_trips_1000_cases_on_wasm32() {
    let mut x: u32 = 0x9E37_79B9; // fixed seed → deterministic
    let mut next = || {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        x
    };
    let reg = |v: u32| (v & 0x1F) as u8;
    let imm12 = |v: u32| ((v & 0xFFF) as i32 as i64) << 52 >> 52; // sign-extend 12 bits

    for _ in 0..1000 {
        let sel = next() % 9;
        let (rd, rs1, rs2) = (reg(next()), reg(next()), reg(next()));
        let imm = imm12(next());
        let w = match sel {
            0 => r(0b0110011, 0b000, 0, rd, rs1, rs2),         // add
            1 => r(0b0110011, 0b000, 0b0100000, rd, rs1, rs2), // sub
            2 => r(0b0110011, 0b100, 0, rd, rs1, rs2),         // xor
            3 => r(0b0110011, 0b011, 0, rd, rs1, rs2),         // sltu
            4 => i_enc(0b0010011, 0b000, rd, rs1, imm),        // addi
            5 => i_enc(0b0010011, 0b110, rd, rs1, imm),        // ori
            6 => i_enc(0b0000011, 0b010, rd, rs1, imm),        // lw
            7 => s_enc(0b0100011, 0b010, rs1, rs2, imm),       // sw
            _ => u_enc(0b0110111, rd, next() & 0xFFFFF),       // lui
        };
        let d = decode(w).expect("generated a legal word");
        assert_eq!(
            encode(&d),
            w,
            "wasm round-trip mismatch for {w:#010x} -> {d:?}"
        );
    }
}

/// Semantic-value check on wasm32: the word round-trip above re-masks to the architectural
/// field and is blind to immediate sign-extension, so pin a few negative immediates to
/// their exact decoded value (words hand-assembled from the spec; assembler-confirmed).
#[wasm_bindgen_test]
fn negative_immediates_decode_signed_on_wasm32() {
    use Instr::*;
    assert_eq!(
        decode(0xfff1_0093),
        Ok(Addi {
            rd: 1,
            rs1: 2,
            imm: -1
        })
    );
    assert_eq!(
        decode(0x8000_0293),
        Ok(Addi {
            rd: 5,
            rs1: 0,
            imm: -2048
        })
    );
    assert_eq!(
        decode(0xfe61_3c23),
        Ok(Sd {
            rs1: 2,
            rs2: 6,
            imm: -8
        })
    );
    assert_eq!(decode(0xffdf_f06f), Ok(Jal { rd: 0, imm: -4 }));
}
