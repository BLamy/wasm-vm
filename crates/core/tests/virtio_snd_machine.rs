//! E5-T19d: virtio-snd through the assembled Machine and the real virtio-mmio control/data rings.

#![cfg(not(feature = "zicsr-stub"))]

use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::block::MemBackend;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::input::pointer::FIRST_FREE_VIRTIO_SLOT;
use wasm_vm_core::dev::virtio::net::LoopbackBackend;
use wasm_vm_core::dev::virtio::snd::{
    self, AudioSink, AudioSinkError, ManualAudioClock, PcmInfo, PcmParams, PcmStatus, PcmXfer,
    SndStatus, VIRTIO_SND_R_PCM_INFO, VIRTIO_SND_R_PCM_PREPARE, VIRTIO_SND_R_PCM_START,
    VIRTIO_SND_R_PCM_STOP, VIRTIO_SND_S_BAD_MSG, VIRTIO_SND_S_OK,
};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::platform::virt;
use wasm_vm_core::{Machine, RunOutcome};

const RAM_BYTES: usize = 16 * 1024 * 1024;
const QUEUE_SIZE: u16 = 8;
const STATUS: u64 = 0x070;
const QUEUE_SEL: u64 = 0x030;
const QUEUE_NUM: u64 = 0x038;
const QUEUE_READY: u64 = 0x044;
const QUEUE_NOTIFY: u64 = 0x050;
const QUEUE_DESC_LOW: u64 = 0x080;
const QUEUE_DRIVER_LOW: u64 = 0x090;
const QUEUE_DEVICE_LOW: u64 = 0x0a0;
const F_NEXT: u16 = 1;
const F_WRITE: u16 = 2;

const CONTROL_DESC: u64 = virt::DRAM_BASE + 0x1_0000;
const CONTROL_AVAIL: u64 = virt::DRAM_BASE + 0x2_0000;
const CONTROL_USED: u64 = virt::DRAM_BASE + 0x3_0000;
const CONTROL_DATA: u64 = virt::DRAM_BASE + 0x4_0000;
const CONTROL_STRIDE: u64 = 0x100;

const TX_DESC: u64 = virt::DRAM_BASE + 0x6_0000;
const TX_AVAIL: u64 = virt::DRAM_BASE + 0x7_0000;
const TX_USED: u64 = virt::DRAM_BASE + 0x8_0000;
const TX_DATA: u64 = virt::DRAM_BASE + 0x9_0000;
const TX_STATUS: u64 = virt::DRAM_BASE + 0xa_0000;

#[derive(Clone, Default)]
struct CapturedAudio(Rc<RefCell<Vec<i16>>>);

impl AudioSink for CapturedAudio {
    fn push(&mut self, frames: &[i16], sample_rate_hz: u32) -> Result<(), AudioSinkError> {
        assert_eq!(sample_rate_hz, 48_000);
        self.0.borrow_mut().extend_from_slice(frames);
        Ok(())
    }
}

fn write_desc(
    bus: &mut SystemBus,
    table: u64,
    index: u16,
    addr: u64,
    len: u32,
    flags: u16,
    next: u16,
) {
    let base = table + 16 * u64::from(index);
    bus.store64(base, addr).unwrap();
    bus.store32(base + 8, len).unwrap();
    bus.store16(base + 12, flags).unwrap();
    bus.store16(base + 14, next).unwrap();
}

fn configure_queue(
    machine: &mut Machine,
    slot_base: u64,
    queue: u32,
    desc: u64,
    avail: u64,
    used: u64,
) {
    let write = |machine: &mut Machine, offset: u64, value: u32| {
        machine
            .bus_mut()
            .store32(slot_base + offset, value)
            .unwrap();
    };
    write(machine, QUEUE_SEL, queue);
    write(machine, QUEUE_NUM, u32::from(QUEUE_SIZE));
    write(machine, QUEUE_DESC_LOW, desc as u32);
    write(machine, QUEUE_DESC_LOW + 4, 0);
    write(machine, QUEUE_DRIVER_LOW, avail as u32);
    write(machine, QUEUE_DRIVER_LOW + 4, 0);
    write(machine, QUEUE_DEVICE_LOW, used as u32);
    write(machine, QUEUE_DEVICE_LOW + 4, 0);
    write(machine, QUEUE_READY, 1);
}

