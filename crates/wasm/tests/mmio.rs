//! wasm32 mirror of the E0-T04 MMIO dispatch suite (`wasm-pack test --node`).
//! Key routing/attach behaviors re-asserted on the actual wasm32 target.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::mmio::{AttachError, RecordingDevice, SystemBus, Width};
use wasm_vm_core::ram::Ram;

const RAM_SIZE: u64 = 64 * 1024;
const WIN_BASE: u64 = 0x1000_0000;
const WIN_LEN: u64 = 0x100;
const WIN_END: u64 = WIN_BASE + WIN_LEN;

fn bus_with_device(
    read_value: u64,
) -> (
    SystemBus,
    std::rc::Rc<std::cell::RefCell<wasm_vm_core::mmio::RecordingLog>>,
) {
    let mut bus = SystemBus::new(Ram::new(RAM_SIZE as usize).unwrap());
    let (dev, log) = RecordingDevice::new(read_value);
    bus.attach(WIN_BASE, WIN_LEN, Box::new(dev)).unwrap();
    (bus, log)
}

#[wasm_bindgen_test]
fn ram_and_device_route_correctly() {
    let (mut bus, log) = bus_with_device(0x42);
    bus.store64(DRAM_BASE, 0x0123_4567_89AB_CDEF).unwrap();
    assert_eq!(bus.load64(DRAM_BASE), Ok(0x0123_4567_89AB_CDEF));
    assert_eq!(bus.load8(WIN_BASE + 5), Ok(0x42));
    assert_eq!(log.borrow().reads, [(0x5, Width::B1)]);
}

#[wasm_bindgen_test]
fn offset_width_value_forwarding() {
    let (mut bus, log) = bus_with_device(0);
    bus.store32(WIN_BASE + 0x40, 0xDEAD_BEEF).unwrap();
    bus.store16(WIN_BASE + 0x10, 0xCAFE).unwrap();
    let log = log.borrow();
    assert_eq!(
        log.writes,
        [(0x40, Width::B4, 0xDEAD_BEEF), (0x10, Width::B2, 0xCAFE)]
    );
    assert_eq!(log.writes.len(), 2, "widths must not be split into bytes");
}

#[wasm_bindgen_test]
fn hole_and_straddle_fault_without_device_calls() {
    let (mut bus, log) = bus_with_device(0);
    assert_eq!(bus.load32(0x2000_0000), Err(BusFault::Access));
    assert_eq!(bus.load64(WIN_END - 4), Err(BusFault::Access));
    assert_eq!(bus.load16(WIN_END - 1), Err(BusFault::Access));
    assert_eq!(bus.load32(WIN_BASE + 2), Err(BusFault::Misaligned));
    assert_eq!(log.borrow().reads.len() + log.borrow().writes.len(), 0);
}

#[wasm_bindgen_test]
fn attach_rejections_on_wasm32() {
    let (mut bus, _log) = bus_with_device(0);
    let (d1, _) = RecordingDevice::new(0);
    assert_eq!(
        bus.attach(DRAM_BASE - 4, 8, Box::new(d1)),
        Err(AttachError::Overlap)
    );
    let (d2, _) = RecordingDevice::new(0);
    assert_eq!(
        bus.attach(0x3000_0000, 0, Box::new(d2)),
        Err(AttachError::ZeroLength)
    );
    let (d3, _) = RecordingDevice::new(0);
    assert_eq!(
        bus.attach(u64::MAX - 2, 8, Box::new(d3)),
        Err(AttachError::AddressOverflow)
    );
    // usize is 32-bit here; u64 addressing must be unaffected.
    let (d4, _) = RecordingDevice::new(0x99);
    bus.attach(0xFFFF_0000_0000_0000, 0x100, Box::new(d4))
        .unwrap();
    assert_eq!(bus.load8(0xFFFF_0000_0000_0010), Ok(0x99));
}

#[wasm_bindgen_test]
fn device_read_masking() {
    let (mut bus, _log) = bus_with_device(u64::MAX);
    assert_eq!(bus.load8(WIN_BASE), Ok(0xFF));
    assert_eq!(bus.load16(WIN_BASE), Ok(0xFFFF));
    assert_eq!(bus.load32(WIN_BASE), Ok(0xFFFF_FFFF));
    assert_eq!(bus.load64(WIN_BASE), Ok(u64::MAX));
}
