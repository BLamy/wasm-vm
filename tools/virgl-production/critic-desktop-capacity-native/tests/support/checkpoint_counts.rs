//! Fully present, rehashed native sections exercise detached count validation.
//! No renderer/transport substitute is installed for this native metadata claim.
use super::*;
use sha2::{Digest, Sha256};
use std::ops::Range;

const WITNESS: [u8; 32] = [0x74; 32];
struct Envelope {
    gpu_length_at: usize,
    gpu: Range<usize>,
    inner: Range<usize>,
    control: Range<usize>,
}
fn get32(b: &[u8], at: usize) -> usize {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap()) as usize
}
fn get64(b: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(b[at..at + 8].try_into().unwrap())
}
fn set32(b: &mut [u8], at: usize, n: usize) {
    b[at..at + 4].copy_from_slice(&u32::try_from(n).unwrap().to_le_bytes());
}
fn set64(b: &mut [u8], at: usize, n: u64) {
    b[at..at + 8].copy_from_slice(&n.to_le_bytes());
}
fn envelope(bytes: &[u8]) -> Envelope {
    assert_eq!(&bytes[..8], b"WVMRESU1");
    let end = bytes.len() - 84;
    assert_eq!(&bytes[end..end + 8], b"WVGRESU1");
    assert_eq!(get64(bytes, end + 12), end as u64);
    assert_eq!(
        &Sha256::digest(&bytes[..bytes.len() - 32])[..],
        &bytes[bytes.len() - 32..]
    );
    let mut at = 84;
    let mut selected = None;
    while at < end {
        let tag = get32(bytes, at);
        let payload = at + 8..at + 8 + get32(bytes, at + 4);
        assert!(payload.end <= end);
        if tag == 12 {
            assert!(selected.is_none());
            selected = Some((at + 4, payload.clone()));
        }
        at = payload.end;
    }
    assert_eq!(at, end, "every outer TLV extent is complete");
    let (gpu_length_at, gpu) = selected.unwrap();
    let matches = bytes[gpu.clone()]
        .windows(8)
        .enumerate()
        .filter_map(|(at, value)| (value == b"WVGPU3D1").then_some(at))
        .collect::<Vec<_>>();
    assert_eq!(matches.len(), 1);
    let inner = gpu.start + matches[0]..gpu.end;
    assert_eq!(
        &Sha256::digest(&bytes[inner.start..inner.end - 32])[..],
        &bytes[inner.end - 32..inner.end]
    );
    at = inner.start + 48;
    let mut chunks = Vec::new();
    for _ in 0..5 {
        let length = get32(bytes, at);
        chunks.push(at + 4..at + 4 + length);
        at += 4 + length;
    }
    assert_eq!(
        at,
        inner.end - 32,
        "all five inner chunks are fully present"
    );
    Envelope {
        gpu_length_at,
        gpu,
        inner,
        control: chunks[2].clone(),
    }
}
struct ControlFields {
    contexts: Vec<Range<usize>>,
    members: Vec<Range<usize>>,
    resource_count_at: usize,
    resources: Vec<Range<usize>>,
}
fn control_fields(control: &[u8]) -> ControlFields {
    assert_eq!(&control[..8], b"WV3DCTL2");
    let mut at = 61;
    let mut contexts = Vec::new();
    let mut members = Vec::new();
    for _ in 0..get32(control, 57) {
        let start = at;
        at += 12;
        let debug = get32(control, at);
        at += 4 + debug;
        let count_at = at;
        at += 4 + get32(control, at) * 12;
        contexts.push(start..at);
        members.push(count_at..at);
    }
    let resource_count_at = at;
    let count = get32(control, at);
    at += 4;
    let mut resources = Vec::new();
    for _ in 0..count {
        let start = at;
        assert_eq!(
            control[at + 56],
            0,
            "count specimen has no attached backings"
        );
        at += 57;
        resources.push(start..at);
    }
    assert_eq!(
        at,
        control.len(),
        "control section is complete, not truncated"
    );
    ControlFields {
        contexts,
        members,
        resource_count_at,
        resources,
    }
}
fn replace_control(blob: &[u8], control: &[u8]) -> Vec<u8> {
    // Both the enclosing GPU TLV and the accelerated whole-machine trailer bind
    // the altered full-length section. A checksum failure cannot satisfy this test.
    control_fields(control);
    let fields = envelope(blob);
    let old_len = fields.control.len();
    let mut out = blob.to_vec();
    out.splice(fields.control.clone(), control.iter().copied());
    let changed = |n: usize| n + control.len() - old_len;
    set32(&mut out, fields.control.start - 4, control.len());
    set32(&mut out, fields.gpu_length_at, changed(fields.gpu.len()));
    let inner_end = changed(fields.inner.end);
    let hash = Sha256::digest(&out[fields.inner.start..inner_end - 32]);
    out[inner_end - 32..inner_end].copy_from_slice(&hash);
    let payload_end = out.len() - 84;
    set64(&mut out, payload_end + 12, payload_end as u64);
    let hash_end = out.len() - 32;
    let hash = Sha256::digest(&out[..hash_end]);
    out[hash_end..].copy_from_slice(&hash);
    let reread = envelope(&out);
    assert_eq!(&out[reread.control], control);
    out
}
fn plus_resource(control: &[u8]) -> Vec<u8> {
    let f = control_fields(control);
    assert_eq!(f.resources.len(), 512);
    let mut out = control.to_vec();
    let generation = get64(control, 16);
    set64(&mut out, 16, generation + 1);
    set64(&mut out, 32, get64(control, 32) + 16);
    set64(&mut out, 40, get64(control, 40) + 16);
    set32(&mut out, f.resource_count_at, 513);
    out.extend_from_slice(&3000u32.to_le_bytes());
    out.extend_from_slice(&generation.to_le_bytes());
    out.extend_from_slice(&buffer(3000)[24..68]);
    out.push(0);
    assert_eq!(control_fields(&out).resources.len(), 513);
    out
}

