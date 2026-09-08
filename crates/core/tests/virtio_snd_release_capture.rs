//! E5-T19a: CONTROLQ RELEASE must retire pending capture I/O before its response.
//! The only capture source here is an injected deterministic ramp; no host device is opened.

use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
use wasm_vm_core::dev::virtio::queue::Virtqueue;
use wasm_vm_core::dev::virtio::snd::{self, AudioCaptureSource, PcmParams, PcmState};
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;

const QSIZE: u16 = 32;
const PERIOD_NS: u64 = 83_334; // Four stereo frames at 48 kHz, rounded up.
const NEXT: u16 = 1;
const WRITE: u16 = 2;
const SENTINEL: u64 = u64::MAX;

#[derive(Clone, Copy)]
struct Ring(u32);

impl Ring {
    fn desc(self) -> u64 {
        DRAM_BASE + 0x1_0000 + u64::from(self.0) * 0x1_0000
    }

    fn avail(self) -> u64 {
        self.desc() + 0x1000
    }

    fn used(self) -> u64 {
        self.desc() + 0x2000
    }

    fn descriptor(
        self,
        bus: &mut SystemBus,
        index: u16,
        addr: u64,
        len: u32,
        flags: u16,
        next: u16,
    ) {
        let entry = self.desc() + 16 * u64::from(index);
        bus.store64(entry, addr).unwrap();
        bus.store32(entry + 8, len).unwrap();
        bus.store16(entry + 12, flags).unwrap();
        bus.store16(entry + 14, next).unwrap();
    }

    fn assert_used(self, bus: &mut SystemBus, ordinal: u16, head: u16, len: u32) {
        let entry = self.used() + 4 + 8 * u64::from(ordinal % QSIZE);
        assert_eq!(bus.load32(entry), Ok(u32::from(head)));
        assert_eq!(bus.load32(entry + 4), Ok(len));
    }
}

const CONTROL: Ring = Ring(snd::CONTROL_QUEUE);
const RX: Ring = Ring(snd::RX_QUEUE);

struct Control {
    ordinal: u16,
    head: u16,
    response: u64,
}

#[derive(Clone, Copy)]
struct Rx {
    data: u64,
    status: u64,
}

#[derive(Default)]
struct RampSource {
    pulls: usize,
}

impl AudioCaptureSource for RampSource {
    fn pull(
        &mut self,
        frames: &mut [i16],
        sample_rate_hz: u32,
        channels: u8,
    ) -> Result<usize, snd::AudioCaptureError> {
        assert_eq!(sample_rate_hz, 48_000);
        assert_eq!(channels, 2);
        assert_eq!(frames.len(), 8);
        self.pulls += 1;
        for (index, sample) in frames.iter_mut().enumerate() {
            *sample = -123 + index as i16;
        }
        Ok(4)
    }
}

struct Rig {
    slot: Rc<RefCell<VirtioMmio>>,
    state: Rc<RefCell<snd::SndState>>,
    controlq: Option<Virtqueue>,
    eventq: Option<Virtqueue>,
    txq: Option<Virtqueue>,
    rxq: Option<Virtqueue>,
    bus: SystemBus,
    clock: snd::ManualAudioClock,
    control_count: u16,
    rx_count: u16,
}

impl Rig {
    fn new(capture_enabled: bool) -> Self {
        let (device, state) = snd::VirtioSnd::new_with_capture(capture_enabled);
        let mut rig = Self {
            slot: Rc::new(RefCell::new(VirtioMmio::new(Box::new(device)))),
            state,
            controlq: None,
            eventq: None,
            txq: None,
            rxq: None,
            bus: SystemBus::new(Ram::new(4 * 1024 * 1024).unwrap()),
            clock: snd::ManualAudioClock::new(),
            control_count: 0,
            rx_count: 0,
        };
        rig.write_mmio(0x070, 1);
        rig.write_mmio(0x070, 3);
        for ring in [CONTROL, RX] {
            rig.write_mmio(0x030, ring.0);
            rig.write_mmio(0x038, u32::from(QSIZE));
            rig.write_mmio(0x080, ring.desc() as u32);
            rig.write_mmio(0x090, ring.avail() as u32);
            rig.write_mmio(0x0a0, ring.used() as u32);
            rig.write_mmio(0x044, 1);
        }
        rig.write_mmio(0x070, 15);
        rig
    }

