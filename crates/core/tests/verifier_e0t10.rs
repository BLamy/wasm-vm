//! ADVERSARIAL VERIFIER harness for E0-T10 (fresh session, seed distinct from worker).
//! Heavy fuzz + overflow battery + symtab crafting + partial-write contract probes.
//! Any panic / overflow (overflow-checks on in dev) / OOB RAM write refutes.

use wasm_vm_core::loader::{ElfError, load_elf};
use wasm_vm_core::ram::Ram;

const ELF: &[u8] = include_bytes!("fixtures/minimal.elf");
const RAM_SIZE: usize = 64 * 1024;
const DRAM_BASE: u64 = 0x8000_0000;

fn ram() -> Ram {
    Ram::new(RAM_SIZE).unwrap()
}

// ---- heavy fuzz: 2M iters, verifier seed, targeted header-field smashing ----
// Committed at CI-appropriate volume; the 2M-iter campaign that ran during
// E0-T10 verification is preserved as fuzz-corpus provenance, not run in CI.
#[cfg(miri)]
const FUZZ_ITERS: u64 = 500;
#[cfg(not(miri))]
const FUZZ_ITERS: u64 = 200_000;

#[test]
fn v_fuzz_2m_targeted_no_panic() {
    let mut r = ram();
    // verifier seed, deliberately different from worker's 0x5EED_2026_0702_0010
    let mut s: u64 = 0xA11CE_u64.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xDEAD_BEEF_CAFE_F00D;
    let next = |s: &mut u64| -> u64 {
        *s = s
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        *s
    };
    // Interesting field offsets in the ELF header + first two program headers.
    let hot: [usize; 19] = [
        4,
        5,
        16,
        17,
        18,
        19,
        24,
        32,
        40,
        54,
        56,
        58,
        60, // ehdr identity/tables
        64,
        64 + 8,
        64 + 24,
        64 + 32,
        64 + 40,  // ph[0] type/off/paddr/filesz
        120 + 24, // ph[1] paddr
    ];
    let interesting: [u64; 9] = [
        0,
        1,
        0xFF,
        0xFFFF,
        u64::MAX,
        u64::MAX - 100,
        0x8000_0000,
        0x1_0000_0000,
        0x7FFF_FFFF_FFFF_FFFF,
    ];
    for _ in 0..FUZZ_ITERS {
        let mut v = ELF.to_vec();
        let nmut = 1 + (next(&mut s) % 6);
        for _ in 0..nmut {
            let pick = next(&mut s) % 3;
            match pick {
                0 => {
                    // single random byte anywhere
                    let idx = (next(&mut s) as usize >> 13) % v.len();
                    v[idx] = (next(&mut s) >> 40) as u8;
                }
                1 => {
                    // write an interesting u64 at a hot 8-byte field
                    let base = hot[(next(&mut s) as usize) % hot.len()];
                    let val = interesting[(next(&mut s) as usize) % interesting.len()];
                    if base + 8 <= v.len() {
                        v[base..base + 8].copy_from_slice(&val.to_le_bytes());
                    }
                }
                _ => {
                    // truncate to a random length sometimes
                    if next(&mut s) % 8 == 0 {
                        let l = (next(&mut s) as usize) % v.len();
                        v.truncate(l);
                        break;
                    }
                    let idx = (next(&mut s) as usize >> 7) % v.len();
                    v[idx] ^= (next(&mut s) >> 32) as u8;
                }
            }
        }
        let _ = load_elf(&v, &mut r);
    }
    // pure random buffers
    for len in [
        0usize, 1, 2, 3, 4, 60, 63, 64, 65, 120, 121, 200, 4096, 9207, 9208, 9209,
    ] {
        for _ in 0..2000 {
            let g: Vec<u8> = (0..len).map(|_| (next(&mut s) >> 24) as u8).collect();
            let _ = load_elf(&g, &mut r);
        }
    }
}

// ---- overflow battery beyond worker's, esp. symbol-scan path ----

fn set_u64(v: &mut [u8], off: usize, val: u64) {
    v[off..off + 8].copy_from_slice(&val.to_le_bytes());
}
fn set_u32(v: &mut [u8], off: usize, val: u32) {
    v[off..off + 4].copy_from_slice(&val.to_le_bytes());
}
fn set_u16(v: &mut [u8], off: usize, val: u16) {
    v[off..off + 2].copy_from_slice(&val.to_le_bytes());
}

