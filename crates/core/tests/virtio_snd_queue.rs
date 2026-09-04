//! E5-T19c: virtio-snd malformed txq recovery, bounded XRUN eventq, and reset cycling.

#![cfg(feature = "std")]

use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
use wasm_vm_core::dev::virtio::snd::{
    self, AudioSink, EVENT_QUEUE, ManualAudioClock, NullSink, PcmParams, PcmState, PcmStatus,
    PcmXfer, SND_EVENT_SIZE, SndEvent, TX_QUEUE, VIRTIO_SND_EVT_PCM_XRUN, VIRTIO_SND_R_PCM_PREPARE,
    VIRTIO_SND_R_PCM_RELEASE, VIRTIO_SND_R_PCM_START, VIRTIO_SND_R_PCM_STOP, VIRTIO_SND_S_IO_ERR,
    VIRTIO_SND_S_OK,
};
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;

const RAM_BYTES: usize = 4 * 1024 * 1024;
const QUEUE_SIZE: u16 = 16;
const STATUS: u64 = 0x070;
const QUEUE_SEL: u64 = 0x030;
const QUEUE_NUM: u64 = 0x038;
const QUEUE_READY: u64 = 0x044;
const QUEUE_NOTIFY: u64 = 0x050;
const QUEUE_DESC_LOW: u64 = 0x080;
const QUEUE_DRIVER_LOW: u64 = 0x090;
const QUEUE_DEVICE_LOW: u64 = 0x0a0;

const EVENT_DESC: u64 = DRAM_BASE + 0x10_0000;
const EVENT_AVAIL: u64 = DRAM_BASE + 0x11_0000;
const EVENT_USED: u64 = DRAM_BASE + 0x12_0000;
const EVENT_BUF: u64 = DRAM_BASE + 0x13_0000;
const TX_DESC: u64 = DRAM_BASE + 0x18_0000;
const TX_AVAIL: u64 = DRAM_BASE + 0x19_0000;
const TX_USED: u64 = DRAM_BASE + 0x1a_0000;
const TX_DATA: u64 = DRAM_BASE + 0x20_0000;
const TX_STRIDE: u64 = 0x2000;
const PERIOD_FRAMES: usize = 1024;
const PERIOD_BYTES: u32 = (PERIOD_FRAMES * 2 * 2) as u32;
const PERIOD_NS: u64 = 21_333_334;

const F_NEXT: u16 = 1;
const F_WRITE: u16 = 2;

struct Rig {
    slot: Rc<RefCell<VirtioMmio>>,
    state: Rc<RefCell<snd::SndState>>,
    eventq: Option<wasm_vm_core::dev::virtio::queue::Virtqueue>,
    txq: Option<wasm_vm_core::dev::virtio::queue::Virtqueue>,
    bus: SystemBus,
    tx_count: u16,
    event_count: u16,
}

impl Rig {
    fn new() -> Self {
        let (device, state) = snd::new();
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
        let mut rig = Self {
            slot,
            state,
            eventq: None,
            txq: None,
            bus: SystemBus::new(Ram::new(RAM_BYTES).unwrap()),
            tx_count: 0,
            event_count: 0,
        };
        rig.configure_transport();
        rig
    }

    fn configure_transport(&mut self) {
        self.bus.store16(EVENT_AVAIL, 0).unwrap();
        self.bus.store16(EVENT_AVAIL + 2, 0).unwrap();
        self.bus.store16(EVENT_USED + 2, 0).unwrap();
        self.bus.store16(TX_AVAIL, 0).unwrap();
        self.bus.store16(TX_AVAIL + 2, 0).unwrap();
        self.bus.store16(TX_USED + 2, 0).unwrap();
        let write = |slot: &Rc<RefCell<VirtioMmio>>, offset: u64, value: u32| {
            slot.borrow_mut()
                .write(offset, Width::B4, u64::from(value))
                .unwrap();
        };
        write(&self.slot, STATUS, 1);
        write(&self.slot, STATUS, 3);
        for (queue, desc, avail, used) in [
            (EVENT_QUEUE, EVENT_DESC, EVENT_AVAIL, EVENT_USED),
            (TX_QUEUE, TX_DESC, TX_AVAIL, TX_USED),
        ] {
            write(&self.slot, QUEUE_SEL, queue);
            write(&self.slot, QUEUE_NUM, u32::from(QUEUE_SIZE));
            write(&self.slot, QUEUE_DESC_LOW, desc as u32);
            write(&self.slot, QUEUE_DRIVER_LOW, avail as u32);
            write(&self.slot, QUEUE_DEVICE_LOW, used as u32);
            write(&self.slot, QUEUE_READY, 1);
        }
        write(&self.slot, STATUS, 15);
        self.tx_count = 0;
        self.event_count = 0;
    }

