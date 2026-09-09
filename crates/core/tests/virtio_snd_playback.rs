//! E5-T19b: clock-paced virtio-snd output, used-ring completion, and native sink fixtures.

#![cfg(feature = "std")]

use std::cell::RefCell;
use std::fs;
use std::rc::Rc;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
use wasm_vm_core::dev::virtio::snd::{
    self, AudioSink, ManualAudioClock, NullSink, PcmParams, PcmState, PcmStatus, PcmXfer, TX_QUEUE,
    VIRTIO_SND_R_PCM_PREPARE, VIRTIO_SND_R_PCM_START, VIRTIO_SND_R_PCM_STOP, VIRTIO_SND_S_OK,
    WavSink,
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
const DESC: u64 = DRAM_BASE + 0x10_0000;
const AVAIL: u64 = DRAM_BASE + 0x11_0000;
const USED: u64 = DRAM_BASE + 0x12_0000;
const DATA: u64 = DRAM_BASE + 0x20_0000;
const DATA_STRIDE: u64 = 0x2000;
const PERIOD_FRAMES: usize = 1024;
const PERIOD_SAMPLES: usize = PERIOD_FRAMES * 2;
const PERIOD_NS: u64 = 21_333_334;

struct Ring {
    sequence: u16,
}

impl Ring {
    fn new() -> Self {
        Self { sequence: 0 }
    }

    fn used_idx(&self, bus: &mut SystemBus) -> u16 {
        bus.load16(USED + 2).unwrap()
    }

    fn used_elem(&self, bus: &mut SystemBus, index: u16) -> (u32, u32) {
        let element = USED + 4 + 8 * u64::from(index % QUEUE_SIZE);
        (
            bus.load32(element).unwrap(),
            bus.load32(element + 4).unwrap(),
        )
    }
}

struct Rig {
    slot: Rc<RefCell<VirtioMmio>>,
    state: Rc<RefCell<snd::SndState>>,
    tx_vq: Option<wasm_vm_core::dev::virtio::queue::Virtqueue>,
    bus: SystemBus,
    ring: Ring,
}

impl Rig {
    fn new() -> Self {
        let (device, state) = snd::new();
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
        let mut rig = Self {
            slot,
            state,
            tx_vq: None,
            bus: SystemBus::new(Ram::new(RAM_BYTES).unwrap()),
            ring: Ring::new(),
        };
        rig.configure_transport();
        rig
    }

    fn configure_transport(&mut self) {
        let write = |slot: &Rc<RefCell<VirtioMmio>>, offset: u64, value: u32| {
            slot.borrow_mut()
                .write(offset, Width::B4, u64::from(value))
                .unwrap();
        };
        write(&self.slot, STATUS, 1);
        write(&self.slot, STATUS, 3);
        write(&self.slot, QUEUE_SEL, TX_QUEUE);
        write(&self.slot, QUEUE_NUM, u32::from(QUEUE_SIZE));
        write(&self.slot, QUEUE_DESC_LOW, DESC as u32);
        write(&self.slot, QUEUE_DRIVER_LOW, AVAIL as u32);
        write(&self.slot, QUEUE_DEVICE_LOW, USED as u32);
        write(&self.slot, QUEUE_READY, 1);
        write(&self.slot, STATUS, 15);
    }

    fn control(&mut self, bytes: &[u8]) -> u32 {
        let response = self.state.borrow_mut().handle_control(bytes);
        u32::from_le_bytes(response[..4].try_into().unwrap())
    }

    fn start(&mut self) {
        assert_eq!(
            self.control(&PcmParams::default().to_bytes()),
            VIRTIO_SND_S_OK
        );
        assert_eq!(
            self.control(&pcm_command(VIRTIO_SND_R_PCM_PREPARE)),
            VIRTIO_SND_S_OK
        );
        assert_eq!(
            self.control(&pcm_command(VIRTIO_SND_R_PCM_START)),
            VIRTIO_SND_S_OK
        );
        assert_eq!(self.state.borrow().stream.state(), PcmState::Running);
    }

    fn stop(&mut self) {
        assert_eq!(
            self.control(&pcm_command(VIRTIO_SND_R_PCM_STOP)),
            VIRTIO_SND_S_OK
        );
        assert_eq!(self.state.borrow().stream.state(), PcmState::Stopped);
    }

    fn post(&mut self, samples: &[i16]) -> u64 {
        self.post_stream(0, samples)
    }

    fn post_stream(&mut self, stream_id: u32, samples: &[i16]) -> u64 {
        assert!(samples.len().is_multiple_of(2));
        let sequence = self.ring.sequence;
        let head = (sequence % 5) * 3;
        let base = DATA + DATA_STRIDE * u64::from(sequence);
        let pcm = base + 4;
        let status = base + 0x1200;
        for (index, byte) in (PcmXfer { stream_id }).to_bytes().iter().enumerate() {
            self.bus.store8(base + index as u64, *byte).unwrap();
        }
        for (index, sample) in samples.iter().enumerate() {
            self.bus
                .store16(pcm + 2 * index as u64, *sample as u16)
                .unwrap();
        }
        self.bus.store64(status, u64::MAX).unwrap();
        write_desc(&mut self.bus, head, base, 4, F_NEXT, head + 1);
        write_desc(
            &mut self.bus,
            head + 1,
            pcm,
            (samples.len() * 2) as u32,
            F_NEXT,
            head + 2,
        );
        write_desc(&mut self.bus, head + 2, status, 8, F_WRITE, 0);
        let avail_slot = AVAIL + 4 + 2 * u64::from(sequence % QUEUE_SIZE);
        self.bus.store16(avail_slot, head).unwrap();
        self.ring.sequence = sequence.wrapping_add(1);
        self.bus.store16(AVAIL + 2, self.ring.sequence).unwrap();
        status
    }

    fn service(
        &mut self,
        clock: &ManualAudioClock,
        sink: &mut dyn AudioSink,
    ) -> snd::PlaybackReport {
        self.slot
            .borrow_mut()
            .write(QUEUE_NOTIFY, Width::B4, u64::from(TX_QUEUE))
            .unwrap();
        snd::service(
            &self.slot,
            &mut self.tx_vq,
            &self.state,
            clock,
            sink,
            &mut self.bus,
        )
    }

    fn service_without_kick(
        &mut self,
        clock: &ManualAudioClock,
        sink: &mut dyn AudioSink,
    ) -> snd::PlaybackReport {
        snd::service(
            &self.slot,
            &mut self.tx_vq,
            &self.state,
            clock,
            sink,
            &mut self.bus,
        )
    }

    fn status(&mut self, address: u64) -> PcmStatus {
        let mut bytes = [0u8; 8];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = self.bus.load8(address + index as u64).unwrap();
        }
        PcmStatus::from_bytes(&bytes).unwrap()
    }
}

