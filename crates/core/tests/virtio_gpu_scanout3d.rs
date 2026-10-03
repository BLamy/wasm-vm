//! Literal queue packets at the actual Machine service boundary. Native sinks
//! control completion scheduling; the browser corpus supplies actual GPU work.
#![cfg(all(feature = "virgl-control-proof", not(feature = "zicsr-stub")))]
use std::{cell::RefCell, rc::Rc};
use wasm_vm_core::dev::virtio::gpu::{
    GpuState, TestSink,
    control3d::{Control3dError as E, Control3dEvent, Control3dSink},
    scanout3d::*,
    submit3d::*,
};
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::Bus,
    platform::{Platform, virt},
};
const RAM: usize = 4 * 1024 * 1024;
const DESC: u64 = virt::DRAM_BASE + 0x6000;
const AVAIL: u64 = virt::DRAM_BASE + 0x7000;
const USED: u64 = virt::DRAM_BASE + 0x8000;
const REQUEST: u64 = virt::DRAM_BASE + 0x10000;
const RESPONSE: u64 = virt::DRAM_BASE + 0x14000;

fn put32(b: &mut [u8], at: usize, v: u32) {
    b[at..at + 4].copy_from_slice(&v.to_le_bytes());
}
fn packet(op: u32, ctx: u32, len: usize) -> Vec<u8> {
    let mut b = vec![0; len];
    put32(&mut b, 0, op);
    put32(&mut b, 16, ctx);
    b
}
fn id_command(op: u32, ctx: u32, id: u32) -> Vec<u8> {
    let mut b = packet(op, ctx, 32);
    put32(&mut b, 24, id);
    b
}
fn fence(mut b: Vec<u8>, id: u64) -> Vec<u8> {
    put32(&mut b, 4, 1);
    b[8..16].copy_from_slice(&id.to_le_bytes());
    b
}
fn reply(request: &[u8], ty: u32) -> Vec<u8> {
    let mut b = request[..24].to_vec();
    b[21..24].fill(0);
    put32(&mut b, 0, ty);
    put32(
        &mut b,
        4,
        u32::from_le_bytes(request[4..8].try_into().unwrap()) & 1,
    );
    if b[4] == 0 {
        b[8..16].fill(0);
    }
    b
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|v| format!("{v:02x}")).collect()
}
#[derive(Default)]
struct Host {
    controls: Vec<Control3dEvent>,
    work: Vec<Submit3dRequest>,
    cancelled: Vec<Submit3dKey>,
    fail_begin: Option<E>,
    fail_bind: Option<E>,
    binds: Vec<Scanout3dEvent>,
    captures: Vec<Scanout3dRequest>,
    immediate: bool,
}
struct Controls(Rc<RefCell<Host>>);
impl Control3dSink for Controls {
    fn apply(&mut self, e: &Control3dEvent) -> Result<(), E> {
        self.0.borrow_mut().controls.push(e.clone());
        Ok(())
    }
}
struct Jobs(Rc<RefCell<Host>>, Submit3dMailbox);
impl Submit3dSink for Jobs {
    fn begin_job(&mut self, r: &Submit3dRequest) -> Result<(), E> {
        let mut h = self.0.borrow_mut();
        h.work.push(r.clone());
        if h.immediate {
            assert_eq!(self.1.inspect().active, Some(r.key));
            self.1.post(Submit3dCompletion {
                key: r.key,
                exchange_sequence: 0,
                outcome: Ok(()),
                gpu_complete: true,
                applied_commands: 0,
                draws: 0,
            })?;
        }
        h.fail_begin.take().map_or(Ok(()), Err)
    }
    fn bind_scanout(&mut self, e: &Scanout3dEvent) -> Result<(), E> {
        let mut h = self.0.borrow_mut();
        if let Some(error) = h.fail_bind.take() {
            return Err(error);
        }
        h.binds.push(*e);
        Ok(())
    }
    fn begin_scanout(&mut self, r: &Scanout3dRequest) -> Result<(), E> {
        let mut h = self.0.borrow_mut();
        h.captures.push(*r);
        assert_eq!(self.1.inspect().active, Some(r.key));
        if h.immediate {
            self.1.post(Submit3dCompletion {
                key: r.key,
                exchange_sequence: 0,
                outcome: Ok(()),
                gpu_complete: true,
                applied_commands: 0,
                draws: 0,
            })?;
        }
        h.fail_begin.take().map_or(Ok(()), Err)
    }
    fn cancel_job(&mut self, k: Submit3dKey) -> Result<(), E> {
        self.0.borrow_mut().cancelled.push(k);
        Ok(())
    }
}
struct Q {
    machine: Machine,
    state: Rc<RefCell<GpuState>>,
    host: Rc<RefCell<Host>>,
    mail: Submit3dMailbox,
    frames: TestSink,
    base: u64,
    avail: u16,
    used: u16,
}
impl Q {
    fn new() -> Self {
        let mut machine = Machine::new(RAM);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let host = Rc::new(RefCell::new(Host::default()));
        let mail = Submit3dMailbox::new();
        let frames = TestSink::new();
        let (_, state) = machine
            .enable_virtio_gpu_scanout3d_proof(
                Box::new(frames.clone()),
                Box::new(Controls(host.clone())),
                Box::new(Jobs(host.clone(), mail.clone())),
                mail.clone(),
            )
            .unwrap();
        let base = Platform::virtio_base(machine.virtio_gpu().unwrap().0 as u64);
        machine
            .bus_mut()
            .store32(virt::KERNEL_BASE, 0x0000_006f)
            .unwrap();
        machine.hart_mut().regs.pc = virt::KERNEL_BASE;
        let mut q = Self {
            machine,
            state,
            host,
            mail,
            frames,
            base,
            avail: 0,
            used: 0,
        };
        #[cfg(feature = "gpu-trace")]
        q.state.borrow_mut().enable_command_trace();
        q.configure();
        q.negotiate();
        q
    }
    fn mmio(&mut self, at: u64, v: u32) {
        self.machine.bus_mut().store32(self.base + at, v).unwrap();
    }
    fn read_mmio(&mut self, at: u64) -> u32 {
        self.machine.bus_mut().load32(self.base + at).unwrap()
    }
    fn write(&mut self, addr: u64, b: &[u8]) {
        for (i, v) in b.iter().enumerate() {
            self.machine.bus_mut().store8(addr + i as u64, *v).unwrap();
        }
    }
    fn read(&mut self, addr: u64, n: usize) -> Vec<u8> {
        (0..n)
            .map(|i| self.machine.bus_mut().load8(addr + i as u64).unwrap())
            .collect()
    }
    fn configure(&mut self) {
        self.write(DESC, &[0; 4096]);
        self.write(AVAIL, &[0; 516]);
        self.write(USED, &[0; 2052]);
        self.avail = 0;
        self.used = 0;
        self.mmio(0x30, 0);
        self.mmio(0x38, 256);
        for (at, addr) in [(0x80, DESC), (0x90, AVAIL), (0xa0, USED)] {
            self.mmio(at, addr as u32);
            self.mmio(at + 4, (addr >> 32) as u32);
        }
        self.mmio(0x44, 1);
    }
    fn negotiate(&mut self) {
        self.mmio(0x70, 3);
        self.mmio(0x24, 0);
        self.mmio(0x20, 1);
        self.mmio(0x24, 1);
        self.mmio(0x20, 1);
        self.mmio(0x70, 11);
        self.mmio(0x70, 15);
    }
    fn run(&mut self) {
        assert_eq!(self.machine.run(1), RunOutcome::MaxInstrs);
    }
    fn descriptor(&mut self, id: u16, addr: u64, len: u32, flags: u16, next: u16) {
        let mut b = [0; 16];
        b[..8].copy_from_slice(&addr.to_le_bytes());
        put32(&mut b, 8, len);
        b[12..14].copy_from_slice(&flags.to_le_bytes());
        b[14..].copy_from_slice(&next.to_le_bytes());
        self.write(DESC + u64::from(id) * 16, &b);
    }
    fn enqueue_at(&mut self, request: &[u8], head: u16, req: u64, resp: u64, capacity: u32) {
        self.write(req, request);
        self.write(resp, &[0xa5; 64]);
        self.descriptor(head, req, request.len() as u32, 1, head + 1);
        self.descriptor(head + 1, resp, capacity, 2, 0);
        self.write(
            AVAIL + 4 + u64::from(self.avail % 256) * 2,
            &head.to_le_bytes(),
        );
        self.avail += 1;
        self.write(AVAIL + 2, &self.avail.to_le_bytes());
    }
    fn enqueue(&mut self, request: &[u8]) {
        self.enqueue_at(request, 0, REQUEST, RESPONSE, 24);
        self.mmio(0x50, 0);
    }
    fn used_idx(&mut self) -> u16 {
        self.machine.bus_mut().load16(USED + 2).unwrap()
    }
    fn sync(&mut self, request: &[u8], ty: u32) {
        self.enqueue(request);
        self.run();
        self.used += 1;
        assert_eq!(self.used_idx(), self.used);
        assert_eq!(self.read(RESPONSE, 24), reply(request, ty));
    }
    fn capture(&mut self, request: &[u8]) -> Scanout3dRequest {
        let before = self.host.borrow().captures.len();
        self.enqueue(request);
        self.run();
        assert_eq!(self.used_idx(), self.used);
        assert_eq!(self.host.borrow().captures.len(), before + 1);
        assert_eq!(self.read(RESPONSE, 24), vec![0xa5; 24]);
        let pending = self
            .state
            .borrow()
            .submit3d_snapshot()
            .unwrap()
            .pending
            .unwrap();
        assert_eq!(pending.context, None);
        self.host.borrow().captures.last().copied().unwrap()
    }
    fn finish(&mut self, request: &[u8], outcome: Result<(), E>) {
        let r = *self.host.borrow().captures.last().unwrap();
        self.mail
            .post(Submit3dCompletion {
                key: r.key,
                exchange_sequence: 0,
                outcome,
                gpu_complete: true,
                applied_commands: 0,
                draws: 0,
            })
            .unwrap();
        self.run();
        self.used += 1;
        assert_eq!(self.used_idx(), self.used);
        assert_eq!(
            self.read(RESPONSE, 24),
            reply(request, outcome.map_or_else(E::response_type, |()| 0x1100))
        );
        assert_eq!(self.mail.inspect().active, None);
    }
    fn record(&mut self, label: &str, request: &[u8]) {
        let ctl = self.state.borrow().control3d_snapshot().unwrap();
        let sub = self.state.borrow().submit3d_snapshot().unwrap();
        let scn = self.state.borrow().scanout3d_snapshot().unwrap();
        let used = self.used;
        eprintln!(
            "SCANOUT3D_PORTABLE_RECORD {{\"case\":{label:?},\"request\":{:?},\"response\":{:?},\"usedIndex\":{},\"ring\":{{\"descriptors\":{:?},\"avail\":{:?},\"used\":{:?}}},\"transportCanonical\":{:?},\"transportDigest\":{:?},\"submitCanonical\":{:?},\"submitDigest\":{:?},\"scanoutCanonical\":{:?},\"scanoutDigest\":{:?}}}",
            hex(request),
            hex(&self.read(RESPONSE, 24)),
            used,
            hex(&self.read(DESC, 32)),
            hex(&self.read(AVAIL, 520)),
            hex(&self.read(USED, 2056)),
            hex(&ctl.canonical_bytes()),
            ctl.hex_digest(),
            hex(&sub.canonical_bytes()),
            sub.hex_digest(),
            hex(&scn.canonical_bytes()),
            scn.hex_digest()
        );
    }
}
fn texture(id: u32, w: u32, h: u32) -> Vec<u8> {
    let mut b = packet(0x204, 0, 72);
    for (i, v) in [id, 2, 67, 10, w, h, 1, 1, 0, 0, 0, 0]
        .into_iter()
        .enumerate()
    {
        put32(&mut b, 24 + 4 * i, v);
    }
    b
}
fn display(op: u32, id: u32, w: u32, h: u32) -> Vec<u8> {
    let mut b = packet(op, 0, 48);
    put32(&mut b, 32, w);
    put32(&mut b, 36, h);
    put32(&mut b, if op == 0x103 { 44 } else { 40 }, id);
    b
}
fn create2d() -> Vec<u8> {
    let mut b = packet(0x101, 0, 40);
    for (at, v) in [(24, 4), (28, 2), (32, 2), (36, 1)] {
        put32(&mut b, at, v);
    }
    b
}
#[test]
fn scanout3d_portable_global_capture_retention_and_2d_switch() {
    let mut q = Q::new();
    let resource = texture(3, 2, 2);
    q.sync(&resource, 0x1100);
    q.record("resource", &resource);
    let bind = fence(display(0x103, 3, 2, 2), u64::MAX);
    q.sync(&bind, 0x1100);
    q.record("bind", &bind);
    let accepted = q
        .state
        .borrow()
        .scanout3d_snapshot()
        .unwrap()
        .binding
        .unwrap();
    let capture = fence(display(0x104, 3, 2, 2), u64::MAX);
    let r = q.capture(&capture);
    assert_eq!(r.binding, accepted);
    assert_eq!(r.header.fence_id, u64::MAX);
    q.finish(&capture, Ok(()));
    q.record("capture", &capture);
    #[cfg(feature = "gpu-trace")]
    {
        let trace = q.state.borrow().command_trace();
        let t = trace.last().unwrap();
        assert_eq!(
            (
                t.command_type,
                t.resource_id,
                t.scanout,
                t.resource_width,
                t.resource_height
            ),
            (0x104, Some(3), Some(0), Some(2), Some(2))
        );
        assert_eq!(t.fence_id, Some(u64::MAX));
        assert_eq!(t.submit_sequence, Some(1));
    }
    let unref = id_command(0x102, 0, 3);
    q.sync(&unref, 0x1100);
    q.record("unref", &unref);
    assert_eq!(
        q.state.borrow().scanout3d_snapshot().unwrap().binding,
        Some(accepted)
    );
    let reuse = texture(3, 1, 2);
    q.sync(&reuse, 0x1100);
    q.record("reuse", &reuse);
    let stale = display(0x104, 3, 1, 2);
    q.sync(&stale, 0x1205);
    q.record("stale-capture", &stale);
    let rebind = display(0x103, 3, 1, 2);
    q.sync(&rebind, 0x1100);
    q.record("rebind", &rebind);
    let newbinding = q
        .state
        .borrow()
        .scanout3d_snapshot()
        .unwrap()
        .binding
        .unwrap();
    assert_ne!(newbinding.target, accepted.target);
    assert_eq!(newbinding.generation, 2);
    let capture = display(0x104, 3, 1, 2);
    q.capture(&capture);
    q.finish(&capture, Ok(()));
    q.record("recapture", &capture);
    let resource = create2d();
    q.sync(&resource, 0x1100);
    q.record("resource2d", &resource);
    let bind = display(0x103, 4, 2, 1);
    q.sync(&bind, 0x1100);
    q.record("bind2d", &bind);
    let flush = display(0x104, 4, 2, 1);
    q.sync(&flush, 0x1100);
    q.record("flush2d", &flush);
    assert_eq!(q.frames.records().len(), 1);
    assert_eq!(q.frames.records()[0].scanout, Some(0));
    let disable = display(0x103, 0, 0, 0);
    q.sync(&disable, 0x1100);
    q.record("disable", &disable);
    let s = q.state.borrow().scanout3d_snapshot().unwrap();
    assert_eq!(
        s.counters,
        Scanout3dCounters {
            bindings: 4,
            captures_admitted: 2,
            captures_completed: 2,
            captures_failed: 0,
            accepted_bytes: 24,
            completed_bytes: 24
        }
    );
    assert_eq!(s.binding.unwrap().target, Scanout3dTarget::Disabled);
    assert_eq!(q.state.borrow().scanout_resource, None);
}
#[test]
fn scanout3d_binding_validation_and_failure_are_atomic() {
    let mut q = Q::new();
    q.sync(&texture(3, 2, 2), 0x1100);
    q.sync(&display(0x103, 3, 2, 2), 0x1100);
    let before = q.state.borrow().scanout3d_snapshot().unwrap();
    let mut bad = Vec::new();
    for (at, v) in [
        (4, 2),
        (16, 2),
        (20, 1),
        (24, 1),
        (28, 1),
        (32, 1),
        (36, 1),
        (40, 1),
    ] {
        let mut b = display(0x103, 3, 2, 2);
        put32(&mut b, at, v);
        bad.push(b);
    }
    let mut b = display(0x103, 3, 2, 2);
    b.push(0);
    bad.push(b);
    let mut b = display(0x103, 3, 2, 2);
    b.pop();
    bad.push(b);
    for b in bad {
        q.sync(&b, 0x1205);
        assert_eq!(q.state.borrow().scanout3d_snapshot().unwrap(), before);
    }
    q.sync(&display(0x103, 99, 2, 2), 0x1203);
    let mut buffer = texture(7, 16, 1);
    put32(&mut buffer, 28, 0);
    put32(&mut buffer, 32, 64);
    put32(&mut buffer, 36, 16);
    q.sync(&buffer, 0x1100);
    q.sync(&display(0x103, 7, 16, 1), 0x1205);
    for error in [E::InvalidResourceId, E::OutOfMemory, E::Unspecified] {
        q.host.borrow_mut().fail_bind = Some(error);
        q.sync(&display(0x103, 3, 2, 2), error.response_type());
        assert_eq!(q.state.borrow().scanout3d_snapshot().unwrap(), before);
    }
    for capacity in 1..24 {
        let b = display(0x103, 0, 0, 0);
        q.enqueue_at(&b, 0, REQUEST, RESPONSE, capacity);
        q.mmio(0x50, 0);
        q.run();
        q.used += 1;
        assert_eq!(q.used_idx(), q.used);
        assert_eq!(q.read(RESPONSE, 24), vec![0xa5; 24]);
        assert_eq!(q.state.borrow().scanout3d_snapshot().unwrap(), before);
    }
    // Disable ignores its otherwise nonsensical rectangle, as ordinary 2D does.
    let mut b = display(0x103, 0, u32::MAX, u32::MAX);
    put32(&mut b, 24, u32::MAX);
    q.sync(&b, 0x1100);
    assert_eq!(q.host.borrow().binds.last().unwrap().binding.rect.width, 0);
}
#[test]
fn scanout3d_capture_has_no_context_dma_authority_and_rejects_bad_completion() {
    let mut q = Q::new();
    q.sync(&texture(3, 2, 2), 0x1100);
    q.sync(&display(0x104, 3, 2, 2), 0x1205);
    q.sync(&display(0x103, 3, 2, 2), 0x1100);
    for (at, v) in [
        (4, 2),
        (16, 2),
        (20, 1),
        (24, 1),
        (28, 1),
        (32, 1),
        (36, 1),
        (44, 1),
    ] {
        let mut b = display(0x104, 3, 2, 2);
        put32(&mut b, at, v);
        q.sync(&b, 0x1205);
    }
    let b = display(0x104, 3, 2, 2);
    let r = q.capture(&b);
    let Scanout3dTarget::Renderer { resource, .. } = r.binding.target else {
        panic!("renderer");
    };
    let ex = Submit3dExchange {
        key: r.key,
        exchange_sequence: 1,
        backing: Submit3dBacking {
            resource,
            generation: 1,
        },
        rows: Submit3dRows {
            offset: 0,
            row_bytes: 4,
            row_stride: 4,
            row_count: 1,
        },
    };
    assert_eq!(q.machine.submit3d_gather(&ex), Err(E::InvalidParameter));
    assert_eq!(
        q.machine.submit3d_scatter(&ex, &[0; 4]),
        Err(E::InvalidParameter)
    );
    for (exchange_sequence, applied_commands, draws) in [(1, 0, 0), (0, 1, 0), (0, 0, 1)] {
        assert_eq!(
            q.mail.post(Submit3dCompletion {
                key: r.key,
                exchange_sequence,
                outcome: Ok(()),
                gpu_complete: true,
                applied_commands,
                draws
            }),
            Err(E::InvalidParameter)
        );
    }
    q.finish(&b, Ok(()));
    q.sync(&id_command(0x102, 0, 3), 0x1100);
    q.sync(&b, 0x1203);
    // Retained binding cannot confer ordinary rendering context membership.
    let mut submit = packet(0x207, 0, 32);
    q.sync(&submit, 0x1204);
    put32(&mut submit, 16, 2);
    q.sync(&submit, 0x1204);
}
#[test]
fn scanout3d_ordering_reset_queue_revocation_and_host_failures() {
    let mut q = Q::new();
    q.sync(&texture(3, 2, 2), 0x1100);
    q.sync(&display(0x103, 3, 2, 2), 0x1100);
    let flush = fence(display(0x104, 3, 2, 2), 17);
    let r = q.capture(&flush);
    let disable = display(0x103, 0, 0, 0);
    q.enqueue_at(&disable, 2, REQUEST + 0x100, RESPONSE + 0x100, 24);
    q.mmio(0x50, 0);
    q.run();
    assert_eq!(q.used_idx(), q.used);
    assert_eq!(q.host.borrow().binds.len(), 1);
    // Mutation after admission does not redirect the fence/response/capture identity.
    q.write(REQUEST, &[0xff; 48]);
    q.descriptor(0, REQUEST + 0x800, 48, 1, 1);
    q.mail
        .post(Submit3dCompletion {
            key: r.key,
            exchange_sequence: 0,
            outcome: Ok(()),
            gpu_complete: true,
            applied_commands: 0,
            draws: 0,
        })
        .unwrap();
    q.run();
    q.used += 2;
    assert_eq!(q.used_idx(), q.used);
    assert_eq!(q.read(RESPONSE, 24), reply(&flush, 0x1100));
    assert_eq!(q.read(RESPONSE + 0x100, 24), reply(&disable, 0x1100));
    assert_eq!(q.host.borrow().binds.len(), 2);
    q.sync(&display(0x103, 3, 2, 2), 0x1100);
    let generation = q
        .state
        .borrow()
        .scanout3d_snapshot()
        .unwrap()
        .next_generation;
    let r = q.capture(&flush);
    q.mmio(0x70, 0);
    q.run();
    assert!(q.host.borrow().cancelled.contains(&r.key));
    assert_eq!(q.state.borrow().scanout3d_snapshot().unwrap().binding, None);
    assert_eq!(
        q.state
            .borrow()
            .scanout3d_snapshot()
            .unwrap()
            .next_generation,
        generation
    );
    assert_eq!(
        q.mail.post(Submit3dCompletion {
            key: r.key,
            exchange_sequence: 0,
            outcome: Ok(()),
            gpu_complete: true,
            applied_commands: 0,
            draws: 0
        }),
        Err(E::InvalidParameter)
    );
    q.configure();
    q.negotiate();
    q.sync(&texture(3, 2, 2), 0x1100);
    q.sync(&display(0x103, 3, 2, 2), 0x1100);
    q.host.borrow_mut().fail_begin = Some(E::OutOfMemory);
    q.capture(&flush);
    q.run();
    q.used += 1;
    assert_eq!(q.read(RESPONSE, 24), reply(&flush, 0x1201));
    assert_eq!(
        q.state
            .borrow()
            .scanout3d_snapshot()
            .unwrap()
            .counters
            .captures_failed,
        1
    );
    q.host.borrow_mut().immediate = true;
    q.capture(&flush);
    q.run();
    q.used += 1;
    assert_eq!(q.read(RESPONSE, 24), reply(&flush, 0x1100));
    q.host.borrow_mut().immediate = false;
    let r = q.capture(&flush);
    q.mmio(0x44, 0);
    q.mmio(0x44, 1);
    q.run();
    assert!(q.host.borrow().cancelled.contains(&r.key));
    assert_eq!(q.read_mmio(0x70) & 64, 64);
    assert!(q.state.borrow().control3d_snapshot().unwrap().poisoned);
}
#[test]
fn scanout3d_global_binding_survives_context_destroy_and_poison_requires_reset() {
    let mut q = Q::new();
    q.sync(&packet(0x200, 2, 96), 0x1100);
    q.sync(&texture(3, 2, 2), 0x1100);
    q.sync(&id_command(0x202, 2, 3), 0x1100);
    q.sync(&display(0x103, 3, 2, 2), 0x1100);
    q.sync(&packet(0x201, 2, 24), 0x1100);
    let b = display(0x104, 3, 2, 2);
    q.capture(&b);
    q.finish(&b, Ok(()));
    q.host.borrow_mut().fail_bind = Some(E::BridgePoisoned);
    let before = q.state.borrow().scanout3d_snapshot().unwrap();
    q.sync(&display(0x103, 0, 0, 0), 0x1200);
    assert_eq!(q.state.borrow().scanout3d_snapshot().unwrap(), before);
    q.sync(&b, 0x1200);
    q.sync(&display(0x103, 3, 2, 2), 0x1200);
    assert!(q.state.borrow().control3d_snapshot().unwrap().poisoned);
    // Snapshot cannot silently omit retained renderer/display ownership.
    assert!(q.state.borrow().to_snapshot().is_err());
}

