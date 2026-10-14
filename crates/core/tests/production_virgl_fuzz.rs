//! Reproducible production transport properties. The sink controls retirement only;
//! requests, headers, backing admission and DMA all traverse Machine/MMIO/virtqueue.
#![cfg(all(feature = "virgl-renderer", not(feature = "zicsr-stub")))]

use sha2::{Digest, Sha256};
use std::{cell::RefCell, rc::Rc, time::Instant};
use wasm_vm_core::dev::virtio::gpu::{
    NullSink,
    capabilities::{FormatMask, HostLimits, QualifiedCapabilities},
    control3d::{Control3dError as E, Control3dEvent, Control3dSink},
    submit3d::*,
};
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::Bus,
    platform::{Platform, virt},
};

const RAM: usize = 8 * 1024 * 1024;
const DESC: u64 = virt::DRAM_BASE + 0x6000;
const AVAIL: u64 = virt::DRAM_BASE + 0x8000;
const USED: u64 = virt::DRAM_BASE + 0x9000;
const REQUEST: u64 = virt::DRAM_BASE + 0x10000;
const RESPONSE: u64 = virt::DRAM_BASE + 0x14000;
const BACKING: u64 = virt::DRAM_BASE + 0x20000;
const GUARD: [u8; 80] = [0xa5; 80];
const FAMILY_CASES: usize = 200_000;

