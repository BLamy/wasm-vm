//! Test-only F diagnostic: real PCM through whole-machine resume into a fresh native WAV sink.
//! No direct SndState mutation or fabricated snapshot/queue cursors establishes playback.

#![cfg(all(feature = "std", not(feature = "zicsr-stub")))]

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::desktop_restore::DisplaySize;
use wasm_vm_core::dev::virtio::console::{self, ConsoleControl};
use wasm_vm_core::dev::virtio::gpu;
use wasm_vm_core::dev::virtio::snd::{
    self, AudioClock, AudioSink, AudioSinkError, ManualAudioClock, PcmParams, PcmState, WavSink,
};
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::resume::{SectionReader, SnapshotError, SnapshotWriter, section};
use wasm_vm_core::{Machine, RunOutcome};

const QSIZE: u16 = 16;
const SND_SLOT: usize = 6;
const CONSOLE_SLOT: usize = 8;
const DRIVER_OK: u32 = 15;
const STATUS: u64 = 0x70;
const NEXT: u16 = 1;
const WRITE: u16 = 2;
const HIGH_CLOCK: u64 = 3_600_000_000_000;

#[derive(Clone)]
struct WavProbe(Rc<RefCell<Option<WavSink>>>);

impl WavProbe {
    fn bytes(&self) -> u64 {
        self.0.borrow().as_ref().unwrap().data_bytes()
    }

    fn finish_and_check(&self, path: &Path, samples: &[i16]) {
        self.0.borrow_mut().take().unwrap().finish().unwrap();
        let wav = std::fs::read(path).unwrap();
        let expected: Vec<u8> = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();
        assert!(samples.iter().any(|&sample| sample != 0));
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(u16::from_le_bytes(wav[22..24].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 48_000);
        assert_eq!(u16::from_le_bytes(wav[34..36].try_into().unwrap()), 16);
        assert_eq!(
            u32::from_le_bytes(wav[40..44].try_into().unwrap()) as usize,
            expected.len()
        );
        assert_eq!(
            &wav[44..],
            expected,
            "PCM must reach the actual file sink bit-exactly"
        );
    }
}

impl AudioSink for WavProbe {
    fn push(&mut self, samples: &[i16], rate: u32) -> Result<(), AudioSinkError> {
        // Instrument the real sink, not an independently populated sample vector.
        self.0.borrow_mut().as_mut().unwrap().push(samples, rate)
    }
}

#[derive(Clone, Copy)]
struct Ring {
    slot: usize,
    queue: u32,
}

impl Ring {
    const fn sound(queue: u32) -> Self {
        Self {
            slot: SND_SLOT,
            queue,
        }
    }

    fn base(self) -> u64 {
        virt::DRAM_BASE
            + if self.slot == SND_SLOT {
                0x10000
            } else {
                0x100000
            }
            + u64::from(self.queue) * 0x20000
    }

    fn avail(self) -> u64 {
        self.base() + 0x1000
    }
    fn used(self) -> u64 {
        self.base() + 0x2000
    }
    fn data(self) -> u64 {
        self.base() + 0x4000
    }
    fn status(self) -> u64 {
        self.base() + 0x1e000
    }

    fn configure(self, machine: &mut Machine) {
        let base = Platform::virtio_base(self.slot as u64);
        for (offset, value) in [
            (0x30, self.queue),
            (0x38, u32::from(QSIZE)),
            (0x80, self.base() as u32),
            (0x84, (self.base() >> 32) as u32),
            (0x90, self.avail() as u32),
            (0x94, (self.avail() >> 32) as u32),
            (0xa0, self.used() as u32),
            (0xa4, (self.used() >> 32) as u32),
            (0x44, 1),
            (STATUS, DRIVER_OK),
        ] {
            machine.bus_mut().store32(base + offset, value).unwrap();
        }
    }

    fn descriptor(
        self,
        machine: &mut Machine,
        head: u16,
        address: u64,
        len: u32,
        flags: u16,
        next: u16,
    ) {
        let entry = self.base() + u64::from(head) * 16;
        machine.bus_mut().store64(entry, address).unwrap();
        machine.bus_mut().store32(entry + 8, len).unwrap();
        machine.bus_mut().store16(entry + 12, flags).unwrap();
        machine.bus_mut().store16(entry + 14, next).unwrap();
    }

    fn post(self, machine: &mut Machine, ordinal: u16, head: u16) {
        machine
            .bus_mut()
            .store16(self.avail() + 4 + 2 * u64::from(ordinal % QSIZE), head)
            .unwrap();
        machine
            .bus_mut()
            .store16(self.avail() + 2, ordinal.wrapping_add(1))
            .unwrap();
        self.kick(machine);
    }

    fn kick(self, machine: &mut Machine) {
        machine
            .bus_mut()
            .store32(Platform::virtio_base(self.slot as u64) + 0x50, self.queue)
            .unwrap();
    }

    fn used_idx(self, machine: &mut Machine) -> u16 {
        machine.bus_mut().load16(self.used() + 2).unwrap()
    }

