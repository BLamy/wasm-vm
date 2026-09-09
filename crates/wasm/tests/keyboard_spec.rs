//! wasm32 fixture for the E5-T11a keyboard capability map.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::dev::virtio::input::keyboard::{
    KEYBOARD_DEVIDS, KEYBOARD_NAME, LED_CAPSL, LED_NUML, LED_SCROLLL, MSC_SCAN, keyboard_spec,
};
use wasm_vm_core::dev::virtio::input::{
    EV_KEY, EV_LED, EV_MSC, EV_REP, EV_SYN, INPUT_CONFIG_UNION_SIZE, VIRTIO_INPUT_CFG_EV_BITS,
    VIRTIO_INPUT_CFG_ID_DEVIDS, VIRTIO_INPUT_CFG_ID_NAME, VirtioInput,
};
use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
use wasm_vm_core::mmio::{MmioDevice, Width};

const CONFIG: u64 = 0x100;

fn select(slot: &mut VirtioMmio, selector: u8, subsel: u8) {
    slot.write(CONFIG, Width::B1, u64::from(selector)).unwrap();
    slot.write(CONFIG + 1, Width::B1, u64::from(subsel))
        .unwrap();
}

fn read_bytes(slot: &mut VirtioMmio, offset: u64, len: usize) -> Vec<u8> {
    (0..len)
        .map(|index| {
            slot.read(CONFIG + offset + index as u64, Width::B1)
                .unwrap() as u8
        })
        .collect()
}

fn assert_bitmap(
    slot: &mut VirtioMmio,
    event_type: u16,
    expected_size: usize,
    expected: &[u8; INPUT_CONFIG_UNION_SIZE],
) {
    select(slot, VIRTIO_INPUT_CFG_EV_BITS, event_type as u8);
    assert_eq!(
        slot.read(CONFIG + 2, Width::B1).unwrap(),
        expected_size as u64
    );
    assert_eq!(read_bytes(slot, 8, INPUT_CONFIG_UNION_SIZE), expected);
}

#[wasm_bindgen_test]
fn keyboard_config_fixture_is_exact_on_wasm32() {
    let spec = keyboard_spec();
    let mut slot = VirtioMmio::new(Box::new(VirtioInput::new(spec.clone())));

    select(&mut slot, VIRTIO_INPUT_CFG_ID_NAME, 0);
    assert_eq!(
        read_bytes(&mut slot, 8, KEYBOARD_NAME.len()),
        KEYBOARD_NAME.as_bytes()
    );

    select(&mut slot, VIRTIO_INPUT_CFG_ID_DEVIDS, 0);
    assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 8);
    assert_eq!(read_bytes(&mut slot, 8, 8), KEYBOARD_DEVIDS.to_bytes());

    let mut key = [0u8; INPUT_CONFIG_UNION_SIZE];
    key[0] = 0xfe;
    key[1..31].fill(0xff);
    key[31] = 0x01;
    assert_bitmap(&mut slot, EV_KEY, 32, &key);

    let mut led = [0u8; INPUT_CONFIG_UNION_SIZE];
    led[0] = (1 << LED_NUML) | (1 << LED_CAPSL) | (1 << LED_SCROLLL);
    assert_bitmap(&mut slot, EV_LED, 1, &led);

    let mut msc = [0u8; INPUT_CONFIG_UNION_SIZE];
    msc[0] = 1 << MSC_SCAN;
    assert_bitmap(&mut slot, EV_MSC, 1, &msc);

    let mut syn = [0u8; INPUT_CONFIG_UNION_SIZE];
    syn[0] = 1;
    assert_bitmap(&mut slot, EV_SYN, 1, &syn);

    let repeat = [0u8; INPUT_CONFIG_UNION_SIZE];
    assert_bitmap(&mut slot, EV_REP, 0, &repeat);
}
