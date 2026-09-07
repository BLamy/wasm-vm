//! E5-T26h: whole-machine desktop device state rides the CPU/RAM resume boundary.

#![cfg(not(feature = "zicsr-stub"))]

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::console::{
    AGENT_PORT_ID, CONTROL_RECEIVE_QUEUE, CONTROL_TRANSMIT_QUEUE, ConsoleControl,
    VIRTIO_CONSOLE_DEVICE_READY, VIRTIO_CONSOLE_PORT_OPEN, VIRTIO_CONSOLE_PORT_READY,
};
use wasm_vm_core::dev::virtio::gpu::FrameSink;
use wasm_vm_core::dev::virtio::gpu::protocol::{
    CMD_GET_DISPLAY_INFO, CMD_RESOURCE_FLUSH, CTRL_HDR_SIZE, CtrlHeader,
    DISPLAY_INFO_RESPONSE_SIZE, RESOURCE_FLUSH_SIZE, Rect, ResourceFlush,
};
use wasm_vm_core::dev::virtio::input::EV_KEY;
use wasm_vm_core::dev::virtio::rng::EntropySource;
use wasm_vm_core::dev::virtio::snd::{JACK_INFO_SIZE, QueryInfo, VIRTIO_SND_R_JACK_INFO};
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::resume::{SectionReader, SnapshotWriter, section};
use wasm_vm_core::trace::HashSink;
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 32 * 1024 * 1024;
const QUEUE_SIZE: u32 = 8;
const STATUS: u64 = 0x070;
const QUEUE_SEL: u64 = 0x030;
const QUEUE_NUM: u64 = 0x038;
const QUEUE_READY: u64 = 0x044;
const QUEUE_DESC_LOW: u64 = 0x080;
const QUEUE_DRIVER_LOW: u64 = 0x090;
const QUEUE_DEVICE_LOW: u64 = 0x0a0;
const QUEUE_NOTIFY: u64 = 0x050;
const DESC_WRITE: u16 = 2;
const DESC_READ: u16 = 0;
const DESC_NEXT: u16 = 1;
const DRIVER_OK: u32 = 0x0f;

#[derive(Clone)]
struct CountingSink(Rc<Cell<u32>>);

impl FrameSink for CountingSink {
    fn flush(
        &mut self,
        _scanout: Option<u32>,
        _format: u32,
        _rect: wasm_vm_core::dev::virtio::gpu::Rect,
        _resource_width: u32,
        _resource_height: u32,
        _pixels: &[u32],
    ) {
        self.0.set(self.0.get() + 1);
    }

    fn clear(&mut self) {}
}

#[derive(Default)]
struct FixedEntropy;

impl EntropySource for FixedEntropy {
    fn fill(&mut self, out: &mut [u8]) {
        out.fill(0x5a);
    }
}

fn queue_addresses(slot: usize, queue: usize) -> (u64, u64, u64, u64) {
    let base = virt::DRAM_BASE + 0x10000 + ((slot * 8 + queue) as u64) * 0x2000;
    (base, base + 0x800, base + 0xa00, base + 0xc00)
}

fn configure_queue(machine: &mut Machine, slot: usize, queue: usize) {
    let (desc, avail, used, _) = queue_addresses(slot, queue);
    let base = Platform::virtio_base(slot as u64);
    let write = |machine: &mut Machine, offset: u64, value: u32| {
        machine.bus_mut().store32(base + offset, value).unwrap();
    };
    write(machine, QUEUE_SEL, queue as u32);
    write(machine, QUEUE_NUM, QUEUE_SIZE);
    write(machine, QUEUE_DESC_LOW, desc as u32);
    write(machine, QUEUE_DESC_LOW + 4, (desc >> 32) as u32);
    write(machine, QUEUE_DRIVER_LOW, avail as u32);
    write(machine, QUEUE_DRIVER_LOW + 4, (avail >> 32) as u32);
    write(machine, QUEUE_DEVICE_LOW, used as u32);
    write(machine, QUEUE_DEVICE_LOW + 4, (used >> 32) as u32);
    write(machine, QUEUE_READY, 1);
    write(machine, STATUS, DRIVER_OK);
    machine.bus_mut().store16(avail + 2, 0).unwrap();
    machine.bus_mut().store16(used + 2, 0).unwrap();
}

