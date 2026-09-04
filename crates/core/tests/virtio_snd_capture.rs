//! E5-T21a: virtio-snd input stream and rxq contract fixtures.

#![cfg(feature = "std")]

use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
use wasm_vm_core::dev::virtio::snd::{
    self, AudioCaptureError, AudioCaptureSource, CaptureReport, ManualAudioClock, PcmParams,
    PcmState, PcmStatus, RX_QUEUE, SndStatus, VIRTIO_SND_EVT_PCM_XRUN, VIRTIO_SND_R_PCM_INFO,
    VIRTIO_SND_R_PCM_PREPARE, VIRTIO_SND_R_PCM_RELEASE, VIRTIO_SND_R_PCM_START,
    VIRTIO_SND_R_PCM_STOP, VIRTIO_SND_S_BAD_MSG, VIRTIO_SND_S_OK,
};
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;

const RAM_BYTES: usize = 8 * 1024 * 1024;
const QUEUE_SIZE: u16 = 16;
const STATUS: u64 = 0x070;
const QUEUE_SEL: u64 = 0x030;
const QUEUE_NUM: u64 = 0x038;
const QUEUE_READY: u64 = 0x044;
const QUEUE_NOTIFY: u64 = 0x050;
const QUEUE_DESC_LOW: u64 = 0x080;
const QUEUE_DRIVER_LOW: u64 = 0x090;
const QUEUE_DEVICE_LOW: u64 = 0x0a0;
const RX_DESC: u64 = DRAM_BASE + 0x10_0000;
const RX_AVAIL: u64 = DRAM_BASE + 0x11_0000;
const RX_USED: u64 = DRAM_BASE + 0x12_0000;
const EVENT_DESC: u64 = DRAM_BASE + 0x14_0000;
const EVENT_AVAIL: u64 = DRAM_BASE + 0x15_0000;
const EVENT_USED: u64 = DRAM_BASE + 0x16_0000;
const DATA: u64 = DRAM_BASE + 0x20_0000;
const DATA_STRIDE: u64 = 0x4000;

const F_NEXT: u16 = 1;
const F_WRITE: u16 = 2;
const PERIOD_NS: u64 = 83_334;

#[derive(Debug)]
struct RampSource {
    next: i16,
}

impl RampSource {
    fn new() -> Self {
        Self { next: -12_000 }
    }
}

impl AudioCaptureSource for RampSource {
    fn pull(
        &mut self,
        frames: &mut [i16],
        _sample_rate_hz: u32,
        channels: u8,
    ) -> Result<usize, AudioCaptureError> {
        if channels == 0 || !frames.len().is_multiple_of(channels as usize) {
            return Err(AudioCaptureError::Failed);
        }
        for sample in &mut *frames {
            *sample = self.next;
            self.next = self.next.wrapping_add(1);
        }
        Ok(frames.len() / channels as usize)
    }
}

#[derive(Debug, Default)]
struct ShortSource;

impl AudioCaptureSource for ShortSource {
    fn pull(
        &mut self,
        _frames: &mut [i16],
        _sample_rate_hz: u32,
        channels: u8,
    ) -> Result<usize, AudioCaptureError> {
        if channels == 0 {
            return Err(AudioCaptureError::Failed);
        }
        Ok(0)
    }
}

struct Rig {
    slot: Rc<RefCell<VirtioMmio>>,
    state: Rc<RefCell<snd::SndState>>,
    rxq: Option<wasm_vm_core::dev::virtio::queue::Virtqueue>,
    eventq: Option<wasm_vm_core::dev::virtio::queue::Virtqueue>,
    bus: SystemBus,
    rx_count: u16,
    event_count: u16,
}

impl Rig {
    fn new(with_eventq: bool) -> Self {
        let (device, state) = snd::new();
        state.borrow_mut().set_capture_enabled(true);
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
        let mut rig = Self {
            slot,
            state,
            rxq: None,
            eventq: None,
            bus: SystemBus::new(Ram::new(RAM_BYTES).unwrap()),
            rx_count: 0,
            event_count: 0,
        };
        rig.configure_transport(with_eventq);
        rig
    }

