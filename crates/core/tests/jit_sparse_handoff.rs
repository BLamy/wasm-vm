//! Direct-chain integer handoff checked against an independent full-array oracle.
#![cfg(not(feature = "zicsr-stub"))]

use sha2::{Digest, Sha256};
use wasm_vm_core::hart::Hart;
use wasm_vm_core::jit::CpuStateHandoff;

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn sparse_handoff_matches_full_array_oracle() {
    let mut masks = vec![0, 1, u32::MAX, !1, 0xaaaa_aaaa, 0x5555_5555];
    // Every density, with and without x0, including both sides of the sparse/scan threshold.
    for count in 0..=31 {
        let mask = ((1_u32 << count) - 1) << 1;
        masks.extend([mask, mask | 1]);
    }
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

/// A verifier-authored composition attack: a mask and its disjoint complement must
/// equal a full commit, while same-value writes still count as separate mutations.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn disjoint_rotated_masks_compose_without_losing_same_value_stamps() {
    fn next(state: &mut u64) -> u64 {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        *state
    }

    let mut digest = Sha256::new();
    let mut cases = 0;
    for mut random in [
        0x61da_209f_4bc8_e357,
        0xb043_97ac_82ef_165d,
        0x9c17_fba5_6d30_42e9,
    ] {
        for count in 0..=31 {
            for rotation in 0..31 {
                for x0_bit in [0, 1] {
                    let initial: [u64; 32] = core::array::from_fn(|_| next(&mut random));
                    let mut words: [u64; 32] = core::array::from_fn(|_| next(&mut random));
                    words[0] |= 1;
                    let pc = next(&mut random);
                    let mut selected = [false; 32];
                    let mut mask = x0_bit;
                    for offset in 0..count {
                        let reg = (rotation + offset) % 31 + 1;
                        selected[reg] = true;
                        mask |= 1_u32 << reg;
                    }
                    let complement = (!mask & !1) | (1 - x0_bit);
                    let mut whole = Hart::default();
                    let mut split = Hart::default();
                    whole.regs.pc = pc;
                    split.regs.pc = pc;
                    for (reg, value) in initial.iter().enumerate().skip(1) {
                        whole.regs.write(reg as u8, *value);
                        split.regs.write(reg as u8, *value);
                    }
                    let before = split.regs.jit_version();
                    let mut handoff = CpuStateHandoff::default();
                    for (reg, word) in words.iter().enumerate() {
                        handoff.as_mut_bytes()[8 * reg..8 * reg + 8]
                            .copy_from_slice(&word.to_le_bytes());
                    }
                    let transport = *handoff.as_bytes();
                    handoff.commit_registers_mask(&mut whole, u32::MAX);
                    for repetition in 1..=2 {
                        handoff.commit_registers_mask(&mut split, mask);
                        for reg in 0..32 {
                            let expected = if reg == 0 {
                                0
                            } else if selected[reg] {
                                words[reg]
                            } else {
                                initial[reg]
                            };
                            assert_eq!(
                                split.regs.read(reg as u8),
                                expected,
                                "count={count} rotation={rotation} x{reg} repeat={repetition}"
                            );
                        }
                        assert_eq!(
                            split.regs.jit_version(),
                            before + repetition * u64::from(count != 0),
                            "same-value commits must retain mutation stamps"
                        );
                    }
                    handoff.commit_registers_mask(&mut split, complement);
                    for (reg, word) in words.iter().enumerate() {
                        let expected = if reg == 0 { 0 } else { *word };
                        assert_eq!(split.regs.read(reg as u8), expected);
                        assert_eq!(whole.regs.read(reg as u8), expected);
                        digest.update(expected.to_le_bytes());
                    }
                    assert_eq!(whole.regs.jit_version(), before + 1);
                    assert_eq!(
                        split.regs.jit_version(),
                        before + 2 * u64::from(count != 0) + u64::from(count != 31)
                    );
                    assert_eq!(split.regs.pc, pc);
                    assert_eq!(whole.regs.pc, pc);
                    assert_eq!(*handoff.as_bytes(), transport);
                    digest.update(mask.to_le_bytes());
                    digest.update(pc.to_le_bytes());
                    cases += 1;
                }
            }
        }
    }
    assert_eq!(cases, 5952);
    println!(
        "VERIFIER_HANDOFF cases={cases} state_sha256={:x}",
        digest.finalize()
    );
}
