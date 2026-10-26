//! Real RV64 pending fences, not a drained-queue placeholder.
use super::*;
const RENDERER: [u8; 32] = [0xc6; 32];
fn empty_tape() -> ObservationTape {
    ObservationTape {
        policy: Rig::new(64, None, false).machine.source_policy(),
        records: vec![],
    }
}
fn fresh(replay: bool, cached: bool) -> Rig {
    Rig::new(64, replay.then(empty_tape), cached)
}
fn logical_gpu(r: &Rig) -> Vec<u8> {
    let gpu = r.gpu.borrow();
    let mut control = gpu.control3d_snapshot().unwrap();
    // Only this declared host epoch is normalized. No resource, scanout, queue,
    // counters, pending fence, bytes or architectural state is discarded.
    control.epoch = 1;
    let mut submit = gpu.submit3d_snapshot().unwrap();
    if let Some(p) = &mut submit.pending {
        p.key.epoch = 1;
    }
    let mut out = control.canonical_bytes();
    out.extend(submit.canonical_bytes());
    out.extend(gpu.scanout3d_snapshot().unwrap().canonical_bytes());
    out
}

fn gpu_shadow(r: &mut Rig, queue: usize) -> (u16, u16, [u8; 3]) {
    assert!(queue < 2);
    let state = r.machine.gpu_session_state_witness_bytes().unwrap();
    let (_, sections) = wasm_vm_core::resume::SectionReader::new(&state).unwrap();
    let gpu = sections
        .map(Result::unwrap)
        .find(|section| section.tag == wasm_vm_core::resume::section::VIRTIO_GPU)
        .unwrap();
    let prefix = &gpu.payload[277 + 5 * queue..282 + 5 * queue];
    let magic = gpu
        .payload
        .windows(8)
        .position(|value| value == b"WVGPULG2")
        .unwrap();
    assert_eq!(prefix[0], 1);
    (
        u16::from_le_bytes([prefix[1], prefix[2]]),
        u16::from_le_bytes([prefix[3], prefix[4]]),
        gpu.payload[magic + 8..magic + 11].try_into().unwrap(),
    )
}

#[test]
fn exact_gpu_checkpoint_preserves_unnotified_control_descriptor() {
    let mut source = fresh(false, false);
    let slot = source.machine.virtio_gpu().unwrap().0;
    let base = Platform::virtio_base(slot as u64);
    for _ in 0..500 {
        if source.machine.bus_mut().load32(base + 0x44).unwrap() == 1 {
            break;
        }
        source.step();
    }
    assert_eq!(source.machine.bus_mut().load32(base + 0x44).unwrap(), 1);
    assert_eq!(source.machine.bus_mut().load16(AVAIL + 2).unwrap(), 0);
    source.write(AVAIL + 2, &1u16.to_le_bytes());
    assert_eq!(gpu_shadow(&mut source, 0), (0, 0, [0, 0, 0]));
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut restored = fresh(false, false);
    restored
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    assert_eq!(gpu_shadow(&mut restored, 0), (0, 0, [0, 0, 0]));
    restored.step();
    assert_eq!(gpu_shadow(&mut restored, 0), (0, 0, [0, 0, 0]));
    assert_eq!(restored.machine.bus_mut().load16(USED + 2).unwrap(), 0);

    source.machine.bus_mut().store32(base + 0x50, 0).unwrap();
    assert_eq!(gpu_shadow(&mut source, 0), (0, 0, [0, 1, 0]));
    let notified = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut resumed = fresh(false, false);
    resumed
        .machine
        .load_gpu_result_resume(&notified, &RENDERER)
        .unwrap();
    assert_eq!(gpu_shadow(&mut resumed, 0), (0, 0, [0, 1, 0]));
    resumed.step();
    assert_eq!(gpu_shadow(&mut resumed, 0).0, 1);
    assert_eq!(resumed.machine.bus_mut().load16(USED + 2).unwrap(), 1);
}

#[test]
fn exact_gpu_checkpoint_preserves_unnotified_cursor_descriptor() {
    let mut source = fresh(false, false);
    let slot = source.machine.virtio_gpu().unwrap().0;
    let base = Platform::virtio_base(slot as u64);
    for _ in 0..500 {
        if source.machine.bus_mut().load32(base + 0x44).unwrap() == 1 {
            break;
        }
        source.step();
    }
    assert_eq!(source.machine.bus_mut().load32(base + 0x44).unwrap(), 1);
    let desc = virt::DRAM_BASE + 0x30000;
    let avail = virt::DRAM_BASE + 0x31000;
    let used = virt::DRAM_BASE + 0x32000;
    let request = virt::DRAM_BASE + 0x33000;
    let response = virt::DRAM_BASE + 0x34000;
    let mut descriptors = [0u8; 32];
    descriptors[..8].copy_from_slice(&request.to_le_bytes());
    descriptors[8..12].copy_from_slice(&40u32.to_le_bytes());
    descriptors[12..14].copy_from_slice(&1u16.to_le_bytes());
    descriptors[14..16].copy_from_slice(&1u16.to_le_bytes());
    descriptors[16..24].copy_from_slice(&response.to_le_bytes());
    descriptors[24..28].copy_from_slice(&24u32.to_le_bytes());
    descriptors[28..30].copy_from_slice(&2u16.to_le_bytes());
    source.write(desc, &descriptors);
    source.write(request, &packet(0x301, 0, 40));
    for (offset, value) in [
        (0x30, 1),
        (0x38, 16),
        (0x80, desc as u32),
        (0x84, 0),
        (0x90, avail as u32),
        (0x94, 0),
        (0xa0, used as u32),
        (0xa4, 0),
        (0x44, 1),
        (0x30, 0),
    ] {
        source
            .machine
            .bus_mut()
            .store32(base + offset, value)
            .unwrap();
    }
    source.write(avail + 2, &1u16.to_le_bytes());
    assert_eq!(gpu_shadow(&mut source, 1).2, [0, 0, 0]);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut restored = fresh(false, false);
    restored
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    assert_eq!(gpu_shadow(&mut restored, 1).2, [0, 0, 0]);
    restored.step();
    assert_eq!(restored.machine.bus_mut().load16(used + 2).unwrap(), 0);
    assert_eq!(gpu_shadow(&mut restored, 1).1, 0);

    source.machine.bus_mut().store32(base + 0x50, 1).unwrap();
    assert_eq!(gpu_shadow(&mut source, 1).2, [0, 0, 1]);
    let notified = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut resumed = fresh(false, false);
    resumed
        .machine
        .load_gpu_result_resume(&notified, &RENDERER)
        .unwrap();
    assert_eq!(gpu_shadow(&mut resumed, 1).2, [0, 0, 1]);
    resumed.step();
    assert_eq!(resumed.machine.bus_mut().load16(used + 2).unwrap(), 1);
    assert_eq!(gpu_shadow(&mut resumed, 1).0, 1);
}

