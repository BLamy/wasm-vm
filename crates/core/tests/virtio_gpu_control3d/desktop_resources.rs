use super::*;
use std::collections::BTreeMap;

#[path = "../../../../tools/virgl-desktop-control/packets.rs"]
mod captured;

fn word(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

#[test]
fn desktop_control_original_mesa_lifetimes() {
    for (name, calls, peak, refusal) in [
        ("compositor", captured::COMPOSITOR, 24, None),
        ("kmscube", captured::KMSCUBE, 4, None),
        ("glmark2-es2", captured::GLMARK2_ES2, 25, Some(3025)),
    ] {
        let mut q = Queue::desktop(true);
        let mut model = BTreeMap::<u32, (u64, u64, u64)>::new();
        let mut generation = 1;
        let mut observed_peak = 0;
        let mut processed = 0;
        for &(seq, packet) in calls {
            let label = format!("desktop-{name}-original-{seq}");
            if Some(seq) == refusal {
                assert_eq!(word(packet, 32), 17, "explicit original Z32 gap");
                q.unchanged(&label, packet.to_vec(), INVALID_PARAMETER);
                break;
            }
            q.expect(&label, packet.to_vec(), OK);
            let id = word(packet, 24);
            if word(packet, 0) == 0x204 {
                let bytes = if word(packet, 28) == 0 {
                    u64::from(word(packet, 40))
                } else {
                    u64::from(word(packet, 40)) * u64::from(word(packet, 44)) * 4
                };
                let gpu = if word(packet, 36) == 524288 { 0 } else { bytes };
                assert!(model.insert(id, (generation, bytes, gpu)).is_none());
                generation += 1;
            } else {
                assert_eq!(word(packet, 0), 0x102);
                assert!(model.remove(&id).is_some());
            }
            processed += 1;
            observed_peak = observed_peak.max(model.len());
            let state = q.state.borrow().control3d_snapshot().unwrap();
            assert_eq!(state.resources.len(), model.len());
            assert_eq!(state.next_generation, generation);
            assert_eq!(state.logical_bytes, model.values().map(|v| v.1).sum());
            assert_eq!(state.gpu_bytes, model.values().map(|v| v.2).sum());
            for entry in state.resources {
                assert_eq!(entry.identity.generation, model[&entry.identity.id].0);
            }
            assert_eq!(q.recorder.borrow().events.len(), processed);
        }
        assert_eq!(observed_peak, peak);
        if refusal.is_none() {
            assert_eq!(processed, calls.len());
            assert!(model.is_empty());
        }
        let refusal = refusal
            .map(|v| v.to_string())
            .unwrap_or_else(|| "null".into());
        eprintln!(
            "DESKTOP_CONTROL_MODEL {{\"workload\":{name:?},\"calls\":{processed},\"peak\":{observed_peak},\"nextGeneration\":{generation},\"refusal\":{refusal}}}"
        );
    }
}

#[test]
fn desktop_control_selected_counts_and_host_failure_rollback() {
    let mut q = Queue::desktop(true);
    for id in 1..=64 {
        q.expect("desktop-count-admitted", resource(id, 0, 64, 16, 8, 1), OK);
        assert_eq!(
            q.state
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .resources
                .len(),
            id as usize
        );
    }
    q.unchanged(
        "desktop-count-65-refused",
        resource(65, 0, 64, 16, 8, 1),
        OOM,
    );
    q.expect("desktop-count-release", id_command(0x102, 0, 32), OK);
    let before = q.state.borrow().control3d_snapshot().unwrap();
    q.recorder.borrow_mut().fail_next = Some(Control3dError::OutOfMemory);
    q.unchanged(
        "desktop-host-refusal-no-publication",
        resource(65, 2, 2, 1310730, 2, 2),
        OOM,
    );
    q.expect(
        "desktop-host-recovery",
        resource(65, 2, 2, 1310730, 2, 2),
        OK,
    );
    let after = q.state.borrow().control3d_snapshot().unwrap();
    assert_eq!(after.next_generation, before.next_generation + 1);
    assert_eq!(after.resources.len(), 64);
    for id in (1..=65).filter(|id| *id != 32) {
        q.expect("desktop-count-cleanup", id_command(0x102, 0, id), OK);
    }
    let state = q.state.borrow().control3d_snapshot().unwrap();
    assert!(state.resources.is_empty());
    assert_eq!(
        (state.logical_bytes, state.gpu_bytes, state.backing_bytes),
        (0, 0, 0)
    );
}

#[test]
fn desktop_control_metadata_roles_and_legacy_refusals() {
    let mut q = Queue::desktop(true);
    let mut old = Queue::new(true, true);
    for format in [1, 2, 67] {
        for bind in [2, 8, 10, 2 | (1 << 18), 8 | (1 << 20), 1310730] {
            let packet = resource(1, 2, format, bind, 2, 3);
            q.expect("desktop-color-role", packet.clone(), OK);
            q.expect("desktop-color-release", id_command(0x102, 0, 1), OK);
            if format == 67 && bind == 10 {
                old.expect("legacy-color-admission", packet, OK);
                old.expect("legacy-color-release", id_command(0x102, 0, 1), OK);
            } else {
                old.unchanged("legacy-color-refusal", packet, INVALID_PARAMETER);
            }
        }
    }
    for bind in [1, 8, 9] {
        let packet = resource(1, 2, 20, bind, 2, 3);
        q.expect("desktop-depth-role", packet.clone(), OK);
        q.expect("desktop-depth-release", id_command(0x102, 0, 1), OK);
        old.unchanged("legacy-depth-refusal", packet, INVALID_PARAMETER);
    }
    for (format, binds) in [
        (
            2,
            &[0, 1, 9, 16, 1 << 18, 1 << 20, 10 | (1 << 19), u32::MAX][..],
        ),
        (67, &[0, 1, 9, 16, 10 | (1 << 19)][..]),
        (20, &[0, 2, 10, 16, 9 | (1 << 18), u32::MAX][..]),
    ] {
        for &bind in binds {
            q.unchanged(
                "desktop-invalid-role",
                resource(1, 2, format, bind, 2, 3),
                INVALID_PARAMETER,
            );
        }
    }
    for format in [16, 18, 21, 126] {
        let packet = resource(1, 2, format, 9, 2, 3);
        q.expect("desktop-qualified-depth", packet.clone(), OK);
        q.expect(
            "desktop-qualified-depth-release",
            id_command(0x102, 0, 1),
            OK,
        );
        old.unchanged("legacy-qualified-depth-refusal", packet, INVALID_PARAMETER);
    }
    for format in [0, 17, 233, u32::MAX] {
        q.unchanged(
            "desktop-unqualified-format",
            resource(1, 2, format, 9, 2, 3),
            INVALID_PARAMETER,
        );
    }
    for (target, format, bind) in [(2, 2, 10), (2, 20, 9), (0, 64, 16)] {
        let valid = resource(1, target, format, bind, 2, if target == 0 { 1 } else { 3 });
        for (offset, value) in [
            (28, 3),
            (40, 0),
            (44, 0),
            (48, 2),
            (52, 2),
            (56, if target == 0 { 1 } else { 2 }),
            (60, 1),
            (64, 1),
            (68, 1),
            (16, 1),
        ] {
            let mut invalid = valid.clone();
            put32(&mut invalid, offset, value);
            q.unchanged("desktop-invalid-metadata", invalid, INVALID_PARAMETER);
        }
        for length in [24, 40, 68, 71] {
            q.unchanged(
                "desktop-short-metadata",
                valid[..length].to_vec(),
                INVALID_PARAMETER,
            );
        }
    }
    for format in [1, 2, 67, 20] {
        let bind = if format == 20 { 9 } else { 10 };
        for (w, h) in [(16384, 1), (1, 16384)] {
            q.expect(
                "desktop-dimension-exact",
                resource(1, 2, format, bind, w, h),
                OK,
            );
            q.expect("desktop-dimension-release", id_command(0x102, 0, 1), OK);
        }
        for (w, h) in [(16385, 1), (1, 16385), (u32::MAX, u32::MAX)] {
            q.unchanged(
                "desktop-dimension-plus-one",
                resource(1, 2, format, bind, w, h),
                INVALID_PARAMETER,
            );
        }
    }
}

#[test]
fn desktop_control_byte_limits_are_separate_from_count() {
    let mut q = Queue::desktop(true);
    for id in 1..=8 {
        let format = [2, 67, 20][(id as usize - 1) % 3];
        q.expect(
            "desktop-GPU-budget-admitted",
            resource(id, 2, format, if format == 20 { 9 } else { 10 }, 1024, 1024),
            OK,
        );
    }
    assert_eq!(
        q.state.borrow().control3d_snapshot().unwrap().gpu_bytes,
        33554432
    );
    q.unchanged(
        "desktop-GPU-budget-plus-one",
        resource(9, 0, 64, 16, 1, 1),
        OOM,
    );
    q.expect("desktop-GPU-budget-release", id_command(0x102, 0, 8), OK);
    q.expect(
        "desktop-GPU-budget-recovery",
        resource(9, 2, 20, 9, 1024, 1024),
        OK,
    );
    q.unchanged(
        "desktop-resource-budget-plus-one",
        resource(10, 0, 64, 16, 4194305, 1),
        OOM,
    );
    for format in [1, 2, 67, 20] {
        q.unchanged(
            "desktop-color-resource-budget-plus-one",
            resource(10, 2, format, if format == 20 { 9 } else { 10 }, 1024, 1025),
            OOM,
        );
    }
    let mut backing_q = Queue::desktop(true);
    for id in 1..=8 {
        backing_q.expect(
            "desktop-backing-resource",
            resource(id, 0, 64, 524288, 8, 1),
            OK,
        );
        backing_q.expect(
            "desktop-backing-byte-admitted",
            backing(id, &[(virt::DRAM_BASE, 4194304)]),
            OK,
        );
    }
    assert_eq!(
        backing_q
            .state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .backing_bytes,
        33554432
    );
    backing_q.expect(
        "desktop-backing-overflow-resource",
        resource(9, 0, 64, 524288, 8, 1),
        OK,
    );
    backing_q.unchanged(
        "desktop-backing-byte-plus-one",
        backing(9, &[(BACKING, 1)]),
        OOM,
    );
    backing_q.unchanged(
        "desktop-backing-resource-plus-one",
        backing(9, &[(virt::DRAM_BASE, 4194304), (BACKING, 1)]),
        OOM,
    );
    backing_q.expect("desktop-backing-byte-release", id_command(0x107, 0, 8), OK);
    backing_q.expect(
        "desktop-backing-byte-recovery",
        backing(9, &[(BACKING, 1)]),
        OK,
    );
}

#[test]
fn desktop_control_generations_split_rings_and_reset() {
    let mut q = Queue::desktop(false);
    assert_eq!(q.read_mmio(0x10c), 0, "no capsets");
    q.unchanged(
        "desktop-unnegotiated",
        resource(3, 2, 2, 1310730, 2, 2),
        UNSPEC,
    );
    q.negotiate();
    q.expect("desktop-context", context(2), OK);
    let packet = resource(3, 2, 20, 9, 2, 2);
    let (response, length) = q.submit_split(&packet, &[3, 22, 14, 33], &[7, 17]);
    q.record_case("desktop-split-resource", &packet, &response);
    assert_eq!((response, length), (reply(&packet, OK), 24));
    q.expect("desktop-membership", id_command(0x202, 2, 3), OK);
    q.unchanged("desktop-duplicate-id", packet.clone(), INVALID_RESOURCE);
    let old = q.state.borrow().control3d_snapshot().unwrap().resources[0].identity;
    q.expect("desktop-generation-release", id_command(0x102, 0, 3), OK);
    q.expect("desktop-generation-reuse", packet, OK);
    let fresh = q.state.borrow().control3d_snapshot().unwrap().resources[0].identity;
    assert_ne!(old.generation, fresh.generation);
    q.unchanged(
        "desktop-stale-membership",
        id_command(0x203, 2, 3),
        INVALID_PARAMETER,
    );
    let mut two = header(0x101, 0, 40);
    for (offset, value) in [(24, 3), (28, 67), (32, 2), (36, 2)] {
        put32(&mut two, offset, value);
    }
    q.unchanged(
        "desktop-shared-2D-id-refusal",
        two.clone(),
        INVALID_RESOURCE,
    );
    q.expect("desktop-3D-unref", id_command(0x102, 0, 3), OK);
    q.expect("desktop-2D-create", two, OK);
    q.unchanged(
        "desktop-shared-3D-id-refusal",
        resource(3, 2, 2, 1310730, 2, 2),
        INVALID_RESOURCE,
    );
    q.expect("desktop-2D-unref", id_command(0x102, 0, 3), OK);
    let epoch = q.state.borrow().control3d_snapshot().unwrap().epoch;
    q.mmio(0x70, 0);
    assert_eq!(q.machine.run(1), RunOutcome::MaxInstrs);
    let state = q.state.borrow().control3d_snapshot().unwrap();
    assert!(state.epoch > epoch && state.contexts.is_empty() && state.resources.is_empty());
    assert_eq!(
        (state.logical_bytes, state.gpu_bytes, state.backing_bytes),
        (0, 0, 0)
    );
    q.next = 0;
    q.configure();
    q.negotiate();
    q.expect(
        "desktop-profile-retained-after-reset",
        resource(3, 2, 2, 1310730, 2, 2),
        OK,
    );
}
