//! wasm32 mirror of the E2-T08 virtio-mmio transport checks (`wasm-pack test --node`).

#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::VirtioDevice;
use wasm_vm_core::dev::virtio::mmio::MAGIC;
use wasm_vm_core::platform::{Platform, virt};

const RAM: usize = 4 * 1024 * 1024;

struct BlkPlaceholder;
impl VirtioDevice for BlkPlaceholder {
    fn device_id(&self) -> u32 {
        2
    }
    fn device_features(&self) -> u64 {
        0b110
    }
}

#[wasm_bindgen_test]
fn slots_probe_and_lifecycle_on_wasm32() {
    let mut m = Machine::new(RAM);
    m.enable_plic();
    let _slots = m.enable_virtio_slots(Some(Box::new(BlkPlaceholder)));
    let b0 = Platform::virtio_base(0);
    // Probe.
    assert_eq!(m.bus_mut().load32(b0).unwrap(), MAGIC);
    assert_eq!(m.bus_mut().load32(b0 + 4).unwrap(), 2);
    assert_eq!(m.bus_mut().load32(b0 + 8).unwrap(), 2, "blk placeholder");
    assert_eq!(
        m.bus_mut().load32(Platform::virtio_base(3) + 8).unwrap(),
        0,
        "empty slot"
    );
    // VERSION_1 always offered (bank 1 bit 0).
    m.bus_mut().store32(b0 + 0x14, 1).unwrap();
    assert_eq!(m.bus_mut().load32(b0 + 0x10).unwrap(), 1);
    // Unoffered bit rejected: accept bit 3 (never offered) → FEATURES_OK stays clear.
    m.bus_mut().store32(b0 + 0x24, 0).unwrap();
    m.bus_mut().store32(b0 + 0x20, 0b1000).unwrap();
    m.bus_mut().store32(b0 + 0x70, 1 | 2 | 8).unwrap();
    assert_eq!(
        m.bus_mut().load32(b0 + 0x70).unwrap() & 8,
        0,
        "rejected on wasm32"
    );
    // Reset clears.
    m.bus_mut().store32(b0 + 0x70, 0).unwrap();
    assert_eq!(m.bus_mut().load32(b0 + 0x70).unwrap(), 0);
    // Sub-width register read policy: 1-byte read of DeviceID region reads 0.
    assert_eq!(m.bus_mut().load8(b0 + 8).unwrap(), 0);
    // virtio slot addresses match the DTB the kernel will parse.
    assert_eq!(virt::VIRTIO_COUNT, 8);
}
