use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
use wasm_vm_core::dev::virtio::snd::{
    self, AudioSink, CAPTURE_STREAM_ID, ManualAudioClock, NullSink, PcmParams, PcmState, PcmStatus,
    PcmXfer, SndState, TX_QUEUE, VIRTIO_SND_PCM_FMT_S16, VIRTIO_SND_PCM_RATE_44100,
    VIRTIO_SND_PCM_RATE_48000, VIRTIO_SND_R_PCM_PREPARE, VIRTIO_SND_R_PCM_START,
    VIRTIO_SND_R_PCM_STOP, VIRTIO_SND_S_OK,
};
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;

const HEADER_LEN: usize = 184;
const OUTPUT_STATE: usize = 48;
const OUTPUT_HAS_PARAMS: usize = 49;
const OUTPUT_PARAMS: usize = 52;
const OUTPUT_STREAM_ID: usize = OUTPUT_PARAMS + 4;
const OUTPUT_BUFFER_BYTES: usize = OUTPUT_PARAMS + 8;
const OUTPUT_PERIOD_BYTES: usize = OUTPUT_PARAMS + 12;
const OUTPUT_FEATURES: usize = OUTPUT_PARAMS + 16;
const OUTPUT_CHANNELS: usize = OUTPUT_PARAMS + 20;
const OUTPUT_FORMAT: usize = OUTPUT_PARAMS + 21;
const OUTPUT_RATE: usize = OUTPUT_PARAMS + 22;
const OUTPUT_PADDING: usize = OUTPUT_PARAMS + 23;
const CAPTURE_STATE: usize = 76;
const CAPTURE_STREAM_ID_OFFSET: usize = 84;
const CAPTURE_FORMAT: usize = 101;
const CAPTURE_RATE: usize = 102;
const PLAYBACK_COUNT: usize = 104;
const PLAYBACK_BYTES: usize = 108;
const PLAYBACK_NEXT_PRESENT: usize = 124;
const PLAYBACK_NEXT_NS: usize = 128;
const CAPTURE_COUNT: usize = 144;
const CAPTURE_BYTES: usize = 148;
const EVENT_COUNT: usize = 164;
const RESET_PENDING: usize = 180;
const MAX_PENDING_EVENTS: usize = 256;
const MAX_PENDING_TRANSFERS: u32 = 4096;
const MAX_PCM_BUFFER_BYTES: u32 = 16 * 1024 * 1024;

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
const F_NEXT: u16 = 1;
const F_WRITE: u16 = 2;

fn status(response: &[u8]) -> u32 {
    u32::from_le_bytes(response[..4].try_into().unwrap())
}

fn lifecycle_request(code: u32, stream_id: u32) -> [u8; 8] {
    let mut request = [0; 8];
    request[..4].copy_from_slice(&code.to_le_bytes());
    request[4..].copy_from_slice(&stream_id.to_le_bytes());
    request
}

fn params(stream_id: u32, rate: u8) -> PcmParams {
    PcmParams {
        stream_id,
        channels: if stream_id == CAPTURE_STREAM_ID { 1 } else { 2 },
        rate,
        ..PcmParams::default()
    }
}

fn configure(state: &mut SndState, stream_id: u32, rate: u8, target: PcmState) {
    assert_eq!(
        status(&state.handle_control(&params(stream_id, rate).to_bytes())),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(&state.handle_control(&lifecycle_request(VIRTIO_SND_R_PCM_PREPARE, stream_id,))),
        VIRTIO_SND_S_OK
    );
    if matches!(target, PcmState::Running | PcmState::Stopped) {
        assert_eq!(
            status(&state.handle_control(&lifecycle_request(VIRTIO_SND_R_PCM_START, stream_id,))),
            VIRTIO_SND_S_OK
        );
    }
    if target == PcmState::Stopped {
        assert_eq!(
            status(&state.handle_control(&lifecycle_request(VIRTIO_SND_R_PCM_STOP, stream_id,))),
            VIRTIO_SND_S_OK
        );
    }
}

