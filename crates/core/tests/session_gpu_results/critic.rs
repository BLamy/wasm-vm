//! Independent critic regressions: repaired seals must not legitimize incoherent owners.
use super::*;
fn critic_host_signature(r: &Rig) -> (usize, usize, usize, usize, usize) {
    let h = r.host.borrow();
    (
        h.jobs.len(),
        h.scanouts.len(),
        h.controls.len(),
        h.cancelled.len(),
        h.leases.len(),
    )
}
fn critic_refuse(r: &mut Rig, name: &str, candidate: &[u8], tag: u32) {
    let before = r.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let host = critic_host_signature(r);
    evidence_blob(&format!("critic-{name}.candidate"), candidate);
    evidence_blob(&format!("critic-{name}.before"), &before);
    for attempt in 0..3 {
        let result = r.machine.load_gpu_result_resume(candidate, &RENDERER);
        assert_eq!(
            result,
            Err(wasm_vm_core::resume::SnapshotError::BadComponentState { tag }),
            "accepted or misclassified {name}"
        );
        let after = r.machine.save_gpu_result_resume(&RENDERER).unwrap();
        assert_eq!(after, before, "incumbent changed: {name}");
        assert_eq!(critic_host_signature(r), host, "host call: {name}");
        evidence_blob(&format!("critic-{name}.after-{attempt}"), &after);
        println!(
            "CRITIC_REFUSAL name={name} attempt={attempt} tag={tag} unchanged_sha={} host={host:?}",
            hex(&Sha256::digest(&after))
        );
    }
}
fn critic_replace_chunk(parts: &mut [(u32, Vec<u8>)], index: usize, value: Vec<u8>) {
    let gpu = &mut parts.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
    let (inner, ranges) = native_chunks(gpu);
    let mut chunks: Vec<Vec<u8>> = ranges.iter().map(|r| gpu[r.clone()].to_vec()).collect();
    chunks[index] = value;
    let mut result = gpu[..inner + 50].to_vec();
    for chunk in chunks {
        result.extend_from_slice(&(chunk.len() as u32).to_le_bytes());
        result.extend(chunk);
    }
    result.extend_from_slice(&[0; 32]);
    *gpu = result;
    reseal_gpu_parts(parts);
}
fn critic_native_offsets(gpu: &[u8]) -> (usize, usize, usize, usize, usize) {
    let (_, chunks) = native_chunks(gpu);
    let p = chunks[5].start;
    let segments = u32::from_le_bytes(gpu[p + 59..p + 63].try_into().unwrap()) as usize;
    let a = p + 63 + 13 * segments;
    let n = u32::from_le_bytes(gpu[a..a + 4].try_into().unwrap()) as usize;
    let request = a + 4 + n;
    let resources =
        u32::from_le_bytes(gpu[request + 13..request + 17].try_into().unwrap()) as usize;
    let kind = request + 17 + 12 * resources;
    let n = u32::from_le_bytes(gpu[kind + 1..kind + 5].try_into().unwrap()) as usize;
    let completion = kind + 5 + n;
    (p, a, request, kind, completion)
}
#[test]
fn critic_native_malformed_leaf_tags_lengths_and_frontier_are_atomic() {
    let c = capture(64, 17, false);
    let mut source = replay_before_scatter(&c);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let parts = sections(&saved);
    let gpu = &parts.iter().find(|(tag, _)| *tag == 12).unwrap().1;
    let (p, a, request, kind, completion) = critic_native_offsets(gpu);
    let mut cases: Vec<(&str, usize, Vec<u8>)> = vec![
        ("pending-marker", p, vec![2]),
        ("descriptor-bool", p + 75, vec![2]),
        ("request-tag", request, vec![3]),
        ("command-kind", kind, vec![3]),
        ("header-context", p + 49, 3u32.to_le_bytes().to_vec()),
        ("command-length", p + 71, 35u32.to_le_bytes().to_vec()),
        (
            "command-blob-limit",
            kind + 1,
            (262145u32).to_le_bytes().to_vec(),
        ),
        ("completion-bool", completion + 9, vec![2]),
        (
            "completion-command-limit",
            completion + 10,
            4097u32.to_le_bytes().to_vec(),
        ),
        (
            "completion-draw-limit",
            completion + 14,
            257u32.to_le_bytes().to_vec(),
        ),
        (
            "descriptor-count-limit",
            p + 59,
            257u32.to_le_bytes().to_vec(),
        ),
        (
            "accepted-blob-limit",
            a,
            ((32u32 << 20) + 1).to_le_bytes().to_vec(),
        ),
    ];
    cases.push((
        "trace-build-tag",
        completion + 18,
        vec![u8::from(!cfg!(feature = "gpu-trace"))],
    ));
    #[cfg(feature = "gpu-trace")]
    cases.extend([
        ("trace-optional-tag", completion + 23, vec![2]),
        ("trace-transfer-tag", completion + 86, vec![2]),
    ]);
    #[cfg(feature = "gpu-trace")]
    cases.extend([
        (
            "trace-absent-nonzero",
            completion + 23,
            [vec![0], 1u64.to_le_bytes().to_vec()].concat(),
        ),
        (
            "trace-u32-overflow",
            completion + 41,
            [vec![1], u64::MAX.to_le_bytes().to_vec()].concat(),
        ),
        (
            "trace-absent-words",
            completion + 86,
            [vec![0], 1u32.to_le_bytes().to_vec()].concat(),
        ),
    ]);
    let mut target = fresh(true, false);
    target
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    for (name, at, value) in cases {
        let mut bad = parts.clone();
        let gpu = &mut bad.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
        assert_ne!(
            &gpu[at..at + value.len()],
            &value,
            "unchanged mutation {name}"
        );
        gpu[at..at + value.len()].copy_from_slice(&value);
        reseal_gpu_parts(&mut bad);
        critic_refuse(&mut target, name, &assemble(&saved, &bad), 12);
    }
    // Every length prefix and seal is repaired for variable-sized structural attacks.
    {
        let mut bad = parts.clone();
        let gpu = &bad.iter().find(|(tag, _)| *tag == 12).unwrap().1;
        let (_, chunks) = native_chunks(gpu);
        let mut pending = gpu[chunks[5].clone()].to_vec();
        let q = request - p;
        let identity = pending[q + 17..q + 29].to_vec();
        pending[q + 13..q + 17].copy_from_slice(&2u32.to_le_bytes());
        pending.splice(q + 29..q + 29, identity);
        critic_replace_chunk(&mut bad, 5, pending);
        critic_refuse(
            &mut target,
            "duplicate-resource",
            &assemble(&saved, &bad),
            12,
        );
    }
    for (name, at, value) in [
        ("frontier-bool", 40, vec![2]),
        ("frontier-object-limit", 141, 257u32.to_le_bytes().to_vec()),
    ] {
        let mut bad = parts.clone();
        let f = &mut bad.iter_mut().find(|(tag, _)| *tag == 22).unwrap().1;
        f[at..at + value.len()].copy_from_slice(&value);
        reseal(f);
        critic_refuse(&mut target, name, &assemble(&saved, &bad), 22);
    }
    for (name, mutate) in [
        ("prepared-ordinal", 0u8),
        ("prepared-clock-sequence", 1),
        ("prepared-future-retired", 2),
    ] {
        let mut bad = parts.clone();
        let f = &mut bad.iter_mut().find(|(tag, _)| *tag == 22).unwrap().1;
        assert_eq!(f[145], 1);
        match mutate {
            0 => f[162..166].fill(0),
            1 => {
                let now = f[133..141].to_vec();
                f[166..174].copy_from_slice(&now)
            }
            _ => f[154..162].copy_from_slice(&u64::MAX.to_le_bytes()),
        };
        reseal(f);
        critic_refuse(&mut target, name, &assemble(&saved, &bad), 22);
    }
    for which in [0, 1] {
        let mut bad = parts.clone();
        let f = &mut bad.iter_mut().find(|(tag, _)| *tag == 22).unwrap().1;
        let transition = f[113..121].to_vec();
        let retired = f[121..129].to_vec();
        let ordinal = u32::from_le_bytes(f[129..133].try_into().unwrap());
        let sequence = u64::from_le_bytes(f[133..141].try_into().unwrap());
        f[146..154].copy_from_slice(&transition);
        f[154..162].copy_from_slice(&retired);
        f[162..166].copy_from_slice(&(ordinal + 1 + u32::from(which == 0)).to_le_bytes());
        f[166..174].copy_from_slice(&(sequence + 1 + u64::from(which == 1)).to_le_bytes());
        reseal(f);
        critic_refuse(
            &mut target,
            if which == 0 {
                "same-boundary-ordinal-gap"
            } else {
                "same-boundary-sequence-gap"
            },
            &assemble(&saved, &bad),
            22,
        );
    }
    println!("RESPONSE_CODEC tags_boolean_lengths_counts_trace_clock=true repeated_atomic=true");
}