fn word(b: &mut [u8], at: usize, v: u32) {
    b[at..at + 4].copy_from_slice(&v.to_le_bytes());
}
fn packet(op: u32, ctx: u32, n: usize) -> Vec<u8> {
    let mut b = vec![0; n];
    word(&mut b, 0, op);
    word(&mut b, 16, ctx);
    b
}
fn id_command(op: u32, id: u32) -> Vec<u8> {
    let mut b = packet(op, 0, 32);
    word(&mut b, 24, id);
    b
}
fn submit(payload: &[u8], fence: u64) -> Vec<u8> {
    let mut b = packet(0x207, 2, 32 + payload.len());
    word(&mut b, 4, 1);
    b[8..16].copy_from_slice(&fence.to_le_bytes());
    word(&mut b, 24, payload.len() as u32);
    b[32..].copy_from_slice(payload);
    b
}
fn backing(id: u32, entries: &[(u64, u32)]) -> Vec<u8> {
    let mut b = packet(0x106, 0, 32 + entries.len() * 16);
    word(&mut b, 24, id);
    word(&mut b, 28, entries.len() as u32);
    for (i, (addr, n)) in entries.iter().enumerate() {
        b[32 + i * 16..40 + i * 16].copy_from_slice(&addr.to_le_bytes());
        word(&mut b, 40 + i * 16, *n);
    }
    b
}
fn caps() -> QualifiedCapabilities {
    let mut formats = FormatMask::default();
    for f in [1, 2, 16, 67] {
        formats.insert(f).unwrap();
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
        },
        formats.clone(),
        formats,
        FormatMask::default(),
        FormatMask::default(),
        "wasm-vm WebGL2 VirGL",
    )
    .unwrap()
}
struct Controls;
impl Control3dSink for Controls {
    fn apply(&mut self, _: &Control3dEvent) -> Result<(), E> {
        Ok(())
    }
}
#[derive(Default)]
struct Jobs {
    pending: Option<Submit3dRequest>,
    begun: u64,
    cancelled: u64,
}
struct SubmitSink(Rc<RefCell<Jobs>>);
impl Submit3dSink for SubmitSink {
    fn begin_job(&mut self, r: &Submit3dRequest) -> Result<(), E> {
        let mut h = self.0.borrow_mut();
        assert!(h.pending.is_none(), "one original pending request");
        h.pending = Some(r.clone());
        h.begun += 1;
        Ok(())
    }
    fn cancel_job(&mut self, _: Submit3dKey) -> Result<(), E> {
        let mut h = self.0.borrow_mut();
        h.pending = None;
        h.cancelled += 1;
        Ok(())
    }
}
struct Rig {
    machine: Machine,
    base: u64,
    mail: Submit3dMailbox,
    jobs: Rc<RefCell<Jobs>>,
    index: u16,
    requests: u64,
    digest: Sha256,
}
impl Rig {
    fn new() -> Self {
        let mut m = Machine::new(RAM);
        m.enable_plic();
        m.enable_virtio_slots(None);
        m.enable_virtio_gpu(Box::new(NullSink)).unwrap();
        let mail = Submit3dMailbox::new();
        let jobs = Rc::new(RefCell::new(Jobs::default()));
        m.attach_qualified_virgl(
            Box::new(Controls),
            Box::new(SubmitSink(jobs.clone())),
            mail.clone(),
            caps(),
        )
        .unwrap();
        m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006f).unwrap();
        m.hart_mut().regs.pc = virt::KERNEL_BASE;
        let base = Platform::virtio_base(m.virtio_gpu().unwrap().0 as u64);
        let mut q = Self {
            machine: m,
            base,
            mail,
            jobs,
            index: 0,
            requests: 0,
            digest: Sha256::new(),
        };
        q.mmio(0x30, 0);
        q.mmio(0x38, 8);
        for (at, a) in [(0x80, DESC), (0x90, AVAIL), (0xa0, USED)] {
            q.mmio(at, a as u32);
            q.mmio(at + 4, (a >> 32) as u32);
        }
        q.mmio(0x44, 1);
        q.mmio(0x70, 3);
        q.mmio(0x24, 0);
        q.mmio(0x20, 1);
        q.mmio(0x24, 1);
        q.mmio(0x20, 1);
        q.mmio(0x70, 11);
        q.mmio(0x70, 15);
        q.sync(&packet(0x200, 2, 96), 0x1100);
        for (id, target, w, h, layers) in [(3, 0, 4096, 1, 1), (4, 2, 8, 8, 1), (5, 7, 8, 8, 3)] {
            let mut b = packet(0x204, 0, 72);
            for (i, v) in [
                id,
                target,
                if target == 0 { 64 } else { 67 },
                if target == 0 { 16 } else { 10 },
                w,
                h,
                1,
                layers,
                0,
                0,
                0,
                0,
            ]
            .into_iter()
            .enumerate()
            {
                word(&mut b, 24 + i * 4, v);
            }
            q.sync(&b, 0x1100);
            let mut attach = id_command(0x202, id);
            word(&mut attach, 16, 2);
            q.sync(&attach, 0x1100);
            q.sync(
                &backing(id, &[(BACKING + u64::from(id) * 0x1000, 4096)]),
                0x1100,
            );
        }
        q
    }
    fn mmio(&mut self, at: u64, v: u32) {
        self.machine.bus_mut().store32(self.base + at, v).unwrap();
    }
    fn write(&mut self, at: u64, b: &[u8]) {
        self.machine.bus_mut().write_ram_slice(at, b).unwrap();
    }
    fn read(&mut self, at: u64, n: usize) -> Vec<u8> {
        let mut b = vec![0; n];
        self.machine.bus_mut().ram().read_slice(at, &mut b).unwrap();
        b
    }
    fn run(&mut self) {
        assert_eq!(self.machine.run(1), RunOutcome::MaxInstrs);
    }
    fn used(&mut self) -> u16 {
        self.machine.bus_mut().load16(USED + 2).unwrap()
    }
    fn descriptor(&mut self, id: u64, address: u64, n: u32, flags: u16, next: u16) {
        let at = DESC + id * 16;
        self.machine.bus_mut().store64(at, address).unwrap();
        self.machine.bus_mut().store32(at + 8, n).unwrap();
        self.machine.bus_mut().store16(at + 12, flags).unwrap();
        self.machine.bus_mut().store16(at + 14, next).unwrap();
    }
    fn begin(&mut self, b: &[u8], capacity: u32, split: usize) -> bool {
        assert!(b.len() >= 24);
        assert!(self.jobs.borrow().pending.is_none());
        assert_eq!(self.used(), self.index);
        self.write(REQUEST, b);
        self.write(RESPONSE, &GUARD);
        if split > 0 && split < b.len() {
            self.descriptor(0, REQUEST, split as u32, 1, 1);
            self.descriptor(
                1,
                REQUEST + split as u64,
                (b.len() - split) as u32,
                if capacity == 0 { 0 } else { 1 },
                2,
            );
            if capacity > 0 {
                self.descriptor(2, RESPONSE, capacity, 2, 0);
            }
        } else {
            self.descriptor(
                0,
                REQUEST,
                b.len() as u32,
                if capacity == 0 { 0 } else { 1 },
                1,
            );
            if capacity > 0 {
                self.descriptor(1, RESPONSE, capacity, 2, 0);
            }
        }
        self.machine
            .bus_mut()
            .store16(AVAIL + 4 + u64::from(self.index % 8) * 2, 0)
            .unwrap();
        let next = self.index.wrapping_add(1);
        self.machine.bus_mut().store16(AVAIL + 2, next).unwrap();
        self.mmio(0x50, 0);
        self.run();
        self.requests += 1;
        self.digest.update((b.len() as u32).to_le_bytes());
        self.digest.update(b);
        self.jobs.borrow().pending.is_some()
    }
    fn finish(&mut self, b: &[u8], capacity: u32, expected: u32) {
        let pending = self.jobs.borrow_mut().pending.take();
        if let Some(job) = pending {
            assert_eq!(self.mail.inspect().active, Some(job.key));
            let completion = Submit3dCompletion {
                key: job.key,
                exchange_sequence: self.mail.inspect().last_exchange,
                outcome: if expected == 0x1100 {
                    Ok(())
                } else {
                    Err(E::InvalidParameter)
                },
                gpu_complete: true,
                applied_commands: 0,
                draws: 0,
            };
            self.mail.post(completion).unwrap();
            assert!(
                self.mail.post(completion).is_err(),
                "duplicate completion rejected before publication"
            );
            self.run();
            assert!(
                self.mail.post(completion).is_err(),
                "stale completion rejected after publication"
            );
        }
        let next = self.index.wrapping_add(1);
        assert_eq!(
            self.used(),
            next,
            "exactly one used entry per request capacity={capacity} request={b:02x?}"
        );
        let at = USED + 4 + u64::from(self.index % 8) * 8;
        assert_eq!(self.machine.bus_mut().load32(at).unwrap(), 0);
        let n = if capacity < 24 { 0 } else { 24 };
        assert_eq!(self.machine.bus_mut().load32(at + 4).unwrap(), n);
        let actual = self.read(RESPONSE, 80);
        if n == 24 {
            let mut wanted = b[..24].to_vec();
            word(&mut wanted, 0, expected);
            let flag = u32::from_le_bytes(b[4..8].try_into().unwrap()) & 1;
            word(&mut wanted, 4, flag);
            if flag == 0 {
                wanted[8..16].fill(0);
            }
            wanted[21..24].fill(0);
            assert_eq!(&actual[..24], &wanted, "original response header/fence");
        }
        assert_eq!(
            &actual[n as usize..],
            &GUARD[n as usize..],
            "no response OOB write"
        );
        self.digest.update(&actual);
        self.index = next;
        self.run();
        assert_eq!(self.used(), next, "no duplicate retirement on idle turn");
        self.mmio(0x64, 3);
    }
    fn sync(&mut self, b: &[u8], expected: u32) {
        let active = self.begin(b, 24, 0);
        assert!(!active);
        self.finish(b, 24, expected);
    }
    fn exchange(&self, id: u32, rows: Submit3dRows) -> Submit3dExchange {
        let h = self.jobs.borrow();
        let job = h.pending.as_ref().unwrap();
        let r = job.resources.iter().find(|r| r.identity.id == id).unwrap();
        Submit3dExchange {
            key: job.key,
            exchange_sequence: self.mail.inspect().last_exchange + 1,
            backing: Submit3dBacking {
                resource: r.identity,
                generation: r.backing.map_or(0, |b| b.generation),
            },
            rows,
        }
    }
}
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 16) as u32
    }
    fn choose(&mut self, v: &[u32]) -> u32 {
        v[self.next() as usize % v.len()]
    }
}
fn budget(start: Instant, i: usize) {
    if i.is_multiple_of(1024) {
        assert!(
            start.elapsed().as_secs() < 120,
            "family exceeded 120-second bounded budget at {i}"
        );
    }
}
fn report(q: &Rig, family: &str, count: usize, seed: u64, start: Instant, admitted: usize) {
    let sha: String = q
        .digest
        .clone()
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    eprintln!(
        "PRODUCTION_VIRGL_FUZZ {{\"family\":\"{family}\",\"cases\":{count},\"seed\":\"{seed:016x}\",\"timeoutSeconds\":120,\"elapsedMillis\":{},\"admitted\":{admitted},\"queueResponses\":{},\"sha256\":\"{sha}\",\"panicOobHang\":false}}",
        start.elapsed().as_millis(),
        q.requests
    );
}

