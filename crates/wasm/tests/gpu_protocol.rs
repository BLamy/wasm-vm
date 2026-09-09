//! wasm32 mirror of the E5-T01a virtio-gpu identity and wire-layout checks.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::Machine;
use wasm_vm_core::RunOutcome;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::gpu::VIRTIO_GPU_EVENT_DISPLAY;
use wasm_vm_core::dev::virtio::gpu::VirtioGpu;
use wasm_vm_core::dev::virtio::gpu::edid::{EDID_BLOCK_SIZE, edid_for};
use wasm_vm_core::dev::virtio::gpu::protocol::{
    CMD_MOVE_CURSOR, CMD_UPDATE_CURSOR, CTRL_HDR_SIZE, CtrlHeader, CursorPos,
    DISPLAY_INFO_RESPONSE_SIZE, DISPLAY_MODE_COUNT, DISPLAY_MODE_SIZE, DisplayInfoResponse,
    FORMAT_B8G8R8A8_UNORM, MOVE_CURSOR_SIZE, MoveCursor, RESP_ERR_INVALID_PARAMETER,
    RESP_ERR_INVALID_SCANOUT_ID, RESP_OK_DISPLAY_INFO, RESP_OK_NODATA, UPDATE_CURSOR_SIZE,
    UpdateCursor,
};
use wasm_vm_core::dev::virtio::gpu::{CursorState, MAX_CURSOR_DIMENSION, Rect};
use wasm_vm_core::dev::virtio::gpu::{FlushRecord, FrameSink, TestSink};
use wasm_vm_core::platform::{Platform, virt};

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
        handle.flush(
            Some(0),
            FORMAT_B8G8R8A8_UNORM,
            rect,
            WIDTH,
            HEIGHT,
            &expected,
        );
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

const CURSOR_RAM: usize = 4 * 1024 * 1024;
const CURSOR_QUEUE_SIZE: u32 = 16;
const CURSOR_DESC: u64 = virt::DRAM_BASE + 0x6000;
const CURSOR_AVAIL: u64 = virt::DRAM_BASE + 0x7000;
const CURSOR_USED: u64 = virt::DRAM_BASE + 0x8000;
const CURSOR_REQUEST: u64 = virt::DRAM_BASE + 0x9000;
const CURSOR_RESPONSE: u64 = virt::DRAM_BASE + 0xA000;

fn write_cursor_bytes(machine: &mut Machine, address: u64, bytes: &[u8]) {
    for (offset, byte) in bytes.iter().copied().enumerate() {
        machine
            .bus_mut()
            .store8(address + offset as u64, byte)
            .unwrap();
    }
}

fn write_cursor_desc(
    machine: &mut Machine,
    index: usize,
    address: u64,
    length: u32,
    flags: u16,
    next: u16,
) {
    let descriptor = CURSOR_DESC + index as u64 * 16;
    machine.bus_mut().store64(descriptor, address).unwrap();
    machine.bus_mut().store32(descriptor + 8, length).unwrap();
    machine.bus_mut().store16(descriptor + 12, flags).unwrap();
    machine.bus_mut().store16(descriptor + 14, next).unwrap();
}

fn cursor_update_request(
    scanout_id: u32,
    x: u32,
    y: u32,
    resource_id: u32,
    hot_x: u32,
    hot_y: u32,
) -> [u8; UPDATE_CURSOR_SIZE] {
    UpdateCursor {
        header: CtrlHeader {
            ty: CMD_UPDATE_CURSOR,
            ..CtrlHeader::default()
        },
        pos: CursorPos {
            scanout_id,
            x,
            y,
            padding: 0xDEAD_BEEF,
        },
        resource_id,
        hot_x,
        hot_y,
        padding: 0xCAFE_BABE,
    }
    .to_bytes()
}

fn cursor_move_request(scanout_id: u32, x: u32, y: u32) -> [u8; MOVE_CURSOR_SIZE] {
    MoveCursor {
        header: CtrlHeader {
            ty: CMD_MOVE_CURSOR,
            ..CtrlHeader::default()
        },
        pos: CursorPos {
            scanout_id,
            x,
            y,
            padding: 0xDEAD_BEEF,
        },
    }
    .to_bytes()
}

