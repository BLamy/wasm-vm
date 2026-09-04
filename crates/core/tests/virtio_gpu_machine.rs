//! E5-T06d: verify that Machine owns and services the browser-facing virtio-gpu queue.

#![cfg(not(feature = "zicsr-stub"))]

use std::rc::Rc;

use wasm_vm_core::Machine;
use wasm_vm_core::RunOutcome;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::gpu::protocol::{
    CMD_GET_DISPLAY_INFO, CTRL_HDR_SIZE, CtrlHeader, DISPLAY_INFO_RESPONSE_SIZE,
    RESP_OK_DISPLAY_INFO,
};
use wasm_vm_core::dev::virtio::gpu::{FrameSink, NullSink, VirtioGpu};
use wasm_vm_core::platform::{Platform, virt};

const RAM: usize = 8 * 1024 * 1024;
const QUEUE_SIZE: u32 = 8;
const DESC: u64 = virt::DRAM_BASE + 0x10_0000;
const AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
const USED: u64 = virt::DRAM_BASE + 0x12_0000;
const REQUEST: u64 = virt::DRAM_BASE + 0x13_0000;
const RESPONSE: u64 = virt::DRAM_BASE + 0x14_0000;

struct NoopSink;

impl FrameSink for NoopSink {
    fn flush(
        &mut self,
        _scanout: Option<u32>,
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
