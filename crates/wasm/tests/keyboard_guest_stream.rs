//! wasm32 mirror of the E5-T11c guest-visible keyboard stream and repeat policy.

#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use std::rc::Rc;

use wasm_bindgen_test::wasm_bindgen_test;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::input::keyboard::{KEY_A, keyboard_spec};
use wasm_vm_core::dev::virtio::input::{
    EV_KEY, EV_REP, EV_SYN, INPUT_EVENT_SIZE, InputEvent, SYN_REPORT, VirtioInput, service,
};
use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;

const QUEUE_SIZE: u16 = 8;
const DESC: u64 = DRAM_BASE + 0x1000;
const AVAIL: u64 = DRAM_BASE + 0x2000;
const USED: u64 = DRAM_BASE + 0x3000;
const BUF: u64 = DRAM_BASE + 0x4000;

fn setup_keyboard() -> (
    Rc<RefCell<VirtioMmio>>,
    Rc<RefCell<wasm_vm_core::dev::virtio::input::InputState>>,
    SystemBus,
) {
    let (device, state) = VirtioInput::new_with_state(keyboard_spec());
    let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
    let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());

    slot.borrow_mut().write(0x30, Width::B4, 0).unwrap();
    slot.borrow_mut()
        .write(0x38, Width::B4, u64::from(QUEUE_SIZE))
        .unwrap();
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

    for index in 0..u64::from(QUEUE_SIZE) {
        let desc = DESC + 16 * index;
        let buffer = BUF + INPUT_EVENT_SIZE as u64 * index;
        bus.store64(desc, buffer).unwrap();
        bus.store32(desc + 8, INPUT_EVENT_SIZE as u32).unwrap();
        bus.store16(desc + 12, 2).unwrap();
        bus.store16(desc + 14, 0).unwrap();
        bus.store16(AVAIL + 4 + 2 * index, index as u16).unwrap();
    }
    bus.store16(AVAIL, 0).unwrap();
    bus.store16(AVAIL + 2, 0).unwrap();
    bus.store16(USED + 2, 0).unwrap();
    (slot, state, bus)
}

fn post_buffers(bus: &mut SystemBus, count: u16) {
    bus.store16(AVAIL + 2, count).unwrap();
}

fn read_events(bus: &mut SystemBus) -> Vec<InputEvent> {
    let used = bus.load16(USED + 2).unwrap();
    (0..used)
        .map(|index| {
            let head = bus.load32(USED + 4 + 8 * u64::from(index)).unwrap() as u64;
            assert_eq!(
                bus.load32(USED + 8 + 8 * u64::from(index)).unwrap(),
                INPUT_EVENT_SIZE as u32
            );
            let mut bytes = [0u8; INPUT_EVENT_SIZE];
            for (offset, byte) in bytes.iter_mut().enumerate() {
                *byte = bus
                    .load8(BUF + INPUT_EVENT_SIZE as u64 * head + offset as u64)
                    .unwrap();
            }
            InputEvent::from_bytes(&bytes)
        })
        .collect()
}

#[wasm_bindgen_test]
fn keyboard_make_break_stream_crosses_eventq_on_wasm32() {
    let (slot, state, mut bus) = setup_keyboard();
    post_buffers(&mut bus, 4);

    state.borrow_mut().inject_event(EV_KEY, KEY_A, 1);
    state.borrow_mut().sync();
    state.borrow_mut().inject_event(EV_KEY, KEY_A, 0);
    state.borrow_mut().sync();
    let mut eventq = None;
    let mut statusq = None;
    service(&slot, &mut eventq, &mut statusq, &state, &mut bus);

    assert_eq!(
        read_events(&mut bus),
        vec![
            InputEvent::new(EV_KEY, KEY_A, 1),
            InputEvent::new(EV_SYN, SYN_REPORT, 0),
            InputEvent::new(EV_KEY, KEY_A, 0),
            InputEvent::new(EV_SYN, SYN_REPORT, 0),
        ]
    );
    assert_eq!(state.borrow().pending_events(), 0);
}

#[wasm_bindgen_test]
fn keyboard_keydown_does_not_create_transport_repeat_on_wasm32() {
    let (slot, state, mut bus) = setup_keyboard();
    let spec = keyboard_spec();
    assert!(
        spec.event_bitmap(EV_REP)
            .unwrap()
            .iter()
            .all(|byte| *byte == 0)
    );
    post_buffers(&mut bus, 2);

    state.borrow_mut().inject_event(EV_KEY, KEY_A, 1);
    state.borrow_mut().sync();
    let mut eventq = None;
    let mut statusq = None;
    service(&slot, &mut eventq, &mut statusq, &state, &mut bus);
    for _ in 0..32 {
        service(&slot, &mut eventq, &mut statusq, &state, &mut bus);
    }

    assert_eq!(
        read_events(&mut bus),
        vec![
            InputEvent::new(EV_KEY, KEY_A, 1),
            InputEvent::new(EV_SYN, SYN_REPORT, 0),
        ]
    );
    assert_eq!(state.borrow().pending_events(), 0);
}