fn distinctive_atomic_target() -> SndState {
    let mut target = SndState::new();
    assert!(target.set_output_sample_rate(44_100));
    target.set_capture_enabled(true);
    configure(
        &mut target,
        0,
        VIRTIO_SND_PCM_RATE_44100,
        PcmState::Prepared,
    );
    configure(
        &mut target,
        CAPTURE_STREAM_ID,
        VIRTIO_SND_PCM_RATE_48000,
        PcmState::Prepared,
    );
    target
}

fn assert_atomic_refusal(label: &str, payload: &[u8], expected_code: u16) -> bool {
    let mut target = distinctive_atomic_target();
    let before = target.to_snapshot().unwrap();
    match target.restore_snapshot(payload) {
        Err(error) => {
            let unchanged = target.to_snapshot().unwrap() == before;
            if error.code() == expected_code && unchanged {
                println!("ATOMIC {label}: code={} {error:?}", error.code());
                true
            } else {
                println!(
                    "REFUTATION {label}: wrong_error={error:?} expected_code={expected_code} unchanged={unchanged}"
                );
                false
            }
        }
        Ok(report) => {
            let unchanged = target.to_snapshot().unwrap() == before;
            println!(
                "REFUTATION {label}: accepted={report:?} target_unchanged={unchanged} expected_code={expected_code}"
            );
            false
        }
    }
}

