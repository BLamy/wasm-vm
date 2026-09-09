//! wasm32 mirror of the E5-T01a virtio-gpu identity and wire-layout checks.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::gpu::Rect;
use wasm_vm_core::dev::virtio::gpu::VIRTIO_GPU_EVENT_DISPLAY;
use wasm_vm_core::dev::virtio::gpu::VirtioGpu;
use wasm_vm_core::dev::virtio::gpu::edid::{EDID_BLOCK_SIZE, edid_for};
use wasm_vm_core::dev::virtio::gpu::protocol::{
    CTRL_HDR_SIZE, CtrlHeader, DISPLAY_INFO_RESPONSE_SIZE, DISPLAY_MODE_COUNT, DISPLAY_MODE_SIZE,
    DisplayInfoResponse, RESP_OK_DISPLAY_INFO,
};
use wasm_vm_core::dev::virtio::gpu::{FlushRecord, FrameSink, TestSink};
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

#[wasm_bindgen_test]
fn gpu_edid_resize_fixture_on_wasm32() {
    let initial = edid_for(1280, 800, 60);
    assert_eq!(initial.len(), EDID_BLOCK_SIZE);
    assert_eq!(
        initial[..8],
        [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]
    );
    assert_eq!(initial[18..20], [1, 4]);
    assert_eq!(
        initial
            .iter()
            .fold(0u8, |sum, byte| sum.wrapping_add(*byte)),
        0
    );

    let mut gpu = VirtioGpu::new();
    gpu.set_display(1365, 769);
    assert_eq!(gpu.display_size(), (1365, 769));
    assert_eq!(gpu.events_read(), VIRTIO_GPU_EVENT_DISPLAY);
    assert_ne!(gpu.edid(), initial);
    assert_eq!(
        gpu.edid()
            .iter()
            .fold(0u8, |sum, byte| sum.wrapping_add(*byte)),
        0
    );
}

fn reference_crc32(pixels: &[u32]) -> u32 {
    let mut crc = 0xffff_ffff;
    for pixel in pixels {
        for byte in pixel.to_le_bytes() {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = if crc & 1 == 0 {
                    crc >> 1
                } else {
                    (crc >> 1) ^ 0xedb8_8320
                };
            }
        }
    }
    !crc
}

#[wasm_bindgen_test]
fn gpu_flush_golden_crc_fixtures_on_wasm32() {
    const WIDTH: u32 = 7;
    const HEIGHT: u32 = 5;
    const RECTS: [Rect; 5] = [
        Rect {
            x: 0,
            y: 0,
            width: 7,
            height: 5,
        },
        Rect {
            x: 2,
            y: 1,
            width: 3,
            height: 2,
        },
        Rect {
            x: 1,
            y: 0,
            width: 5,
            height: 3,
        },
        Rect {
            x: 0,
            y: 2,
            width: 7,
            height: 2,
        },
        Rect {
            x: 4,
            y: 3,
            width: 3,
            height: 2,
        },
    ];
    const CRC32: [u32; 5] = [
        0x2d06_8e19,
        0x80e3_df97,
        0xcafe_b5cb,
        0x74f3_ca70,
        0x4b09_d24f,
    ];

    let sink = TestSink::new();
    for (index, &rect) in RECTS.iter().enumerate() {
        let mut pattern = Vec::with_capacity((WIDTH * HEIGHT) as usize);
        for y in 0..HEIGHT {
            for x in 0..WIDTH {
                pattern.push(match index {
                    0 => 0x1122_3344,
                    1 => {
                        if (x + y) % 2 == 0 {
                            0xff00_00ff
                        } else {
                            0xff00_ff00
                        }
                    }
                    2 => 0x1000_0000 | ((x * 0x19) << 16) | ((y * 0x27) << 8) | (x + y),
                    3 => {
                        if x == y || x + y + 1 == WIDTH {
                            0xffff_ff00
                        } else {
                            0x0012_3456
                        }
                    }
                    _ => 0x5500_0000 | ((x * 0x31) ^ (y * 0x17)),
                });
            }
        }
        let mut expected = vec![0u32; pattern.len()];
        for row in rect.y..rect.y + rect.height {
            for column in rect.x..rect.x + rect.width {
                let pixel = (row * WIDTH + column) as usize;
                expected[pixel] = pattern[pixel];
            }
        }
        assert_eq!(reference_crc32(&expected), CRC32[index]);
        let mut handle = sink.clone();
        handle.flush(Some(0), rect, WIDTH, HEIGHT, &expected);
        assert_eq!(
            sink.records().last().copied(),
            Some(FlushRecord {
                scanout: Some(0),
                rect,
                resource_width: WIDTH,
                resource_height: HEIGHT,
                crc32: CRC32[index],
            })
        );
    }
    assert_eq!(sink.len(), 5);
}
