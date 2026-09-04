//! E5-T14a: deterministic tablet/mouse registration, streams, and hostile host injection.

#![cfg(not(feature = "zicsr-stub"))]

use std::boxed::Box;
use std::rc::Rc;
use std::vec::Vec;

use wasm_vm_core::Machine;
use wasm_vm_core::RunOutcome;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::gpu::VirtioGpu;
use wasm_vm_core::dev::virtio::input::keyboard::{KEY_A, KEYBOARD_VIRTIO_SLOT};
use wasm_vm_core::dev::virtio::input::pointer::{
    ABS_X, ABS_Y, BTN_LEFT, BTN_RIGHT, BTN_SIDE, FIRST_FREE_VIRTIO_SLOT, MOUSE_DEVIDS, MOUSE_NAME,
    MOUSE_VIRTIO_SLOT, REL_HWHEEL, REL_WHEEL, REL_X, REL_Y, TABLET_DEVIDS, TABLET_NAME,
    TABLET_VIRTIO_SLOT, tablet_spec,
};
use wasm_vm_core::dev::virtio::input::{
    EV_ABS, EV_KEY, EV_REL, EV_SYN, INPUT_CONFIG_UNION_SIZE, INPUT_EVENT_SIZE, InputEvent,
    SYN_REPORT, VIRTIO_INPUT_CFG_ABS_INFO, VIRTIO_INPUT_CFG_EV_BITS, VIRTIO_INPUT_CFG_ID_DEVIDS,
    VIRTIO_INPUT_CFG_ID_NAME,
};
use wasm_vm_core::platform::{Platform, virt};

const RAM: usize = 8 * 1024 * 1024;
const EVENT_QUEUE: u32 = 0;
const EVENT_QUEUE_SIZE: u16 = 64;

const TABLET_DESC: u64 = virt::DRAM_BASE + 0x10_0000;
const TABLET_AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
const TABLET_USED: u64 = virt::DRAM_BASE + 0x12_0000;
const TABLET_BUF: u64 = virt::DRAM_BASE + 0x13_0000;
const MOUSE_DESC: u64 = virt::DRAM_BASE + 0x14_0000;
const MOUSE_AVAIL: u64 = virt::DRAM_BASE + 0x15_0000;
const MOUSE_USED: u64 = virt::DRAM_BASE + 0x16_0000;
const MOUSE_BUF: u64 = virt::DRAM_BASE + 0x17_0000;
const KEYBOARD_DESC: u64 = virt::DRAM_BASE + 0x18_0000;
const KEYBOARD_AVAIL: u64 = virt::DRAM_BASE + 0x19_0000;
const KEYBOARD_USED: u64 = virt::DRAM_BASE + 0x1a_0000;
const KEYBOARD_BUF: u64 = virt::DRAM_BASE + 0x1b_0000;

fn configure_eventq(
    machine: &mut Machine,
    slot_base: u64,
    desc: u64,
    avail: u64,
    used: u64,
    buffer: u64,
    posted: u16,
) {
    machine.bus_mut().store16(avail, 0).unwrap();
    machine.bus_mut().store16(avail + 2, 0).unwrap();
    machine.bus_mut().store16(used + 2, 0).unwrap();
    for index in 0..u64::from(EVENT_QUEUE_SIZE) {
        let descriptor = desc + 16 * index;
        let event_buffer = buffer + INPUT_EVENT_SIZE as u64 * index;
        machine.bus_mut().store64(descriptor, event_buffer).unwrap();
        machine
            .bus_mut()
            .store32(descriptor + 8, INPUT_EVENT_SIZE as u32)
            .unwrap();
        machine.bus_mut().store16(descriptor + 12, 2).unwrap();
        machine.bus_mut().store16(descriptor + 14, 0).unwrap();
    }

    let write = |machine: &mut Machine, offset: u64, value: u32| {
        machine
            .bus_mut()
            .store32(slot_base + offset, value)
            .unwrap();
    };
    write(machine, 0x30, EVENT_QUEUE);
    write(machine, 0x38, u32::from(EVENT_QUEUE_SIZE));
    write(machine, 0x80, desc as u32);
    write(machine, 0x84, (desc >> 32) as u32);
    write(machine, 0x90, avail as u32);
    write(machine, 0x94, (avail >> 32) as u32);
    write(machine, 0xa0, used as u32);
    write(machine, 0xa4, (used >> 32) as u32);
    write(machine, 0x44, 1);

    for index in 0..posted {
        machine
            .bus_mut()
            .store16(avail + 4 + 2 * u64::from(index), index)
            .unwrap();
    }
    machine.bus_mut().store16(avail + 2, posted).unwrap();
}

