//! wasm32 mirror of the E5-T10a virtio-input configuration contract.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::dev::virtio::input::{
    AbsInfo, BUS_VIRTUAL, EV_ABS, EV_KEY, INPUT_CONFIG_UNION_SIZE, InputDeviceSpec, InputDevids,
    VIRTIO_INPUT_CFG_ABS_INFO, VIRTIO_INPUT_CFG_EV_BITS, VIRTIO_INPUT_CFG_ID_DEVIDS,
    VIRTIO_INPUT_CFG_ID_NAME, VIRTIO_INPUT_CFG_PROP_BITS, VirtioInput,
};
use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
use wasm_vm_core::mmio::{MmioDevice, Width};

const CONFIG: u64 = 0x100;

fn fixture_spec() -> InputDeviceSpec {
    let mut spec = InputDeviceSpec::new(
        "wasm fixture input",
        InputDevids {
            bustype: BUS_VIRTUAL,
            vendor: 0x1234,
            product: 0x5678,
            version: 0x0102,
        },
    );
    assert!(spec.set_property_bit(3));
    assert!(spec.set_event_bit(EV_KEY, 30));
    assert!(spec.set_event_bit(EV_ABS, 0));
    assert!(spec.set_abs_info(
        0,
        AbsInfo {
            min: -10,
            max: 32767,
            fuzz: 2,
            flat: 3,
            resolution: 100,
        }
    ));
    spec
}

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

#[wasm_bindgen_test]
fn input_config_fixture_is_identical_on_wasm32() {
    let spec = fixture_spec();
    let mut slot = VirtioMmio::new(Box::new(VirtioInput::new(spec.clone())));

    select(&mut slot, VIRTIO_INPUT_CFG_ID_NAME, 0);
    assert_eq!(
        read_bytes(&mut slot, 8, spec.name.len()),
        spec.name.as_bytes()
    );

    select(&mut slot, VIRTIO_INPUT_CFG_ID_DEVIDS, 0);
    assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 8);
    assert_eq!(
        read_bytes(&mut slot, 8, 8),
        vec![0x06, 0x00, 0x34, 0x12, 0x78, 0x56, 0x02, 0x01]
    );

    select(&mut slot, VIRTIO_INPUT_CFG_PROP_BITS, 0);
    assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 1);
    assert_eq!(read_bytes(&mut slot, 8, 1), vec![0x08]);

    select(&mut slot, VIRTIO_INPUT_CFG_EV_BITS, EV_KEY as u8);
    assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 4);
    assert_eq!(read_bytes(&mut slot, 8, 4), vec![0, 0, 0, 0x40]);

    select(&mut slot, VIRTIO_INPUT_CFG_ABS_INFO, 0);
    assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 20);
    assert_eq!(
        read_bytes(&mut slot, 8, 20),
        vec![
            0xf6, 0xff, 0xff, 0xff, 0xff, 0x7f, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 100, 0, 0, 0,
        ]
    );

    select(&mut slot, VIRTIO_INPUT_CFG_EV_BITS, EV_ABS as u8);
    assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 1);
    assert_eq!(read_bytes(&mut slot, 8, INPUT_CONFIG_UNION_SIZE), {
        let mut bytes = vec![0; INPUT_CONFIG_UNION_SIZE];
        bytes[0] = 1;
        bytes
    });
}
