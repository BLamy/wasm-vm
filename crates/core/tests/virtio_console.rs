//! E5-T23b integration: the real Machine wiring exposes virtio-console as DeviceID 3 and services
//! its named agent port through the six-queue MMIO layout.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::Machine;
use wasm_vm_core::RunOutcome;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::desktop_restore::{DisplaySize, ViewportDisposition};
use wasm_vm_core::desktop_snapshot::{DesktopSnapshotBuilder, FORMAT_VERSION, section};
use wasm_vm_core::dev::virtio::console::{
    AGENT_PORT_ID, AGENT_RECEIVE_QUEUE, AGENT_TRANSMIT_QUEUE, CONTROL_RECEIVE_QUEUE,
    CONTROL_TRANSMIT_QUEUE, ConsoleControl, VIRTIO_CONSOLE_DEVICE_READY,
    VIRTIO_CONSOLE_F_MULTIPORT, VIRTIO_CONSOLE_PORT_OPEN, VIRTIO_CONSOLE_PORT_READY,
    VIRTIO_CONSOLE_SLOT,
};
use wasm_vm_core::dev::virtio::gpu::{FrameSink, NullSink, Rect, VirtioGpu, protocol};
use wasm_vm_core::dev::virtio::input::{InputDeviceSpec, VirtioInput};
use wasm_vm_core::dev::virtio::snd::VirtioSnd;
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

fn ready_agent(machine: &mut Machine, slot_base: u64) {
    let control_tx_data = DATA_BASE + 0x800;
    let control_rx_buffer = DATA_BASE + 0x900;
    control(
        machine,
        control_tx_data,
        ConsoleControl::new(0, VIRTIO_CONSOLE_DEVICE_READY, 1),
    );
    descriptor(machine, CONTROL_TRANSMIT_QUEUE, 0, control_tx_data, 8, 0, 0);
    descriptor(
        machine,
        CONTROL_RECEIVE_QUEUE,
        0,
        control_rx_buffer,
        64,
        2,
        0,
    );
    post(machine, CONTROL_TRANSMIT_QUEUE, 0, 0);
    post(machine, CONTROL_RECEIVE_QUEUE, 0, 0);
    kick(machine, slot_base, CONTROL_TRANSMIT_QUEUE);
    kick(machine, slot_base, CONTROL_RECEIVE_QUEUE);
    one_boundary(machine);

    // Consume the named-port announcement after DEVICE_ADD.
    post(machine, CONTROL_RECEIVE_QUEUE, 1, 0);
    one_boundary(machine);

    control(
        machine,
        control_tx_data + 0x20,
        ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_READY, 1),
    );
    descriptor(
        machine,
        CONTROL_TRANSMIT_QUEUE,
        1,
        control_tx_data + 0x20,
        8,
        0,
        0,
    );
    post(machine, CONTROL_TRANSMIT_QUEUE, 1, 1);
    kick(machine, slot_base, CONTROL_TRANSMIT_QUEUE);
    one_boundary(machine);

    // Consume the host's PORT_OPEN notification, then acknowledge it from the guest.
    post(machine, CONTROL_RECEIVE_QUEUE, 2, 0);
    one_boundary(machine);
    control(
        machine,
        control_tx_data + 0x40,
        ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_OPEN, 1),
    );
    descriptor(
        machine,
        CONTROL_TRANSMIT_QUEUE,
        2,
        control_tx_data + 0x40,
        8,
        0,
        0,
    );
    post(machine, CONTROL_TRANSMIT_QUEUE, 2, 2);
    kick(machine, slot_base, CONTROL_TRANSMIT_QUEUE);
    one_boundary(machine);
    machine
        .confirm_virtio_console_agent_hello()
        .expect("host Channel must confirm a fresh application HELLO");
}