fn read_events(machine: &mut Machine, used: u64, buffer: u64) -> Vec<InputEvent> {
    let count = machine.bus_mut().load16(used + 2).unwrap();
    (0..count)
        .map(|index| {
            let head = machine
                .bus_mut()
                .load32(used + 4 + 8 * u64::from(index))
                .unwrap() as u64;
            assert_eq!(
                machine
                    .bus_mut()
                    .load32(used + 8 + 8 * u64::from(index))
                    .unwrap(),
                INPUT_EVENT_SIZE as u32
            );
            let addr = buffer + INPUT_EVENT_SIZE as u64 * head;
            let mut bytes = [0u8; INPUT_EVENT_SIZE];
            for (offset, byte) in bytes.iter_mut().enumerate() {
                *byte = machine.bus_mut().load8(addr + offset as u64).unwrap();
            }
            InputEvent::from_bytes(&bytes)
        })
        .collect()
}

fn select(machine: &mut Machine, slot_base: u64, selector: u8, subsel: u8) {
    machine
        .bus_mut()
        .store8(slot_base + 0x100, selector)
        .unwrap();
    machine.bus_mut().store8(slot_base + 0x101, subsel).unwrap();
}

fn config_bytes(machine: &mut Machine, slot_base: u64, len: usize) -> Vec<u8> {
    (0..len)
        .map(|index| {
            machine
                .bus_mut()
                .load8(slot_base + 0x108 + index as u64)
                .unwrap()
        })
        .collect()
}

fn assert_exact_bitmap(
    machine: &mut Machine,
    slot_base: u64,
    event_type: u16,
    expected_size: u8,
    expected: &[u8; INPUT_CONFIG_UNION_SIZE],
) {
    select(
        machine,
        slot_base,
        VIRTIO_INPUT_CFG_EV_BITS,
        event_type as u8,
    );
    assert_eq!(
        machine.bus_mut().load8(slot_base + 0x102).unwrap(),
        expected_size
    );
    assert_eq!(
        config_bytes(machine, slot_base, INPUT_CONFIG_UNION_SIZE),
        expected
    );
}

fn run_one_boundary(machine: &mut Machine) {
    assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
}