fn publish(bus: &mut SystemBus, avail: u64, ordinal: u16, head: u16) {
    bus.store16(avail + 4 + 2 * u64::from(ordinal % QUEUE_SIZE), head)
        .unwrap();
    bus.store16(avail + 2, ordinal.wrapping_add(1)).unwrap();
}

fn status(bus: &mut SystemBus, address: u64) -> u32 {
    bus.load32(address).unwrap()
}

fn setup_machine() -> (Machine, u64, Rc<ManualAudioClock>, Rc<RefCell<Vec<i16>>>) {
    let mut machine = Machine::new(RAM_BYTES);
    machine.enable_clint(10);
    machine.enable_plic();
    let _ = machine.enable_virtio_blk(Box::new(MemBackend::new(vec![0u8; 512 * 64])));
    let _ = machine.enable_virtio_net(Box::new(LoopbackBackend::new()));
    let _ = machine.enable_virtio_keyboard();
    let _ = machine.enable_virtio_pointer();

    let clock = Rc::new(ManualAudioClock::new());
    let captured = Rc::new(RefCell::new(Vec::new()));
    let (slot, state) = machine
        .enable_virtio_snd_with_audio(clock.clone(), Box::new(CapturedAudio(captured.clone())));
    let (slot_index, state_again) = machine.virtio_snd().unwrap();
    assert_eq!(slot_index, snd::VIRTIO_SND_SLOT);
    assert!(Rc::ptr_eq(&state, &state_again));
    let slot_base = wasm_vm_core::platform::Platform::virtio_base(slot_index as u64);
    assert_eq!(slot_base, wasm_vm_core::platform::Platform::virtio_base(6));
    assert_eq!(slot.borrow().device_id(), 25);
    assert_eq!(
        machine
            .bus_mut()
            .load32(wasm_vm_core::platform::Platform::virtio_base(0) + 8),
        Ok(2)
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(wasm_vm_core::platform::Platform::virtio_base(1) + 8),
        Ok(1)
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(wasm_vm_core::platform::Platform::virtio_base(3) + 8),
        Ok(18)
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(wasm_vm_core::platform::Platform::virtio_base(4) + 8),
        Ok(18)
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(wasm_vm_core::platform::Platform::virtio_base(5) + 8),
        Ok(18)
    );

    machine.enable_builtin_sbi();
    machine.boot_supervisor(0, 0);
    machine
        .bus_mut()
        .store32(virt::KERNEL_BASE, 0x0000_006F)
        .unwrap();
    (machine, slot_base, clock, captured)
}

fn start_transport(machine: &mut Machine, slot_base: u64) {
    let write = |machine: &mut Machine, offset: u64, value: u32| {
        machine
            .bus_mut()
            .store32(slot_base + offset, value)
            .unwrap();
    };
    write(machine, STATUS, 1);
    write(machine, STATUS, 3);
    // VERSION_1 is offered in the upper feature bank. No device-specific bits are required by
    // this fixture, so accepting the empty lower bank is enough to enter FEATURES_OK.
    write(machine, STATUS, 11);
    configure_queue(
        machine,
        slot_base,
        snd::CONTROL_QUEUE,
        CONTROL_DESC,
        CONTROL_AVAIL,
        CONTROL_USED,
    );
    configure_queue(
        machine,
        slot_base,
        snd::TX_QUEUE,
        TX_DESC,
        TX_AVAIL,
        TX_USED,
    );
    write(machine, STATUS, 15);
    machine.bus_mut().store16(CONTROL_AVAIL + 2, 0).unwrap();
    machine.bus_mut().store16(CONTROL_USED + 2, 0).unwrap();
    machine.bus_mut().store16(TX_AVAIL + 2, 0).unwrap();
    machine.bus_mut().store16(TX_USED + 2, 0).unwrap();
}

