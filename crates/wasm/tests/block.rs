//! wasm32 mirror of the E2-T10 block-backend checks — THE acceptance run: a 5 GiB
//! capacity addressed on a REAL 32-bit usize (any unchecked cast wraps into range here).

#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::block::{BlockBackend, BlockError, MemBackend, SECTOR_SIZE, SparseMemBackend};

#[wasm_bindgen_test]
fn five_gib_sparse_on_32bit_usize() {
    const CAP: u64 = 10 * 1024 * 1024; // 10M sectors = 5 GiB > u32::MAX bytes
    let mut b = SparseMemBackend::new(CAP);
    let mut sec = [0u8; SECTOR_SIZE];
    sec[0] = 0x5A;
    b.write(CAP - 1, &sec).unwrap();
    // The u32-truncated alias of the top sector's byte offset MUST be untouched.
    let alias_sector = (((CAP - 1) * SECTOR_SIZE as u64) & 0xFFFF_FFFF) / SECTOR_SIZE as u64;
    let mut low = [0xFFu8; SECTOR_SIZE];
    b.read(alias_sector, &mut low).unwrap();
    assert_eq!(low[0], 0, "no 32-bit truncation aliasing");
    let mut back = [0u8; SECTOR_SIZE];
    b.read(CAP - 1, &mut back).unwrap();
    assert_eq!(back[0], 0x5A);
    assert_eq!(b.read(CAP, &mut back), Err(BlockError::OutOfRange));
    assert_eq!(b.read(u64::MAX - 1, &mut back), Err(BlockError::OutOfRange));
}

#[wasm_bindgen_test]
fn mem_backend_roundtrip_and_ro_on_wasm32() {
    let mut b = MemBackend::new(vec![0u8; 16 * SECTOR_SIZE]);
    let mut buf = [0u8; SECTOR_SIZE];
    buf[7] = 0x77;
    b.write(15, &buf).unwrap(); // capacity-1
    let mut back = [0u8; SECTOR_SIZE];
    b.read(15, &mut back).unwrap();
    assert_eq!(back[7], 0x77);
    assert_eq!(b.write(16, &buf), Err(BlockError::OutOfRange));
    assert_eq!(b.read(0, &mut [0u8; 33]), Err(BlockError::Unaligned));
    let mut ro = MemBackend::new_read_only(vec![3u8; 4 * SECTOR_SIZE]);
    assert_eq!(ro.write(0, &buf), Err(BlockError::ReadOnly));
    ro.read(0, &mut back).unwrap();
    assert_eq!(back[0], 3);
}
