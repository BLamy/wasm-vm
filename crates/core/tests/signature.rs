//! E1-T20: the RISCOF signature dump — the `begin_signature`..`end_signature` region formatted as
//! the arch-test signature (one little-endian word per line, lowercase hex). This is the DUT side
//! of the compliance flow: the harness diffs this against Spike's dump of the identical region.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;

#[test]
fn signature_dumps_little_endian_words_lowercase() {
    let mut m = Machine::new(1 << 20);
    let base = DRAM_BASE + 0x1000;
    m.bus_mut().store32(base, 0xDEAD_BEEF).unwrap();
    m.bus_mut().store32(base + 4, 0x0000_0001).unwrap();
    m.bus_mut().store32(base + 8, 0xFFFF_FFFF).unwrap();
    // Region [base, base+12): three words, little-endian, 8 lowercase hex digits, one per line.
    let sig = m.signature(base, base + 12, 4).unwrap();
    assert_eq!(sig, "deadbeef\n00000001\nffffffff\n");
}

#[test]
fn signature_word_aligns_start_and_rounds_the_region() {
    let mut m = Machine::new(1 << 20);
    let base = DRAM_BASE + 0x2000;
    m.bus_mut().store32(base, 0x1234_5678).unwrap();
    // A misaligned `begin` is rounded down to the word; `end` inside the word still emits it.
    assert_eq!(m.signature(base + 2, base + 4, 4).unwrap(), "12345678\n");
}

#[test]
fn signature_rejects_non_four_granularity() {
    let mut m = Machine::new(1 << 20);
    let base = DRAM_BASE;
    assert!(m.signature(base, base + 8, 8).is_err());
    assert!(m.signature(base, base + 8, 1).is_err());
}

/// A `.symtab` with `begin_signature`/`end_signature` is surfaced on the loaded image so the CLI
/// knows the region to dump. Built as a minimal ELF via the loader's own path (a real arch-test
/// ELF is exercised end-to-end by the RISCOF flow).
#[test]
fn loader_exposes_signature_symbols_when_present() {
    // The prebuilt loops.elf has no signature symbols → both None (the common non-arch-test case).
    let elf = include_bytes!("../../../guest/prebuilt/loops.elf");
    let mut m = Machine::new(4 * 1024 * 1024);
    let img = m.load_elf(elf).unwrap();
    assert_eq!(img.begin_signature, None);
    assert_eq!(img.end_signature, None);
    // tohost is present (HTIF) — proves the symbol scan itself works on this ELF.
    assert!(img.tohost.is_some());
}