fn configure_all_queues(machine: &mut Machine) {
    for (slot, queues) in [(2, 1), (3, 2), (4, 2), (5, 2), (6, 4), (7, 2), (8, 6)] {
        for queue in 0..queues {
            configure_queue(machine, slot, queue);
        }
    }
}

// Keep the four wire descriptor fields explicit at each DMA fixture callsite.
#[allow(clippy::too_many_arguments)]
fn write_descriptor(
    machine: &mut Machine,
    slot: usize,
    queue: usize,
    index: u16,
    addr: u64,
    len: u32,
    flags: u16,
    next: u16,
) {
    let (desc, _, _, _) = queue_addresses(slot, queue);
    let address = desc + 16 * u64::from(index);
    machine.bus_mut().store64(address, addr).unwrap();
    machine.bus_mut().store32(address + 8, len).unwrap();
    machine.bus_mut().store16(address + 12, flags).unwrap();
    machine.bus_mut().store16(address + 14, next).unwrap();
}

fn post_descriptor(machine: &mut Machine, slot: usize, queue: usize, ordinal: u16, head: u16) {
    let (_, avail, _, _) = queue_addresses(slot, queue);
    machine
        .bus_mut()
        .store16(avail + 4 + 2 * u64::from(ordinal % QUEUE_SIZE as u16), head)
        .unwrap();
    machine
        .bus_mut()
        .store16(avail + 2, ordinal.wrapping_add(1))
        .unwrap();
}

fn kick(machine: &mut Machine, slot: usize, queue: usize) {
    machine
        .bus_mut()
        .store32(
            Platform::virtio_base(slot as u64) + QUEUE_NOTIFY,
            queue as u32,
        )
        .unwrap();
}

fn desktop_machine(
    sentinel: u32,
    gpu_sink: Box<dyn FrameSink>,
) -> (
    Machine,
    Rc<RefCell<wasm_vm_core::dev::virtio::input::InputState>>,
) {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    machine.enable_virtio_slots(None);
    machine.enable_virtio_rng(Box::new(FixedEntropy));
    let (_, keyboard, _) = machine.enable_virtio_keyboard();
    machine.enable_virtio_pointer();
    machine.enable_virtio_snd();
    machine
        .enable_virtio_gpu(gpu_sink)
        .expect("GPU slot 7 is free");
    machine.enable_virtio_console_at(8);

    machine.hart_mut().regs.pc = virt::DRAM_BASE;
    machine
        .bus_mut()
        .store32(virt::DRAM_BASE + 0x200, sentinel)
        .expect("sentinel");
    (machine, keyboard)
}

