//! Fresh critic attacks for E5-T26h's whole-machine desktop composition boundary.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::console::{
    AGENT_PORT_ID, AGENT_TRANSMIT_QUEUE, CONTROL_TRANSMIT_QUEUE, ConsoleControl,
    VIRTIO_CONSOLE_DEVICE_READY, VIRTIO_CONSOLE_PORT_OPEN, VIRTIO_CONSOLE_PORT_READY,
};
use wasm_vm_core::dev::virtio::gpu::NullSink;
use wasm_vm_core::dev::virtio::gpu::protocol::FORMAT_B8G8R8A8_UNORM;
use wasm_vm_core::dev::virtio::input::EV_KEY;
use wasm_vm_core::dev::virtio::rng::EntropySource;
use wasm_vm_core::dev::virtio::snd::{JACK_INFO_SIZE, QueryInfo, VIRTIO_SND_R_JACK_INFO};
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::resume::{SectionReader, SnapshotError, SnapshotWriter, section};
use wasm_vm_core::{Machine, RunOutcome};

const TRANSPORT_BYTES: usize = 277;
const QUEUE_SIZE: u32 = 8;
const STATUS: u64 = 0x070;
const QUEUE_SEL: u64 = 0x030;
const QUEUE_NUM: u64 = 0x038;
const QUEUE_READY: u64 = 0x044;
const QUEUE_NOTIFY: u64 = 0x050;
const QUEUE_DESC_LOW: u64 = 0x080;
const QUEUE_DRIVER_LOW: u64 = 0x090;
const QUEUE_DEVICE_LOW: u64 = 0x0a0;
const DESC_WRITE: u16 = 2;
const DESC_NEXT: u16 = 1;
const DRIVER_OK: u32 = 0x0f;

#[derive(Default)]
struct FixedEntropy;

impl EntropySource for FixedEntropy {
    fn fill(&mut self, out: &mut [u8]) {
        out.fill(0xa5);
    }
}

fn queue_addresses(slot: usize, queue: usize) -> (u64, u64, u64, u64) {
    let base = virt::DRAM_BASE + 0x10000 + ((slot * 8 + queue) as u64) * 0x2000;
    (base, base + 0x800, base + 0xa00, base + 0xc00)
}

fn configure_queue(machine: &mut Machine, slot: usize, queue: usize) {
    let (desc, avail, used, _) = queue_addresses(slot, queue);
    let base = Platform::virtio_base(slot as u64);
    for (offset, value) in [
        (QUEUE_SEL, queue as u32),
        (QUEUE_NUM, QUEUE_SIZE),
        (QUEUE_DESC_LOW, desc as u32),
        (QUEUE_DESC_LOW + 4, (desc >> 32) as u32),
        (QUEUE_DRIVER_LOW, avail as u32),
        (QUEUE_DRIVER_LOW + 4, (avail >> 32) as u32),
        (QUEUE_DEVICE_LOW, used as u32),
        (QUEUE_DEVICE_LOW + 4, (used >> 32) as u32),
        (QUEUE_READY, 1),
        (STATUS, DRIVER_OK),
    ] {
        machine.bus_mut().store32(base + offset, value).unwrap();
    }
    machine.bus_mut().store16(avail + 2, 0).unwrap();
    machine.bus_mut().store16(used + 2, 0).unwrap();
}

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

fn install_nop(machine: &mut Machine) {
    machine
        .bus_mut()
        .store32(virt::DRAM_BASE, 0x0000_0013)
        .unwrap();
    machine.hart_mut().regs.pc = virt::DRAM_BASE;
}

fn full_machine(alternate_order: bool, sentinel: u32) -> Machine {
    let mut machine = Machine::new(16 * 1024 * 1024);
    machine.enable_plic();
    machine.enable_virtio_slots(None);
    if alternate_order {
        machine.enable_virtio_console_at(8);
        machine.enable_virtio_gpu(Box::new(NullSink)).unwrap();
        machine.enable_virtio_snd();
        machine.enable_virtio_pointer();
        machine.enable_virtio_keyboard();
        machine.enable_virtio_rng(Box::new(FixedEntropy));
    } else {
        machine.enable_virtio_rng(Box::new(FixedEntropy));
        machine.enable_virtio_keyboard();
        machine.enable_virtio_pointer();
        machine.enable_virtio_snd();
        machine.enable_virtio_gpu(Box::new(NullSink)).unwrap();
        machine.enable_virtio_console_at(8);
    }
    machine
        .bus_mut()
        .store32(virt::DRAM_BASE, sentinel)
        .unwrap();
    machine.hart_mut().regs.pc = virt::DRAM_BASE;
    machine
}

