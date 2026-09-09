//! E5-T23b integration: the real Machine wiring exposes virtio-console as DeviceID 3 and services
//! its named agent port through the six-queue MMIO layout.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::Machine;
use wasm_vm_core::RunOutcome;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::console::{
    AGENT_PORT_ID, AGENT_RECEIVE_QUEUE, AGENT_TRANSMIT_QUEUE, CONTROL_RECEIVE_QUEUE,
    CONTROL_TRANSMIT_QUEUE, ConsoleControl, VIRTIO_CONSOLE_DEVICE_READY,
    VIRTIO_CONSOLE_F_MULTIPORT, VIRTIO_CONSOLE_PORT_OPEN, VIRTIO_CONSOLE_PORT_READY,
    VIRTIO_CONSOLE_SLOT,
};
use wasm_vm_core::platform::{Platform, virt};

const RAM: usize = 8 * 1024 * 1024;
const QUEUE_SIZE: u16 = 8;
const DESC_BASE: u64 = virt::DRAM_BASE + 0x10_000;
const AVAIL_BASE: u64 = virt::DRAM_BASE + 0x20_000;
const USED_BASE: u64 = virt::DRAM_BASE + 0x30_000;
const DATA_BASE: u64 = virt::DRAM_BASE + 0x40_000;

fn queue_addr(base: u64, queue: u32) -> u64 {
    base + u64::from(queue) * 0x1000
}

fn mmio_write(machine: &mut Machine, slot_base: u64, offset: u64, value: u32) {
    machine
        .bus_mut()
        .store32(slot_base + offset, value)
        .unwrap();
}

fn configure_queue(machine: &mut Machine, slot_base: u64, queue: u32) {
    let desc = queue_addr(DESC_BASE, queue);
    let avail = queue_addr(AVAIL_BASE, queue);
    let used = queue_addr(USED_BASE, queue);
    machine.bus_mut().store16(avail, 0).unwrap();
    machine.bus_mut().store16(avail + 2, 0).unwrap();
    machine.bus_mut().store16(used + 2, 0).unwrap();
    mmio_write(machine, slot_base, 0x30, queue);
    mmio_write(machine, slot_base, 0x38, u32::from(QUEUE_SIZE));
    mmio_write(machine, slot_base, 0x80, desc as u32);
    mmio_write(machine, slot_base, 0x84, (desc >> 32) as u32);
    mmio_write(machine, slot_base, 0x90, avail as u32);
    mmio_write(machine, slot_base, 0x94, (avail >> 32) as u32);
    mmio_write(machine, slot_base, 0xa0, used as u32);
    mmio_write(machine, slot_base, 0xa4, (used >> 32) as u32);
    mmio_write(machine, slot_base, 0x44, 1);
}

fn descriptor(
    machine: &mut Machine,
    queue: u32,
    index: u16,
    addr: u64,
    len: u32,
    flags: u16,
    next: u16,
) {
    let base = queue_addr(DESC_BASE, queue) + 16 * u64::from(index);
    machine.bus_mut().store64(base, addr).unwrap();
    machine.bus_mut().store32(base + 8, len).unwrap();
    machine.bus_mut().store16(base + 12, flags).unwrap();
    machine.bus_mut().store16(base + 14, next).unwrap();
}

fn post(machine: &mut Machine, queue: u32, ordinal: u16, head: u16) {
    let avail = queue_addr(AVAIL_BASE, queue);
    machine
        .bus_mut()
        .store16(avail + 4 + 2 * u64::from(ordinal % QUEUE_SIZE), head)
        .unwrap();
    machine
        .bus_mut()
        .store16(avail + 2, ordinal.wrapping_add(1))
        .unwrap();
}

fn control(machine: &mut Machine, addr: u64, value: ConsoleControl) {
    for (offset, byte) in value.to_bytes().iter().copied().enumerate() {
        machine
            .bus_mut()
            .store8(addr + offset as u64, byte)
            .unwrap();
    }
}

fn kick(machine: &mut Machine, slot_base: u64, queue: u32) {
    mmio_write(machine, slot_base, 0x50, queue);
}

fn one_boundary(machine: &mut Machine) {
    assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
}