    fn command(&mut self, code: u32) -> u32 {
        let mut bytes = [0u8; 8];
        bytes[..4].copy_from_slice(&code.to_le_bytes());
        let response = self.state.borrow_mut().handle_control(&bytes);
        u32::from_le_bytes(response[..4].try_into().unwrap())
    }

    fn start(&mut self) {
        assert_eq!(
            self.state
                .borrow_mut()
                .handle_control(&PcmParams::default().to_bytes())[..4],
            VIRTIO_SND_S_OK.to_le_bytes()
        );
        assert_eq!(self.command(VIRTIO_SND_R_PCM_PREPARE), VIRTIO_SND_S_OK);
        assert_eq!(self.command(VIRTIO_SND_R_PCM_START), VIRTIO_SND_S_OK);
        assert_eq!(self.state.borrow().stream.state(), PcmState::Running);
    }

    fn service(
        &mut self,
        clock: &ManualAudioClock,
        sink: &mut dyn AudioSink,
    ) -> snd::PlaybackReport {
        snd::service_with_eventq(
            &self.slot,
            &mut self.eventq,
            &mut self.txq,
            &self.state,
            clock,
            sink,
            &mut self.bus,
        )
    }

    fn kick(&mut self, queue: u32) {
        self.slot
            .borrow_mut()
            .write(QUEUE_NOTIFY, Width::B4, u64::from(queue))
            .unwrap();
    }

    fn post_tx(&mut self, stream_id: u32, pcm_bytes: &[u8], status_len: u32) -> u64 {
        self.post_tx_shape(stream_id, 4, pcm_bytes, status_len)
    }

    fn post_tx_shape(
        &mut self,
        stream_id: u32,
        header_len: u32,
        pcm_bytes: &[u8],
        status_len: u32,
    ) -> u64 {
        let ordinal = self.tx_count;
        let head = (ordinal % 5) * 3;
        let base = TX_DATA + TX_STRIDE * u64::from(ordinal);
        let pcm = base + 4;
        let status = base + 0x1200;
        for (index, byte) in (PcmXfer { stream_id }).to_bytes().iter().enumerate() {
            self.bus.store8(base + index as u64, *byte).unwrap();
        }
        for (index, byte) in pcm_bytes.iter().copied().enumerate() {
            self.bus.store8(pcm + index as u64, byte).unwrap();
        }
        self.bus.store64(status, u64::MAX).unwrap();
        write_desc(
            &mut self.bus,
            TX_DESC,
            head,
            base,
            header_len,
            F_NEXT,
            head + 1,
        );
        write_desc(
            &mut self.bus,
            TX_DESC,
            head + 1,
            pcm,
            pcm_bytes.len() as u32,
            if pcm_bytes.is_empty() {
                F_WRITE
            } else {
                F_NEXT
            },
            if pcm_bytes.is_empty() { 0 } else { head + 2 },
        );
        if !pcm_bytes.is_empty() {
            write_desc(
                &mut self.bus,
                TX_DESC,
                head + 2,
                status,
                status_len,
                F_WRITE,
                0,
            );
        }
        // Header-only and zero-byte payload cases use the second descriptor as the status tail.
        if pcm_bytes.is_empty() {
            write_desc(
                &mut self.bus,
                TX_DESC,
                head + 1,
                status,
                status_len,
                F_WRITE,
                0,
            );
        }
        let avail_slot = TX_AVAIL + 4 + 2 * u64::from(ordinal % QUEUE_SIZE);
        self.bus.store16(avail_slot, head).unwrap();
        self.tx_count = ordinal.wrapping_add(1);
        self.bus.store16(TX_AVAIL + 2, self.tx_count).unwrap();
        status
    }

