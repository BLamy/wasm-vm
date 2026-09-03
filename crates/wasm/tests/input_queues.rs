//! wasm32 mirror of the E5-T10b virtio-input event queue wire contract.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::dev::virtio::input::{EV_KEY, EV_LED, INPUT_EVENT_SIZE, InputEvent};

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