#[test]
fn verifier_capture_boundary_preserves_each_queue_notification_without_coalescing() {
    let mut source = fresh(false, false);
    let slot = source.machine.virtio_gpu().unwrap().0;
    let base = Platform::virtio_base(slot as u64);
    for _ in 0..500 {
        if source.machine.bus_mut().load32(base + 0x44).unwrap() == 1 {
            break;
        }
        source.step();
    }
    assert_eq!(source.machine.bus_mut().load32(base + 0x44).unwrap(), 1);

    let before = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    source.machine.bus_mut().store32(base + 0x50, 0).unwrap();
    let between = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    source.machine.bus_mut().store32(base + 0x50, 1).unwrap();
    let after = source.machine.save_gpu_result_resume(&RENDERER).unwrap();

    for (checkpoint, expected) in [
        (&before, [0, 0, 0]),
        (&between, [0, 1, 0]),
        (&after, [0, 1, 1]),
    ] {
        let mut restored = fresh(false, false);
        restored
            .machine
            .load_gpu_result_resume(checkpoint, &RENDERER)
            .unwrap();
        assert_eq!(gpu_shadow(&mut restored, 0).2, expected);
    }

    let mut restored = fresh(false, false);
    restored
        .machine
        .load_gpu_result_resume(&after, &RENDERER)
        .unwrap();
    restored.step();
    assert_eq!(gpu_shadow(&mut restored, 0).2, [0, 0, 0]);
}
fn drain(r: &mut Rig) {
    r.machine.take_session_deliveries().unwrap();
}
fn assert_no_reissue(r: &Rig) {
    let h = r.host.borrow();
    assert!(
        h.jobs.is_empty()
            && h.scanouts.is_empty()
            && h.controls.is_empty()
            && h.cancelled.is_empty()
    );
}
fn finish_replay(r: &mut Rig, c: &Capture, start: usize) {
    let frames = gpu_events(c);
    for (position, result) in frames.iter().copied().skip(start) {
        if r.machine.session_gpu_cursor().unwrap() as usize == start
            && r.pos().transition == position.transition
            && start == 1
        {
            // The scatter is already owned by the loaded frontier.
        } else {
            r.machine
                .prepare_session_gpu_replay(position, result, payload(c, result))
                .unwrap();
        }
        r.until(position.transition, 3);
        r.machine.deliver_session_gpu_replay().unwrap();
    }
    r.done();
    r.check(&c.result, 0x1100);
}
fn replay_before_scatter(c: &Capture) -> Rig {
    let frames = gpu_events(c);
    let mut r = Rig::new(c.result.len(), Some(c.tape.clone()), false);
    r.machine
        .prepare_session_gpu_replay(frames[0].0, frames[0].1, None)
        .unwrap();
    r.until(frames[0].0.transition, 7);
    r.machine.deliver_session_gpu_replay().unwrap();
    let exchange = r.exchange(1);
    r.machine
        .replay_session_gpu_transport(&exchange, None, None)
        .unwrap();
    r.machine
        .prepare_session_gpu_replay(frames[1].0, frames[1].1, payload(c, frames[1].1))
        .unwrap();
    r.until(frames[1].0.transition, 11);
    let completion = r.completion(Ok(()), 1);
    assert_eq!(r.mail.post(completion), Err(E::InvalidParameter));
    r.post(completion).unwrap();
    drain(&mut r);
    r
}
#[test]
fn pending_keyframe_before_scatter_restores_owned_payload_without_host_reissue() {
    let c = capture(64, 17, false);
    let mut source = replay_before_scatter(&c);
    assert_eq!(source.machine.bus_mut().load16(USED + 2).unwrap(), 4);
    assert!(
        !source
            .gpu
            .borrow()
            .submit3d_snapshot()
            .unwrap()
            .pending
            .unwrap()
            .completion_ready
    );
    let prefix = source.trace.canonical();
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    source.dump_state("pending-before-scatter", "saved");
    // Original physical transport drains its admitted scatter once; restored work
    // is already physically settled and has no job to reissue or drain.
    let frames = gpu_events(&c);
    source.machine.deliver_session_gpu_replay().unwrap();
    source
        .machine
        .replay_session_gpu_transport(&source.exchange(2), Some(&[0xe1; 64]), None)
        .unwrap();
    source
        .machine
        .prepare_session_gpu_replay(frames[2].0, frames[2].1, None)
        .unwrap();
    source.until(frames[2].0.transition, 5);
    source.machine.deliver_session_gpu_replay().unwrap();
    source.done();
    let suffix = source.trace.canonical()[prefix.len()..].to_owned();
    source.dump_state("pending-before-scatter", "original");
    for cached in [false, true] {
        let mut restored = fresh(true, cached);
        let before = restored.machine.session_position();
        let mapping = restored
            .machine
            .load_gpu_result_resume(&saved, &RENDERER)
            .unwrap();
        assert!(mapping.1 > mapping.0);
        assert_ne!(restored.machine.session_position(), before);
        assert_eq!(restored.machine.bus_mut().load16(USED + 2).unwrap(), 4);
        finish_replay(&mut restored, &c, 1);
        assert_no_reissue(&restored);
        assert_eq!(
            restored.machine.hart().to_snapshot(),
            source.machine.hart().to_snapshot()
        );
        assert_eq!(
            restored.machine.bus_mut().ram().as_bytes(),
            source.machine.bus_mut().ram().as_bytes()
        );
        assert_eq!(logical_gpu(&restored), logical_gpu(&source));
        assert_eq!(restored.trace.canonical(), suffix);
        restored.dump_state(
            "pending-before-scatter",
            if cached {
                "restored-cached"
            } else {
                "restored"
            },
        );
        println!(
            "PENDING_KEYFRAME before-scatter cached={cached} mapping={mapping:?} used=4->5 cursor={} no_reissue=true suffix_sha={}",
            restored.machine.session_gpu_cursor().unwrap(),
            hex(&Sha256::digest(suffix.as_bytes()))
        );
    }
    if let Ok(root) = std::env::var("E9_GPU_RESULT_EVIDENCE") {
        let root = std::path::Path::new(&root).join("pending-before-scatter");
        std::fs::write(root.join("keyframe.bin"), saved).unwrap();
        std::fs::write(root.join("suffix.trace"), suffix).unwrap();
    }
}
#[test]
fn pending_keyframe_after_scatter_and_after_fence_publish_exactly_once() {
    for after_fence in [false, true] {
        let mut source = Rig::new(64, None, false);
        source.pending();
        let old = source.host.borrow().leases[0].clone();
        source.machine.submit3d_gather(&source.exchange(1)).unwrap();
        source
            .machine
            .submit3d_scatter(&source.exchange(2), &[0x77; 64])
            .unwrap();
        source.post(source.completion(Ok(()), 2)).unwrap();
        if after_fence {
            source.done();
        }
        drain(&mut source);
        let prefix = source.trace.canonical();
        let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
        let case = if after_fence {
            "pending-after-fence"
        } else {
            "pending-after-scatter"
        };
        source.dump_state(case, "saved");
        let expected_used = if after_fence { 5 } else { 4 };
        assert_eq!(
            source.machine.bus_mut().load16(USED + 2).unwrap(),
            expected_used
        );
        source.done();
        let suffix = source.trace.canonical()[prefix.len()..].to_owned();
        source.dump_state(case, "original");
        if let Ok(root) = std::env::var("E9_GPU_RESULT_EVIDENCE") {
            let root = std::path::Path::new(&root).join(case);
            std::fs::write(root.join("keyframe.bin"), &saved).unwrap();
            std::fs::write(root.join("suffix.trace"), &suffix).unwrap();
        }
        let mut restored = fresh(false, true);
        for seek in 0..2 {
            drain(&mut restored);
            let mapping = restored
                .machine
                .load_gpu_result_resume(&saved, &RENDERER)
                .unwrap();
            restored.trace = VecSink::new();
            assert_eq!(
                old.post(source.completion(Ok(()), 2)),
                Err(E::InvalidParameter)
            );
            assert_eq!(
                restored.machine.bus_mut().load16(USED + 2).unwrap(),
                expected_used
            );
            restored.done();
            assert_no_reissue(&restored);
            assert_eq!(restored.trace.canonical(), suffix);
            assert_eq!(
                restored.machine.hart().to_snapshot(),
                source.machine.hart().to_snapshot()
            );
            assert_eq!(
                restored.machine.bus_mut().ram().as_bytes(),
                source.machine.bus_mut().ram().as_bytes()
            );
            assert_eq!(logical_gpu(&restored), logical_gpu(&source));
            restored.dump_state(case, &format!("restored-{seek}"));
            println!(
                "PENDING_KEYFRAME after-fence={after_fence} seek={seek} mapping={mapping:?} used={expected_used}->5 no_reissue=true"
            );
        }
        let a = source.machine.take_session_gpu_recording().unwrap();
        let b = restored.machine.take_session_gpu_recording().unwrap();
        assert_eq!(a.payloads, b.payloads);
        assert_eq!(a.events, b.events);
    }
}
fn evidence_blob(name: &str, bytes: &[u8]) {
    if let Ok(root) = std::env::var("E9_GPU_RESULT_EVIDENCE") {
        let root = std::path::Path::new(&root).join("pending-refusals");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(name), bytes).unwrap();
    }
}
fn sections(blob: &[u8]) -> Vec<(u32, Vec<u8>)> {
    let mut out = vec![];
    let mut at = 84;
    while at < blob.len() - 84 {
        let tag = u32::from_le_bytes(blob[at..at + 4].try_into().unwrap());
        let n = u32::from_le_bytes(blob[at + 4..at + 8].try_into().unwrap()) as usize;
        out.push((tag, blob[at + 8..at + 8 + n].to_vec()));
        at += 8 + n;
    }
    assert_eq!(at, blob.len() - 84);
    out
}
fn assemble(original: &[u8], parts: &[(u32, Vec<u8>)]) -> Vec<u8> {
    let mut out = original[..84].to_vec();
    for (tag, bytes) in parts {
        out.extend_from_slice(&tag.to_le_bytes());
        out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        out.extend(bytes);
    }
    let n = out.len() as u64;
    out.extend_from_slice(b"WVGRESU1");
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(&n.to_le_bytes());
    out.extend(RENDERER);
    let sha = Sha256::digest(&out);
    out.extend_from_slice(&sha);
    out
}
fn reseal(bytes: &mut [u8]) {
    let n = bytes.len() - 32;
    let sha = Sha256::digest(&bytes[..n]);
    bytes[n..].copy_from_slice(&sha);
}