    fn assert_completion(self, machine: &mut Machine, ordinal: u16, head: u16, bytes: u32) {
        assert_eq!(self.used_idx(machine), ordinal.wrapping_add(1));
        let entry = self.used() + 4 + 8 * u64::from(ordinal % QSIZE);
        assert_eq!(machine.bus_mut().load32(entry), Ok(u32::from(head)));
        assert_eq!(machine.bus_mut().load32(entry + 4), Ok(bytes));
    }
}

struct Rig {
    machine: Machine,
    clock: Rc<ManualAudioClock>,
    wav: WavProbe,
    path: PathBuf,
}

impl Rig {
    // Only assemble topology and attach a distinct host clock/sink. No rings, resources,
    // stream parameters, descriptors, or consumed cursors are seeded into a restore target.
    fn empty(path: &Path) -> Self {
        let mut machine = Machine::new(2 * 1024 * 1024);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        machine.enable_virtio_keyboard();
        machine.enable_virtio_pointer();
        let clock = Rc::new(ManualAudioClock::new());
        let wav = WavProbe(Rc::new(RefCell::new(Some(
            WavSink::create(path, 48_000).unwrap(),
        ))));
        machine.enable_virtio_snd_with_audio(clock.clone(), Box::new(wav.clone()));
        machine.enable_virtio_gpu(Box::new(gpu::NullSink)).unwrap();
        machine.enable_virtio_console_at(CONSOLE_SLOT);
        machine.hart_mut().regs.pc = virt::DRAM_BASE + 0x100;
        machine.hart_mut().regs.write(5, 0xdead_beef);
        machine
            .bus_mut()
            .store32(virt::DRAM_BASE, 0xdead_beef)
            .unwrap();
        Self {
            machine,
            clock,
            wav,
            path: path.to_path_buf(),
        }
    }

    fn step(&mut self) {
        // Two boundaries permit the control START transition to precede active-audio polling.
        assert_eq!(self.machine.run(2), RunOutcome::MaxInstrs);
    }

    fn command(&mut self, request: &[u8]) {
        let ring = Ring::sound(snd::CONTROL_QUEUE);
        let ordinal = ring.used_idx(&mut self.machine);
        let head = (ordinal % (QSIZE / 2)) * 2;
        let data = ring.data() + u64::from(head) * 0x80;
        self.machine
            .bus_mut()
            .ram_mut()
            .write_slice(data, request)
            .unwrap();
        self.machine
            .bus_mut()
            .store32(data + 0x40, u32::MAX)
            .unwrap();
        ring.descriptor(
            &mut self.machine,
            head,
            data,
            request.len() as u32,
            NEXT,
            head + 1,
        );
        ring.descriptor(&mut self.machine, head + 1, data + 0x40, 4, WRITE, 0);
        ring.post(&mut self.machine, ordinal, head);
        self.step();
        ring.assert_completion(&mut self.machine, ordinal, head, 4);
        assert_eq!(
            self.machine.bus_mut().load32(data + 0x40),
            Ok(snd::VIRTIO_SND_S_OK),
            "control={request:?}"
        );
    }

    fn lifecycle(&mut self, code: u32) {
        let mut request = [0; 8];
        request[..4].copy_from_slice(&code.to_le_bytes());
        self.command(&request);
    }

    fn initialize_source(&mut self, old_clock: u64) {
        self.machine
            .bus_mut()
            .store32(virt::DRAM_BASE, 0x0000_006f)
            .unwrap();
        self.machine.hart_mut().regs.pc = virt::DRAM_BASE;
        self.machine.hart_mut().regs.write(5, 0x1122_3344);
        self.clock.set_now_ns(old_clock);
        // The optional desktop envelope requires a real source scanout to present a repair
        // frame. It is unrelated to PCM; the fresh target still starts with no GPU resources.
        let gpu = self.machine.virtio_gpu().unwrap().1;
        {
            let mut gpu = gpu.borrow_mut();
            gpu.resources
                .create(1, gpu::protocol::FORMAT_B8G8R8A8_UNORM, 2, 2)
                .unwrap()
                .host_pixels
                .fill(0x0011_2233);
            gpu.scanout_resource = Some(1);
        }
        for queue in [snd::CONTROL_QUEUE, snd::EVENT_QUEUE, snd::TX_QUEUE] {
            Ring::sound(queue).configure(&mut self.machine);
        }
        let ring = Ring {
            slot: CONSOLE_SLOT,
            queue: console::CONTROL_TRANSMIT_QUEUE,
        };
        ring.configure(&mut self.machine);
        Ring {
            slot: CONSOLE_SLOT,
            queue: console::AGENT_TRANSMIT_QUEUE,
        }
        .configure(&mut self.machine);
        for (ordinal, control) in [
            ConsoleControl::new(0, console::VIRTIO_CONSOLE_DEVICE_READY, 1),
            ConsoleControl::new(
                console::AGENT_PORT_ID,
                console::VIRTIO_CONSOLE_PORT_READY,
                1,
            ),
            ConsoleControl::new(console::AGENT_PORT_ID, console::VIRTIO_CONSOLE_PORT_OPEN, 1),
        ]
        .into_iter()
        .enumerate()
        {
            self.machine
                .bus_mut()
                .ram_mut()
                .write_slice(ring.data(), &control.to_bytes())
                .unwrap();
            ring.descriptor(&mut self.machine, 0, ring.data(), 8, 0, 0);
            ring.post(&mut self.machine, ordinal as u16, 0);
            self.step();
        }
        self.fresh_hello();
    }

    fn fresh_hello(&mut self) {
        const HELLO: [u8; 18] = [10, 0, 0, 0, 0, 0, 0, 0, 1, 0, 7, 0, 0, 0, 0, 0, 0, 0];
        let ring = Ring {
            slot: CONSOLE_SLOT,
            queue: console::AGENT_TRANSMIT_QUEUE,
        };
        let ordinal = ring.used_idx(&mut self.machine);
        self.machine
            .bus_mut()
            .ram_mut()
            .write_slice(ring.data(), &HELLO)
            .unwrap();
        ring.descriptor(&mut self.machine, 0, ring.data(), HELLO.len() as u32, 0, 0);
        ring.post(&mut self.machine, ordinal, 0);
        self.step();
        assert_eq!(
            self.machine
                .virtio_console()
                .unwrap()
                .borrow_mut()
                .take_agent_output(),
            HELLO
        );
        assert!(self.machine.confirm_virtio_console_agent_hello().is_some());
    }

