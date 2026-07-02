//! E0-T10 loader suite: fixture load vs committed readelf dumps, BSS zero-fill,
//! error precision on malformed inputs, no-partial-write contract, mutation fuzz.
//!
//! Fixture provenance: crates/core/tests/fixtures/{minimal.s, link.ld, build.sh}
//! rebuild minimal.elf reproducibly (docker alpine clang/lld); the committed
//! minimal.readelf.txt / minimal.objdump.txt are the cross-check references.

use wasm_vm_core::loader::{ElfError, load_elf};
use wasm_vm_core::ram::Ram;

const ELF: &[u8] = include_bytes!("fixtures/minimal.elf");
const READELF: &str = include_str!("fixtures/minimal.readelf.txt");
const RAM_SIZE: usize = 64 * 1024;
const DRAM_BASE: u64 = 0x8000_0000;

fn ram() -> Ram {
    Ram::new(RAM_SIZE).unwrap()
}

// ── fixture loads, cross-checked against the committed readelf dump ─────────

#[test]
fn fixture_loads_and_matches_committed_readelf_dump() {
    let mut r = ram();
    let img = load_elf(ELF, &mut r).unwrap();

    // Entry parsed from the COMMITTED dump text, not hardcoded.
    let entry_line = READELF
        .lines()
        .find(|l| l.contains("Entry point address:"))
        .unwrap();
    let entry_from_dump =
        u64::from_str_radix(entry_line.split("0x").nth(1).unwrap().trim(), 16).unwrap();
    assert_eq!(img.entry, entry_from_dump);

    // Segment placement from the dump's LOAD lines: PhysAddr / FileSiz / MemSiz.
    let mut checked = 0;
    for l in READELF.lines() {
        let l = l.trim();
        if !l.starts_with("LOAD") {
            continue;
        }
        let cols: Vec<&str> = l.split_whitespace().collect();
        let paddr = u64::from_str_radix(cols[3].trim_start_matches("0x"), 16).unwrap();
        let filesz = u64::from_str_radix(cols[4].trim_start_matches("0x"), 16).unwrap();
        let off = u64::from_str_radix(cols[1].trim_start_matches("0x"), 16).unwrap();
        // Loaded bytes must equal the file's segment bytes.
        let mut got = vec![0u8; filesz as usize];
        r.read_slice(paddr, &mut got).unwrap();
        assert_eq!(
            got,
            &ELF[off as usize..(off + filesz) as usize],
            "segment at {paddr:#x} content mismatch"
        );
        checked += 1;
    }
    assert_eq!(checked, 2, "fixture must have exactly 2 LOAD segments");

    // HTIF symbols from the committed symbol table dump.
    assert_eq!(img.tohost, Some(0x8000_1000));
    assert_eq!(img.fromhost, Some(0x8000_1008));
}

#[test]
fn bss_zero_fill_over_preseeded_ram() {
    let mut r = ram();
    // Pre-seed all of RAM with 0xAA, then load; BSS must read back zero.
    let junk = vec![0xAAu8; RAM_SIZE];
    r.write_slice(DRAM_BASE, &junk).unwrap();
    load_elf(ELF, &mut r).unwrap();
    // Data segment: filesz 0x21, memsz 0x121 → BSS = [0x80001021, 0x80001121).
    let mut bss = vec![0xFFu8; 0x100];
    r.read_slice(0x8000_1021, &mut bss).unwrap();
    assert!(
        bss.iter().all(|&b| b == 0),
        "BSS must be zero-filled over pre-seeded RAM"
    );
    // And the byte AFTER memsz keeps its seed (no over-fill).
    let mut after = [0u8; 1];
    r.read_slice(0x8000_1121, &mut after).unwrap();
    assert_eq!(after[0], 0xAA, "zero-fill wrote past p_memsz");
}

// ── malformed inputs: precise errors, no panics ──────────────────────────────

fn patched(off: usize, val: u8) -> Vec<u8> {
    let mut v = ELF.to_vec();
    v[off] = val;
    v
}

