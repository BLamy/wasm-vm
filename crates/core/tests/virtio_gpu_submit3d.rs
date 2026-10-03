//! Literal queue packets at the actual Machine service boundary. Native sinks
//! control completion scheduling; the browser corpus supplies actual GPU work.
#![cfg(all(feature = "virgl-control-proof", not(feature = "zicsr-stub")))]
use std::{cell::RefCell, rc::Rc};
use wasm_vm_core::dev::virtio::gpu::{
    GpuState, NullSink,
    control3d::{Control3dError as E, Control3dEvent, Control3dSink},
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
const BACKING: u64 = virt::DRAM_BASE + 0x20000;
const BACKING2: u64 = virt::DRAM_BASE + 0x30000;
fn put32(b: &mut [u8], at: usize, v: u32) {
    b[at..at + 4].copy_from_slice(&v.to_le_bytes());
}
fn packet(op: u32, ctx: u32, len: usize) -> Vec<u8> {
    let mut b = vec![0; len];
    put32(&mut b, 0, op);
    put32(&mut b, 16, ctx);
    b
}
fn context() -> Vec<u8> {
    packet(0x200, 2, 96)
}
fn resource() -> Vec<u8> {
    let mut b = packet(0x204, 0, 72);
    for (i, v) in [3, 0, 64, 16, 16, 1, 1, 1, 0, 0, 0, 0]
        .into_iter()
        .enumerate()
    {
        put32(&mut b, 24 + 4 * i, v);
    }
    b
}
fn id_command(op: u32, ctx: u32, id: u32) -> Vec<u8> {
    let mut b = packet(op, ctx, 32);
    put32(&mut b, 24, id);
    b
}
fn backing() -> Vec<u8> {
    let mut b = id_command(0x106, 0, 3);
    put32(&mut b, 28, 2);
    for (addr, len) in [(BACKING, 7u32), (BACKING2, 25)] {
        b.extend_from_slice(&addr.to_le_bytes());
        b.extend_from_slice(&len.to_le_bytes());
        b.extend_from_slice(&[0; 4]);
    }
    b
}
fn fence(mut b: Vec<u8>, id: u64) -> Vec<u8> {
    put32(&mut b, 4, 1);
    b[8..16].copy_from_slice(&id.to_le_bytes());
    b
}
fn submit(payload: &[u8], id: u64) -> Vec<u8> {
    let mut b = packet(0x207, 2, 32);
    put32(&mut b, 24, payload.len() as u32);
    b.extend_from_slice(payload);
    fence(b, id)
}
fn transfer(read: bool, offset: u64, id: u64) -> Vec<u8> {
    let mut b = packet(if read { 0x206 } else { 0x205 }, 2, 72);
    for (at, v) in [(36, 8), (40, 1), (44, 1), (56, 3)] {
        put32(&mut b, at, v);
    }
    b[48..56].copy_from_slice(&offset.to_le_bytes());
    fence(b, id)
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
        let (_, state) = machine
            .enable_virtio_gpu_submit3d_proof(
                Box::new(NullSink),
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
    fn setup(&mut self) {
        for p in [context(), resource(), backing(), id_command(0x202, 2, 3)] {
            self.sync(&p, 0x1100);
        }
    }
    fn work(&self) -> Submit3dRequest {
        self.host.borrow().work.last().unwrap().clone()
    }
    fn begin(&mut self, request: &[u8]) -> Submit3dRequest {
        let before = self.host.borrow().work.len();
        self.enqueue(request);
        self.run();
        assert_eq!(self.used_idx(), self.used);
        assert_eq!(self.host.borrow().work.len(), before + 1);
        assert_eq!(self.read(RESPONSE, 24), vec![0xa5; 24]);
        self.work()
    }
    fn completion(&self, outcome: Result<(), E>, gpu: bool) -> Submit3dCompletion {
        Submit3dCompletion {
            key: self.work().key,
            exchange_sequence: self.mail.inspect().last_exchange,
            outcome,
            gpu_complete: gpu,
            applied_commands: u32::from(matches!(self.work().kind, Submit3dKind::Transfer(_))),
            draws: 0,
        }
    }
    fn finish(&mut self, request: &[u8], outcome: Result<(), E>) {
        let c = self.completion(outcome, true);
        self.mail.post(c).unwrap();
        self.run();
        self.used += 1;
        assert_eq!(self.used_idx(), self.used);
        assert_eq!(
            self.read(RESPONSE, 24),
            reply(request, outcome.map_or_else(E::response_type, |()| 0x1100))
        );
        assert!(!self.mail.inspect().ready);
    }
    fn exchange(&self, seq: u64, offset: u64, n: u32) -> Submit3dExchange {
        let r = self.work();
        let res = &r.resources[0];
        Submit3dExchange {
            key: r.key,
            exchange_sequence: seq,
            backing: Submit3dBacking {
                resource: res.identity,
                generation: res.backing.unwrap().generation,
            },
            rows: Submit3dRows {
                offset,
                row_bytes: n,
                row_stride: n,
                row_count: 1,
            },
        }
    }
    fn record(&mut self, label: &str, request: &[u8]) {
        let ctl = self.state.borrow().control3d_snapshot().unwrap();
        let sub = self.state.borrow().submit3d_snapshot().unwrap();
        let used = self.used;
        eprintln!(
            "SUBMIT3D_PORTABLE_RECORD {{\"case\":{label:?},\"request\":{:?},\"response\":{:?},\"usedIndex\":{},\"ring\":{{\"descriptors\":{:?},\"avail\":{:?},\"used\":{:?}}},\"transportCanonical\":{:?},\"transportDigest\":{:?},\"submitCanonical\":{:?},\"submitDigest\":{:?}}}",
            hex(request),
            hex(&self.read(RESPONSE, 24)),
            used,
            hex(&self.read(DESC, 32)),
            hex(&self.read(AVAIL, 520)),
            hex(&self.read(USED, 2056)),
            hex(&ctl.canonical_bytes()),
            ctl.hex_digest(),
            hex(&sub.canonical_bytes()),
            sub.hex_digest()
        );
    }
}

#[test]
fn submit3d_portable_fresh_dma_fences_and_destroy() {
    let mut q = Q::new();
    for (label, p) in [
        ("context", context()),
        ("resource", resource()),
        ("backing", backing()),
        ("attach", id_command(0x202, 2, 3)),
    ] {
        q.sync(&p, 0x1100);
        q.record(label, &p);
    }
    let fresh: Vec<u8> = (0..32).collect();
    q.write(BACKING, &fresh[..7]);
    q.write(BACKING2, &fresh[7..]);
    let upload = transfer(false, 4, u64::MAX);
    q.begin(&upload);
    let input = q.machine.submit3d_gather(&q.exchange(1, 4, 8)).unwrap();
    assert_eq!(input, (4..12).collect::<Vec<u8>>());
    q.finish(&upload, Ok(()));
    q.record("upload", &upload);
    let readback = transfer(true, 8, 7);
    q.begin(&readback);
    q.machine
        .submit3d_scatter(&q.exchange(1, 8, 8), &input)
        .unwrap();
    assert_eq!(q.used_idx(), q.used, "output before used publication");
    q.finish(&readback, Ok(()));
    q.record("readback", &readback);
    let mut expected = fresh.clone();
    expected[8..16].copy_from_slice(&input);
    let mut actual = q.read(BACKING, 7);
    actual.extend(q.read(BACKING2, 25));
    assert_eq!(actual, expected);
    let empty = submit(&[], 7);
    q.begin(&empty);
    q.finish(&empty, Ok(()));
    q.record("submit", &empty);
    let destroy = fence(packet(0x201, 2, 24), 0);
    q.sync(&destroy, 0x1100);
    q.record("destroy", &destroy);
    let s = q.state.borrow().submit3d_snapshot().unwrap();
    assert_eq!(
        (
            s.counters.admitted,
            s.counters.completed,
            s.counters.fenced,
            s.counters.input_bytes,
            s.counters.output_bytes
        ),
        (3, 3, 3, 8, 8)
    );
    assert!(s.pending.is_none());
}

#[test]
fn submit3d_hundred_heads_ordered_with_duplicate_fences_and_cursor_progress() {
    let mut q = Q::new();
    q.sync(&context(), 0x1100);
    q.mmio(0x64, 3);
    let mut requests = Vec::new();
    for i in 0..100u16 {
        let p = submit(
            &[],
            match i % 4 {
                0 => u64::MAX,
                1 => 7,
                2 => 7,
                _ => 0,
            },
        );
        q.enqueue_at(
            &p,
            i * 2,
            virt::DRAM_BASE + 0x80000 + u64::from(i) * 256,
            virt::DRAM_BASE + 0xc0000 + u64::from(i) * 64,
            24,
        );
        requests.push(p);
    }
    let destroy = fence(packet(0x201, 2, 24), 1);
    q.enqueue_at(
        &destroy,
        200,
        virt::DRAM_BASE + 0x87000,
        virt::DRAM_BASE + 0xc2000,
        24,
    );
    q.mmio(0x50, 0);
    q.run();
    for (i, request) in requests.iter().enumerate() {
        let w = q.work();
        assert_eq!(w.key.sequence, i as u64 + 1);
        assert_eq!(
            w.header.fence_id,
            u64::from_le_bytes(request[8..16].try_into().unwrap())
        );
        let before = q.used_idx();
        for _ in 0..(i % 5 + 1) {
            q.run();
        }
        assert_eq!(q.used_idx(), before, "pending work is idle");
        assert_eq!(q.host.borrow().work.len(), i + 1);
        if i == 0 {
            // Cursor queue stays serviceable while controlq is parked. Literal MOVE_CURSOR.
            let cursor_desc = virt::DRAM_BASE + 0x9000;
            let cursor_avail = virt::DRAM_BASE + 0xa000;
            let cursor_used = virt::DRAM_BASE + 0xb000;
            let cursor_req = virt::DRAM_BASE + 0xd000;
            let mut b = packet(0x301, 0, 40);
            put32(&mut b, 28, 7);
            put32(&mut b, 32, 9);
            q.write(cursor_req, &b);
            let mut d = [0; 16];
            d[..8].copy_from_slice(&cursor_req.to_le_bytes());
            put32(&mut d, 8, 40);
            q.write(cursor_desc, &d);
            q.write(cursor_avail, &[0; 8]);
            q.write(cursor_avail + 2, &1u16.to_le_bytes());
            q.write(cursor_used, &[0; 20]);
            q.mmio(0x30, 1);
            q.mmio(0x38, 2);
            for (at, a) in [
                (0x80, cursor_desc),
                (0x90, cursor_avail),
                (0xa0, cursor_used),
            ] {
                q.mmio(at, a as u32);
                q.mmio(at + 4, (a >> 32) as u32);
            }
            q.mmio(0x44, 1);
            q.mmio(0x50, 1);
            q.run();
            assert_eq!(q.machine.bus_mut().load16(cursor_used + 2).unwrap(), 1);
            assert_eq!(q.used_idx(), before);
            q.mmio(0x30, 0);
        }
        q.mail.post(q.completion(Ok(()), true)).unwrap();
        q.run();
        q.used += 1;
        assert_eq!(
            q.read(virt::DRAM_BASE + 0xc0000 + i as u64 * 64, 24),
            reply(request, 0x1100)
        );
        assert_eq!(q.used_idx(), q.used + u16::from(i == 99));
    }
    assert_eq!(
        q.read(virt::DRAM_BASE + 0xc2000, 24),
        reply(&destroy, 0x1100)
    );
    assert!(
        q.state
            .borrow()
            .control3d_snapshot()
            .unwrap()
            .contexts
            .is_empty()
    );
    let s = q.state.borrow().submit3d_snapshot().unwrap();
    assert_eq!(
        (
            s.counters.admitted,
            s.counters.completed,
            s.counters.cancelled
        ),
        (100, 100, 0)
    );
    #[cfg(feature = "gpu-trace")]
    {
        let trace = q.state.borrow().command_trace().to_vec();
        let jobs: Vec<_> = trace.iter().filter(|r| r.command_type == 0x207).collect();
        assert_eq!(jobs.len(), 100);
        for (i, r) in jobs.iter().enumerate() {
            assert_eq!(r.submit_sequence, Some(i as u64 + 1));
            assert_eq!(
                r.fence_id,
                Some(u64::from_le_bytes(requests[i][8..16].try_into().unwrap()))
            );
        }
    }
}

#[test]
fn submit3d_owned_requests_mailbox_validation_and_immediate_completion() {
    let mut q = Q::new();
    q.setup();
    let p = submit(&[1, 2, 3, 4], 0x1234_5678_9abc_def0);
    let work = q.begin(&p);
    q.write(REQUEST, &[0xff; 36]);
    q.descriptor(1, RESPONSE + 32, 24, 2, 0);
    assert_eq!(work.kind, Submit3dKind::Commands(vec![1, 2, 3, 4]));
    let mut c = q.completion(Ok(()), true);
    c.key.sequence += 1;
    assert_eq!(q.mail.post(c), Err(E::InvalidParameter));
    c = q.completion(Ok(()), true);
    c.exchange_sequence = 1;
    assert_eq!(q.mail.post(c), Err(E::InvalidParameter));
    c = q.completion(Ok(()), false);
    assert_eq!(q.mail.post(c), Err(E::InvalidParameter));
    c = q.completion(Ok(()), true);
    c.draws = 65;
    assert_eq!(q.mail.post(c), Err(E::InvalidParameter));
    c = q.completion(Ok(()), true);
    c.applied_commands = 4097;
    assert_eq!(q.mail.post(c), Err(E::InvalidParameter));
    let c = q.completion(Ok(()), true);
    q.mail.post(c).unwrap();
    assert_eq!(q.mail.post(c), Err(E::InvalidParameter));
    assert_eq!(
        q.machine.submit3d_gather(&q.exchange(1, 0, 1)),
        Err(E::InvalidParameter)
    );
    q.run();
    q.used += 1;
    assert_eq!(q.read(RESPONSE, 24), reply(&p, 0x1100));
    assert_eq!(q.read(RESPONSE + 32, 24), vec![0xa5; 24]);
    assert_eq!(q.mail.post(c), Err(E::InvalidParameter));
    q.host.borrow_mut().immediate = true;
    let p = submit(&[], 0);
    q.enqueue(&p);
    q.run();
    assert!(q.mail.inspect().ready);
    q.run();
    q.used += 1;
    assert_eq!(q.used_idx(), q.used);
    assert_eq!(q.read(RESPONSE, 24), reply(&p, 0x1100));
}

#[test]
fn submit3d_dma_identity_bounds_padding_and_uncertain_post_scatter() {
    let mut q = Q::new();
    q.setup();
    let p = submit(&[], 0);
    q.begin(&p);
    q.write(BACKING, &[0x55; 7]);
    q.write(BACKING2, &[0x55; 25]);
    let valid = q.exchange(1, 5, 3);
    let mut variants = Vec::new();
    let mut e = valid;
    e.key.epoch += 1;
    variants.push(e);
    let mut e = valid;
    e.exchange_sequence = 2;
    variants.push(e);
    let mut e = valid;
    e.backing.generation += 1;
    variants.push(e);
    let mut e = valid;
    e.backing.resource.generation += 1;
    variants.push(e);
    let mut e = valid;
    e.rows.offset = u64::MAX;
    variants.push(e);
    let mut e = valid;
    e.rows.row_count = 16385;
    variants.push(e);
    let mut e = valid;
    e.rows.row_stride = 2;
    variants.push(e);
    let mut e = valid;
    e.rows.row_bytes = 0;
    variants.push(e);
    for e in variants {
        assert!(q.machine.submit3d_scatter(&e, &[1, 2, 3]).is_err());
        assert_eq!(q.mail.inspect().last_exchange, 0);
        assert_eq!(q.read(BACKING, 7), vec![0x55; 7]);
        assert_eq!(q.read(BACKING2, 25), vec![0x55; 25]);
    }
    assert!(q.machine.submit3d_scatter(&valid, &[1, 2]).is_err());
    let rows = Submit3dExchange {
        rows: Submit3dRows {
            offset: 5,
            row_bytes: 3,
            row_stride: 7,
            row_count: 3,
        },
        ..valid
    };
    q.machine
        .submit3d_scatter(&rows, &[1, 2, 3, 4, 5, 6, 7, 8, 9])
        .unwrap();
    assert!(q.machine.submit3d_scatter(&rows, &[1; 9]).is_err());
    let mut actual = q.read(BACKING, 7);
    actual.extend(q.read(BACKING2, 25));
    let mut expected = vec![0x55; 32];
    expected[5..8].copy_from_slice(&[1, 2, 3]);
    expected[12..15].copy_from_slice(&[4, 5, 6]);
    expected[19..22].copy_from_slice(&[7, 8, 9]);
    assert_eq!(actual, expected);
    let mut poison = q.completion(Err(E::BridgePoisoned), false);
    poison.exchange_sequence = 0;
    q.mail.post(poison).unwrap();
    q.run();
    q.used += 1;
    assert_eq!(q.read(RESPONSE, 24), reply(&p, 0x1200));
    assert!(q.state.borrow().control3d_snapshot().unwrap().poisoned);
    assert!(q.machine.submit3d_gather(&q.exchange(2, 0, 1)).is_err());
}

#[test]
fn submit3d_reset_and_queue_rewrite_revoke_before_any_late_write() {
    for via_dma in [false, true] {
        let mut q = Q::new();
        q.setup();
        let p = submit(&[], u64::MAX);
        q.begin(&p);
        let late = q.completion(Ok(()), true);
        let ex = q.exchange(1, 0, 4);
        let ring = q.read(USED, 2052);
        let response = q.read(RESPONSE, 64);
        q.mmio(0x44, 0);
        q.mmio(0x44, 1);
        if via_dma {
            assert_eq!(
                q.machine.submit3d_scatter(&ex, &[1, 2, 3, 4]),
                Err(E::BridgePoisoned)
            );
        } else {
            q.run();
        }
        assert_eq!(q.mail.post(late), Err(E::InvalidParameter));
        assert_eq!(q.read(USED, 2052), ring);
        assert_eq!(q.read(RESPONSE, 64), response);
        assert_eq!(q.host.borrow().cancelled.len(), 1);
        assert!(q.state.borrow().control3d_snapshot().unwrap().poisoned);
        assert_ne!(q.read_mmio(0x70) & 64, 0);
    }
    let mut q = Q::new();
    q.setup();
    let p = submit(&[], 0);
    q.begin(&p);
    let late = q.completion(Ok(()), true);
    let old_epoch = late.key.epoch;
    let ring = q.read(USED, 2052);
    q.mmio(0x70, 0);
    assert_eq!(q.mail.post(late), Err(E::InvalidParameter));
    assert_eq!(q.read(USED, 2052), ring);
    assert_eq!(q.host.borrow().cancelled.len(), 1);
    q.configure();
    q.negotiate();
    q.sync(&context(), 0x1100);
    let p = submit(&[], 0);
    let next = q.begin(&p);
    assert!(next.key.epoch > old_epoch);
    assert_eq!(q.mail.post(late), Err(E::InvalidParameter));
    q.finish(&p, Ok(()));
}

#[test]
fn submit3d_wire_preflight_host_errors_and_recovery() {
    let mut q = Q::new();
    q.setup();
    let mut invalid = Vec::new();
    let mut p = submit(&[], 0);
    p[4] = 2;
    invalid.push(p);
    let mut p = submit(&[], 0);
    p[20] = 1;
    invalid.push(p);
    let mut p = submit(&[], 0);
    p[21] = 1;
    invalid.push(p);
    let mut p = submit(&[], 0);
    p[28] = 1;
    invalid.push(p);
    let mut p = submit(&[], 0);
    put32(&mut p, 24, 4);
    invalid.push(p);
    let mut p = submit(&[1, 2, 3, 4], 0);
    put32(&mut p, 24, 3);
    invalid.push(p);
    let mut p = submit(&[], 0);
    put32(&mut p, 24, 262148);
    invalid.push(p);
    for offset in [u64::MAX, 1u64 << 32, 30] {
        invalid.push(transfer(false, offset, 0));
    }
    let mut p = transfer(false, 0, 0);
    put32(&mut p, 64, u32::MAX);
    put32(&mut p, 68, 1);
    invalid.push(p);
    let mut p = transfer(false, 0, 0);
    put32(&mut p, 40, 2);
    invalid.push(p);
    let mut p = transfer(false, 0, 0);
    put32(&mut p, 60, 1);
    invalid.push(p);
    let mut p = transfer(false, 0, 0);
    p.push(0);
    invalid.push(p);
    for p in invalid {
        let work = q.host.borrow().work.len();
        q.sync(&p, 0x1205);
        assert_eq!(q.host.borrow().work.len(), work);
    }
    for capacity in 1..24 {
        let p = submit(&[], 0);
        q.enqueue_at(&p, 0, REQUEST, RESPONSE, capacity);
        q.mmio(0x50, 0);
        q.run();
        q.used += 1;
        assert_eq!(q.used_idx(), q.used);
        assert_eq!(q.read(RESPONSE, 64), vec![0xa5; 64]);
    }
    let p = submit(&[], 0);
    q.host.borrow_mut().fail_begin = Some(E::OutOfMemory);
    q.begin(&p);
    q.run();
    q.used += 1;
    assert_eq!(q.read(RESPONSE, 24), reply(&p, 0x1201));
    assert!(!q.state.borrow().control3d_snapshot().unwrap().poisoned);
    q.begin(&p);
    q.finish(&p, Err(E::InvalidParameter));
    q.begin(&p);
    q.finish(&p, Ok(()));
    // A callback that posts success then throws cannot overwrite that uncertainty with success.
    q.host.borrow_mut().immediate = true;
    q.host.borrow_mut().fail_begin = Some(E::Unspecified);
    q.begin(&p);
    q.run();
    q.used += 1;
    assert_eq!(q.read(RESPONSE, 24), reply(&p, 0x1200));
    assert!(q.state.borrow().control3d_snapshot().unwrap().poisoned);
}

#[test]
fn submit3d_head_admission_preserves_prior_irq_and_snapshots_later_heads_late() {
    let mut q = Q::new();
    let create = context();
    let first = submit(&[1, 2, 3, 4], u64::MAX);
    let second = submit(&[5, 6, 7, 8], 7);
    q.enqueue_at(&create, 0, REQUEST, RESPONSE, 24);
    q.enqueue_at(&first, 2, REQUEST + 256, RESPONSE + 64, 24);
    q.enqueue_at(&second, 4, REQUEST + 512, RESPONSE + 128, 24);
    q.mmio(0x50, 0);
    q.run();
    assert_eq!(q.used_idx(), 1);
    assert_eq!(
        q.read_mmio(0x60) & 1,
        1,
        "prior synchronous completion IRQ survives parking"
    );
    assert_eq!(q.work().kind, Submit3dKind::Commands(vec![1, 2, 3, 4]));
    let replacement = submit(&[9, 10, 11, 12], 0);
    q.write(REQUEST + 512, &replacement);
    q.mail.post(q.completion(Ok(()), true)).unwrap();
    q.run();
    assert_eq!(q.used_idx(), 2);
    assert_eq!(q.work().kind, Submit3dKind::Commands(vec![9, 10, 11, 12]));
    assert_eq!(q.work().header.fence_id, 0);
    q.mail.post(q.completion(Ok(()), true)).unwrap();
    q.run();
    assert_eq!(q.used_idx(), 3);
    assert_eq!(q.read(RESPONSE + 64, 24), reply(&first, 0x1100));
    assert_eq!(q.read(RESPONSE + 128, 24), reply(&replacement, 0x1100));
}

#[test]
fn submit3d_strict_outer_texture_ranges_and_unpublishable_used_ring() {
    let mut q = Q::new();
    q.sync(&context(), 0x1100);
    let mut tex = resource();
    for (at, v) in [(28, 2), (32, 67), (36, 10), (40, 2), (44, 2)] {
        put32(&mut tex, at, v);
    }
    q.sync(&tex, 0x1100);
    q.sync(&backing(), 0x1100);
    q.sync(&id_command(0x202, 2, 3), 0x1100);
    let mut valid = transfer(false, 3, 0);
    put32(&mut valid, 36, 1);
    put32(&mut valid, 40, 2);
    let w = q.begin(&valid);
    assert!(matches!(
        w.kind,
        Submit3dKind::Transfer(Transfer3d { offset: 3, .. })
    ));
    let rows = Submit3dExchange {
        rows: Submit3dRows {
            offset: 3,
            row_bytes: 4,
            row_stride: 8,
            row_count: 2,
        },
        ..q.exchange(1, 3, 4)
    };
    assert_eq!(q.machine.submit3d_gather(&rows).unwrap(), [0; 8]);
    q.finish(&valid, Ok(()));
    for (at, v) in [
        (24, u32::MAX),
        (28, u32::MAX),
        (32, 1),
        (36, 0),
        (40, 0),
        (44, 2),
        (56, 99),
        (60, 1),
        (64, u32::MAX),
        (68, 1),
    ] {
        let mut p = valid.clone();
        put32(&mut p, at, v);
        q.sync(&p, if at == 56 { 0x1203 } else { 0x1205 });
    }
    let mut bad = submit(&[], 0);
    put32(&mut bad, 16, 0);
    q.sync(&bad, 0x1204);
    q.mmio(0x24, 0);
    q.mmio(0x20, 0);
    q.sync(&submit(&[], 0), 0x1200);
    q.mmio(0x20, 1);
    let calls = q.host.borrow().work.len();
    let used = q.used_idx();
    let invalid = virt::DRAM_BASE + RAM as u64 - 2;
    q.mmio(0xa0, invalid as u32);
    q.mmio(0xa4, (invalid >> 32) as u32);
    q.enqueue(&submit(&[], 0));
    q.run();
    assert_eq!(q.host.borrow().work.len(), calls);
    assert_eq!(q.used_idx(), used);
    assert_eq!(q.read(RESPONSE, 64), vec![0xa5; 64]);
    assert_ne!(q.read_mmio(0x70) & 64, 0);
}

#[test]
fn submit3d_span_dma_tracks_all_code_pages_once_and_rejects_before_mutation() {
    use wasm_vm_core::bus::BusFault;
    let mut q = Q::new();
    q.sync(&context(), 0x1100);
    const LENGTH: usize = 0x3008;
    let start = BACKING + 0xffd;
    let mut res = resource();
    put32(&mut res, 40, LENGTH as u32);
    q.sync(&res, 0x1100);
    let mut sg = id_command(0x106, 0, 3);
    put32(&mut sg, 28, 1);
    sg.extend_from_slice(&start.to_le_bytes());
    sg.extend_from_slice(&(LENGTH as u32).to_le_bytes());
    sg.extend_from_slice(&[0; 4]);
    q.sync(&sg, 0x1100);
    q.sync(&id_command(0x202, 2, 3), 0x1100);
    let p = submit(&[], 0);
    q.begin(&p);
    let bytes: Vec<u8> = (0..LENGTH).map(|i| (i % 251) as u8).collect();
    let exchange = q.exchange(1, 0, LENGTH as u32);
    q.machine.bus_mut().arm_code_write_tracking(true);
    assert_eq!(
        q.machine.submit3d_scatter(&exchange, &bytes[..LENGTH - 1]),
        Err(E::InvalidParameter)
    );
    assert!(q.machine.bus_mut().code_write_log_mut().is_empty());
    assert_eq!(q.read(start, LENGTH), vec![0; LENGTH]);
    let invalid = Submit3dExchange {
        rows: Submit3dRows {
            offset: 1,
            ..exchange.rows
        },
        ..exchange
    };
    assert_eq!(
        q.machine.submit3d_scatter(&invalid, &bytes),
        Err(E::InvalidParameter)
    );
    assert!(q.machine.bus_mut().code_write_log_mut().is_empty());
    assert_eq!(q.read(start, LENGTH), vec![0; LENGTH]);
    // The helper independently rejects RAM-edge, wrapping and MMIO spans before
    // touching memory or recording frames; empty writes record no page.
    let end = virt::DRAM_BASE + RAM as u64;
    for address in [end - 1, u64::MAX, 0x1000_0000] {
        assert_eq!(
            q.machine.bus_mut().write_ram_slice(address, &[0x99; 2]),
            Err(BusFault::Access)
        );
    }
    q.machine.bus_mut().write_ram_slice(end, &[]).unwrap();
    assert!(q.machine.bus_mut().code_write_log_mut().is_empty());
    assert_eq!(q.read(end - 1, 1), [0]);
    q.machine.submit3d_scatter(&exchange, &bytes).unwrap();
    assert_eq!(q.read(start, LENGTH), bytes);
    let pages: Vec<u64> = ((start >> 12)..=((start + LENGTH as u64 - 1) >> 12)).collect();
    assert_eq!(pages.len(), 5);
    assert_eq!(q.machine.bus_mut().code_write_log_mut(), &pages);
    let gather = Submit3dExchange {
        exchange_sequence: 2,
        ..exchange
    };
    assert_eq!(q.machine.submit3d_gather(&gather).unwrap(), bytes);
    assert_eq!(
        q.machine.bus_mut().code_write_log_mut(),
        &pages,
        "gather records no writes"
    );
    q.machine.bus_mut().arm_code_write_tracking(false);
    q.machine
        .bus_mut()
        .write_ram_slice(start, &[0x77; 3])
        .unwrap();
    assert!(q.machine.bus_mut().code_write_log_mut().is_empty());
    assert_eq!(q.read(start, 3), [0x77; 3]);
    q.finish(&p, Ok(()));
}
