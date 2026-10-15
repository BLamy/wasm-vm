//! Independent native-checkpoint probes through original MMIO and DMA descriptors.
//! These record host requests; physical renderer reconstruction is the next boundary.
#![cfg(all(feature = "virgl-renderer", not(feature = "zicsr-stub")))]

use sha2::{Digest, Sha256};
use std::{cell::RefCell, ops::Range, rc::Rc};
use wasm_vm_core::dev::virtio::gpu::{
    GpuState, NullSink,
    capabilities::{FormatMask, HostLimits, QualifiedCapabilities},
    control3d::{Control3dError, Control3dEvent, Control3dSink},
    protocol as p,
    scanout3d::Scanout3dEvent,
    submit3d::{Submit3dCompletion, Submit3dMailbox, Submit3dRequest, Submit3dSink},
};
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::{Machine, RunOutcome, bus::Bus};

const DESC: u64 = virt::DRAM_BASE + 0x10000;
const AVAIL: u64 = virt::DRAM_BASE + 0x11000;
const USED: u64 = virt::DRAM_BASE + 0x12000;
const REQUEST: u64 = virt::DRAM_BASE + 0x13000;
const RESPONSE: u64 = virt::DRAM_BASE + 0x14000;
const BACKING: u64 = virt::DRAM_BASE + 0x40000;
const WITNESS: [u8; 32] = [0x93; 32];

fn caps() -> QualifiedCapabilities {
    let mut formats = FormatMask::default();
    for format in [1, 2, 16, 67] {
        formats.insert(format).unwrap();
    }
    QualifiedCapabilities::new(
        HostLimits {
            texture_2d: 8192,
            texture_3d: 256,
            texture_cube: 4096,
            array_layers: 1024,
            varying_vectors: 32,
            vertex_attributes: 16,
            uniform_block_bytes: 32768,
            uniform_alignment: 256,
            vertex_samplers: 32,
            fragment_samplers: 16,
            vertex_constant_vectors: 1024,
            fragment_constant_vectors: 1024,
            feedback_components: 128,
            samples: 4,
        },
        formats.clone(),
        formats,
        FormatMask::default(),
        FormatMask::default(),
        FormatMask::default(),
        "wasm-vm WebGL2 VirGL",
    )
    .unwrap()
}

#[derive(Clone, Default)]
struct Controls(Rc<RefCell<Vec<Control3dEvent>>>);
impl Control3dSink for Controls {
    fn apply(&mut self, event: &Control3dEvent) -> Result<(), Control3dError> {
        self.0.borrow_mut().push(event.clone());
        Ok(())
    }
}
#[derive(Clone, Default)]
struct Submits(
    Rc<RefCell<Vec<Submit3dRequest>>>,
    Rc<RefCell<Vec<Scanout3dEvent>>>,
);
impl Submit3dSink for Submits {
    fn begin_job(&mut self, request: &Submit3dRequest) -> Result<(), Control3dError> {
        self.0.borrow_mut().push(request.clone());
        Ok(())
    }
    fn cancel_job(
        &mut self,
        _: wasm_vm_core::dev::virtio::gpu::submit3d::Submit3dKey,
    ) -> Result<(), Control3dError> {
        Ok(())
    }
    fn bind_scanout(&mut self, event: &Scanout3dEvent) -> Result<(), Control3dError> {
        self.1.borrow_mut().push(*event);
        Ok(())
    }
}