#[test]
fn production_transport_six_hundred_thousand_properties() {
    let count = std::env::var("PRODUCTION_VIRGL_FUZZ_CASES")
        .ok()
        .map(|v| v.parse::<usize>().unwrap())
        .unwrap_or(FAMILY_CASES);
    assert!(count > 0 && count <= FAMILY_CASES);
    let seed_mask = std::env::var("PRODUCTION_VIRGL_FUZZ_SEED")
        .ok()
        .map(|v| u64::from_str_radix(&v, 16).unwrap())
        .unwrap_or(0);
    let seed = 0xd47d_58a2_3f6e_901b ^ seed_mask;
    let mut rng = Rng(seed);
    let mut q = Rig::new();
    let start = Instant::now();
    let mut admitted = 0;
    for i in 0..count {
        budget(start, i);
        let n = (rng.next() % 32) as usize * 4;
        let payload: Vec<u8> = (0..n).map(|_| rng.next() as u8).collect();
        let mut b = submit(
            &payload,
            (u64::from(rng.next()) << 32) | u64::from(rng.next()),
        );
        let variant = rng.next() % 8;
        let expected = match variant {
            1 => {
                word(&mut b, 24, n as u32 + 1);
                0x1205
            }
            2 => {
                word(&mut b, 28, 1);
                0x1205
            }
            3 => {
                word(&mut b, 16, 0xffff_ffff);
                0x1204
            }
            4 => {
                word(&mut b, 4, 3);
                0x1205
            }
            5 => {
                word(&mut b, 16, 0);
                0x1204
            }
            6 => {
                b[21] = 1;
                0x1205
            }
            _ => 0x1205,
        };
        let capacity = rng.choose(&[0, 1, 23, 24, 32, 64]);
        let split = (rng.next() as usize % (b.len() + 1)).min(b.len());
        let active = q.begin(&b, capacity, split);
        let should_admit = capacity >= 24 && matches!(variant, 0 | 7);
        assert_eq!(
            active, should_admit,
            "literal SUBMIT admission variant {variant}"
        );
        admitted += usize::from(active);
        q.finish(&b, capacity, expected);
    }
    report(&q, "original-submit-body", count, seed, start, admitted);

    let seed = 0x9152_cce8_07a4_3bd9 ^ seed_mask;
    let mut rng = Rng(seed);
    let mut q = Rig::new();
    let start = Instant::now();
    let mut admitted = 0;
    for i in 0..count {
        budget(start, i);
        q.sync(&id_command(0x107, 3), 0x1100);
        let entries_count = 1 + rng.next() as usize % 4;
        let mut entries = Vec::new();
        let mut logical = Vec::new();
        for j in 0..entries_count {
            let n = 1 + rng.next() % 64;
            let addr = BACKING + 0x10000 + j as u64 * 256;
            let bytes: Vec<u8> = (0..n)
                .map(|k| (j as u8 * 67).wrapping_add(k as u8).wrapping_add(i as u8))
                .collect();
            q.write(addr - 8, &[0x9b; 80]);
            q.write(addr, &bytes);
            logical.extend(bytes);
            entries.push((addr, n));
        }
        let mode = rng.next() % 8;
        let mut attach = backing(3, &entries);
        let mut attached = true;
        match mode {
            0 => {
                word(&mut attach, 28, 0);
                attached = false
            }
            1 => {
                word(&mut attach, 40, 0);
                attached = false
            }
            2 => {
                attach[32..40].copy_from_slice(&u64::MAX.to_le_bytes());
                attached = false
            }
            3 => {
                attach[32..40].copy_from_slice(&(virt::DRAM_BASE + RAM as u64 - 1).to_le_bytes());
                word(&mut attach, 40, 2);
                attached = false
            }
            4 => {
                word(&mut attach, 44, 1);
                attached = false
            }
            _ => {}
        }
        q.sync(&attach, if attached { 0x1100 } else { 0x1205 });
        let request = submit(&[], i as u64);
        assert!(q.begin(&request, 24, i % 33));
        let rows = Submit3dRows {
            offset: u64::from(rng.choose(&[0, 1, 7, 63, 255, u32::MAX])),
            row_bytes: rng.choose(&[0, 1, 3, 8, 65, u32::MAX]),
            row_stride: rng.choose(&[0, 1, 7, 16, 128, u32::MAX]),
            row_count: rng.choose(&[0, 1, 2, 4, 16, u32::MAX]),
        };
        let mut x = q.exchange(3, rows);
        let stale = rng.next().is_multiple_of(9);
        if stale {
            x.backing.generation = x.backing.generation.wrapping_add(1);
        }
        let end = u128::from(rows.offset)
            + u128::from(rows.row_count.saturating_sub(1)) * u128::from(rows.row_stride)
            + u128::from(rows.row_bytes);
        let valid = attached
            && !stale
            && rows.row_bytes > 0
            && rows.row_count > 0
            && rows.row_count <= 16384
            && rows.row_stride >= rows.row_bytes
            && u128::from(rows.row_bytes) * u128::from(rows.row_count) <= 32 * 1024 * 1024
            && end <= logical.len() as u128;
        let before = q.used();
        let result = q.machine.submit3d_gather(&x);
        assert_eq!(result.is_ok(), valid, "independent u128 SG/rows prediction");
        if valid {
            let mut expected = Vec::new();
            for row in 0..rows.row_count {
                let at = rows.offset as usize + row as usize * rows.row_stride as usize;
                expected.extend_from_slice(&logical[at..at + rows.row_bytes as usize]);
            }
            assert_eq!(result.unwrap(), expected);
            admitted += 1;
            let mut output = x;
            output.exchange_sequence += 1;
            let painted = vec![0x36; expected.len()];
            q.machine.submit3d_scatter(&output, &painted).unwrap();
            for row in 0..rows.row_count {
                let at = rows.offset as usize + row as usize * rows.row_stride as usize;
                logical[at..at + rows.row_bytes as usize].fill(0x36);
            }
        }
        assert_eq!(q.used(), before, "DMA cannot publish a used entry");
        if attached {
            let mut actual = Vec::new();
            for (addr, n) in &entries {
                actual.extend(q.read(*addr, *n as usize));
                assert_eq!(q.read(*addr - 8, 8), [0x9b; 8]);
                assert_eq!(q.read(*addr + u64::from(*n), 8), [0x9b; 8]);
            }
            assert_eq!(actual, logical, "original SG bytes and guards");
        }
        q.finish(&request, 24, 0x1100);
        if !attached {
            q.sync(&backing(3, &[(BACKING + 0x3000, 4096)]), 0x1100);
        }
    }
    report(
        &q,
        "original-backing-lists-and-dma",
        count,
        seed,
        start,
        admitted,
    );

    let seed = 0x28ab_06d9_c753_e14f ^ seed_mask;
    let mut rng = Rng(seed);
    let mut q = Rig::new();
    let start = Instant::now();
    let mut admitted = 0;
    for i in 0..count {
        budget(start, i);
        let id = rng.choose(&[3, 4, 5]);
        let (width, height, layers, scale) = if id == 3 {
            (4096u32, 1u32, 1u32, 1u32)
        } else {
            (8, 8, if id == 5 { 3 } else { 1 }, 4)
        };
        let choose = |r: &mut Rng, limit| r.choose(&[0, 1, 2, limit, limit + 1, u32::MAX]);
        let bx = choose(&mut rng, width);
        let by = choose(&mut rng, height);
        let bz = choose(&mut rng, layers);
        let w = choose(&mut rng, width);
        let h = choose(&mut rng, height);
        let d = choose(&mut rng, layers);
        let offset = if rng.next().is_multiple_of(7) {
            u64::MAX
        } else {
            u64::from(rng.choose(&[0, 1, 31, 4095, 4096, u32::MAX]))
        };
        let stride = rng.choose(&[0, 1, 3, 4, 32, 128, u32::MAX]);
        let layer_stride = rng.choose(&[0, 1, 32, 256, 512, u32::MAX]);
        let mut b = packet(if i % 2 == 0 { 0x205 } else { 0x206 }, 2, 72);
        word(&mut b, 4, 1);
        b[8..16].copy_from_slice(&(i as u64).to_le_bytes());
        for (at, v) in [
            (24, bx),
            (28, by),
            (32, bz),
            (36, w),
            (40, h),
            (44, d),
            (56, id),
            (64, stride),
            (68, layer_stride),
        ] {
            word(&mut b, at, v);
        }
        b[48..56].copy_from_slice(&offset.to_le_bytes());
        let row = if stride == 0 {
            width as u128 * scale as u128
        } else {
            stride as u128
        };
        let layer = if layer_stride == 0 {
            row * height as u128
        } else {
            layer_stride as u128
        };
        let bytes = w as u128 * scale as u128;
        let end = offset as u128
            + d.saturating_sub(1) as u128 * layer
            + h.saturating_sub(1) as u128 * row
            + bytes;
        let valid = w > 0
            && h > 0
            && d > 0
            && bx as u128 + w as u128 <= width as u128
            && by as u128 + h as u128 <= height as u128
            && bz as u128 + d as u128 <= layers as u128
            && bytes <= u32::MAX as u128
            && row >= bytes
            && row * h as u128 <= u32::MAX as u128
            && layer >= row * h as u128
            && layer <= u32::MAX as u128
            && end <= 4096
            && end >= offset as u128
            && end - offset as u128 <= 32 * 1024 * 1024
            && bytes * h as u128 * d as u128 <= 32 * 1024 * 1024;
        let active = q.begin(&b, 24, i % 73);
        assert_eq!(
            active,
            valid,
            "independent u128 transfer extent prediction id={id} box={:?} stride={stride} layer={layer_stride}",
            [bx, by, bz, w, h, d]
        );
        admitted += usize::from(active);
        if valid {
            let x = q.exchange(
                id,
                Submit3dRows {
                    offset,
                    row_bytes: bytes as u32,
                    row_stride: row as u32,
                    row_count: h,
                },
            );
            let before = q.used();
            if i % 2 == 0 {
                let dense = if d > 1 {
                    q.machine.submit3d_gather_layered(&x, layer as u32, d)
                } else {
                    q.machine.submit3d_gather(&x)
                }
                .unwrap();
                assert_eq!(dense.len(), (bytes * h as u128 * d as u128) as usize);
            } else {
                let dense = vec![0x53; (bytes * h as u128 * d as u128) as usize];
                if d > 1 {
                    q.machine
                        .submit3d_scatter_layered(&x, layer as u32, d, &dense)
                } else {
                    q.machine.submit3d_scatter(&x, &dense)
                }
                .unwrap();
            }
            assert_eq!(q.used(), before);
        }
        q.finish(&b, 24, if valid { 0x1100 } else { 0x1205 });
    }
    report(
        &q,
        "original-transfer-extent-and-stride",
        count,
        seed,
        start,
        admitted,
    );
}