fn desktop_snapshot() -> Vec<u8> {
    let (_, gpu) = VirtioGpu::new_with_state();
    {
        let mut state = gpu.borrow_mut();
        state.set_display(1280, 720);
        let resource = state
            .resources
            .create(7, protocol::FORMAT_R8G8B8A8_UNORM, 4, 2)
            .unwrap();
        resource.flush_rect(
            protocol::Rect {
                x: 0,
                y: 0,
                width: 4,
                height: 2,
            },
            false,
        );
        state.scanout_resource = Some(7);
    }
    let gpu = gpu.borrow().to_snapshot().unwrap();
    let (_, input) = VirtioInput::new_with_state(InputDeviceSpec::default());
    let input = input.borrow().to_snapshot().unwrap();
    let (_, sound) = VirtioSnd::new_with_state();
    let sound = sound.borrow().to_snapshot().unwrap();
    let mut builder = DesktopSnapshotBuilder::new(0x26e0_0003);
    builder.section(section::GPU, FORMAT_VERSION, &gpu).unwrap();
    builder
        .section(section::INPUT, FORMAT_VERSION, &input)
        .unwrap();
    builder
        .section(section::SOUND, FORMAT_VERSION, &sound)
        .unwrap();
    builder
        .section(section::AGENT, FORMAT_VERSION, &17u64.to_le_bytes())
        .unwrap();
    builder.finish().unwrap()
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

#[test]
fn desktop_restore_uses_live_agent_and_retains_host_reconciliation_state() {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    machine.enable_virtio_slots(None);
    let (_console_slot, console) = machine.enable_virtio_console();
    machine.enable_virtio_keyboard();
    machine.enable_virtio_snd();
    machine
        .enable_virtio_gpu(Box::new(NullSink))
        .expect("GPU uses the remaining optional slot");

    let slot_base = Platform::virtio_base(VIRTIO_CONSOLE_SLOT as u64);
    for queue in [
        CONTROL_RECEIVE_QUEUE,
        CONTROL_TRANSMIT_QUEUE,
        AGENT_RECEIVE_QUEUE,
        AGENT_TRANSMIT_QUEUE,
    ] {
        configure_queue(&mut machine, slot_base, queue);
    }
    for offset in (0..32).step_by(4) {
        machine
            .bus_mut()
            .store32(virt::DRAM_BASE + offset, 0x0000_0013)
            .unwrap();
    }
    machine.hart_mut().regs.pc = virt::DRAM_BASE;
    ready_agent(&mut machine, slot_base);
    assert!(console.borrow().agent_ready_for_restore());

    let report = machine
        .restore_desktop_snapshot(&desktop_snapshot(), DisplaySize::new(1024, 768))
        .expect("live console and device composition should restore");
    assert_eq!(report.viewport, ViewportDisposition::Letterbox);
    assert_eq!(report.scanout, DisplaySize::new(1280, 720));
    assert_eq!(console.borrow().generation(), 1);
    assert!(console.borrow().agent_ready_for_host());
    assert!(!console.borrow().agent_ready_for_restore());
    assert_eq!(
        machine.desktop_restore_host_state(),
        wasm_vm_core::desktop_restore::DesktopRestoreHostState {
            agent_generation: 1,
            agent_ready: true,
            viewport: Some((
                DisplaySize::new(1280, 720),
                DisplaySize::new(1024, 768),
                ViewportDisposition::Letterbox,
            )),
            repair_frames: 1,
        }
    );
}

#[test]
fn resume_restores_console_transport_and_restarts_the_host_application_generation() {
    let build = || {
        let mut machine = Machine::new(RAM);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let (_slot, console) = machine.enable_virtio_console();
        let slot_base = Platform::virtio_base(VIRTIO_CONSOLE_SLOT as u64);
        for queue in [
            CONTROL_RECEIVE_QUEUE,
            CONTROL_TRANSMIT_QUEUE,
            AGENT_RECEIVE_QUEUE,
            AGENT_TRANSMIT_QUEUE,
        ] {
            configure_queue(&mut machine, slot_base, queue);
        }
        for offset in (0..32).step_by(4) {
            machine
                .bus_mut()
                .store32(virt::DRAM_BASE + offset, 0x0000_0013)
                .unwrap();
        }
        machine.hart_mut().regs.pc = virt::DRAM_BASE;
        (machine, console, slot_base)
    };

    let (mut source, source_console, source_slot) = build();
    ready_agent(&mut source, source_slot);
    let blob = source.save_resume().expect("ready console is resumable");
    assert!(source_console.borrow().agent_ready_for_restore());

    let (mut resumed, resumed_console, resumed_slot) = build();
    resumed
        .load_resume(&blob)
        .expect("console resume section restores");
    assert!(resumed_console.borrow().agent_ready_for_host());
    assert!(!resumed_console.borrow().agent_ready_for_restore());
    assert_eq!(
        resumed_console.borrow().generation(),
        source_console.borrow().generation() + 1,
        "resume advances the host transport generation"
    );
    assert_eq!(
        resumed
            .bus_mut()
            .load32(resumed_slot + 0x70)
            .expect("console status register"),
        source
            .bus_mut()
            .load32(source_slot + 0x70)
            .expect("source console status register"),
        "the guest-visible console lifecycle survives resume"
    );
    assert!(
        resumed.confirm_virtio_console_agent_hello().is_some(),
        "the new host Channel can attest a fresh application HELLO after resume"
    );
}

#[derive(Clone)]
struct CountingSink {
    frames: std::rc::Rc<std::cell::RefCell<u32>>,
    clears: std::rc::Rc<std::cell::RefCell<u32>>,
}

impl FrameSink for CountingSink {
    fn flush(
        &mut self,
        _scanout: Option<u32>,
        _format: u32,
        _rect: Rect,
        _resource_width: u32,
        _resource_height: u32,
        _pixels: &[u32],
    ) {
        *self.frames.borrow_mut() += 1;
    }

    fn clear(&mut self) {
        *self.clears.borrow_mut() += 1;
        *self.frames.borrow_mut() = 0;
    }
}

#[test]
fn missing_agent_early_refusal_clears_dirty_presentation_and_restores_cold_devices() {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    machine.enable_virtio_slots(None);
    machine.enable_virtio_keyboard();
    machine.enable_virtio_snd();
    let frames = std::rc::Rc::new(std::cell::RefCell::new(0));
    let clears = std::rc::Rc::new(std::cell::RefCell::new(0));
    let (_, gpu) = machine
        .enable_virtio_gpu(Box::new(CountingSink {
            frames: std::rc::Rc::clone(&frames),
            clears: std::rc::Rc::clone(&clears),
        }))
        .expect("GPU should occupy the free optional slot");
    gpu.borrow_mut().frame_sink.flush(
        Some(0),
        protocol::FORMAT_R8G8B8A8_UNORM,
        Rect {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        },
        1,
        1,
        &[0xff00_0000],
    );
    assert_eq!(*frames.borrow(), 1);

    let cold_gpu = VirtioGpu::new_with_state()
        .1
        .borrow()
        .to_snapshot()
        .unwrap();
    let cold_input = VirtioInput::new_with_state(InputDeviceSpec::default())
        .1
        .borrow()
        .to_snapshot()
        .unwrap();
    let cold_sound = VirtioSnd::new_with_state()
        .1
        .borrow()
        .to_snapshot()
        .unwrap();
    let error = machine
        .restore_desktop_snapshot(&desktop_snapshot(), DisplaySize::new(1024, 768))
        .expect_err("missing console must refuse before staging");
    assert_eq!(error.code(), "commit_refused");
    assert_eq!(*frames.borrow(), 0, "early refusal must remove stale frame");
    assert!(
        *clears.borrow() >= 2,
        "fallback clears before and after cold restore"
    );
    assert_eq!(gpu.borrow().to_snapshot().unwrap(), cold_gpu);
    assert_eq!(
        machine
            .keyboard_input()
            .unwrap()
            .borrow()
            .to_snapshot()
            .unwrap(),
        cold_input
    );
    assert_eq!(
        machine
            .virtio_snd()
            .unwrap()
            .1
            .borrow()
            .to_snapshot()
            .unwrap(),
        cold_sound
    );
    assert_eq!(machine.desktop_restore_host_state(), Default::default());
}
