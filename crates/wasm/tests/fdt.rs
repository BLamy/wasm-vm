//! wasm32 mirror of the E2-T02 FDT builder checks (`wasm-pack test --node`): the DTB is pure
//! byte-level construction, so the blob must be IDENTICAL on wasm32 (determinism) and every
//! structural invariant must hold.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::fdt::{FDT_MAGIC, FDT_VERSION, Initrd, build_virt_dtb, dtb_placement};
use wasm_vm_core::platform::{Platform, virt};

fn be32(b: &[u8], off: usize) -> u32 {
    u32::from_be_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]])
}

#[wasm_bindgen_test]
fn header_and_totalsize_on_wasm32() {
    let blob = build_virt_dtb(&Platform::default(), "console=ttyS0", None);
    assert_eq!(be32(&blob, 0), FDT_MAGIC);
    assert_eq!(be32(&blob, 4) as usize, blob.len());
    assert_eq!(be32(&blob, 20), FDT_VERSION);
}

#[wasm_bindgen_test]
fn blob_tracks_platform_on_wasm32() {
    let a = build_virt_dtb(&Platform::new(128 * 1024 * 1024), "a", None);
    let b = build_virt_dtb(&Platform::new(256 * 1024 * 1024), "a", None);
    assert_ne!(a, b);
    let c = build_virt_dtb(
        &Platform::default(),
        "a",
        Some(Initrd {
            start: 0x8800_0000,
            end: 0x8810_0000,
        }),
    );
    assert!(c.len() > a.len(), "initrd props grow the blob");
}

#[wasm_bindgen_test]
fn placement_on_wasm32() {
    let p = Platform::default();
    let blob = build_virt_dtb(&p, "x", None);
    let addr = dtb_placement(&p, blob.len() as u64).unwrap();
    assert_eq!(addr % 8, 0);
    assert!(addr >= virt::DRAM_BASE && addr + blob.len() as u64 <= virt::DRAM_BASE + p.dram_size());
}
