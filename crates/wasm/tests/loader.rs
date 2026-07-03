//! wasm32 mirror of the E0-T10 ELF loader suite (`wasm-pack test --node`) — the
//! loader must behave identically on a 32-bit-usize target (u64 arithmetic intact).

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::loader::{ElfError, load_elf};
use wasm_vm_core::ram::Ram;

const ELF: &[u8] = include_bytes!("../../core/tests/fixtures/minimal.elf");
const RAM_SIZE: usize = 64 * 1024;
const DRAM_BASE: u64 = 0x8000_0000;

#[wasm_bindgen_test]
fn fixture_loads_on_wasm32() {
    let mut r = Ram::new(RAM_SIZE).unwrap();
    let img = load_elf(ELF, &mut r).unwrap();
    assert_eq!(img.entry, 0x8000_0000);
    assert_eq!(img.tohost, Some(0x8000_1000));
    assert_eq!(img.fromhost, Some(0x8000_1008));
    // First text word: lui a0, 0x12345 → rd = x10 → 0x12345537 (cross-checked
    // against fixtures/minimal.objdump.txt; NB the E0-T06 golden 0x123452b7 is
    // lui t0 — different rd, a bug this very test caught in its first draft).
    let mut w = [0u8; 4];
    r.read_slice(DRAM_BASE, &mut w).unwrap();
    assert_eq!(u32::from_le_bytes(w), 0x1234_5537);
}

#[wasm_bindgen_test]
fn bss_zero_fill_and_errors_on_wasm32() {
    let mut r = Ram::new(RAM_SIZE).unwrap();
    let junk = vec![0xAAu8; RAM_SIZE];
    r.write_slice(DRAM_BASE, &junk).unwrap();
    load_elf(ELF, &mut r).unwrap();
    let mut bss = [0xFFu8; 16];
    r.read_slice(0x8000_1021, &mut bss).unwrap();
    assert!(bss.iter().all(|&b| b == 0));

    // Error precision + overflow arithmetic on 32-bit usize.
    let mut v = ELF.to_vec();
    v[4] = 1;
    assert_eq!(load_elf(&v, &mut r), Err(ElfError::WrongClass));
    let mut v = ELF.to_vec();
    v[64 + 32..64 + 40].copy_from_slice(&u64::MAX.to_le_bytes());
    v[64 + 40..64 + 48].copy_from_slice(&u64::MAX.to_le_bytes());
    assert_eq!(load_elf(&v, &mut r), Err(ElfError::Truncated));
    let mut v = ELF.to_vec();
    v[64 + 24..64 + 32].copy_from_slice(&(u64::MAX - 100).to_le_bytes());
    assert_eq!(load_elf(&v, &mut r), Err(ElfError::SegmentOutOfRam));
}

#[wasm_bindgen_test]
fn mutation_fuzz_10k_no_panics_on_wasm32() {
    let mut r = Ram::new(RAM_SIZE).unwrap();
    let mut state: u64 = 0x5EED_2026_0702_0010;
    for _ in 0..10_000 {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let mut v = ELF.to_vec();
        let idx = (state as usize >> 16) % v.len();
        v[idx] = (state >> 40) as u8;
        let _ = load_elf(&v, &mut r);
    }
}