#[wasm_bindgen_test]
fn gpu_cursorq_sequence_matches_native_through_wasm_machine_boundary() {
    let mut machine = Machine::new(CURSOR_RAM);
    machine.enable_plic();
    let _slots = machine.enable_virtio_slots(None);
    let sink = TestSink::new();
    let (_slot, state) = machine
        .enable_virtio_gpu(Box::new(sink.clone()))
        .expect("slot 7 is free");

    state
        .borrow_mut()
        .resources
        .create(7, FORMAT_B8G8R8A8_UNORM, 64, 64)
        .unwrap();
    state
        .borrow_mut()
        .resources
        .create(8, FORMAT_B8G8R8A8_UNORM, MAX_CURSOR_DIMENSION + 1, 64)
        .unwrap();

    let requests = [
        cursor_update_request(0, 40, 50, 7, 10, 3).to_vec(),
        cursor_move_request(0, 41, 51).to_vec(),
        cursor_update_request(0, 42, 52, 0, u32::MAX, u32::MAX).to_vec(),
        cursor_move_request(0, 43, 53).to_vec(),
        cursor_update_request(0, 44, 54, 7, 64, 0).to_vec(),
        cursor_update_request(1, 45, 55, 7, 10, 3).to_vec(),
        cursor_update_request(0, 46, 56, 8, 0, 0).to_vec(),
        cursor_update_request(0, 47, 57, 7, 10, 3).to_vec(),
    ];
    for (index, request) in requests.iter().enumerate() {
        write_cursor_bytes(&mut machine, CURSOR_REQUEST + index as u64 * 0x100, request);
        let request_len = if index == requests.len() - 1 {
            (UPDATE_CURSOR_SIZE - 1) as u32
        } else if index == 1 || index == 3 {
            MOVE_CURSOR_SIZE as u32
        } else {
            UPDATE_CURSOR_SIZE as u32
        };
        let request_desc = index * 2;
        let response_desc = request_desc + 1;
        write_cursor_desc(
            &mut machine,
            request_desc,
            CURSOR_REQUEST + index as u64 * 0x100,
            request_len,
            1,
            response_desc as u16,
        );
        write_cursor_desc(
            &mut machine,
            response_desc,
            CURSOR_RESPONSE + index as u64 * 0x100,
            CTRL_HDR_SIZE as u32,
            2,
            0,
        );
    }

    machine.bus_mut().store16(CURSOR_AVAIL, 0).unwrap();
    machine
        .bus_mut()
        .store16(CURSOR_AVAIL + 2, requests.len() as u16)
        .unwrap();
    for (index, _) in requests.iter().enumerate() {
        machine
            .bus_mut()
            .store16(CURSOR_AVAIL + 4 + index as u64 * 2, (index * 2) as u16)
            .unwrap();
    }
    machine.bus_mut().store16(CURSOR_USED, 0).unwrap();
    machine.bus_mut().store16(CURSOR_USED + 2, 0).unwrap();

    let slot_base = Platform::virtio_base(machine.virtio_gpu().unwrap().0 as u64);
    let write_mmio = |machine: &mut Machine, offset: u64, value: u32| {
        machine
            .bus_mut()
            .store32(slot_base + offset, value)
            .unwrap();
    };
    write_mmio(&mut machine, 0x30, 1); // QueueSel = cursorq.
    write_mmio(&mut machine, 0x38, CURSOR_QUEUE_SIZE);
    write_mmio(&mut machine, 0x80, CURSOR_DESC as u32);
    write_mmio(&mut machine, 0x84, (CURSOR_DESC >> 32) as u32);
    write_mmio(&mut machine, 0x90, CURSOR_AVAIL as u32);
    write_mmio(&mut machine, 0x94, (CURSOR_AVAIL >> 32) as u32);
    write_mmio(&mut machine, 0xa0, CURSOR_USED as u32);
    write_mmio(&mut machine, 0xa4, (CURSOR_USED >> 32) as u32);
    write_mmio(&mut machine, 0x44, 1); // QueueReady.
    write_mmio(&mut machine, 0x50, 1); // QueueNotify: defer the walk to Machine's boundary.

    machine
        .bus_mut()
        .store32(virt::KERNEL_BASE, 0x0000_006f)
        .unwrap();
    machine.hart_mut().regs.pc = virt::KERNEL_BASE;
    assert_eq!(machine.run(1), RunOutcome::MaxInstrs);

    assert_eq!(machine.bus_mut().load16(CURSOR_USED + 2).unwrap(), 8);
    assert_eq!(
        machine.bus_mut().load32(CURSOR_RESPONSE).unwrap(),
        RESP_OK_NODATA
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(CURSOR_RESPONSE + 3 * 0x100)
            .unwrap(),
        RESP_ERR_INVALID_PARAMETER
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(CURSOR_RESPONSE + 5 * 0x100)
            .unwrap(),
        RESP_ERR_INVALID_SCANOUT_ID
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(CURSOR_RESPONSE + 7 * 0x100)
            .unwrap(),
        RESP_ERR_INVALID_PARAMETER
    );

    let expected_callbacks = [
        CursorState {
            resource_id: 7,
            hot_x: 10,
            hot_y: 3,
            pos: CursorPos {
                scanout_id: 0,
                x: 40,
                y: 50,
                padding: 0,
            },
        },
        CursorState {
            resource_id: 7,
            hot_x: 10,
            hot_y: 3,
            pos: CursorPos {
                scanout_id: 0,
                x: 41,
                y: 51,
                padding: 0,
            },
        },
        CursorState {
            resource_id: 0,
            hot_x: 0,
            hot_y: 0,
            pos: CursorPos {
                scanout_id: 0,
                x: 42,
                y: 52,
                padding: 0,
            },
        },
    ];
    assert_eq!(sink.cursor_records().as_slice(), &expected_callbacks);
    assert_eq!(
        state.borrow().cursor_state(0),
        Some(CursorState {
            resource_id: 0,
            hot_x: 0,
            hot_y: 0,
            pos: CursorPos {
                scanout_id: 0,
                x: 42,
                y: 52,
                padding: 0,
            },
        })
    );
}