fn post_control(machine: &mut Machine, ordinal: u16, request: &[u8], response_len: u32) {
    let head = (ordinal % 4) * 2;
    let base = CONTROL_DATA + CONTROL_STRIDE * u64::from(ordinal % 4);
    let response = base + 0x40;
    for (offset, byte) in request.iter().copied().enumerate() {
        machine
            .bus_mut()
            .store8(base + offset as u64, byte)
            .unwrap();
    }
    write_desc(
        machine.bus_mut(),
        CONTROL_DESC,
        head,
        base,
        request.len() as u32,
        F_NEXT,
        head + 1,
    );
    write_desc(
        machine.bus_mut(),
        CONTROL_DESC,
        head + 1,
        response,
        response_len,
        F_WRITE,
        0,
    );
    publish(machine.bus_mut(), CONTROL_AVAIL, ordinal, head);
}

fn command(code: u32) -> [u8; 8] {
    let mut request = [0u8; 8];
    request[..4].copy_from_slice(&code.to_le_bytes());
    request
}

fn used(machine: &mut Machine, base: u64) -> u16 {
    machine.bus_mut().load16(base + 2).unwrap()
}

#[test]
fn assembled_sound_device_serves_controlq_and_paced_txq_without_shifting_existing_slots() {
    let (mut machine, slot_base, clock, captured) = setup_machine();
    start_transport(&mut machine, slot_base);

    let params = PcmParams {
        buffer_bytes: 64,
        period_bytes: 16,
        ..PcmParams::default()
    };
    post_control(
        &mut machine,
        0,
        &snd::QueryInfo {
            code: VIRTIO_SND_R_PCM_INFO,
            start_id: 0,
            count: 1,
            size: snd::PCM_INFO_SIZE as u32,
        }
        .to_bytes(),
        (4 + snd::PCM_INFO_SIZE) as u32,
    );
    post_control(&mut machine, 1, &params.to_bytes(), 4);
    post_control(&mut machine, 2, &command(VIRTIO_SND_R_PCM_PREPARE), 4);
    post_control(&mut machine, 3, &command(VIRTIO_SND_R_PCM_START), 4);
    machine
        .bus_mut()
        .store32(slot_base + QUEUE_NOTIFY, snd::CONTROL_QUEUE)
        .unwrap();
    assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
    assert_eq!(used(&mut machine, CONTROL_USED), 4);
    assert_eq!(
        status(machine.bus_mut(), CONTROL_DATA + 0x40),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(machine.bus_mut(), CONTROL_DATA + 0x140),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(machine.bus_mut(), CONTROL_DATA + 0x240),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(machine.bus_mut(), CONTROL_DATA + 0x340),
        VIRTIO_SND_S_OK
    );
    let mut info = [0u8; snd::PCM_INFO_SIZE];
    for (offset, byte) in info.iter_mut().enumerate() {
        *byte = machine
            .bus_mut()
            .load8(CONTROL_DATA + 0x40 + 4 + offset as u64)
            .unwrap();
    }
    assert_eq!(info, PcmInfo::output().to_bytes());

    let samples: Vec<i16> = (-4..4).collect();
    let xfer = TX_DATA;
    for (offset, byte) in (PcmXfer { stream_id: 0 }).to_bytes().iter().enumerate() {
        machine
            .bus_mut()
            .store8(xfer + offset as u64, *byte)
            .unwrap();
    }
    for (index, sample) in samples.iter().copied().enumerate() {
        machine
            .bus_mut()
            .store16(xfer + 4 + 2 * index as u64, sample as u16)
            .unwrap();
    }
    write_desc(machine.bus_mut(), TX_DESC, 0, xfer, 4, F_NEXT, 1);
    write_desc(machine.bus_mut(), TX_DESC, 1, xfer + 4, 16, F_NEXT, 2);
    write_desc(machine.bus_mut(), TX_DESC, 2, TX_STATUS, 8, F_WRITE, 0);
    machine.bus_mut().store64(TX_STATUS, u64::MAX).unwrap();
    publish(machine.bus_mut(), TX_AVAIL, 0, 0);
    machine
        .bus_mut()
        .store32(slot_base + QUEUE_NOTIFY, snd::TX_QUEUE)
        .unwrap();
    assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
    assert_eq!(
        used(&mut machine, TX_USED),
        0,
        "arrival must not drain in a burst"
    );
    assert_eq!(machine.bus_mut().load64(TX_STATUS), Ok(u64::MAX));

    clock.advance_ns(83_334);
    assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
    assert_eq!(used(&mut machine, TX_USED), 1);
    assert_eq!(machine.bus_mut().load32(TX_USED + 4), Ok(0));
    assert_eq!(machine.bus_mut().load32(TX_USED + 8), Ok(8));
    assert_eq!(
        PcmStatus::from_bytes(&read_status(&mut machine, TX_STATUS))
            .unwrap()
            .status,
        SndStatus::Ok
    );
    assert_eq!(&*captured.borrow(), &samples);
}