    fn post_event_buffer(&mut self, writable: bool, len: u32) -> u64 {
        let ordinal = self.event_count;
        let addr = EVENT_BUF + 0x100 * u64::from(ordinal);
        write_desc(
            &mut self.bus,
            EVENT_DESC,
            ordinal,
            addr,
            len,
            if writable { F_WRITE } else { 0 },
            0,
        );
        let avail_slot = EVENT_AVAIL + 4 + 2 * u64::from(ordinal % QUEUE_SIZE);
        self.bus.store16(avail_slot, ordinal).unwrap();
        self.event_count = ordinal.wrapping_add(1);
        self.bus.store16(EVENT_AVAIL + 2, self.event_count).unwrap();
        addr
    }

    fn used_idx(&mut self, base: u64) -> u16 {
        self.bus.load16(base + 2).unwrap()
    }

    fn used_elem(&mut self, base: u64, index: u16) -> (u32, u32) {
        let element = base + 4 + 8 * u64::from(index % QUEUE_SIZE);
        (
            self.bus.load32(element).unwrap(),
            self.bus.load32(element + 4).unwrap(),
        )
    }

    fn read_status(&mut self, address: u64) -> PcmStatus {
        let mut bytes = [0u8; 8];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = self.bus.load8(address + index as u64).unwrap();
        }
        PcmStatus::from_bytes(&bytes).unwrap()
    }

    fn reset_and_re_setup(&mut self) {
        self.slot.borrow_mut().write(STATUS, Width::B4, 0).unwrap();
        self.configure_transport();
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
    let descriptor = table + 16 * u64::from(index);
    bus.store64(descriptor, addr).unwrap();
    bus.store32(descriptor + 8, len).unwrap();
    bus.store16(descriptor + 12, flags).unwrap();
    bus.store16(descriptor + 14, next).unwrap();
}

fn pcm_payload(fill: i16) -> Vec<u8> {
    let mut out = Vec::with_capacity(PERIOD_BYTES as usize);
    for _ in 0..PERIOD_FRAMES * 2 {
        out.extend_from_slice(&fill.to_le_bytes());
    }
    out
}

#[test]
fn event_wire_is_stable_and_malformed_txq_reaches_a_later_valid_period() {
    let event = SndEvent::pcm_xrun(0);
    assert_eq!(event.event, VIRTIO_SND_EVT_PCM_XRUN);
    assert_eq!(event.to_bytes(), [0x11, 0x01, 0, 0, 0, 0, 0, 0]);
    assert_eq!(SndEvent::from_bytes(&event.to_bytes()), Some(event));

    let mut rig = Rig::new();
    rig.start();
    let mut sink = NullSink::new();
    let clock = ManualAudioClock::new();
    let truncated_status = rig.post_tx_shape(0, 2, &[], 8);
    let zero_pcm_status = rig.post_tx(0, &[], 8);
    let undersized_status = rig.post_tx(0, &pcm_payload(3), 4);
    let wrong_stream_status = rig.post_tx(1, &pcm_payload(4), 8);
    let valid_status = rig.post_tx(0, &pcm_payload(5), 8);
    rig.kick(TX_QUEUE);

    let report = rig.service(&clock, &mut sink);
    assert_eq!(report.completed, 4);
    assert_eq!(report.errors, 4);
    assert_eq!(report.queued, 1);
    assert_eq!(rig.used_idx(TX_USED), 4);
    assert_eq!(rig.used_elem(TX_USED, 0), (0, 8));
    assert_eq!(rig.used_elem(TX_USED, 1), (3, 8));
    assert_eq!(rig.used_elem(TX_USED, 2), (6, 0));
    assert_eq!(rig.used_elem(TX_USED, 3), (9, 8));
    assert_eq!(
        rig.read_status(truncated_status).status.code(),
        VIRTIO_SND_S_IO_ERR
    );
    assert_eq!(
        rig.read_status(zero_pcm_status).status.code(),
        VIRTIO_SND_S_IO_ERR
    );
    assert_eq!(rig.bus.load32(undersized_status), Ok(u32::MAX));
    assert_eq!(
        rig.read_status(wrong_stream_status).status.code(),
        VIRTIO_SND_S_IO_ERR
    );

    clock.advance_ns(PERIOD_NS);
    let report = rig.service(&clock, &mut sink);
    assert_eq!(report.completed, 1);
    assert_eq!(report.errors, 0);
    assert_eq!(rig.used_idx(TX_USED), 5);
    assert_eq!(rig.used_elem(TX_USED, 4), (12, 8));
    assert_eq!(rig.read_status(valid_status).status.code(), VIRTIO_SND_S_OK);
    assert_eq!(sink.frames_pushed(), PERIOD_FRAMES as u64);
    assert_eq!(rig.state.borrow().playback_pending_count(), 0);
}

