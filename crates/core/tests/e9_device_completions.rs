#![cfg(not(feature = "zicsr-stub"))]
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    session_clock::{SessionDelivery, SessionEffect},
    session_devices::{
        BaseDisk, CompletionStatus as Status, DeviceCompletion, DeviceError, DeviceIntent,
        PayloadRef,
    },
    trace::{TraceRecord, TraceSink, fmt_canonical},
};
const PROGRAM: &[u8] = include_bytes!("../../../web/assets/e9-device-completions.bin");
const START: u64 = 4096;
#[derive(Default)]
struct Trace(String);
impl TraceSink for Trace {
    fn retire(&mut self, record: &TraceRecord) {
        self.0.push_str(&fmt_canonical(record).to_string());
        self.0.push('\n');
    }
}
fn payload(chunk: u32) -> Vec<u8> {
    (0..512)
        .map(|n| ((n * 13 + chunk as usize * 79 + 17) % 251) as u8)
        .collect()
}
fn fixture(replay: bool) -> Machine {
    let mut machine = Machine::new(1 << 20);
    machine.enable_clint(1);
    machine.enable_plic();
    machine.start_session_clock(1).unwrap();
    machine
        .enable_session_devices(
            Some(BaseDisk {
                identity: [37; 32],
                sectors: 2,
                chunk_bytes: 512,
                chunks: (0..2)
                    .map(|n| PayloadRef::of(&payload(n)).unwrap())
                    .collect(),
            }),
            true,
            true,
            replay,
        )
        .unwrap();
    machine.bus_mut().write_ram_slice(BASE, PROGRAM).unwrap();
    machine.hart_mut().regs.pc = BASE;
    machine
}
fn until(machine: &mut Machine, target: u64, quantum: u64, trace: &mut Trace) {
    while machine.session_position().unwrap().transition < target {
        assert_eq!(
            machine
                .run_session_until_traced(target, quantum, trace)
                .unwrap(),
            RunOutcome::MaxInstrs
        );
    }
}
fn capture(
    machine: &mut Machine,
    id: u64,
    status: Status,
    bytes: Vec<u8>,
    frames: u32,
) -> SessionDelivery {
    let lease = machine.lease_session_device(id).unwrap();
    machine
        .complete_session_device(&lease, status, frames, bytes)
        .unwrap();
    let mut deliveries = machine.take_session_deliveries().unwrap();
    assert_eq!(deliveries.len(), 1);
    deliveries.remove(0)
}
fn replay(machine: &mut Machine, receipt: &SessionDelivery) {
    let SessionEffect::HostInput { channel, bytes } = &receipt.effect else {
        panic!("completion receipt")
    };
    assert_eq!(*channel, 19);
    machine
        .replay_session_device(receipt.position, DeviceCompletion::decode(bytes).unwrap())
        .unwrap();
    assert_eq!(
        machine.take_session_deliveries().unwrap(),
        vec![receipt.clone()]
    );
}
fn evidence(name: &str, bytes: &[u8]) {
    if let Some(dir) = std::env::var_os("E9_DEVICE_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), bytes).unwrap();
    }
}

#[test]
fn real_guest_dma_replays_reordered_delayed_callbacks_with_pending_checkpoints() {
    let mut worker = fixture(false);
    let mut original = Trace::default();
    until(&mut worker, START, 37, &mut original);
    let requests = worker.session_device_requests().unwrap();
    assert_eq!(
        requests.len(),
        4,
        "two base chunks, posted agent receive and real capture quantum"
    );
    assert_eq!(worker.bus_mut().load16(BASE + 0x12002), Ok(0));
    assert_eq!(worker.bus_mut().load16(BASE + 0x32302), Ok(0));
    assert!(
        worker
            .virtio_console()
            .unwrap()
            .borrow()
            .agent_ready_for_host()
    );
    let agent = requests
        .iter()
        .find(|r| matches!(r.intent, DeviceIntent::Agent { .. }))
        .unwrap()
        .clone();
    let audio = requests
        .iter()
        .find(|r| matches!(r.intent, DeviceIntent::Capture { .. }))
        .unwrap()
        .clone();
    let pending = worker.save_session_resume().unwrap();
    evidence("pending.resume", &pending);
    let stale = worker.lease_session_device(requests[0].id).unwrap();
    let mut receipts = Vec::new();
    for (offset, request) in [requests[1].clone(), agent, audio, requests[0].clone()]
        .iter()
        .enumerate()
    {
        until(&mut worker, START + offset as u64 * 173, 29, &mut original);
        let (bytes, frames) = match request.intent {
            DeviceIntent::BaseBlock { chunk, .. } => (payload(chunk), 0),
            DeviceIntent::Agent { .. } => (b"file-agent-owned-result".to_vec(), 0),
            DeviceIntent::Capture { .. } => (vec![0x34, 0x12, 0xcd, 0xab], 2),
        };
        receipts.push(capture(
            &mut worker,
            request.id,
            Status::Supplied,
            bytes,
            frames,
        ));
    }
    until(&mut worker, START + 5000, 101, &mut original);
    let frame = worker.save_session_resume().unwrap();
    assert_eq!(worker.bus_mut().load16(BASE + 0x12002), Ok(2));
    assert_eq!(
        worker.bus_mut().load32(BASE + 0x12004),
        Ok(3),
        "second block completed first"
    );
    assert_eq!(worker.bus_mut().load32(BASE + 0x1200c), Ok(0));
    assert_eq!(worker.bus_mut().load16(BASE + 0x22402), Ok(1));
    assert_eq!(worker.bus_mut().load16(BASE + 0x32302), Ok(1));
    assert_eq!(worker.bus_mut().load32(BASE + 0x34100), Ok(0xabcd1234));
    for (n, byte) in b"file-agent-owned-result".iter().enumerate() {
        assert_eq!(worker.bus_mut().load8(BASE + 0x24000 + n as u64), Ok(*byte));
    }
    for chunk in 0..2 {
        for (n, byte) in payload(chunk).iter().enumerate() {
            assert_eq!(
                worker
                    .bus_mut()
                    .load8(BASE + 0x14000 + u64::from(chunk) * 0x400 + n as u64),
                Ok(*byte)
            );
        }
    }
    for slot in [0, 6, 7] {
        assert_eq!(
            worker
                .bus_mut()
                .load32(0x10001000 + slot * 0x1000 + 0x60)
                .unwrap()
                & 1,
            1
        );
    }
    for quantum in [1, 7, 4096] {
        let mut replayed = fixture(true);
        let mut trace = Trace::default();
        replayed.load_session_resume(&pending).unwrap();
        assert!(matches!(
            replayed.lease_session_device(requests[0].id),
            Err(DeviceError::ReplayIngress)
        ));
        for receipt in &receipts {
            until(
                &mut replayed,
                receipt.position.transition,
                quantum,
                &mut trace,
            );
            replay(&mut replayed, receipt);
        }
        until(&mut replayed, START + 5000, quantum, &mut trace);
        assert_eq!(
            replayed.save_session_resume().unwrap(),
            frame,
            "all CPU/RAM/device/COW/cursor bytes, quantum={quantum}"
        );
        evidence(&format!("replay-{quantum}.trace"), trace.0.as_bytes());
    }
    worker.load_session_resume(&pending).unwrap();
    let before = worker.save_session_resume().unwrap();
    assert_eq!(
        worker.complete_session_device(&stale, Status::Supplied, 0, payload(0)),
        Err(DeviceError::StaleLease)
    );
    assert_eq!(worker.save_session_resume().unwrap(), before);
    let mut log = Vec::new();
    for receipt in &receipts {
        let SessionEffect::HostInput { bytes, .. } = &receipt.effect else {
            unreachable!()
        };
        log.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        log.extend_from_slice(bytes);
    }
    let positions = receipts
        .iter()
        .map(|r| {
            format!(
                "{}\t{}\t{}\t{}\n",
                r.position.transition, r.position.retired, r.position.ordinal, r.position.sequence
            )
        })
        .collect::<String>();
    evidence("completion-positions.tsv", positions.as_bytes());
    evidence("completion-envelopes.bin", &log);
    evidence("original.trace", original.0.as_bytes());
    evidence("final.resume", &frame);
}

