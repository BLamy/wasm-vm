// Promoted E6-T11d51 fresh-verifier ownership regression.
use super::*;

fn critic_split(q: &mut Queue, label: &str, request: Vec<u8>, expected: u32, split: usize) {
    let before = q
        .state
        .borrow()
        .control3d_snapshot()
        .unwrap()
        .canonical_bytes();
    let sink = q.recorder.borrow().events.clone();
    let req_len = request.len();
    let cut = split % (req_len - 1) + 1;
    let response_cut = split % 23 + 1;
    let (response, used) = q.submit_split(
        &request,
        &[cut, req_len - cut],
        &[response_cut, 24 - response_cut],
    );
    q.record_case(label, &request, &response);
    assert_eq!(used, 24);
    assert_eq!(response, reply(&request, expected));
    assert_eq!(q.read(RESPONSE + 24, 40), vec![0xa5; 40]);
    if expected != OK {
        assert_eq!(
            q.state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .canonical_bytes(),
            before
        );
        assert_eq!(q.recorder.borrow().events, sink);
    }
}

#[test]
fn desktop_critic_three_fresh_ownership_schedules() {
    for seed in [0x31c7_u32, 0xb92d, 0xe563] {
        let mut q = Queue::desktop(true);
        let base = 0xd520_0000 + (seed << 8);
        let ctx = base + 7;
        q.expect("critic-context-A", context(ctx), OK);
        q.expect("critic-context-B", context(ctx + 1), OK);
        for i in 0..64u32 {
            let n = (i * 37 + seed) % 64;
            let id = base + n * 23;
            let mut packet = resource(
                id,
                2,
                [1, 2, 67, 20][n as usize % 4],
                if n % 4 == 3 {
                    9
                } else {
                    2 | (1 << 18) | (1 << 20)
                },
                3,
                2,
            );
            put32(&mut packet, 4, 1);
            packet[8..16]
                .copy_from_slice(&(0x5a71_9000_0000_0000u64 + u64::from(id)).to_le_bytes());
            critic_split(&mut q, "critic-shuffled64", packet, OK, (seed + i) as usize);
            assert_eq!(
                q.state
                    .borrow()
                    .control3d_snapshot()
                    .unwrap()
                    .resources
                    .len(),
                i as usize + 1
            );
        }
        q.unchanged(
            "critic-independent65-refusal",
            resource(base + 0x10000, 2, 1, 2, 3, 2),
            OOM,
        );
        let id = base;
        q.expect("critic-membership-A", id_command(0x202, ctx, id), OK);
        q.expect("critic-membership-B", id_command(0x202, ctx + 1, id), OK);
        let pattern: Vec<u8> = (0..32).map(|i| (i as u8) ^ seed as u8).collect();
        q.write(BACKING + 5, &pattern);
        q.expect(
            "critic-overlapping-backing",
            backing(id, &[(BACKING + 5, 7), (BACKING + 9, 8), (BACKING + 5, 7)]),
            OK,
        );
        let saved = q.recorder.borrow().events.last().unwrap().clone();
        if let Control3dOperation::AttachBacking { segments, .. } = &saved.operation {
            assert_eq!(
                segments
                    .iter()
                    .flat_map(|s| s.bytes.iter().copied())
                    .collect::<Vec<_>>(),
                [&pattern[..7], &pattern[4..12], &pattern[..7]].concat()
            );
            eprintln!("CRITIC_OWNED_BACKING seed={seed} {saved:?}");
        } else {
            panic!("expected owned backing");
        }
        q.write(BACKING + 5, &[0xee; 32]);
        q.write(REQUEST, &[0xdd; 72]);
        assert_eq!(
            *q.recorder.borrow().events.last().unwrap(),
            saved,
            "guest/request mutations must not mutate owned event"
        );
        let generation = q
            .state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .resources
            .iter()
            .find(|r| r.identity.id == id)
            .unwrap()
            .identity
            .generation;
        q.recorder.borrow_mut().fail_next = Some(Control3dError::OutOfMemory);
        q.unchanged("critic-unref-host-failure", id_command(0x102, 0, id), OOM);
        q.expect(
            "critic-unref-with-two-memberships",
            id_command(0x102, 0, id),
            OK,
        );
        q.recorder.borrow_mut().fail_next = Some(Control3dError::OutOfMemory);
        q.unchanged(
            "critic-create-host-failure",
            resource(id, 2, 1, 2, 3, 2),
            OOM,
        );
        critic_split(
            &mut q,
            "critic-same-ID-recovery",
            resource(id, 2, 1, 2, 3, 2),
            OK,
            seed as usize,
        );
        let state = q.state.borrow().control3d_snapshot().unwrap();
        assert_eq!(state.resources.len(), 64);
        assert_eq!(state.backing_bytes, 0);
        assert!(
            state
                .resources
                .iter()
                .find(|r| r.identity.id == id)
                .unwrap()
                .identity
                .generation
                > generation
        );
        assert!(state.contexts.iter().all(|c| c.resources.is_empty()));
        q.unchanged(
            "critic-stale-A",
            id_command(0x203, ctx, id),
            INVALID_PARAMETER,
        );
        q.unchanged(
            "critic-stale-B",
            id_command(0x203, ctx + 1, id),
            INVALID_PARAMETER,
        );
        q.unchanged(
            "critic-duplicate-live-ID",
            resource(id, 2, 1, 2, 3, 2),
            INVALID_RESOURCE,
        );
        q.expect("critic-fresh-membership", id_command(0x202, ctx, id), OK);
        let mut two = header(0x101, 0, 40);
        for (off, val) in [(24, id), (28, 67), (32, 2), (36, 2)] {
            put32(&mut two, off, val);
        }
        q.unchanged("critic-2D-collision", two.clone(), INVALID_RESOURCE);
        q.expect("critic-release-for-2D", id_command(0x102, 0, id), OK);
        q.expect("critic-2D-owns-ID", two, OK);
        q.unchanged(
            "critic-3D-collision",
            resource(id, 2, 2, 2, 3, 2),
            INVALID_RESOURCE,
        );
        q.expect("critic-2D-unref", id_command(0x102, 0, id), OK);
        let old = q.state.borrow().control3d_snapshot().unwrap();
        eprintln!(
            "CRITIC_SINK_BEFORE_RESET seed={seed} {:?}",
            q.recorder.borrow().events
        );
        q.mmio(0x70, 0);
        assert_eq!(q.machine.run(1), RunOutcome::MaxInstrs);
        let reset = q.state.borrow().control3d_snapshot().unwrap();
        assert!(reset.epoch > old.epoch);
        assert!(reset.contexts.is_empty() && reset.resources.is_empty());
        assert_eq!(
            (reset.logical_bytes, reset.gpu_bytes, reset.backing_bytes),
            (0, 0, 0)
        );
        q.next = 0;
        q.configure();
        q.negotiate();
        q.expect(
            "critic-reset-retains-selected",
            resource(id, 2, 1, 2 | (1 << 18) | (1 << 20), 3, 2),
            OK,
        );
        q.expect("critic-final-release", id_command(0x102, 0, id), OK);
        eprintln!(
            "CRITIC_SINK_AFTER_RESET seed={seed} {:?}",
            q.recorder.borrow().events
        );
    }
}