#[test]
fn rehashed_complete_33_context_513_resource_and_roster_sections_refuse_detached() {
    for cached in [false, true] {
        let mut source = Rig::new(Profile::Production, cached);
        for id in 1000..1032 {
            source.command(&context_packet(0x200, id), 0x1100);
        }
        for id in 2000..2512 {
            source.command(&buffer(id), 0x1100);
            let mut attach = literal(0x202, &[id, 0]);
            attach[16..20].copy_from_slice(&1000u32.to_le_bytes());
            source.command(&attach, 0x1100);
        }
        let blob = source.machine.save_accelerated_resume(&WITNESS).unwrap();
        let fields = envelope(&blob);
        let control = &blob[fields.control];
        let cf = control_fields(control);
        assert_eq!(cf.contexts.len(), 32);
        assert_eq!(cf.resources.len(), 512);
        assert_eq!(get32(control, cf.members[0].start), 512);
        // Positive full-count native restore is independently exercised before
        // altering counts, so stale build/qualification cannot explain refusals.
        let mut positive = Rig::new(Profile::Production, cached);
        assert_eq!(
            positive
                .machine
                .load_accelerated_resume(&blob, &WITNESS)
                .unwrap(),
            (1, 2)
        );
        let loaded = positive.state.borrow().control3d_snapshot().unwrap();
        assert_eq!(loaded.contexts.len(), 32);
        assert_eq!(loaded.resources.len(), 512);
        assert_eq!(loaded.contexts[0].resources.len(), 512);

        let mut contexts33 = control.to_vec();
        let generation = get64(control, 16);
        let mut entry = Vec::new();
        entry.extend_from_slice(&1032u32.to_le_bytes());
        entry.extend_from_slice(&generation.to_le_bytes());
        entry.extend_from_slice(&[0u8; 8]); // present empty debug name and member list
        contexts33.splice(cf.resource_count_at..cf.resource_count_at, entry);
        set32(&mut contexts33, 57, 33);
        set64(&mut contexts33, 16, generation + 1);
        let resources513 = plus_resource(control);
        // A unique513th membership must reference an actually present513th
        // resource; otherwise missing-reference validation could mask this guard.
        let mut roster513 = resources513.clone();
        let roster_end = cf.members[0].end;
        let mut member = 3000u32.to_le_bytes().to_vec();
        member.extend_from_slice(&generation.to_le_bytes());
        roster513.splice(roster_end..roster_end, member);
        set32(&mut roster513, cf.members[0].start, 513);
        let mut duplicate_context = control.to_vec();
        let penultimate = get32(control, cf.contexts[30].start);
        set32(&mut duplicate_context, cf.contexts[31].start, penultimate);
        let mut duplicate_resource = control.to_vec();
        let penultimate = get32(control, cf.resources[510].start);
        set32(
            &mut duplicate_resource,
            cf.resources[511].start,
            penultimate,
        );
        set32(
            &mut duplicate_resource,
            cf.resources[511].start + 12,
            penultimate,
        );
        let mut duplicate_member = control.to_vec();
        let last = cf.members[0].end - 12;
        duplicate_member.copy_within(last - 12..last, last);
        let cases = [
            ("context33-complete", contexts33),
            ("resource513-complete", resources513),
            ("roster513-unique-complete", roster513),
            ("context32-tail-duplicate", duplicate_context),
            ("resource512-tail-duplicate", duplicate_resource),
            ("roster512-tail-duplicate", duplicate_member),
        ];
        let mut target = Rig::new(Profile::Production, cached);
        target.command(&buffer(37), 0x1100);
        target.machine.hart_mut().regs.write(5, 0xcafe);
        target
            .machine
            .bus_mut()
            .store64(virt::DRAM_BASE + 0x70000, 0x4352_4954_4943_7402)
            .unwrap();
        let before = target.machine.save_accelerated_resume(&WITNESS).unwrap();
        let architecture = target.machine.snapshot();
        let owner = target.state.borrow().control3d_snapshot().unwrap();
        let submit = target.state.borrow().submit3d_snapshot().unwrap();
        let host_calls = target.controls.0.borrow().len();
        for (name, control) in cases {
            let bad = replace_control(&blob, &control);
            let result = target.machine.load_accelerated_resume(&bad, &WITNESS);
            assert_eq!(
                result,
                Err(wasm_vm_core::resume::SnapshotError::BadComponentState { tag: 12 }),
                "accepted {name}"
            );
            assert_eq!(
                target.machine.snapshot(),
                architecture,
                "CPU/RAM mutation: {name}"
            );
            assert_eq!(
                target.state.borrow().control3d_snapshot().unwrap(),
                owner,
                "control owner mutation: {name}"
            );
            assert_eq!(
                target.state.borrow().submit3d_snapshot().unwrap(),
                submit,
                "submission owner mutation: {name}"
            );
            assert_eq!(
                target.controls.0.borrow().len(),
                host_calls,
                "host publication: {name}"
            );
            assert_eq!(
                target.machine.save_accelerated_resume(&WITNESS).unwrap(),
                before,
                "whole machine/transport mutation: {name}"
            );
            eprintln!(
                "CRITIC_DESKTOP_CHECKPOINT cached={cached} case={name} originalBytes={} rehashedBytes={} sha256={:x} result={result:?}",
                blob.len(),
                bad.len(),
                Sha256::digest(&bad)
            );
        }
        target.trace("rehashed-count-refusals", Profile::Production, cached);
    }
}