#[test]
fn duplicate_cancelled_and_corrupt_results_cannot_publish_dma_or_advance_cursor() {
    let mut machine = fixture(false);
    until(&mut machine, START, 128, &mut Trace::default());
    let request = machine.session_device_requests().unwrap()[0].clone();
    let lease = machine.lease_session_device(request.id).unwrap();
    let before = machine.save_session_resume().unwrap();
    let mut bad = payload(0);
    bad[17] ^= 1;
    assert_eq!(
        machine.complete_session_device(&lease, Status::Supplied, 0, bad),
        Err(DeviceError::Payload)
    );
    assert_eq!(machine.save_session_resume().unwrap(), before);
    machine
        .complete_session_device(&lease, Status::Cancelled, 0, vec![])
        .unwrap();
    let receipt = machine.take_session_deliveries().unwrap().remove(0);
    let cancelled = machine.save_session_resume().unwrap();
    assert_eq!(
        machine.complete_session_device(&lease, Status::Supplied, 0, payload(0)),
        Err(DeviceError::UnknownRequest)
    );
    assert_eq!(machine.save_session_resume().unwrap(), cancelled);
    until(&mut machine, START + 3, 1, &mut Trace::default());
    assert_eq!(machine.bus_mut().load8(BASE + 0x15000), Ok(1));
    assert_eq!(machine.bus_mut().load8(BASE + 0x14000), Ok(0));
    assert_eq!(machine.bus_mut().load16(BASE + 0x12002), Ok(1));
    evidence("cancel-before.resume", &before);
    evidence("cancelled.resume", &cancelled);
    if let SessionEffect::HostInput { bytes, .. } = receipt.effect {
        evidence("cancelled.completion", &bytes);
    }
}

#[test]
fn derived_cow_writes_flushes_and_base_reads_restore_without_host_completions() {
    let mut machine = fixture(false);
    let mut trace = Trace::default();
    until(&mut machine, START, 128, &mut trace);
    for request in machine.session_device_requests().unwrap() {
        if let DeviceIntent::BaseBlock { chunk, .. } = request.intent {
            capture(
                &mut machine,
                request.id,
                Status::Supplied,
                payload(chunk),
                0,
            );
        }
    }
    until(&mut machine, START + 2, 1, &mut trace);
    let remaining = machine.session_device_requests().unwrap();
    for (ordinal, rtype, writable) in [(2u16, 1u32, false), (3, 0, true), (4, 4, true)] {
        machine.bus_mut().store32(BASE + 0x13000, rtype).unwrap();
        machine
            .bus_mut()
            .store64(BASE + 0x13008, if rtype == 4 { 0 } else { 1 })
            .unwrap();
        if rtype == 1 {
            machine
                .bus_mut()
                .write_ram_slice(BASE + 0x14000, &[0xa6; 512])
                .unwrap();
        } else if rtype == 0 {
            machine
                .bus_mut()
                .write_ram_slice(BASE + 0x14000, &[0; 512])
                .unwrap();
        }
        machine.bus_mut().store16(BASE + 0x1000c, 1).unwrap();
        machine
            .bus_mut()
            .store16(BASE + 0x1000e, if rtype == 4 { 2 } else { 1 })
            .unwrap();
        machine
            .bus_mut()
            .store16(BASE + 0x1001c, 1 | if writable { 2 } else { 0 })
            .unwrap();
        machine
            .bus_mut()
            .store16(BASE + 0x11004 + u64::from(ordinal) * 2, 0)
            .unwrap();
        machine
            .bus_mut()
            .store16(BASE + 0x11002, ordinal + 1)
            .unwrap();
        machine.bus_mut().store32(0x10001050, 0).unwrap();
        let target = machine.session_position().unwrap().transition + 2;
        until(&mut machine, target, 1, &mut trace);
        assert_eq!(machine.bus_mut().load16(BASE + 0x12002), Ok(ordinal + 1));
        assert_eq!(machine.bus_mut().load8(BASE + 0x15000), Ok(0));
        assert_eq!(machine.session_device_requests().unwrap(), remaining);
        if rtype == 0 {
            for i in 0..512 {
                assert_eq!(machine.bus_mut().load8(BASE + 0x14000 + i), Ok(0xa6));
            }
        }
    }
    let frame = machine.save_session_resume().unwrap();
    let mut restored = fixture(true);
    restored.load_session_resume(&frame).unwrap();
    assert_eq!(restored.save_session_resume().unwrap(), frame);
    evidence("cow.resume", &frame);
    evidence("cow.trace", trace.0.as_bytes());
}

#[test]
fn malformed_pending_device_and_audio_frames_are_transactional_and_keep_live_leases() {
    use wasm_vm_core::resume::{SectionReader, SnapshotWriter, section};
    let mut machine = fixture(false);
    until(&mut machine, START, 128, &mut Trace::default());
    let frame = machine.save_session_resume().unwrap();
    let request = machine.session_device_requests().unwrap()[0].clone();
    let lease = machine.lease_session_device(request.id).unwrap();
    for attack in 0..5 {
        let (header, sections) = SectionReader::new(&frame).unwrap();
        let mut writer = SnapshotWriter::new(
            &header.core_hash,
            &header.base_image_hash,
            header.overlay_generation,
        );
        for section in sections {
            let section = section.unwrap();
            let mut bytes = section.payload.to_vec();
            if section.tag == section::SESSION_DEVICES {
                match attack {
                    0 => bytes.push(0),
                    1 => bytes[12] ^= 1,
                    2 => {
                        bytes.truncate(31);
                    }
                    _ => {}
                }
            }
            if section.tag == section::VIRTIO_SND {
                match attack {
                    3 => bytes.push(0),
                    4 => {
                        bytes.truncate(bytes.len() - 1);
                    }
                    _ => {}
                }
            }
            writer.section(section.tag, &bytes);
        }
        assert!(machine.load_session_resume(&writer.finish()).is_err());
        assert_eq!(
            machine.save_session_resume().unwrap(),
            frame,
            "failed restore mutates nothing, attack={attack}"
        );
    }
    machine
        .complete_session_device(&lease, Status::Supplied, 0, payload(0))
        .unwrap();
    machine.take_session_deliveries().unwrap();
    assert_eq!(machine.session_device_cursor(), Ok(1));
    evidence("malformed-source.resume", &frame);
}

