//! wasm32 mirror of the E5-T10b virtio-input event queue wire contract.

#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen_test::wasm_bindgen_test;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::input::{
    EV_KEY, EV_LED, EV_SYN, INPUT_EVENT_SIZE, InputDeviceSpec, InputEvent, SYN_REPORT, VirtioInput,
    service,
};
use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;

#[wasm_bindgen_test]
fn input_event_wire_bytes_match_native_layout() {
    let key = InputEvent::new(EV_KEY, 30, 1);
    assert_eq!(INPUT_EVENT_SIZE, 8);
    assert_eq!(
        key.to_bytes(),
        [0x01, 0x00, 0x1e, 0x00, 0x01, 0x00, 0x00, 0x00]
    );
    assert_eq!(InputEvent::from_bytes(&key.to_bytes()), key);

    let led = InputEvent::new(EV_LED, 3, -1);
    assert_eq!(
        led.to_bytes(),
        [0x11, 0x00, 0x03, 0x00, 0xff, 0xff, 0xff, 0xff]
    );
    assert_eq!(InputEvent::from_bytes(&led.to_bytes()), led);
}

#[wasm_bindgen_test]
fn inject_sync_stream_crosses_eventq_on_wasm32() {
    const DESC: u64 = DRAM_BASE + 0x1000;
    const AVAIL: u64 = DRAM_BASE + 0x2000;
    const USED: u64 = DRAM_BASE + 0x3000;
    const BUF: u64 = DRAM_BASE + 0x4000;

    let (device, state) = VirtioInput::new_with_state(InputDeviceSpec::default());
    let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
    let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());

    slot.borrow_mut().write(0x30, Width::B4, 0).unwrap();
    slot.borrow_mut().write(0x38, Width::B4, 8).unwrap();
    slot.borrow_mut()
        .write(0x80, Width::B4, DESC as u32 as u64)
        .unwrap();
    slot.borrow_mut()
        .write(0x90, Width::B4, AVAIL as u32 as u64)
        .unwrap();
    slot.borrow_mut()
        .write(0xa0, Width::B4, USED as u32 as u64)
        .unwrap();
    slot.borrow_mut().write(0x44, Width::B4, 1).unwrap();

    for index in 0..3u64 {
        let desc = DESC + 16 * index;
        let buf = BUF + INPUT_EVENT_SIZE as u64 * index;
        bus.store64(desc, buf).unwrap();
        bus.store32(desc + 8, INPUT_EVENT_SIZE as u32).unwrap();
        bus.store16(desc + 12, 2).unwrap();
        bus.store16(desc + 14, 0).unwrap();
        bus.store16(AVAIL + 4 + 2 * index, index as u16).unwrap();
    }
    bus.store16(AVAIL + 2, 3).unwrap();

    state.borrow_mut().inject_event(EV_KEY, 30, 1);
    state.borrow_mut().inject_event(EV_KEY, 30, 0);
    state.borrow_mut().sync();
    let mut eventq = None;
    let mut statusq = None;
    service(&slot, &mut eventq, &mut statusq, &state, &mut bus);

    let expected = [
        InputEvent::new(EV_KEY, 30, 1),
        InputEvent::new(EV_KEY, 30, 0),
        InputEvent::new(EV_SYN, SYN_REPORT, 0),
    ];
    for (index, event) in expected.iter().copied().enumerate() {
        let mut bytes = [0u8; INPUT_EVENT_SIZE];
        for (offset, byte) in bytes.iter_mut().enumerate() {
            *byte = bus
                .load8(BUF + index as u64 * INPUT_EVENT_SIZE as u64 + offset as u64)
                .unwrap();
        }
        assert_eq!(InputEvent::from_bytes(&bytes), event);
        assert_eq!(
            bus.load32(USED + 8 + 8 * index as u64).unwrap(),
            INPUT_EVENT_SIZE as u32
        );
    }
    assert_eq!(bus.load16(USED + 2).unwrap(), 3);
}
