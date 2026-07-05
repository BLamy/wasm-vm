//! wasm32 mirror of the E0-T03 RAM/bus boundary suite (`wasm-pack test --node`).
//!
//! Same assertions as `crates/core/src/ram.rs` tests, executed on the actual wasm32
//! target — the point is catching 32-bit-`usize` and wasm-engine differences in the
//! bounds arithmetic, not re-proving the logic.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::ram::{OutOfMemory, Ram};

const SIZE: u64 = 64 * 1024;
const END: u64 = DRAM_BASE + SIZE;

fn ram() -> Ram {
    Ram::with_base(DRAM_BASE, SIZE as usize).unwrap()
}

#[wasm_bindgen_test]
fn roundtrip_every_width_at_base_and_last_slot() {
    let mut r = ram();
    macro_rules! rt {
        ($store:ident, $load:ident, $ty:ty, $val:expr) => {
            let w = size_of::<$ty>() as u64;
            for addr in [DRAM_BASE, END - w] {
                r.$store(addr, $val).unwrap();
                assert_eq!(r.$load(addr).unwrap(), $val);
            }
        };
    }
    rt!(store8, load8, u8, 0xA5);
    rt!(store16, load16, u16, 0xBEEF);
    rt!(store32, load32, u32, 0xDEAD_BEEF);
    rt!(store64, load64, u64, 0x0123_4567_89AB_CDEF);
}

#[wasm_bindgen_test]
fn straddling_the_end_is_access_not_panic() {
    let mut r = ram();
    assert_eq!(r.load64(END - 4), Err(BusFault::Access));
    assert_eq!(r.store64(END - 4, 0), Err(BusFault::Access));
    assert_eq!(r.load16(END - 1), Err(BusFault::Access));
    assert_eq!(r.load64(END - 8), Ok(0));
}

#[wasm_bindgen_test]
fn misaligned_in_range_faults_misaligned() {
    let mut r = ram();
    assert_eq!(r.load16(DRAM_BASE + 1), Err(BusFault::Misaligned));
    assert_eq!(r.load32(DRAM_BASE + 2), Err(BusFault::Misaligned));
    assert_eq!(r.load64(DRAM_BASE + 4), Err(BusFault::Misaligned));
    assert_eq!(r.load8(DRAM_BASE + 1), Ok(0));
}

#[wasm_bindgen_test]
fn little_endian_byte_order() {
    let mut r = ram();
    let a = DRAM_BASE + 0x100;
    r.store32(a, 0xDEAD_BEEF).unwrap();
    for (i, want) in [0xEF, 0xBE, 0xAD, 0xDE].into_iter().enumerate() {
        assert_eq!(r.load8(a + i as u64).unwrap(), want);
    }
}

#[wasm_bindgen_test]
fn extreme_addresses_fault_without_overflow_panics() {
    let mut r = ram();
    for addr in [0u64, 0x7FFF_FFFF_FFFF_FFF8, u64::MAX - 7, u64::MAX] {
        assert_eq!(r.load8(addr).err(), Some(BusFault::Access));
        assert_eq!(r.load64(addr & !7).err(), Some(BusFault::Access));
        assert_eq!(r.store64(addr & !7, 0).err(), Some(BusFault::Access));
    }
}

#[wasm_bindgen_test]
fn slice_escape_hatch_and_clean_failure_sizes() {
    let mut r = ram();
    r.write_slice(DRAM_BASE + 3, &[1, 2, 3, 4, 5]).unwrap();
    let mut buf = [0u8; 5];
    r.read_slice(DRAM_BASE + 3, &mut buf).unwrap();
    assert_eq!(buf, [1, 2, 3, 4, 5]);
    assert_eq!(r.write_slice(END - 2, &[0; 4]), Err(BusFault::Access));

    let mut z = Ram::new(0).unwrap();
    assert!(z.is_empty());
    assert_eq!(z.load8(DRAM_BASE), Err(BusFault::Access));
    // wasm32: usize is 32-bit; usize::MAX capacity must still be a clean Err.
    assert_eq!(Ram::new(usize::MAX).err(), Some(OutOfMemory));
}