    fn play_period(&mut self, ordinal: u16, frames: usize, sample_seed: i16) -> Vec<i16> {
        let period_bytes = (frames * 4) as u32;
        self.command(
            &PcmParams {
                period_bytes,
                buffer_bytes: period_bytes * 4,
                ..PcmParams::default()
            }
            .to_bytes(),
        );
        self.lifecycle(snd::VIRTIO_SND_R_PCM_PREPARE);
        let tx = Ring::sound(snd::TX_QUEUE);
        let event = Ring::sound(snd::EVENT_QUEUE);
        let head = (ordinal % 4) * 3;
        let data = tx.data() + u64::from(ordinal % 4) * 0x4000;
        let status = tx.status() + u64::from(ordinal % 4) * 8;
        let samples: Vec<i16> = (0..frames)
            .flat_map(|frame| {
                let sample = sample_seed + (frame % 997) as i16;
                [sample, -sample]
            })
            .collect();
        self.machine.bus_mut().store32(data, 0).unwrap(); // PcmXfer stream 0
        let pcm: Vec<u8> = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();
        self.machine
            .bus_mut()
            .ram_mut()
            .write_slice(data + 4, &pcm)
            .unwrap();
        self.machine.bus_mut().store64(status, u64::MAX).unwrap();
        tx.descriptor(&mut self.machine, head, data, 4, NEXT, head + 1);
        tx.descriptor(
            &mut self.machine,
            head + 1,
            data + 4,
            period_bytes,
            NEXT,
            head + 2,
        );
        tx.descriptor(&mut self.machine, head + 2, status, 8, WRITE, 0);
        tx.post(&mut self.machine, ordinal, head);
        // Linux ordering: TX QueueNotify has already been serviced while Prepared. START comes
        // later on controlq. No second TX kick is allowed to rescue playback in this fixture.
        self.step();
        assert_eq!(tx.used_idx(&mut self.machine), ordinal);
        assert_eq!(
            self.machine
                .virtio_snd()
                .unwrap()
                .1
                .borrow()
                .playback_pending_count(),
            0
        );
        let event_head = ordinal % QSIZE;
        let event_data = event.data() + u64::from(event_head) * 8;
        event.descriptor(&mut self.machine, event_head, event_data, 8, WRITE, 0);
        event.post(&mut self.machine, ordinal, event_head);
        let prior_bytes = self.wav.bytes();
        self.lifecycle(snd::VIRTIO_SND_R_PCM_START);
        let queued = self
            .machine
            .virtio_snd()
            .unwrap()
            .1
            .borrow()
            .playback_pending_count();
        let duration_ns = (frames as u64 * 1_000_000_000).div_ceil(48_000);
        self.clock.advance_ns(duration_ns - 1);
        self.step();
        assert_eq!(self.wav.bytes(), prior_bytes);
        assert_eq!(tx.used_idx(&mut self.machine), ordinal);
        assert_eq!(self.machine.bus_mut().load64(status), Ok(u64::MAX));
        self.clock.advance_ns(1);
        self.step();
        let actual_wav = std::fs::read(&self.path).unwrap();
        let actual_pcm = &actual_wav[44 + prior_bytes as usize..];
        println!(
            "PCM deadline: ordinal={ordinal} queued={queued} used={} status={:#x} sink_bytes={} first_pcm={:?} WAV={}",
            tx.used_idx(&mut self.machine),
            self.machine.bus_mut().load32(status).unwrap(),
            self.wav.bytes(),
            &actual_pcm[..actual_pcm.len().min(8)],
            self.path.display()
        );
        assert!(
            actual_pcm == pcm,
            "fresh sink PCM mismatch: expected first {:?}, actual first {:?}",
            &pcm[..8],
            &actual_pcm[..actual_pcm.len().min(8)]
        );
        assert_eq!(queued, 1, "only the newly posted period may be queued");
        tx.assert_completion(&mut self.machine, ordinal, head, 8);
        assert_eq!(
            self.machine.bus_mut().load32(status),
            Ok(snd::VIRTIO_SND_S_OK)
        );
        assert_eq!(self.machine.bus_mut().load32(status + 4), Ok(0));
        assert_eq!(self.wav.bytes(), prior_bytes + u64::from(period_bytes));
        // Generate and consume a real underrun event so the saved event cursor is nonzero too.
        self.clock.advance_ns(duration_ns);
        self.step();
        event.assert_completion(&mut self.machine, ordinal, event_head, 8);
        assert_eq!(
            self.machine.bus_mut().load32(event_data),
            Ok(snd::VIRTIO_SND_EVT_PCM_XRUN)
        );
        assert_eq!(self.machine.bus_mut().load32(event_data + 4), Ok(0));
        self.lifecycle(snd::VIRTIO_SND_R_PCM_STOP);
        self.step();
        tx.assert_completion(&mut self.machine, ordinal, head, 8);
        event.assert_completion(&mut self.machine, ordinal, event_head, 8);
        assert_eq!(
            self.wav.bytes(),
            prior_bytes + u64::from(period_bytes),
            "no duplicate sink push"
        );
        samples
    }
}

fn run_cases(with_desktop_envelope: bool, configure_unused_rx: bool) {
    let root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/desktop-machine-audio-resume");
    std::fs::create_dir_all(&root).unwrap();
    let mut failures = Vec::new();
    for frames in [480, 2048] {
        for old_clock in [0, HIGH_CLOCK] {
            for released in [false, true] {
                let case = format!(
                    "envelope-{with_desktop_envelope}-rx-{configure_unused_rx}-frames-{frames}-clock-{old_clock}-released-{released}"
                );
                // Keep independent variants running after a diagnostic failure, without turning
                // any failed expectation into a pass or hiding its original panic/location.
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let source_path = root.join(format!("{case}-source.wav"));
                    let target_path = root.join(format!("{case}-fresh.wav"));
                    let mut source = Rig::empty(&source_path);
                    source.initialize_source(old_clock);
                    if configure_unused_rx {
                        Ring::sound(snd::RX_QUEUE).configure(&mut source.machine);
                    }
                    let source_samples = source.play_period(0, frames, 73);
                    if released {
                        source.lifecycle(snd::VIRTIO_SND_R_PCM_RELEASE);
                    }
                    let saved_state = if released {
                        PcmState::Released
                    } else {
                        PcmState::Stopped
                    };
                    assert_eq!(
                        source
                            .machine
                            .virtio_snd()
                            .unwrap()
                            .1
                            .borrow()
                            .stream
                            .state(),
                        saved_state
                    );
                    let control_used =
                        Ring::sound(snd::CONTROL_QUEUE).used_idx(&mut source.machine);
                    assert!(control_used >= 4);
                    println!(
                        "{case}: source PCM exact, saved control_used={control_used} tx_used=1 event_used=1 state={saved_state:?}"
                    );
                    let envelope = source.machine.save_desktop_snapshot().unwrap();
                    let resume = source.machine.save_resume().unwrap();
                    let mut target = Rig::empty(&target_path);
                    let target_sound = target.machine.virtio_snd().unwrap().1;
                    assert!(!Rc::ptr_eq(&source.wav.0, &target.wav.0));
                    assert!(!Rc::ptr_eq(&source.clock, &target.clock));
                    assert_eq!(target.clock.now_ns(), 0);
                    assert_eq!(target.wav.bytes(), 0);
                    assert_eq!(
                        target
                            .machine
                            .bus_mut()
                            .load32(Platform::virtio_base(SND_SLOT as u64) + STATUS),
                        Ok(0)
                    );
                    for queue in [snd::CONTROL_QUEUE, snd::EVENT_QUEUE, snd::TX_QUEUE] {
                        assert_eq!(Ring::sound(queue).used_idx(&mut target.machine), 0);
                    }
                    assert_eq!(target_sound.borrow().stream.state(), PcmState::Released);
                    assert_eq!(target_sound.borrow().stream.params(), None);
                    target.machine.load_resume(&resume).unwrap();
                    assert!(Rc::ptr_eq(
                        &target_sound,
                        &target.machine.virtio_snd().unwrap().1
                    ));
                    assert_eq!(target.machine.hart().regs.pc, virt::DRAM_BASE);
                    assert_eq!(target.machine.hart().regs.read(5), 0x1122_3344);
                    assert_eq!(
                        target.machine.bus_mut().load32(virt::DRAM_BASE),
                        Ok(0x0000_006f)
                    );
                    assert_eq!(target_sound.borrow().stream.state(), saved_state);
                    assert_eq!(
                        target.clock.now_ns(),
                        0,
                        "source audio time must not replace the fresh host clock"
                    );
                    if with_desktop_envelope {
                        target.fresh_hello();
                        target
                            .machine
                            .restore_desktop_snapshot(&envelope, DisplaySize::new(1280, 720))
                            .unwrap();
                    }
                    assert_eq!(
                        target.wav.bytes(),
                        0,
                        "restore itself must not replay old PCM"
                    );
                    assert_eq!(
                        target
                            .machine
                            .bus_mut()
                            .load32(Platform::virtio_base(SND_SLOT as u64) + STATUS),
                        Ok(DRIVER_OK)
                    );
                    assert_eq!(
                        Ring::sound(snd::CONTROL_QUEUE).used_idx(&mut target.machine),
                        control_used
                    );
                    assert_eq!(Ring::sound(snd::TX_QUEUE).used_idx(&mut target.machine), 1);
                    assert_eq!(
                        Ring::sound(snd::EVENT_QUEUE).used_idx(&mut target.machine),
                        1
                    );
                    if !released {
                        target.lifecycle(snd::VIRTIO_SND_R_PCM_RELEASE);
                    }
                    let fresh_samples = target.play_period(1, frames, 1701);
                    assert_eq!(
                        source.wav.bytes(),
                        (source_samples.len() * 2) as u64,
                        "fresh playback must not reach the old sink"
                    );
                    assert_eq!(target.wav.bytes(), (fresh_samples.len() * 2) as u64);
                    source.wav.finish_and_check(&source_path, &source_samples);
                    target.wav.finish_and_check(&target_path, &fresh_samples);
                    println!(
                        "{case}: source/fresh={} PCM frames, control_used={}, tx_used=2 event_used=2, fresh_clock_ns={}, WAV={}",
                        frames,
                        Ring::sound(snd::CONTROL_QUEUE).used_idx(&mut target.machine),
                        target.clock.now_ns(),
                        target_path.display()
                    );
                }));
                if outcome.is_err() {
                    failures.push(case);
                }
            }
        }
    }
    assert!(
        failures.is_empty(),
        "failed native PCM resume cases: {failures:#?}"
    );
}