fn read_status(machine: &mut Machine, address: u64) -> [u8; snd::PCM_STATUS_SIZE] {
    let mut out = [0u8; snd::PCM_STATUS_SIZE];
    for (offset, byte) in out.iter_mut().enumerate() {
        *byte = machine.bus_mut().load8(address + offset as u64).unwrap();
    }
    out
}

#[test]
fn controlq_reclaims_malformed_request_then_accepts_query_and_stop_start_resumes() {
    let (mut machine, slot_base, clock, captured) = setup_machine();
    start_transport(&mut machine, slot_base);

    let params = PcmParams {
        buffer_bytes: 64,
        period_bytes: 16,
        ..PcmParams::default()
    };
    post_control(&mut machine, 0, &[0x01, 0x02], 4);
    post_control(
        &mut machine,
        1,
        &snd::QueryInfo {
            code: VIRTIO_SND_R_PCM_INFO,
            start_id: 0,
            count: 1,
            size: snd::PCM_INFO_SIZE as u32,
        }
        .to_bytes(),
        (4 + snd::PCM_INFO_SIZE) as u32,
    );
    machine
        .bus_mut()
        .store32(slot_base + QUEUE_NOTIFY, snd::CONTROL_QUEUE)
        .unwrap();
    assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
    assert_eq!(used(&mut machine, CONTROL_USED), 2);
    assert_eq!(
        status(machine.bus_mut(), CONTROL_DATA + 0x40),
        VIRTIO_SND_S_BAD_MSG
    );
    assert_eq!(
        status(machine.bus_mut(), CONTROL_DATA + 0x140),
        VIRTIO_SND_S_OK
    );

    for (ordinal, request) in [
        params.to_bytes().to_vec(),
        command(VIRTIO_SND_R_PCM_PREPARE).to_vec(),
        command(VIRTIO_SND_R_PCM_START).to_vec(),
    ]
    .into_iter()
    .enumerate()
    {
        let ordinal = ordinal as u16 + 2;
        post_control(&mut machine, ordinal, &request, 4);
    }
    machine
        .bus_mut()
        .store32(slot_base + QUEUE_NOTIFY, snd::CONTROL_QUEUE)
        .unwrap();
    assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
    assert_eq!(used(&mut machine, CONTROL_USED), 5);

    let samples: Vec<i16> = (10..18).collect();
    for (offset, byte) in (PcmXfer { stream_id: 0 }).to_bytes().iter().enumerate() {
        machine
            .bus_mut()
            .store8(TX_DATA + offset as u64, *byte)
            .unwrap();
    }
    for (index, sample) in samples.iter().copied().enumerate() {
        machine
            .bus_mut()
            .store16(TX_DATA + 4 + 2 * index as u64, sample as u16)
            .unwrap();
    }
    write_desc(machine.bus_mut(), TX_DESC, 0, TX_DATA, 4, F_NEXT, 1);
    write_desc(machine.bus_mut(), TX_DESC, 1, TX_DATA + 4, 16, F_NEXT, 2);
    write_desc(machine.bus_mut(), TX_DESC, 2, TX_STATUS, 8, F_WRITE, 0);
    publish(machine.bus_mut(), TX_AVAIL, 0, 0);
    machine
        .bus_mut()
        .store32(slot_base + QUEUE_NOTIFY, snd::TX_QUEUE)
        .unwrap();
    assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
    assert_eq!(used(&mut machine, TX_USED), 0);

    // STOP followed immediately by START through controlq retains the pending period and
    // reschedules it from the restarted clock, rather than duplicating or dropping samples.
    post_control(&mut machine, 5, &command(VIRTIO_SND_R_PCM_STOP), 4);
    post_control(&mut machine, 6, &command(VIRTIO_SND_R_PCM_START), 4);
    machine
        .bus_mut()
        .store32(slot_base + QUEUE_NOTIFY, snd::CONTROL_QUEUE)
        .unwrap();
    assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
    assert_eq!(used(&mut machine, TX_USED), 0);
    clock.advance_ns(83_334);
    assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
    assert_eq!(used(&mut machine, TX_USED), 1);
    assert_eq!(&*captured.borrow(), &samples);
}