#[test]
fn malformed_battery_returns_precise_errors() {
    let mut r = ram();
    // Truncated header
    assert_eq!(load_elf(&ELF[..63], &mut r), Err(ElfError::Truncated));
    assert_eq!(load_elf(&[], &mut r), Err(ElfError::BadMagic));
    // Bad magic
    assert_eq!(load_elf(&patched(0, 0x7E), &mut r), Err(ElfError::BadMagic));
    // ELFCLASS32 → class, not machine (error precision)
    assert_eq!(load_elf(&patched(4, 1), &mut r), Err(ElfError::WrongClass));
    // Big-endian
    assert_eq!(load_elf(&patched(5, 2), &mut r), Err(ElfError::WrongEndian));
    // x86-64 (e_machine = 62) → machine
    let mut x86 = ELF.to_vec();
    x86[18] = 62;
    x86[19] = 0;
    assert_eq!(load_elf(&x86, &mut r), Err(ElfError::WrongMachine));
    // ET_DYN → type
    assert_eq!(load_elf(&patched(16, 3), &mut r), Err(ElfError::WrongType));
    // e_phoff past EOF
    let mut v = ELF.to_vec();
    v[32..40].copy_from_slice(&(u64::MAX - 8).to_le_bytes());
    assert_eq!(load_elf(&v, &mut r), Err(ElfError::Truncated));
    // e_phnum = 0xFFFF (overflow-adjacent table walk)
    let mut v = ELF.to_vec();
    v[56..58].copy_from_slice(&0xFFFFu16.to_le_bytes());
    let e = load_elf(&v, &mut r).unwrap_err();
    assert!(matches!(e, ElfError::Truncated | ElfError::SegmentOutOfRam));
}

#[test]
fn overflow_attacks_in_program_headers() {
    // Locate ph[0] (e_phoff = 64) and attack its fields with extreme values.
    let mut r = ram();
    // p_filesz = u64::MAX → file_range overflow → Truncated
    let mut v = ELF.to_vec();
    v[64 + 32..64 + 40].copy_from_slice(&u64::MAX.to_le_bytes());
    v[64 + 40..64 + 48].copy_from_slice(&u64::MAX.to_le_bytes()); // memsz too (filesz<=memsz)
    assert_eq!(load_elf(&v, &mut r), Err(ElfError::Truncated));
    // p_paddr = u64::MAX - 100 with real memsz → SegmentOutOfRam, checked math
    let mut v = ELF.to_vec();
    v[64 + 24..64 + 32].copy_from_slice(&(u64::MAX - 100).to_le_bytes());
    assert_eq!(load_elf(&v, &mut r), Err(ElfError::SegmentOutOfRam));
    // p_filesz > p_memsz is malformed
    let mut v = ELF.to_vec();
    v[64 + 32..64 + 40].copy_from_slice(&0x200u64.to_le_bytes());
    v[64 + 40..64 + 48].copy_from_slice(&0x100u64.to_le_bytes());
    assert_eq!(load_elf(&v, &mut r), Err(ElfError::Truncated));
}

#[test]
fn no_partial_writes_when_second_segment_is_bad() {
    // Two-pass contract: make the SECOND load segment out-of-RAM; the (valid)
    // first segment must NOT have been copied when load_elf errs.
    let mut r = ram();
    let seed = vec![0x55u8; RAM_SIZE];
    r.write_slice(DRAM_BASE, &seed).unwrap();
    let mut before = vec![0u8; RAM_SIZE];
    r.read_slice(DRAM_BASE, &mut before).unwrap();

    // ph[1] is the second LOAD (e_phoff=64, entsize=56 → offset 120): break paddr.
    let mut v = ELF.to_vec();
    v[120 + 24..120 + 32].copy_from_slice(&0xFFFF_0000u64.to_le_bytes()); // outside RAM
    assert_eq!(load_elf(&v, &mut r), Err(ElfError::SegmentOutOfRam));

    let mut after = vec![0u8; RAM_SIZE];
    r.read_slice(DRAM_BASE, &mut after).unwrap();
    assert_eq!(
        before, after,
        "RAM must be untouched when any segment fails validation"
    );
}

// ── mutation fuzz: panic-free on garbage (adversarial angle 1, proactive) ────

// Full volume natively; reduced under miri (interpretation is ~1000x slower and the
// point there is UB detection on the parse paths, not volume).
#[cfg(miri)]
const FUZZ_ITERS: u64 = 500;
#[cfg(not(miri))]
const FUZZ_ITERS: u64 = 100_000;

#[test]
fn mutation_fuzz_100k_no_panics() {
    let mut r = ram();
    let mut state: u64 = 0x5EED_2026_0702_0010;
    for _ in 0..FUZZ_ITERS {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let mut v = ELF.to_vec();
        // 1-4 random byte mutations
        for _ in 0..=(state % 4) {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let idx = (state as usize >> 16) % v.len();
            v[idx] = (state >> 40) as u8;
        }
        let _ = load_elf(&v, &mut r); // any panic fails the test
    }
    // And pure-garbage buffers of assorted lengths.
    for len in [0usize, 1, 3, 4, 63, 64, 65, 120, 4096] {
        let garbage: Vec<u8> = (0..len)
            .map(|i| {
                state = state
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                (state >> 32) as u8 ^ i as u8
            })
            .collect();
        let _ = load_elf(&garbage, &mut r);
    }
}