    fn write_mmio(&mut self, offset: u64, value: u32) {
        self.slot
            .borrow_mut()
            .write(offset, Width::B4, u64::from(value))
            .unwrap();
    }

    fn read_mmio(&mut self, offset: u64) -> u64 {
        self.slot.borrow_mut().read(offset, Width::B4).unwrap()
    }

    fn post(&mut self, ring: Ring, ordinal: u16, head: u16) {
        self.bus
            .store16(ring.avail() + 4 + 2 * u64::from(ordinal % QSIZE), head)
            .unwrap();
        self.bus.store16(ring.avail() + 2, ordinal + 1).unwrap();
        self.write_mmio(0x050, ring.0);
    }

    fn post_control(&mut self, bytes: &[u8], alias: Option<u64>) -> Control {
        let ordinal = self.control_count;
        let head = (ordinal % (QSIZE / 2)) * 2;
        let data = DRAM_BASE + 0x10_0000 + u64::from(ordinal) * 0x100;
        self.bus.ram_mut().write_slice(data, bytes).unwrap();
        let response = alias.unwrap_or(data + 0x80);
        if alias.is_none() {
            self.bus.store64(response, SENTINEL).unwrap();
        }
        CONTROL.descriptor(
            &mut self.bus,
            head,
            data,
            bytes.len() as u32,
            NEXT,
            head + 1,
        );
        CONTROL.descriptor(&mut self.bus, head + 1, response, 4, WRITE, 0);
        self.post(CONTROL, ordinal, head);
        self.control_count += 1;
        Control {
            ordinal,
            head,
            response,
        }
    }

    fn assert_control(&mut self, request: &Control, status: u32) {
        CONTROL.assert_used(&mut self.bus, request.ordinal, request.head, 4);
        assert_eq!(self.bus.load32(request.response), Ok(status));
    }

    fn control(&mut self, bytes: &[u8], expected: u32) {
        let request = self.post_control(bytes, None);
        self.service(true, None);
        assert_eq!(self.bus.load16(CONTROL.used() + 2), Ok(self.control_count));
        self.assert_control(&request, expected);
    }

    fn command(&mut self, code: u32, stream: u32) {
        self.control(&command(code, stream), snd::VIRTIO_SND_S_OK);
    }

    fn post_rx(&mut self) -> Rx {
        let ordinal = self.rx_count;
        let head = ordinal * 3;
        let header = DRAM_BASE + 0x20_0000 + u64::from(ordinal) * 0x100;
        let data = header + 0x20;
        let status = header + 0x40;
        self.bus.store32(header, snd::CAPTURE_STREAM_ID).unwrap();
        self.bus.ram_mut().write_slice(data, &[0x5a; 16]).unwrap();
        self.bus.store64(status, SENTINEL).unwrap();
        RX.descriptor(&mut self.bus, head, header, 4, NEXT, head + 1);
        RX.descriptor(&mut self.bus, head + 1, data, 16, WRITE | NEXT, head + 2);
        RX.descriptor(&mut self.bus, head + 2, status, 8, WRITE, 0);
        self.post(RX, ordinal, head);
        self.rx_count += 1;
        Rx { data, status }
    }

    fn service(&mut self, include_rx: bool, source: Option<&mut dyn AudioCaptureSource>) {
        snd::service_with_control_eventq_and_capture(
            &self.slot,
            &mut self.controlq,
            &mut self.eventq,
            include_rx.then_some(&mut self.rxq),
            source,
            &mut self.txq,
            &self.state,
            &self.clock,
            &mut snd::NullSink::new(),
            &mut self.bus,
        );
    }