    fn configure_transport(&mut self, with_eventq: bool) {
        self.bus.store16(RX_AVAIL, 0).unwrap();
        self.bus.store16(RX_AVAIL + 2, 0).unwrap();
        self.bus.store16(RX_USED + 2, 0).unwrap();
        self.bus.store16(EVENT_AVAIL, 0).unwrap();
        self.bus.store16(EVENT_AVAIL + 2, 0).unwrap();
        self.bus.store16(EVENT_USED + 2, 0).unwrap();
        let write = |slot: &Rc<RefCell<VirtioMmio>>, offset: u64, value: u32| {
            slot.borrow_mut()
                .write(offset, Width::B4, u64::from(value))
                .unwrap();
        };
        write(&self.slot, STATUS, 1);
        write(&self.slot, STATUS, 3);
        let (queue, desc, avail, used) = (RX_QUEUE, RX_DESC, RX_AVAIL, RX_USED);
        write(&self.slot, QUEUE_SEL, queue);
        write(&self.slot, QUEUE_NUM, u32::from(QUEUE_SIZE));
        write(&self.slot, QUEUE_DESC_LOW, desc as u32);
        write(&self.slot, QUEUE_DRIVER_LOW, avail as u32);
        write(&self.slot, QUEUE_DEVICE_LOW, used as u32);
        write(&self.slot, QUEUE_READY, 1);
        if with_eventq {
            write(&self.slot, QUEUE_SEL, snd::EVENT_QUEUE);
            write(&self.slot, QUEUE_NUM, u32::from(QUEUE_SIZE));
            write(&self.slot, QUEUE_DESC_LOW, EVENT_DESC as u32);
            write(&self.slot, QUEUE_DRIVER_LOW, EVENT_AVAIL as u32);
            write(&self.slot, QUEUE_DEVICE_LOW, EVENT_USED as u32);
            write(&self.slot, QUEUE_READY, 1);
        }
        write(&self.slot, STATUS, 15);
    }

    fn control(&mut self, request: &[u8]) -> u32 {
        let response = self.state.borrow_mut().handle_control(request);
        u32::from_le_bytes(response[..4].try_into().unwrap())
    }

    fn command(&mut self, code: u32) -> u32 {
        let mut request = [0u8; 8];
        request[..4].copy_from_slice(&code.to_le_bytes());
        request[4..8].copy_from_slice(&1u32.to_le_bytes());
        self.control(&request)
    }

    fn start(&mut self, params: PcmParams) {
        assert_eq!(self.control(&params.to_bytes()), VIRTIO_SND_S_OK);
        assert_eq!(self.command(VIRTIO_SND_R_PCM_PREPARE), VIRTIO_SND_S_OK);
        assert_eq!(self.command(VIRTIO_SND_R_PCM_START), VIRTIO_SND_S_OK);
        assert_eq!(
            self.state.borrow().capture_stream_state(),
            PcmState::Running
        );
    }

    fn post_rx(
        &mut self,
        stream_id: u32,
        header_len: u32,
        data_len: u32,
        status_len: u32,
    ) -> RxBuf {
        let ordinal = self.rx_count;
        let head = (ordinal % 5) * 3;
        let base = DATA + DATA_STRIDE * u64::from(ordinal);
        let data = base + 0x100;
        let status = data + u64::from(data_len) + 0x20;
        for (index, byte) in (snd::PcmXfer { stream_id }).to_bytes().iter().enumerate() {
            self.bus.store8(base + index as u64, *byte).unwrap();
        }
        for offset in 0..u64::from(data_len) + 0x40 {
            self.bus.store8(data + offset, 0x5a).unwrap();
        }
        for offset in 0..u64::from(status_len.max(8)) {
            self.bus.store8(status + offset, 0xa5).unwrap();
        }
        write_desc(
            &mut self.bus,
            RX_DESC,
            head,
            base,
            header_len,
            F_NEXT,
            head + 1,
        );
        write_desc(
            &mut self.bus,
            RX_DESC,
            head + 1,
            data,
            data_len,
            F_WRITE | F_NEXT,
            head + 2,
        );
        write_desc(
            &mut self.bus,
            RX_DESC,
            head + 2,
            status,
            status_len,
            F_WRITE,
            0,
        );
        let avail_slot = RX_AVAIL + 4 + 2 * u64::from(ordinal % QUEUE_SIZE);
        self.bus.store16(avail_slot, head).unwrap();
        self.rx_count = ordinal.wrapping_add(1);
        self.bus.store16(RX_AVAIL + 2, self.rx_count).unwrap();
        RxBuf {
            data,
            data_len,
            status,
            status_len,
        }
    }