#[test]
fn scanout3d_ordinary_2d_unref_reuse_preserves_unbound_flush_contract() {
    let mut q = Q::new();
    q.sync(&create2d(), 0x1100);
    q.sync(&display(0x103, 4, 2, 1), 0x1100);
    let accepted = q.state.borrow().scanout3d_snapshot().unwrap().binding;
    q.sync(&display(0x104, 4, 2, 1), 0x1100);
    assert_eq!(q.frames.records().last().unwrap().scanout, Some(0));
    q.sync(&id_command(0x102, 0, 4), 0x1100);
    assert_eq!(q.state.borrow().scanout_resource, None);
    assert_eq!(
        q.state.borrow().scanout3d_snapshot().unwrap().binding,
        accepted
    );
    q.sync(&create2d(), 0x1100);
    q.sync(&display(0x104, 4, 2, 1), 0x1100);
    assert_eq!(q.frames.records().last().unwrap().scanout, None);
    assert_eq!(q.host.borrow().binds.len(), 1);
    // Existing valid subrectangles remain legal for a 2D binding and flush.
    q.sync(&display(0x103, 4, 1, 1), 0x1100);
    q.sync(&display(0x104, 4, 1, 1), 0x1100);
    assert_eq!(q.frames.records().last().unwrap().scanout, Some(0));
    assert_eq!(q.host.borrow().captures.len(), 0);
    // These ignored legacy fields remain ignored for TwoD and disable only.
    for id in [4, 0] {
        let mut legacy = display(0x103, id, 1, 1);
        put32(&mut legacy, 4, 2);
        put32(&mut legacy, 16, 123);
        put32(&mut legacy, 20, 0x1234_5678);
        legacy.extend_from_slice(&[0xff; 7]);
        q.sync(&legacy, 0x1100);
    }
}