fn headless_machine(sentinel: u32) -> Machine {
    let mut machine = Machine::new(16 * 1024 * 1024);
    machine
        .bus_mut()
        .store32(virt::DRAM_BASE, sentinel)
        .unwrap();
    machine.hart_mut().regs.pc = virt::DRAM_BASE;
    machine
}

fn rewrite_blob<F>(blob: &[u8], mut rewrite: F) -> Vec<u8>
where
    F: FnMut(u32, &[u8], &mut SnapshotWriter),
{
    let (header, reader) = SectionReader::new(blob).unwrap();
    let mut writer = SnapshotWriter::new(
        &header.core_hash,
        &header.base_image_hash,
        header.overlay_generation,
    );
    for item in reader {
        let item = item.unwrap();
        rewrite(item.tag, item.payload, &mut writer);
    }
    writer.finish()
}

fn component_offset(tag: u32) -> usize {
    let queues = match tag {
        section::VIRTIO_RNG => 1,
        section::VIRTIO_GPU
        | section::VIRTIO_KEYBOARD
        | section::VIRTIO_TABLET
        | section::VIRTIO_MOUSE => 2,
        section::VIRTIO_SND => 4,
        section::VIRTIO_CONSOLE => 6,
        _ => panic!("not a desktop section: {tag}"),
    };
    TRANSPORT_BYTES + queues * 5
}

fn corrupt_component(blob: &[u8], wanted: u32) -> Vec<u8> {
    rewrite_blob(blob, |tag, payload, writer| {
        if tag == wanted {
            let mut malformed = payload.to_vec();
            let offset = component_offset(tag);
            if matches!(tag, section::VIRTIO_CONSOLE | section::VIRTIO_RNG) {
                malformed[offset] = 2;
            } else {
                malformed[offset] ^= 0xff;
            }
            writer.section(tag, &malformed);
        } else {
            writer.section(tag, payload);
        }
    })
}

fn corrupt_first_ring_shadow(blob: &[u8], wanted: u32) -> Vec<u8> {
    rewrite_blob(blob, |tag, payload, writer| {
        if tag == wanted {
            let mut malformed = payload.to_vec();
            assert_eq!(malformed[TRANSPORT_BYTES], 0);
            malformed[TRANSPORT_BYTES + 1] = 1;
            writer.section(tag, &malformed);
        } else {
            writer.section(tag, payload);
        }
    })
}

fn without_section(blob: &[u8], wanted: u32) -> Vec<u8> {
    rewrite_blob(blob, |tag, payload, writer| {
        if tag != wanted {
            writer.section(tag, payload);
        }
    })
}

fn duplicate_section(blob: &[u8], wanted: u32) -> Vec<u8> {
    rewrite_blob(blob, |tag, payload, writer| {
        writer.section(tag, payload);
        if tag == wanted {
            writer.section(tag, payload);
        }
    })
}

fn malformed_cpu(blob: &[u8]) -> Vec<u8> {
    rewrite_blob(blob, |tag, payload, writer| {
        if tag == section::CPU {
            writer.section(tag, &[0]);
        } else {
            writer.section(tag, payload);
        }
    })
}