fn source_with_workload(gpu_sink: Box<dyn FrameSink>) -> Machine {
    let (mut machine, keyboard) = desktop_machine(0x1122_3344, gpu_sink);
    configure_all_queues(&mut machine);

    let (_, gpu) = machine.virtio_gpu().expect("GPU handle");
    {
        let mut gpu_state = gpu.borrow_mut();
        let resource = gpu_state
            .resources
            .create(
                1,
                wasm_vm_core::dev::virtio::gpu::protocol::FORMAT_B8G8R8A8_UNORM,
                2,
                2,
            )
            .expect("small GPU resource");
        resource.host_pixels[0] = 0x1122_3344;
        gpu_state.scanout_resource = Some(1);
    }

    // Keyboard: consume head 0 before save; save_resume then emits a protected release frame for
    // the fresh host rather than carrying a held physical key across the boundary.
    let (_, _, _, buffer) = queue_addresses(3, 0);
    write_descriptor(&mut machine, 3, 0, 0, buffer, 8, DESC_WRITE, 0);
    post_descriptor(&mut machine, 3, 0, 0, 0);
    assert!(keyboard.borrow_mut().inject_event(EV_KEY, 30, 1));
    keyboard.borrow_mut().sync();

    // GPU controlq: complete one request so the resumed target must continue at used/avail 1.
    let (_, _, _, gpu_buffer) = queue_addresses(7, 0);
    let gpu_request = gpu_buffer + 0x100;
    let gpu_response = gpu_buffer + 0x200;
    let gpu_command = CtrlHeader {
        ty: CMD_GET_DISPLAY_INFO,
        ..CtrlHeader::default()
    }
    .to_bytes();
    for (offset, byte) in gpu_command.into_iter().enumerate() {
        machine
            .bus_mut()
            .store8(gpu_request + offset as u64, byte)
            .unwrap();
    }
    write_descriptor(
        &mut machine,
        7,
        0,
        0,
        gpu_request,
        CTRL_HDR_SIZE as u32,
        DESC_NEXT,
        1,
    );
    write_descriptor(
        &mut machine,
        7,
        0,
        1,
        gpu_response,
        DISPLAY_INFO_RESPONSE_SIZE as u32,
        DESC_WRITE,
        0,
    );
    post_descriptor(&mut machine, 7, 0, 0, 0);

    // Sound controlq: complete one independent control request before save.
    let (_, _, _, snd_buffer) = queue_addresses(6, 0);
    let snd_request = snd_buffer + 0x100;
    let snd_response = snd_buffer + 0x200;
    let query = QueryInfo {
        code: VIRTIO_SND_R_JACK_INFO,
        start_id: 0,
        count: 1,
        size: JACK_INFO_SIZE as u32,
    }
    .to_bytes();
    for (offset, byte) in query.into_iter().enumerate() {
        machine
            .bus_mut()
            .store8(snd_request + offset as u64, byte)
            .unwrap();
    }
    write_descriptor(&mut machine, 6, 0, 0, snd_request, 16, DESC_NEXT, 1);
    write_descriptor(
        &mut machine,
        6,
        0,
        1,
        snd_response,
        (4 + JACK_INFO_SIZE) as u32,
        DESC_WRITE,
        0,
    );
    post_descriptor(&mut machine, 6, 0, 0, 0);

    // Start the real named-port protocol. Complete it below before recording the snapshot;
    // application data is deliberately not part of the resumable host session.
    let (_, _, _, console_rx_buffer) = queue_addresses(8, CONTROL_RECEIVE_QUEUE as usize);
    let (_, _, _, console_tx_buffer) = queue_addresses(8, CONTROL_TRANSMIT_QUEUE as usize);
    let console_data = console_tx_buffer + 0x100;
    let control = ConsoleControl::new(0, VIRTIO_CONSOLE_DEVICE_READY, 1).to_bytes();
    for (offset, byte) in control.into_iter().enumerate() {
        machine
            .bus_mut()
            .store8(console_data + offset as u64, byte)
            .unwrap();
    }
    write_descriptor(
        &mut machine,
        8,
        CONTROL_TRANSMIT_QUEUE as usize,
        0,
        console_data,
        8,
        DESC_READ,
        0,
    );
    write_descriptor(
        &mut machine,
        8,
        CONTROL_RECEIVE_QUEUE as usize,
        0,
        console_rx_buffer + 0x100,
        64,
        DESC_WRITE,
        0,
    );
    post_descriptor(&mut machine, 8, CONTROL_TRANSMIT_QUEUE as usize, 0, 0);
    post_descriptor(&mut machine, 8, CONTROL_RECEIVE_QUEUE as usize, 0, 0);

    for offset in (0..32).step_by(4) {
        machine
            .bus_mut()
            .store32(virt::DRAM_BASE + offset, 0x0000_0013)
            .expect("NOP");
    }
    kick(&mut machine, 3, 0);
    kick(&mut machine, 7, 0);
    kick(&mut machine, 6, 0);
    kick(&mut machine, 8, CONTROL_TRANSMIT_QUEUE as usize);
    assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
    assert!(machine.virtio_console().unwrap().borrow().agent_announced());

    for (slot, queue) in [(3, 0), (7, 0), (6, 0), (8, CONTROL_TRANSMIT_QUEUE as usize)] {
        let (_, _, used, _) = queue_addresses(slot, queue);
        assert_eq!(
            machine.bus_mut().load16(used + 2),
            Ok(1),
            "slot {slot} queue {queue}"
        );
    }
    let (_, _, console_used, _) = queue_addresses(8, CONTROL_RECEIVE_QUEUE as usize);
    assert_eq!(machine.bus_mut().load16(console_used + 2), Ok(1));
    for (ordinal, event) in [
        (1, VIRTIO_CONSOLE_PORT_READY),
        (2, VIRTIO_CONSOLE_PORT_OPEN),
    ] {
        // Consume PORT_NAME, then the host PORT_OPEN notification, through the live receive ring.
        post_descriptor(&mut machine, 8, CONTROL_RECEIVE_QUEUE as usize, ordinal, 0);
        kick(&mut machine, 8, CONTROL_RECEIVE_QUEUE as usize);
        assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
        let address = console_data + u64::from(ordinal) * 0x20;
        for (offset, byte) in ConsoleControl::new(AGENT_PORT_ID, event, 1)
            .to_bytes()
            .into_iter()
            .enumerate()
        {
            machine
                .bus_mut()
                .store8(address + offset as u64, byte)
                .unwrap();
        }
        write_descriptor(
            &mut machine,
            8,
            CONTROL_TRANSMIT_QUEUE as usize,
            ordinal,
            address,
            8,
            DESC_READ,
            0,
        );
        post_descriptor(
            &mut machine,
            8,
            CONTROL_TRANSMIT_QUEUE as usize,
            ordinal,
            ordinal,
        );
        kick(&mut machine, 8, CONTROL_TRANSMIT_QUEUE as usize);
        assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
    }
    assert_eq!(machine.bus_mut().load16(console_used + 2), Ok(3));
    machine
        .confirm_virtio_console_agent_hello()
        .expect("source HELLO");
    assert!(
        machine
            .virtio_console()
            .unwrap()
            .borrow()
            .agent_ready_for_restore()
    );
    machine
}