#[test]
fn pointer_devices_have_stable_slots_and_complete_isolated_frames() {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    let _slots = machine.enable_virtio_slots(Some(Box::new(VirtioGpu::new())));
    let (_keyboard_slot, keyboard, _leds) = machine.enable_virtio_keyboard();
    let (tablet_slot, tablet, mouse_slot, mouse) = machine.enable_virtio_pointer();

    assert_eq!(tablet_slot.borrow().queue(0).num, 0);
    assert_eq!(mouse_slot.borrow().queue(0).num, 0);
    assert_eq!(
        machine
            .bus_mut()
            .load32(Platform::virtio_base(TABLET_VIRTIO_SLOT as u64) + 0x08)
            .unwrap(),
        18
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(Platform::virtio_base(MOUSE_VIRTIO_SLOT as u64) + 0x08)
            .unwrap(),
        18
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(Platform::virtio_base(KEYBOARD_VIRTIO_SLOT as u64) + 0x08)
            .unwrap(),
        18
    );
    assert_eq!(
        Platform::virtio_base(TABLET_VIRTIO_SLOT as u64),
        Platform::virtio_base(KEYBOARD_VIRTIO_SLOT as u64) + virt::VIRTIO_STRIDE
    );
    assert_eq!(
        Platform::virtio_base(MOUSE_VIRTIO_SLOT as u64),
        Platform::virtio_base(TABLET_VIRTIO_SLOT as u64) + virt::VIRTIO_STRIDE
    );
    assert_eq!(FIRST_FREE_VIRTIO_SLOT, MOUSE_VIRTIO_SLOT + 1);
    assert!(Rc::ptr_eq(&tablet, &machine.tablet_input().unwrap()));
    assert!(Rc::ptr_eq(&mouse, &machine.mouse_input().unwrap()));

    let tablet_base = Platform::virtio_base(TABLET_VIRTIO_SLOT as u64);
    let mouse_base = Platform::virtio_base(MOUSE_VIRTIO_SLOT as u64);
    select(&mut machine, tablet_base, VIRTIO_INPUT_CFG_ID_DEVIDS, 0);
    assert_eq!(
        config_bytes(&mut machine, tablet_base, 8),
        TABLET_DEVIDS.to_bytes()
    );
    select(&mut machine, tablet_base, VIRTIO_INPUT_CFG_ID_NAME, 0);
    assert_eq!(
        config_bytes(&mut machine, tablet_base, TABLET_NAME.len()),
        TABLET_NAME.as_bytes()
    );
    select(
        &mut machine,
        tablet_base,
        VIRTIO_INPUT_CFG_ABS_INFO,
        ABS_Y as u8,
    );
    assert_eq!(machine.bus_mut().load8(tablet_base + 0x102).unwrap(), 20);
    assert_eq!(
        config_bytes(&mut machine, tablet_base, 20),
        tablet_spec().abs_info[ABS_Y as usize].unwrap().to_bytes()
    );

    let mut tablet_abs = [0u8; INPUT_CONFIG_UNION_SIZE];
    tablet_abs[0] = 0x03;
    assert_exact_bitmap(&mut machine, tablet_base, EV_ABS, 1, &tablet_abs);
    let mut tablet_keys = [0u8; INPUT_CONFIG_UNION_SIZE];
    tablet_keys[34] = 0x1f;
    assert_exact_bitmap(&mut machine, tablet_base, EV_KEY, 35, &tablet_keys);
    let mut mouse_rel = [0u8; INPUT_CONFIG_UNION_SIZE];
    mouse_rel[0] = 0x43;
    mouse_rel[1] = 0x01;
    assert_exact_bitmap(&mut machine, mouse_base, EV_REL, 2, &mouse_rel);
    select(&mut machine, mouse_base, VIRTIO_INPUT_CFG_ID_DEVIDS, 0);
    assert_eq!(
        config_bytes(&mut machine, mouse_base, 8),
        MOUSE_DEVIDS.to_bytes()
    );
    select(&mut machine, mouse_base, VIRTIO_INPUT_CFG_ID_NAME, 0);
    assert_eq!(
        config_bytes(&mut machine, mouse_base, MOUSE_NAME.len()),
        MOUSE_NAME.as_bytes()
    );
    // Permuted unsupported selector reads must be zero-filled and cannot leak the preceding name.
    select(
        &mut machine,
        mouse_base,
        VIRTIO_INPUT_CFG_EV_BITS,
        EV_ABS as u8,
    );
    assert_eq!(machine.bus_mut().load8(mouse_base + 0x102).unwrap(), 0);
    assert_eq!(
        config_bytes(&mut machine, mouse_base, INPUT_CONFIG_UNION_SIZE),
        vec![0; 128]
    );

    configure_eventq(
        &mut machine,
        tablet_base,
        TABLET_DESC,
        TABLET_AVAIL,
        TABLET_USED,
        TABLET_BUF,
        16,
    );
    configure_eventq(
        &mut machine,
        mouse_base,
        MOUSE_DESC,
        MOUSE_AVAIL,
        MOUSE_USED,
        MOUSE_BUF,
        16,
    );
    configure_eventq(
        &mut machine,
        Platform::virtio_base(KEYBOARD_VIRTIO_SLOT as u64),
        KEYBOARD_DESC,
        KEYBOARD_AVAIL,
        KEYBOARD_USED,
        KEYBOARD_BUF,
        16,
    );
    machine
        .bus_mut()
        .store32(virt::KERNEL_BASE, 0x0000_006f)
        .unwrap();
    machine.hart_mut().regs.pc = virt::KERNEL_BASE;

    assert!(tablet.borrow_mut().inject_event(EV_ABS, ABS_X, 1234));
    assert!(tablet.borrow_mut().inject_event(EV_ABS, ABS_Y, 5678));
    assert!(tablet.borrow_mut().inject_event(EV_KEY, BTN_LEFT, 1));
    tablet.borrow_mut().sync();
    assert!(mouse.borrow_mut().inject_event(EV_REL, REL_X, -3));
    assert!(mouse.borrow_mut().inject_event(EV_REL, REL_Y, 4));
    assert!(mouse.borrow_mut().inject_event(EV_REL, REL_WHEEL, 1));
    assert!(mouse.borrow_mut().inject_event(EV_REL, REL_HWHEEL, -1));
    assert!(mouse.borrow_mut().inject_event(EV_KEY, BTN_RIGHT, 1));
    mouse.borrow_mut().sync();
    assert!(keyboard.borrow_mut().inject_event(EV_KEY, KEY_A, 1));
    keyboard.borrow_mut().sync();

    run_one_boundary(&mut machine);

    assert_eq!(
        read_events(&mut machine, TABLET_USED, TABLET_BUF),
        vec![
            InputEvent::new(EV_ABS, ABS_X, 1234),
            InputEvent::new(EV_ABS, ABS_Y, 5678),
            InputEvent::new(EV_KEY, BTN_LEFT, 1),
            InputEvent::new(EV_SYN, SYN_REPORT, 0),
        ]
    );
    assert_eq!(
        read_events(&mut machine, MOUSE_USED, MOUSE_BUF),
        vec![
            InputEvent::new(EV_REL, REL_X, -3),
            InputEvent::new(EV_REL, REL_Y, 4),
            InputEvent::new(EV_REL, REL_WHEEL, 1),
            InputEvent::new(EV_REL, REL_HWHEEL, -1),
            InputEvent::new(EV_KEY, BTN_RIGHT, 1),
            InputEvent::new(EV_SYN, SYN_REPORT, 0),
        ]
    );
    assert_eq!(
        read_events(&mut machine, KEYBOARD_USED, KEYBOARD_BUF),
        vec![
            InputEvent::new(EV_KEY, KEY_A, 1),
            InputEvent::new(EV_SYN, SYN_REPORT, 0),
        ]
    );
    assert_eq!(tablet.borrow().pending_events(), 0);
    assert_eq!(mouse.borrow().pending_events(), 0);
    assert_eq!(keyboard.borrow().pending_events(), 0);
}