#[test]
fn every_new_section_corruption_missing_and_duplicate_are_atomic() {
    let mut source = full_machine(false, 0x1111_2222);
    let blob = source.save_resume().unwrap();
    let tags = [
        section::VIRTIO_GPU,
        section::VIRTIO_KEYBOARD,
        section::VIRTIO_TABLET,
        section::VIRTIO_MOUSE,
        section::VIRTIO_SND,
        section::VIRTIO_CONSOLE,
        section::VIRTIO_RNG,
    ];

    for tag in tags {
        for attacked in [
            corrupt_component(&blob, tag),
            corrupt_first_ring_shadow(&blob, tag),
            without_section(&blob, tag),
            duplicate_section(&blob, tag),
        ] {
            let mut target = full_machine(true, 0xaabb_ccdd);
            let baseline = target.save_resume().unwrap();
            assert_eq!(
                target.load_resume(&attacked),
                Err(SnapshotError::BadComponentState { tag }),
                "typed refusal for section {tag}"
            );
            assert_eq!(
                target.save_resume().unwrap(),
                baseline,
                "section {tag} rejection mutated the target"
            );
        }
    }
}

#[test]
fn source_target_topology_mismatch_is_atomic_both_directions() {
    let mut full_source = full_machine(false, 0x1111_2222);
    let full_blob = full_source.save_resume().unwrap();
    let mut headless_target = headless_machine(0xaabb_ccdd);
    let headless_baseline = headless_target.save_resume().unwrap();
    assert_eq!(
        headless_target.load_resume(&full_blob),
        Err(SnapshotError::BadComponentState {
            tag: section::VIRTIO_GPU
        })
    );
    assert_eq!(headless_target.save_resume().unwrap(), headless_baseline);

    let mut headless_source = headless_machine(0x3333_4444);
    let headless_blob = headless_source.save_resume().unwrap();
    let mut full_target = full_machine(true, 0xcccc_dddd);
    let full_baseline = full_target.save_resume().unwrap();
    assert_eq!(
        full_target.load_resume(&headless_blob),
        Err(SnapshotError::BadComponentState {
            tag: section::VIRTIO_GPU
        })
    );
    assert_eq!(full_target.save_resume().unwrap(), full_baseline);
}

#[test]
fn same_topology_in_alternate_assembly_order_restores() {
    let mut source = full_machine(false, 0x1234_5678);
    let blob = source.save_resume().unwrap();
    let mut target = full_machine(true, 0x8765_4321);
    target.load_resume(&blob).unwrap();
    assert_eq!(target.bus_mut().load32(virt::DRAM_BASE), Ok(0x1234_5678));
}

#[test]
fn malformed_later_machine_payload_must_not_partially_commit_desktop_state() {
    let mut source = full_machine(false, 0x1111_2222);
    let (_, gpu) = source.virtio_gpu().unwrap();
    {
        let mut state = gpu.borrow_mut();
        state
            .resources
            .create(77, FORMAT_B8G8R8A8_UNORM, 2, 2)
            .unwrap();
        state.scanout_resource = Some(77);
    }
    let malformed = malformed_cpu(&source.save_resume().unwrap());

    let mut target = full_machine(true, 0xaabb_ccdd);
    assert!(
        target
            .virtio_gpu()
            .unwrap()
            .1
            .borrow()
            .resources
            .get(77)
            .is_none()
    );
    assert_eq!(
        target.load_resume(&malformed),
        Err(SnapshotError::BadComponentState { tag: section::CPU })
    );
    assert!(
        target
            .virtio_gpu()
            .unwrap()
            .1
            .borrow()
            .resources
            .get(77)
            .is_none(),
        "a later CPU refusal left source GPU resource 77 installed"
    );
}