#[test]
fn orphaned_capture_checkpoint_is_rejected_before_state_or_leases_change() {
    use wasm_vm_core::resume::{SectionReader, SnapshotWriter, section};
    let mut machine = fixture(false);
    until(&mut machine, START, 13, &mut Trace::default());
    let before = machine.save_session_resume().unwrap();
    let request = machine.session_device_requests().unwrap()[0].clone();
    let live = machine.lease_session_device(request.id).unwrap();
    for erase_request in [false, true] {
        let (header, sections) = SectionReader::new(&before).unwrap();
        let mut writer = SnapshotWriter::new(
            &header.core_hash,
            &header.base_image_hash,
            header.overlay_generation,
        );
        for section in sections {
            let section = section.unwrap();
            let mut bytes = section.payload.to_vec();
            if section.tag == section::SESSION_DEVICES {
                let mut hub_length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
                let owner = 4 + hub_length - 9;
                assert_eq!(
                    u64::from_le_bytes(bytes[owner..owner + 8].try_into().unwrap()),
                    4
                );
                bytes[owner..owner + 8].fill(0);
                if erase_request {
                    // The fixture has no ready capture result. Remove its pending request as
                    // well: a due real sound descriptor still requires an owned request.
                    let config_length =
                        u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
                    let count_at = 16 + config_length + 32;
                    let count =
                        u32::from_le_bytes(bytes[count_at..count_at + 4].try_into().unwrap());
                    let mut at = count_at + 4;
                    for _ in 0..count {
                        let size = match bytes[at + 8] {
                            1 => 49,
                            2 => 21,
                            3 => 18,
                            _ => panic!("unknown fixture request"),
                        };
                        if bytes[at + 8] == 3 {
                            bytes.drain(at..at + size);
                            bytes[count_at..count_at + 4]
                                .copy_from_slice(&(count - 1).to_le_bytes());
                            hub_length -= size;
                            bytes[..4].copy_from_slice(&(hub_length as u32).to_le_bytes());
                            break;
                        }
                        at += size;
                    }
                }
            }
            writer.section(section.tag, &bytes);
        }
        let malformed = writer.finish();
        evidence(
            &format!("orphaned-capture-{erase_request}.resume"),
            &malformed,
        );
        assert!(machine.load_session_resume(&malformed).is_err());
        assert_eq!(machine.save_session_resume().unwrap(), before);
    }
    machine
        .complete_session_device(&live, Status::Supplied, 0, payload(0))
        .unwrap();
    machine.take_session_deliveries().unwrap();
    evidence("orphaned-capture-source.resume", &before);
}

#[test]
fn future_capture_descriptor_restores_without_creating_a_request_early() {
    let mut machine = fixture(false);
    let mut trace = Trace::default();
    until(&mut machine, 1605, 7, &mut trace);
    assert!(
        machine
            .session_device_requests()
            .unwrap()
            .iter()
            .all(|request| { !matches!(request.intent, DeviceIntent::Capture { .. }) })
    );
    let future = machine.save_session_resume().unwrap();
    let mut restored = fixture(false);
    restored.load_session_resume(&future).unwrap();
    assert_eq!(restored.save_session_resume().unwrap(), future);
    until(&mut machine, START, 13, &mut trace);
    until(&mut restored, START, 17, &mut Trace::default());
    assert_eq!(
        restored.save_session_resume().unwrap(),
        machine.save_session_resume().unwrap()
    );
    assert_eq!(restored.session_device_requests().unwrap().len(), 4);
    evidence("capture-future.resume", &future);
    evidence("capture-future.trace", trace.0.as_bytes());
}

#[test]
fn short_failed_capture_and_guest_stop_never_consume_an_obsolete_quantum() {
    use wasm_vm_core::dev::virtio::snd;
    for (name, status, frames, bytes, expected, pcm_status) in [
        (
            "short",
            Status::Supplied,
            1,
            vec![0x67, 0x45],
            0x00004567,
            snd::VIRTIO_SND_S_OK,
        ),
        (
            "failed",
            Status::Failed,
            0,
            vec![],
            0,
            snd::SndStatus::IoErr as u32,
        ),
    ] {
        let mut machine = fixture(false);
        let mut trace = Trace::default();
        until(&mut machine, START, 17, &mut trace);
        let request = machine
            .session_device_requests()
            .unwrap()
            .into_iter()
            .find(|r| matches!(r.intent, DeviceIntent::Capture { .. }))
            .unwrap();
        let receipt = capture(&mut machine, request.id, status, bytes, frames);
        let paused = machine.save_session_resume().unwrap();
        until(&mut machine, START + 2, 1, &mut trace);
        assert_eq!(machine.bus_mut().load32(BASE + 0x34100), Ok(expected));
        assert_eq!(machine.bus_mut().load32(BASE + 0x34200), Ok(pcm_status));
        assert_eq!(machine.bus_mut().load16(BASE + 0x32302), Ok(1));
        let final_frame = machine.save_session_resume().unwrap();
        let mut resumed = fixture(true);
        resumed.load_session_resume(&paused).unwrap();
        until(&mut resumed, START + 2, 7, &mut Trace::default());
        assert_eq!(resumed.save_session_resume().unwrap(), final_frame);
        evidence(&format!("capture-{name}-ready.resume"), &paused);
        evidence(&format!("capture-{name}-final.resume"), &final_frame);
        evidence(&format!("capture-{name}.trace"), trace.0.as_bytes());
        if let SessionEffect::HostInput { bytes, .. } = receipt.effect {
            evidence(&format!("capture-{name}.completion"), &bytes);
        }
    }
    let mut machine = fixture(false);
    let mut trace = Trace::default();
    until(&mut machine, START, 17, &mut trace);
    let request = machine
        .session_device_requests()
        .unwrap()
        .into_iter()
        .find(|r| matches!(r.intent, DeviceIntent::Capture { .. }))
        .unwrap();
    let lease = machine.lease_session_device(request.id).unwrap();
    // Post a real STOP on the next controlq descriptor; the guest lifecycle cancels its provider
    // request before the next host callback can run, including a callback at this paused boundary.
    for (offset, value) in [(0, snd::VIRTIO_SND_R_PCM_STOP), (4, 1)] {
        machine
            .bus_mut()
            .store32(BASE + 0x33300 + offset, value)
            .unwrap();
    }
    for (index, address, length, flags, next) in
        [(6, BASE + 0x33300, 8, 1, 7), (7, BASE + 0x33380, 4, 2, 0)]
    {
        let entry = BASE + 0x30000 + index * 16;
        machine.bus_mut().store64(entry, address).unwrap();
        machine.bus_mut().store32(entry + 8, length).unwrap();
        machine.bus_mut().store16(entry + 12, flags).unwrap();
        machine.bus_mut().store16(entry + 14, next).unwrap();
    }
    machine.bus_mut().store16(BASE + 0x3100a, 6).unwrap();
    machine.bus_mut().store16(BASE + 0x31002, 4).unwrap();
    machine.bus_mut().store32(0x10007050, 0).unwrap();
    until(&mut machine, START + 1, 1, &mut trace);
    let before = machine.save_session_resume().unwrap();
    assert_eq!(
        machine.complete_session_device(&lease, Status::Supplied, 2, vec![1, 2, 3, 4]),
        Err(DeviceError::UnknownRequest)
    );
    assert_eq!(machine.save_session_resume().unwrap(), before);
    assert_eq!(machine.bus_mut().load16(BASE + 0x32302), Ok(0));
    evidence("capture-stopped.resume", &before);
    evidence("capture-stopped.trace", trace.0.as_bytes());
}

