//! An RV64 guest publishes the queue, notifies MMIO, waits for the GPU fence,
//! and loads recorded readback into architectural registers. Native host sinks
//! vary physical timing/bytes; this test makes no physical-presentation claim.
#![cfg(all(
    feature = "virgl-renderer",
    feature = "trace",
    not(feature = "zicsr-stub")
))]
use sha2::{Digest, Sha256};
use std::{cell::RefCell, rc::Rc};
use wasm_vm_core::resume::ComponentSnapshot;
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::Bus,
    dev::virtio::gpu::{
        GpuState, NullSink,
        capabilities::{FormatMask, HostLimits, QualifiedCapabilities},
        control3d::{Control3dError as E, Control3dEvent, Control3dSink},
        submit3d::*,
    },
    platform::{Platform, virt},
    session_clock::{
        SessionDelivery, SessionEffect, SessionError, SessionPosition,
        sources::{ObservationRecord, ObservationTape},
    },
    session_gpu::{self, GpuError, GpuResult, Payload, PayloadRef, ResultKind},
    trace::VecSink,
};
const DESC: u64 = virt::DRAM_BASE + 0x10000;
const AVAIL: u64 = virt::DRAM_BASE + 0x11000;
const USED: u64 = virt::DRAM_BASE + 0x12000;
const REQUEST: u64 = virt::DRAM_BASE + 0x14000;
const RESPONSE: u64 = virt::DRAM_BASE + 0x16000;
const WITNESS: u64 = virt::DRAM_BASE + 0x18000;
const BACKING: u64 = virt::DRAM_BASE + 0x40000;
fn packet(op: u32, context: u32, size: usize) -> Vec<u8> {
    let mut b = vec![0; size];
    put(&mut b, 0, op);
    put(&mut b, 16, context);
    b
}
fn put(b: &mut [u8], at: usize, value: u32) {
    b[at..at + 4].copy_from_slice(&value.to_le_bytes());
}
fn caps() -> QualifiedCapabilities {
    let mut f = FormatMask::default();
    for n in [1, 2, 16, 67] {
        f.insert(n).unwrap();
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
        f.clone(),
        f,
        FormatMask::default(),
        FormatMask::default(),
        FormatMask::default(),
        "wasm-vm WebGL2 VirGL",
    )
    .unwrap()
}
#[derive(Default)]
struct Host {
    jobs: Vec<Submit3dRequest>,
    scanouts: Vec<wasm_vm_core::dev::virtio::gpu::scanout3d::Scanout3dRequest>,
    cancelled: Vec<Submit3dKey>,
    fail: Option<E>,
    cancel_fail: bool,
}
struct Controls;
impl Control3dSink for Controls {
    fn apply(&mut self, _: &Control3dEvent) -> Result<(), E> {
        Ok(())
    }
}
struct Jobs(Rc<RefCell<Host>>);
impl Submit3dSink for Jobs {
    fn begin_job(&mut self, r: &Submit3dRequest) -> Result<(), E> {
        let mut h = self.0.borrow_mut();
        h.jobs.push(r.clone());
        h.fail.map_or(Ok(()), Err)
    }
    fn bind_scanout(
        &mut self,
        _: &wasm_vm_core::dev::virtio::gpu::scanout3d::Scanout3dEvent,
    ) -> Result<(), E> {
        Ok(())
    }
    fn begin_scanout(
        &mut self,
        request: &wasm_vm_core::dev::virtio::gpu::scanout3d::Scanout3dRequest,
    ) -> Result<(), E> {
        self.0.borrow_mut().scanouts.push(*request);
        Ok(())
    }
    fn cancel_job(&mut self, key: Submit3dKey) -> Result<(), E> {
        let mut h = self.0.borrow_mut();
        if h.cancel_fail {
            return Err(E::BridgePoisoned);
        }
        h.cancelled.push(key);
        Ok(())
    }
}
/// Minimal literal RV64 assembler: all queue config, available publication,
/// notifications, used polling and result loads execute as guest instructions.
#[derive(Default)]
struct Code(Vec<u32>);
impl Code {
    fn li(&mut self, rd: u32, value: u32) {
        let hi = value.wrapping_add(0x800) & 0xfffff000;
        self.0.push(hi | rd << 7 | 0x37);
        self.0
            .push((value & 0xfff) << 20 | rd << 15 | rd << 7 | 0x13);
        self.0.push(32 << 20 | rd << 15 | 1 << 12 | rd << 7 | 0x13); // slli32
        self.0.push(32 << 20 | rd << 15 | 5 << 12 | rd << 7 | 0x13); // srli32
    }
    fn store(&mut self, base: u32, source: u32, offset: u32, width: u32) {
        self.0.push(
            (offset >> 5) << 25
                | source << 20
                | base << 15
                | width << 12
                | (offset & 31) << 7
                | 0x23,
        );
    }
    fn load(&mut self, rd: u32, base: u32, offset: u32, width: u32) {
        self.0
            .push(offset << 20 | base << 15 | width << 12 | rd << 7 | 3);
    }
    fn mmio(&mut self, offset: u32, value: u32) {
        self.li(2, value);
        self.store(1, 2, offset, 2);
    }
    fn bne(&mut self, left: u32, right: u32, offset: i32) {
        let b = offset as u32;
        self.0.push(
            (b >> 12 & 1) << 31
                | (b >> 5 & 63) << 25
                | right << 20
                | left << 15
                | 1 << 12
                | (b >> 1 & 15) << 8
                | (b >> 11 & 1) << 7
                | 0x63,
        );
    }
}
struct Rig {
    machine: Machine,
    gpu: Rc<RefCell<GpuState>>,
    host: Rc<RefCell<Host>>,
    mail: Submit3dMailbox,
    trace: VecSink,
    length: usize,
}
impl Rig {
    fn new(length: usize, tape: Option<ObservationTape>, cached: bool) -> Self {
        Self::with_job(length, tape, cached, 0)
    }
    // 0 command stream, 1/2 original transfer-to/from, 3 global scanout capture.
    fn with_job(length: usize, tape: Option<ObservationTape>, cached: bool, job: u32) -> Self {
        let replay = tape.is_some();
        let mut machine = Machine::new(length + 1024 * 1024);
        machine.enable_plic();
        machine.enable_clint(64);
        machine.enable_virtio_slots(None);
        machine.enable_virtio_gpu(Box::new(NullSink)).unwrap();
        let host = Rc::new(RefCell::new(Host::default()));
        let mail = Submit3dMailbox::new();
        machine
            .attach_qualified_virgl(
                Box::new(Controls),
                Box::new(Jobs(host.clone())),
                mail.clone(),
                caps(),
            )
            .unwrap();
        let (slot, gpu) = machine.virtio_gpu().unwrap();
        let base = Platform::virtio_base(slot as u64);
        machine.set_block_cache(cached);
        machine.start_session_clock(1).unwrap();
        machine
            .start_session_sources(machine.source_policy(), tape)
            .unwrap();
        machine.enable_session_gpu_results(replay).unwrap();
        let mut rig = Self {
            machine,
            gpu,
            host,
            mail,
            trace: VecSink::new(),
            length,
        };
        let context = packet(0x200, 2, 96);
        let mut resource = packet(0x204, 0, 72);
        for (i, n) in [3, 0, 64, 16, length as u32, 1, 1, 1, 0, 0, 0, 0]
            .into_iter()
            .enumerate()
        {
            put(&mut resource, 24 + 4 * i, n);
        }
        if job == 3 {
            for (i, n) in [3, 2, 67, 2, 4, 4, 1, 1, 0, 0, 0, 0]
                .into_iter()
                .enumerate()
            {
                put(&mut resource, 24 + 4 * i, n);
            }
        }
        if job == 4 {
            resource = packet(0x101, 0, 40);
            for (at, value) in [(24, 3), (28, 67), (32, 4), (36, 4)] {
                put(&mut resource, at, value);
            }
        }
        let mut backing = packet(0x106, 0, 48);
        put(&mut backing, 24, 3);
        put(&mut backing, 28, 1);
        backing[32..40].copy_from_slice(&BACKING.to_le_bytes());
        put(&mut backing, 40, length as u32);
        let mut attach = packet(0x202, 2, 32);
        put(&mut attach, 24, 3);
        let mut submit = packet(0x207, 2, 36);
        put(&mut submit, 24, 4);
        put(&mut submit, 32, 0x0102_0304);
        if job == 1 || job == 2 {
            submit = packet(if job == 1 { 0x205 } else { 0x206 }, 2, 72);
            for (at, value) in [(36, length as u32), (40, 1), (44, 1), (56, 3)] {
                put(&mut submit, at, value);
            }
        }
        if job == 3 {
            submit = packet(0x104, 0, 48);
            for (at, value) in [(32, 4), (36, 4), (40, 3)] {
                put(&mut submit, at, value);
            }
        }
        if job == 4 {
            submit = packet(0x105, 0, 56);
            for (at, value) in [(32, 4), (36, 4), (48, 3)] {
                put(&mut submit, at, value);
            }
        }
        put(&mut submit, 4, 1);
        submit[8..16].copy_from_slice(&0x1234_5678_9abc_def0u64.to_le_bytes());
        let mut packets = vec![context, resource, backing, attach];
        if job == 3 {
            let mut bind = packet(0x103, 0, 48);
            for (at, value) in [(32, 4), (36, 4), (44, 3)] {
                put(&mut bind, at, value);
            }
            packets.push(bind);
        }
        packets.push(submit);
        for (i, p) in packets.iter().enumerate() {
            let request = REQUEST + i as u64 * 256;
            let response = RESPONSE + i as u64 * 64;
            rig.write(request, p);
            rig.write(response, &[0xa5; 64]);
            let mut d = [0u8; 32];
            d[..8].copy_from_slice(&request.to_le_bytes());
            put(&mut d, 8, p.len() as u32);
            d[12..14].copy_from_slice(&1u16.to_le_bytes());
            d[14..16].copy_from_slice(&(2 * i as u16 + 1).to_le_bytes());
            d[16..24].copy_from_slice(&response.to_le_bytes());
            put(&mut d, 24, 24);
            d[28..30].copy_from_slice(&2u16.to_le_bytes());
            rig.write(DESC + i as u64 * 32, &d);
            rig.write(AVAIL + 4 + i as u64 * 2, &(2 * i as u16).to_le_bytes());
        }
        rig.write(BACKING, &vec![0x6d; length]);
        let mut code = Code::default();
        code.li(1, base as u32);
        for (at, value) in [
            (0x70, 3),
            (0x24, 0),
            (0x20, 1),
            (0x24, 1),
            (0x20, 1),
            (0x70, 11),
            (0x70, 15),
            (0x30, 0),
            (0x38, 16),
            (0x80, DESC as u32),
            (0x84, 0),
            (0x90, AVAIL as u32),
            (0x94, 0),
            (0xa0, USED as u32),
            (0xa4, 0),
            (0x44, 1),
        ] {
            code.mmio(at, value);
        }
        code.li(3, AVAIL as u32);
        code.li(4, USED as u32);
        code.li(7, WITNESS as u32);
        for i in 0..packets.len() as u32 {
            code.li(5, i + 1);
            code.store(3, 5, 2, 1);
            code.store(1, 0, 0x50, 2);
            code.load(6, 4, 2, 5);
            code.bne(6, 5, -4);
            code.li(8, (RESPONSE + u64::from(i) * 64) as u32);
            code.load(9, 8, 0, 6);
            code.store(7, 9, i * 8, 3);
        }
        code.li(8, BACKING as u32);
        code.load(10, 8, 0, 3);
        code.store(7, 10, 128, 3);
        code.li(8, (BACKING + length as u64 - 8) as u32);
        code.load(11, 8, 0, 3);
        code.store(7, 11, 136, 3);
        code.li(8, (RESPONSE + (packets.len() as u64 - 1) * 64) as u32);
        code.load(12, 8, 8, 3);
        code.store(7, 12, 144, 3);
        code.li(9, 1);
        code.store(7, 9, 152, 3);
        code.0.push(0x0000_006f);
        let bytes: Vec<u8> = code.0.into_iter().flat_map(u32::to_le_bytes).collect();
        rig.write(virt::DRAM_BASE + 0x2000, &bytes);
        rig.machine.hart_mut().regs.pc = virt::DRAM_BASE + 0x2000;
        rig
    }
    fn write(&mut self, addr: u64, bytes: &[u8]) {
        self.machine.bus_mut().write_ram_slice(addr, bytes).unwrap();
    }
    fn pos(&self) -> SessionPosition {
        self.machine.session_position().unwrap()
    }
    fn step(&mut self) {
        assert_eq!(
            self.machine.run_traced(1, &mut self.trace),
            RunOutcome::MaxInstrs
        );
    }
    fn pending(&mut self) {
        for _ in 0..500 {
            if !self.host.borrow().jobs.is_empty() || !self.host.borrow().scanouts.is_empty() {
                return;
            }
            self.step();
        }
        panic!("RV64 never submitted GPU job");
    }
    fn until(&mut self, target: u64, quantum: u64) {
        while self.pos().transition < target {
            let before = self.pos();
            let result = self
                .machine
                .run_session_until_traced(target, quantum, &mut self.trace);
            assert_eq!(result, Ok(RunOutcome::MaxInstrs), "at {before:?}");
            assert!(self.pos().transition > before.transition);
        }
        assert_eq!(self.pos().transition, target);
    }
    fn done(&mut self) {
        for _ in 0..100 {
            if self.machine.bus_mut().load64(WITNESS + 152).unwrap() == 1 {
                return;
            }
            self.step();
        }
        panic!("guest fence never retired");
    }
    fn exchange(&self, n: u64) -> Submit3dExchange {
        let host = self.host.borrow();
        let job = host.jobs.last().unwrap();
        let resource = &job.resources[0];
        Submit3dExchange {
            key: job.key,
            exchange_sequence: n,
            backing: Submit3dBacking {
                resource: resource.identity,
                generation: resource.backing.as_ref().unwrap().generation,
            },
            rows: Submit3dRows {
                offset: 0,
                row_bytes: self.length as u32,
                row_stride: self.length as u32,
                row_count: 1,
            },
        }
    }
    fn completion(&self, outcome: Result<(), E>, exchanges: u64) -> Submit3dCompletion {
        Submit3dCompletion {
            key: {
                let host = self.host.borrow();
                host.jobs
                    .last()
                    .map(|r| r.key)
                    .or_else(|| host.scanouts.last().map(|r| r.key))
                    .unwrap()
            },
            exchange_sequence: exchanges,
            outcome,
            gpu_complete: true,
            applied_commands: if outcome.is_ok() && self.host.borrow().scanouts.is_empty() {
                1
            } else {
                0
            },
            draws: 0,
        }
    }
    fn dump_state(&mut self, case: &str, name: &str) {
        if let Ok(root) = std::env::var("E9_GPU_RESULT_EVIDENCE") {
            let root = std::path::Path::new(&root).join(case);
            std::fs::create_dir_all(&root).unwrap();
            std::fs::write(
                root.join(format!("{name}.cpu")),
                self.machine.hart().to_snapshot(),
            )
            .unwrap();
            std::fs::write(
                root.join(format!("{name}.ram")),
                self.machine.bus_mut().ram().as_bytes(),
            )
            .unwrap();
            std::fs::write(root.join(format!("{name}.gpu")), self.virtual_gpu()).unwrap();
            std::fs::write(root.join(format!("{name}.trace")), self.trace.canonical()).unwrap();
            if let Some(resource) = self.gpu.borrow().resources.get(3) {
                let bytes: Vec<u8> = resource
                    .host_pixels
                    .iter()
                    .flat_map(|v| v.to_le_bytes())
                    .collect();
                std::fs::write(root.join(format!("{name}.shadow")), bytes).unwrap();
            }
        }
    }
    fn virtual_gpu(&self) -> Vec<u8> {
        let state = self.gpu.borrow();
        let mut b = state.control3d_snapshot().unwrap().canonical_bytes();
        b.extend(state.submit3d_snapshot().unwrap().canonical_bytes());
        b.extend(state.scanout3d_snapshot().unwrap().canonical_bytes());
        b
    }
    fn check(&mut self, bytes: &[u8], outcome: u32) {
        for i in 0..4 {
            assert_eq!(
                self.machine.bus_mut().load64(WITNESS + i * 8).unwrap(),
                0x1100
            );
        }
        assert_eq!(
            self.machine.bus_mut().load64(WITNESS + 32).unwrap(),
            u64::from(outcome)
        );
        assert_eq!(
            self.machine.bus_mut().load64(WITNESS + 128).unwrap(),
            u64::from_le_bytes(bytes[..8].try_into().unwrap())
        );
        assert_eq!(
            self.machine.bus_mut().load64(WITNESS + 136).unwrap(),
            u64::from_le_bytes(bytes[bytes.len() - 8..].try_into().unwrap())
        );
        assert_eq!(
            self.machine.bus_mut().load64(WITNESS + 144).unwrap(),
            0x1234_5678_9abc_def0
        );
        assert_eq!(self.machine.bus_mut().load16(USED + 2).unwrap(), 5);
        assert!(
            self.gpu
                .borrow()
                .submit3d_snapshot()
                .unwrap()
                .pending
                .is_none()
        );
    }
}
struct Capture {
    events: Vec<SessionDelivery>,
    payloads: Vec<Payload>,
    tape: ObservationTape,
    end: u64,
    trace: String,
    snapshot: wasm_vm_core::snapshot::Snapshot,
    virtual_gpu: Vec<u8>,
    result: Vec<u8>,
    cpu: Vec<u8>,
    ram: Vec<u8>,
}
fn capture(length: usize, delay: u64, failed: bool) -> Capture {
    let mut rig = Rig::new(length, None, false);
    rig.pending();
    rig.until(rig.pos().transition + delay, 7);
    let mut result = vec![0x6d; length];
    if !failed {
        let gather = rig.exchange(1);
        assert_eq!(rig.machine.submit3d_gather(&gather).unwrap(), result);
        rig.until(rig.pos().transition + 13, 9);
        result = (0..length).map(|i| ((i * 29 + 7) % 251) as u8).collect();
        let scatter = rig.exchange(2);
        rig.machine.submit3d_scatter(&scatter, &result).unwrap();
        rig.until(rig.pos().transition + 19, 3);
    }
    rig.mail
        .post(rig.completion(
            if failed { Err(E::OutOfMemory) } else { Ok(()) },
            if failed { 0 } else { 2 },
        ))
        .unwrap();
    rig.done();
    rig.check(&result, if failed { 0x1201 } else { 0x1100 });
    let batch = rig.machine.take_session_gpu_recording().unwrap();
    let records = batch
        .events
        .iter()
        .filter_map(|d| {
            if let SessionEffect::Observation(value) = &d.effect {
                Some(ObservationRecord {
                    position: d.position,
                    value: value.clone(),
                })
            } else {
                None
            }
        })
        .collect();
    let tape = ObservationTape {
        policy: rig.machine.source_policy(),
        records,
    };
    tape.validate().unwrap();
    Capture {
        events: batch.events,
        payloads: batch.payloads,
        tape,
        end: rig.pos().transition,
        trace: rig.trace.canonical(),
        snapshot: rig.machine.snapshot(),
        virtual_gpu: rig.virtual_gpu(),
        result,
        cpu: rig.machine.hart().to_snapshot(),
        ram: rig.machine.bus_mut().ram().as_bytes().to_vec(),
    }
}
fn gpu_events(c: &Capture) -> Vec<(SessionPosition, GpuResult)> {
    c.events
        .iter()
        .filter_map(|d| match &d.effect {
            SessionEffect::HostInput { channel, bytes } if *channel == session_gpu::CHANNEL => {
                Some((d.position, GpuResult::decode(bytes).unwrap()))
            }
            _ => None,
        })
        .collect()
}
fn payload(c: &Capture, result: GpuResult) -> Option<Payload> {
    if let ResultKind::Scatter { payload, .. } = result.kind {
        Some(
            c.payloads
                .iter()
                .find(|p| p.reference == payload)
                .unwrap()
                .clone(),
        )
    } else {
        None
    }
}
fn dump(name: &str, c: &Capture, replays: &[(String, String)]) {
    if let Ok(root) = std::env::var("E9_GPU_RESULT_EVIDENCE") {
        let root = std::path::Path::new(&root).join(name);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("record.trace"), &c.trace).unwrap();
        std::fs::write(root.join("controls.tape"), c.tape.encode().unwrap()).unwrap();
        std::fs::write(root.join("virtual-gpu.bin"), &c.virtual_gpu).unwrap();
        std::fs::write(root.join("cpu.bin"), &c.cpu).unwrap();
        std::fs::write(root.join("record.ram"), &c.ram).unwrap();
        std::fs::write(
            root.join("state.txt"),
            format!("{:?}\nend={:?}\n", c.snapshot, c.end),
        )
        .unwrap();
        for (i, (position, result)) in gpu_events(c).into_iter().enumerate() {
            std::fs::write(
                root.join(format!("result-{i}.bin")),
                result.encode().unwrap(),
            )
            .unwrap();
            std::fs::write(
                root.join(format!("result-{i}.position")),
                format!("{position:?}\n"),
            )
            .unwrap();
        }
        for p in &c.payloads {
            std::fs::write(
                root.join(format!("{}.payload", hex(&p.reference.sha256))),
                &p.bytes,
            )
            .unwrap();
        }
        for (name, trace) in replays {
            std::fs::write(root.join(format!("{name}.trace")), trace).unwrap();
        }
    }
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|n| format!("{n:02x}")).collect()
}
#[test]
fn rv64_gpu_result_replay_owns_bytes_and_fence_across_host_schedules() {
    for (name, length, delay) in [("small", 64, 23), ("production-32m", 32 << 20, 11)] {
        let c = capture(length, delay, false);
        assert_eq!(c.payloads.len(), 1);
        assert_eq!(c.payloads[0].bytes.len(), length);
        let frames = gpu_events(&c);
        assert_eq!(frames.len(), 3);
        let mut traces = Vec::new();
        for (seed, cached) in [(3, false), (7, true), (19, true)] {
            let mut r = Rig::new(length, Some(c.tape.clone()), cached);
            for (i, (position, result)) in frames.iter().copied().enumerate() {
                r.machine
                    .prepare_session_gpu_replay(position, result, payload(&c, result))
                    .unwrap();
                // Physical uploads/readbacks occur several guest instructions AFTER
                // logical admission; early completion posts wait behind the log fence.
                if i > 0 {
                    r.until(
                        (r.pos().transition + seed % 5).min(position.transition),
                        seed,
                    );
                    let exchange = r.exchange(i as u64);
                    eprintln!(
                        "GPU_PHYSICAL_SCHEDULE {name} seed={seed} exchange={i} position={:?}",
                        r.pos()
                    );
                    let foreign = vec![0xe3; length];
                    let data = r
                        .machine
                        .replay_session_gpu_transport(
                            &exchange,
                            (i == 2).then_some(foreign.as_slice()),
                            None,
                        )
                        .unwrap();
                    if i == 1 {
                        assert_eq!(data, vec![0x6d; length]);
                    } else {
                        assert!(data.is_empty());
                    }
                    if i == 2 && seed != 19 {
                        r.mail.post(r.completion(Ok(()), 2)).unwrap();
                    }
                }
                r.until(position.transition, seed);
                if i == 0 {
                    assert_eq!(
                        r.machine
                            .replay_session_gpu_transport(&r.exchange(1), None, None),
                        Err(GpuError::PhysicalPending)
                    );
                }
                r.machine
                    .deliver_session_gpu_replay()
                    .or_else(|error| {
                        if i == 2 && error == GpuError::PhysicalPending {
                            r.mail.post(r.completion(Ok(()), 2)).unwrap();
                            r.machine.deliver_session_gpu_replay()
                        } else {
                            Err(error)
                        }
                    })
                    .unwrap();
            }
            r.until(c.end, seed);
            r.check(&c.result, 0x1100);
            assert_eq!(r.machine.snapshot(), c.snapshot);
            assert_eq!(r.machine.hart().to_snapshot(), c.cpu);
            assert_eq!(r.virtual_gpu(), c.virtual_gpu);
            assert_eq!(r.trace.canonical(), c.trace);
            let replay = r.machine.take_session_deliveries().unwrap();
            assert_eq!(replay, c.events);
            r.dump_state(name, &format!("replay-{seed}"));
            traces.push((format!("replay-{seed}"), r.trace.canonical()));
        }
        dump(name, &c, &traces);
        eprintln!(
            "GPU_RESULT_PROOF {name} bytes={length} transitions={} ram={} trace={}",
            c.end,
            c.snapshot.hex_digest(),
            hex(&Sha256::digest(c.trace.as_bytes()))
        );
    }
}
#[test]
fn rv64_recorded_failure_cancels_new_physical_job_without_stranding_fence() {
    let c = capture(64, 7, true);
    let (position, result) = gpu_events(&c)[0];
    let mut r = Rig::new(64, Some(c.tape.clone()), true);
    r.machine
        .prepare_session_gpu_replay(position, result, None)
        .unwrap();
    r.until(position.transition, 11);
    r.host.borrow_mut().cancel_fail = true;
    let before = r.machine.snapshot();
    let clock = r.pos();
    assert_eq!(
        r.machine.deliver_session_gpu_replay(),
        Err(GpuError::PhysicalFailure)
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    r.host.borrow_mut().cancel_fail = false;
    r.machine.deliver_session_gpu_replay().unwrap();
    r.until(c.end, 5);
    r.check(&c.result, 0x1201);
    assert_eq!(r.machine.snapshot(), c.snapshot);
    assert_eq!(r.machine.hart().to_snapshot(), c.cpu);
    assert_eq!(r.trace.canonical(), c.trace);
    assert_eq!(r.machine.take_session_deliveries().unwrap(), c.events);
    assert_eq!(r.virtual_gpu(), c.virtual_gpu);
    assert_eq!(r.host.borrow().cancelled.len(), 1);
    assert_eq!(
        r.mail.post(r.completion(Ok(()), 0)),
        Err(E::InvalidParameter)
    );
    r.dump_state("recorded-failure", "replay");
    dump(
        "recorded-failure",
        &c,
        &[("replay".into(), r.trace.canonical())],
    );
}

#[test]
fn missing_corrupt_reordered_and_wrong_intent_results_never_advance_or_write() {
    let c = capture(64, 17, false);
    let frames = gpu_events(&c);
    let mut missing = Rig::new(64, Some(c.tape.clone()), false);
    missing.pending();
    let before = missing.machine.snapshot();
    let position = missing.pos();
    assert_eq!(
        missing.machine.run(10_000),
        RunOutcome::SessionStopped(SessionError::GpuResult(GpuError::PhysicalPending))
    );
    assert_eq!(missing.machine.snapshot(), before);
    assert_eq!(missing.pos(), position);
    assert_eq!(
        missing
            .machine
            .session_gpu_dma(&missing.exchange(1), None, None),
        Err(GpuError::ReplayIngress)
    );
    for attack in 0..7 {
        let mut r = Rig::new(64, Some(c.tape.clone()), attack % 2 == 0);
        r.machine
            .prepare_session_gpu_replay(frames[0].0, frames[0].1, None)
            .unwrap();
        r.until(frames[0].0.transition, 13);
        r.machine.deliver_session_gpu_replay().unwrap();
        let (position, mut result) = frames[1];
        let mut payload = payload(&c, result);
        let before = r.machine.snapshot();
        let clock = r.pos();
        let gpu = r.virtual_gpu();
        let expected = match attack {
            0 => {
                payload = None;
                GpuError::MissingPayload
            }
            1 => {
                payload.as_mut().unwrap().bytes[7] ^= 1;
                GpuError::Payload
            }
            2 => {
                result.request_sha256[0] ^= 1;
                GpuError::Intent
            }
            3 => {
                if let ResultKind::Scatter {
                    ref mut exchange, ..
                } = result.kind
                {
                    exchange.exchange_sequence = 1;
                }
                GpuError::Intent
            }
            4 => {
                if let ResultKind::Scatter {
                    ref mut exchange, ..
                } = result.kind
                {
                    exchange.backing.generation += 1;
                }
                GpuError::Intent
            }
            5 => {
                if let ResultKind::Scatter {
                    ref mut exchange, ..
                } = result.kind
                {
                    exchange.key.sequence += 1;
                }
                GpuError::Intent
            }
            6 => {
                if let ResultKind::Scatter {
                    ref mut exchange, ..
                } = result.kind
                {
                    exchange.key.epoch += 1;
                }
                GpuError::Intent
            }
            _ => unreachable!(),
        };
        let prepare = r
            .machine
            .prepare_session_gpu_replay(position, result, payload);
        if attack < 2 {
            assert_eq!(prepare, Err(expected));
            assert_eq!(r.machine.snapshot(), before);
            assert_eq!(r.pos(), clock);
        } else {
            prepare.unwrap();
            r.until(position.transition, 7);
            let before = r.machine.snapshot();
            let clock = r.pos();
            assert_eq!(r.machine.deliver_session_gpu_replay(), Err(expected));
            assert_eq!(r.machine.snapshot(), before);
            assert_eq!(r.pos(), clock);
        }
        assert_eq!(r.virtual_gpu(), gpu);
        assert_eq!(r.machine.session_gpu_cursor(), Ok(1));
        eprintln!(
            "GPU_RESULT_REJECTION attack={attack} expected={expected:?} clock={:?}",
            r.pos()
        );
    }
}
#[test]
fn full_outbox_and_stale_queue_fail_before_any_dma_or_sequence_change() {
    let mut r = Rig::new(64, None, false);
    r.pending();
    let batch = r.machine.take_session_gpu_recording().unwrap();
    assert_eq!(batch.events.len(), 4);
    for _ in 0..wasm_vm_core::session_clock::MAX_EVENTS {
        r.machine
            .stage_session_effect(r.pos().transition, SessionEffect::ExternalPending(false))
            .unwrap();
        r.machine.deliver_session_boundary().unwrap();
    }
    let before = r.machine.snapshot();
    let clock = r.pos();
    let gpu = r.virtual_gpu();
    let exchange = r.exchange(1);
    assert_eq!(
        r.machine
            .session_gpu_dma(&exchange, Some(&[0x99; 64]), None),
        Err(GpuError::Admission)
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    assert_eq!(r.virtual_gpu(), gpu);
    assert_eq!(r.machine.session_gpu_cursor(), Ok(0));
    assert_eq!(
        r.machine
            .take_session_gpu_recording()
            .unwrap()
            .payloads
            .len(),
        0
    );
    r.machine
        .session_gpu_dma(&exchange, Some(&[0x99; 64]), None)
        .unwrap();
    let slot = r.machine.virtio_gpu().unwrap().0;
    let base = Platform::virtio_base(slot as u64);
    r.machine.bus_mut().store32(base + 0x44, 0).unwrap();
    let before = r.machine.snapshot();
    let clock = r.pos();
    let gpu = r.virtual_gpu();
    assert_eq!(
        r.machine
            .session_gpu_dma(&r.exchange(2), Some(&[0x77; 64]), None),
        Err(GpuError::StaleOwner)
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    assert_eq!(r.virtual_gpu(), gpu);
    eprintln!(
        "GPU_RESULT_ATOMIC outbox-full and stale-generation preserved RAM, GPU state, rings, cursor and {clock:?}"
    );
}
#[test]
fn corrupt_envelopes_and_owned_payload_windows_are_bounded() {
    let c = capture(64, 2, false);
    let frames = gpu_events(&c);
    for (_, result) in &frames {
        let encoded = result.encode().unwrap();
        assert_eq!(GpuResult::decode(&encoded), Ok(*result));
        for end in 0..encoded.len() {
            assert!(GpuResult::decode(&encoded[..end]).is_err());
        }
        let mut trailing = encoded.clone();
        trailing.push(0);
        assert_eq!(GpuResult::decode(&trailing), Err(GpuError::Malformed));
        for (offset, value) in [(0, 0), (8, 255)] {
            let mut corrupt = encoded.clone();
            corrupt[offset] = value;
            assert_eq!(GpuResult::decode(&corrupt), Err(GpuError::Malformed));
        }
    }
    let mut window = session_gpu::Payloads::default();
    for n in 0u16..256 {
        let bytes = n.to_le_bytes().to_vec();
        let reference = PayloadRef::of(&bytes).unwrap();
        window.insert(Payload { reference, bytes }).unwrap();
    }
    let bytes = vec![1, 2, 3];
    let reference = PayloadRef::of(&bytes).unwrap();
    let resident = window.resident_bytes();
    assert_eq!(
        window.insert(Payload { reference, bytes }),
        Err(GpuError::Limit)
    );
    assert_eq!(window.resident_bytes(), resident);
    assert_eq!(window.len(), 256);
    assert_eq!(window.take_all().len(), 256);
    assert!(window.is_empty());
    let bytes = vec![0x77; 32 << 20];
    let reference = PayloadRef::of(&bytes).unwrap();
    window.insert(Payload { reference, bytes }).unwrap();
    assert_eq!(window.get(reference).unwrap().len(), 32 << 20);
    let bytes = vec![0x66; 32 << 20];
    let reference = PayloadRef::of(&bytes).unwrap();
    window.insert(Payload { reference, bytes }).unwrap();
    let bytes = vec![0x55];
    let reference = PayloadRef::of(&bytes).unwrap();
    assert_eq!(
        window.insert(Payload { reference, bytes }),
        Err(GpuError::Limit)
    );
    assert_eq!(window.resident_bytes(), 64 << 20);
    assert_eq!(
        PayloadRef::of(&vec![0; 1 + (32 << 20)]),
        Err(GpuError::Limit)
    );
}

#[test]
fn missing_or_failed_physical_completion_cannot_publish_recorded_success() {
    let c = capture(64, 5, false);
    let frames = gpu_events(&c);
    let mut r = Rig::new(64, Some(c.tape.clone()), true);
    for (i, (position, result)) in frames[..2].iter().copied().enumerate() {
        r.machine
            .prepare_session_gpu_replay(position, result, payload(&c, result))
            .unwrap();
        r.until(position.transition, 5);
        r.machine.deliver_session_gpu_replay().unwrap();
        let exchange = r.exchange(i as u64 + 1);
        r.machine
            .replay_session_gpu_transport(&exchange, (i == 1).then_some(&[0x51; 64][..]), None)
            .unwrap();
    }
    let (position, result) = frames[2];
    r.machine
        .prepare_session_gpu_replay(position, result, None)
        .unwrap();
    r.until(position.transition, 7);
    let before = r.machine.snapshot();
    let clock = r.pos();
    let gpu = r.virtual_gpu();
    assert_eq!(
        r.machine.deliver_session_gpu_replay(),
        Err(GpuError::PhysicalPending)
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    assert_eq!(r.virtual_gpu(), gpu);
    let mut wrong = r.completion(Ok(()), 2);
    wrong.key.epoch += 1;
    assert_eq!(r.mail.post(wrong), Err(E::InvalidParameter));
    let mut wrong = r.completion(Ok(()), 2);
    wrong.exchange_sequence = 1;
    assert_eq!(r.mail.post(wrong), Err(E::InvalidParameter));
    r.mail.post(r.completion(Err(E::OutOfMemory), 2)).unwrap();
    assert_eq!(
        r.mail.post(r.completion(Ok(()), 2)),
        Err(E::InvalidParameter)
    );
    assert_eq!(
        r.machine.deliver_session_gpu_replay(),
        Err(GpuError::PhysicalFailure)
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    assert_eq!(r.virtual_gpu(), gpu);
    assert_eq!(r.machine.session_gpu_cursor(), Ok(2));
    eprintln!(
        "GPU_RESULT_PHYSICAL refusal at {clock:?}: missing witness, stale/duplicate posts, failed reconstruction; no response/ring/cursor publication"
    );
}
#[test]
fn gpu_result_profile_and_pending_capture_remain_closed_until_pending_codec() {
    let mut unadmitted = Machine::new(1 << 20);
    assert_eq!(
        unadmitted.enable_session_gpu_results(false),
        Err(GpuError::Profile)
    );
    let mut r = Rig::new(64, None, false);
    assert_eq!(
        r.machine.enable_session_gpu_results(false),
        Err(GpuError::Profile)
    );
    r.pending();
    let before = r.machine.snapshot();
    let clock = r.pos();
    let gpu = r.virtual_gpu();
    assert!(r.machine.save_accelerated_resume(&[0x44; 32]).is_err());
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    assert_eq!(r.virtual_gpu(), gpu);
    assert!(r.machine.save_session_resume().is_err());
    eprintln!("GPU_RESULT_CHECKPOINT refused: E9-T18b owns the pending result frontier");
}

#[test]
fn automatic_before_hook_admits_each_due_result_once_and_holds_missing_successor() {
    let c = capture(64, 9, false);
    let frames = gpu_events(&c);
    let mut r = Rig::new(64, Some(c.tape.clone()), true);
    for (i, (position, result)) in frames[..2].iter().copied().enumerate() {
        r.machine
            .prepare_session_gpu_replay(position, result, payload(&c, result))
            .unwrap();
        assert_eq!(
            r.machine.run_traced(100_000, &mut r.trace),
            RunOutcome::SessionStopped(SessionError::GpuResult(GpuError::PhysicalPending))
        );
        assert_eq!(r.pos(), position);
        assert_eq!(r.machine.session_gpu_cursor(), Ok(i as u64 + 1));
        let snapshot = r.machine.snapshot();
        assert_eq!(
            r.machine.run(1000),
            RunOutcome::SessionStopped(SessionError::GpuResult(GpuError::PhysicalPending))
        );
        assert_eq!(r.pos(), position);
        assert_eq!(r.machine.snapshot(), snapshot);
        r.machine
            .replay_session_gpu_transport(
                &r.exchange(i as u64 + 1),
                (i == 1).then_some(&[0x99; 64][..]),
                None,
            )
            .unwrap();
    }
    r.mail.post(r.completion(Ok(()), 2)).unwrap();
    let (position, result) = frames[2];
    r.machine
        .prepare_session_gpu_replay(position, result, None)
        .unwrap();
    r.until(c.end, 100_000);
    assert_eq!(r.machine.snapshot(), c.snapshot);
    assert_eq!(r.machine.hart().to_snapshot(), c.cpu);
    assert_eq!(r.virtual_gpu(), c.virtual_gpu);
    assert_eq!(r.trace.canonical(), c.trace);
    assert_eq!(r.machine.take_session_deliveries().unwrap(), c.events);
    r.dump_state("automatic-before", "replay");
    dump(
        "automatic-before",
        &c,
        &[("replay".into(), r.trace.canonical())],
    );
}

#[test]
fn reset_revokes_queued_physical_upload_receipts() {
    let c = capture(64, 5, false);
    let frame = gpu_events(&c)[0];
    let mut r = Rig::new(64, Some(c.tape.clone()), true);
    r.machine
        .prepare_session_gpu_replay(frame.0, frame.1, None)
        .unwrap();
    r.until(frame.0.transition, 5);
    r.machine.deliver_session_gpu_replay().unwrap();
    let exchange = r.exchange(1);
    let slot = r.machine.virtio_gpu().unwrap().0;
    let base = Platform::virtio_base(slot as u64);
    r.machine.bus_mut().store32(base + 0x44, 0).unwrap();
    let clock = r.pos();
    let before = r.machine.snapshot();
    assert_eq!(
        r.machine
            .replay_session_gpu_transport(&exchange, None, None),
        Err(GpuError::StaleOwner)
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    assert_eq!(r.machine.session_gpu_cursor(), Ok(1));
}

#[test]
fn original_transfer_and_global_scanout_requests_keep_their_result_identity() {
    for job in [1, 2, 3] {
        let mut original = Rig::with_job(64, None, false, job);
        original.pending();
        let input = [0x6d; 64];
        if job != 3 {
            let exchange = original.exchange(1);
            assert_eq!(
                original
                    .machine
                    .submit3d_gather_layered(&exchange, 64, 1)
                    .unwrap(),
                input
            );
            let exchange = original.exchange(2);
            original
                .machine
                .submit3d_scatter_layered(&exchange, 64, 1, &[0xa7; 64])
                .unwrap();
        }
        original.until(original.pos().transition + 11, 3);
        original
            .mail
            .post(original.completion(Ok(()), if job == 3 { 0 } else { 2 }))
            .unwrap();
        original.done();
        let expected = original.machine.snapshot();
        let cpu = original.machine.hart().to_snapshot();
        let gpu = original.virtual_gpu();
        let batch = original.machine.take_session_gpu_recording().unwrap();
        let records = batch
            .events
            .iter()
            .filter_map(|d| {
                if let SessionEffect::Observation(value) = &d.effect {
                    Some(ObservationRecord {
                        position: d.position,
                        value: value.clone(),
                    })
                } else {
                    None
                }
            })
            .collect();
        let tape = ObservationTape {
            policy: original.machine.source_policy(),
            records,
        };
        let mut replay = Rig::with_job(64, Some(tape), true, job);
        for frame in &batch.events {
            let SessionEffect::HostInput { channel, bytes } = &frame.effect else {
                continue;
            };
            assert_eq!(*channel, session_gpu::CHANNEL);
            let result = GpuResult::decode(bytes).unwrap();
            let payload = if let ResultKind::Scatter { payload, .. } = result.kind {
                Some(
                    batch
                        .payloads
                        .iter()
                        .find(|p| p.reference == payload)
                        .unwrap()
                        .clone(),
                )
            } else {
                None
            };
            replay
                .machine
                .prepare_session_gpu_replay(frame.position, result, payload)
                .unwrap();
            replay.until(frame.position.transition, 7);
            if matches!(result.kind, ResultKind::Complete(_)) {
                replay
                    .mail
                    .post(replay.completion(Ok(()), if job == 3 { 0 } else { 2 }))
                    .unwrap();
            }
            replay.machine.deliver_session_gpu_replay().unwrap();
            if let ResultKind::Gather {
                exchange, layers, ..
            }
            | ResultKind::Scatter {
                exchange, layers, ..
            } = result.kind
            {
                let data = replay
                    .machine
                    .replay_session_gpu_transport(
                        &exchange,
                        matches!(result.kind, ResultKind::Scatter { .. })
                            .then_some(&[0x11; 64][..]),
                        layers,
                    )
                    .unwrap();
                if matches!(result.kind, ResultKind::Gather { .. }) {
                    assert_eq!(data, input);
                }
            }
        }
        replay.until(original.pos().transition, 3);
        assert_eq!(replay.machine.snapshot(), expected);
        assert_eq!(replay.machine.hart().to_snapshot(), cpu);
        assert_eq!(replay.virtual_gpu(), gpu);
        assert_eq!(replay.trace.canonical(), original.trace.canonical());
        assert_eq!(
            replay.machine.take_session_deliveries().unwrap(),
            batch.events
        );
        original.dump_state(&format!("original-kind-{job}"), "record");
        replay.dump_state(&format!("original-kind-{job}"), "replay");
        if let Ok(dir) = std::env::var("E9_GPU_RESULT_EVIDENCE") {
            let dir = std::path::Path::new(&dir).join(format!("original-kind-{job}"));
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("record.trace"), original.trace.canonical()).unwrap();
            std::fs::write(dir.join("replay.trace"), replay.trace.canonical()).unwrap();
            std::fs::write(dir.join("cpu.bin"), cpu).unwrap();
            std::fs::write(dir.join("virtual-gpu.bin"), gpu).unwrap();
        }
        eprintln!(
            "GPU_ORIGINAL_KIND job={job} state={} completeCPU={} guest-instructions={}",
            expected.hex_digest(),
            hex(&Sha256::digest(replay.machine.hart().to_snapshot())),
            replay.trace.records.len()
        );
    }
}

#[test]
fn a_full_64m_payload_window_refuses_production_dma_before_any_guest_effect() {
    let mut r = Rig::new(32 << 20, None, false);
    r.pending();
    r.machine.take_session_gpu_recording().unwrap();
    for (sequence, value) in [(1, 0x99), (2, 0x88)] {
        r.machine
            .session_gpu_dma(&r.exchange(sequence), Some(&vec![value; 32 << 20]), None)
            .unwrap();
    }
    let before = r.machine.snapshot();
    let clock = r.pos();
    let gpu = r.virtual_gpu();
    let cpu = r.machine.hart().to_snapshot();
    assert_eq!(
        r.machine
            .session_gpu_dma(&r.exchange(3), Some(&vec![0x77; 32 << 20]), None),
        Err(GpuError::Limit)
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    assert_eq!(r.virtual_gpu(), gpu);
    assert_eq!(r.machine.hart().to_snapshot(), cpu);
    assert_eq!(r.machine.session_gpu_cursor(), Ok(2));
    let batch = r.machine.take_session_gpu_recording().unwrap();
    assert_eq!(batch.events.len(), 2);
    assert_eq!(batch.payloads.len(), 2);
    assert_eq!(
        batch.payloads.iter().map(|p| p.bytes.len()).sum::<usize>(),
        64 << 20
    );
    if let Ok(root) = std::env::var("E9_GPU_RESULT_EVIDENCE") {
        let root = std::path::Path::new(&root).join("full-payload-window");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("refusal.txt"),
            format!(
                "Limit at {clock:?}; cursor2; resident67108864; RAM{}; CPU{}\n",
                before.hex_digest(),
                hex(&Sha256::digest(cpu))
            ),
        )
        .unwrap();
        std::fs::write(root.join("guest.trace"), r.trace.canonical()).unwrap();
        for payload in batch.payloads {
            std::fs::write(
                root.join(format!("{}.payload", hex(&payload.reference.sha256))),
                payload.bytes,
            )
            .unwrap();
        }
    }
    eprintln!(
        "GPU_PAYLOAD_WINDOW refusal=Limit bytes=67108864 position={clock:?} RAM={} cursor2",
        before.hex_digest()
    );
}

#[test]
fn gpu_proof_gap_result_wrong_mode_and_prepared_position_refusals_preserve_the_incumbent() {
    let c = capture(64, 3, false);
    let frame = gpu_events(&c)[0];
    let mut record = Rig::new(64, None, false);
    let before = record.machine.snapshot();
    let clock = record.pos();
    let gpu = record.virtual_gpu();
    assert_eq!(
        record
            .machine
            .prepare_session_gpu_replay(frame.0, frame.1, None),
        Err(GpuError::ReplayIngress)
    );
    assert_eq!(
        record.machine.deliver_session_gpu_replay(),
        Err(GpuError::ReplayIngress)
    );
    let key = Submit3dKey {
        epoch: 1,
        sequence: 1,
    };
    let exchange = Submit3dExchange {
        key,
        exchange_sequence: 1,
        backing: Submit3dBacking {
            resource: wasm_vm_core::dev::virtio::gpu::control3d::Control3dId {
                id: 3,
                generation: 2,
            },
            generation: 1,
        },
        rows: Submit3dRows {
            offset: 0,
            row_bytes: 64,
            row_stride: 64,
            row_count: 1,
        },
    };
    assert_eq!(
        record
            .machine
            .replay_session_gpu_transport(&exchange, None, None),
        Err(GpuError::ReplayIngress)
    );
    assert_eq!(record.machine.snapshot(), before);
    assert_eq!(record.pos(), clock);
    assert_eq!(record.virtual_gpu(), gpu);
    for attack in 0..7 {
        let mut r = Rig::new(64, Some(c.tape.clone()), true);
        r.until(5, 3);
        let mut position = frame.0;
        match attack {
            0 => position.phase = wasm_vm_core::session_clock::SessionPhase::Observe,
            1 => position.transition = 4,
            2 => position.retired = 4,
            3 => position.retired = position.transition + 1,
            4 => position.ordinal = 0,
            5 => position.sequence = 0,
            6 => {
                r.machine
                    .prepare_session_gpu_replay(position, frame.1, None)
                    .unwrap();
            }
            _ => unreachable!(),
        }
        let before = r.machine.snapshot();
        let clock = r.pos();
        let gpu = r.virtual_gpu();
        assert!(matches!(
            r.machine.take_session_gpu_recording(),
            Err(GpuError::ReplayIngress)
        ));
        assert_eq!(
            r.machine
                .prepare_session_gpu_replay(position, frame.1, None),
            Err(GpuError::Position)
        );
        assert_eq!(r.machine.snapshot(), before);
        assert_eq!(r.pos(), clock);
        assert_eq!(r.virtual_gpu(), gpu);
        assert_eq!(r.machine.session_gpu_cursor(), Ok(0));
        if attack == 6 {
            r.until(frame.0.transition, 13);
            r.machine.deliver_session_gpu_replay().unwrap();
            assert_eq!(r.machine.session_gpu_cursor(), Ok(1));
        }
    }
    eprintln!(
        "GPU_GAP_G1 wrong modes and seven invalid/duplicate preparations held CPU/RAM/GPU/clock; original prepared frame remained usable"
    );
}

#[test]
fn gpu_proof_gap_malformed_delivery_hash_pending_event_and_completion_generation_refuse_atomically()
{
    let c = capture(64, 3, false);
    let frames = gpu_events(&c);
    for attack in 0..5 {
        let mut r = Rig::new(64, Some(c.tape.clone()), true);
        let (mut position, mut result) = frames[0];
        match attack {
            0 => position.retired -= 1,
            1 => position.ordinal += 1,
            2 => position.sequence += 1,
            3 => {
                if let ResultKind::Gather {
                    ref mut expected, ..
                } = result.kind
                {
                    expected.sha256[0] ^= 1;
                }
            }
            4 => {}
            _ => unreachable!(),
        }
        r.machine
            .prepare_session_gpu_replay(position, result, None)
            .unwrap();
        r.until(position.transition, 11);
        if attack == 4 {
            r.machine
                .stage_session_effect(position.transition, SessionEffect::ExternalPending(false))
                .unwrap();
        }
        let before = r.machine.snapshot();
        let clock = r.pos();
        let gpu = r.virtual_gpu();
        let pending = r.machine.session_pending_events();
        assert_eq!(
            r.machine.deliver_session_gpu_replay(),
            Err(if attack == 3 {
                GpuError::Payload
            } else {
                GpuError::Position
            })
        );
        assert_eq!(r.machine.snapshot(), before);
        assert_eq!(r.pos(), clock);
        assert_eq!(r.virtual_gpu(), gpu);
        assert_eq!(r.machine.session_gpu_cursor(), Ok(0));
        assert_eq!(r.machine.session_pending_events(), pending);
        eprintln!("GPU_GAP_G1 admission attack={attack} refused before effects at {clock:?}");
    }
    let mut r = Rig::new(64, Some(c.tape.clone()), true);
    for (i, (position, result)) in frames[..2].iter().copied().enumerate() {
        r.machine
            .prepare_session_gpu_replay(position, result, payload(&c, result))
            .unwrap();
        r.until(position.transition, 7);
        r.machine.deliver_session_gpu_replay().unwrap();
        r.machine
            .replay_session_gpu_transport(
                &r.exchange(i as u64 + 1),
                (i == 1).then_some(&[0x33; 64][..]),
                None,
            )
            .unwrap();
    }
    let (position, result) = frames[2];
    r.machine
        .prepare_session_gpu_replay(position, result, None)
        .unwrap();
    r.until(position.transition, 7);
    r.mail.post(r.completion(Ok(()), 2)).unwrap();
    let base = Platform::virtio_base(r.machine.virtio_gpu().unwrap().0 as u64);
    r.machine.bus_mut().store32(base + 0x44, 0).unwrap();
    let before = r.machine.snapshot();
    let clock = r.pos();
    let gpu = r.virtual_gpu();
    assert_eq!(
        r.machine.deliver_session_gpu_replay(),
        Err(GpuError::StaleOwner)
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    assert_eq!(r.virtual_gpu(), gpu);
    assert_eq!(r.machine.session_gpu_cursor(), Ok(2));
    eprintln!("GPU_GAP_G1 stale completion queue generation refused at {clock:?}");
}

#[test]
fn gpu_proof_gap_persisted_control_tape_and_invalid_wire_boundaries_are_exercised() {
    let c = capture(64, 3, false);
    let encoded = c.tape.encode().unwrap();
    let decoded = ObservationTape::decode(&encoded).unwrap();
    assert_eq!(decoded, c.tape);
    let frames = gpu_events(&c);
    let mut r = Rig::new(64, Some(decoded), true);
    for (i, (position, result)) in frames.iter().copied().enumerate() {
        r.machine
            .prepare_session_gpu_replay(position, result, payload(&c, result))
            .unwrap();
        r.until(position.transition, 7);
        if i == 2 {
            r.mail.post(r.completion(Ok(()), 2)).unwrap();
        }
        r.machine.deliver_session_gpu_replay().unwrap();
        if i < 2 {
            r.machine
                .replay_session_gpu_transport(
                    &r.exchange(i as u64 + 1),
                    (i == 1).then_some(&[0xff; 64][..]),
                    None,
                )
                .unwrap();
        }
    }
    r.until(c.end, 7);
    assert_eq!(r.machine.snapshot(), c.snapshot);
    assert_eq!(r.machine.hart().to_snapshot(), c.cpu);
    assert_eq!(r.trace.canonical(), c.trace);
    let gather = frames[0].1.encode().unwrap();
    let complete = frames[2].1.encode().unwrap();
    let mut cases = Vec::new();
    for (offset, width, value) in [
        (41, 8, 0u64),
        (49, 8, 0),
        (57, 8, 0),
        (57, 8, 4097),
        (65, 8, 0),
        (73, 8, 0),
        (89, 4, 0),
        (93, 4, 32),
        (101, 4, 0),
    ] {
        let mut bytes = gather.clone();
        bytes[offset..offset + width].copy_from_slice(&value.to_le_bytes()[..width]);
        cases.push((bytes, GpuError::Intent));
    }
    let mut bytes = gather.clone();
    bytes[9..41].fill(0);
    cases.push((bytes, GpuError::Intent));
    for length in [0u32, 33_554_433] {
        let mut bytes = gather.clone();
        bytes[138..142].copy_from_slice(&length.to_le_bytes());
        cases.push((bytes, GpuError::Limit));
    }
    let mut layered = frames[0].1;
    if let ResultKind::Gather { ref mut layers, .. } = layered.kind {
        *layers = Some((64, 1));
    }
    for offset in [106, 110] {
        let mut bytes = layered.encode().unwrap();
        bytes[offset..offset + 4].fill(0);
        cases.push((bytes, GpuError::Intent));
    }
    for (offset, width, value) in [(57, 8, 4097u64), (67, 4, 4097), (71, 4, 257)] {
        let mut bytes = complete.clone();
        bytes[offset..offset + width].copy_from_slice(&value.to_le_bytes()[..width]);
        cases.push((bytes, GpuError::Intent));
    }
    let mut bytes = complete;
    bytes[66] = 0;
    cases.push((bytes, GpuError::Intent));
    cases.push((vec![0; 257], GpuError::Limit));
    for (index, (bytes, error)) in cases.into_iter().enumerate() {
        assert_eq!(GpuResult::decode(&bytes), Err(error));
        if let Ok(root) = std::env::var("E9_GPU_RESULT_EVIDENCE") {
            let root = std::path::Path::new(&root).join("codec-refusals");
            std::fs::create_dir_all(&root).unwrap();
            std::fs::write(root.join(format!("{index:02}-{error:?}.bin")), bytes).unwrap();
        }
    }
    r.dump_state("persisted-control-tape", "replay");
    eprintln!(
        "GPU_GAP_G2 kind7 on-wire tape replay matched full CPU/RAM/trace; identity/exchange/layer/length/completion/oversize codec refusals held"
    );
}

#[test]
fn gpu_proof_gap_replay_receipt_count_and_byte_limits_allow_drain_then_retry() {
    for (length, limit, name) in [(64, 256, "count"), (32 << 20, 2, "bytes")] {
        let c = capture(length, 2, false);
        let (position, base_result) = gpu_events(&c)[0];
        let mut r = Rig::new(length, Some(c.tape.clone()), true);
        r.machine
            .prepare_session_gpu_replay(position, base_result, None)
            .unwrap();
        r.until(position.transition, 7);
        for sequence in 1..=limit + 1 {
            let mut result = base_result;
            if let ResultKind::Gather {
                ref mut exchange, ..
            } = result.kind
            {
                exchange.exchange_sequence = sequence;
            }
            if sequence != 1 {
                let mut position = r.pos();
                position.ordinal += 1;
                position.sequence += 1;
                r.machine
                    .prepare_session_gpu_replay(position, result, None)
                    .unwrap();
            }
            if sequence <= limit {
                r.machine.deliver_session_gpu_replay().unwrap();
                r.machine.take_session_deliveries().unwrap();
            } else {
                let before = r.machine.snapshot();
                let clock = r.pos();
                let gpu = r.virtual_gpu();
                let cpu = r.machine.hart().to_snapshot();
                r.dump_state(&format!("receipt-limit-{name}"), "before-limit");
                assert_eq!(r.machine.deliver_session_gpu_replay(), Err(GpuError::Limit));
                r.dump_state(&format!("receipt-limit-{name}"), "refused");
                assert_eq!(r.machine.snapshot(), before);
                assert_eq!(r.pos(), clock);
                assert_eq!(r.virtual_gpu(), gpu);
                assert_eq!(r.machine.hart().to_snapshot(), cpu);
                assert_eq!(r.machine.session_gpu_cursor(), Ok(limit));
                let data = r
                    .machine
                    .replay_session_gpu_transport(&r.exchange(1), None, None)
                    .unwrap();
                assert_eq!(data.len(), length);
                assert!(data.iter().all(|v| *v == 0x6d));
                r.machine.deliver_session_gpu_replay().unwrap();
                eprintln!(
                    "GPU_GAP_G4 replay {name} Limit at {clock:?}; full CPU/RAM/GPU/cursor held, drain then retry accepted exchange{sequence}"
                );
            }
        }
        for sequence in 2..=limit + 1 {
            r.machine
                .replay_session_gpu_transport(&r.exchange(sequence), None, None)
                .unwrap();
        }
        let mut completion = r.completion(Ok(()), limit + 1);
        completion.key.epoch = base_result.key().epoch;
        let result = GpuResult {
            request_sha256: base_result.request_sha256,
            kind: ResultKind::Complete(completion),
        };
        let mut position = r.pos();
        position.ordinal += 1;
        position.sequence += 1;
        r.machine
            .prepare_session_gpu_replay(position, result, None)
            .unwrap();
        r.mail.post(r.completion(Ok(()), limit + 1)).unwrap();
        r.machine.deliver_session_gpu_replay().unwrap();
        r.done();
        r.check(&vec![0x6d; length], 0x1100);
        r.dump_state(&format!("receipt-limit-{name}"), "resolved");
    }
}

#[test]
fn gpu_proof_gap_legacy_dense_length_refuses_before_shadow_dma_exchange_or_event() {
    let mut r = Rig::with_job(64, None, false, 4);
    r.pending();
    let exchange = r.exchange(1);
    let mut wrong = exchange;
    wrong.rows.row_bytes = 32;
    let before = r.machine.snapshot();
    let clock = r.pos();
    let gpu = r.virtual_gpu();
    let shadow = r
        .gpu
        .borrow()
        .resources
        .get(3)
        .unwrap()
        .host_pixels
        .to_vec();
    r.dump_state("legacy-dense-refusal", "before-limit");
    assert_eq!(
        r.machine.session_gpu_dma(&wrong, None, None),
        Err(GpuError::Intent)
    );
    r.dump_state("legacy-dense-refusal", "refused");
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    assert_eq!(r.virtual_gpu(), gpu);
    assert_eq!(r.machine.session_gpu_cursor(), Ok(0));
    assert_eq!(
        r.gpu
            .borrow()
            .resources
            .get(3)
            .unwrap()
            .host_pixels
            .as_ref(),
        shadow.as_slice()
    );
    assert_eq!(
        r.machine.session_gpu_dma(&exchange, None, None).unwrap(),
        [0x6d; 64]
    );
    assert_eq!(
        r.gpu
            .borrow()
            .resources
            .get(3)
            .unwrap()
            .host_pixels
            .as_ref(),
        &[0x6d6d6d6d; 16]
    );
    r.mail.post(r.completion(Ok(()), 1)).unwrap();
    r.done();
    r.check(&[0x6d; 64], 0x1100);
    r.dump_state("legacy-dense-refusal", "resolved");
    eprintln!(
        "GPU_GAP_G4 backing-valid32-byte dense gather refused at {clock:?}; shadow/RAM/queue/cursor held; correct64-byte gather and original fence resolved"
    );
}

#[test]
fn verifier_live_descriptor_rewrite_cannot_redirect_accepted_result_authority() {
    let c = capture(64, 17, false);
    let frames = gpu_events(&c);
    let mut r = Rig::new(64, Some(c.tape.clone()), true);
    let decoy = virt::DRAM_BASE + 0x1f000;
    for (i, (position, result)) in frames.iter().copied().enumerate() {
        r.machine
            .prepare_session_gpu_replay(position, result, payload(&c, result))
            .unwrap();
        r.until(position.transition, 29);
        if i == 0 {
            r.write(decoy, &[0x4a; 64]);
            // Change only live RAM after queue acceptance. The original descriptor
            // and request held by pending must keep exclusive completion authority.
            r.write(DESC + 4 * 32 + 16, &decoy.to_le_bytes());
            r.write(
                REQUEST + 4 * 256 + 8,
                &0xfeed_cafe_1234_5678u64.to_le_bytes(),
            );
        }
        if i == 2 {
            r.mail.post(r.completion(Ok(()), 2)).unwrap();
        }
        r.machine.deliver_session_gpu_replay().unwrap();
        if i < 2 {
            let bytes = r
                .machine
                .replay_session_gpu_transport(
                    &r.exchange(i as u64 + 1),
                    (i == 1).then_some(&[0x92; 64][..]),
                    None,
                )
                .unwrap();
            if i == 0 {
                assert_eq!(bytes, vec![0x6d; 64]);
            } else {
                assert!(bytes.is_empty());
            }
        }
    }
    r.until(c.end, 31);
    r.check(&c.result, 0x1100);
    let mut unchanged = [0u8; 64];
    r.machine
        .bus_mut()
        .ram()
        .read_slice(decoy, &mut unchanged)
        .unwrap();
    assert_eq!(
        unchanged, [0x4a; 64],
        "live descriptor must not redirect completion"
    );
    assert_eq!(
        r.machine.bus_mut().load64(RESPONSE + 4 * 64 + 8).unwrap(),
        0x1234_5678_9abc_def0
    );
    assert_eq!(r.machine.bus_mut().load32(USED + 4 + 4 * 8).unwrap(), 8);
    assert_eq!(r.machine.bus_mut().load32(USED + 8 + 4 * 8).unwrap(), 24);
    assert_eq!(r.machine.session_gpu_cursor(), Ok(3));
    assert_eq!(r.machine.hart().to_snapshot(), c.cpu);
    assert_eq!(r.virtual_gpu(), c.virtual_gpu);
    assert_eq!(r.trace.canonical(), c.trace);
    r.dump_state("verifier-live-descriptor", "replay");
    eprintln!(
        "VERIFIER_AUTHORITY held decoy={decoy:#x} original-fence=123456789abcdef0 accepted-head=8 used-len=24 cursor3 position={:?}",
        r.pos()
    );
}

#[test]
fn verifier_gpu_control_intent_divergence_cannot_publish_unrecorded_response() {
    let c = capture(64, 13, false);
    let mut tape = c.tape.clone();
    let boundary = tape.records[0].position.transition;
    tape.records[0].value.bytes[0] ^= 1;
    let mut r = Rig::new(64, Some(tape), true);
    let frame = gpu_events(&c)[0];
    r.machine
        .prepare_session_gpu_replay(frame.0, frame.1, None)
        .unwrap();
    r.until(boundary, 17);
    let before = r.machine.snapshot();
    let cpu = r.machine.hart().to_snapshot();
    let position = r.pos();
    let ram = r.machine.bus_mut().ram().as_bytes().to_vec();
    let result = r.machine.run_traced(100, &mut r.trace);
    assert!(
        matches!(result, RunOutcome::SessionStopped(SessionError::SourceDivergence(d))
        if d.reason == wasm_vm_core::session_clock::sources::DivergenceReason::Intent),
        "{result:?}"
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.machine.hart().to_snapshot(), cpu);
    assert_eq!(r.machine.bus_mut().ram().as_bytes(), ram);
    assert_eq!(r.pos(), position);
    assert_eq!(r.machine.bus_mut().load16(USED + 2).unwrap(), 0);
    assert!(r.machine.take_session_deliveries().unwrap().is_empty());
    assert!(r.host.borrow().jobs.is_empty());
    assert!(r.gpu.borrow().control3d_snapshot().unwrap().poisoned);
    let failed_gpu = r.virtual_gpu();
    let ResultKind::Gather { exchange, .. } = frame.1.kind else {
        panic!("recorded gather frame");
    };
    assert_eq!(
        r.machine
            .replay_session_gpu_transport(&exchange, None, None),
        Err(GpuError::Admission)
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.machine.hart().to_snapshot(), cpu);
    assert_eq!(r.virtual_gpu(), failed_gpu);
    assert_eq!(r.machine.session_gpu_cursor(), Ok(0));
    assert_eq!(r.pos(), position);
    r.dump_state("verifier-control-divergence", "refused");
    eprintln!(
        "VERIFIER_CONTROL_GATE {result:?} unchanged-position={position:?} RAM={}",
        hex(&Sha256::digest(ram))
    );
}

#[test]
fn verifier_early_physical_completion_stays_behind_scatter_and_receipt_frontier() {
    let c = capture(64, 13, false);
    let frames = gpu_events(&c);
    // A valid envelope may still contradict the admitted exchange frontier.
    let mut wrong_frontier = Rig::new(64, Some(c.tape.clone()), true);
    for (i, (position, result)) in frames[..2].iter().copied().enumerate() {
        wrong_frontier
            .machine
            .prepare_session_gpu_replay(position, result, payload(&c, result))
            .unwrap();
        wrong_frontier.until(position.transition, 17);
        wrong_frontier.machine.deliver_session_gpu_replay().unwrap();
        wrong_frontier
            .machine
            .replay_session_gpu_transport(
                &wrong_frontier.exchange(i as u64 + 1),
                (i == 1).then_some(&[0x39; 64][..]),
                None,
            )
            .unwrap();
    }
    let (position, mut bad_result) = frames[2];
    let ResultKind::Complete(ref mut completion) = bad_result.kind else {
        panic!("recorded completion frame");
    };
    completion.exchange_sequence = 1;
    wrong_frontier
        .machine
        .prepare_session_gpu_replay(position, bad_result, None)
        .unwrap();
    wrong_frontier.until(position.transition, 23);
    let before = wrong_frontier.machine.snapshot();
    let cpu = wrong_frontier.machine.hart().to_snapshot();
    let clock = wrong_frontier.pos();
    let gpu = wrong_frontier.virtual_gpu();
    wrong_frontier.dump_state("verifier-completion-frontier", "before");
    assert_eq!(
        wrong_frontier.machine.deliver_session_gpu_replay(),
        Err(GpuError::Intent)
    );
    assert_eq!(
        wrong_frontier.machine.run(1000),
        RunOutcome::SessionStopped(SessionError::GpuResult(GpuError::Intent))
    );
    assert_eq!(wrong_frontier.machine.snapshot(), before);
    assert_eq!(wrong_frontier.machine.hart().to_snapshot(), cpu);
    assert_eq!(wrong_frontier.pos(), clock);
    assert_eq!(wrong_frontier.virtual_gpu(), gpu);
    assert_eq!(wrong_frontier.machine.session_gpu_cursor(), Ok(2));
    wrong_frontier.dump_state("verifier-completion-frontier", "refused");
    eprintln!(
        "VERIFIER_COMPLETION_FRONTIER refused exchange1 after2 at {clock:?}; no retirement or partial effects"
    );
    let mut r = Rig::new(64, Some(c.tape.clone()), true);
    for (i, (position, result)) in frames[..2].iter().copied().enumerate() {
        r.machine
            .prepare_session_gpu_replay(position, result, payload(&c, result))
            .unwrap();
        r.until(position.transition, 17);
        r.machine.deliver_session_gpu_replay().unwrap();
        if i == 0 {
            assert_eq!(
                r.machine
                    .replay_session_gpu_transport(&r.exchange(1), None, None)
                    .unwrap(),
                vec![0x6d; 64]
            );
            r.mail.post(r.completion(Ok(()), 1)).unwrap();
        }
    }
    let (position, result) = frames[2];
    r.machine
        .prepare_session_gpu_replay(position, result, None)
        .unwrap();
    r.until(position.transition, 23);
    let before = r.machine.snapshot();
    let clock = r.pos();
    let gpu = r.virtual_gpu();
    assert_eq!(
        r.machine.deliver_session_gpu_replay(),
        Err(GpuError::PhysicalPending)
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    assert_eq!(r.virtual_gpu(), gpu);
    let mut wrong = r.exchange(2);
    wrong.backing.generation += 1;
    assert_eq!(
        r.machine
            .replay_session_gpu_transport(&wrong, Some(&[0x39; 64]), None),
        Err(GpuError::Intent)
    );
    assert_eq!(r.machine.snapshot(), before);
    assert_eq!(r.pos(), clock);
    assert!(
        r.machine
            .replay_session_gpu_transport(&r.exchange(2), Some(&[0x39; 64]), None)
            .unwrap()
            .is_empty()
    );
    r.machine.deliver_session_gpu_replay().unwrap();
    r.until(c.end, 31);
    r.check(&c.result, 0x1100);
    assert_eq!(r.machine.snapshot(), c.snapshot);
    assert_eq!(r.machine.hart().to_snapshot(), c.cpu);
    assert_eq!(r.virtual_gpu(), c.virtual_gpu);
    assert_eq!(r.trace.canonical(), c.trace);
    assert_eq!(r.machine.session_gpu_cursor(), Ok(3));
    r.dump_state("verifier-early-completion", "replay");
    dump(
        "verifier-early-completion",
        &c,
        &[("replay".into(), r.trace.canonical())],
    );
    eprintln!(
        "VERIFIER_EARLY_COMPLETION held undrained-receipt at {clock:?}; exact result and final cursor3"
    );
}