#[test]
fn hostile_pointer_injection_is_rejected_without_cross_device_state_changes() {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    let _slots = machine.enable_virtio_slots(None);
    let (_keyboard_slot, keyboard, _leds) = machine.enable_virtio_keyboard();
    let (_tablet_slot, tablet, _mouse_slot, mouse) = machine.enable_virtio_pointer();

    assert!(keyboard.borrow_mut().inject_event(EV_KEY, KEY_A, 1));
    keyboard.borrow_mut().sync();
    let keyboard_pending = keyboard.borrow().pending_events();

    assert!(!tablet.borrow_mut().inject_event(EV_ABS, ABS_X, -1));
    assert!(!tablet.borrow_mut().inject_event(EV_ABS, ABS_Y, 32768));
    assert!(!tablet.borrow_mut().inject_event(EV_REL, REL_X, 1));
    assert!(!tablet.borrow_mut().inject_event(EV_KEY, KEY_A, 1));
    assert!(!tablet.borrow_mut().inject_event(EV_SYN, SYN_REPORT, 0));
    tablet.borrow_mut().sync();

    assert!(!mouse.borrow_mut().inject_event(EV_ABS, ABS_X, 1));
    assert!(!mouse.borrow_mut().inject_event(EV_REL, 2, 1));
    assert!(!mouse.borrow_mut().inject_event(EV_KEY, BTN_RIGHT, 2));
    assert!(!mouse.borrow_mut().inject_event(EV_SYN, SYN_REPORT, 0));
    mouse.borrow_mut().sync();

    assert_eq!(tablet.borrow().pending_events(), 0);
    assert_eq!(mouse.borrow().pending_events(), 0);
    assert_eq!(tablet.borrow().rejected_events, 5);
    assert_eq!(mouse.borrow().rejected_events, 4);
    assert_eq!(keyboard.borrow().pending_events(), keyboard_pending);

    // Slow/no event queues still retain only complete bounded frames. Interleave both devices
    // repeatedly; dropping one pointer's frames cannot touch the other pointer or keyboard.
    tablet.borrow_mut().set_pending_event_budget(4);
    mouse.borrow_mut().set_pending_event_budget(4);
    for value in 0..100 {
        assert!(tablet.borrow_mut().inject_event(EV_ABS, ABS_X, value));
        tablet.borrow_mut().sync();
        assert!(mouse.borrow_mut().inject_event(EV_REL, REL_X, value));
        mouse.borrow_mut().sync();
    }
    assert!(tablet.borrow().pending_events() <= 4);
    assert!(mouse.borrow().pending_events() <= 4);
    assert!(tablet.borrow().pending_frames() <= 2);
    assert!(mouse.borrow().pending_frames() <= 2);
    assert!(tablet.borrow().dropped_frames > 0);
    assert!(mouse.borrow().dropped_frames > 0);
    assert_eq!(keyboard.borrow().pending_events(), keyboard_pending);
    assert_eq!(keyboard.borrow().rejected_events, 0);
}