#[test]
fn varied_callback_schedules_replay_exactly_for_32_independent_seeds() {
    use sha2::{Digest, Sha256};
    let mut summary = String::new();
    for seed in 1..=32u64 {
        let mut state = seed.wrapping_mul(0x9e3779b97f4a7c15);
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        let mut machine = fixture(false);
        until(&mut machine, START, 7, &mut Trace::default());
        let pending = machine.save_session_resume().unwrap();
        let mut requests = machine.session_device_requests().unwrap();
        for i in (1..requests.len()).rev() {
            requests.swap(i, next() as usize % (i + 1));
        }
        let mut records = Vec::new();
        let mut target = START;
        for request in requests {
            target += next() % 13 + 1;
            until(&mut machine, target, 17, &mut Trace::default());
            let (bytes, frames) = match request.intent {
                DeviceIntent::BaseBlock { chunk, .. } => (payload(chunk), 0),
                DeviceIntent::Agent { .. } => (vec![seed as u8; 17], 0),
                DeviceIntent::Capture { .. } => (vec![seed as u8, 0, 0, seed as u8], 2),
            };
            records.push(capture(
                &mut machine,
                request.id,
                Status::Supplied,
                bytes,
                frames,
            ));
        }
        until(&mut machine, START + 256, 31, &mut Trace::default());
        let frame = machine.save_session_resume().unwrap();
        let mut replayed = fixture(true);
        replayed.load_session_resume(&pending).unwrap();
        for record in &records {
            until(
                &mut replayed,
                record.position.transition,
                1 + next() % 29,
                &mut Trace::default(),
            );
            replay(&mut replayed, record);
        }
        until(&mut replayed, START + 256, 4096, &mut Trace::default());
        assert_eq!(
            replayed.save_session_resume().unwrap(),
            frame,
            "callback schedule seed={seed}"
        );
        summary.push_str(&format!(
            "{seed}\t{:x}\t{}\n",
            Sha256::digest(&frame),
            records
                .iter()
                .map(|r| r.position.transition.to_string())
                .collect::<Vec<_>>()
                .join(",")
        ));
        evidence(&format!("stress-seed-{seed}.resume"), &frame);
    }
    evidence("stress.tsv", summary.as_bytes());
}

#[test]
fn unrecorded_transport_and_playback_admission_refuse_before_guest_execution() {
    use wasm_vm_core::{block::MemBackend, dev::virtio::snd, session_clock::SessionError};
    let mut legacy = Machine::new(1 << 20);
    legacy.enable_plic();
    legacy.enable_virtio_blk(Box::new(MemBackend::new(vec![0; 512])));
    legacy.start_session_clock(1).unwrap();
    let before = legacy.save_session_resume().unwrap();
    assert_eq!(
        legacy.enable_session_devices(None, true, true, false),
        Err(DeviceError::Unsupported)
    );
    assert_eq!(legacy.save_session_resume().unwrap(), before);
    let mut machine = fixture(false);
    let mut trace = Trace::default();
    until(&mut machine, START, 17, &mut trace);
    let position = machine.session_position().unwrap();
    let commands = [
        snd::PcmParams {
            buffer_bytes: 16,
            period_bytes: 4,
            ..Default::default()
        }
        .to_bytes()
        .to_vec(),
        snd::VIRTIO_SND_R_PCM_PREPARE
            .to_le_bytes()
            .into_iter()
            .chain(0u32.to_le_bytes())
            .collect(),
        snd::VIRTIO_SND_R_PCM_START
            .to_le_bytes()
            .into_iter()
            .chain(0u32.to_le_bytes())
            .collect(),
    ];
    for (i, command) in commands.iter().enumerate() {
        let address = BASE + 0x33300 + i as u64 * 0x100;
        machine.bus_mut().write_ram_slice(address, command).unwrap();
        let head = 6 + i as u64 * 2;
        for (index, addr, length, flags, next) in [
            (head, address, command.len() as u32, 1, head + 1),
            (head + 1, address + 0x80, 4, 2, 0),
        ] {
            let entry = BASE + 0x30000 + index * 16;
            machine.bus_mut().store64(entry, addr).unwrap();
            machine.bus_mut().store32(entry + 8, length).unwrap();
            machine.bus_mut().store16(entry + 12, flags).unwrap();
            machine.bus_mut().store16(entry + 14, next as u16).unwrap();
        }
        machine
            .bus_mut()
            .store16(BASE + 0x3100a + i as u64 * 2, head as u16)
            .unwrap();
    }
    machine.bus_mut().store16(BASE + 0x31002, 6).unwrap();
    machine.bus_mut().store32(0x10007050, 0).unwrap();
    assert_eq!(
        machine.run(10),
        RunOutcome::SessionStopped(SessionError::DeviceCompletion(DeviceError::Unsupported))
    );
    assert_eq!(machine.session_position(), Some(position));
    assert!(machine.save_session_resume().is_err());
    evidence("unsupported-playback.trace", trace.0.as_bytes());
    evidence("unsupported-playback.txt",format!("position={position:?}\nUnsupported before the next retirement; no unrecorded playback admitted.\n").as_bytes());
}