#[test]
fn strict_fresh_machine_pcm_sink_after_whole_machine_resume() {
    run_cases(false, false);
}

#[test]
fn fresh_pcm_sink_after_whole_machine_and_desktop_envelope_restore() {
    run_cases(true, false);
}

#[test]
fn configured_unused_rx_preserves_tx_cursor_and_fresh_pcm() {
    run_cases(false, true);
}

#[test]
fn configured_unused_rx_preserves_pcm_through_desktop_envelope_too() {
    run_cases(true, true);
}

#[test]
fn old_or_unknown_sound_resume_layout_is_rejected_before_live_mutation() {
    let root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/desktop-machine-audio-resume");
    std::fs::create_dir_all(&root).unwrap();
    let source_path = root.join("layout-compatibility-source.wav");
    let mut source = Rig::empty(&source_path);
    source.initialize_source(HIGH_CLOCK);
    // Both queue configs are valid, so the old layout cannot be rejected incidentally because
    // the wrongly associated RX queue is unconfigured. Its missing version must be caught.
    Ring::sound(snd::RX_QUEUE).configure(&mut source.machine);
    let source_samples = source.play_period(0, 480, 73);
    source.lifecycle(snd::VIRTIO_SND_R_PCM_RELEASE);
    let resume = source.machine.save_resume().unwrap();
    let (header, reader) = SectionReader::new(&resume).unwrap();
    assert_eq!(
        header.format_version, 1,
        "container/headless format is unchanged"
    );
    let sound = reader
        .map(Result::unwrap)
        .find(|s| s.tag == section::VIRTIO_SND)
        .unwrap();
    // Existing fixed transport (277 bytes), then four five-byte cursor entries. The new
    // version belongs to this sound resume composition, not the standalone sound codec.
    const TRANSPORT_BYTES: usize = 277;
    const CURSOR_BYTES: usize = 5;
    const VERSION_OFFSET: usize = TRANSPORT_BYTES + 4 * CURSOR_BYTES;
    let tx_offset = TRANSPORT_BYTES + 2 * CURSOR_BYTES;
    let rx_offset = TRANSPORT_BYTES + 3 * CURSOR_BYTES;
    assert_eq!(&sound.payload[tx_offset..rx_offset], &[1, 1, 0, 1, 0]);
    assert_eq!(
        &sound.payload[rx_offset..VERSION_OFFSET],
        &[0; CURSOR_BYTES]
    );
    assert_eq!(
        &sound.payload[VERSION_OFFSET..VERSION_OFFSET + 4],
        &2u32.to_le_bytes()
    );
    let mut legacy = sound.payload.to_vec();
    legacy[tx_offset..rx_offset].copy_from_slice(&sound.payload[rx_offset..VERSION_OFFSET]);
    legacy[rx_offset..VERSION_OFFSET].copy_from_slice(&sound.payload[tx_offset..rx_offset]);
    legacy.drain(VERSION_OFFSET..VERSION_OFFSET + 4);
    let mut cases = vec![("old-unversioned-RX-TX".to_string(), legacy)];
    for version in [0u32, 1, 3, u32::MAX] {
        let mut payload = sound.payload.to_vec();
        payload[VERSION_OFFSET..VERSION_OFFSET + 4].copy_from_slice(&version.to_le_bytes());
        cases.push((format!("unknown-layout-{version}"), payload));
    }
    for bytes in 0..4 {
        cases.push((
            format!("truncated-layout-{bytes}"),
            sound.payload[..VERSION_OFFSET + bytes].to_vec(),
        ));
    }
    let mut target = Rig::empty(&root.join("layout-compatibility-fresh.wav"));
    let sound_handle = target.machine.virtio_snd().unwrap().1;
    let baseline = target.machine.save_resume().unwrap();
    for (name, payload) in cases {
        let mut writer = SnapshotWriter::new(
            &header.core_hash,
            &header.base_image_hash,
            header.overlay_generation,
        );
        for item in SectionReader::new(&resume).unwrap().1 {
            let item = item.unwrap();
            writer.section(
                item.tag,
                if item.tag == section::VIRTIO_SND {
                    &payload
                } else {
                    item.payload
                },
            );
        }
        assert!(
            matches!(
                target.machine.load_resume(&writer.finish()),
                Err(SnapshotError::BadComponentState {
                    tag: section::VIRTIO_SND
                })
            ),
            "{name}"
        );
        assert_eq!(
            target.machine.save_resume().unwrap(),
            baseline,
            "{name}: partial commit"
        );
        assert!(Rc::ptr_eq(
            &sound_handle,
            &target.machine.virtio_snd().unwrap().1
        ));
        assert_eq!(target.wav.bytes(), 0, "{name}: host sink changed");
        assert_eq!(target.clock.now_ns(), 0, "{name}: host clock changed");
        assert_eq!(source.wav.bytes(), 1920);
        println!("{name}: sound tag 16 refusal, unchanged machine/host");
    }
    source.wav.finish_and_check(&source_path, &source_samples);
}

