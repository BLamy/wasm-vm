//! E0-T03 adversarial verifier suite (fresh session, 2026-07-02).
//!
//! Independent reference model in u128 arithmetic — deliberately NOT the
//! implementation's checked-u64 logic, so a shared bug cannot self-license.
//! Seed is the verifier's own: 0x5EED_2026_0702_CAFE.

use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::ram::{OutOfMemory, Ram};

const SIZE: u64 = 64 * 1024;
const END: u64 = DRAM_BASE + SIZE;

/// Reference model: expected outcome of a width-`w` access at `addr` against RAM
/// of `len` bytes based at `base`. u128 arithmetic — cannot overflow.
fn model(base: u64, len: u64, addr: u64, w: u64) -> Result<(), BusFault> {
    let (a, b, l, wu) = (addr as u128, base as u128, len as u128, w as u128);
    if a < b || a + wu > b + l {
        return Err(BusFault::Access);
    }
    if !addr.is_multiple_of(w) {
        return Err(BusFault::Misaligned);
    }
    Ok(())
}

/// Reference model for byte-granular slice ops (no alignment requirement).
fn model_range(base: u64, len: u64, addr: u64, n: u64) -> Result<(), BusFault> {
    let (a, b, l, nu) = (addr as u128, base as u128, len as u128, n as u128);
    if a < b || a + nu > b + l {
        return Err(BusFault::Access);
    }
    Ok(())
}

fn probe_load(r: &mut Ram, addr: u64, w: u64) -> Result<(), BusFault> {
    match w {
        1 => r.load8(addr).map(drop),
        2 => r.load16(addr).map(drop),
        4 => r.load32(addr).map(drop),
        8 => r.load64(addr).map(drop),
        _ => unreachable!(),
    }
}

fn probe_store(r: &mut Ram, addr: u64, w: u64) -> Result<(), BusFault> {
    match w {
        1 => r.store8(addr, 0x5A),
        2 => r.store16(addr, 0x5A5A),
        4 => r.store32(addr, 0x5A5A_5A5A),
        8 => r.store64(addr, 0x5A5A_5A5A_5A5A_5A5A),
        _ => unreachable!(),
    }
}

/// splitmix64 — verifier's own PRNG + seed, nothing the worker could have tuned for.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

const SEED: u64 = 0x5EED_2026_0702_CAFE;

#[cfg(miri)]
const RANDOM_CASES: u64 = 1_000;
#[cfg(not(miri))]
const RANDOM_CASES: u64 = 1_200_000;

/// Task attack (1a): exhaustive boundary bands, every width, load AND store.
#[test]
fn boundary_band_exhaustive_vs_model() {
    let mut r = Ram::with_base(DRAM_BASE, SIZE as usize).unwrap();
    assert_eq!(r.len() as u64, SIZE); // also covers the otherwise-untested len()
    for &w in &[1u64, 2, 4, 8] {
        for addr in (DRAM_BASE - 8)..=(DRAM_BASE + 8) {
            let want = model(DRAM_BASE, SIZE, addr, w);
            assert_eq!(probe_load(&mut r, addr, w), want, "load w={w} a={addr:#x}");
            assert_eq!(
                probe_store(&mut r, addr, w),
                want,
                "store w={w} a={addr:#x}"
            );
        }
        for addr in (END - 8)..=(END + 8) {
            let want = model(DRAM_BASE, SIZE, addr, w);
            assert_eq!(probe_load(&mut r, addr, w), want, "load w={w} a={addr:#x}");
            assert_eq!(
                probe_store(&mut r, addr, w),
                want,
                "store w={w} a={addr:#x}"
            );
        }
    }
}

/// Task attack (1b): random fuzz across the full u64 space + boundary-biased
/// samples, >=1.2M cases, verifier seed.
#[test]
fn random_fuzz_full_u64_space_vs_model() {
    let mut r = Ram::with_base(DRAM_BASE, SIZE as usize).unwrap();
    let mut rng = Rng(SEED);
    for i in 0..RANDOM_CASES {
        let w = 1u64 << (rng.next() & 3); // 1,2,4,8
        let addr = match i % 4 {
            // full u64 space
            0 | 1 => rng.next(),
            // biased near [base-2*SIZE, base+2*SIZE)
            2 => DRAM_BASE.wrapping_add((rng.next() % (4 * SIZE)).wrapping_sub(2 * SIZE)),
            // biased near end
            _ => END.wrapping_add((rng.next() % 64).wrapping_sub(32)),
        };
        let want = model(DRAM_BASE, SIZE, addr, w);
        assert_eq!(probe_load(&mut r, addr, w), want, "load w={w} a={addr:#x}");
        assert_eq!(
            probe_store(&mut r, addr, w),
            want,
            "store w={w} a={addr:#x}"
        );
    }
}

