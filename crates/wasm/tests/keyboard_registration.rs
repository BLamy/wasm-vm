//! wasm32 registration/config fixture for E5-T11b.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::gpu::VirtioGpu;
use wasm_vm_core::dev::virtio::input::keyboard::{
    KEYBOARD_DEVIDS, KEYBOARD_NAME, KEYBOARD_VIRTIO_SLOT, LED_CAPSL, LED_NUML, LED_SCROLLL,
    MSC_SCAN,
};
use wasm_vm_core::dev::virtio::input::{
    EV_KEY, EV_LED, EV_MSC, EV_REP, EV_SYN, INPUT_CONFIG_UNION_SIZE, VIRTIO_INPUT_CFG_EV_BITS,
    VIRTIO_INPUT_CFG_ID_DEVIDS, VIRTIO_INPUT_CFG_ID_NAME,
};
use wasm_vm_core::platform::Platform;

fn select(machine: &mut Machine, base: u64, selector: u8, subsel: u8) {
    machine.bus_mut().store8(base + 0x100, selector).unwrap();
    machine.bus_mut().store8(base + 0x101, subsel).unwrap();
}

fn read_bytes(machine: &mut Machine, base: u64, offset: u64, len: usize) -> Vec<u8> {
    (0..len)
        .map(|index| {
            machine
                .bus_mut()
                .load8(base + offset + index as u64)
                .unwrap()
        })
        .collect()
}

fn assert_bitmap(
    machine: &mut Machine,
    base: u64,
    event_type: u16,
    expected_size: u8,
    expected: &[u8; INPUT_CONFIG_UNION_SIZE],
) {
    select(machine, base, VIRTIO_INPUT_CFG_EV_BITS, event_type as u8);
    assert_eq!(
        machine.bus_mut().load8(base + 0x102).unwrap(),
        expected_size
    );
    assert_eq!(
        read_bytes(machine, base, 0x108, INPUT_CONFIG_UNION_SIZE),
        expected
    );
}

#[wasm_bindgen_test]
fn keyboard_registration_and_config_are_stable_on_wasm32() {
    let mut machine = Machine::new(4 * 1024 * 1024);
    machine.enable_plic();
    let _slots = machine.enable_virtio_slots(Some(Box::new(VirtioGpu::new())));
    let (_slot, _input_state, leds) = machine.enable_virtio_keyboard();
    let base = Platform::virtio_base(KEYBOARD_VIRTIO_SLOT as u64);

    assert_eq!(machine.bus_mut().load32(base + 0x08).unwrap(), 18);
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
    assert_eq!(*leds.borrow(), Default::default());

    select(&mut machine, base, VIRTIO_INPUT_CFG_ID_NAME, 0);
    assert_eq!(
        read_bytes(&mut machine, base, 0x108, KEYBOARD_NAME.len()),
        KEYBOARD_NAME.as_bytes()
    );

    select(&mut machine, base, VIRTIO_INPUT_CFG_ID_DEVIDS, 0);
    assert_eq!(machine.bus_mut().load8(base + 0x102).unwrap(), 8);
    assert_eq!(
        read_bytes(&mut machine, base, 0x108, 8),
        KEYBOARD_DEVIDS.to_bytes()
    );

    let mut key = [0u8; INPUT_CONFIG_UNION_SIZE];
    key[0] = 0xfe;
    key[1..31].fill(0xff);
    key[31] = 0x01;
    assert_bitmap(&mut machine, base, EV_KEY, 32, &key);

    let mut led = [0u8; INPUT_CONFIG_UNION_SIZE];
    led[0] = (1 << LED_NUML) | (1 << LED_CAPSL) | (1 << LED_SCROLLL);
    assert_bitmap(&mut machine, base, EV_LED, 1, &led);

    let mut msc = [0u8; INPUT_CONFIG_UNION_SIZE];
    msc[0] = 1 << MSC_SCAN;
    assert_bitmap(&mut machine, base, EV_MSC, 1, &msc);

    let mut syn = [0u8; INPUT_CONFIG_UNION_SIZE];
    syn[0] = 1;
    assert_bitmap(&mut machine, base, EV_SYN, 1, &syn);

    let repeat = [0u8; INPUT_CONFIG_UNION_SIZE];
    assert_bitmap(&mut machine, base, EV_REP, 0, &repeat);
}
