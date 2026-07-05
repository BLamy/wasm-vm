//! wasm32 mirror of the E2-T01 "virt" platform map checks (`wasm-pack test --node`).
//! The platform definition is pure arithmetic, so it must validate identically on wasm32.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::platform::{Platform, PlatformError, Region, virt};

#[wasm_bindgen_test]
fn default_map_validates_on_wasm32() {
    let p = Platform::default();
    assert!(Platform::try_new(p.dram_size()).is_ok());
    let r = p.regions();
    for i in 0..r.len() {
        for j in (i + 1)..r.len() {
            assert!(!r[i].overlaps(&r[j]), "overlap on wasm32");
        }
    }
}

#[wasm_bindgen_test]
fn boundaries_and_overflow_on_wasm32() {
    let p = Platform::new(128 * 1024 * 1024);
    for r in p.regions() {
        let end = r.end().unwrap();
        assert!(r.contains(r.base) && r.contains(end - 1) && !r.contains(end));
    }
    assert_eq!(Platform::try_new(0), Err(PlatformError::DramSize(0)));
    let huge = u64::MAX - virt::DRAM_BASE + 1;
    assert_eq!(Platform::try_new(huge), Err(PlatformError::DramSize(huge)));
}

#[wasm_bindgen_test]
fn irq_layout_on_wasm32() {
    assert_eq!(virt::UART0_IRQ, 10);
    assert_eq!(virt::RTC_IRQ, 11);
    for i in 0..virt::VIRTIO_COUNT {
        assert_eq!(Platform::virtio_irq(i), 1 + i as u32);
        assert_eq!(Platform::virtio_base(i), 0x1000_1000 + i * 0x1000);
    }
    // A crafted overlap is detected on wasm32 too.
    let a = Region {
        name: "a",
        base: 0x1000,
        len: 0x1000,
    };
    let b = Region {
        name: "b",
        base: 0x1800,
        len: 0x1000,
    };
    assert!(a.overlaps(&b));
}