/// Task attack (1c): slice escape hatches fuzzed against the range model.
#[test]
fn slice_fuzz_vs_model() {
    let mut r = Ram::with_base(DRAM_BASE, SIZE as usize).unwrap();
    let mut rng = Rng(SEED ^ 0xDEAD_BEEF);
    let mut buf = [0u8; 64];
    for i in 0..(RANDOM_CASES / 4) {
        let n = (rng.next() % 65) as usize; // 0..=64, includes zero-length
        let addr = match i % 3 {
            0 => rng.next(),
            1 => DRAM_BASE.wrapping_add((rng.next() % (4 * SIZE)).wrapping_sub(2 * SIZE)),
            _ => u64::MAX - (rng.next() % 128),
        };
        let want = model_range(DRAM_BASE, SIZE, addr, n as u64);
        assert_eq!(
            r.read_slice(addr, &mut buf[..n]),
            want,
            "read n={n} a={addr:#x}"
        );
        assert_eq!(
            r.write_slice(addr, &buf[..n]),
            want,
            "write n={n} a={addr:#x}"
        );
    }
}

/// Task attack (2): overflow probes, exact addresses from the task + extras.
/// Runs under debug_assertions (dev profile) so any wrapping arithmetic panics.
#[test]
fn overflow_probes_all_widths() {
    if !cfg!(debug_assertions) {
        panic!("must run with debug_assertions on");
    }
    let mut r = Ram::with_base(DRAM_BASE, SIZE as usize).unwrap();
    let cases: &[(u64, u64)] = &[
        (0x0, 1),
        (0x0, 2),
        (0x0, 4),
        (0x0, 8),
        (0x7FFF_FFFF_FFFF_FFF8, 1),
        (0x7FFF_FFFF_FFFF_FFF8, 2),
        (0x7FFF_FFFF_FFFF_FFF8, 4),
        (0x7FFF_FFFF_FFFF_FFF8, 8),
        (u64::MAX - 7, 8),
        (u64::MAX - 3, 4),
        (u64::MAX - 1, 2),
        (u64::MAX, 1),
        (u64::MAX, 2),
        (u64::MAX, 4),
        (u64::MAX, 8),
    ];
    for &(addr, w) in cases {
        assert_eq!(
            probe_load(&mut r, addr, w),
            Err(BusFault::Access),
            "load w={w} a={addr:#x}"
        );
        assert_eq!(
            probe_store(&mut r, addr, w),
            Err(BusFault::Access),
            "store w={w} a={addr:#x}"
        );
    }
    // Slice ops whose off+len would overflow u64.
    let mut buf = [0u8; 16];
    assert_eq!(r.read_slice(u64::MAX, &mut buf), Err(BusFault::Access));
    assert_eq!(r.write_slice(u64::MAX - 7, &buf), Err(BusFault::Access));
    assert_eq!(r.read_slice(u64::MAX, &mut []), Err(BusFault::Access)); // len 0, off > len
}

/// Task attack (3): faulting stores leave the ENTIRE RAM bit-identical.
#[test]
fn faulting_stores_leave_full_ram_identical() {
    let mut r = Ram::with_base(DRAM_BASE, SIZE as usize).unwrap();
    // Fill with verifier-seeded noise so a partial write anywhere is visible.
    let mut rng = Rng(SEED ^ 0x00DD_BA11);
    let fill: Vec<u8> = (0..SIZE).map(|_| rng.next() as u8).collect();
    r.write_slice(DRAM_BASE, &fill).unwrap();

    let mut before = vec![0u8; SIZE as usize];
    r.read_slice(DRAM_BASE, &mut before).unwrap();

    // Battery: every width, below-base band, straddle band, far-out, misaligned-in-range.
    for &w in &[1u64, 2, 4, 8] {
        let band1 = (DRAM_BASE - 8)..DRAM_BASE;
        let band2 = (END - 7)..=(END + 8);
        let extremes = [
            0u64,
            u64::MAX,
            u64::MAX - 7,
            DRAM_BASE + 1,
            DRAM_BASE + 2,
            DRAM_BASE + 4,
        ];
        for addr in band1.chain(band2).chain(extremes) {
            // Only stores the model says MUST fault; assert they do, then check RAM.
            if let Err(want) = model(DRAM_BASE, SIZE, addr, w) {
                assert_eq!(probe_store(&mut r, addr, w), Err(want), "w={w} a={addr:#x}");
            }
        }
    }
    let _ = r.write_slice(END - 2, &[0xFF; 4]);
    let _ = r.write_slice(DRAM_BASE - 1, &[0xFF; 4]);
    let _ = r.write_slice(u64::MAX - 3, &[0xFF; 16]);

    let mut after = vec![0u8; SIZE as usize];
    r.read_slice(DRAM_BASE, &mut after).unwrap();
    assert_eq!(before, after, "a faulting store mutated RAM");
}