#[test]
fn critic_quiescent_sequence_high_water_is_independent_of_fence_bounds() {
    let mut source = Rig::new(64, None, false);
    source.pending();
    source.post(source.completion(Ok(()), 0)).unwrap();
    source.done();
    drain(&mut source);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let parts = sections(&saved);
    let gpu = &parts.iter().find(|(tag, _)| *tag == 12).unwrap().1;
    let (_, chunks) = native_chunks(gpu);
    let submit = chunks[3].start;
    for (offset, expected) in [(8, 2u64), (16, 1), (24, 1), (32, 0), (40, 1)] {
        assert_eq!(
            u64::from_le_bytes(
                gpu[submit + offset..submit + offset + 8]
                    .try_into()
                    .unwrap()
            ),
            expected
        );
    }
    assert_eq!(&gpu[chunks[5].clone()], &[0]);
    let mut target = fresh(false, true);
    target
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    // All old scalar inequalities and admitted=completed+cancelled hold. Only next_sequence differs.
    let mut bad = parts.clone();
    let gpu = &mut bad.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
    gpu[submit + 8..submit + 16].copy_from_slice(&3u64.to_le_bytes());
    reseal_gpu_parts(&mut bad);
    critic_refuse(
        &mut target,
        "quiescent-sequence3",
        &assemble(&saved, &bad),
        12,
    );
    // A ledger sum that wraps to admitted must also refuse (checked_add, never wrapping_add).
    let mut bad = parts.clone();
    let gpu = &mut bad.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
    for (offset, value) in [(8, 1u64), (16, u64::MAX), (24, u64::MAX), (32, 1), (40, 0)] {
        gpu[submit + offset..submit + offset + 8].copy_from_slice(&value.to_le_bytes());
    }
    reseal_gpu_parts(&mut bad);
    critic_refuse(
        &mut target,
        "counter-sum-overflow",
        &assemble(&saved, &bad),
        12,
    );
    println!(
        "CRITIC_SEQUENCE scalar_bounds_valid=true completed1 cancelled0 admitted1 fenced1 next_sequence3 rejected=true"
    );
}
fn critic_erased_owner(saved: &[u8]) -> Vec<(u32, Vec<u8>)> {
    let mut parts = sections(saved);
    let gpu = &mut parts.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
    let (inner, chunks) = native_chunks(gpu);
    let used = gpu[inner - 7..inner - 5].to_vec();
    gpu[inner - 9..inner - 7].copy_from_slice(&used);
    gpu.splice(
        chunks[5].start - 4..chunks[5].end,
        [1u32.to_le_bytes().as_slice(), &[0]].concat(),
    );
    let frontier = &mut parts.iter_mut().find(|(tag, _)| *tag == 22).unwrap().1;
    assert_eq!(
        u32::from_le_bytes(frontier[141..145].try_into().unwrap()),
        0
    );
    frontier[81..113].fill(0);
    frontier.truncate(145);
    frontier.push(0);
    frontier.extend_from_slice(&0u32.to_le_bytes());
    frontier.extend_from_slice(&[0; 32]);
    reseal_gpu_parts(&mut parts);
    parts
}
#[test]
fn critic_erased_owner_and_staged_clock_refuse_without_host_reissue() {
    let c = capture(64, 17, false);
    let mut source = replay_before_scatter(&c);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let mut target = fresh(true, true);
    target
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    let mut parts = critic_erased_owner(&saved);
    critic_refuse(&mut target, "erased-owner", &assemble(&saved, &parts), 12);
    // Clear fenced as well: this variant passes the older fenced<=admitted guard.
    let gpu = &mut parts.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
    let (_, chunks) = native_chunks(gpu);
    let submit = chunks[3].start;
    gpu[submit + 16..submit + 24].fill(0);
    gpu[submit + 40..submit + 48].fill(0);
    assert_eq!(
        u64::from_le_bytes(gpu[submit + 8..submit + 16].try_into().unwrap()),
        2
    );
    reseal_gpu_parts(&mut parts);
    critic_refuse(
        &mut target,
        "erased-admission-fenced0",
        &assemble(&saved, &parts),
        12,
    );
    let mut parts = sections(&saved);
    let clock = &mut parts.iter_mut().find(|(tag, _)| *tag == 18).unwrap().1;
    assert_eq!(clock.len(), 58);
    let ticket = u64::from_le_bytes(clock[44..52].try_into().unwrap());
    clock[44..52].copy_from_slice(&(ticket + 1).to_le_bytes());
    clock[54..58].copy_from_slice(&1u32.to_le_bytes());
    clock.extend_from_slice(&(source.pos().transition + 1).to_le_bytes());
    clock.extend_from_slice(&ticket.to_le_bytes());
    clock.extend_from_slice(&[1, 0]);
    critic_refuse(
        &mut target,
        "staged-clock-queue",
        &assemble(&saved, &parts),
        22,
    );
    target.machine.deliver_session_gpu_replay().unwrap();
    drain(&mut target);
    let snapshot = target.machine.snapshot();
    let position = target.pos();
    let host = critic_host_signature(&target);
    for _ in 0..3 {
        assert_eq!(
            target.machine.run_traced(1, &mut target.trace),
            RunOutcome::SessionStopped(SessionError::GpuResult(GpuError::PhysicalPending))
        );
        assert_eq!(target.machine.snapshot(), snapshot);
        assert_eq!(target.pos(), position);
        assert_eq!(critic_host_signature(&target), host);
    }
    let frames = gpu_events(&c);
    target
        .machine
        .prepare_session_gpu_replay(frames[2].0, frames[2].1, None)
        .unwrap();
    target.until(frames[2].0.transition, 13);
    target.machine.deliver_session_gpu_replay().unwrap();
    target.done();
    target.check(&c.result, 0x1100);
    assert_no_reissue(&target);
    assert_eq!(target.machine.hart().to_snapshot(), c.cpu);
    assert_eq!(target.machine.bus_mut().ram().as_bytes(), c.ram);
    target.dump_state("critic-erased-owner", "finished");
    println!(
        "CRITIC_OWNER closed=true original_fence_retired_once=true used5 cursor3 exact_CPU_RAM=true no_host_job=true"
    );
}
#[test]
fn critic_transfer_decode_refuses_wrong_header_direction_and_extent() {
    for job in [1, 2, 4] {
        let mut source = Rig::with_job(64, None, false, job);
        source.pending();
        source.post(source.completion(Ok(()), 0)).unwrap();
        drain(&mut source);
        let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
        let parts = sections(&saved);
        let gpu = &parts.iter().find(|(tag, _)| *tag == 12).unwrap().1;
        let (_, chunks) = native_chunks(gpu);
        let p = chunks[5].start;
        let a = p + 63 + 13 * u32::from_le_bytes(gpu[p + 59..p + 63].try_into().unwrap()) as usize;
        let request = a + 4 + u32::from_le_bytes(gpu[a..a + 4].try_into().unwrap()) as usize;
        let kind = request
            + 17
            + 12 * u32::from_le_bytes(gpu[request + 13..request + 17].try_into().unwrap()) as usize;
        assert_eq!(gpu[kind], 2);
        let mut target = fresh(false, false);
        target
            .machine
            .load_gpu_result_resume(&saved, &RENDERER)
            .unwrap();
        for (name, at, value) in [
            ("unsupported-header", p + 33, 0x208u32),
            ("wrong-direction", kind + 49, if job == 2 { 1 } else { 2 }),
            ("missing-transfer-resource", kind + 33, 4),
            ("transfer-x-overflow", kind + 9, u32::MAX),
        ] {
            let mut bad = parts.clone();
            let gpu = &mut bad.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
            gpu[at..at + 4].copy_from_slice(&value.to_le_bytes());
            reseal_gpu_parts(&mut bad);
            critic_refuse(
                &mut target,
                &format!("transfer{job}-{name}"),
                &assemble(&saved, &bad),
                12,
            );
        }
    }
}