    fn post_event(&mut self) -> u16 {
        let ordinal = self.event_count;
        let head = ordinal % QUEUE_SIZE;
        let address = DATA + 0x3000 + 0x20 * u64::from(ordinal);
        for offset in 0..snd::SND_EVENT_SIZE {
            self.bus.store8(address + offset as u64, 0xcc).unwrap();
        }
        write_desc(
            &mut self.bus,
            EVENT_DESC,
            head,
            address,
            snd::SND_EVENT_SIZE as u32,
            F_WRITE,
            0,
        );
        self.bus
            .store16(EVENT_AVAIL + 4 + 2 * u64::from(ordinal % QUEUE_SIZE), head)
            .unwrap();
        self.event_count = ordinal.wrapping_add(1);
        self.bus.store16(EVENT_AVAIL + 2, self.event_count).unwrap();
        head
    }

    fn kick(&mut self, queue: u32) {
        self.slot
            .borrow_mut()
            .write(QUEUE_NOTIFY, Width::B4, u64::from(queue))
            .unwrap();
    }

    fn service(
        &mut self,
        clock: &ManualAudioClock,
        source: &mut dyn AudioCaptureSource,
    ) -> CaptureReport {
        snd::service_capture_with_eventq(
            &self.slot,
            &mut self.eventq,
            &mut self.rxq,
            &self.state,
            clock,
            source,
            &mut self.bus,
        )
    }

    fn used_idx(&mut self) -> u16 {
        self.bus.load16(RX_USED + 2).unwrap()
    }

    fn capture_pending_count(&self) -> usize {
        self.state.borrow().capture_pending_count()
    }

    fn used_len(&mut self, index: u16) -> u32 {
        self.bus
            .load32(RX_USED + 4 + 8 * u64::from(index % QUEUE_SIZE) + 4)
            .unwrap()
    }

    fn status(&mut self, address: u64) -> PcmStatus {
        let mut bytes = [0u8; snd::PCM_STATUS_SIZE];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = self.bus.load8(address + index as u64).unwrap();
        }
        PcmStatus::from_bytes(&bytes).unwrap()
    }
}

struct RxBuf {
    data: u64,
    data_len: u32,
    status: u64,
    status_len: u32,
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
    let descriptor = table + 16 * u64::from(index);
    bus.store64(descriptor, addr).unwrap();
    bus.store32(descriptor + 8, len).unwrap();
    bus.store16(descriptor + 12, flags).unwrap();
    bus.store16(descriptor + 14, next).unwrap();
}

fn params(period_bytes: u32, channels: u8) -> PcmParams {
    PcmParams {
        stream_id: 1,
        buffer_bytes: period_bytes * 4,
        period_bytes,
        channels,
        ..PcmParams::default()
    }
}

#[test]
fn capture_rxq_completes_full_buffer_and_preserves_canaries() {
    let mut rig = Rig::new(false);
    assert_eq!(rig.slot.borrow_mut().read(0x100 + 4, Width::B4).unwrap(), 2);
    let mut info = [0u8; snd::QUERY_INFO_SIZE];
    info[..4].copy_from_slice(&VIRTIO_SND_R_PCM_INFO.to_le_bytes());
    info[8..12].copy_from_slice(&2u32.to_le_bytes());
    info[12..16].copy_from_slice(&(snd::PCM_INFO_SIZE as u32).to_le_bytes());
    let response = rig.control(&info);
    assert_eq!(response, VIRTIO_SND_S_OK);
    let info_bytes = rig.state.borrow_mut().handle_control(&info);
    assert_eq!(info_bytes.len(), 4 + 2 * snd::PCM_INFO_SIZE);
    assert_eq!(
        info_bytes[4 + snd::PCM_INFO_SIZE + 24],
        snd::VIRTIO_SND_D_INPUT
    );

    let capture_params = params(16, 2);
    rig.start(capture_params);
    let posted = rig.post_rx(
        1,
        4,
        capture_params.period_bytes,
        snd::PCM_STATUS_SIZE as u32,
    );
    let mut source = RampSource::new();
    rig.kick(RX_QUEUE);
    let queued = rig.service(&ManualAudioClock::new(), &mut source);
    assert_eq!(queued.queued, 1);
    assert_eq!(queued.completed, 0);
    assert_eq!(rig.used_idx(), 0);

    let clock = ManualAudioClock::new();
    clock.set_now_ns(PERIOD_NS);
    let completed = rig.service(&clock, &mut source);
    assert_eq!(completed.completed, 1);
    assert_eq!(completed.frames_pulled, 4);
    assert_eq!(completed.bytes_written, 16);
    assert_eq!(rig.used_idx(), 1);
    assert_eq!(rig.used_len(0), 16 + snd::PCM_STATUS_SIZE as u32);
    assert_eq!(rig.status(posted.status).status, snd::SndStatus::Ok);
    assert_eq!(rig.status(posted.status).latency_bytes, 0);
    assert_eq!(posted.data_len, 16);
    assert_eq!(posted.status_len, 8);
    for (index, expected) in (-12_000i16..-11_992).enumerate() {
        assert_eq!(
            rig.bus.load16(posted.data + 2 * index as u64).unwrap(),
            expected as u16
        );
    }
    for offset in 16..0x30 {
        assert_eq!(rig.bus.load8(posted.data + offset).unwrap(), 0x5a);
    }
    for offset in 0x38..0x40 {
        assert_eq!(rig.bus.load8(posted.data + offset).unwrap(), 0x5a);
    }
    assert_eq!(rig.bus.load8(posted.status + 8).unwrap(), 0x5a);
}