#[test]
fn v_overflow_battery_extremes() {
    let mut r = ram();
    // e_phoff = u64::MAX
    let mut v = ELF.to_vec();
    set_u64(&mut v, 32, u64::MAX);
    let _ = load_elf(&v, &mut r);
    // e_phentsize = 0xFFFF, e_phnum = 0xFFFF
    let mut v = ELF.to_vec();
    set_u16(&mut v, 54, 0xFFFF);
    set_u16(&mut v, 56, 0xFFFF);
    let _ = load_elf(&v, &mut r);
    // e_shoff = u64::MAX (symbol scan)
    let mut v = ELF.to_vec();
    set_u64(&mut v, 40, u64::MAX);
    let _ = load_elf(&v, &mut r);
    // e_shentsize + e_shnum extremes
    let mut v = ELF.to_vec();
    set_u16(&mut v, 58, 0xFFFF);
    set_u16(&mut v, 60, 0xFFFF);
    let _ = load_elf(&v, &mut r);
    // p_offset + p_filesz just over usize on 64-bit host
    let mut v = ELF.to_vec();
    set_u64(&mut v, 64 + 8, u64::MAX - 10);
    set_u64(&mut v, 64 + 32, 100);
    set_u64(&mut v, 64 + 40, 100);
    assert!(load_elf(&v, &mut r).is_err());
    // p_paddr + p_memsz wrapping past u64::MAX
    let mut v = ELF.to_vec();
    set_u64(&mut v, 64 + 24, u64::MAX - 10);
    set_u64(&mut v, 64 + 40, 1000);
    assert!(load_elf(&v, &mut r).is_err());
    // No panic reached here = pass
}

#[test]
fn v_symtab_malformed_returns_none_not_panic() {
    // e_shoff/e_shentsize/e_shnum come from ehdr @ 40 / 58 / 60.
    // The fixture has a real section table; corrupt symtab fields and confirm
    // load still succeeds (segments valid) with tohost/fromhost = None, no panic.
    let base_ok = {
        let mut r = ram();
        load_elf(ELF, &mut r).unwrap()
    };
    assert!(base_ok.tohost.is_some() && base_ok.fromhost.is_some());

    // Read real e_shoff/shentsize/shnum from the fixture.
    let e_shoff = u64::from_le_bytes(ELF[40..48].try_into().unwrap());
    let e_shentsize = u16::from_le_bytes(ELF[58..60].try_into().unwrap()) as u64;
    let e_shnum = u16::from_le_bytes(ELF[60..62].try_into().unwrap()) as u64;

    // For each section, find the SHT_SYMTAB (type field @ +4) and smash it.
    let mut symtab_sh: Option<u64> = None;
    for i in 0..e_shnum {
        let off = (e_shoff + i * e_shentsize) as usize;
        let ty = u32::from_le_bytes(ELF[off + 4..off + 8].try_into().unwrap());
        if ty == 2 {
            symtab_sh = Some(i);
        }
    }
    let si = symtab_sh.expect("fixture must have a symtab");
    let sh_off = (e_shoff + si * e_shentsize) as usize;

    // (a) sh_link (symtab's strtab index) → bogus huge value
    let mut v = ELF.to_vec();
    set_u32(&mut v, sh_off + 40, 0xFFFF_FFFF);
    let mut r = ram();
    let img = load_elf(&v, &mut r).unwrap();
    assert_eq!(img.tohost, None, "bogus sh_link must yield None");

    // (b) sh_offset (symtab data) past EOF
    let mut v = ELF.to_vec();
    set_u64(&mut v, sh_off + 24, u64::MAX - 5);
    let mut r = ram();
    let img = load_elf(&v, &mut r).unwrap();
    assert_eq!(img.tohost, None);

    // (c) sh_size = u64::MAX (count = sym_size/24, capped at 4096 in impl)
    let mut v = ELF.to_vec();
    set_u64(&mut v, sh_off + 32, u64::MAX);
    let mut r = ram();
    let _ = load_elf(&v, &mut r); // must not panic/overflow

    // (d) sh_entsize / name_off past strtab: point strtab section's size to 0
    //     via corrupting the linked strtab's sh_size. First read sh_link.
    let link = u32::from_le_bytes(v[sh_off + 40..sh_off + 44].try_into().unwrap()) as u64;
    // restore a clean copy for this one
    let mut v = ELF.to_vec();
    // recompute link from clean
    let link = if link == 0xFFFF_FFFF {
        u32::from_le_bytes(ELF[sh_off + 40..sh_off + 44].try_into().unwrap()) as u64
    } else {
        link
    };
    if link < e_shnum {
        let str_sh = (e_shoff + link * e_shentsize) as usize;
        set_u64(&mut v, str_sh + 32, 1); // strtab size = 1 → names unterminated/OOB
        let mut r = ram();
        let _ = load_elf(&v, &mut r); // no panic
    }

    // (e) e_shentsize absurd (huge) — scan path guards with < 64
    let mut v = ELF.to_vec();
    set_u16(&mut v, 58, 0xFFFF);
    let mut r = ram();
    let _ = load_elf(&v, &mut r);
}