fn mutate_u16(base: &[u8], offset: usize, value: u16) -> Vec<u8> {
    let mut payload = base.to_vec();
    payload[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    payload
}

fn mutate_u32(base: &[u8], offset: usize, value: u32) -> Vec<u8> {
    let mut payload = base.to_vec();
    payload[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    payload
}

fn mutate_u64(base: &[u8], offset: usize, value: u64) -> Vec<u8> {
    let mut payload = base.to_vec();
    payload[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    payload
}

fn mutation_matrix() -> (usize, usize) {
    let mut source = SndState::new();
    source.set_capture_enabled(true);
    configure(
        &mut source,
        0,
        VIRTIO_SND_PCM_RATE_48000,
        PcmState::Prepared,
    );
    configure(
        &mut source,
        CAPTURE_STREAM_ID,
        VIRTIO_SND_PCM_RATE_48000,
        PcmState::Prepared,
    );
    let good = source.to_snapshot().unwrap();
    assert_eq!(good.len(), HEADER_LEN);

    let mut cases: Vec<(&str, Vec<u8>, u16)> = Vec::new();
    let mut bad_magic = good.clone();
    bad_magic[0] ^= 0xff;
    cases.push(("bad magic", bad_magic, 2));
    cases.push(("unsupported version", mutate_u16(&good, 8, 2), 3));
    cases.push(("reserved flags", mutate_u16(&good, 10, 1), 4));
    let mut invalid_capture_bool = good.clone();
    invalid_capture_bool[12] = 2;
    cases.push(("invalid capture boolean", invalid_capture_bool, 6));
    let mut reserved_capture = good.clone();
    reserved_capture[13] = 1;
    cases.push(("capture reserved bytes", reserved_capture, 5));
    cases.push(("zero rate mask", mutate_u64(&good, 16, 0), 11));
    cases.push(("unsupported rate mask", mutate_u64(&good, 16, 1 << 10), 11));
    let mut invalid_output_state = good.clone();
    invalid_output_state[OUTPUT_STATE] = 9;
    cases.push(("invalid output state", invalid_output_state, 7));
    let mut missing_output_params = good.clone();
    missing_output_params[OUTPUT_HAS_PARAMS] = 0;
    cases.push(("missing output params", missing_output_params, 8));
    let mut unexpected_output_params = good.clone();
    unexpected_output_params[OUTPUT_STATE] = PcmState::Released as u8;
    cases.push(("released output with params", unexpected_output_params, 9));
    let mut output_reserved = good.clone();
    output_reserved[50] = 1;
    cases.push(("output reserved bytes", output_reserved, 5));
    cases.push((
        "output request code",
        mutate_u32(&good, OUTPUT_PARAMS, 0),
        10,
    ));
    cases.push((
        "output stream id",
        mutate_u32(&good, OUTPUT_STREAM_ID, 2),
        10,
    ));
    cases.push((
        "zero output buffer",
        mutate_u32(&good, OUTPUT_BUFFER_BYTES, 0),
        10,
    ));
    cases.push((
        "zero output period",
        mutate_u32(&good, OUTPUT_PERIOD_BYTES, 0),
        10,
    ));
    cases.push(("output feature", mutate_u32(&good, OUTPUT_FEATURES, 1), 10));
    let mut bad_output_channels = good.clone();
    bad_output_channels[OUTPUT_CHANNELS] = 1;
    cases.push(("output channels", bad_output_channels, 10));
    let mut bad_output_format = good.clone();
    bad_output_format[OUTPUT_FORMAT] = VIRTIO_SND_PCM_FMT_S16.wrapping_add(1);
    cases.push(("output format", bad_output_format, 10));
    let mut bad_output_rate = good.clone();
    bad_output_rate[OUTPUT_RATE] = 10;
    cases.push(("output rate", bad_output_rate, 10));
    let mut bad_output_padding = good.clone();
    bad_output_padding[OUTPUT_PADDING] = 1;
    cases.push(("output padding", bad_output_padding, 10));
    let mut invalid_capture_state = good.clone();
    invalid_capture_state[CAPTURE_STATE] = 9;
    cases.push(("invalid capture state", invalid_capture_state, 7));
    cases.push((
        "capture stream id",
        mutate_u32(&good, CAPTURE_STREAM_ID_OFFSET, 2),
        10,
    ));
    let mut bad_capture_format = good.clone();
    bad_capture_format[CAPTURE_FORMAT] = VIRTIO_SND_PCM_FMT_S16.wrapping_add(1);
    cases.push(("capture format", bad_capture_format, 10));
    let mut bad_capture_rate = good.clone();
    bad_capture_rate[CAPTURE_RATE] = VIRTIO_SND_PCM_RATE_44100;
    cases.push(("capture rate", bad_capture_rate, 10));
    let mut disabled_with_capture = good.clone();
    disabled_with_capture[12] = 0;
    cases.push(("disabled configured capture", disabled_with_capture, 7));
    cases.push((
        "playback count overflow",
        mutate_u32(&good, PLAYBACK_COUNT, MAX_PENDING_TRANSFERS + 1),
        12,
    ));
    cases.push((
        "playback count without bytes",
        mutate_u32(&good, PLAYBACK_COUNT, 1),
        13,
    ));
    let mut playback_non_period_length = mutate_u32(&good, PLAYBACK_COUNT, 1);
    playback_non_period_length[PLAYBACK_BYTES..PLAYBACK_BYTES + 4]
        .copy_from_slice(&1u32.to_le_bytes());
    cases.push((
        "playback bytes cannot describe one configured period",
        playback_non_period_length,
        13,
    ));
    cases.push((
        "playback bytes without count",
        mutate_u32(&good, PLAYBACK_BYTES, 4),
        13,
    ));
    let mut playback_oversized = mutate_u32(&good, PLAYBACK_COUNT, 1);
    playback_oversized[PLAYBACK_BYTES..PLAYBACK_BYTES + 4]
        .copy_from_slice(&(MAX_PCM_BUFFER_BYTES + 1).to_le_bytes());
    cases.push(("playback bytes exceed bound", playback_oversized, 13));
    let mut impossible_next = good.clone();
    impossible_next[PLAYBACK_NEXT_PRESENT] = 0;
    impossible_next[PLAYBACK_NEXT_NS..PLAYBACK_NEXT_NS + 8].copy_from_slice(&1u64.to_le_bytes());
    cases.push(("playback next deadline mismatch", impossible_next, 13));
    cases.push((
        "capture count overflow",
        mutate_u32(&good, CAPTURE_COUNT, MAX_PENDING_TRANSFERS + 1),
        12,
    ));
    cases.push((
        "capture count without bytes",
        mutate_u32(&good, CAPTURE_COUNT, 1),
        13,
    ));
    let mut capture_non_period_length = mutate_u32(&good, CAPTURE_COUNT, 1);
    capture_non_period_length[CAPTURE_BYTES..CAPTURE_BYTES + 4]
        .copy_from_slice(&1u32.to_le_bytes());
    cases.push((
        "capture bytes cannot describe one configured period",
        capture_non_period_length,
        13,
    ));
    cases.push((
        "capture bytes without count",
        mutate_u32(&good, CAPTURE_BYTES, 4),
        13,
    ));
    let mut invalid_reset = good.clone();
    invalid_reset[RESET_PENDING] = 2;
    cases.push(("invalid reset boolean", invalid_reset, 6));
    let mut reset_reserved = good.clone();
    reset_reserved[RESET_PENDING + 1] = 1;
    cases.push(("reset reserved bytes", reset_reserved, 5));
    cases.push(("truncated header", good[..HEADER_LEN - 1].to_vec(), 1));
    let mut trailing = good.clone();
    trailing.push(0);
    cases.push(("trailing bytes", trailing, 16));

    let mut failures = 0;
    for (label, payload, expected_code) in &cases {
        failures += usize::from(!assert_atomic_refusal(label, payload, *expected_code));
    }

    let mut event_source = SndState::new();
    event_source.set_capture_enabled(true);
    event_source.notify_capture_xrun();
    let event_good = event_source.to_snapshot().unwrap();
    assert_eq!(event_good.len(), HEADER_LEN + 8);
    let mut bad_event_type = event_good.clone();
    bad_event_type[HEADER_LEN..HEADER_LEN + 4].copy_from_slice(&0x110u32.to_le_bytes());
    failures += usize::from(!assert_atomic_refusal(
        "invalid event type",
        &bad_event_type,
        15,
    ));
    let mut bad_event_stream = event_good;
    bad_event_stream[HEADER_LEN + 4..HEADER_LEN + 8].copy_from_slice(&2u32.to_le_bytes());
    failures += usize::from(!assert_atomic_refusal(
        "invalid event stream",
        &bad_event_stream,
        15,
    ));

    let mut budget_source = SndState::new();
    budget_source.set_capture_enabled(true);
    configure(
        &mut budget_source,
        0,
        VIRTIO_SND_PCM_RATE_48000,
        PcmState::Running,
    );
    for _ in 0..MAX_PENDING_EVENTS {
        budget_source.notify_capture_xrun();
    }
    let budget_payload = budget_source.to_snapshot().unwrap();
    assert_eq!(
        u32::from_le_bytes(
            budget_payload[EVENT_COUNT..EVENT_COUNT + 4]
                .try_into()
                .unwrap()
        ),
        MAX_PENDING_EVENTS as u32
    );
    failures += usize::from(!assert_atomic_refusal(
        "event budget plus repair",
        &budget_payload,
        14,
    ));

    (cases.len() + 3, failures)
}

fn lifecycle_matrix() {
    for lifecycle in [PcmState::Prepared, PcmState::Stopped, PcmState::Running] {
        let mut source = SndState::new();
        assert!(source.set_output_sample_rate(44_100));
        configure(&mut source, 0, VIRTIO_SND_PCM_RATE_44100, lifecycle);
        let expected_params = source.stream.params();
        let mut restored = SndState::new();
        let report = restored
            .restore_snapshot(&source.to_snapshot().unwrap())
            .unwrap();
        assert_eq!(restored.stream.state(), lifecycle);
        assert_eq!(restored.stream.params(), expected_params);
        assert_eq!(
            report.xrun_events,
            u32::from(lifecycle == PcmState::Running)
        );
        assert_eq!(restored.playback_pending_count(), 0);
        println!(
            "LIFECYCLE output={lifecycle:?} xrun={} pending={}",
            report.xrun_events,
            restored.playback_pending_count()
        );
    }

    let mut source = SndState::new();
    source.set_capture_enabled(true);
    configure(&mut source, 0, VIRTIO_SND_PCM_RATE_48000, PcmState::Running);
    configure(
        &mut source,
        CAPTURE_STREAM_ID,
        VIRTIO_SND_PCM_RATE_48000,
        PcmState::Running,
    );
    let output_params = source.stream.params();
    let capture_params = source.capture_stream_params();
    let start_count = source.capture_start_count();
    let mut restored = SndState::new();
    let report = restored
        .restore_snapshot(&source.to_snapshot().unwrap())
        .unwrap();
    assert_eq!(report.xrun_events, 2);
    assert!(report.host_audio_rings_discarded);
    assert_eq!(restored.stream.params(), output_params);
    assert_eq!(restored.capture_stream_params(), capture_params);
    assert_eq!(restored.capture_start_count(), start_count);
    assert_eq!(restored.playback_pending_count(), 0);
    assert_eq!(restored.capture_pending_count(), 0);
    assert_eq!(restored.pending_event_count(), 2);
    println!("LIFECYCLE duplex-running xrun=2 playback_pending=0 capture_pending=0");
}

fn device_wrapper_roundtrip() {
    let (device, handle) = snd::new();
    configure(
        &mut handle.borrow_mut(),
        0,
        VIRTIO_SND_PCM_RATE_48000,
        PcmState::Running,
    );
    let payload = device.to_snapshot().unwrap();
    let (mut restored_device, restored_handle) = snd::new();
    let report = restored_device.restore_snapshot(&payload).unwrap();
    assert_eq!(report.xrun_events, 1);
    assert_eq!(restored_handle.borrow().stream.state(), PcmState::Running);
    assert_eq!(restored_handle.borrow().playback_pending_count(), 0);
    println!("WRAPPER running xrun=1 pending=0");
}

struct Ring {
    sequence: u16,
}

struct PlaybackRig {
    slot: Rc<RefCell<VirtioMmio>>,
    state: Rc<RefCell<SndState>>,
    tx_vq: Option<wasm_vm_core::dev::virtio::queue::Virtqueue>,
    bus: SystemBus,
    ring: Ring,
}

impl PlaybackRig {
    fn new() -> Self {
        let (device, state) = snd::new();
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
        let mut rig = Self {
            slot,
            state,
            tx_vq: None,
            bus: SystemBus::new(Ram::new(RAM_BYTES).unwrap()),
            ring: Ring { sequence: 0 },
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

    fn start(&mut self) {
        configure(
            &mut self.state.borrow_mut(),
            0,
            VIRTIO_SND_PCM_RATE_48000,
            PcmState::Running,
        );
    }

    fn post(&mut self, samples: &[i16]) -> u64 {
        assert_eq!(samples.len(), PERIOD_SAMPLES);
        let sequence = self.ring.sequence;
        let head = (sequence % 5) * 3;
        let base = DATA + DATA_STRIDE * u64::from(sequence);
        let pcm = base + 4;
        let status_address = base + 0x1200;
        for (index, byte) in (PcmXfer { stream_id: 0 }).to_bytes().iter().enumerate() {
            self.bus.store8(base + index as u64, *byte).unwrap();
        }
        for (index, sample) in samples.iter().enumerate() {
            self.bus
                .store16(pcm + 2 * index as u64, *sample as u16)
                .unwrap();
        }
        self.bus.store64(status_address, u64::MAX).unwrap();
        write_desc(&mut self.bus, head, base, 4, F_NEXT, head + 1);
        write_desc(
            &mut self.bus,
            head + 1,
            pcm,
            (samples.len() * 2) as u32,
            F_NEXT,
            head + 2,
        );
        write_desc(&mut self.bus, head + 2, status_address, 8, F_WRITE, 0);
        let avail_slot = AVAIL + 4 + 2 * u64::from(sequence % QUEUE_SIZE);
        self.bus.store16(avail_slot, head).unwrap();
        self.ring.sequence = sequence.wrapping_add(1);
        self.bus.store16(AVAIL + 2, self.ring.sequence).unwrap();
        status_address
    }

    fn service(
        &mut self,
        clock: &ManualAudioClock,
        sink: &mut dyn AudioSink,
        kick: bool,
    ) -> snd::PlaybackReport {
        if kick {
            self.slot
                .borrow_mut()
                .write(QUEUE_NOTIFY, Width::B4, u64::from(TX_QUEUE))
                .unwrap();
        }
        snd::service(
            &self.slot,
            &mut self.tx_vq,
            &self.state,
            clock,
            sink,
            &mut self.bus,
        )
    }

    fn used_idx(&mut self) -> u16 {
        self.bus.load16(USED + 2).unwrap()
    }

    fn status(&mut self, address: u64) -> PcmStatus {
        let mut bytes = [0u8; 8];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = self.bus.load8(address + index as u64).unwrap();
        }
        PcmStatus::from_bytes(&bytes).unwrap()
    }
}

fn write_desc(bus: &mut SystemBus, index: u16, addr: u64, len: u32, flags: u16, next: u16) {
    let descriptor = DESC + 16 * u64::from(index);
    bus.store64(descriptor, addr).unwrap();
    bus.store32(descriptor + 8, len).unwrap();
    bus.store16(descriptor + 12, flags).unwrap();
    bus.store16(descriptor + 14, next).unwrap();
}

fn ramp(start: i16) -> Vec<i16> {
    (0..PERIOD_SAMPLES)
        .map(|index| start.saturating_add(index as i16))
        .collect()
}

fn stalled_partial_playback() {
    let mut rig = PlaybackRig::new();
    rig.start();
    let clock = ManualAudioClock::new();
    let mut sink = NullSink::new();
    let old_status = rig.post(&ramp(0));
    let first = rig.service(&clock, &mut sink, true);
    assert_eq!(first.queued, 1);
    assert_eq!(rig.state.borrow().playback_pending_count(), 1);
    assert_eq!(sink.frames_pushed(), 0);
    let payload = rig.state.borrow().to_snapshot().unwrap();

    clock.advance_ns(500_000_000);
    for iteration in 0..64 {
        let report = rig.state.borrow_mut().restore_snapshot(&payload).unwrap();
        assert_eq!(report.discarded_playback_transfers, 1);
        assert_eq!(report.xrun_events, 1);
        assert_eq!(rig.state.borrow().playback_pending_count(), 0);
        let service = rig.service(&clock, &mut sink, false);
        assert_eq!(service.completed, 0, "iteration {iteration}");
        assert_eq!(
            rig.state.borrow().pending_event_count(),
            1,
            "iteration {iteration}"
        );
    }

    assert_eq!(rig.used_idx(), 0);
    assert_eq!(rig.bus.load64(old_status).unwrap(), u64::MAX);
    let fresh_status = rig.post(&ramp(10_000));
    let queued = rig.service(&clock, &mut sink, true);
    assert_eq!(queued.queued, 1);
    assert_eq!(queued.completed, 0);
    assert_eq!(sink.frames_pushed(), 0);
    clock.advance_ns(PERIOD_NS);
    let completed = rig.service(&clock, &mut sink, false);
    assert_eq!(completed.completed, 1);
    assert_eq!(completed.frames_pushed, PERIOD_FRAMES as u64);
    assert_eq!(rig.used_idx(), 1);
    assert_eq!(rig.status(fresh_status).status, snd::SndStatus::Ok);
    assert_eq!(sink.frames_pushed(), PERIOD_FRAMES as u64);
    assert_eq!(rig.service(&clock, &mut sink, false).completed, 0);
    assert_eq!(sink.frames_pushed(), PERIOD_FRAMES as u64);
    println!(
        "STALL iterations=64 stall_ns=500000000 xrun_per_restore=1 fresh_frames={} duplicate_frames=0 old_completion=absent",
        PERIOD_FRAMES
    );
}

fn main() {
    lifecycle_matrix();
    device_wrapper_roundtrip();
    let (mutations, failures) = mutation_matrix();
    stalled_partial_playback();
    println!(
        "RESULT {} lifecycle_states=3 duplex_running=1 mutation_cases={mutations} mutation_failures={failures} stall_iterations=64",
        if failures == 0 { "pass" } else { "refuted" }
    );
    if failures != 0 {
        std::process::exit(1);
    }
}
