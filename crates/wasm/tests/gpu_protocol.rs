//! wasm32 mirror of the E5-T01a virtio-gpu identity and wire-layout checks.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::gpu::VirtioGpu;
use wasm_vm_core::dev::virtio::gpu::protocol::{
    CTRL_HDR_SIZE, CtrlHeader, DISPLAY_INFO_RESPONSE_SIZE, DISPLAY_MODE_COUNT, DISPLAY_MODE_SIZE,
    DisplayInfoResponse, RESP_OK_DISPLAY_INFO,
};
use wasm_vm_core::platform::Platform;

#[wasm_bindgen_test]
fn gpu_wire_fixture_is_little_endian_on_wasm32() {
    let header = CtrlHeader {
        ty: RESP_OK_DISPLAY_INFO,
        flags: 0xA1B2_C3D4,
        fence_id: 0x1122_3344_5566_7788,
        ctx_id: 0x0102_0304,
        ring_idx: 0x05,
        padding: [0x06, 0x07, 0x08],
    };
    let response = DisplayInfoResponse::new(header);
    let bytes = response.to_bytes();
    assert_eq!(bytes.len(), DISPLAY_INFO_RESPONSE_SIZE);
    assert_eq!(&bytes[..CTRL_HDR_SIZE], &header.to_bytes());
    for index in 0..DISPLAY_MODE_COUNT {
        let start = CTRL_HDR_SIZE + index * DISPLAY_MODE_SIZE;
        let mode = &bytes[start..start + DISPLAY_MODE_SIZE];
        if index == 0 {
            assert_eq!(&mode[0..4], &[0, 0, 0, 0]);
            assert_eq!(&mode[4..8], &[0, 0, 0, 0]);
            assert_eq!(&mode[8..12], &[0, 5, 0, 0]);
            assert_eq!(&mode[12..16], &[0x20, 0x03, 0, 0]);
            assert_eq!(&mode[16..20], &[1, 0, 0, 0]);
        } else {
            assert_eq!(mode, &[0; DISPLAY_MODE_SIZE]);
        }
    }
    assert_eq!(DisplayInfoResponse::from_bytes(&bytes), Some(response));
}

#[wasm_bindgen_test]
fn gpu_mmio_identity_and_config_on_wasm32() {
    let mut machine = Machine::new(4 * 1024 * 1024);
    machine.enable_plic();
    let _slots = machine.enable_virtio_slots(Some(Box::new(VirtioGpu::new())));
    let base = Platform::virtio_base(0);
    assert_eq!(machine.bus_mut().load32(base + 0x08).unwrap(), 16);
    assert_eq!(machine.bus_mut().load32(base + 0x108).unwrap(), 1);
    assert_eq!(machine.bus_mut().load32(base + 0x10c).unwrap(), 0);
}