fn corrupt_section(blob: &[u8], wanted: u32) -> Vec<u8> {
    let mut out = blob.to_vec();
    let mut pos = 84usize;
    while pos < out.len() {
        let tag = u32::from_le_bytes(out[pos..pos + 4].try_into().unwrap());
        let len = u32::from_le_bytes(out[pos + 4..pos + 8].try_into().unwrap()) as usize;
        if tag == wanted {
            // The first GPU codec byte follows the 277-byte MMIO transport and the two
            // five-byte ring shadows. Corrupting that magic exercises codec refusal rather
            // than merely changing a valid transport status byte.
            const TRANSPORT_BYTES: usize = 277;
            const RING_SHADOW_BYTES: usize = 10;
            out[pos + 8 + TRANSPORT_BYTES + RING_SHADOW_BYTES] ^= 0xff;
            return out;
        }
        pos += 8 + len;
    }
    panic!("missing section {wanted}");
}

#[test]
fn desktop_devices_resume_with_ring_continuity_and_fresh_host_state() {
    let source_sink_count = Rc::new(Cell::new(0));
    let target_sink_count = Rc::new(Cell::new(0));
    let mut source = source_with_workload(Box::new(CountingSink(Rc::clone(&source_sink_count))));
    let blob = source.save_resume().expect("desktop resume save");

    let (mut target, _) = desktop_machine(
        0xaabb_ccdd,
        Box::new(CountingSink(Rc::clone(&target_sink_count))),
    );
    assert_eq!(
        target.bus_mut().load32(virt::DRAM_BASE + 0x200),
        Ok(0xaabb_ccdd)
    );
    target.load_resume(&blob).expect("desktop resume load");
    assert_eq!(
        target_sink_count.get(),
        1,
        "restore publishes its full repair frame to the fresh sink"
    );
    assert_eq!(
        target.bus_mut().load32(virt::DRAM_BASE + 0x200),
        Ok(0x1122_3344)
    );

    let (_, gpu) = target.virtio_gpu().expect("restored GPU");
    assert_eq!(gpu.borrow().scanout_resource, Some(1));
    assert_eq!(
        gpu.borrow().resources.get(1).unwrap().host_pixels[0],
        0x1122_3344
    );
    assert_eq!(
        target.bus_mut().load32(Platform::virtio_base(7) + STATUS),
        Ok(DRIVER_OK)
    );

    // Keyboard/GPU/sound resume from index 1; the fully opened console resumes from index 3.
    // New heads after those boundaries prove the target did not restart its transport cursors.
    let (_, _, used, buffer) = queue_addresses(3, 0);
    write_descriptor(&mut target, 3, 0, 1, buffer + 8, 8, DESC_WRITE, 0);
    post_descriptor(&mut target, 3, 0, 1, 1);
    kick(&mut target, 3, 0);

    let (_, _, gpu_used, gpu_buffer) = queue_addresses(7, 0);
    let flush = ResourceFlush {
        header: CtrlHeader {
            ty: CMD_RESOURCE_FLUSH,
            ..CtrlHeader::default()
        },
        rect: Rect {
            x: 0,
            y: 0,
            width: 2,
            height: 2,
        },
        resource_id: 1,
        padding: 0,
    }
    .to_bytes();
    for (offset, byte) in flush.into_iter().enumerate() {
        target
            .bus_mut()
            .store8(gpu_buffer + 0x300 + offset as u64, byte)
            .unwrap();
    }
    write_descriptor(
        &mut target,
        7,
        0,
        2,
        gpu_buffer + 0x300,
        RESOURCE_FLUSH_SIZE as u32,
        DESC_NEXT,
        3,
    );
    write_descriptor(
        &mut target,
        7,
        0,
        3,
        gpu_buffer + 0x380,
        CTRL_HDR_SIZE as u32,
        DESC_WRITE,
        0,
    );
    post_descriptor(&mut target, 7, 0, 1, 2);
    kick(&mut target, 7, 0);

    let (_, _, snd_used, snd_buffer) = queue_addresses(6, 0);
    for (offset, byte) in (QueryInfo {
        code: VIRTIO_SND_R_JACK_INFO,
        start_id: 0,
        count: 1,
        size: JACK_INFO_SIZE as u32,
    })
    .to_bytes()
    .into_iter()
    .enumerate()
    {
        target
            .bus_mut()
            .store8(snd_buffer + 0x300 + offset as u64, byte)
            .unwrap();
    }
    write_descriptor(&mut target, 6, 0, 2, snd_buffer + 0x300, 16, DESC_NEXT, 3);
    write_descriptor(
        &mut target,
        6,
        0,
        3,
        snd_buffer + 0x400,
        (4 + JACK_INFO_SIZE) as u32,
        DESC_WRITE,
        0,
    );
    post_descriptor(&mut target, 6, 0, 1, 2);
    kick(&mut target, 6, 0);

    let (_, _, console_used, console_buffer) = queue_addresses(8, CONTROL_RECEIVE_QUEUE as usize);
    write_descriptor(
        &mut target,
        8,
        CONTROL_RECEIVE_QUEUE as usize,
        1,
        console_buffer + 0x200,
        64,
        DESC_WRITE,
        0,
    );
    post_descriptor(&mut target, 8, CONTROL_RECEIVE_QUEUE as usize, 3, 1);
    kick(&mut target, 8, CONTROL_RECEIVE_QUEUE as usize);

    let mut continuation = HashSink::new();
    assert_eq!(
        target.run_traced(1, &mut continuation),
        RunOutcome::MaxInstrs
    );
    assert_eq!(continuation.retired(), 1);
    println!(
        "desktop resume continuation: hash={:016x}, retired={}",
        continuation.hash(),
        continuation.retired()
    );
    assert_eq!(target.bus_mut().load16(used + 2), Ok(2));
    assert_eq!(target.bus_mut().load16(gpu_used + 2), Ok(2));
    assert_eq!(target.bus_mut().load16(snd_used + 2), Ok(2));
    assert_eq!(target.bus_mut().load16(console_used + 2), Ok(4));
    assert_eq!(
        target.bus_mut().load16(console_buffer + 0x204),
        Ok(VIRTIO_CONSOLE_PORT_OPEN)
    );
    assert_eq!(target.bus_mut().load16(console_buffer + 0x206), Ok(0));
    assert_eq!(
        target_sink_count.get(),
        2,
        "new guest flush follows the repair frame on the fresh sink handle"
    );
    assert_eq!(
        source_sink_count.get(),
        0,
        "source sink was not reused by restore"
    );

    // A new application HELLO generation is still required; a fresh machine does not inherit a
    // stale host-session acknowledgement from the saved console lifecycle.
    assert!(
        !target
            .virtio_console()
            .unwrap()
            .borrow()
            .agent_ready_for_restore(),
        "source HELLO must not attest the fresh host"
    );
    target
        .confirm_virtio_console_agent_hello()
        .expect("fresh host HELLO");
    assert!(
        target
            .virtio_console()
            .unwrap()
            .borrow()
            .agent_ready_for_restore()
    );
    drop(source);
}