// ---- partial-write contract: first-valid / second-invalid variants ----

#[test]
fn v_no_partial_write_multiple_failure_modes() {
    let seed_byte = 0x55u8;
    let first_seg_off = 0x1000usize; // ph[0] p_offset from readelf
    let first_seg_bytes = &ELF[first_seg_off..first_seg_off + 0x10];

    // helper: seed RAM, run img with 2nd seg broken, assert RAM unchanged.
    let run = |mutate: &dyn Fn(&mut Vec<u8>)| -> ElfError {
        let mut r = ram();
        let seed = vec![seed_byte; RAM_SIZE];
        r.write_slice(DRAM_BASE, &seed).unwrap();
        let mut before = vec![0u8; RAM_SIZE];
        r.read_slice(DRAM_BASE, &mut before).unwrap();

        let mut v = ELF.to_vec();
        mutate(&mut v);
        let err = load_elf(&v, &mut r).unwrap_err();

        let mut after = vec![0u8; RAM_SIZE];
        r.read_slice(DRAM_BASE, &mut after).unwrap();
        assert_eq!(before, after, "RAM must be untouched on error");
        // first segment bytes must not appear at its load addr
        let mut at_load = vec![0u8; first_seg_bytes.len()];
        r.read_slice(DRAM_BASE, &mut at_load).unwrap();
        assert_ne!(
            at_load.as_slice(),
            first_seg_bytes,
            "first segment leaked into RAM before error"
        );
        err
    };

    // (1) second seg out-of-RAM via paddr
    let e = run(&|v| set_u64(v, 120 + 24, 0xFFFF_0000));
    assert_eq!(e, ElfError::SegmentOutOfRam);
    // (2) second seg file overflow (p_offset+p_filesz past EOF)
    let e = run(&|v| {
        set_u64(v, 120 + 8, u64::MAX - 4);
        set_u64(v, 120 + 32, 100);
        set_u64(v, 120 + 40, 100);
    });
    assert_eq!(e, ElfError::Truncated);
    // (3) second seg filesz > memsz
    let e = run(&|v| {
        set_u64(v, 120 + 32, 0x200);
        set_u64(v, 120 + 40, 0x100);
    });
    assert_eq!(e, ElfError::Truncated);
}

#[test]
fn v_zero_ptload_and_zero_memsz_succeed_ram_untouched() {
    // Image with ZERO PT_LOADs: patch both program headers' p_type to != PT_LOAD.
    let mut r = ram();
    let seed = vec![0x33u8; RAM_SIZE];
    r.write_slice(DRAM_BASE, &seed).unwrap();
    let mut before = vec![0u8; RAM_SIZE];
    r.read_slice(DRAM_BASE, &mut before).unwrap();
    let mut v = ELF.to_vec();
    set_u32(&mut v, 64, 0); // ph[0] type = PT_NULL
    set_u32(&mut v, 120, 0); // ph[1] type = PT_NULL
    let img = load_elf(&v, &mut r).unwrap();
    assert_eq!(img.entry, 0x8000_0000);
    let mut after = vec![0u8; RAM_SIZE];
    r.read_slice(DRAM_BASE, &mut after).unwrap();
    assert_eq!(before, after, "zero-PT_LOAD image must not touch RAM");

    // Single segment with memsz = 0, filesz = 0: valid, writes nothing.
    let mut r = ram();
    r.write_slice(DRAM_BASE, &seed).unwrap();
    let mut v = ELF.to_vec();
    // ph[0]: keep PT_LOAD, filesz=0 memsz=0, paddr in-range
    set_u64(&mut v, 64 + 32, 0);
    set_u64(&mut v, 64 + 40, 0);
    set_u32(&mut v, 120, 0); // disable ph[1]
    let mut before = vec![0u8; RAM_SIZE];
    r.read_slice(DRAM_BASE, &mut before).unwrap();
    let img = load_elf(&v, &mut r).unwrap();
    assert_eq!(img.entry, 0x8000_0000);
    let mut after = vec![0u8; RAM_SIZE];
    r.read_slice(DRAM_BASE, &mut after).unwrap();
    assert_eq!(before, after, "memsz=0 segment must not touch RAM");
}