const F_NEXT: u16 = 1;
const F_WRITE: u16 = 2;

fn write_desc(bus: &mut SystemBus, index: u16, addr: u64, len: u32, flags: u16, next: u16) {
    let descriptor = DESC + 16 * u64::from(index);
    bus.store64(descriptor, addr).unwrap();
    bus.store32(descriptor + 8, len).unwrap();
    bus.store16(descriptor + 12, flags).unwrap();
    bus.store16(descriptor + 14, next).unwrap();
}

fn pcm_command(code: u32) -> [u8; 8] {
    let mut bytes = [0u8; 8];
    bytes[..4].copy_from_slice(&code.to_le_bytes());
    bytes
}

fn prepare_scratch_path(path: &str) {
    fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
}

fn ramp(start: i16) -> Vec<i16> {
    (0..PERIOD_SAMPLES)
        .map(|index| start.saturating_add(index as i16))
        .collect()
}

fn run_scale(step_ns: u64) -> Vec<u32> {
    let mut rig = Rig::new();
    rig.start();
    let mut sink = NullSink::new();
    let clock = ManualAudioClock::new();
    for offset in 0..3 {
        rig.post(&ramp((offset * PERIOD_SAMPLES) as i16));
    }
    let initial = rig.service(&clock, &mut sink);
    assert_eq!(initial.queued, 3);
    assert_eq!(initial.completed, 0);

    let mut completion_ticks = Vec::new();
    for _tick in 1..=6 {
        clock.advance_ns(step_ns);
        let report = rig.service_without_kick(&clock, &mut sink);
        if report.completed != 0 {
            completion_ticks.push(report.completed);
        }
    }
    assert_eq!(sink.frames_pushed(), 3 * PERIOD_FRAMES as u64);
    completion_ticks
}

#[test]
fn arrival_alone_never_completes_an_unripe_period() {
    let mut rig = Rig::new();
    rig.start();
    let mut sink = NullSink::new();
    let clock = ManualAudioClock::new();
    let status_address = rig.post(&ramp(0));

    let report = rig.service(&clock, &mut sink);
    assert_eq!(report.queued, 1);
    assert_eq!(report.completed, 0);
    assert_eq!(report.pending_bytes, 4096);
    assert_eq!(rig.ring.used_idx(&mut rig.bus), 0);
    assert_eq!(sink.frames_pushed(), 0);

    clock.advance_ns(PERIOD_NS - 1);
    assert_eq!(rig.service_without_kick(&clock, &mut sink).completed, 0);
    assert_eq!(rig.ring.used_idx(&mut rig.bus), 0);

    clock.advance_ns(1);
    let report = rig.service_without_kick(&clock, &mut sink);
    assert_eq!(report.completed, 1);
    assert_eq!(report.frames_pushed, PERIOD_FRAMES as u64);
    assert_eq!(report.latency_bytes, 0);
    assert_eq!(rig.ring.used_idx(&mut rig.bus), 1);
    assert_eq!(rig.ring.used_elem(&mut rig.bus, 0), (0, 8));
    assert_eq!(rig.status(status_address).status.code(), VIRTIO_SND_S_OK);
    assert_eq!(sink.frames_pushed(), PERIOD_FRAMES as u64);
}