#[test]
fn virtio_console_machine_registers_and_services_named_agent_port_without_uart_aliasing() {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    machine.enable_virtio_slots(None);
    let uart = machine.enable_uart16550();
    let (slot, state) = machine.enable_virtio_console();
    let slot_base = Platform::virtio_base(VIRTIO_CONSOLE_SLOT as u64);

    assert_eq!(slot.borrow().device_id(), 3);
    assert_eq!(machine.bus_mut().load32(slot_base + 0x08).unwrap(), 3);
    machine.bus_mut().store32(slot_base + 0x14, 0).unwrap();
    assert_eq!(
        machine.bus_mut().load32(slot_base + 0x10).unwrap() as u64 & VIRTIO_CONSOLE_F_MULTIPORT,
        VIRTIO_CONSOLE_F_MULTIPORT
    );

    for queue in [
        CONTROL_RECEIVE_QUEUE,
        CONTROL_TRANSMIT_QUEUE,
        AGENT_RECEIVE_QUEUE,
        AGENT_TRANSMIT_QUEUE,
    ] {
        configure_queue(&mut machine, slot_base, queue);
    }

    // Keep the run loop alive at a row of NOPs while the host services DMA at each boundary.
    for offset in (0..32).step_by(4) {
        machine
            .bus_mut()
            .store32(virt::DRAM_BASE + offset, 0x0000_0013)
            .unwrap();
    }
    machine.hart_mut().regs.pc = virt::DRAM_BASE;

    // Guest says it can receive control packets.  The device responds with DEVICE_ADD and NAME.
    let control_tx_data = DATA_BASE;
    control(
        &mut machine,
        control_tx_data,
        ConsoleControl::new(0, VIRTIO_CONSOLE_DEVICE_READY, 1),
    );
    descriptor(
        &mut machine,
        CONTROL_TRANSMIT_QUEUE,
        0,
        control_tx_data,
        8,
        0,
        0,
    );
    post(&mut machine, CONTROL_TRANSMIT_QUEUE, 0, 0);
    let control_rx_buffer = DATA_BASE + 0x100;
    descriptor(
        &mut machine,
        CONTROL_RECEIVE_QUEUE,
        0,
        control_rx_buffer,
        64,
        2,
        0,
    );
    post(&mut machine, CONTROL_RECEIVE_QUEUE, 0, 0);
    kick(&mut machine, slot_base, CONTROL_TRANSMIT_QUEUE);
    kick(&mut machine, slot_base, CONTROL_RECEIVE_QUEUE);
    one_boundary(&mut machine);
    assert!(state.borrow().agent_announced());
    assert_eq!(
        machine
            .bus_mut()
            .load16(queue_addr(USED_BASE, CONTROL_RECEIVE_QUEUE) + 2)
            .unwrap(),
        1
    );

    // The second control packet is the named port.  A single posted buffer may be reused after the
    // prior used entry; the next used slot contains the full header+name payload.
    post(&mut machine, CONTROL_RECEIVE_QUEUE, 1, 0);
    one_boundary(&mut machine);
    assert_eq!(
        machine
            .bus_mut()
            .load16(queue_addr(USED_BASE, CONTROL_RECEIVE_QUEUE) + 2)
            .unwrap(),
        2
    );
    let mut named = vec![0u8; 8 + "org.wasmvm.agent".len()];
    for (offset, byte) in named.iter_mut().enumerate() {
        *byte = machine
            .bus_mut()
            .load8(control_rx_buffer + offset as u64)
            .unwrap();
    }
    assert_eq!(&named[8..], b"org.wasmvm.agent");

    // PORT_READY makes the host's open notification pending, then the guest acknowledges it with
    // PORT_OPEN.  The port becomes live only after both sides have opened it.
    control(
        &mut machine,
        control_tx_data + 0x20,
        ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_READY, 1),
    );
    descriptor(
        &mut machine,
        CONTROL_TRANSMIT_QUEUE,
        1,
        control_tx_data + 0x20,
        8,
        0,
        0,
    );
    post(&mut machine, CONTROL_TRANSMIT_QUEUE, 1, 1);
    kick(&mut machine, slot_base, CONTROL_TRANSMIT_QUEUE);
    one_boundary(&mut machine);

    post(&mut machine, CONTROL_RECEIVE_QUEUE, 2, 0);
    one_boundary(&mut machine);
    control(
        &mut machine,
        control_tx_data + 0x40,
        ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_OPEN, 1),
    );
    descriptor(
        &mut machine,
        CONTROL_TRANSMIT_QUEUE,
        2,
        control_tx_data + 0x40,
        8,
        0,
        0,
    );
    post(&mut machine, CONTROL_TRANSMIT_QUEUE, 2, 2);
    kick(&mut machine, slot_base, CONTROL_TRANSMIT_QUEUE);
    one_boundary(&mut machine);
    assert!(state.borrow().agent_open());

    let inbound = b"guest-agent-input";
    state.borrow_mut().enqueue_agent_input(inbound);
    let agent_rx_buffer = DATA_BASE + 0x300;
    descriptor(
        &mut machine,
        AGENT_RECEIVE_QUEUE,
        0,
        agent_rx_buffer,
        64,
        2,
        0,
    );
    post(&mut machine, AGENT_RECEIVE_QUEUE, 0, 0);
    one_boundary(&mut machine);
    let received = (0..inbound.len())
        .map(|offset| {
            machine
                .bus_mut()
                .load8(agent_rx_buffer + offset as u64)
                .unwrap()
        })
        .collect::<Vec<_>>();
    assert_eq!(received, inbound);
    assert_eq!(state.borrow().agent_input_bytes(), 0);

    // Fill the bounded agent transmit buffer, then leave another agent descriptor posted.  A UART
    // byte written while that queue is full must still reach the established T08 serial device.
    state.borrow_mut().set_data_budget(8);
    let agent_output = DATA_BASE + 0x500;
    for offset in 0..8u64 {
        machine
            .bus_mut()
            .store8(agent_output + offset, 0xA0 + offset as u8)
            .unwrap();
    }
    descriptor(&mut machine, AGENT_TRANSMIT_QUEUE, 0, agent_output, 8, 0, 0);
    post(&mut machine, AGENT_TRANSMIT_QUEUE, 0, 0);
    kick(&mut machine, slot_base, AGENT_TRANSMIT_QUEUE);
    one_boundary(&mut machine);
    assert_eq!(state.borrow().agent_output_bytes(), 8);

    descriptor(&mut machine, AGENT_TRANSMIT_QUEUE, 1, agent_output, 8, 0, 0);
    post(&mut machine, AGENT_TRANSMIT_QUEUE, 1, 1);
    kick(&mut machine, slot_base, AGENT_TRANSMIT_QUEUE);
    machine.bus_mut().store8(virt::UART0_BASE, b'S').unwrap();
    one_boundary(&mut machine);
    assert_eq!(
        machine
            .bus_mut()
            .load16(queue_addr(USED_BASE, AGENT_TRANSMIT_QUEUE) + 2)
            .unwrap(),
        1,
        "full agent output leaves its descriptor posted"
    );
    assert_eq!(uart.borrow_mut().take_output(), b"S");
}