#[test]
fn rng_cursor_wrap_preserves_one_pending_completion_exactly_once() {
    let mut source = Machine::new(4 * 1024 * 1024);
    source.enable_plic();
    source.enable_virtio_slots(None);
    source.enable_virtio_rng(Box::new(FixedEntropy));
    configure_queue(&mut source, 2, 0);
    install_nop(&mut source);

    let (_, _, used, buffer) = queue_addresses(2, 0);
    for head in 0..QUEUE_SIZE as u16 {
        write_descriptor(
            &mut source,
            2,
            0,
            head,
            buffer + 8 * u64::from(head),
            8,
            DESC_WRITE,
            0,
        );
    }
    for batch in 0..8191u16 {
        let ordinal = batch.wrapping_mul(8);
        for offset in 0..8u16 {
            post_descriptor(&mut source, 2, 0, ordinal.wrapping_add(offset), offset);
        }
        kick(&mut source, 2, 0);
        source.hart_mut().regs.pc = virt::DRAM_BASE;
        assert_eq!(source.run(1), RunOutcome::MaxInstrs);
    }
    for offset in 0..7u16 {
        post_descriptor(&mut source, 2, 0, 65528u16.wrapping_add(offset), offset);
    }
    kick(&mut source, 2, 0);
    source.hart_mut().regs.pc = virt::DRAM_BASE;
    assert_eq!(source.run(1), RunOutcome::MaxInstrs);
    assert_eq!(source.bus_mut().load16(used + 2), Ok(u16::MAX));

    post_descriptor(&mut source, 2, 0, u16::MAX, 7);
    kick(&mut source, 2, 0);
    source.hart_mut().regs.pc = virt::DRAM_BASE;
    let blob = source.save_resume().unwrap();

    let mut target = Machine::new(4 * 1024 * 1024);
    target.enable_plic();
    target.enable_virtio_slots(None);
    let (_, rng) = target.enable_virtio_rng(Box::new(FixedEntropy));
    target.load_resume(&blob).unwrap();
    assert_eq!(rng.borrow().bytes_served, 65535 * 8);
    target.hart_mut().regs.pc = virt::DRAM_BASE;
    assert_eq!(target.run(1), RunOutcome::MaxInstrs);
    assert_eq!(target.bus_mut().load16(used + 2), Ok(0));
    assert_eq!(rng.borrow().bytes_served, 65536 * 8);

    target.hart_mut().regs.pc = virt::DRAM_BASE;
    assert_eq!(target.run(1), RunOutcome::MaxInstrs);
    assert_eq!(target.bus_mut().load16(used + 2), Ok(0));
    assert_eq!(rng.borrow().bytes_served, 65536 * 8);
}

#[test]
fn sound_request_kicked_before_save_completes_once_after_resume() {
    let mut source = Machine::new(4 * 1024 * 1024);
    source.enable_plic();
    source.enable_virtio_slots(None);
    source.enable_virtio_snd();
    configure_queue(&mut source, 6, 0);
    install_nop(&mut source);
    let (_, _, used, buffer) = queue_addresses(6, 0);

    for ordinal in 0..2u16 {
        let request = buffer + 0x100 + u64::from(ordinal) * 0x100;
        let response = request + 0x40;
        let query = QueryInfo {
            code: VIRTIO_SND_R_JACK_INFO,
            start_id: 0,
            count: 1,
            size: JACK_INFO_SIZE as u32,
        }
        .to_bytes();
        for (offset, byte) in query.into_iter().enumerate() {
            source
                .bus_mut()
                .store8(request + offset as u64, byte)
                .unwrap();
        }
        let head = ordinal * 2;
        write_descriptor(&mut source, 6, 0, head, request, 16, DESC_NEXT, head + 1);
        write_descriptor(
            &mut source,
            6,
            0,
            head + 1,
            response,
            (4 + JACK_INFO_SIZE) as u32,
            DESC_WRITE,
            0,
        );
        post_descriptor(&mut source, 6, 0, ordinal, head);
        kick(&mut source, 6, 0);
        if ordinal == 0 {
            assert_eq!(source.run(1), RunOutcome::MaxInstrs);
            assert_eq!(source.bus_mut().load16(used + 2), Ok(1));
            source.hart_mut().regs.pc = virt::DRAM_BASE;
        }
    }
    let blob = source.save_resume().unwrap();

    let mut target = Machine::new(4 * 1024 * 1024);
    target.enable_plic();
    target.enable_virtio_slots(None);
    target.enable_virtio_snd();
    target.load_resume(&blob).unwrap();
    target.hart_mut().regs.pc = virt::DRAM_BASE;
    assert_eq!(target.run(1), RunOutcome::MaxInstrs);
    assert_eq!(target.bus_mut().load16(used + 2), Ok(2));
    target.hart_mut().regs.pc = virt::DRAM_BASE;
    assert_eq!(target.run(1), RunOutcome::MaxInstrs);
    assert_eq!(target.bus_mut().load16(used + 2), Ok(2));
}