/// NOVEL attack: RAM whose last byte is u64::MAX. A naive `addr + width` bounds
/// check overflows/spuriously faults here; legal accesses must be Ok.
#[test]
fn ram_at_top_of_address_space() {
    let base = u64::MAX - 15; // 0xFFFF_FFFF_FFFF_FFF0, 16 bytes, ends at u64::MAX inclusive
    let mut r = Ram::with_base(base, 16).unwrap();
    r.store64(base, 0x0123_4567_89AB_CDEF).unwrap();
    r.store64(base + 8, 0xFEDC_BA98_7654_3210).unwrap();
    assert_eq!(r.load8(u64::MAX), Ok(0xFE));
    assert_eq!(r.load16(u64::MAX - 1), Ok(0xFEDC));
    assert_eq!(r.load32(u64::MAX - 3), Ok(0xFEDC_BA98));
    assert_eq!(r.load64(u64::MAX - 7), Ok(0xFEDC_BA98_7654_3210));
    // Access that would need byte u64::MAX+1: must be Access (also misaligned; range wins).
    assert_eq!(r.load16(u64::MAX), Err(BusFault::Access));
    assert_eq!(r.store32(u64::MAX - 1, 0), Err(BusFault::Access));
    // Full-space fuzz against the model at this base too.
    let mut rng = Rng(SEED ^ 0x7070_7070);
    for _ in 0..(RANDOM_CASES / 8) {
        let w = 1u64 << (rng.next() & 3);
        let addr = u64::MAX - (rng.next() % 64);
        let want = model(base, 16, addr, w);
        assert_eq!(probe_load(&mut r, addr, w), want, "w={w} a={addr:#x}");
    }
}

/// NOVEL attack: base+len exceeding u64::MAX (unreachable tail). Constructor
/// permits it; accesses must never wrap around to offset the tail.
#[test]
fn base_plus_len_past_u64_max_never_wraps() {
    let base = u64::MAX - 7;
    let mut r = Ram::with_base(base, 16).unwrap(); // bytes 8..16 unaddressable
    assert_eq!(r.load64(base), Ok(0));
    assert_eq!(r.store64(base, 0xAA).map(drop), Ok(()));
    // Low addresses must NOT alias the unreachable tail via wraparound.
    for addr in [0u64, 1, 7, 8, 15] {
        assert_eq!(r.load8(addr), Err(BusFault::Access), "a={addr:#x}");
    }
}

/// Task attack (6): zero-size RAM faults everything; absurd sizes fail cleanly.
#[test]
fn zero_size_ram_faults_everything() {
    let mut z = Ram::new(0).unwrap();
    assert!(z.is_empty());
    assert_eq!(z.len(), 0);
    for &w in &[1u64, 2, 4, 8] {
        for addr in [0u64, DRAM_BASE - 1, DRAM_BASE, DRAM_BASE + 1, u64::MAX] {
            assert_eq!(probe_load(&mut z, addr, w), Err(BusFault::Access));
            assert_eq!(probe_store(&mut z, addr, w), Err(BusFault::Access));
        }
    }
    let mut b = [0u8; 1];
    assert_eq!(z.read_slice(DRAM_BASE, &mut b), Err(BusFault::Access));
    // Zero-length at exactly base is the one Ok a zero-size RAM can give.
    assert_eq!(z.read_slice(DRAM_BASE, &mut []), Ok(()));
}

/// Task attack (6b): absurd sizes. Reservation-only probes first so a
/// lazily-granted huge allocation can't trigger a host-killing memset.
#[test]
#[ignore = "run explicitly: absurd allocation sizes"]
fn absurd_sizes_fail_cleanly() {
    assert_eq!(Ram::new(usize::MAX).err(), Some(OutOfMemory));
    assert_eq!(Ram::new(isize::MAX as usize).err(), Some(OutOfMemory));
    for shift in [50u32, 46, 45] {
        let n = 1usize << shift;
        let mut v: Vec<u8> = Vec::new();
        match v.try_reserve_exact(n) {
            Err(_) => {
                // Allocator refuses => Ram::new takes the same path => clean Err.
                assert_eq!(Ram::new(n).err(), Some(OutOfMemory), "1<<{shift}");
                println!("1<<{shift}: allocator refused -> Err(OutOfMemory) [clean]");
            }
            Ok(()) => {
                // Reservation granted: Ram::new(n) would zero n bytes (Vec::resize
                // memset) — 'working RAM', allowed behavior; not constructed here to
                // protect the host. No abort path exists past a successful reserve.
                println!("1<<{shift}: reservation GRANTED (overcommit); skipping memset");
                drop(v);
            }
        }
    }
}