#[test]
fn half_real_and_double_real_clock_scales_change_completion_rate_without_changing_audio() {
    assert_eq!(run_scale(PERIOD_NS / 2), vec![1, 1, 1]);
    assert_eq!(run_scale(PERIOD_NS), vec![1, 1, 1]);
    assert_eq!(run_scale(PERIOD_NS * 2), vec![2, 1]);
}

#[test]
fn wrong_stream_id_is_completed_with_io_error_without_reaching_the_sink() {
    let mut rig = Rig::new();
    rig.start();
    let mut sink = NullSink::new();
    let clock = ManualAudioClock::new();
    let status_address = rig.post_stream(1, &ramp(0));

    let report = rig.service(&clock, &mut sink);
    assert_eq!(report.queued, 0);
    assert_eq!(report.completed, 1);
    assert_eq!(report.errors, 1);
    assert_eq!(rig.ring.used_idx(&mut rig.bus), 1);
    assert_eq!(rig.status(status_address).status, snd::SndStatus::IoErr);
    assert_eq!(rig.status(status_address).latency_bytes, 0);
    assert_eq!(sink.frames_pushed(), 0);
}

struct FailingSink;

impl AudioSink for FailingSink {
    fn push(&mut self, _frames: &[i16], _sample_rate_hz: u32) -> Result<(), snd::AudioSinkError> {
        Err(snd::AudioSinkError::Failed)
    }
}

#[test]
fn sink_failure_completes_the_period_with_io_error_and_no_reported_frames() {
    let mut rig = Rig::new();
    rig.start();
    let mut sink = FailingSink;
    let clock = ManualAudioClock::new();
    let status_address = rig.post(&ramp(0));
    assert_eq!(rig.service(&clock, &mut sink).completed, 0);

    clock.advance_ns(PERIOD_NS);
    let report = rig.service_without_kick(&clock, &mut sink);
    assert_eq!(report.completed, 1);
    assert_eq!(report.errors, 1);
    assert_eq!(report.frames_pushed, 0);
    assert_eq!(rig.status(status_address).status, snd::SndStatus::IoErr);
}

#[test]
fn stop_start_resumes_pending_ramp_once_and_wav_sink_is_bit_exact() {
    let path = "target/e5-t19b-ramp.wav";
    prepare_scratch_path(path);
    let _ = fs::remove_file(path);
    let mut sink = WavSink::create(path, 48_000).unwrap();
    let mut rig = Rig::new();
    rig.start();
    let clock = ManualAudioClock::new();
    let first = ramp(0);
    let second = ramp(PERIOD_SAMPLES as i16);
    rig.post(&first);
    rig.post(&second);
    assert_eq!(rig.service(&clock, &mut sink).completed, 0);

    rig.stop();
    assert_eq!(rig.service_without_kick(&clock, &mut sink).completed, 0);
    assert_eq!(rig.state.borrow().playback_pending_count(), 2);
    assert_eq!(
        rig.control(&pcm_command(VIRTIO_SND_R_PCM_START)),
        VIRTIO_SND_S_OK
    );
    assert_eq!(rig.service_without_kick(&clock, &mut sink).completed, 0);

    clock.advance_ns(PERIOD_NS);
    assert_eq!(rig.service_without_kick(&clock, &mut sink).completed, 1);
    clock.advance_ns(PERIOD_NS);
    assert_eq!(rig.service_without_kick(&clock, &mut sink).completed, 1);
    assert_eq!(rig.ring.used_idx(&mut rig.bus), 2);
    assert_eq!(rig.ring.used_elem(&mut rig.bus, 0), (0, 8));
    assert_eq!(rig.ring.used_elem(&mut rig.bus, 1), (3, 8));

    sink.finish().unwrap();
    let wav = fs::read(path).unwrap();
    let mut expected_pcm = Vec::new();
    for sample in first.iter().chain(second.iter()) {
        expected_pcm.extend_from_slice(&sample.to_le_bytes());
    }
    assert_eq!(&wav[0..4], b"RIFF");
    assert_eq!(
        u32::from_le_bytes(wav[4..8].try_into().unwrap()),
        (36 + expected_pcm.len()) as u32
    );
    assert_eq!(&wav[8..12], b"WAVE");
    assert_eq!(&wav[36..40], b"data");
    assert_eq!(
        u32::from_le_bytes(wav[40..44].try_into().unwrap()),
        expected_pcm.len() as u32
    );
    assert_eq!(&wav[44..], &expected_pcm);
    let _ = fs::remove_file(path);
}