#[test]
fn every_initial_device_profile_roundtrips_before_the_first_transition() {
    for has_base in [false, true] {
        for agent in [false, true] {
            for capture in [false, true] {
                let make = |replay| {
                    let mut machine = Machine::new(1 << 20);
                    machine.enable_clint(1);
                    machine.start_session_clock(1).unwrap();
                    let base = has_base.then(|| BaseDisk {
                        identity: [37; 32],
                        sectors: 2,
                        chunk_bytes: 512,
                        chunks: (0..2)
                            .map(|n| PayloadRef::of(&payload(n)).unwrap())
                            .collect(),
                    });
                    machine
                        .enable_session_devices(base, agent, capture, replay)
                        .unwrap();
                    machine
                };
                let mut machine = make(false);
                let initial = machine.save_session_resume().unwrap();
                assert_eq!(machine.session_position().unwrap().transition, 0);
                assert!(machine.session_device_requests().unwrap().is_empty());
                let mut restored = make(true);
                restored.load_session_resume(&initial).unwrap();
                assert_eq!(
                    restored.save_session_resume().unwrap(),
                    initial,
                    "base={has_base} agent={agent} capture={capture}"
                );
                evidence(
                    &format!("initial-base{has_base}-agent{agent}-capture{capture}.resume"),
                    &initial,
                );
            }
        }
    }
}

#[test]
fn disabled_capture_rejects_noncanonical_clock_and_epoch_transactionally() {
    use wasm_vm_core::resume::{SectionReader, SnapshotWriter, section};
    let mut machine = Machine::new(1 << 20);
    machine.enable_clint(1);
    machine.start_session_clock(1).unwrap();
    machine
        .enable_session_devices(None, true, false, false)
        .unwrap();
    let before = machine.save_session_resume().unwrap();
    for field in [2, 3] {
        let (header, sections) = SectionReader::new(&before).unwrap();
        let mut writer = SnapshotWriter::new(
            &header.core_hash,
            &header.base_image_hash,
            header.overlay_generation,
        );
        for section in sections {
            let section = section.unwrap();
            let mut bytes = section.payload.to_vec();
            if section.tag == section::SESSION_DEVICES {
                let config_length = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
                let at = 16 + config_length + field * 8;
                assert_eq!(&bytes[at..at + 8], &[0; 8]);
                bytes[at..at + 8].copy_from_slice(&1u64.to_le_bytes());
            }
            writer.section(section.tag, &bytes);
        }
        let invalid = writer.finish();
        assert!(machine.load_session_resume(&invalid).is_err());
        assert_eq!(machine.save_session_resume().unwrap(), before);
        evidence(
            &format!("disabled-capture-invalid-field{field}.resume"),
            &invalid,
        );
    }
}

// Fresh critic regressions: recorded independently before promotion.
fn critic_rewrite_section(frame: &[u8], tag: u32, change: impl Fn(&mut Vec<u8>)) -> Vec<u8> {
    use wasm_vm_core::resume::{SectionReader, SnapshotWriter};
    let (header, sections) = SectionReader::new(frame).unwrap();
    let mut writer = SnapshotWriter::new(
        &header.core_hash,
        &header.base_image_hash,
        header.overlay_generation,
    );
    for section in sections {
        let section = section.unwrap();
        let mut bytes = section.payload.to_vec();
        if section.tag == tag {
            change(&mut bytes);
        }
        writer.section(section.tag, &bytes);
    }
    writer.finish()
}

#[test]
fn critic_wrong_replay_positions_and_foreign_leases_are_transactional() {
    let mut machine = fixture(false);
    until(&mut machine, START, 17, &mut Trace::default());
    let pending = machine.save_session_resume().unwrap();
    let request = machine.session_device_requests().unwrap()[0].clone();
    let foreign = machine.lease_session_device(request.id).unwrap();
    let receipt = capture(&mut machine, request.id, Status::Supplied, payload(0), 0);
    let SessionEffect::HostInput { bytes, .. } = &receipt.effect else {
        unreachable!()
    };
    let mut replayed = fixture(true);
    replayed.load_session_resume(&pending).unwrap();
    let before = replayed.save_session_resume().unwrap();
    for field in 0..5 {
        let mut position = receipt.position;
        match field {
            0 => position.transition += 1,
            1 => position.retired += 1,
            2 => position.sequence += 1,
            3 => position.ordinal += 1,
            _ => position.phase = wasm_vm_core::session_clock::SessionPhase::Observe,
        }
        assert_eq!(
            replayed.replay_session_device(position, DeviceCompletion::decode(bytes).unwrap()),
            Err(DeviceError::Position)
        );
        assert_eq!(replayed.save_session_resume().unwrap(), before);
    }
    let mut other = fixture(false);
    until(&mut other, START, 23, &mut Trace::default());
    let before = other.save_session_resume().unwrap();
    assert_eq!(
        other.complete_session_device(&foreign, Status::Supplied, 0, payload(0)),
        Err(DeviceError::StaleLease)
    );
    assert_eq!(other.save_session_resume().unwrap(), before);
    replay(&mut replayed, &receipt);
    assert_eq!(replayed.session_device_cursor(), Ok(1));
    evidence("critic-position-unchanged.resume", &before);
}

#[test]
fn critic_same_boundary_callbacks_replay_for_independent_seeds() {
    use sha2::{Digest, Sha256};
    let mut summary = String::new();
    for seed in [
        101u64,
        1009,
        65537,
        0x12345678,
        0x100000001,
        0x123456789abcdef,
    ] {
        let mut rng = seed;
        let mut next = || {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            rng
        };
        let mut machine = fixture(false);
        until(&mut machine, START, 43, &mut Trace::default());
        let pending = machine.save_session_resume().unwrap();
        let mut requests = machine.session_device_requests().unwrap();
        for i in (1..requests.len()).rev() {
            requests.swap(i, next() as usize % (i + 1));
        }
        let mut receipts = Vec::new();
        for (index, request) in requests.into_iter().enumerate() {
            let (bytes, frames) = match request.intent {
                DeviceIntent::BaseBlock { chunk, .. } => (payload(chunk), 0),
                DeviceIntent::Agent { .. } => (vec![seed as u8; 31], 0),
                DeviceIntent::Capture { .. } => (vec![17, 34, 51, 68], 2),
            };
            let receipt = capture(&mut machine, request.id, Status::Supplied, bytes, frames);
            assert_eq!(receipt.position.ordinal, index as u32 + 1);
            assert_eq!(receipt.position.transition, START);
            receipts.push(receipt);
        }
        until(&mut machine, START + 256, 97, &mut Trace::default());
        let final_frame = machine.save_session_resume().unwrap();
        for quantum in [1, 8, 257] {
            let mut re = fixture(true);
            re.load_session_resume(&pending).unwrap();
            for receipt in &receipts {
                replay(&mut re, receipt);
            }
            until(&mut re, START + 256, quantum, &mut Trace::default());
            assert_eq!(re.save_session_resume().unwrap(), final_frame);
        }
        summary.push_str(&format!(
            "{seed}\t{:x}\t{:?}\n",
            Sha256::digest(&final_frame),
            receipts
                .iter()
                .map(|r| r.position.ordinal)
                .collect::<Vec<_>>()
        ));
    }
    evidence("critic-independent-schedules.tsv", summary.as_bytes());
}