#[test]
fn sound_layout_version_does_not_invalidate_container_v1_headless_resume() {
    let mut source = Machine::new(1024 * 1024);
    source.hart_mut().regs.pc = virt::DRAM_BASE;
    source.hart_mut().regs.write(5, 0x1122_3344);
    source
        .bus_mut()
        .store32(virt::DRAM_BASE, 0x0000_006f)
        .unwrap();
    let blob = source.save_resume().unwrap();
    let (header, reader) = SectionReader::new(&blob).unwrap();
    assert_eq!(header.format_version, 1);
    assert!(
        reader
            .map(Result::unwrap)
            .all(|s| s.tag != section::VIRTIO_SND)
    );
    let mut target = Machine::new(1024 * 1024);
    target.hart_mut().regs.write(5, 0xdead_beef);
    target.load_resume(&blob).unwrap();
    assert_eq!(target.hart().regs.read(5), 0x1122_3344);
    assert_eq!(target.run(1), RunOutcome::MaxInstrs);
}

#[test]
fn linux_6_6_63_xrun_stop_release_prepare_recovers_without_set_params() {
    // Driver ordering was read from target/kernel-build/linux-6.6.63.tar.xz:
    // sound/core/pcm_native.c:1502-1508 triggers STOP and sets stop_operating;
    // :1952-1957 calls sync_stop before prepare, with :613-618 invoking the driver.
    // sound/virtio/virtio_pcm_ops.c:358-371 sends STOP; :397-425 sends RELEASE and
    // waits for pending I/O; :276-308 sends PREPARE without SET_PARAMS unless suspended.
    // This test does NOT assume PREPARE from Running is a valid recovery sequence.
    let root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/desktop-machine-audio-resume");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("linux-6.6.63-xrun-recovery.wav");
    let mut rig = Rig::empty(&path);
    rig.initialize_source(0);
    // Match the failing aplay observation: 480-frame period, 960-frame buffer, 48 kHz stereo.
    let params = PcmParams {
        period_bytes: 480 * 4,
        buffer_bytes: 960 * 4,
        features: snd::VIRTIO_SND_PCM_F_EVT_XRUNS,
        ..PcmParams::default()
    };
    rig.command(&params.to_bytes());
    rig.lifecycle(snd::VIRTIO_SND_R_PCM_PREPARE);
    let tx = Ring::sound(snd::TX_QUEUE);
    let event = Ring::sound(snd::EVENT_QUEUE);
    let mut expected_pcm = Vec::new();
    for ordinal in 0..2u16 {
        let head = ordinal * 3;
        let data = tx.data() + u64::from(ordinal) * 0x4000;
        let status = tx.status() + u64::from(ordinal) * 8;
        let sample = 100i16 + ordinal as i16;
        let pcm: Vec<u8> = [sample, -sample]
            .repeat(480)
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();
        expected_pcm.extend_from_slice(&pcm);
        rig.machine.bus_mut().store32(data, 0).unwrap();
        rig.machine
            .bus_mut()
            .ram_mut()
            .write_slice(data + 4, &pcm)
            .unwrap();
        rig.machine.bus_mut().store64(status, u64::MAX).unwrap();
        tx.descriptor(&mut rig.machine, head, data, 4, NEXT, head + 1);
        tx.descriptor(
            &mut rig.machine,
            head + 1,
            data + 4,
            params.period_bytes,
            NEXT,
            head + 2,
        );
        tx.descriptor(&mut rig.machine, head + 2, status, 8, WRITE, 0);
        tx.post(&mut rig.machine, ordinal, head);
    }
    // The driver queues TX before START, and eventq has a real writable XRUN buffer.
    event.descriptor(&mut rig.machine, 0, event.data(), 8, WRITE, 0);
    event.post(&mut rig.machine, 0, 0);
    rig.step();
    rig.lifecycle(snd::VIRTIO_SND_R_PCM_START);
    rig.clock.advance_ns(20_000_000);
    rig.step();
    assert_eq!(tx.used_idx(&mut rig.machine), 2);
    for ordinal in 0..2u64 {
        assert_eq!(
            rig.machine.bus_mut().load32(tx.status() + ordinal * 8),
            Ok(snd::VIRTIO_SND_S_OK)
        );
        assert_eq!(
            rig.machine.bus_mut().load32(tx.used() + 4 + ordinal * 8),
            Ok(ordinal as u32 * 3)
        );
    }
    assert_eq!(rig.wav.bytes(), 3840);
    assert_eq!(&std::fs::read(&path).unwrap()[44..], &expected_pcm);
    // Do not refill. The next 10 ms deadline emits and completes one real XRUN event.
    rig.clock.advance_ns(10_000_000);
    rig.step();
    event.assert_completion(&mut rig.machine, 0, 0, 8);
    assert_eq!(
        rig.machine.bus_mut().load32(event.data()),
        Ok(snd::VIRTIO_SND_EVT_PCM_XRUN)
    );
    assert_eq!(rig.machine.bus_mut().load32(event.data() + 4), Ok(0));
    let state = rig.machine.virtio_snd().unwrap().1;
    assert_eq!(state.borrow().stream.state(), PcmState::Running);
    assert_eq!(state.borrow().playback_pending_count(), 0);
    rig.lifecycle(snd::VIRTIO_SND_R_PCM_STOP);
    assert_eq!(state.borrow().stream.state(), PcmState::Stopped);
    assert_eq!(state.borrow().stream.params(), Some(params));
    rig.lifecycle(snd::VIRTIO_SND_R_PCM_RELEASE);
    assert_eq!(state.borrow().playback_pending_count(), 0);
    println!(
        "Linux XRUN recovery after successful 960-frame PCM: STOP=OK RELEASE=OK; state={:?} params={:?} tx_used={} event_used={}",
        state.borrow().stream.state(),
        state.borrow().stream.params(),
        tx.used_idx(&mut rig.machine),
        event.used_idx(&mut rig.machine)
    );

    // Non-suspended snd_pcm_prepare performs no intervening SET_PARAMS. Capture the actual
    // controlq response here so the diagnostic reports the wire error, not only host metadata.
    let control = Ring::sound(snd::CONTROL_QUEUE);
    let ordinal = control.used_idx(&mut rig.machine);
    let head = (ordinal % (QSIZE / 2)) * 2;
    let data = control.data() + u64::from(head) * 0x80;
    rig.machine
        .bus_mut()
        .store32(data, snd::VIRTIO_SND_R_PCM_PREPARE)
        .unwrap();
    rig.machine.bus_mut().store32(data + 4, 0).unwrap();
    rig.machine
        .bus_mut()
        .store32(data + 0x40, u32::MAX)
        .unwrap();
    control.descriptor(&mut rig.machine, head, data, 8, NEXT, head + 1);
    control.descriptor(&mut rig.machine, head + 1, data + 0x40, 4, WRITE, 0);
    control.post(&mut rig.machine, ordinal, head);
    rig.step();
    control.assert_completion(&mut rig.machine, ordinal, head, 4);
    let status = rig.machine.bus_mut().load32(data + 0x40).unwrap();
    println!(
        "Linux recovery PREPARE status={status:#x}; state={:?}; params={:?}; control_used={}",
        state.borrow().stream.state(),
        state.borrow().stream.params(),
        control.used_idx(&mut rig.machine)
    );
    assert_eq!(
        status,
        snd::VIRTIO_SND_S_OK,
        "Linux 6.6.63 STOP -> RELEASE -> PREPARE recovery must not fail (BAD_MSG maps to -EINVAL)"
    );
    assert_eq!(state.borrow().stream.state(), PcmState::Prepared);
    assert_eq!(state.borrow().stream.params(), Some(params));
    let fresh = play_recovery_period(&mut rig, 2, 480, 1701);
    expected_pcm.extend(fresh.iter().flat_map(|sample| sample.to_le_bytes()));
    assert_eq!(rig.wav.bytes(), 5760);
    assert_eq!(&std::fs::read(&path).unwrap()[44..], &expected_pcm);
    assert_eq!(event.used_idx(&mut rig.machine), 1);
    for ordinal in 0..2u64 {
        assert_eq!(
            rig.machine.bus_mut().load32(tx.status() + ordinal * 8),
            Ok(snd::VIRTIO_SND_S_OK)
        );
    }
    let samples: Vec<i16> = expected_pcm
        .chunks_exact(2)
        .map(|sample| i16::from_le_bytes(sample.try_into().unwrap()))
        .collect();
    rig.wav.finish_and_check(&path, &samples);
}