#[test]
fn critic_pending_queue_alignment_and_ranges_refuse_atomically() {
    let c = capture(64, 17, false);
    let mut source = replay_before_scatter(&c);
    let saved = source.machine.save_gpu_result_resume(&RENDERER).unwrap();
    let parts = sections(&saved);
    let gpu = &parts.iter().find(|(tag, _)| *tag == 12).unwrap().1;
    for (offset, expected) in [(50, DESC), (58, AVAIL), (66, USED)] {
        assert_eq!(
            u64::from_le_bytes(gpu[offset..offset + 8].try_into().unwrap()),
            expected
        );
    }
    let (_, chunks) = native_chunks(gpu);
    let head = chunks[5].start + 57;
    let mut target = fresh(true, true);
    target
        .machine
        .load_gpu_result_resume(&saved, &RENDERER)
        .unwrap();
    for (name, offset, value) in [
        ("ring-desc-align", 50, (DESC + 1).to_le_bytes().to_vec()),
        ("ring-avail-align", 58, (AVAIL + 1).to_le_bytes().to_vec()),
        ("ring-used-align", 66, (USED + 1).to_le_bytes().to_vec()),
        (
            "ring-desc-overflow",
            50,
            (u64::MAX - 15).to_le_bytes().to_vec(),
        ),
        ("ring-head-limit", head, 256u16.to_le_bytes().to_vec()),
    ] {
        let mut bad = parts.clone();
        let gpu = &mut bad.iter_mut().find(|(tag, _)| *tag == 12).unwrap().1;
        gpu[offset..offset + value.len()].copy_from_slice(&value);
        reseal_gpu_parts(&mut bad);
        critic_refuse(&mut target, name, &assemble(&saved, &bad), 22);
    }
}