#[test]
fn xrun_eventq_is_fifo_and_bounded_when_the_guest_stops_polling() {
    let mut rig = Rig::new();
    rig.start();
    let mut sink = NullSink::new();
    let clock = ManualAudioClock::new();
    assert_eq!(rig.service(&clock, &mut sink).xrun_events, 0);

    clock.set_now_ns(PERIOD_NS * 3 + 1);
    let report = rig.service(&clock, &mut sink);
    assert_eq!(report.xrun_events, 3);
    assert_eq!(rig.state.borrow().pending_event_count(), 3);

    clock.set_now_ns(u64::MAX - 1);
    let report = rig.service(&clock, &mut sink);
    assert_eq!(report.xrun_events, 256 - 3);
    assert_eq!(rig.state.borrow().pending_event_count(), 256);
    assert!(rig.state.borrow().dropped_xrun_events() > 0);

    for index in 0usize..16 {
        let address = rig.post_event_buffer(true, SND_EVENT_SIZE as u32);
        rig.bus.store64(address, u64::MAX).unwrap();
        assert_eq!(index, usize::from(rig.event_count - 1));
    }
    rig.kick(EVENT_QUEUE);
    let report = rig.service(&clock, &mut sink);
    assert_eq!(report.event_descriptors_completed, 16);
    assert_eq!(rig.used_idx(EVENT_USED), 16);
    assert_eq!(rig.state.borrow().pending_event_count(), 240);
    for index in 0usize..16 {
        let address = EVENT_BUF + 0x100 * index as u64;
        let mut bytes = [0u8; SND_EVENT_SIZE];
        for (offset, byte) in bytes.iter_mut().enumerate() {
            *byte = rig.bus.load8(address + offset as u64).unwrap();
        }
        assert_eq!(SndEvent::from_bytes(&bytes), Some(SndEvent::pcm_xrun(0)));
    }
}

#[test]
fn malformed_event_buffer_is_returned_without_consuming_the_event() {
    let mut rig = Rig::new();
    rig.start();
    let mut sink = NullSink::new();
    let clock = ManualAudioClock::new();
    assert_eq!(rig.service(&clock, &mut sink).xrun_events, 0);
    clock.set_now_ns(PERIOD_NS + 1);
    assert_eq!(rig.service(&clock, &mut sink).xrun_events, 1);
    assert_eq!(rig.state.borrow().pending_event_count(), 1);

    let short = rig.post_event_buffer(true, 4);
    let wrong_direction = rig.post_event_buffer(false, SND_EVENT_SIZE as u32);
    rig.kick(EVENT_QUEUE);
    let report = rig.service(&clock, &mut sink);
    assert_eq!(report.event_descriptors_completed, 2);
    assert_eq!(rig.used_elem(EVENT_USED, 0), (0, 0));
    assert_eq!(rig.used_elem(EVENT_USED, 1), (1, 0));
    assert_eq!(rig.state.borrow().pending_event_count(), 1);
    assert_eq!(rig.bus.load32(short), Ok(0));
    assert_eq!(rig.bus.load64(wrong_direction), Ok(0));

    let valid = rig.post_event_buffer(true, SND_EVENT_SIZE as u32);
    rig.kick(EVENT_QUEUE);
    let report = rig.service(&clock, &mut sink);
    assert_eq!(report.event_descriptors_completed, 1);
    assert_eq!(rig.state.borrow().pending_event_count(), 0);
    let mut bytes = [0u8; SND_EVENT_SIZE];
    for (offset, byte) in bytes.iter_mut().enumerate() {
        *byte = rig.bus.load8(valid + offset as u64).unwrap();
    }
    assert_eq!(SndEvent::from_bytes(&bytes), Some(SndEvent::pcm_xrun(0)));
}

