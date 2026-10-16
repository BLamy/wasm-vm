//! Worker evidence for the native half. These sinks only record original MMIO requests;
//! physical resource reconstruction and actual warm guest rendering belong to 74b–d.
use super::*;
use sha2::{Digest, Sha256};
use wasm_vm_core::dev::virtio::gpu::scanout3d::Scanout3dEvent;

const WITNESS: [u8; 32] = [0x74; 32];
#[derive(Clone, Default)]
struct CheckpointSubmit {
    jobs: SubmitRecorder,
    bindings: Rc<RefCell<Vec<Scanout3dEvent>>>,
}
impl Submit3dSink for CheckpointSubmit {
    fn begin_job(&mut self, r: &Submit3dRequest) -> Result<(), Control3dError> {
        self.jobs.begin_job(r)
    }
    fn cancel_job(&mut self, _: gpu::submit3d::Submit3dKey) -> Result<(), Control3dError> {
        Ok(())
    }
    fn bind_scanout(&mut self, event: &Scanout3dEvent) -> Result<(), Control3dError> {
        self.bindings.borrow_mut().push(*event);
        Ok(())
    }
}
fn rig(cached: bool) -> Rig {
    let mut r = Rig::unqualified();
    r.machine.enable_clint(64);
    r.machine
        .attach_qualified_virgl(
            Box::new(r.controls.clone()),
            Box::new(CheckpointSubmit {
                jobs: r.submits.clone(),
                ..Default::default()
            }),
            r.mailbox.clone(),
            caps(),
        )
        .unwrap();
    r.state = r.machine.virtio_gpu().unwrap().1;
    r.machine.set_block_cache(cached);
    r.negotiate(true);
    r.configure(0);
    r.configure(1);
    r
}
fn setup(r: &mut Rig, id: u32) -> (u64, u64) {
    r.command(&context(id), 24, p::RESP_OK_NODATA, 24);
    r.command(
        &request(
            p::CMD_RESOURCE_CREATE_3D,
            0,
            &[id + 100, 2, 67, 10, 2, 2, 1, 1, 0, 0, 0, 0],
        ),
        24,
        p::RESP_OK_NODATA,
        24,
    );
    let address = BACKING + 0x50000;
    let mut bytes = request(p::CMD_RESOURCE_ATTACH_BACKING, 0, &[id + 100, 1]);
    bytes.extend_from_slice(&address.to_le_bytes());
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    r.command(&bytes, 24, p::RESP_OK_NODATA, 24);
    r.command(
        &request(p::CMD_RESOURCE_DETACH_BACKING, 0, &[id + 100, 0]),
        24,
        p::RESP_OK_NODATA,
        24,
    );
    r.command(&bytes, 24, p::RESP_OK_NODATA, 24);
    r.command(
        &request(p::CMD_CTX_ATTACH_RESOURCE, id, &[id + 100, 0]),
        24,
        p::RESP_OK_NODATA,
        24,
    );
    r.command(
        &request(p::CMD_SET_SCANOUT, 0, &[0, 0, 2, 2, 0, id + 100]),
        24,
        p::RESP_OK_NODATA,
        24,
    );
    let cursor = p::UpdateCursor {
        header: p::CtrlHeader {
            ty: p::CMD_MOVE_CURSOR,
            ..Default::default()
        },
        pos: p::CursorPos {
            scanout_id: 0,
            x: 31,
            y: 47,
            padding: 0,
        },
        resource_id: 0,
        hot_x: 0,
        hot_y: 0,
        padding: 0,
    }
    .to_bytes();
    r.publish(1, &cursor, 24);
    r.response(1, 24);
    r.machine
        .bus_mut()
        .store64(virt::CLINT_BASE + 0x4000, 1_000_000 + u64::from(id))
        .unwrap();
    let state = r.state.borrow().control3d_snapshot().unwrap();
    (state.next_generation, state.next_backing_generation)
}
fn completion(request: &Submit3dRequest) -> Submit3dCompletion {
    Submit3dCompletion {
        key: request.key,
        exchange_sequence: 0,
        outcome: Ok(()),
        gpu_complete: true,
        applied_commands: 0,
        draws: 0,
    }
}
fn start(r: &mut Rig, id: u32, fence: u64) -> Submit3dRequest {
    let mut bytes = request(p::CMD_SUBMIT_3D, id, &[0, 0]);
    bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
    bytes[8..16].copy_from_slice(&fence.to_le_bytes());
    r.publish(0, &bytes, 24);
    r.submits.0.borrow().last().unwrap().clone()
}
fn original_transport(bytes: &[u8]) -> Vec<u8> {
    let (_, sections) =
        wasm_vm_core::resume::SectionReader::new(&bytes[..bytes.len() - 84]).unwrap();
    let gpu = sections
        .map(Result::unwrap)
        .find(|s| s.tag == wasm_vm_core::resume::section::VIRTIO_GPU)
        .unwrap();
    let at = gpu
        .payload
        .windows(8)
        .position(|v| v == b"WVGPU3D1")
        .unwrap();
    gpu.payload[..at].to_vec()
}
type Fingerprint = (String, Vec<u8>, Vec<u8>, Vec<u8>, [u32; 2], Vec<u8>);
fn fingerprint(r: &mut Rig) -> Fingerprint {
    let state = r.state.borrow();
    let control = state.control3d_snapshot().unwrap().canonical_bytes();
    let submit = state.submit3d_snapshot().unwrap().canonical_bytes();
    let scan = state.scanout3d_snapshot().unwrap().canonical_bytes();
    drop(state);
    let memory = (0..1600)
        .map(|i| r.machine.bus_mut().load8(RESPONSE + i).unwrap())
        .collect();
    (
        r.machine.snapshot().hex_digest(),
        control,
        submit,
        scan,
        [r.read_mmio(0x60), r.read_mmio(0x70)],
        memory,
    )
}
#[test]
fn gpu_checkpoint_drain_completes_original_fence_without_cpu_or_clock_progress() {
    for cached in [false, true] {
        let mut r = rig(cached);
        setup(&mut r, 7);
        let fence = 0x0020_0000_0000_0071;
        let pending = start(&mut r, 7, fence);
        let retired = r.machine.irq_stats().retired;
        let before = r.machine.snapshot();
        let mtime = r.machine.clint_mtime();
        let used = r.machine.bus_mut().load16(USED + 2).unwrap();
        for _ in 0..3 {
            assert!(!r.machine.drain_accelerated_checkpoint_boundary().unwrap());
            assert_eq!(r.machine.snapshot(), before);
            assert_eq!(r.machine.clint_mtime(), mtime);
            assert_eq!(r.machine.irq_stats().retired, retired);
        }
        r.mailbox.post(completion(&pending)).unwrap();
        assert!(r.machine.drain_accelerated_checkpoint_boundary().unwrap());
        assert_eq!(r.machine.irq_stats().retired, retired);
        assert_eq!(r.machine.clint_mtime(), mtime);
        let after = r.machine.snapshot();
        assert_eq!(after.pc, before.pc);
        assert_eq!(after.xregs, before.xregs);
        assert_eq!(r.machine.bus_mut().load16(USED + 2).unwrap(), used + 1);
        let response = r.response(0, 24);
        assert_eq!(word(&response, 0), p::RESP_OK_NODATA);
        assert_eq!(word(&response, 4), 1);
        assert_eq!(&response[8..16], &fence.to_le_bytes());
        assert_ne!(r.read_mmio(0x60) & 1, 0);
        for _ in 0..3 {
            assert!(r.machine.drain_accelerated_checkpoint_boundary().unwrap());
            assert_eq!(r.machine.snapshot(), after);
            assert_eq!(r.machine.irq_stats().retired, retired);
            assert_eq!(r.machine.clint_mtime(), mtime);
        }
        let blob = r.machine.save_accelerated_resume(&WITNESS).unwrap();
        println!(
            "GPU_DRAIN cache={cached} retired={retired} mtime={mtime} fence={fence:016x} used_before={used} used_after={} blob_sha={:x} state={}",
            used + 1,
            Sha256::digest(&blob),
            after.hex_digest()
        );
    }
}
#[test]
fn gpu_checkpoint_original_rings_state_and_fresh_epoch_roundtrip() {
    let mut reference = Vec::new();
    for cached in [false, true] {
        for id in [3, 79] {
            let mut source = rig(cached);
            let (generation, backing) = setup(&mut source, id);
            let saved_next = source.next;
            let saved_control = source.state.borrow().control3d_snapshot().unwrap();
            let saved_submit = source.state.borrow().submit3d_snapshot().unwrap();
            let saved_scanout = source.state.borrow().scanout3d_snapshot().unwrap();
            let saved_cursor = source.state.borrow().cursor_state(0).unwrap();
            assert!(
                source.machine.save_resume().is_err(),
                "ordinary save retains accelerated refusal"
            );
            let blob = source.machine.save_accelerated_resume(&WITNESS).unwrap();
            let saved_machine = source.machine.snapshot();
            let digest = format!("{:x}", Sha256::digest(&blob));
            let old = start(&mut source, id, 0x20000000000071);
            source.mailbox.post(completion(&old)).unwrap();
            source.tick();
            source.response(0, 24);
            for fresh in [false, true] {
                let mut target = if fresh { rig(cached) } else { source };
                let (saved, epoch) = target
                    .machine
                    .load_accelerated_resume(&blob, &WITNESS)
                    .unwrap();
                target.next = saved_next;
                assert_eq!(target.machine.snapshot(), saved_machine);
                assert_eq!(target.state.borrow().cursor_state(0), Some(saved_cursor));
                assert_eq!(
                    target
                        .machine
                        .bus_mut()
                        .load64(virt::CLINT_BASE + 0x4000)
                        .unwrap(),
                    1_000_000 + u64::from(id)
                );
                let restored = target.machine.save_accelerated_resume(&WITNESS).unwrap();
                assert_eq!(original_transport(&restored), original_transport(&blob));
                assert_eq!(saved, saved_control.epoch);
                assert!(epoch > saved);
                let mut expected = saved_control.clone();
                expected.epoch = epoch;
                assert_eq!(
                    target.state.borrow().control3d_snapshot().unwrap(),
                    expected
                );
                assert_eq!(
                    target.state.borrow().submit3d_snapshot().unwrap(),
                    saved_submit
                );
                assert_eq!(
                    target.state.borrow().scanout3d_snapshot().unwrap(),
                    saved_scanout
                );
                assert!(target.mailbox.post(completion(&old)).is_err());
                let pending = start(&mut target, id, 0x20000000000073);
                assert_eq!(pending.key.sequence, old.key.sequence);
                assert_eq!(pending.key.epoch, epoch);
                let before = fingerprint(&mut target);
                assert!(target.mailbox.post(completion(&old)).is_err());
                assert_eq!(fingerprint(&mut target), before);
                target.mailbox.post(completion(&pending)).unwrap();
                target.tick();
                let response = target.response(0, 24);
                assert_eq!(&response[8..16], &0x20000000000073u64.to_le_bytes());
                target.command(&context(id + 1), 24, p::RESP_OK_NODATA, 24);
                let state = target.state.borrow().control3d_snapshot().unwrap();
                assert_eq!(state.next_generation, generation + 1);
                assert_eq!(state.next_backing_generation, backing);
                let mut trace = HashSink::new();
                assert_eq!(
                    target.machine.run_traced(7, &mut trace),
                    RunOutcome::MaxInstrs
                );
                let result = (trace.hash(), target.machine.snapshot());
                if cached {
                    assert_eq!(
                        result,
                        reference[usize::from(id == 79) * 2 + usize::from(fresh)]
                    );
                } else {
                    reference.push(result);
                }
                println!(
                    "GPU_CHECKPOINT id={id} cache={cached} fresh={fresh} saved_epoch={saved} fresh_epoch={epoch} native_bytes={} snapshot_sha={digest} trace={} state={}",
                    blob.len(),
                    trace.hash(),
                    target.machine.snapshot().hex_digest()
                );
                source = target;
            }
        }
    }
}
#[test]
fn gpu_checkpoint_pending_ready_loss_and_poison_refuse_without_mutation() {
    for cached in [false, true] {
        let mut r = rig(cached);
        setup(&mut r, 7);
        let blob = r.machine.save_accelerated_resume(&WITNESS).unwrap();
        let pending = start(&mut r, 7, 0x20000000000075);
        for ready in [false, true] {
            if ready {
                r.mailbox.post(completion(&pending)).unwrap();
            }
            let before = fingerprint(&mut r);
            assert!(r.machine.save_accelerated_resume(&WITNESS).is_err());
            assert_eq!(fingerprint(&mut r), before);
            assert!(r.machine.load_accelerated_resume(&blob, &WITNESS).is_err());
            assert_eq!(fingerprint(&mut r), before);
            println!(
                "GPU_CHECKPOINT_REFUSAL cache={cached} ready={ready} original_sequence={} state={}",
                pending.key.sequence, before.0
            );
        }
        r.tick();
        r.response(0, 24);
        assert!(r.state.borrow_mut().invalidate_renderer_qualification());
        let before = fingerprint(&mut r);
        assert!(r.machine.save_accelerated_resume(&WITNESS).is_err());
        assert!(r.machine.load_accelerated_resume(&blob, &WITNESS).is_err());
        assert_eq!(fingerprint(&mut r), before);
    }
}
#[test]
fn gpu_checkpoint_corruption_foreign_witness_and_truncation_are_atomic() {
    let mut r = rig(false);
    setup(&mut r, 11);
    let blob = r.machine.save_accelerated_resume(&WITNESS).unwrap();
    let before = fingerprint(&mut r);
    for n in [0, 1, 7, 31, 48, blob.len() / 2, blob.len() - 1] {
        assert!(
            r.machine
                .load_accelerated_resume(&blob[..n], &WITNESS)
                .is_err()
        );
        assert_eq!(fingerprint(&mut r), before);
    }
    let mut bad = blob.clone();
    let at = bad.len() / 2;
    bad[at] ^= 0x80;
    assert!(r.machine.load_accelerated_resume(&bad, &WITNESS).is_err());
    assert_eq!(fingerprint(&mut r), before);
    assert!(
        r.machine
            .load_accelerated_resume(&blob, &[0x75; 32])
            .is_err()
    );
    assert_eq!(fingerprint(&mut r), before);
    assert!(r.machine.save_accelerated_resume(&[0; 32]).is_err());
    assert_eq!(fingerprint(&mut r), before);
    assert!(r.machine.load_resume(&blob).is_err());
    assert_eq!(fingerprint(&mut r), before);
    println!(
        "GPU_CHECKPOINT_CORRUPTION cases=12 original_sha={:x} state={}",
        Sha256::digest(&blob),
        before.0
    );
}

