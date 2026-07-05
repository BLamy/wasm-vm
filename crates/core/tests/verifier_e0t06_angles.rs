//! E0-T06 adversarial verifier: task angles 2-5 with verifier-chosen inputs.
use Instr::*;
use wasm_vm_core::decode::{Instr, decode};

/// Angle 2: B/J range extremes, words computed by the VERIFIER from the spec
/// bit-scramble formulas (independently cross-checked against clang+llvm-objdump).
#[test]
fn angle2_scramble_extremes() {
    // beq x17,x25,+4094 / bne x17,x25,-4096 (assembler-confirmed)
    assert_eq!(
        decode(0x7f988fe3),
        Ok(Beq {
            rs1: 17,
            rs2: 25,
            imm: 4094
        })
    );
    assert_eq!(
        decode(0x81989063),
        Ok(Bne {
            rs1: 17,
            rs2: 25,
            imm: -4096
        })
    );
    // jal x7 +/- 1 MiB edges (assembler-confirmed)
    assert_eq!(
        decode(0x7ffff3ef),
        Ok(Jal {
            rd: 7,
            imm: 1048574
        })
    );
    assert_eq!(
        decode(0x800003ef),
        Ok(Jal {
            rd: 7,
            imm: -1048576
        })
    );
    // +2048: imm[11] lives in insn[7] (assembler-confirmed 0x00e700e3)
    assert_eq!(
        decode(0x00e700e3),
        Ok(Beq {
            rs1: 14,
            rs2: 14,
            imm: 2048
        })
    );
    // flip insn[7] off => imm loses bit 11 => 0 (still beq, offset 0... x0 regs differ)
    match decode(0x00e70063) {
        Ok(Beq { imm, .. }) => assert_eq!(imm, 0),
        other => panic!("{other:?}"),
    }
}

/// Angle 3: strided full-range sweep (verifier stride/phase) + 1M random (verifier seed).
#[test]
fn angle3_no_panics_verifier_seed() {
    let mut w: u32 = 7; // different phase than worker's 0
    loop {
        let _ = decode(w);
        match w.checked_add(0x0F423) {
            // stride 62499, coprime-ish, ~68k probes
            Some(n) => w = n,
            None => break,
        }
    }
    let mut state: u64 = 0xC917_5EED_0702_2026; // verifier seed
    for _ in 0..1_000_000 {
        state = state
            .wrapping_mul(2862933555777941757)
            .wrapping_add(3037000493);
        let _ = decode((state >> 20) as u32);
    }
}

/// Angle 4: FENCE hint-space policy — nonzero fm/pred/succ decode; FENCE.I illegal.
#[test]
fn angle4_fence_policy() {
    // fence w,r ; fence i,o ; fence iorw,w (assembler words from verifier.dump)
    assert_eq!(
        decode(0x0120000f),
        Ok(Fence {
            rd: 0,
            rs1: 0,
            fm: 0,
            pred: 1,
            succ: 2
        })
    );
    assert_eq!(
        decode(0x0840000f),
        Ok(Fence {
            rd: 0,
            rs1: 0,
            fm: 0,
            pred: 8,
            succ: 4
        })
    );
    assert_eq!(
        decode(0x0f10000f),
        Ok(Fence {
            rd: 0,
            rs1: 0,
            fm: 0,
            pred: 15,
            succ: 1
        })
    );
    // fence.tso
    assert_eq!(
        decode(0x8330000f),
        Ok(Fence {
            rd: 0,
            rs1: 0,
            fm: 8,
            pred: 3,
            succ: 3
        })
    );
    // FENCE.I (funct3=001) illegal at Level 0 — canonical word and a garnished one
    assert!(decode(0x0000100f).is_err());
    assert!(decode(0xffff100f).is_err());
    // exotic fm + nonzero rd/rs1 still FENCE per spec forward-compat (fields ignored)
    assert_eq!(
        decode(0x42d28d0f),
        Ok(Fence {
            rd: 26,
            rs1: 5,
            fm: 4,
            pred: 2,
            succ: 13
        })
    );
}

/// Angle 5: sign extension — addi x1, x0, -1 gives imm == -1, never 4095.
#[test]
fn angle5_addi_sign_extension() {
    match decode(0xfff00093) {
        Ok(Addi { rd: 1, rs1: 0, imm }) => {
            assert_eq!(imm, -1i64);
            assert_ne!(imm, 4095);
        }
        other => panic!("wrong decode: {other:?}"),
    }
}