#[test]
fn console_control_request_kicked_before_save_completes_once_after_resume() {
    let mut source = Machine::new(4 * 1024 * 1024);
    source.enable_plic();
    source.enable_virtio_slots(None);
    source.enable_virtio_console_at(8);
    configure_queue(&mut source, 8, CONTROL_TRANSMIT_QUEUE as usize);
    install_nop(&mut source);
    let (_, _, used, buffer) = queue_addresses(8, CONTROL_TRANSMIT_QUEUE as usize);

    for (ordinal, control) in [
        ConsoleControl::new(0, VIRTIO_CONSOLE_DEVICE_READY, 1),
        ConsoleControl::new(1, VIRTIO_CONSOLE_PORT_READY, 1),
    ]
    .into_iter()
    .enumerate()
    {
        let data = buffer + 0x100 + ordinal as u64 * 0x20;
        for (offset, byte) in control.to_bytes().into_iter().enumerate() {
            source.bus_mut().store8(data + offset as u64, byte).unwrap();
        }
        write_descriptor(
            &mut source,
            8,
            CONTROL_TRANSMIT_QUEUE as usize,
            ordinal as u16,
            data,
            8,
            0,
            0,
        );
        post_descriptor(
            &mut source,
            8,
            CONTROL_TRANSMIT_QUEUE as usize,
            ordinal as u16,
            ordinal as u16,
        );
        kick(&mut source, 8, CONTROL_TRANSMIT_QUEUE as usize);
        if ordinal == 0 {
            assert_eq!(source.run(1), RunOutcome::MaxInstrs);
            assert_eq!(source.bus_mut().load16(used + 2), Ok(1));
            source.hart_mut().regs.pc = virt::DRAM_BASE;
        }
    }
    let blob = source.save_resume().unwrap();

    let mut target = Machine::new(4 * 1024 * 1024);
    target.enable_plic();
    target.enable_virtio_slots(None);
    target.enable_virtio_console_at(8);
    target.load_resume(&blob).unwrap();
    target.hart_mut().regs.pc = virt::DRAM_BASE;
    assert_eq!(target.run(1), RunOutcome::MaxInstrs);
    assert_eq!(
        target.bus_mut().load16(used + 2),
        Ok(2),
        "the pre-snapshot guest kick must not be lost"
    );
    target.hart_mut().regs.pc = virt::DRAM_BASE;
    assert_eq!(target.run(1), RunOutcome::MaxInstrs);
    assert_eq!(target.bus_mut().load16(used + 2), Ok(2));
}

#[test]
fn machine_save_reconciles_held_keyboard_tablet_and_mouse_state() {
    let mut source = Machine::new(16 * 1024 * 1024);
    source.enable_plic();
    source.enable_virtio_slots(None);
    source.enable_virtio_rng(Box::new(FixedEntropy));
    let (_, source_keyboard, _) = source.enable_virtio_keyboard();
    let (_, source_tablet, _, source_mouse) = source.enable_virtio_pointer();
    source.enable_virtio_snd();
    source.enable_virtio_gpu(Box::new(NullSink)).unwrap();
    source.enable_virtio_console_at(8);
    install_nop(&mut source);

    for (state, code) in [
        (&source_keyboard, 30),
        (&source_tablet, 0x110),
        (&source_mouse, 0x110),
    ] {
        assert!(state.borrow_mut().inject_event(EV_KEY, code, 1));
        state.borrow_mut().sync();
    }
    let blob = source.save_resume().unwrap();
    for state in [&source_keyboard, &source_tablet, &source_mouse] {
        assert!(state.borrow_mut().release_all().release_events.is_empty());
    }

    let mut target = Machine::new(16 * 1024 * 1024);
    target.enable_plic();
    target.enable_virtio_slots(None);
    target.enable_virtio_rng(Box::new(FixedEntropy));
    let (_, target_keyboard, _) = target.enable_virtio_keyboard();
    let (_, target_tablet, _, target_mouse) = target.enable_virtio_pointer();
    target.enable_virtio_snd();
    target.enable_virtio_gpu(Box::new(NullSink)).unwrap();
    target.enable_virtio_console_at(8);
    target.load_resume(&blob).unwrap();
    for state in [&target_keyboard, &target_tablet, &target_mouse] {
        assert!(
            state.borrow_mut().release_all().release_events.is_empty(),
            "restored target retained a held host input"
        );
    }
}