#[test]
fn pointer_wheel_evtest_fixture_has_signed_detents_and_balanced_buttons() {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    let _slots = machine.enable_virtio_slots(None);
    let (_keyboard_slot, keyboard, _leds) = machine.enable_virtio_keyboard();
    let (_tablet_slot, tablet, _mouse_slot, mouse) = machine.enable_virtio_pointer();

    let mouse_base = Platform::virtio_base(MOUSE_VIRTIO_SLOT as u64);
    configure_eventq(
        &mut machine,
        mouse_base,
        MOUSE_DESC,
        MOUSE_AVAIL,
        MOUSE_USED,
        MOUSE_BUF,
        8,
    );
    machine
        .bus_mut()
        .store32(virt::KERNEL_BASE, 0x0000_006f)
        .unwrap();
    machine.hart_mut().regs.pc = virt::KERNEL_BASE;

    // This is the stable guest-side transcript consumed by the browser proof: horizontal right,
    // vertical up, a side-button make, then its matching break. The queue adds one SYN per frame.
    assert!(mouse.borrow_mut().inject_event(EV_REL, REL_HWHEEL, 1));
    assert!(mouse.borrow_mut().inject_event(EV_REL, REL_WHEEL, -1));
    assert!(mouse.borrow_mut().inject_event(EV_KEY, BTN_SIDE, 1));
    mouse.borrow_mut().sync();
    assert!(mouse.borrow_mut().inject_event(EV_KEY, BTN_SIDE, 0));
    mouse.borrow_mut().sync();
    run_one_boundary(&mut machine);

    assert_eq!(
        read_events(&mut machine, MOUSE_USED, MOUSE_BUF),
        vec![
            InputEvent::new(EV_REL, REL_HWHEEL, 1),
            InputEvent::new(EV_REL, REL_WHEEL, -1),
            InputEvent::new(EV_KEY, BTN_SIDE, 1),
            InputEvent::new(EV_SYN, SYN_REPORT, 0),
            InputEvent::new(EV_KEY, BTN_SIDE, 0),
            InputEvent::new(EV_SYN, SYN_REPORT, 0),
        ]
    );
    assert_eq!(mouse.borrow().pending_events(), 0);
    assert_eq!(tablet.borrow().pending_events(), 0);
    assert_eq!(keyboard.borrow().pending_events(), 0);
}
