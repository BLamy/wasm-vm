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
        2
    );
    let mut at = inner + 48;
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
    let (inner, _) = native_chunks(gpu);
    let end = gpu.len() - 32;
    let sha = Sha256::digest(&gpu[inner..end]);
    gpu[end..].copy_from_slice(&sha);
    let sha = Sha256::digest(&gpu[..]);
    let frontier = &mut parts.iter_mut().find(|(tag, _)| *tag == 22).unwrap().1;
    frontier[8..40].copy_from_slice(&sha);
    reseal(frontier);
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