struct Rig {
    machine: Machine,
    gpu: Rc<RefCell<GpuState>>,
    controls: Controls,
    submits: Submits,
    mailbox: Submit3dMailbox,
    base: u64,
    next: [u16; 2],
}
impl Rig {
    fn new(cached: bool) -> Self {
        let mut machine = Machine::new(4 * 1024 * 1024);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        machine.enable_virtio_gpu(Box::new(NullSink)).unwrap();
        let controls = Controls::default();
        let submits = Submits::default();
        let mailbox = Submit3dMailbox::new();
        machine
            .attach_qualified_virgl(
                Box::new(controls.clone()),
                Box::new(submits.clone()),
                mailbox.clone(),
                caps(),
            )
            .unwrap();
        let (slot, gpu) = machine.virtio_gpu().unwrap();
        machine
            .bus_mut()
            .store32(virt::KERNEL_BASE, 0x0000_006f)
            .unwrap();
        machine.hart_mut().regs.pc = virt::KERNEL_BASE;
        machine.enable_clint(64);
        machine.set_block_cache(cached);
        Self {
            machine,
            gpu,
            controls,
            submits,
            mailbox,
            base: Platform::virtio_base(slot as u64),
            next: [0; 2],
        }
    }
    fn write(&mut self, offset: u64, value: u32) {
        self.machine
            .bus_mut()
            .store32(self.base + offset, value)
            .unwrap();
    }
    fn negotiate(&mut self) {
        for (offset, value) in [
            (0x70, 3),
            (0x24, 0),
            (0x20, 1),
            (0x24, 1),
            (0x20, 1),
            (0x70, 11),
            (0x70, 15),
        ] {
            self.write(offset, value);
        }
        for queue in 0..2 {
            let delta = u64::from(queue) * 0x10000;
            self.write(0x30, queue);
            self.write(0x38, 8);
            for (offset, addr) in [(0x80, DESC), (0x90, AVAIL), (0xa0, USED)] {
                self.write(offset, (addr + delta) as u32);
                self.write(offset + 4, ((addr + delta) >> 32) as u32);
            }
            self.write(0x44, 1);
        }
    }
    fn tick(&mut self) {
        assert_eq!(self.machine.run(1), RunOutcome::MaxInstrs);
    }
    fn publish(&mut self, queue: u32, request: &[u8]) {
        let delta = u64::from(queue) * 0x10000;
        for (i, byte) in request.iter().enumerate() {
            self.machine
                .bus_mut()
                .store8(REQUEST + delta + i as u64, *byte)
                .unwrap();
        }
        for i in 0..32 {
            self.machine
                .bus_mut()
                .store8(RESPONSE + delta + i, 0xa5)
                .unwrap();
        }
        for (index, address, length, flags, next) in [
            (0, REQUEST + delta, request.len() as u32, 1, 1),
            (1, RESPONSE + delta, 24, 2, 0),
        ] {
            let at = DESC + delta + index * 16;
            self.machine.bus_mut().store64(at, address).unwrap();
            self.machine.bus_mut().store32(at + 8, length).unwrap();
            self.machine.bus_mut().store16(at + 12, flags).unwrap();
            self.machine.bus_mut().store16(at + 14, next).unwrap();
        }
        let next = &mut self.next[queue as usize];
        self.machine
            .bus_mut()
            .store16(AVAIL + delta + 4 + 2 * u64::from(*next % 8), 0)
            .unwrap();
        *next += 1;
        self.machine
            .bus_mut()
            .store16(AVAIL + delta + 2, *next)
            .unwrap();
        self.write(0x50, queue);
        self.tick();
    }
    fn used(&mut self, queue: u32) -> u16 {
        self.machine
            .bus_mut()
            .load16(USED + u64::from(queue) * 0x10000 + 2)
            .unwrap()
    }
    fn ok(&mut self, request: &[u8]) {
        self.publish(0, request);
        assert_eq!(self.used(0), self.next[0]);
        assert_eq!(
            self.machine.bus_mut().load32(RESPONSE).unwrap(),
            p::RESP_OK_NODATA
        );
        assert_eq!(
            self.machine.bus_mut().load64(RESPONSE + 24).unwrap(),
            0xa5a5_a5a5_a5a5_a5a5
        );
    }
    fn seed(&mut self, context: u32, resource: u32) {
        self.negotiate();
        let mut create = request(p::CMD_CTX_CREATE, context, &[0, 0]);
        create.resize(96, 0);
        self.ok(&create);
        self.ok(&request(p::CMD_RESOURCE_CREATE_2D, 0, &[resource, 1, 6, 4]));
        let mut attach = request(p::CMD_RESOURCE_ATTACH_BACKING, 0, &[resource, 2]);
        for (address, length) in [(BACKING, 32u32), (BACKING + 0x1000, 64)] {
            attach.extend_from_slice(&address.to_le_bytes());
            attach.extend_from_slice(&length.to_le_bytes());
            attach.extend_from_slice(&0u32.to_le_bytes());
        }
        self.ok(&attach);
        self.ok(&request(
            p::CMD_CTX_ATTACH_RESOURCE,
            context,
            &[resource, 0],
        ));
    }
    fn transfer(&mut self, resource: u32) {
        let mut transfer = request(p::CMD_TRANSFER_TO_HOST_2D, 0, &[0, 0, 6, 4]);
        transfer.extend_from_slice(&0u64.to_le_bytes());
        transfer.extend_from_slice(&resource.to_le_bytes());
        transfer.extend_from_slice(&0u32.to_le_bytes());
        self.publish(0, &transfer);
    }
    fn finish(&self, request: &Submit3dRequest) {
        self.mailbox
            .post(Submit3dCompletion {
                key: request.key,
                exchange_sequence: 0,
                outcome: Ok(()),
                gpu_complete: true,
                applied_commands: 0,
                draws: 0,
            })
            .unwrap();
    }
}
fn request(ty: u32, context: u32, words: &[u32]) -> Vec<u8> {
    let mut bytes = p::CtrlHeader {
        ty,
        ctx_id: context,
        ..Default::default()
    }
    .to_bytes()
    .to_vec();
    for word in words {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    bytes
}

#[test]
fn ready_but_unconsumed_original_completion_cannot_be_checkpointed() {
    for cached in [false, true] {
        let mut rig = Rig::new(cached);
        rig.seed(53, 89);
        rig.transfer(89);
        let accepted = rig.submits.0.borrow().last().unwrap().clone();
        assert_eq!(rig.used(0), rig.next[0] - 1);
        let before = rig.gpu.borrow().submit3d_snapshot().unwrap();
        let retired = rig.machine.irq_stats().retired;
        let digest = rig.machine.snapshot();
        assert!(rig.machine.save_accelerated_resume(&WITNESS).is_err());
        assert_eq!(rig.gpu.borrow().submit3d_snapshot().unwrap(), before);
        assert_eq!(rig.machine.snapshot(), digest);
        assert_eq!(rig.machine.irq_stats().retired, retired);
        rig.finish(&accepted);
        assert!(rig.mailbox.inspect().ready);
        let before = rig.gpu.borrow().submit3d_snapshot().unwrap();
        assert!(before.pending.unwrap().completion_ready);
        assert!(rig.machine.save_accelerated_resume(&WITNESS).is_err());
        assert_eq!(rig.gpu.borrow().submit3d_snapshot().unwrap(), before);
        assert_eq!(rig.used(0), rig.next[0] - 1);
        assert_eq!(rig.machine.snapshot(), digest);
        assert_eq!(rig.machine.irq_stats().retired, retired);
        rig.tick();
        assert_eq!(rig.used(0), rig.next[0]);
        assert!(!rig.mailbox.inspect().ready);
        let saved = rig.machine.save_accelerated_resume(&WITNESS).unwrap();
        assert!(!saved.is_empty());
        assert!(rig.machine.save_resume().is_err());
        println!(
            "CRITIC_CHECKPOINT ready-unconsumed cached={cached} retired={retired} used={} bytes={} digest={}",
            rig.used(0),
            saved.len(),
            rig.machine.snapshot().hex_digest()
        );
    }
}

#[test]
fn repeated_restore_reserves_new_epoch_without_resetting_original_highwaters() {
    for cached in [false, true] {
        let mut source = Rig::new(cached);
        source.seed(71, 103);
        source.transfer(103);
        let old = source.submits.0.borrow().last().unwrap().clone();
        source.finish(&old);
        source.tick();
        let control = source.gpu.borrow().control3d_snapshot().unwrap();
        let submit = source.gpu.borrow().submit3d_snapshot().unwrap();
        let blob = source.machine.save_accelerated_resume(&WITNESS).unwrap();
        let mut target = Rig::new(cached);
        target.seed(71, 103);
        let mut colliding = old.clone();
        for _ in 0..2 {
            target.transfer(103);
            colliding = target.submits.0.borrow().last().unwrap().clone();
            target.finish(&colliding);
            target.tick();
        }
        assert_eq!(colliding.key.sequence, submit.next_sequence);
        assert_eq!(colliding.key.epoch, control.epoch);
        for pass in 1..=3 {
            let events = target.controls.0.borrow().len();
            let (saved_epoch, epoch) = target
                .machine
                .load_accelerated_resume(&blob, &WITNESS)
                .unwrap();
            assert_eq!(saved_epoch, control.epoch);
            assert_eq!(epoch, control.epoch + pass);
            let restored = target.gpu.borrow().control3d_snapshot().unwrap();
            let mut expected = control.clone();
            expected.epoch = epoch;
            assert_eq!(restored, expected);
            assert_eq!(target.gpu.borrow().submit3d_snapshot().unwrap(), submit);
            assert_eq!(
                target.controls.0.borrow().len(),
                events,
                "native restore emits no original control again"
            );
            assert!(
                target
                    .mailbox
                    .post(Submit3dCompletion {
                        key: old.key,
                        exchange_sequence: 0,
                        outcome: Ok(()),
                        gpu_complete: true,
                        applied_commands: 0,
                        draws: 0,
                    })
                    .is_err()
            );
        }
        target.next = source.next;
        let before_used = target.used(0);
        target.transfer(103);
        let fresh = target.submits.0.borrow().last().unwrap().clone();
        assert_eq!(fresh.key.epoch, control.epoch + 3);
        assert_eq!(fresh.key.sequence, submit.next_sequence);
        assert_eq!(fresh.key.sequence, colliding.key.sequence);
        assert_eq!(target.used(0), before_used);
        assert!(
            target
                .mailbox
                .post(Submit3dCompletion {
                    key: old.key,
                    exchange_sequence: 0,
                    outcome: Ok(()),
                    gpu_complete: true,
                    applied_commands: 0,
                    draws: 0,
                })
                .is_err()
        );
        assert!(
            target
                .mailbox
                .post(Submit3dCompletion {
                    key: colliding.key,
                    exchange_sequence: 0,
                    outcome: Ok(()),
                    gpu_complete: true,
                    applied_commands: 0,
                    draws: 0,
                })
                .is_err(),
            "same sequence from the pre-restore epoch must not settle fresh work"
        );
        target.finish(&fresh);
        target.tick();
        assert_eq!(target.used(0), before_used + 1);
        let next_generation = control.next_generation;
        target.ok(&request(p::CMD_RESOURCE_CREATE_2D, 0, &[211, 1, 2, 2]));
        let after = target.gpu.borrow().control3d_snapshot().unwrap();
        assert_eq!(
            after
                .resources
                .iter()
                .find(|r| r.identity.id == 211)
                .unwrap()
                .identity
                .generation,
            next_generation
        );
        assert_eq!(after.next_generation, next_generation + 1);
        assert_eq!(
            after.next_backing_generation,
            control.next_backing_generation
        );
        assert_eq!(
            after
                .resources
                .iter()
                .find(|r| r.identity.id == 103)
                .unwrap()
                .backing_generation,
            control.resources[0].backing_generation
        );
        println!(
            "CRITIC_CHECKPOINT epoch-replay cached={cached} saved={} fresh={} sequence={} generation={} used={} digest={}",
            control.epoch,
            fresh.key.epoch,
            fresh.key.sequence,
            next_generation,
            target.used(0),
            target.machine.snapshot().hex_digest()
        );
    }
}

#[test]
fn accelerated_whole_machine_corruption_cannot_change_cpu_outside_gpu_digest() {
    let mut source = Rig::new(false);
    source.seed(43, 137);
    source.machine.hart_mut().regs.write(5, 0x1234);
    let mut blob = source.machine.save_accelerated_resume(&WITNESS).unwrap();
    let start = blob
        .windows(wasm_vm_core::resume::MAGIC.len())
        .position(|bytes| bytes == wasm_vm_core::resume::MAGIC)
        .expect("native resume container");
    // The independently documented container is header(84), TLV(8), PC(8), x1..x31.
    assert_eq!(
        u32::from_le_bytes(blob[start + 84..start + 88].try_into().unwrap()),
        1
    );
    let x5 = start + 84 + 8 + 5 * 8;
    assert_eq!(
        u64::from_le_bytes(blob[x5..x5 + 8].try_into().unwrap()),
        0x1234
    );
    blob[x5] ^= 1;
    let mut target = Rig::new(false);
    target.machine.hart_mut().regs.write(5, 0xaabb);
    let before = target.machine.snapshot();
    let control = target.gpu.borrow().control3d_snapshot().unwrap();
    let result = target.machine.load_accelerated_resume(&blob, &WITNESS);
    println!(
        "CRITIC_CHECKPOINT outer-corruption byte={x5} result={result:?} target_x5={:#x} epoch={}",
        target.machine.hart().regs.read(5),
        target.gpu.borrow().control3d_snapshot().unwrap().epoch
    );
    assert!(result.is_err(), "accelerated CPU corruption accepted");
    assert_eq!(target.machine.snapshot(), before);
    assert_eq!(target.gpu.borrow().control3d_snapshot().unwrap(), control);
}

#[test]
fn accepted_retained_scanout_checkpoint_is_loadable_after_public_unref() {
    let mut unloadable = 0;
    for renderer in [false, true] {
        let mut source = Rig::new(false);
        source.negotiate();
        let resource = 337;
        let create = if renderer {
            request(
                p::CMD_RESOURCE_CREATE_3D,
                0,
                &[resource, 2, 67, 2, 6, 4, 1, 1, 0, 0, 0, 0],
            )
        } else {
            request(p::CMD_RESOURCE_CREATE_2D, 0, &[resource, 1, 6, 4])
        };
        source.ok(&create);
        source.ok(&request(p::CMD_SET_SCANOUT, 0, &[0, 0, 6, 4, 0, resource]));
        assert_eq!(source.submits.1.borrow().len(), 1);
        let binding = source.gpu.borrow().scanout3d_snapshot().unwrap();
        assert!(binding.binding.is_some());
        source.ok(&request(p::CMD_RESOURCE_UNREF, 0, &[resource, 0]));
        assert!(
            source
                .gpu
                .borrow()
                .control3d_snapshot()
                .unwrap()
                .resources
                .is_empty()
        );
        assert!(source.gpu.borrow().resources.is_empty());
        assert_eq!(source.gpu.borrow().scanout3d_snapshot().unwrap(), binding);
        let saved = source.machine.save_accelerated_resume(&WITNESS);
        if let Ok(blob) = saved {
            let mut target = Rig::new(false);
            let result = target.machine.load_accelerated_resume(&blob, &WITNESS);
            println!(
                "CRITIC_CHECKPOINT retained-unref renderer={renderer} save=Ok bytes={} load={result:?}",
                blob.len()
            );
            if result.is_err() {
                unloadable += 1;
            } else {
                assert_eq!(target.gpu.borrow().scanout3d_snapshot().unwrap(), binding);
            }
        } else {
            println!(
                "CRITIC_CHECKPOINT retained-unref renderer={renderer} explicitly-refused-at-capture"
            );
        }
    }
    assert_eq!(unloadable, 0, "every successful capture must be loadable");
}

struct Fields {
    inner: Range<usize>,
    profile: Range<usize>,
    legacy: Range<usize>,
    control: Range<usize>,
    submit: Range<usize>,
    scanout: Range<usize>,
}
fn word(bytes: &[u8], offset: usize) -> usize {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize
}
fn fields(bytes: &[u8]) -> Fields {
    assert_eq!(&bytes[..8], b"WVMRESU1");
    assert_eq!(&bytes[bytes.len() - 84..bytes.len() - 76], b"WVGRESU1");
    let mut at = 84;
    let gpu = loop {
        let tag = word(bytes, at);
        let length = word(bytes, at + 4);
        let payload = at + 8..at + 8 + length;
        if tag == 12 {
            break payload;
        }
        at = payload.end;
    };
    let offsets = bytes[gpu.clone()]
        .windows(8)
        .enumerate()
        .filter_map(|(offset, value)| (value == b"WVGPU3D1").then_some(offset))
        .collect::<Vec<_>>();
    assert_eq!(offsets.len(), 1, "literal fixture contains one GPU payload");
    let inner = gpu.start + offsets[0]..gpu.end;
    at = inner.start + 48;
    let mut chunks = Vec::new();
    for _ in 0..5 {
        let length = word(bytes, at);
        chunks.push(at + 4..at + 4 + length);
        at += 4 + length;
    }
    assert_eq!(at, inner.end - 32);
    Fields {
        inner,
        profile: chunks[0].clone(),
        legacy: chunks[1].clone(),
        control: chunks[2].clone(),
        submit: chunks[3].clone(),
        scanout: chunks[4].clone(),
    }
}
fn reseal(bytes: &mut [u8], fields: &Fields) {
    let gpu_hash = Sha256::digest(&bytes[fields.inner.start..fields.inner.end - 32]);
    bytes[fields.inner.end - 32..fields.inner.end].copy_from_slice(&gpu_hash);
    let outer_end = bytes.len() - 32;
    let outer_hash = Sha256::digest(&bytes[..outer_end]);
    bytes[outer_end..].copy_from_slice(&outer_hash);
}

fn reseal_outer_extent(bytes: &mut [u8]) {
    let payload_length = bytes.len() - 84;
    assert_eq!(&bytes[payload_length..payload_length + 8], b"WVGRESU1");
    bytes[payload_length + 12..payload_length + 20]
        .copy_from_slice(&(payload_length as u64).to_le_bytes());
    let digest_end = bytes.len() - 32;
    let digest = Sha256::digest(&bytes[..digest_end]);
    bytes[digest_end..].copy_from_slice(&digest);
}

#[test]
fn rehashed_missing_or_duplicate_cpu_section_cannot_mix_target_state() {
    let mut source = Rig::new(false);
    source.seed(61, 151);
    source.machine.hart_mut().regs.write(5, 0x2222);
    let blob = source.machine.save_accelerated_resume(&WITNESS).unwrap();
    assert_eq!(word(&blob, 84), 1);
    let cpu = 84..84 + 8 + word(&blob, 88);
    let mut missing = blob.clone();
    missing.drain(cpu.clone());
    reseal_outer_extent(&mut missing);
    let mut duplicate = blob.clone();
    let trailer = duplicate.len() - 84;
    duplicate.splice(trailer..trailer, blob[cpu].iter().copied());
    reseal_outer_extent(&mut duplicate);
    let mut target = Rig::new(false);
    target.machine.hart_mut().regs.write(5, 0xaaaa);
    let before = target.machine.snapshot();
    let control = target.gpu.borrow().control3d_snapshot().unwrap();
    for (name, bytes) in [("missing-CPU", missing), ("duplicate-CPU", duplicate)] {
        let result = target.machine.load_accelerated_resume(&bytes, &WITNESS);
        assert!(result.is_err(), "accepted section-set mismatch: {name}");
        assert_eq!(target.machine.snapshot(), before);
        assert_eq!(target.gpu.borrow().control3d_snapshot().unwrap(), control);
        println!("CRITIC_CHECKPOINT section={name} result={result:?}");
    }
}

#[test]
fn correctly_framed_but_invalid_native_state_is_rejected_before_commit() {
    let mut source = Rig::new(false);
    source.seed(59, 149);
    let blob = source.machine.save_accelerated_resume(&WITNESS).unwrap();
    let f = fields(&blob);
    assert_eq!(&blob[f.control.start..f.control.start + 8], b"WV3DCTL2");
    assert_eq!(&blob[f.submit.start..f.submit.start + 8], b"WV3DSUB2");
    assert_eq!(&blob[f.scanout.start..f.scanout.start + 8], b"WV3DSCN1");
    // Independent literal traversal of the one-context, one-member, one-resource fixture.
    let context_count = f.control.start + 57;
    assert_eq!(word(&blob, context_count), 1);
    let context = context_count + 4;
    let debug_length = context + 12;
    let members = debug_length + 4 + word(&blob, debug_length);
    assert_eq!(word(&blob, members), 1);
    let resource_count = members + 4 + 12;
    assert_eq!(word(&blob, resource_count), 1);
    let resource = resource_count + 4;
    assert_eq!(blob[resource + 56], 1);
    let backing = resource + 69;
    assert_eq!(word(&blob, resource + 65), 2);
    let legacy_backing = blob[f.legacy.clone()]
        .windows(8)
        .position(|value| value == BACKING.to_le_bytes())
        .unwrap()
        + f.legacy.start;
    let cases = [
        ("profile-byte", f.profile.start + 284, vec![3, 0, 0, 0]),
        (
            "profile-extent",
            f.profile.start - 4,
            u32::MAX.to_le_bytes().to_vec(),
        ),
        (
            "inner-version",
            f.inner.start + 8,
            2u32.to_le_bytes().to_vec(),
        ),
        ("inner-witness", f.inner.start + 16, vec![0; 32]),
        ("control-magic", f.control.start, vec![0]),
        (
            "zero-epoch",
            f.control.start + 8,
            0u64.to_le_bytes().to_vec(),
        ),
        (
            "generation-not-above-live",
            f.control.start + 16,
            2u64.to_le_bytes().to_vec(),
        ),
        (
            "zero-backing-highwater",
            f.control.start + 24,
            0u64.to_le_bytes().to_vec(),
        ),
        (
            "wrong-accounting",
            f.control.start + 32,
            95u64.to_le_bytes().to_vec(),
        ),
        ("poisoned-control", f.control.start + 56, vec![1]),
        ("context-count", context_count, 9u32.to_le_bytes().to_vec()),
        (
            "debug-name-extent",
            debug_length,
            65u32.to_le_bytes().to_vec(),
        ),
        (
            "missing-context-member",
            members + 4,
            999u32.to_le_bytes().to_vec(),
        ),
        (
            "resource-count",
            resource_count,
            65u32.to_le_bytes().to_vec(),
        ),
        (
            "duplicate-creation-generation",
            resource + 4,
            1u64.to_le_bytes().to_vec(),
        ),
        ("metadata-id", resource + 12, 998u32.to_le_bytes().to_vec()),
        (
            "backing-generation-zero",
            resource + 57,
            0u64.to_le_bytes().to_vec(),
        ),
        (
            "backing-count",
            resource + 65,
            16385u32.to_le_bytes().to_vec(),
        ),
        (
            "backing-below-RAM",
            backing,
            (virt::DRAM_BASE - 1).to_le_bytes().to_vec(),
        ),
        (
            "backing-end-outside-RAM",
            backing + 8,
            u32::MAX.to_le_bytes().to_vec(),
        ),
        (
            "legacy-backing-below-RAM",
            legacy_backing,
            (virt::DRAM_BASE - 1).to_le_bytes().to_vec(),
        ),
        (
            "exhausted-sequence",
            f.submit.start + 8,
            u64::MAX.to_le_bytes().to_vec(),
        ),
        (
            "completion-without-admission",
            f.submit.start + 24,
            1u64.to_le_bytes().to_vec(),
        ),
        ("pending-submission", f.submit.end - 1, vec![1]),
        (
            "zero-scanout-generation",
            f.scanout.start + 8,
            0u64.to_le_bytes().to_vec(),
        ),
        ("invalid-binding-discriminator", f.scanout.end - 1, vec![2]),
    ];
    let mut target = Rig::new(false);
    target.machine.hart_mut().regs.write(5, 0xcafe);
    let before = target.machine.snapshot();
    let control = target.gpu.borrow().control3d_snapshot().unwrap();
    let submit = target.gpu.borrow().submit3d_snapshot().unwrap();
    for (name, offset, value) in cases {
        let mut bad = blob.clone();
        assert_ne!(&bad[offset..offset + value.len()], &value);
        bad[offset..offset + value.len()].copy_from_slice(&value);
        reseal(&mut bad, &f);
        let result = target.machine.load_accelerated_resume(&bad, &WITNESS);
        assert!(result.is_err(), "accepted malformed native state: {name}");
        assert_eq!(target.machine.snapshot(), before, "CPU/RAM changed: {name}");
        assert_eq!(
            target.gpu.borrow().control3d_snapshot().unwrap(),
            control,
            "owner changed: {name}"
        );
        assert_eq!(
            target.gpu.borrow().submit3d_snapshot().unwrap(),
            submit,
            "submission changed: {name}"
        );
        println!("CRITIC_CHECKPOINT semantic={name} offset={offset} result={result:?}");
    }
}