#[test]
fn full_and_delta_gpu_keyframes_preserve_completed_but_parked_owned_read() {
    use wasm_vm_core::session_devices::{BaseDisk, CompletionStatus, DeviceIntent};
    use wasm_vm_core::session_replay::{GpuReplayConfig, ReplayDriver, ReplayPlan, StateWitness};
    let chunk = vec![0x5b; 512];
    let other_chunk = vec![0xa7; 512];
    let base = || BaseDisk {
        identity: [0x92; 32],
        sectors: 2,
        chunk_bytes: 512,
        chunks: vec![
            wasm_vm_core::session_devices::PayloadRef::of(&chunk).unwrap(),
            wasm_vm_core::session_devices::PayloadRef::of(&other_chunk).unwrap(),
        ],
    };
    let mut source = Rig::with_owned_base(
        64,
        None,
        false,
        0,
        None,
        true,
        RigSession {
            base: Some(base()),
            activate_sources: true,
        },
    );
    let d = virt::DRAM_BASE + 0x20000;
    let a = d + 0x1000;
    let u = d + 0x2000;
    let h = d + 0x3000;
    let data = d + 0x4000;
    let status = h + 128;
    source.write(h, &[0; 16]); // IN, sector zero.
    source.write(data, &[0xa5; 512]);
    source.write(status, &[0xa5]);
    for (i, (addr, len, flags)) in [(h, 16u32, 1u16), (data, 512, 3), (status, 1, 2)]
        .into_iter()
        .enumerate()
    {
        let at = d + i as u64 * 16;
        source.machine.bus_mut().store64(at, addr).unwrap();
        source.machine.bus_mut().store32(at + 8, len).unwrap();
        source.machine.bus_mut().store16(at + 12, flags).unwrap();
        source
            .machine
            .bus_mut()
            .store16(at + 14, (i as u16 + 1) % 3)
            .unwrap();
    }
    source.write(a + 4, &0u16.to_le_bytes());
    let mut code = Code::default();
    code.li(1, Platform::virtio_base(0) as u32);
    for (offset, value) in [
        (0x70, 3),
        (0x24, 1),
        (0x20, 1),
        (0x70, 11),
        (0x70, 15),
        (0x30, 0),
        (0x38, 8),
        (0x80, d as u32),
        (0x90, a as u32),
        (0xa0, u as u32),
        (0x44, 1),
    ] {
        code.mmio(offset, value);
    }
    code.li(2, 1);
    code.li(3, a as u32);
    code.store(3, 2, 2, 1);
    code.mmio(0x50, 0);
    code.0.push(0x0000_006f); // no further guest action while the block request is owned.
    source.write(
        virt::DRAM_BASE + 0x3000,
        &code
            .0
            .into_iter()
            .flat_map(u32::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    source.machine.hart_mut().regs.pc = virt::DRAM_BASE + 0x3000;
    let request = (0..500)
        .find_map(|_| {
            source.step();
            source.machine.session_device_requests().unwrap().pop()
        })
        .expect("guest read must publish one owned base-chunk request");
    assert!(matches!(
        request.intent,
        DeviceIntent::BaseBlock { chunk: 0, .. }
    ));
    assert_eq!(source.machine.pending_blk_chunks(), vec![0]);
    assert_eq!(source.machine.bus_mut().load16(u + 2).unwrap(), 0);
    let lease = source.machine.lease_session_device(request.id).unwrap();
    let pending_request_frame = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let before_completion = source.pos();
    let before_digest = source.machine.gpu_session_state_digest().unwrap();
    source
        .machine
        .complete_session_device(&lease, CompletionStatus::Supplied, 0, chunk.clone())
        .unwrap();
    let receipt = source.machine.take_session_deliveries().unwrap();
    assert_eq!(receipt.len(), 1);
    assert_eq!(source.pos().transition, before_completion.transition);
    assert!(source.machine.session_device_requests().unwrap().is_empty());
    assert_eq!(source.machine.pending_blk_chunks(), vec![0]);
    assert_eq!(source.machine.bus_mut().load16(u + 2).unwrap(), 0);
    assert_eq!(source.machine.bus_mut().load8(status).unwrap(), 0xa5);

    let position = source.pos();
    let full = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let delta = source
        .machine
        .save_gpu_result_state_without_ram(&RENDERER)
        .unwrap();
    assert_eq!(
        source.pos(),
        position,
        "capture must keep the exact coordinate"
    );
    let full_parts = sections(&full);
    let delta_parts = sections(&delta);
    assert_eq!(
        full_parts
            .iter()
            .filter(|(tag, _)| *tag != 2)
            .cloned()
            .collect::<Vec<_>>(),
        delta_parts
    );
    let session = full_parts
        .iter()
        .find(|(tag, _)| *tag == 20)
        .unwrap()
        .1
        .clone();
    assert!(!session.is_empty());
    let le32 = |bytes: &[u8], at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let le64 = |bytes: &[u8], at: usize| u64::from_le_bytes(bytes[at..at + 8].try_into().unwrap());
    let hub_len = le32(&session, 0) as usize;
    let hub = &session[4..4 + hub_len];
    assert_eq!(&hub[..8], b"WVDEVST1");
    let mut at = 12 + le32(hub, 8) as usize; // configuration
    assert_eq!(le64(hub, at), 1); // next request ID
    assert_eq!(le64(hub, at + 8), 1); // accepted completion cursor
    at += 32; // next ID, cursor, clock, capture epoch
    assert_eq!(le32(hub, at), 0); // no pending host requests
    at += 4;
    assert_eq!(le32(hub, at), 1); // one authenticated resident chunk
    at += 4;
    assert_eq!(le32(hub, at), 0); // chunk zero
    assert_eq!(le64(hub, at + 4), 1); // completion cursor
    assert_eq!(le32(hub, at + 12), 512);
    assert_eq!(&hub[at + 16..at + 528], chunk);
    at += 528;
    assert_eq!(le32(hub, at), 0); // no failed chunks
    at += 4;
    assert_eq!(le32(hub, at), 1); // one pinned read
    at += 4;
    assert_eq!(le64(hub, at), 0); // sector zero
    assert_eq!(le32(hub, at + 8), 512);
    assert_eq!(le32(hub, at + 12), 1);
    assert_eq!(le32(hub, at + 16), 0); // pin requires chunk zero
    let pending_at = 4 + hub_len + 4;
    assert_eq!(
        le32(&session, 4 + hub_len),
        session.len() as u32 - pending_at as u32
    );
    assert_eq!(&session[pending_at..pending_at + 2], &[0, 0]);
    assert_eq!(le32(&session, pending_at + 2), 1); // one parked descriptor
    assert_eq!(session[pending_at + 8], 0); // Chunk reason
    assert_eq!(le64(&session, pending_at + 9), 0); // same chunk zero

    // The page graph supplies RAM for a delta frame. Use the identical full-frame RAM
    // section at this coordinate to exercise native restore of the delta state.
    let mut reconstituted = delta_parts.clone();
    reconstituted.insert(
        1,
        full_parts
            .iter()
            .find(|(tag, _)| *tag == 2)
            .unwrap()
            .clone(),
    );
    let delta_with_ram = assemble(&delta, &reconstituted);
    let mut restored = Vec::new();
    for frame in [&full, &delta_with_ram] {
        let mut target = Rig::with_owned_base(
            64,
            None,
            false,
            0,
            None,
            true,
            RigSession {
                base: Some(base()),
                activate_sources: true,
            },
        );
        target
            .machine
            .load_gpu_result_resume(frame, &RENDERER)
            .unwrap();
        assert_eq!(target.pos(), position);
        assert!(target.machine.session_device_requests().unwrap().is_empty());
        assert_eq!(target.machine.pending_blk_chunks(), vec![0]);
        assert_eq!(target.machine.bus_mut().load16(u + 2).unwrap(), 0);
        assert_eq!(
            sections(&target.machine.save_gpu_result_resume(&RENDERER).unwrap())
                .into_iter()
                .find(|(tag, _)| *tag == 20)
                .unwrap()
                .1,
            session
        );
        restored.push(target);
    }
    // A malformed section-20 chain is rejected before changing the installed state.
    let incumbent = restored[0]
        .machine
        .save_gpu_result_resume(&RENDERER)
        .unwrap();
    for attack in 0..4 {
        let mut bad = full_parts.clone();
        let payload = &mut bad.iter_mut().find(|(tag, _)| *tag == 20).unwrap().1;
        match attack {
            0 => payload.push(0), // trailing material
            1 => payload[pending_at + 6..pending_at + 8].copy_from_slice(&256u16.to_le_bytes()),
            2 => payload[pending_at + 9..pending_at + 17].copy_from_slice(&1u64.to_le_bytes()),
            3 => payload[pending_at + 21..pending_at + 29]
                .copy_from_slice(&(virt::DRAM_BASE - 1).to_le_bytes()),
            _ => unreachable!(),
        }
        let malformed = assemble(&full, &bad);
        assert!(
            restored[0]
                .machine
                .load_gpu_result_resume(&malformed, &RENDERER)
                .is_err(),
            "malformed parked chain attack {attack} accepted"
        );
        assert_eq!(
            restored[0]
                .machine
                .save_gpu_result_resume(&RENDERER)
                .unwrap(),
            incumbent,
            "malformed parked chain attack {attack} mutated state"
        );
    }
    // Rehashed section-20 mutant: a second valid read pins chunk 1, while the
    // original sector-0 descriptor is falsely parked on that other read's chunk.
    // Global "any pinned chunk" validation would accept this crosswire.
    let mut bad = full_parts.clone();
    let payload = &mut bad.iter_mut().find(|(tag, _)| *tag == 20).unwrap().1;
    let pin_count = 4 + at - 4;
    payload[pin_count..pin_count + 4].copy_from_slice(&2u32.to_le_bytes());
    let mut second_pin = Vec::new();
    second_pin.extend_from_slice(&1u64.to_le_bytes());
    second_pin.extend_from_slice(&512u32.to_le_bytes());
    second_pin.extend_from_slice(&1u32.to_le_bytes());
    second_pin.extend_from_slice(&1u32.to_le_bytes());
    payload.splice(4 + at + 20..4 + at + 20, second_pin);
    payload[..4].copy_from_slice(&((hub_len + 20) as u32).to_le_bytes());
    let valid_two_pins = assemble(&full, &bad);
    let mut two_pins = Rig::with_owned_base(
        64,
        None,
        false,
        0,
        None,
        true,
        RigSession {
            base: Some(base()),
            activate_sources: true,
        },
    );
    two_pins
        .machine
        .load_gpu_result_resume(&valid_two_pins, &RENDERER)
        .expect("both independently valid pins must decode before the crosswire");
    let pending_at = pending_at + 20;
    bad.iter_mut().find(|(tag, _)| *tag == 20).unwrap().1[pending_at + 9..pending_at + 17]
        .copy_from_slice(&1u64.to_le_bytes());
    assert!(
        restored[0]
            .machine
            .load_gpu_result_resume(&assemble(&full, &bad), &RENDERER)
            .is_err(),
        "crosswired valid read pin accepted"
    );
    assert_eq!(
        restored[0]
            .machine
            .save_gpu_result_resume(&RENDERER)
            .unwrap(),
        incumbent,
        "crosswired valid read pin mutated state"
    );

    let trace_start = source.trace.canonical().len();
    source.until(position.transition + 2, 1);
    for target in &mut restored {
        target.until(position.transition + 2, 1);
        assert_eq!(
            target.machine.bus_mut().ram().as_bytes(),
            source.machine.bus_mut().ram().as_bytes()
        );
        assert_eq!(
            target.trace.canonical(),
            source.trace.canonical()[trace_start..]
        );
    }
    let end = source.pos();
    let end_digest = source.machine.gpu_session_state_digest().unwrap();
    let plan = ReplayPlan {
        begin: before_completion,
        end,
        initial_resume: pending_request_frame,
        events: receipt.clone(),
        witnesses: vec![
            StateWitness {
                position: before_completion,
                resume_sha256: before_digest,
            },
            StateWitness {
                position: end,
                resume_sha256: end_digest,
            },
        ],
    };
    plan.validate().unwrap();
    let tape = ObservationTape {
        policy: source.machine.source_policy(),
        records: vec![],
    };
    let mut replay = Rig::with_owned_base(
        64,
        Some(tape),
        false,
        0,
        None,
        true,
        RigSession {
            base: Some(base()),
            activate_sources: false,
        },
    );
    let mut driver = ReplayDriver::start_gpu(
        &mut replay.machine,
        plan,
        GpuReplayConfig {
            renderer_digest: RENDERER,
            ram_digest: None,
            payloads: vec![],
        },
    )
    .unwrap();
    driver
        .run_to_end(&mut replay.machine, 1, |_, channel, _| {
            panic!("unexpected host input channel {channel}")
        })
        .unwrap();
    assert_eq!(replay.pos(), end);
    assert_eq!(
        replay.machine.gpu_session_state_digest().unwrap(),
        end_digest
    );
    assert_eq!(
        replay.machine.bus_mut().ram().as_bytes(),
        source.machine.bus_mut().ram().as_bytes()
    );
    restored.push(replay);
    for machine in
        std::iter::once(&mut source.machine).chain(restored.iter_mut().map(|rig| &mut rig.machine))
    {
        assert_eq!(machine.bus_mut().load16(u + 2).unwrap(), 1);
        assert_eq!(machine.bus_mut().load8(status).unwrap(), 0);
        assert_eq!(machine.bus_mut().load32(u + 4).unwrap(), 0);
        assert_eq!(machine.bus_mut().load32(u + 8).unwrap(), 513);
        assert_eq!(
            machine
                .bus_mut()
                .load32(Platform::virtio_base(0) + 0x60)
                .unwrap()
                & 1,
            1
        );
        assert_eq!(
            machine.bus_mut().load64(data).unwrap(),
            0x5b5b_5b5b_5b5b_5b5b
        );
        assert!(machine.pending_blk_chunks().is_empty());
        assert!(machine.session_device_requests().unwrap().is_empty());
        assert_eq!(machine.session_device_cursor(), Ok(1));
        assert!(
            machine
                .complete_session_device(&lease, CompletionStatus::Supplied, 0, chunk.clone())
                .is_err()
        );
    }
    source.until(position.transition + 7, 1);
    assert_eq!(source.machine.bus_mut().load16(u + 2).unwrap(), 1);
    if let Ok(root) = std::env::var("E9_T22J_EVIDENCE") {
        let root = std::path::Path::new(&root);
        std::fs::create_dir_all(root).unwrap();
        std::fs::write(root.join("full.resume"), &full).unwrap();
        std::fs::write(root.join("delta.resume"), &delta).unwrap();
        std::fs::write(root.join("delivery.txt"), format!("{receipt:?}\n")).unwrap();
        std::fs::write(root.join("guest.trace"), source.trace.canonical()).unwrap();
    }
    println!(
        "E9_T22J position={position:?} full_sha={} delta_sha={} parked_then_used_once=true",
        hex(&Sha256::digest(full)),
        hex(&Sha256::digest(delta))
    );
}
#[test]
fn pending_keyframe_corrupt_truncated_crosswired_and_unavailable_work_refuse_atomically() {
    let c = capture(64, 17, false);
    let mut source = replay_before_scatter(&c);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut target = fresh(true, false);
    target
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    let before = target.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut attacks = vec![];
    for cut in [0, 8, 84, saved.len() / 2, saved.len() - 33, saved.len() - 1] {
        attacks.push((format!("truncated-{cut}"), saved[..cut].to_vec()));
    }
    for (name, index, value) in [
        ("mode", 40, 0),
        ("physical-epoch", 41, 9),
        ("queue-generation", 57, 99),
        ("logical-queue", 65, 0),
        ("cursor", 73, 255),
        ("intent", 81, 0),
        ("clock", 113, 255),
        ("object-count", 141, 255),
    ] {
        let mut parts = sections(&saved);
        let frontier = &mut parts.iter_mut().find(|(tag, _)| *tag == 22).unwrap().1;
        frontier[index] = value;
        reseal(frontier);
        attacks.push((name.into(), assemble(&saved, &parts)));
    }
    {
        let mut parts = sections(&saved);
        let frontier = &mut parts.iter_mut().find(|(tag, _)| *tag == 22).unwrap().1;
        let at = frontier.windows(64).position(|v| v == c.result).unwrap();
        frontier[at + 13] ^= 1;
        reseal(frontier);
        attacks.push(("owned-payload".into(), assemble(&saved, &parts)));
    }
    {
        let mut parts = sections(&saved);
        parts.retain(|(tag, _)| *tag != 22);
        attacks.push(("missing-frontier".into(), assemble(&saved, &parts)));
    }
    {
        let mut parts = sections(&saved);
        let duplicate = parts.iter().find(|(tag, _)| *tag == 22).unwrap().clone();
        parts.push(duplicate);
        attacks.push(("duplicate-frontier".into(), assemble(&saved, &parts)));
    }
    {
        let mut parts = sections(&saved);
        let gpu = &mut parts.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
        gpu[1] ^= 1;
        attacks.push(("crosswired-transport".into(), assemble(&saved, &parts)));
    }
    evidence_blob("incumbent-before.bin", &before);
    for (name, bad) in attacks {
        evidence_blob(&format!("{name}.candidate"), &bad);
        assert!(
            target
                .machine
                .load_gpu_result_resume(&bad, &RENDERER)
                .is_err(),
            "accepted {name}"
        );
        assert_eq!(
            target.machine.save_gpu_result_resume(&RENDERER).unwrap(),
            before,
            "mutated incumbent {name}"
        );
        evidence_blob(
            &format!("{name}.incumbent"),
            &target.machine.save_gpu_result_resume(&RENDERER).unwrap(),
        );
        println!("PENDING_KEYFRAME refusal={name} unchanged=true");
    }
    let mut inflight = Rig::new(64, Some(c.tape.clone()), false);
    inflight
        .machine
        .prepare_session_gpu_replay(gpu_events(&c)[0].0, gpu_events(&c)[0].1, None)
        .unwrap();
    inflight.until(gpu_events(&c)[0].0.transition, 7);
    drain(&mut inflight);
    assert!(inflight.machine.save_gpu_result_resume(&RENDERER).is_err());
    assert!(
        inflight
            .machine
            .load_gpu_result_resume(&saved, &RENDERER)
            .is_err()
    );
    assert!(
        target
            .machine
            .load_accelerated_resume(&saved, &RENDERER)
            .is_err()
    );
    assert!(target.machine.save_accelerated_resume(&RENDERER).is_err());
}

#[test]
fn pending_keyframe_all_request_kinds_and_terminal_errors_keep_exact_guest_state() {
    for job in [1, 2, 3, 4] {
        for outcome in [Ok(()), Err(E::OutOfMemory)] {
            let mut source = Rig::with_job(64, None, false, job);
            source.pending();
            source.post(source.completion(outcome, 0)).unwrap();
            drain(&mut source);
            let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
            let prefix = source.trace.canonical();
            source.done();
            let mut restored = Rig::with_job(64, None, true, job);
            restored
                .machine
                .load_gpu_result_resume(&saved, &RENDERER)
                .unwrap();
            restored.done();
            assert_no_reissue(&restored);
            assert_eq!(
                source.machine.hart().to_snapshot(),
                restored.machine.hart().to_snapshot()
            );
            assert_eq!(
                source.machine.bus_mut().ram().as_bytes(),
                restored.machine.bus_mut().ram().as_bytes()
            );
            assert_eq!(logical_gpu(&source), logical_gpu(&restored));
            assert_eq!(
                restored.trace.canonical(),
                source.trace.canonical()[prefix.len()..]
            );
            println!(
                "PENDING_KEYFRAME request-kind={job} outcome={outcome:?} trace_identical=true"
            );
        }
    }
}

#[test]
fn pending_keyframe_pairs_real_guest_disk_io_with_the_matching_disk_generation() {
    let initial = vec![0x5b; 4096];
    let base: [u8; 32] = Sha256::digest(&initial).into();
    let core = [0x71; 32];
    let mut source = Rig::with_disk(64, None, false, 0, Some(initial));
    source
        .machine
        .set_snapshot_identity_with_generation(core, base, 7);
    // Original RV64 OUT followed by IN, through real virtio-blk descriptors.
    let d = virt::DRAM_BASE + 0x20000;
    let a = d + 0x1000;
    let u = d + 0x2000;
    let h = d + 0x3000;
    let data = d + 0x4000;
    let read = d + 0x5000;
    source.write(data, &[0x67; 512]);
    for (i, write) in [true, false].into_iter().enumerate() {
        let mut header = [0; 16];
        header[..4].copy_from_slice(&u32::from(write).to_le_bytes());
        header[8..].copy_from_slice(&3u64.to_le_bytes());
        source.write(h + i as u64 * 32, &header);
        let mut descriptors = [0; 48];
        for (j, (addr, len, flags)) in [
            (h + i as u64 * 32, 16u32, 1u16),
            (
                if write { data } else { read },
                512,
                if write { 1 } else { 3 },
            ),
            (h + 128 + i as u64, 1, 2),
        ]
        .into_iter()
        .enumerate()
        {
            let at = j * 16;
            descriptors[at..at + 8].copy_from_slice(&addr.to_le_bytes());
            descriptors[at + 8..at + 12].copy_from_slice(&len.to_le_bytes());
            descriptors[at + 12..at + 14].copy_from_slice(&flags.to_le_bytes());
            descriptors[at + 14..at + 16]
                .copy_from_slice(&(i as u16 * 3 + j as u16 + 1).to_le_bytes());
        }
        source.write(d + i as u64 * 48, &descriptors);
        source.write(a + 4 + i as u64 * 2, &(i as u16 * 3).to_le_bytes());
    }
    let mut code = Code::default();
    code.li(1, Platform::virtio_base(0) as u32);
    for (offset, value) in [
        (0x70, 3),
        (0x24, 1),
        (0x20, 1),
        (0x70, 11),
        (0x70, 15),
        (0x30, 0),
        (0x38, 8),
        (0x80, d as u32),
        (0x90, a as u32),
        (0xa0, u as u32),
        (0x44, 1),
    ] {
        code.mmio(offset, value);
    }
    code.li(2, 2);
    code.li(3, a as u32);
    code.store(3, 2, 2, 1);
    code.mmio(0x50, 0);
    code.li(2, 2);
    code.li(3, u as u32);
    code.load(4, 3, 2, 5);
    code.bne(4, 2, -4);
    code.li(31, (virt::DRAM_BASE + 0x2000) as u32);
    code.0.push(31 << 15 | 0x67);
    source.write(
        virt::DRAM_BASE + 0x3000,
        &code
            .0
            .into_iter()
            .flat_map(u32::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    source.machine.hart_mut().regs.pc = virt::DRAM_BASE + 0x3000;
    source.pending();
    assert_eq!(source.machine.bus_mut().load16(u + 2).unwrap(), 2);
    assert_eq!(
        source.machine.bus_mut().load64(read).unwrap(),
        0x6767676767676767
    );
    let mut disk = vec![0; 4096];
    source
        .disk
        .as_ref()
        .unwrap()
        .borrow_mut()
        .backend
        .read(0, &mut disk)
        .unwrap();
    assert_eq!(&disk[1536..2048], &[0x67; 512]);
    source.post(source.completion(Ok(()), 0)).unwrap();
    drain(&mut source);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    source.dump_state("pending-disk", "saved");
    source.done();
    source.dump_state("pending-disk", "original");
    let mut restored = Rig::with_disk(64, None, true, 0, Some(disk.clone()));
    restored
        .machine
        .set_snapshot_identity_with_generation(core, base, 7);
    restored
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    restored.done();
    assert_no_reissue(&restored);
    restored.dump_state("pending-disk", "restored");
    assert_eq!(
        source.machine.bus_mut().ram().as_bytes(),
        restored.machine.bus_mut().ram().as_bytes()
    );
    assert_eq!(
        source.machine.hart().to_snapshot(),
        restored.machine.hart().to_snapshot()
    );
    let mut actual = vec![0; 4096];
    restored
        .disk
        .as_ref()
        .unwrap()
        .borrow_mut()
        .backend
        .read(0, &mut actual)
        .unwrap();
    assert_eq!(actual, disk);
    for (name, bad_base, generation) in [("base", [0xff; 32], 7), ("generation", base, 8)] {
        restored
            .machine
            .set_snapshot_identity_with_generation(core, bad_base, generation);
        let cpu = restored.machine.hart().to_snapshot();
        assert!(
            restored
                .machine
                .load_gpu_result_resume(&saved, &RENDERER)
                .is_err()
        );
        assert_eq!(cpu, restored.machine.hart().to_snapshot());
        println!("PENDING_KEYFRAME disk-{name} refusal=true");
    }
    println!(
        "PENDING_KEYFRAME disk guest-OUT-IN=2 sector3=67 generation7 sha={}",
        hex(&Sha256::digest(&disk))
    );
    if let Ok(root) = std::env::var("E9_GPU_RESULT_EVIDENCE") {
        let root = std::path::Path::new(&root).join("pending-disk");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("disk.bin"), disk).unwrap();
        std::fs::write(root.join("keyframe.bin"), saved).unwrap();
    }
}

fn native_chunks(gpu: &[u8]) -> (usize, Vec<std::ops::Range<usize>>) {
    let inner = gpu.windows(8).position(|v| v == b"WVGPU3D1").unwrap();
    assert_eq!(
        u32::from_le_bytes(gpu[inner + 8..inner + 12].try_into().unwrap()),
        3
    );
    let mut at = inner + 50;
    let mut chunks = vec![];
    for _ in 0..6 {
        let n = u32::from_le_bytes(gpu[at..at + 4].try_into().unwrap()) as usize;
        chunks.push(at + 4..at + 4 + n);
        at += 4 + n;
    }
    assert_eq!(at, gpu.len() - 32);
    (inner, chunks)
}
fn reseal_gpu_parts(parts: &mut [(u32, Vec<u8>)]) {
    let gpu = &mut parts.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
    let inner = gpu.windows(8).position(|v| v == b"WVGPU3D1").unwrap();
    let end = gpu.len() - 32;
    let sha = Sha256::digest(&gpu[inner..end]);
    gpu[end..].copy_from_slice(&sha);
    let sha = Sha256::digest(&gpu[..]);
    let frontier = &mut parts.iter_mut().find(|(tag, _)| *tag == 22).unwrap().1;
    frontier[8..40].copy_from_slice(&sha);
    reseal(frontier);
}

#[test]
fn exact_gpu_checkpoint_rejects_malformed_latches_and_legacy_version_atomically() {
    let mut source = fresh(false, false);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut target = fresh(false, false);
    target
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    let incumbent = target.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let parts = sections(&saved);
    for (name, latch) in [("control", 0usize), ("cursor", 1)] {
        let mut altered = parts.clone();
        let gpu = &mut altered.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
        let (inner, _) = native_chunks(gpu);
        gpu[inner + 48 + latch] = 2;
        reseal_gpu_parts(&mut altered);
        let candidate = assemble(&saved, &altered);
        for _ in 0..2 {
            assert!(
                target
                    .machine
                    .load_gpu_result_resume(&candidate, &RENDERER)
                    .is_err(),
                "accepted {name}"
            );
            assert_eq!(
                target.machine.save_gpu_result_resume(&RENDERER).unwrap(),
                incumbent,
                "mutated after {name}"
            );
        }
    }
    let mut legacy = parts;
    let gpu = &mut legacy.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
    let (inner, _) = native_chunks(gpu);
    gpu[inner + 8..inner + 12].copy_from_slice(&2u32.to_le_bytes());
    gpu.drain(inner + 48..inner + 50);
    reseal_gpu_parts(&mut legacy);
    let candidate = assemble(&saved, &legacy);
    assert!(
        target
            .machine
            .load_gpu_result_resume(&candidate, &RENDERER)
            .is_err(),
        "accepted legacy v2"
    );
    assert_eq!(
        target.machine.save_gpu_result_resume(&RENDERER).unwrap(),
        incumbent
    );
}
#[test]
fn pending_keyframe_rehashed_native_semantics_and_prepared_dma_fail_before_commit() {
    let c = capture(64, 17, false);
    let mut source = replay_before_scatter(&c);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let parts = sections(&saved);
    let gpu = &parts.iter().find(|(tag, _)| *tag == 12).unwrap().1;
    let (inner, chunks) = native_chunks(gpu);
    let p = chunks[5].start;
    let accepted = p + 63 + 26;
    let accepted_len = u32::from_le_bytes(gpu[accepted..accepted + 4].try_into().unwrap()) as usize;
    let request = accepted + 4 + accepted_len;
    let cases = vec![
        (
            "descriptor-underflow",
            p + 63,
            (virt::DRAM_BASE - 1).to_le_bytes().to_vec(),
        ),
        (
            "descriptor-overrun",
            p + 71,
            u32::MAX.to_le_bytes().to_vec(),
        ),
        ("descriptor-read-only", p + 88, vec![0]),
        ("flags", p + 37, vec![2]),
        ("padding", p + 54, vec![1]),
        ("pending-queue", p + 17, 99u64.to_le_bytes().to_vec()),
        ("exchange-limit", p + 25, 4097u64.to_le_bytes().to_vec()),
        (
            "accepted-epoch",
            accepted + 4 + 8,
            99u64.to_le_bytes().to_vec(),
        ),
        (
            "context-generation",
            request + 5,
            99u64.to_le_bytes().to_vec(),
        ),
        (
            "crosswired-in-range-chain",
            p + 63,
            (REQUEST + 42).to_le_bytes().to_vec(),
        ),
        (
            "queue-cached-frontier",
            inner - 9,
            99u16.to_le_bytes().to_vec(),
        ),
    ];
    let mut target = fresh(true, true);
    target
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    let incumbent = target.machine.save_gpu_result_resume(&RENDERER).unwrap();
    for (name, at, value) in cases {
        let mut bad = parts.clone();
        let gpu = &mut bad.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
        assert_ne!(&gpu[at..at + value.len()], &value);
        gpu[at..at + value.len()].copy_from_slice(&value);
        reseal_gpu_parts(&mut bad);
        assert!(
            target
                .machine
                .load_gpu_result_resume(&assemble(&saved, &bad), &RENDERER)
                .is_err(),
            "accepted {name}"
        );
        assert_eq!(
            target.machine.save_gpu_result_resume(&RENDERER).unwrap(),
            incumbent,
            "mutated on {name}"
        );
        println!("PENDING_KEYFRAME semantic={name} rehashed=true unchanged=true");
    }
    let mut bad = parts;
    let frontier = &mut bad.iter_mut().find(|(tag, _)| *tag == 22).unwrap().1;
    let result = frontier.windows(8).position(|v| v == b"WVGPUR01").unwrap();
    frontier[result + 81..result + 89].copy_from_slice(&u64::MAX.to_le_bytes());
    reseal(frontier);
    assert!(
        target
            .machine
            .load_gpu_result_resume(&assemble(&saved, &bad), &RENDERER)
            .is_err()
    );
    assert_eq!(
        target.machine.save_gpu_result_resume(&RENDERER).unwrap(),
        incumbent
    );
}

#[test]
fn pending_keyframe_retains_unconsumed_transport_and_finishes_without_new_callbacks() {
    let c = capture(64, 17, false);
    let frames = gpu_events(&c);
    let mut source = Rig::new(64, Some(c.tape.clone()), false);
    for (position, result) in frames[..2].iter().copied() {
        source
            .machine
            .prepare_session_gpu_replay(position, result, payload(&c, result))
            .unwrap();
        source.until(position.transition, 3);
        source.machine.deliver_session_gpu_replay().unwrap();
    }
    source.post(source.completion(Ok(()), 2)).unwrap();
    source
        .machine
        .prepare_session_gpu_replay(frames[2].0, frames[2].1, None)
        .unwrap();
    drain(&mut source);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut target = fresh(true, true);
    target
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    target.until(frames[2].0.transition, 11);
    target.machine.deliver_session_gpu_replay().unwrap();
    target.done();
    assert_no_reissue(&target);
    target.check(&c.result, 0x1100);
    assert_eq!(target.machine.bus_mut().ram().as_bytes(), c.ram);
    assert_eq!(target.machine.hart().to_snapshot(), c.cpu);
    println!(
        "PENDING_KEYFRAME retained transport=2 includes-owned-gather=true completion-published-once=true"
    );
}

#[test]
fn pending_keyframe_production_32m_payload_is_owned_hashed_and_restored() {
    let c = capture(32 << 20, 3, false);
    let mut source = replay_before_scatter(&c);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let prefix = source.trace.canonical();
    let mut target = Rig::new(c.result.len(), Some(empty_tape()), true);
    target
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    finish_replay(&mut target, &c, 1);
    assert_no_reissue(&target);
    assert_eq!(target.machine.bus_mut().ram().as_bytes(), c.ram);
    assert_eq!(target.machine.hart().to_snapshot(), c.cpu);
    assert_eq!(target.trace.canonical(), c.trace[prefix.len()..]);
    assert_eq!(logical_gpu(&target), c.virtual_gpu);
    println!(
        "PENDING_KEYFRAME production32MiB keyframe_bytes={} RAM_sha={}",
        saved.len(),
        hex(&Sha256::digest(&c.ram))
    );
}

fn next_guest_job(r: &mut Rig) {
    let mut submit = packet(0x207, 2, 36);
    put(&mut submit, 24, 4);
    put(&mut submit, 32, 0x01020304);
    put(&mut submit, 4, 1);
    submit[8..16].copy_from_slice(&0x9988_7766_5544_3322u64.to_le_bytes());
    r.write(REQUEST + 5 * 256, &submit);
    let mut d = [0; 32];
    d[..8].copy_from_slice(&(REQUEST + 5 * 256).to_le_bytes());
    put(&mut d, 8, 36);
    d[12..14].copy_from_slice(&1u16.to_le_bytes());
    d[14..16].copy_from_slice(&11u16.to_le_bytes());
    d[16..24].copy_from_slice(&(RESPONSE + 5 * 64).to_le_bytes());
    put(&mut d, 24, 24);
    d[28..30].copy_from_slice(&2u16.to_le_bytes());
    r.write(DESC + 5 * 32, &d);
    r.write(RESPONSE + 5 * 64, &[0xa5; 64]);
    r.write(AVAIL + 4 + 5 * 2, &10u16.to_le_bytes());
    let mut code = Code::default();
    code.li(
        1,
        Platform::virtio_base(r.machine.virtio_gpu().unwrap().0 as u64) as u32,
    );
    code.li(3, AVAIL as u32);
    code.li(2, 6);
    code.store(3, 2, 2, 1);
    code.mmio(0x50, 0);
    code.li(3, USED as u32);
    code.li(2, 6);
    code.load(4, 3, 2, 5);
    code.bne(4, 2, -4);
    code.0.push(0x0000006f);
    r.write(
        virt::DRAM_BASE + 0x5000,
        &code
            .0
            .into_iter()
            .flat_map(u32::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    r.machine.hart_mut().regs.pc = virt::DRAM_BASE + 0x5000;
    for _ in 0..100 {
        if r.gpu
            .borrow()
            .submit3d_snapshot()
            .unwrap()
            .pending
            .is_some()
        {
            return;
        }
        r.step();
    }
    panic!("second real guest job never submitted");
}
#[test]
fn pending_keyframe_new_guest_job_keeps_logical_result_identity_after_physical_rebase() {
    let mut original = Rig::new(64, None, false);
    original.pending();
    original.post(original.completion(Ok(()), 0)).unwrap();
    original.done();
    drain(&mut original);
    let saved = original.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut restored = fresh(false, true);
    restored
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    assert_no_reissue(&restored);
    original.trace = VecSink::new();
    for r in [&mut original, &mut restored] {
        next_guest_job(r);
        r.machine.submit3d_gather(&r.exchange(1)).unwrap();
        r.machine
            .submit3d_scatter(&r.exchange(2), &[0x82; 64])
            .unwrap();
        r.post(r.completion(Ok(()), 2)).unwrap();
        r.step();
    }
    let a = original.machine.take_session_gpu_recording().unwrap();
    let b = restored.machine.take_session_gpu_recording().unwrap();
    assert_eq!(a.events, b.events);
    assert_eq!(a.payloads, b.payloads);
    assert_eq!(logical_gpu(&original), logical_gpu(&restored));
    assert_eq!(
        original.machine.hart().to_snapshot(),
        restored.machine.hart().to_snapshot()
    );
    assert_eq!(
        original.machine.bus_mut().ram().as_bytes(),
        restored.machine.bus_mut().ram().as_bytes()
    );
    assert_eq!(original.trace.canonical(), restored.trace.canonical());
    assert_eq!(original.host.borrow().jobs[1].key.sequence, 2);
    assert_eq!(restored.host.borrow().jobs[0].key.sequence, 2);
    assert_ne!(
        original.host.borrow().jobs[1].key.epoch,
        restored.host.borrow().jobs[0].key.epoch
    );
    assert_eq!(restored.machine.bus_mut().load16(USED + 2).unwrap(), 6);
    println!(
        "PENDING_KEYFRAME subsequent real guest command logical_sequence2 fresh_physical_owner=true identical_receipts=true used6"
    );
}

#[test]
fn pending_keyframe_cannot_restore_a_common_clock_queue_that_strands_its_prepared_result() {
    let c = capture(64, 17, false);
    let mut source = replay_before_scatter(&c);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut parts = sections(&saved);
    let clock = &mut parts.iter_mut().find(|(tag, _)| *tag == 18).unwrap().1;
    assert_eq!(clock.len(), 58);
    let next = u64::from_le_bytes(clock[44..52].try_into().unwrap());
    clock[44..52].copy_from_slice(&(next + 1).to_le_bytes());
    clock[54..58].copy_from_slice(&1u32.to_le_bytes());
    clock.extend_from_slice(&(source.pos().transition + 1).to_le_bytes());
    clock.extend_from_slice(&next.to_le_bytes());
    clock.extend_from_slice(&[1, 0]);
    let candidate = assemble(&saved, &parts);
    let mut target = fresh(true, false);
    target
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    let before = target.machine.save_gpu_result_resume(&RENDERER).unwrap();
    evidence_blob("clock-queue.candidate", &candidate);
    evidence_blob("clock-queue.before", &before);
    let result = target.machine.load_gpu_result_resume(&candidate, &RENDERER);
    println!(
        "WORKER_CLOCK_QUEUE load={result:?}; before_epoch={} after_epoch={}",
        2,
        target.gpu.borrow().control3d_snapshot().unwrap().epoch
    );
    assert!(
        result.is_err(),
        "a saved GPU result cannot be restored behind an impossible common-clock queue"
    );
    let after = target.machine.save_gpu_result_resume(&RENDERER).unwrap();
    evidence_blob("clock-queue.after", &after);
    assert_eq!(before, after);
}

#[test]
fn pending_keyframe_cannot_relabel_an_owned_fence_as_quiescent() {
    let c = capture(64, 17, false);
    let mut source = replay_before_scatter(&c);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut parts = sections(&saved);
    let gpu = &mut parts.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
    let (inner, chunks) = native_chunks(gpu);
    let p = chunks[5].clone();
    let used = gpu[inner - 7..inner - 5].to_vec();
    gpu[inner - 9..inner - 7].copy_from_slice(&used);
    gpu[p.start - 4..p.start].copy_from_slice(&1u32.to_le_bytes());
    gpu.splice(p, [0]);
    let frontier = &mut parts.iter_mut().find(|(tag, _)| *tag == 22).unwrap().1;
    frontier[81..113].fill(0);
    assert_eq!(
        u32::from_le_bytes(frontier[141..145].try_into().unwrap()),
        0
    );
    frontier.truncate(145);
    frontier.push(0);
    frontier.extend_from_slice(&0u32.to_le_bytes());
    frontier.extend_from_slice(&[0; 32]);
    reseal_gpu_parts(&mut parts);
    let candidate = assemble(&saved, &parts);
    let mut target = fresh(true, true);
    target
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    let before = target.machine.save_gpu_result_resume(&RENDERER).unwrap();
    evidence_blob("erased-pending.candidate", &candidate);
    evidence_blob("erased-pending.before", &before);
    let result = target.machine.load_gpu_result_resume(&candidate, &RENDERER);
    println!("WORKER_ERASE_PENDING load={result:?}; GPU-counter admitted1/completed0/cancelled0");
    assert!(
        result.is_err(),
        "quiescent marker must agree with the owned admission ledger"
    );
    let after = target.machine.save_gpu_result_resume(&RENDERER).unwrap();
    evidence_blob("erased-pending.after", &after);
    assert_eq!(before, after);
    // Hiding the admission count too must not allow sequence high-water reuse.
    let gpu = &mut parts.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
    let (_, chunks) = native_chunks(gpu);
    let at = chunks[3].start + 16;
    gpu[at..at + 8].fill(0);
    reseal_gpu_parts(&mut parts);
    let bad = assemble(&saved, &parts);
    evidence_blob("erased-admission.candidate", &bad);
    assert!(
        target
            .machine
            .load_gpu_result_resume(&bad, &RENDERER)
            .is_err()
    );
    assert_eq!(
        before,
        target.machine.save_gpu_result_resume(&RENDERER).unwrap()
    );
}

#[path = "critic.rs"]
mod independent_critic;