#[test]
fn critic_stereo_capture_pending_ready_short_failure_and_restore() {
    use wasm_vm_core::dev::virtio::snd;
    let mut program = PROGRAM.to_vec();
    let sites: Vec<_> = program
        .chunks_exact(4)
        .enumerate()
        .filter_map(|(i, b)| (u32::from_le_bytes(b.try_into().unwrap()) == 0x00550a23).then_some(i))
        .collect();
    assert_eq!(sites.len(), 1);
    let at = (sites[0] - 3) * 4;
    assert_eq!(
        u32::from_le_bytes(program[at..at + 4].try_into().unwrap()),
        0x00128293
    );
    program[at..at + 4].copy_from_slice(&0x00228293u32.to_le_bytes());
    for (status, frames, bytes, want, pcm_status) in [
        (
            Status::Supplied,
            1,
            vec![0x34, 0x12, 0xcd, 0xab],
            0xabcd1234,
            snd::VIRTIO_SND_S_OK,
        ),
        (Status::Supplied, 0, vec![], 0, snd::VIRTIO_SND_S_OK),
        (Status::Failed, 0, vec![], 0, snd::SndStatus::IoErr as u32),
        (
            Status::Cancelled,
            0,
            vec![],
            0,
            snd::SndStatus::IoErr as u32,
        ),
    ] {
        let mut machine = fixture(false);
        machine.bus_mut().write_ram_slice(BASE, &program).unwrap();
        let mut trace = Trace::default();
        until(&mut machine, START, 5, &mut trace);
        let pending = machine.save_session_resume().unwrap();
        let request = machine
            .session_device_requests()
            .unwrap()
            .into_iter()
            .find(|r| matches!(r.intent, DeviceIntent::Capture { .. }))
            .unwrap();
        assert_eq!(
            request.intent,
            DeviceIntent::Capture {
                samples: 2,
                rate: 48000,
                channels: 2
            }
        );
        until(&mut machine, START + 37, 29, &mut trace);
        assert_eq!(machine.bus_mut().load32(BASE + 0x34100), Ok(0));
        assert_eq!(machine.bus_mut().load32(BASE + 0x34200), Ok(0));
        assert_eq!(machine.bus_mut().load16(BASE + 0x32302), Ok(0));
        let receipt = capture(&mut machine, request.id, status, bytes, frames);
        let ready = machine.save_session_resume().unwrap();
        until(&mut machine, START + 40, 3, &mut trace);
        let final_frame = machine.save_session_resume().unwrap();
        assert_eq!(machine.bus_mut().load32(BASE + 0x34100), Ok(want));
        assert_eq!(machine.bus_mut().load32(BASE + 0x34200), Ok(pcm_status));
        assert_eq!(machine.bus_mut().load16(BASE + 0x32302), Ok(1));
        let mut re = fixture(true);
        re.bus_mut().write_ram_slice(BASE, &program).unwrap();
        re.load_session_resume(&pending).unwrap();
        until(&mut re, START + 37, 4096, &mut Trace::default());
        replay(&mut re, &receipt);
        until(&mut re, START + 40, 4096, &mut Trace::default());
        assert_eq!(re.save_session_resume().unwrap(), final_frame);
        re.load_session_resume(&ready).unwrap();
        until(&mut re, START + 40, 7, &mut Trace::default());
        assert_eq!(re.save_session_resume().unwrap(), final_frame);
        let label = format!("critic-stereo-{}-{frames}", status as u8);
        evidence(&format!("{label}.resume"), &final_frame);
        evidence(&format!("{label}.trace"), trace.0.as_bytes());
    }
}

#[test]
fn critic_capture_deadline_edges_preserve_pending_identity() {
    use sha2::{Digest, Sha256};
    let mut control = fixture(false);
    until(&mut control, START, 11, &mut Trace::default());
    let wanted = control.save_session_resume().unwrap();
    let mut summary = String::new();
    for boundary in [1605u64, 2012, 2013, 2014, 2015, 4096] {
        for quantum in [1, 7, 257] {
            let mut machine = fixture(false);
            until(&mut machine, boundary, quantum, &mut Trace::default());
            let cap = machine
                .session_device_requests()
                .unwrap()
                .into_iter()
                .filter(|r| matches!(r.intent, DeviceIntent::Capture { .. }))
                .count();
            assert_eq!(
                cap,
                usize::from(boundary >= 2014),
                "boundary={boundary} quantum={quantum}"
            );
            let frame = machine.save_session_resume().unwrap();
            let mut re = fixture(false);
            re.load_session_resume(&frame).unwrap();
            assert_eq!(re.save_session_resume().unwrap(), frame);
            until(&mut re, START, 509, &mut Trace::default());
            assert_eq!(re.save_session_resume().unwrap(), wanted);
            summary.push_str(&format!(
                "{boundary}\t{quantum}\t{cap}\t{:x}\n",
                Sha256::digest(&frame)
            ));
            evidence(
                &format!("critic-deadline-{boundary}-{quantum}.resume"),
                &frame,
            );
        }
    }
    evidence("critic-deadline-edges.tsv", summary.as_bytes());
}