#[test]
fn pending_old_session_agent_hello_cannot_attest_the_resumed_host() {
    // A complete, valid T23d HELLO frame: {len=10,type=HELLO,flags=0,version=1,caps=7}.
    const OLD_HELLO: [u8; 18] = [10, 0, 0, 0, 0, 0, 0, 0, 1, 0, 7, 0, 0, 0, 0, 0, 0, 0];

    let mut source = Machine::new(4 * 1024 * 1024);
    source.enable_plic();
    source.enable_virtio_slots(None);
    let (_, console) = source.enable_virtio_console_at(8);
    configure_queue(&mut source, 8, CONTROL_TRANSMIT_QUEUE as usize);
    configure_queue(&mut source, 8, AGENT_TRANSMIT_QUEUE as usize);
    install_nop(&mut source);

    for (ordinal, control) in [
        ConsoleControl::new(0, VIRTIO_CONSOLE_DEVICE_READY, 1),
        ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_READY, 1),
        ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_OPEN, 1),
    ]
    .into_iter()
    .enumerate()
    {
        if ordinal == 2 {
            console.borrow_mut().set_host_connected(true);
        }
        let (_, _, _, buffer) = queue_addresses(8, CONTROL_TRANSMIT_QUEUE as usize);
        let data = buffer + 0x100 + ordinal as u64 * 0x20;
        for (offset, byte) in control.to_bytes().into_iter().enumerate() {
            source.bus_mut().store8(data + offset as u64, byte).unwrap();
        }
        write_descriptor(
            &mut source,
            8,
            CONTROL_TRANSMIT_QUEUE as usize,
            ordinal as u16,
            data,
            8,
            0,
            0,
        );
        post_descriptor(
            &mut source,
            8,
            CONTROL_TRANSMIT_QUEUE as usize,
            ordinal as u16,
            ordinal as u16,
        );
        kick(&mut source, 8, CONTROL_TRANSMIT_QUEUE as usize);
        source.hart_mut().regs.pc = virt::DRAM_BASE;
        assert_eq!(source.run(1), RunOutcome::MaxInstrs);
    }
    assert!(source.confirm_virtio_console_agent_hello().is_some());
    assert!(console.borrow().agent_ready_for_restore());

    let (_, _, _, agent_buffer) = queue_addresses(8, AGENT_TRANSMIT_QUEUE as usize);
    for (offset, byte) in OLD_HELLO.into_iter().enumerate() {
        source
            .bus_mut()
            .store8(agent_buffer + offset as u64, byte)
            .unwrap();
    }
    write_descriptor(
        &mut source,
        8,
        AGENT_TRANSMIT_QUEUE as usize,
        0,
        agent_buffer,
        OLD_HELLO.len() as u32,
        0,
        0,
    );
    post_descriptor(&mut source, 8, AGENT_TRANSMIT_QUEUE as usize, 0, 0);
    kick(&mut source, 8, AGENT_TRANSMIT_QUEUE as usize);
    let blob = source.save_resume().unwrap();

    let mut target = Machine::new(4 * 1024 * 1024);
    target.enable_plic();
    target.enable_virtio_slots(None);
    let (_, restored) = target.enable_virtio_console_at(8);
    target.load_resume(&blob).unwrap();
    assert_eq!(restored.borrow().application_hello_generation(), 0);
    assert!(!restored.borrow().agent_ready_for_restore());
    target.hart_mut().regs.pc = virt::DRAM_BASE;
    assert_eq!(target.run(1), RunOutcome::MaxInstrs);

    let output = restored.borrow_mut().take_agent_output();
    let stale_hello_accepted = output == OLD_HELLO
        && target.confirm_virtio_console_agent_hello().is_some()
        && restored.borrow().agent_ready_for_restore();
    assert!(
        !stale_hello_accepted,
        "a pre-snapshot pending HELLO authenticated the resumed host session"
    );
}