fn post_recovery_period(rig: &mut Rig, ordinal: u16, frames: usize, seed: i16) -> Vec<i16> {
    let tx = Ring::sound(snd::TX_QUEUE);
    let head = (ordinal % 4) * 3;
    let data = tx.data() + u64::from(ordinal % 4) * 0x4000;
    let status = tx.status() + u64::from(ordinal % 4) * 8;
    let samples: Vec<i16> = (0..frames)
        .flat_map(|frame| {
            let value = seed + (frame % 997) as i16;
            [value, -value]
        })
        .collect();
    let pcm: Vec<u8> = samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect();
    rig.machine.bus_mut().store32(data, 0).unwrap();
    rig.machine
        .bus_mut()
        .ram_mut()
        .write_slice(data + 4, &pcm)
        .unwrap();
    rig.machine.bus_mut().store64(status, u64::MAX).unwrap();
    tx.descriptor(&mut rig.machine, head, data, 4, NEXT, head + 1);
    tx.descriptor(
        &mut rig.machine,
        head + 1,
        data + 4,
        pcm.len() as u32,
        NEXT,
        head + 2,
    );
    tx.descriptor(&mut rig.machine, head + 2, status, 8, WRITE, 0);
    tx.post(&mut rig.machine, ordinal, head);
    samples
}

