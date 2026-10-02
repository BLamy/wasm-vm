//! Direct-chain integer handoff checked against an independent full-array oracle.
#![cfg(not(feature = "zicsr-stub"))]

use sha2::{Digest, Sha256};
use wasm_vm_core::hart::Hart;
use wasm_vm_core::jit::CpuStateHandoff;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn sparse_handoff_matches_full_array_oracle() {
    let mut masks = vec![0, 1, u32::MAX, !1, 0xaaaa_aaaa, 0x5555_5555];
    for first in 0..32 {
        masks.push(1 << first);
        for second in first + 1..32 {
            masks.push((1 << first) | (1 << second));
        }
    }
    let mut random = 0x4755_4553_545f_4a49_u64;
    for _ in 0..10_000 {
        random = random
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        masks.push((random >> 32) as u32);
    }
    let mut hart = Hart::default();
    hart.regs.pc = 0xffff_ffff_8000_0000;
    let mut oracle = [0u64; 32];
    let mut handoff = CpuStateHandoff::default();
    let mut digest = Sha256::new();
    for (round, &mask) in masks.iter().enumerate() {
        let words: [u64; 32] = core::array::from_fn(|reg| {
            0x9182_7364_5546_3728_u64
                .wrapping_mul(reg as u64 + 1)
                .rotate_left(round as u32 & 63)
                ^ round as u64
        });
        // Independent little-endian ABI writer, including a deliberately poisoned x0.
        for (reg, word) in words.iter().enumerate() {
            handoff.as_mut_bytes()[8 * reg..8 * reg + 8].copy_from_slice(&word.to_le_bytes());
        }
        let transport = *handoff.as_bytes();
        let before = hart.regs.jit_version();
        handoff.commit_registers_mask(&mut hart, mask);
        for reg in 1..32 {
            if (mask >> reg) & 1 == 1 {
                oracle[reg] = words[reg];
            }
        }
        for (reg, expected) in oracle.iter().enumerate() {
            assert_eq!(
                hart.regs.read(reg as u8),
                *expected,
                "round {round}, x{reg}"
            );
            digest.update(expected.to_le_bytes());
        }
        assert_eq!(hart.regs.pc, 0xffff_ffff_8000_0000);
        assert_eq!(hart.regs.jit_version(), before + u64::from(mask >> 1 != 0));
        assert_eq!(
            *handoff.as_bytes(),
            transport,
            "commit must not alter its source"
        );
        digest.update(mask.to_le_bytes());
    }
    println!(
        "SPARSE_HANDOFF masks={} state_sha256={:x}",
        masks.len(),
        digest.finalize()
    );
}