#[test]
fn critic_remaining_qualified_guards() {
    use wasm_vm_core::resume::{SectionReader, SnapshotWriter, section};
    let mut machine = fixture(false);
    until(&mut machine, START, 13, &mut Trace::default());
    let requests = machine.session_device_requests().unwrap();
    let block = requests
        .iter()
        .find(|r| matches!(r.intent, DeviceIntent::BaseBlock { chunk: 0, .. }))
        .unwrap();
    let block_lease = machine.lease_session_device(block.id).unwrap();
    let retained: Vec<_> = requests
        .into_iter()
        .filter(|r| !matches!(r.intent, DeviceIntent::BaseBlock { .. }))
        .collect();
    machine.bus_mut().store32(0x10001070, 0).unwrap();
    assert_eq!(machine.session_device_requests().unwrap(), retained);
    let reset = machine.save_session_resume().unwrap();
    assert_eq!(
        machine.complete_session_device(&block_lease, Status::Supplied, 0, payload(0)),
        Err(DeviceError::UnknownRequest)
    );
    assert_eq!(machine.save_session_resume().unwrap(), reset);
    assert_eq!(machine.session_device_cursor().unwrap(), 0);
    assert_eq!(machine.bus_mut().load16(BASE + 0x12002), Ok(0));
    assert_eq!(machine.bus_mut().load8(BASE + 0x14000), Ok(0));
    evidence("critic-block-reset.resume", &reset);
    let agent = retained
        .iter()
        .find(|r| matches!(r.intent, DeviceIntent::Agent { .. }))
        .unwrap();
    let agent_lease = machine.lease_session_device(agent.id).unwrap();
    machine
        .virtio_console()
        .unwrap()
        .borrow_mut()
        .restart_agent_port();
    let restarted = machine.save_session_resume().unwrap();
    assert_eq!(
        machine.complete_session_device(
            &agent_lease,
            Status::Supplied,
            0,
            b"stale generation".to_vec()
        ),
        Err(DeviceError::StaleLease)
    );
    assert_eq!(machine.save_session_resume().unwrap(), restarted);
    evidence("critic-agent-restarted.resume", &restarted);

    let mut pending = fixture(false);
    until(&mut pending, START, 13, &mut Trace::default());
    let lease = pending.lease_session_device(1).unwrap();
    pending
        .stage_session_effect(START + 1, SessionEffect::ExternalPending(false))
        .unwrap();
    let before = pending.save_session_resume().unwrap();
    assert_eq!(
        pending.complete_session_device(&lease, Status::Supplied, 0, payload(0)),
        Err(DeviceError::Position)
    );
    assert_eq!(pending.save_session_resume().unwrap(), before);
    evidence("critic-common-event-pending.resume", &before);

    let mut a = fixture(false);
    until(&mut a, START, 13, &mut Trace::default());
    let lease = a.lease_session_device(1).unwrap();
    let frame = a.save_session_resume().unwrap();
    let (header, sections) = SectionReader::new(&frame).unwrap();
    let mut writer = SnapshotWriter::new(
        &header.core_hash,
        &header.base_image_hash,
        header.overlay_generation,
    );
    for item in sections {
        let item = item.unwrap();
        if item.tag != section::SESSION_DEVICES {
            writer.section(item.tag, item.payload);
        }
    }
    let mutant = writer.finish();
    assert!(a.load_session_resume(&mutant).is_err());
    assert_eq!(a.save_session_resume().unwrap(), frame);
    a.complete_session_device(&lease, Status::Supplied, 0, payload(0))
        .unwrap();
    evidence("critic-missing-section20.resume", &mutant);

    let legacy = || {
        let mut a = Machine::new(1 << 20);
        a.enable_clint(1);
        a.enable_plic();
        a.enable_virtio_slots(None);
        a.enable_virtio_snd();
        a.start_session_clock(1).unwrap();
        a
    };
    let mut a = legacy();
    let frame = a.save_session_resume().unwrap();
    let mut b = legacy();
    b.load_session_resume(&frame).unwrap();
    assert_eq!(b.save_session_resume().unwrap(), frame);
    evidence("critic-legacy-idle-sound.resume", &frame);
}

#[test]
fn critic_malformed_completion_ingress() {
    let request = wasm_vm_core::session_devices::DeviceRequest {
        id: 1,
        intent: DeviceIntent::Agent {
            generation: 0,
            maximum: 17,
        },
    };
    let valid = DeviceCompletion {
        request,
        status: Status::Supplied,
        frames: 0,
        bytes: vec![1, 2, 3],
    };
    let envelope = valid.encode().unwrap();
    for (offset, value) in [(0, 0u8), (8, 0), (16, 255), (29, 255)] {
        let mut bytes = envelope.clone();
        bytes[offset] = value;
        assert!(DeviceCompletion::decode(&bytes).is_err(), "offset={offset}");
    }
    let mut fail = valid.clone();
    fail.status = Status::Failed;
    assert_eq!(fail.validate(), Err(DeviceError::Payload));
    let mut machine = fixture(false);
    let before = machine.save_session_resume().unwrap();
    assert_eq!(
        machine.replay_session_device(machine.session_position().unwrap(), valid),
        Err(DeviceError::ReplayIngress)
    );
    assert_eq!(machine.save_session_resume().unwrap(), before);
}

#[test]
fn critic_disabled_capture_metadata_refuses_without_revoking_live_lease() {
    use wasm_vm_core::resume::section;
    let mut machine = Machine::new(1 << 20);
    machine.enable_clint(1);
    machine.start_session_clock(1).unwrap();
    machine
        .enable_session_devices(
            Some(BaseDisk {
                identity: [37; 32],
                sectors: 2,
                chunk_bytes: 512,
                chunks: (0..2)
                    .map(|n| PayloadRef::of(&payload(n)).unwrap())
                    .collect(),
            }),
            true,
            false,
            false,
        )
        .unwrap();
    machine.bus_mut().write_ram_slice(BASE, PROGRAM).unwrap();
    machine.hart_mut().regs.pc = BASE;
    until(&mut machine, START, 13, &mut Trace::default());
    let frame = machine.save_session_resume().unwrap();
    evidence("critic-disabled-capture-pending.resume", &frame);
    for field in [2usize, 3] {
        machine.load_session_resume(&frame).unwrap();
        let lease = machine.lease_session_device(1).unwrap();
        let mutant = critic_rewrite_section(&frame, section::SESSION_DEVICES, |bytes| {
            let config_length = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
            let at = 16 + config_length + field * 8;
            assert_eq!(&bytes[at..at + 8], &[0; 8]);
            bytes[at..at + 8].copy_from_slice(&1u64.to_le_bytes());
        });
        assert!(machine.load_session_resume(&mutant).is_err());
        assert_eq!(machine.save_session_resume().unwrap(), frame);
        machine
            .complete_session_device(&lease, Status::Supplied, 0, payload(0))
            .unwrap();
        machine.take_session_deliveries().unwrap();
        evidence(
            &format!("critic-disabled-capture-field{field}.resume"),
            &mutant,
        );
    }
}

#[test]
fn critic_failed_block_result_restores_and_replays_without_payload() {
    let mut machine = fixture(false);
    let mut trace = Trace::default();
    until(&mut machine, START, 19, &mut trace);
    let pending = machine.save_session_resume().unwrap();
    let receipt = capture(&mut machine, 1, Status::Failed, vec![], 0);
    let ready = machine.save_session_resume().unwrap();
    let mut copy = fixture(true);
    copy.load_session_resume(&ready).unwrap();
    assert_eq!(copy.save_session_resume().unwrap(), ready);
    until(&mut machine, START + 128, 17, &mut trace);
    let final_frame = machine.save_session_resume().unwrap();
    assert_eq!(machine.bus_mut().load16(BASE + 0x12002), Ok(1));
    assert_eq!(machine.bus_mut().load8(BASE + 0x15000), Ok(1));
    assert_eq!(machine.bus_mut().load32(BASE + 0x14000), Ok(0));
    for quantum in [1, 7, 4096] {
        let mut re = fixture(true);
        re.load_session_resume(&pending).unwrap();
        replay(&mut re, &receipt);
        until(&mut re, START + 128, quantum, &mut Trace::default());
        assert_eq!(re.save_session_resume().unwrap(), final_frame);
    }
    evidence("critic-block-failed-ready.resume", &ready);
    evidence("critic-block-failed-final.resume", &final_frame);
    evidence("critic-block-failed.trace", trace.0.as_bytes());
}

