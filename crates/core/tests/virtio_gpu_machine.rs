//! E5-T06d: verify that Machine owns and services the browser-facing virtio-gpu queue.

#![cfg(not(feature = "zicsr-stub"))]

use std::rc::Rc;

use wasm_vm_core::Machine;
use wasm_vm_core::RunOutcome;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::gpu::protocol::{
    CMD_GET_DISPLAY_INFO, CMD_MOVE_CURSOR, CMD_UPDATE_CURSOR, CTRL_HDR_SIZE, CtrlHeader, CursorPos,
    DISPLAY_INFO_RESPONSE_SIZE, FORMAT_B8G8R8A8_UNORM, MOVE_CURSOR_SIZE, MoveCursor,
    RESP_ERR_INVALID_PARAMETER, RESP_ERR_INVALID_SCANOUT_ID, RESP_OK_DISPLAY_INFO, RESP_OK_NODATA,
    UPDATE_CURSOR_SIZE, UpdateCursor,
};
use wasm_vm_core::dev::virtio::gpu::{
    CursorState, FrameSink, MAX_CURSOR_DIMENSION, NullSink, TestSink, VirtioGpu,
};
use wasm_vm_core::platform::{Platform, virt};

const RAM: usize = 8 * 1024 * 1024;
const QUEUE_SIZE: u32 = 8;
const DESC: u64 = virt::DRAM_BASE + 0x10_0000;
const AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
const USED: u64 = virt::DRAM_BASE + 0x12_0000;
const REQUEST: u64 = virt::DRAM_BASE + 0x13_0000;
const RESPONSE: u64 = virt::DRAM_BASE + 0x14_0000;
const CURSOR_DESC: u64 = virt::DRAM_BASE + 0x6000;
const CURSOR_AVAIL: u64 = virt::DRAM_BASE + 0x7000;
const CURSOR_USED: u64 = virt::DRAM_BASE + 0x8000;
const CURSOR_REQUEST: u64 = virt::DRAM_BASE + 0x9000;
const CURSOR_RESPONSE: u64 = virt::DRAM_BASE + 0xA000;

struct NoopSink;

impl FrameSink for NoopSink {
    fn flush(
        &mut self,
        _scanout: Option<u32>,
        _format: u32,
        _rect: wasm_vm_core::dev::virtio::gpu::Rect,
        _resource_width: u32,
        _resource_height: u32,
        _pixels: &[u32],
    ) {
    }
}

fn write_desc(machine: &mut Machine, index: u64, addr: u64, len: u32, flags: u16, next: u16) {
    let base = DESC + index * 16;
    machine.bus_mut().store64(base, addr).unwrap();
    machine.bus_mut().store32(base + 8, len).unwrap();
    machine.bus_mut().store16(base + 12, flags).unwrap();
    machine.bus_mut().store16(base + 14, next).unwrap();
}

fn setup_controlq(machine: &mut Machine, slot_base: u64) {
    let request = CtrlHeader {
        ty: CMD_GET_DISPLAY_INFO,
        ..CtrlHeader::default()
    }
    .to_bytes();
    for (offset, byte) in request.into_iter().enumerate() {
        machine
            .bus_mut()
            .store8(REQUEST + offset as u64, byte)
            .unwrap();
    }
    write_desc(machine, 0, REQUEST, CTRL_HDR_SIZE as u32, 1, 1);
    write_desc(
        machine,
        1,
        RESPONSE,
        DISPLAY_INFO_RESPONSE_SIZE as u32,
        2,
        0,
    );
    machine.bus_mut().store16(AVAIL, 0).unwrap();
    machine.bus_mut().store16(AVAIL + 2, 1).unwrap();
    machine.bus_mut().store16(AVAIL + 4, 0).unwrap();
    machine.bus_mut().store16(USED, 0).unwrap();
    machine.bus_mut().store16(USED + 2, 0).unwrap();

    let write = |machine: &mut Machine, offset: u64, value: u32| {
        machine
            .bus_mut()
            .store32(slot_base + offset, value)
            .unwrap();
    };
    write(machine, 0x30, 0); // QueueSel = controlq.
    write(machine, 0x38, QUEUE_SIZE);
    write(machine, 0x80, DESC as u32);
    write(machine, 0x84, (DESC >> 32) as u32);
    write(machine, 0x90, AVAIL as u32);
    write(machine, 0x94, (AVAIL >> 32) as u32);
    write(machine, 0xa0, USED as u32);
    write(machine, 0xa4, (USED >> 32) as u32);
    write(machine, 0x44, 1); // QueueReady.
    write(machine, 0x50, 0); // QueueNotify: defer the walk to Machine's device boundary.
}

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

#[test]
fn gpu_uses_the_remaining_optional_slot_and_machine_boundary_drains_controlq() {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    let slots = machine.enable_virtio_slots(None);
    let (slot, state) = machine
        .enable_virtio_gpu(Box::new(NullSink))
        .expect("slot 7 is free");

    assert_eq!(machine.virtio_gpu().unwrap().0, 7);
    assert!(Rc::ptr_eq(&state, &machine.virtio_gpu().unwrap().1));
    assert!(Rc::ptr_eq(&slot, &slots[7]));
    assert_eq!(slot.borrow().device_id(), 16);

    // One real instruction keeps the queue walk on the production run boundary instead of
    // calling the GPU service directly from the test.
    machine
        .bus_mut()
        .store32(virt::KERNEL_BASE, 0x0000_006f)
        .unwrap();
    machine.hart_mut().regs.pc = virt::KERNEL_BASE;
    setup_controlq(&mut machine, Platform::virtio_base(7));
    assert_eq!(machine.run(1), RunOutcome::MaxInstrs);

    assert_eq!(state.borrow().commands_served, 1);
    assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 1);
    assert_eq!(
        machine.bus_mut().load32(RESPONSE).unwrap(),
        RESP_OK_DISPLAY_INFO
    );
}

#[test]
fn gpu_falls_back_to_slot_six_without_replacing_an_existing_optional_device() {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    let slots = machine.enable_virtio_slots(None);
    assert!(
        slots[7]
            .borrow_mut()
            .install_device(Box::new(VirtioGpu::new()))
            .is_ok()
    );

    let (slot, _) = machine
        .enable_virtio_gpu(Box::new(NoopSink))
        .expect("slot 6 is free");
    assert_eq!(machine.virtio_gpu().unwrap().0, 6);
    assert!(Rc::ptr_eq(&slot, &slots[6]));
    assert_eq!(slots[7].borrow().device_id(), 16);
}

#[test]
fn gpu_cursorq_sequence_matches_wasm_through_machine_boundary() {
    let mut machine = Machine::new(RAM);
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
    write_mmio(&mut machine, 0x38, 16);
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
    assert_eq!(sink.cursor_records(), expected_callbacks);
    assert_eq!(state.borrow().cursor_state(0), Some(expected_callbacks[2]));
}