    fn pending_capture(&mut self, source: &mut RampSource) -> [Rx; 2] {
        self.control(&params().to_bytes(), snd::VIRTIO_SND_S_OK);
        self.command(snd::VIRTIO_SND_R_PCM_PREPARE, 1);
        self.command(snd::VIRTIO_SND_R_PCM_START, 1);
        let buffers = [self.post_rx(), self.post_rx()];
        self.service(true, Some(source));
        assert_eq!(self.state.borrow().capture_pending_count(), 2);
        assert_eq!(self.bus.load16(RX.used() + 2), Ok(0));
        assert_eq!(source.pulls, 0);
        self.command(snd::VIRTIO_SND_R_PCM_STOP, 1);
        buffers
    }

    fn assert_untouched_pcm(&mut self, buffer: Rx) {
        for offset in 0..16 {
            assert_eq!(self.bus.load8(buffer.data + offset), Ok(0x5a));
        }
    }
}

fn params() -> PcmParams {
    PcmParams {
        stream_id: 1,
        period_bytes: 16,
        buffer_bytes: 64,
        ..PcmParams::default()
    }
}

fn command(code: u32, stream: u32) -> [u8; 8] {
    let mut bytes = [0; 8];
    bytes[..4].copy_from_slice(&code.to_le_bytes());
    bytes[4..].copy_from_slice(&stream.to_le_bytes());
    bytes
}

fn release_order(source_at_release: bool) {
    let mut rig = Rig::new(true);
    let mut source = RampSource::default();
    let [first, second] = rig.pending_capture(&mut source);
    // RX writes IO_ERR; RELEASE writes OK to the same address. Reversed ordering leaves IO_ERR.
    // The second, unaliased RX status independently proves the aborted transfer's wire result.
    let release = rig.post_control(
        &command(snd::VIRTIO_SND_R_PCM_RELEASE, 1),
        Some(first.status),
    );
    let prepare = rig.post_control(&command(snd::VIRTIO_SND_R_PCM_PREPARE, 1), None);
    rig.clock.advance_ns(8 * PERIOD_NS);
    rig.service(
        true,
        source_at_release.then_some(&mut source as &mut dyn AudioCaptureSource),
    );
    assert_eq!(rig.bus.load16(CONTROL.used() + 2), Ok(rig.control_count));
    rig.assert_control(&release, snd::VIRTIO_SND_S_OK);
    rig.assert_control(&prepare, snd::VIRTIO_SND_S_OK);
    assert_eq!(rig.bus.load16(RX.used() + 2), Ok(2));
    RX.assert_used(&mut rig.bus, 0, 0, 8);
    RX.assert_used(&mut rig.bus, 1, 3, 8);
    assert_eq!(rig.bus.load32(first.status + 4), Ok(16));
    assert_eq!(
        rig.bus.load64(second.status),
        Ok(u64::from(snd::VIRTIO_SND_S_IO_ERR))
    );
    rig.assert_untouched_pcm(first);
    rig.assert_untouched_pcm(second);
    assert_eq!(
        source.pulls, 0,
        "RELEASE must not pull even overdue capture PCM"
    );
    assert_eq!(rig.state.borrow().capture_pending_count(), 0);
    assert_eq!(
        rig.state.borrow().capture_stream_state(),
        PcmState::Prepared
    );
    assert_eq!(rig.state.borrow().capture_stream_params(), Some(params()));
    assert_eq!(rig.read_mmio(0x070), 15);
    assert_eq!(
        rig.read_mmio(0x060) & 1,
        1,
        "queue completions signal a used interrupt"
    );

    // No SET_PARAMS after RELEASE: START and a fresh RX buffer must still produce exact PCM.
    rig.command(snd::VIRTIO_SND_R_PCM_START, 1);
    let fresh = rig.post_rx();
    rig.service(true, Some(&mut source));
    assert_eq!(source.pulls, 0);
    rig.clock.advance_ns(PERIOD_NS);
    rig.service(true, Some(&mut source));
    assert_eq!(rig.bus.load16(RX.used() + 2), Ok(3));
    RX.assert_used(&mut rig.bus, 2, 6, 24);
    assert_eq!(
        rig.bus.load64(fresh.status),
        Ok(u64::from(snd::VIRTIO_SND_S_OK))
    );
    for (index, sample) in (-123i16..-115).enumerate() {
        assert_eq!(
            rig.bus.load16(fresh.data + 2 * index as u64),
            Ok(sample as u16)
        );
    }
    rig.service(true, Some(&mut source));
    assert_eq!(source.pulls, 1);
    assert_eq!(
        rig.bus.load16(RX.used() + 2),
        Ok(3),
        "no duplicate completion"
    );
}