#[test]
fn controlq_bounds_oversized_request_and_short_response_without_poisoning_next_query() {
    let (mut machine, slot_base, _clock, _captured) = setup_machine();
    start_transport(&mut machine, slot_base);

    let oversized = vec![0xa5; snd::MAX_CONTROL_REQUEST_BYTES + 1];
    post_control(&mut machine, 0, &oversized, 4);
    post_control(
        &mut machine,
        1,
        &snd::QueryInfo {
            code: VIRTIO_SND_R_PCM_INFO,
            start_id: 0,
            count: 1,
            size: snd::PCM_INFO_SIZE as u32,
        }
        .to_bytes(),
        3,
    );
    post_control(
        &mut machine,
        2,
        &snd::QueryInfo {
            code: VIRTIO_SND_R_PCM_INFO,
            start_id: 0,
            count: 1,
            size: snd::PCM_INFO_SIZE as u32,
        }
        .to_bytes(),
        (4 + snd::PCM_INFO_SIZE) as u32,
    );
    machine
        .bus_mut()
        .store32(slot_base + QUEUE_NOTIFY, snd::CONTROL_QUEUE)
        .unwrap();
    assert_eq!(machine.run(4), RunOutcome::MaxInstrs);

    assert_eq!(used(&mut machine, CONTROL_USED), 3);
    assert_eq!(
        machine.bus_mut().load32(CONTROL_DATA + 0x40),
        Ok(VIRTIO_SND_S_BAD_MSG)
    );
    assert_eq!(machine.bus_mut().load32(CONTROL_USED + 16), Ok(0));
    assert_eq!(
        machine.bus_mut().load32(CONTROL_DATA + 0x240),
        Ok(VIRTIO_SND_S_OK)
    );
    let mut info = [0u8; snd::PCM_INFO_SIZE];
    for (offset, byte) in info.iter_mut().enumerate() {
        *byte = machine
            .bus_mut()
            .load8(CONTROL_DATA + 0x240 + 4 + offset as u64)
            .unwrap();
    }
    assert_eq!(info, PcmInfo::output().to_bytes());
}

#[test]
fn sound_uses_slot_seven_only_when_slot_six_is_already_occupied() {
    let mut machine = Machine::new(RAM_BYTES);
    machine.enable_clint(10);
    machine.enable_plic();
    let _ = machine.enable_virtio_slots(None);
    let _ = machine.enable_virtio_blk_at(
        FIRST_FREE_VIRTIO_SLOT,
        Box::new(MemBackend::new_read_only(vec![0u8; 512 * 4])),
    );
    let (slot, _) = machine.enable_virtio_snd();
    assert_eq!(slot.borrow().device_id(), 25);
    assert_eq!(machine.virtio_snd().unwrap().0, FIRST_FREE_VIRTIO_SLOT + 1);
    assert_eq!(
        machine
            .bus_mut()
            .load32(wasm_vm_core::platform::Platform::virtio_base(6) + 8),
        Ok(2)
    );
    assert_eq!(
        machine
            .bus_mut()
            .load32(wasm_vm_core::platform::Platform::virtio_base(7) + 8),
        Ok(25)
    );
}