fn play_recovery_period(rig: &mut Rig, ordinal: u16, frames: usize, seed: i16) -> Vec<i16> {
    let state = rig.machine.virtio_snd().unwrap().1;
    assert_eq!(state.borrow().stream.state(), PcmState::Prepared);
    let params = state.borrow().stream.params().unwrap();
    assert_eq!(params.period_bytes as usize, frames * 4);
    let tx = Ring::sound(snd::TX_QUEUE);
    let before = rig.wav.bytes();
    let samples = post_recovery_period(rig, ordinal, frames, seed);
    // No SET_PARAMS or second TX kick: use the configuration retained through RELEASE.
    rig.step();
    assert_eq!(tx.used_idx(&mut rig.machine), ordinal);
    rig.lifecycle(snd::VIRTIO_SND_R_PCM_START);
    assert_eq!(state.borrow().playback_pending_count(), 1);
    let duration = (frames as u64 * 1_000_000_000).div_ceil(48_000);
    rig.clock.advance_ns(duration - 1);
    rig.step();
    assert_eq!(rig.wav.bytes(), before);
    assert_eq!(tx.used_idx(&mut rig.machine), ordinal);
    let status = tx.status() + u64::from(ordinal % 4) * 8;
    assert_eq!(rig.machine.bus_mut().load64(status), Ok(u64::MAX));
    rig.clock.advance_ns(1);
    rig.step();
    tx.assert_completion(&mut rig.machine, ordinal, (ordinal % 4) * 3, 8);
    assert_eq!(
        rig.machine.bus_mut().load32(status),
        Ok(snd::VIRTIO_SND_S_OK)
    );
    assert_eq!(rig.machine.bus_mut().load32(status + 4), Ok(0));
    assert_eq!(state.borrow().playback_pending_count(), 0);
    assert_eq!(state.borrow().stream.params(), Some(params));
    assert_eq!(rig.wav.bytes(), before + (samples.len() * 2) as u64);
    let expected: Vec<u8> = samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect();
    assert_eq!(
        &std::fs::read(&rig.path).unwrap()[44 + before as usize..],
        &expected
    );
    rig.step();
    tx.assert_completion(&mut rig.machine, ordinal, (ordinal % 4) * 3, 8);
    assert_eq!(rig.wav.bytes(), before + (samples.len() * 2) as u64);
    println!(
        "recovery: fresh {frames} frames bit-exact; TX used={} completed exactly once",
        ordinal + 1
    );
    samples
}