#[test]
fn malformed_desktop_section_and_missing_device_refuse_without_partial_restore() {
    let mut source = source_with_workload(Box::new(CountingSink(Rc::new(Cell::new(0)))));
    let blob = source.save_resume().expect("desktop resume save");

    let (mut target, _) =
        desktop_machine(0xaabb_ccdd, Box::new(CountingSink(Rc::new(Cell::new(0)))));
    let baseline = target.save_resume().expect("baseline target save");
    let malformed = corrupt_section(&blob, section::VIRTIO_GPU);
    assert!(matches!(
        target.load_resume(&malformed),
        Err(wasm_vm_core::resume::SnapshotError::BadComponentState {
            tag: section::VIRTIO_GPU
        })
    ));
    assert_eq!(target.save_resume().unwrap(), baseline);

    let (header, reader) = SectionReader::new(&blob).unwrap();
    let mut writer = SnapshotWriter::new(
        &header.core_hash,
        &header.base_image_hash,
        header.overlay_generation,
    );
    for item in reader {
        let item = item.unwrap();
        if item.tag != section::VIRTIO_GPU {
            writer.section(item.tag, item.payload);
        }
    }
    let missing = writer.finish();
    assert!(matches!(
        target.load_resume(&missing),
        Err(wasm_vm_core::resume::SnapshotError::BadComponentState {
            tag: section::VIRTIO_GPU
        })
    ));
    assert_eq!(target.save_resume().unwrap(), baseline);
}

#[test]
fn headless_resume_remains_compatible_without_desktop_sections() {
    let mut source = Machine::new(2 * 1024 * 1024);
    source.hart_mut().regs.pc = virt::DRAM_BASE;
    source
        .bus_mut()
        .store32(virt::DRAM_BASE, 0x0000_0013)
        .unwrap();
    let blob = source.save_resume().unwrap();
    let mut target = Machine::new(2 * 1024 * 1024);
    target.load_resume(&blob).unwrap();
}