#[test]
fn release_flushes_pending_periods_with_error_status_without_sending_audio() {
    let mut rig = Rig::new();
    rig.start();
    let mut sink = NullSink::new();
    let clock = ManualAudioClock::new();
    let status_address = rig.post(&ramp(0));
    assert_eq!(rig.service(&clock, &mut sink).completed, 0);
    rig.stop();
    assert_eq!(
        rig.control(&pcm_command(
            wasm_vm_core::dev::virtio::snd::VIRTIO_SND_R_PCM_RELEASE
        )),
        VIRTIO_SND_S_OK
    );
    let report = rig.service_without_kick(&clock, &mut sink);
    assert_eq!(report.completed, 1);
    assert_eq!(report.errors, 1);
    assert_eq!(report.pending_bytes, 0);
    assert_eq!(rig.status(status_address).status, snd::SndStatus::IoErr);
    assert_eq!(sink.frames_pushed(), 0);
}

#[test]
fn eight_second_440hz_sine_capture_has_expected_peak_and_clean_period_joins() {
    let path = "target/e5-t19b-sine.wav";
    prepare_scratch_path(path);
    let _ = fs::remove_file(path);
    let mut sink = WavSink::create(path, 48_000).unwrap();
    let mut rig = Rig::new();
    rig.start();
    let clock = ManualAudioClock::new();
    let total_frames = 8 * 48_000;
    let mut expected = Vec::with_capacity(total_frames * 2);
    let mut previous = 0i16;
    for frame_start in (0..total_frames).step_by(PERIOD_FRAMES) {
        let mut period = Vec::with_capacity(PERIOD_SAMPLES);
        for frame in frame_start..frame_start + PERIOD_FRAMES {
            let sample = (12_000.0
                * (2.0 * std::f64::consts::PI * 440.0 * frame as f64 / 48_000.0).sin())
            .round() as i16;
            period.extend([sample, sample]);
            expected.extend([sample, sample]);
        }
        if frame_start != 0 {
            assert!((i32::from(period[0]) - i32::from(previous)).abs() <= 1_000);
        }
        previous = period[PERIOD_SAMPLES - 2];
        rig.post(&period);
        assert_eq!(rig.service(&clock, &mut sink).completed, 0);
        clock.advance_ns(PERIOD_NS);
        let report = rig.service_without_kick(&clock, &mut sink);
        assert_eq!(report.completed, 1);
        assert_eq!(report.latency_bytes, 0);
    }
    assert_eq!(sink.data_bytes(), (expected.len() * 2) as u64);
    sink.finish().unwrap();
    let wav = fs::read(path).unwrap();
    let actual = &wav[44..];
    let mut actual_samples = Vec::with_capacity(expected.len());
    for bytes in actual.chunks_exact(2) {
        actual_samples.push(i16::from_le_bytes([bytes[0], bytes[1]]));
    }
    assert_eq!(actual_samples, expected);

    let frames = actual_samples.len() / 2;
    let bin_width = 48_000.0 / frames as f64;
    let center = (440.0 / bin_width).round() as i32;
    let mut best = (0.0f64, 0i32);
    for bin in (center - 8)..=(center + 8) {
        let frequency = bin as f64 * bin_width;
        let omega = 2.0 * std::f64::consts::PI * frequency / 48_000.0;
        let (sin_omega, cos_omega) = omega.sin_cos();
        let mut real = 0.0;
        let mut imag = 0.0;
        let mut sin_phase = 0.0;
        let mut cos_phase = 1.0;
        for frame in 0..frames {
            let sample = actual_samples[frame * 2] as f64;
            real += sample * cos_phase;
            imag -= sample * sin_phase;
            let next_cos = cos_phase * cos_omega - sin_phase * sin_omega;
            sin_phase = sin_phase * cos_omega + cos_phase * sin_omega;
            cos_phase = next_cos;
        }
        let power = real * real + imag * imag;
        if power > best.0 {
            best = (power, bin);
        }
    }
    let peak_hz = best.1 as f64 * bin_width;
    assert!((peak_hz - 440.0).abs() <= 1.0, "peak={peak_hz}Hz");
    for boundary in (PERIOD_FRAMES..frames).step_by(PERIOD_FRAMES) {
        assert!(
            (i32::from(actual_samples[boundary * 2]) - i32::from(expected[boundary * 2])).abs()
                <= 1
        );
    }
    let _ = fs::remove_file(path);
}