#[test]
fn released_params_resume_into_fresh_sink_and_clock_without_set_params() {
    let root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/desktop-machine-audio-resume");
    std::fs::create_dir_all(&root).unwrap();
    for envelope in [false, true] {
        let source_path = root.join(format!("retained-source-{envelope}.wav"));
        let target_path = root.join(format!("retained-target-{envelope}.wav"));
        let mut source = Rig::empty(&source_path);
        source.initialize_source(HIGH_CLOCK);
        let old_samples = source.play_period(0, 480, 99);
        assert_eq!(
            source
                .machine
                .virtio_snd()
                .unwrap()
                .1
                .borrow()
                .stream
                .state(),
            PcmState::Stopped
        );
        source.lifecycle(snd::VIRTIO_SND_R_PCM_RELEASE);
        let params = source
            .machine
            .virtio_snd()
            .unwrap()
            .1
            .borrow()
            .stream
            .params()
            .unwrap();
        let resume = source.machine.save_resume().unwrap();
        let desktop = source.machine.save_desktop_snapshot().unwrap();
        let mut target = Rig::empty(&target_path);
        assert_eq!(
            target
                .machine
                .virtio_snd()
                .unwrap()
                .1
                .borrow()
                .stream
                .params(),
            None
        );
        assert_eq!(Ring::sound(snd::TX_QUEUE).used_idx(&mut target.machine), 0);
        assert!(!Rc::ptr_eq(&source.wav.0, &target.wav.0));
        assert!(!Rc::ptr_eq(&source.clock, &target.clock));
        target.machine.load_resume(&resume).unwrap();
        if envelope {
            target.fresh_hello();
            target
                .machine
                .restore_desktop_snapshot(&desktop, DisplaySize::new(1280, 720))
                .unwrap();
        }
        let state = target.machine.virtio_snd().unwrap().1;
        assert_eq!(state.borrow().stream.state(), PcmState::Released);
        assert_eq!(state.borrow().stream.params(), Some(params));
        assert_eq!(target.wav.bytes(), 0);
        assert_eq!(target.clock.now_ns(), 0);
        assert_eq!(
            target
                .machine
                .bus_mut()
                .load32(Platform::virtio_base(SND_SLOT as u64) + STATUS),
            Ok(DRIVER_OK)
        );
        assert_eq!(Ring::sound(snd::TX_QUEUE).used_idx(&mut target.machine), 1);
        assert_eq!(
            Ring::sound(snd::EVENT_QUEUE).used_idx(&mut target.machine),
            1
        );
        target.lifecycle(snd::VIRTIO_SND_R_PCM_PREPARE);
        let new_samples = play_recovery_period(&mut target, 1, 480, 2701);
        source.wav.finish_and_check(&source_path, &old_samples);
        target.wav.finish_and_check(&target_path, &new_samples);
    }
}

#[test]
fn control_release_completes_pending_io_before_response_and_following_prepare() {
    let root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/desktop-machine-audio-resume");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("release-order.wav");
    let mut rig = Rig::empty(&path);
    rig.initialize_source(0);
    let params = PcmParams {
        period_bytes: 1920,
        buffer_bytes: 3840,
        ..PcmParams::default()
    };
    rig.command(&params.to_bytes());
    rig.lifecycle(snd::VIRTIO_SND_R_PCM_PREPARE);
    post_recovery_period(&mut rig, 0, 480, 71);
    rig.lifecycle(snd::VIRTIO_SND_R_PCM_START);
    let state = rig.machine.virtio_snd().unwrap().1;
    assert_eq!(state.borrow().playback_pending_count(), 1);
    rig.lifecycle(snd::VIRTIO_SND_R_PCM_STOP);
    let control = Ring::sound(snd::CONTROL_QUEUE);
    let tx = Ring::sound(snd::TX_QUEUE);
    let ordinal = control.used_idx(&mut rig.machine);
    // Alias RELEASE's response with the pending I/O status. Correct ordering leaves OK;
    // publishing the response before flushing I/O leaves IO_ERR and falsifies this assertion.
    for (index, code) in [snd::VIRTIO_SND_R_PCM_RELEASE, snd::VIRTIO_SND_R_PCM_PREPARE]
        .into_iter()
        .enumerate()
    {
        let current = ordinal + index as u16;
        let head = (current % (QSIZE / 2)) * 2;
        let data = control.data() + u64::from(head) * 0x80;
        rig.machine.bus_mut().store32(data, code).unwrap();
        rig.machine.bus_mut().store32(data + 4, 0).unwrap();
        let status = if index == 0 { tx.status() } else { data + 0x40 };
        control.descriptor(&mut rig.machine, head, data, 8, NEXT, head + 1);
        control.descriptor(&mut rig.machine, head + 1, status, 4, WRITE, 0);
        control.post(&mut rig.machine, current, head);
    }
    rig.step();
    assert_eq!(control.used_idx(&mut rig.machine), ordinal + 2);
    assert_eq!(
        rig.machine.bus_mut().load32(tx.status()),
        Ok(snd::VIRTIO_SND_S_OK)
    );
    tx.assert_completion(&mut rig.machine, 0, 0, 8);
    assert_eq!(state.borrow().playback_pending_count(), 0);
    assert_eq!(state.borrow().stream.state(), PcmState::Prepared);
    assert_eq!(state.borrow().stream.params(), Some(params));
    assert_eq!(rig.wav.bytes(), 0);
    let samples = play_recovery_period(&mut rig, 1, 480, 1701);
    rig.wav.finish_and_check(&path, &samples);
}