#[test]
fn gpu_checkpoint_poison_reset_and_unsupported_owners_refuse_before_capture() {
    for cached in [false, true] {
        let mut r = rig(cached);
        setup(&mut r, 13);
        let blob = r.machine.save_accelerated_resume(&WITNESS).unwrap();
        *r.controls.fail_next.borrow_mut() = Some(Control3dError::BridgePoisoned);
        r.command(&context(14), 24, p::RESP_ERR_UNSPEC, 24);
        assert!(r.state.borrow().control3d_snapshot().unwrap().poisoned);
        r.mmio(0x14, 0);
        assert_ne!(
            r.read_mmio(0x10) & 1,
            0,
            "positive qualification is retained"
        );
        let before = fingerprint(&mut r);
        assert!(r.machine.save_accelerated_resume(&WITNESS).is_err());
        assert!(r.machine.load_accelerated_resume(&blob, &WITNESS).is_err());
        assert_eq!(fingerprint(&mut r), before);
        r.mmio(0x70, 0);
        assert!(!r.state.borrow().control3d_snapshot().unwrap().poisoned);
        let before = fingerprint(&mut r);
        assert!(r.machine.save_accelerated_resume(&WITNESS).is_err());
        assert!(r.machine.load_accelerated_resume(&blob, &WITNESS).is_err());
        assert_eq!(
            fingerprint(&mut r),
            before,
            "reset awaits normal device service"
        );
        r.tick();
        let healthy = r.machine.save_accelerated_resume(&WITNESS).unwrap();
        assert!(
            r.machine
                .load_accelerated_resume(&healthy, &WITNESS)
                .is_ok()
        );
        println!(
            "GPU_CHECKPOINT_POISON_RESET cache={cached} recovered_epoch={}",
            r.state.borrow().control3d_snapshot().unwrap().epoch
        );
    }
    let mut absent = Machine::new(1024 * 1024);
    let before = absent.snapshot();
    assert!(absent.save_accelerated_resume(&WITNESS).is_err());
    assert_eq!(absent.snapshot(), before);
    let mut unqualified = Rig::unqualified();
    let before = unqualified.machine.snapshot();
    assert!(
        unqualified
            .machine
            .save_accelerated_resume(&WITNESS)
            .is_err()
    );
    assert_eq!(unqualified.machine.snapshot(), before);
    let mut private = Machine::new(1024 * 1024);
    private.enable_plic();
    private.enable_virtio_slots(None);
    private
        .enable_virtio_gpu_control3d_proof(Box::new(NullSink), Box::new(ControlRecorder::default()))
        .unwrap();
    let before = private.snapshot();
    assert!(private.save_accelerated_resume(&WITNESS).is_err());
    assert_eq!(private.snapshot(), before);
}