#[test]
fn critic_structured_owned_codec_guards_are_transactional() {
    use wasm_vm_core::resume::section;
    let mut machine = fixture(false);
    until(&mut machine, START, 13, &mut Trace::default());
    let frame = machine.save_session_resume().unwrap();
    let empty_legacy = wasm_vm_core::dev::virtio::snd::SndState::new()
        .to_snapshot()
        .unwrap();
    for case in 0..10 {
        machine.load_session_resume(&frame).unwrap();
        let lease = machine.lease_session_device(1).unwrap();
        let tag = if case < 4 {
            section::SESSION_DEVICES
        } else {
            section::VIRTIO_SND
        };
        let mutant = critic_rewrite_section(&frame, tag, |bytes| {
            let u32_at = |b: &[u8], at: usize| {
                u32::from_le_bytes(b[at..at + 4].try_into().unwrap()) as usize
            };
            if case < 4 {
                let hub_len = u32_at(bytes, 0);
                let pending = 4 + hub_len + 4;
                let segments_count = pending + 6 + 2 + 1 + 8;
                let count = u32_at(bytes, segments_count);
                let first = segments_count + 4;
                assert_eq!(count, 3);
                match case {
                    0 => {
                        bytes[segments_count..segments_count + 4]
                            .copy_from_slice(&0u32.to_le_bytes());
                        bytes.drain(first..first + count * 13);
                    }
                    1 => {
                        for n in 0..count {
                            bytes[first + n * 13 + 12] = 0;
                        }
                    }
                    2 => bytes[pending + 1] = 1,
                    3 => bytes[first + 2 * 13 + 12] = 0,
                    _ => unreachable!(),
                }
                let length = bytes.len() - (4 + hub_len + 4);
                bytes[4 + hub_len..4 + hub_len + 4].copy_from_slice(&(length as u32).to_le_bytes());
            } else {
                let start = bytes.windows(8).position(|b| b == b"WVSNDC01").unwrap();
                let legacy = u32_at(bytes, start + 8);
                let count = start + 12 + legacy;
                let first = count + 4;
                let data_count = first + 31;
                let segment = data_count + 4;
                assert_eq!(u32_at(bytes, count), 1);
                assert_eq!(u32_at(bytes, data_count), 1);
                match case {
                    4 => bytes[segment + 12] = 0,
                    5 => {
                        bytes[data_count..data_count + 4].copy_from_slice(&0u32.to_le_bytes());
                        bytes.drain(segment..segment + 13);
                    }
                    6 => bytes[segment..segment + 8].copy_from_slice(&u64::MAX.to_le_bytes()),
                    7 => {
                        bytes[count..count + 4].copy_from_slice(&0u32.to_le_bytes());
                        bytes.truncate(first);
                    }
                    8 => bytes.resize(start + (2 << 20) + 1, 0),
                    9 => {
                        bytes.splice(start + 12..count, empty_legacy.iter().copied());
                        bytes[start + 8..start + 12]
                            .copy_from_slice(&(empty_legacy.len() as u32).to_le_bytes());
                    }
                    _ => unreachable!(),
                }
            }
        });
        assert!(
            machine.load_session_resume(&mutant).is_err(),
            "accepted case={case}"
        );
        assert_eq!(
            machine.save_session_resume().unwrap(),
            frame,
            "partial case={case}"
        );
        machine
            .complete_session_device(&lease, Status::Supplied, 0, payload(0))
            .unwrap();
        machine.take_session_deliveries().unwrap();
        evidence(&format!("critic-structured-codec-{case}.resume"), &mutant);
    }
}

#[test]
fn critic_active_playback_refuses_checkpoint_and_remains_stopped() {
    use wasm_vm_core::{dev::virtio::snd, resume::section, session_clock::SessionError};
    let mut machine = fixture(false);
    until(&mut machine, START, 13, &mut Trace::default());
    let before = machine.save_session_resume().unwrap();
    let state = machine.virtio_snd().unwrap().1;
    let params = snd::PcmParams {
        buffer_bytes: 16,
        period_bytes: 4,
        ..Default::default()
    };
    assert_eq!(
        &state.borrow_mut().handle_control(&params.to_bytes())[..4],
        &(snd::VIRTIO_SND_S_OK).to_le_bytes()
    );
    for command in [snd::VIRTIO_SND_R_PCM_PREPARE, snd::VIRTIO_SND_R_PCM_START] {
        let mut bytes = command.to_le_bytes().to_vec();
        bytes.extend_from_slice(&0u32.to_le_bytes());
        assert_eq!(
            &state.borrow_mut().handle_control(&bytes)[..4],
            &(snd::VIRTIO_SND_S_OK).to_le_bytes()
        );
    }
    assert_eq!(state.borrow().stream.state(), snd::PcmState::Running);
    let active = state.borrow().to_snapshot().unwrap();
    assert!(machine.save_session_resume().is_err());
    let position = machine.session_position();
    for _ in 0..2 {
        assert_eq!(
            machine.run(1),
            RunOutcome::SessionStopped(SessionError::DeviceCompletion(DeviceError::Unsupported))
        );
        assert_eq!(machine.session_position(), position);
    }
    let invalid = critic_rewrite_section(&before, section::VIRTIO_SND, |bytes| {
        let start = bytes.windows(8).position(|b| b == b"WVSNDC01").unwrap();
        let count = u32::from_le_bytes(bytes[start + 8..start + 12].try_into().unwrap()) as usize;
        bytes.splice(start + 12..start + 12 + count, active.iter().copied());
        bytes[start + 8..start + 12].copy_from_slice(&(active.len() as u32).to_le_bytes());
    });
    let mut check = fixture(false);
    check.load_session_resume(&before).unwrap();
    let lease = check.lease_session_device(1).unwrap();
    assert!(check.load_session_resume(&invalid).is_err());
    assert_eq!(check.save_session_resume().unwrap(), before);
    check
        .complete_session_device(&lease, Status::Supplied, 0, payload(0))
        .unwrap();
    evidence("critic-active-playback-owned-invalid.resume", &invalid);
    evidence("critic-active-playback-legacy.bin", &active);
}

#[test]
fn critic_invalid_base_geometry_refuses_before_installation_mutates_state() {
    let valid = BaseDisk {
        identity: [37; 32],
        sectors: 2,
        chunk_bytes: 512,
        chunks: (0..2)
            .map(|n| PayloadRef::of(&payload(n)).unwrap())
            .collect(),
    };
    for case in 0..7 {
        let mut base = valid.clone();
        match case {
            0 => base.identity = [0; 32],
            1 => base.sectors = 0,
            2 => base.chunk_bytes = 0,
            3 => base.chunk_bytes = 513,
            4 => base.chunks.clear(),
            5 => base.chunks[0].length = 511,
            6 => base.sectors = u64::MAX,
            _ => unreachable!(),
        };
        let mut machine = Machine::new(1 << 20);
        machine.enable_clint(1);
        machine.start_session_clock(1).unwrap();
        let before = machine.save_session_resume().unwrap();
        assert!(
            machine
                .enable_session_devices(Some(base), true, true, false)
                .is_err()
        );
        assert_eq!(
            machine.save_session_resume().unwrap(),
            before,
            "case={case}"
        );
    }
}