#[test]
fn malformed_rxq_buffers_complete_bounded_and_next_valid_buffer_recovers() {
    let mut rig = Rig::new(false);
    let capture_params = params(16, 2);
    rig.start(capture_params);
    let malformed_header = rig.post_rx(1, 3, 16, 8);
    let mut source = RampSource::new();
    rig.kick(RX_QUEUE);
    let bad = rig.service(&ManualAudioClock::new(), &mut source);
    assert_eq!(bad.completed, 1);
    assert_eq!(bad.errors, 1);
    assert_eq!(rig.used_len(0), 8);
    assert_eq!(rig.status(malformed_header.status).status, SndStatus::IoErr);

    let short_data = rig.post_rx(1, 4, 8, 8);
    rig.kick(RX_QUEUE);
    let short = rig.service(&ManualAudioClock::new(), &mut source);
    assert_eq!(short.completed, 1);
    assert_eq!(short.errors, 1);
    assert_eq!(rig.used_len(1), 8);
    assert_eq!(rig.status(short_data.status).status, SndStatus::IoErr);

    let wrong_stream = rig.post_rx(0, 4, 16, 8);
    rig.kick(RX_QUEUE);
    let wrong = rig.service(&ManualAudioClock::new(), &mut source);
    assert_eq!(wrong.completed, 1);
    assert_eq!(wrong.errors, 1);
    assert_eq!(rig.status(wrong_stream.status).status, SndStatus::IoErr);

    let too_short_status = rig.post_rx(1, 4, 4, 2);
    rig.kick(RX_QUEUE);
    let short_status = rig.service(&ManualAudioClock::new(), &mut source);
    assert_eq!(short_status.completed, 1);
    assert_eq!(short_status.errors, 1);
    assert_eq!(rig.used_len(3), 0);
    assert_eq!(rig.bus.load8(too_short_status.status).unwrap(), 0xa5);

    let valid = rig.post_rx(1, 4, 16, 8);
    rig.kick(RX_QUEUE);
    assert_eq!(rig.service(&ManualAudioClock::new(), &mut source).queued, 1);
    let clock = ManualAudioClock::new();
    clock.set_now_ns(PERIOD_NS);
    let recovered = rig.service(&clock, &mut source);
    assert_eq!(recovered.completed, 1);
    assert_eq!(rig.status(valid.status).status, SndStatus::Ok);
}