#[test]
fn capture_release_completes_rx_before_control_response_and_following_prepare() {
    release_order(true);
}

#[test]
fn pending_capture_release_needs_no_source_and_reprepare_remains_usable() {
    release_order(false);
}

#[test]
fn disabled_capture_release_rejects_input_without_touching_source_or_rx() {
    let mut rig = Rig::new(false);
    assert_eq!(
        rig.read_mmio(0x104),
        1,
        "only the output stream is advertised"
    );
    let mut source = RampSource::default();
    let buffer = rig.post_rx();
    rig.control(&params().to_bytes(), snd::VIRTIO_SND_S_BAD_MSG);
    for code in [
        snd::VIRTIO_SND_R_PCM_PREPARE,
        snd::VIRTIO_SND_R_PCM_START,
        snd::VIRTIO_SND_R_PCM_RELEASE,
    ] {
        rig.control(&command(code, 1), snd::VIRTIO_SND_S_BAD_MSG);
    }
    rig.clock.advance_ns(8 * PERIOD_NS);
    rig.service(true, Some(&mut source));
    assert_eq!(source.pulls, 0);
    assert_eq!(rig.bus.load16(RX.used() + 2), Ok(0));
    assert_eq!(rig.bus.load64(buffer.status), Ok(SENTINEL));
    rig.assert_untouched_pcm(buffer);
    assert_eq!(rig.state.borrow().capture_stream_params(), None);
    assert!(!rig.state.borrow().capture_enabled());
    // The output-only caller supplies neither RX queue nor source. Its empty RELEASE stays legal.
    rig.control(&PcmParams::default().to_bytes(), snd::VIRTIO_SND_S_OK);
    rig.command(snd::VIRTIO_SND_R_PCM_PREPARE, 0);
    let release = rig.post_control(&command(snd::VIRTIO_SND_R_PCM_RELEASE, 0), None);
    let prepare = rig.post_control(&command(snd::VIRTIO_SND_R_PCM_PREPARE, 0), None);
    rig.service(false, None);
    rig.assert_control(&release, snd::VIRTIO_SND_S_OK);
    rig.assert_control(&prepare, snd::VIRTIO_SND_S_OK);
    assert_eq!(rig.read_mmio(0x070), 15);
}

#[test]
fn pending_capture_release_without_a_usable_rx_queue_requests_reset_without_response() {
    for missing_queue in [true, false] {
        let mut rig = Rig::new(true);
        let mut source = RampSource::default();
        let buffers = rig.pending_capture(&mut source);
        let used_before = rig.bus.load16(CONTROL.used() + 2).unwrap();
        let release = rig.post_control(&command(snd::VIRTIO_SND_R_PCM_RELEASE, 1), None);
        let prepare = rig.post_control(&command(snd::VIRTIO_SND_R_PCM_PREPARE, 1), None);
        if !missing_queue {
            rig.write_mmio(0x030, snd::RX_QUEUE);
            rig.write_mmio(0x044, 0);
        }
        rig.clock.advance_ns(8 * PERIOD_NS);
        rig.service(!missing_queue, Some(&mut source));
        assert_eq!(
            rig.read_mmio(0x070) & 64,
            64,
            "NEEDS_RESET, missing_queue={missing_queue}"
        );
        assert_eq!(rig.read_mmio(0x060) & 2, 2, "config-change interrupt");
        assert!(rig.controlq.is_none());
        assert_eq!(rig.bus.load16(CONTROL.used() + 2), Ok(used_before));
        assert_eq!(rig.bus.load64(release.response), Ok(SENTINEL));
        assert_eq!(rig.bus.load64(prepare.response), Ok(SENTINEL));
        assert_eq!(rig.bus.load16(RX.used() + 2), Ok(0));
        for buffer in buffers {
            assert_eq!(rig.bus.load64(buffer.status), Ok(SENTINEL));
            rig.assert_untouched_pcm(buffer);
        }
        assert_eq!(source.pulls, 0);
    }
}
