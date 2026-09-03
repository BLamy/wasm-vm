//! E5-T11b: concrete keyboard registration and host LED status delivery through Machine.

#![cfg(not(feature = "zicsr-stub"))]

use std::rc::Rc;

use wasm_vm_core::Machine;
use wasm_vm_core::RunOutcome;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::gpu::VirtioGpu;
use wasm_vm_core::dev::virtio::input::keyboard::{
    KEYBOARD_VIRTIO_SLOT, KeyboardLedState, LED_CAPSL, LED_NUML, LED_SCROLLL,
};
use wasm_vm_core::dev::virtio::input::{EV_LED, InputEvent, STATUS_QUEUE};
use wasm_vm_core::platform::{Platform, virt};

const RAM: usize = 8 * 1024 * 1024;
const STATUS_QUEUE_SIZE: u16 = 128;
const STATUS_DESC: u64 = virt::DRAM_BASE + 0x10_0000;
const STATUS_AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
const STATUS_USED: u64 = virt::DRAM_BASE + 0x12_0000;
const STATUS_BUF: u64 = virt::DRAM_BASE + 0x13_0000;

fn configure_statusq(machine: &mut Machine, slot_base: u64) {
    machine.bus_mut().store16(STATUS_AVAIL, 0).unwrap();
    machine.bus_mut().store16(STATUS_USED + 2, 0).unwrap();
    for index in 0..u64::from(STATUS_QUEUE_SIZE) {
        let desc = STATUS_DESC + 16 * index;
        let buffer = STATUS_BUF + 8 * index;
        machine.bus_mut().store64(desc, buffer).unwrap();
        machine.bus_mut().store32(desc + 8, 8).unwrap();
        machine.bus_mut().store16(desc + 12, 0).unwrap();
        machine.bus_mut().store16(desc + 14, 0).unwrap();
    }

    let write = |machine: &mut Machine, offset: u64, value: u32| {
        machine
            .bus_mut()
            .store32(slot_base + offset, value)
            .unwrap();
    };
    write(machine, 0x30, STATUS_QUEUE);
    write(machine, 0x38, u32::from(STATUS_QUEUE_SIZE));
    write(machine, 0x80, STATUS_DESC as u32);
    write(machine, 0x84, (STATUS_DESC >> 32) as u32);
    write(machine, 0x90, STATUS_AVAIL as u32);
    write(machine, 0x94, (STATUS_AVAIL >> 32) as u32);
    write(machine, 0xa0, STATUS_USED as u32);
    write(machine, 0xa4, (STATUS_USED >> 32) as u32);
    write(machine, 0x44, 1);
}

fn post_status(machine: &mut Machine, slot_base: u64, sequence: &mut u16, event: InputEvent) {
    let index = *sequence % STATUS_QUEUE_SIZE;
    let buffer = STATUS_BUF + 8 * u64::from(index);
    for (offset, byte) in event.to_bytes().iter().copied().enumerate() {
        machine
            .bus_mut()
            .store8(buffer + offset as u64, byte)
            .unwrap();
    }
    machine
        .bus_mut()
        .store16(STATUS_AVAIL + 4 + 2 * u64::from(index), index)
        .unwrap();
    *sequence = sequence.wrapping_add(1);
    machine
        .bus_mut()
        .store16(STATUS_AVAIL + 2, *sequence)
        .unwrap();
    machine
        .bus_mut()
        .store32(slot_base + 0x50, STATUS_QUEUE)
        .unwrap();
}

fn run_one_boundary(machine: &mut Machine) {
    assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
}

fn assert_led(state: &KeyboardLedState, code: u16, value: i32) {
    let expected = value == 1;
    match code {
        LED_NUML => assert_eq!(state.num_lock, expected),
        LED_CAPSL => assert_eq!(state.caps_lock, expected),
        LED_SCROLLL => assert_eq!(state.scroll_lock, expected),
        _ => panic!("unexpected LED code {code}"),
    }
}

#[test]
fn keyboard_registers_in_slot_three_without_disturbing_gpu_or_empty_slots() {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    let _slots = machine.enable_virtio_slots(Some(Box::new(VirtioGpu::new())));
    let (slot, input_state, leds) = machine.enable_virtio_keyboard();

    assert_eq!(slot.borrow().queue(0).num, 0);
    assert_eq!(
        machine
            .bus_mut()
            .load32(Platform::virtio_base(0) + 0x08)
            .unwrap(),
        16
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(Platform::virtio_base(KEYBOARD_VIRTIO_SLOT as u64) + 0x08)
            .unwrap(),
        18
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(Platform::virtio_base(1) + 0x08)
            .unwrap(),
        0
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(Platform::virtio_base(2) + 0x08)
            .unwrap(),
        0
    );
    assert!(Rc::ptr_eq(&leds, &machine.keyboard_leds().unwrap()));
    assert_eq!(input_state.borrow().status_events_served, 0);
}

#[test]
fn keyboard_led_status_order_survives_reset_and_queue_re_setup() {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    let _slots = machine.enable_virtio_slots(None);
    let (slot, input_state, leds) = machine.enable_virtio_keyboard();
    let slot_base = Platform::virtio_base(KEYBOARD_VIRTIO_SLOT as u64);

    // A harmless self-loop gives each public run call one real instruction after the device
    // boundary, keeping status delivery on the normal Machine path.
    machine
        .bus_mut()
        .store32(virt::KERNEL_BASE, 0x0000_006f)
        .unwrap();
    machine.hart_mut().regs.pc = virt::KERNEL_BASE;
    configure_statusq(&mut machine, slot_base);

    let mut sequence = 0;
    for index in 0..100u16 {
        let code = match index % 3 {
            0 => LED_CAPSL,
            1 => LED_NUML,
            _ => LED_SCROLLL,
        };
        let value = i32::from(index % 2);
        post_status(
            &mut machine,
            slot_base,
            &mut sequence,
            InputEvent::new(EV_LED, code, value),
        );
        run_one_boundary(&mut machine);
        assert_led(&leds.borrow(), code, value);
    }
    assert_eq!(input_state.borrow().status_events_served, 100);

    // A transport reset clears ring views and queue flags but deliberately retains the shared
    // callback sink and host-owned indicator. Re-setup must therefore deliver the next event.
    machine.bus_mut().store32(slot_base + 0x70, 0).unwrap();
    assert!(leds.borrow().caps_lock);
    assert!(leds.borrow().num_lock);
    assert!(!leds.borrow().scroll_lock);
    configure_statusq(&mut machine, slot_base);
    sequence = 0;
    post_status(
        &mut machine,
        slot_base,
        &mut sequence,
        InputEvent::new(EV_LED, LED_CAPSL, 1),
    );
    run_one_boundary(&mut machine);

    assert!(leds.borrow().caps_lock);
    assert_eq!(input_state.borrow().status_events_served, 101);
    assert_eq!(
        slot.borrow().queue(STATUS_QUEUE as usize).num,
        u32::from(STATUS_QUEUE_SIZE)
    );
}