#[test]
fn capture_transitions_are_stream_local_and_release_flushes_pending_rxq() {
    let mut rig = Rig::new(false);
    let output_params = PcmParams::default();
    assert_eq!(rig.control(&output_params.to_bytes()), VIRTIO_SND_S_OK);
    let mut output_start = [0u8; 8];
    output_start[..4].copy_from_slice(&VIRTIO_SND_R_PCM_START.to_le_bytes());
    output_start[4..].copy_from_slice(&0u32.to_le_bytes());
    assert_eq!(rig.control(&output_start), VIRTIO_SND_S_BAD_MSG);

    let capture_params = params(16, 2);
    rig.start(capture_params);
    let mut source = RampSource::new();
    let posted = rig.post_rx(1, 4, 16, 8);
    rig.kick(RX_QUEUE);
    assert_eq!(rig.service(&ManualAudioClock::new(), &mut source).queued, 1);
    assert_eq!(rig.capture_pending_count(), 1);
    assert_eq!(rig.command(VIRTIO_SND_R_PCM_STOP), VIRTIO_SND_S_OK);
    assert_eq!(rig.state.borrow().capture_stream_state(), PcmState::Stopped);
    assert_eq!(rig.command(VIRTIO_SND_R_PCM_START), VIRTIO_SND_S_OK);
    assert_eq!(rig.state.borrow().capture_stream_state(), PcmState::Running);
    assert_eq!(rig.command(VIRTIO_SND_R_PCM_STOP), VIRTIO_SND_S_OK);
    assert_eq!(rig.state.borrow().capture_stream_state(), PcmState::Stopped);
    assert_eq!(rig.command(VIRTIO_SND_R_PCM_RELEASE), VIRTIO_SND_S_OK);
    assert_eq!(
        rig.state.borrow().capture_stream_state(),
        PcmState::Released
    );
    let flushed = rig.service(&ManualAudioClock::new(), &mut source);
    assert_eq!(flushed.completed, 1);
    assert_eq!(flushed.errors, 1);
    assert_eq!(rig.status(posted.status).status, SndStatus::IoErr);
    assert_eq!(rig.capture_pending_count(), 0);
}

#[test]
fn short_capture_source_zero_fills_and_delivers_input_xrun_event() {
    let mut rig = Rig::new(true);
    rig.start(params(16, 1));
    let event_head = rig.post_event();
    rig.kick(snd::EVENT_QUEUE);
    let posted = rig.post_rx(1, 4, 16, 8);
    let mut source = ShortSource;
    rig.kick(RX_QUEUE);
    assert_eq!(rig.service(&ManualAudioClock::new(), &mut source).queued, 1);
    let clock = ManualAudioClock::new();
    clock.set_now_ns(166_667);
    let report = rig.service(&clock, &mut source);
    assert_eq!(report.completed, 1);
    assert_eq!(report.xrun_events, 1);
    assert_eq!(report.event_descriptors_completed, 1);
    assert_eq!(rig.status(posted.status).status, SndStatus::Ok);
    assert_eq!(rig.used_len(0), 24);
    for offset in 0..16 {
        assert_eq!(rig.bus.load8(posted.data + offset).unwrap(), 0);
    }
    let event_addr = DATA + 0x3000 + 0x20 * u64::from(event_head);
    assert_eq!(rig.bus.load32(event_addr).unwrap(), VIRTIO_SND_EVT_PCM_XRUN);
    assert_eq!(rig.bus.load32(event_addr + 4).unwrap(), 1);
}

#[test]
fn capture_xrun_events_stay_within_the_bounded_event_budget() {
    let mut rig = Rig::new(false);
    rig.start(params(16, 2));
    let mut source = ShortSource;
    let clock = ManualAudioClock::new();

    for index in 0..(snd::MAX_PENDING_SND_EVENTS + 1) {
        rig.post_rx(1, 4, 16, 8);
        rig.kick(RX_QUEUE);
        assert_eq!(rig.service(&clock, &mut source).queued, 1);
        clock.advance_ns(PERIOD_NS);
        let report = rig.service(&clock, &mut source);
        assert_eq!(report.completed, 1, "capture {index} did not complete");
    }

    assert_eq!(
        rig.state.borrow().pending_event_count(),
        snd::MAX_PENDING_SND_EVENTS
    );
    assert_eq!(rig.state.borrow().dropped_xrun_events(), 1);
}

#[test]
fn one_megabyte_period_is_bounded_by_the_posted_writable_buffer() {
    let mut rig = Rig::new(false);
    let capture_params = PcmParams {
        stream_id: 1,
        buffer_bytes: 1024 * 1024,
        period_bytes: 1024 * 1024,
        channels: 2,
        ..PcmParams::default()
    };
    rig.start(capture_params);
    let malformed = rig.post_rx(1, 4, 1024, 8);
    let mut source = RampSource::new();
    rig.kick(RX_QUEUE);
    let report = rig.service(&ManualAudioClock::new(), &mut source);
    assert_eq!(report.completed, 1);
    assert_eq!(report.errors, 1);
    assert_eq!(rig.used_len(0), 8);
    assert_eq!(rig.status(malformed.status).status, SndStatus::IoErr);
    assert_eq!(rig.bus.load8(malformed.data + 1024).unwrap(), 0x5a);
}