#[test]
fn legacy_tx_only_service_does_not_replay_event_buffers() {
    let mut rig = Rig::new();
    rig.start();
    let mut sink = NullSink::new();
    let clock = ManualAudioClock::new();
    assert_eq!(
        snd::service(
            &rig.slot,
            &mut rig.txq,
            &rig.state,
            &clock,
            &mut sink,
            &mut rig.bus,
        )
        .xrun_events,
        0
    );
    clock.set_now_ns(PERIOD_NS + 1);
    assert_eq!(
        snd::service(
            &rig.slot,
            &mut rig.txq,
            &rig.state,
            &clock,
            &mut sink,
            &mut rig.bus,
        )
        .xrun_events,
        1
    );
    let event_buffer = rig.post_event_buffer(true, SND_EVENT_SIZE as u32);
    rig.kick(EVENT_QUEUE);
    let legacy_report = snd::service(
        &rig.slot,
        &mut rig.txq,
        &rig.state,
        &clock,
        &mut sink,
        &mut rig.bus,
    );
    assert_eq!(legacy_report.event_descriptors_completed, 0);
    assert_eq!(rig.used_idx(EVENT_USED), 0);
    assert_eq!(rig.state.borrow().pending_event_count(), 1);

    let report = rig.service(&clock, &mut sink);
    assert_eq!(report.event_descriptors_completed, 1);
    assert_eq!(rig.used_idx(EVENT_USED), 1);
    assert_eq!(rig.state.borrow().pending_event_count(), 0);
    let mut bytes = [0u8; SND_EVENT_SIZE];
    for (offset, byte) in bytes.iter_mut().enumerate() {
        *byte = rig.bus.load8(event_buffer + offset as u64).unwrap();
    }
    assert_eq!(SndEvent::from_bytes(&bytes), Some(SndEvent::pcm_xrun(0)));
}

#[test]
fn fifty_release_reset_re_setup_cycles_reclaim_pending_descriptors() {
    let mut rig = Rig::new();
    let mut sink = NullSink::new();
    let clock = ManualAudioClock::new();
    let payload = pcm_payload(7);
    for _cycle in 0..50 {
        rig.start();
        let status = rig.post_tx(0, &payload, 8);
        rig.kick(TX_QUEUE);
        assert_eq!(rig.service(&clock, &mut sink).queued, 1);
        assert_eq!(rig.state.borrow().playback_pending_count(), 1);
        assert_eq!(rig.command(VIRTIO_SND_R_PCM_STOP), VIRTIO_SND_S_OK);
        assert_eq!(rig.command(VIRTIO_SND_R_PCM_RELEASE), VIRTIO_SND_S_OK);
        let report = rig.service(&clock, &mut sink);
        assert_eq!(report.completed, 1);
        assert_eq!(report.errors, 1);
        assert_eq!(rig.read_status(status).status.code(), VIRTIO_SND_S_IO_ERR);
        assert_eq!(rig.state.borrow().playback_pending_count(), 0);
        assert_eq!(rig.state.borrow().stream.state(), PcmState::Released);

        rig.reset_and_re_setup();
        let report = rig.service(&clock, &mut sink);
        assert_eq!(report, snd::PlaybackReport::default());
        assert_eq!(rig.state.borrow().pending_event_count(), 0);
        assert_eq!(rig.state.borrow().playback_pending_count(), 0);
        assert_eq!(rig.used_idx(TX_USED), 0);
        assert_eq!(rig.used_idx(EVENT_USED), 0);
    }
}
