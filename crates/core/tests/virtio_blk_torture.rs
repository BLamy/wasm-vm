//! E2-T11 adversarial suite, ADOPTED from the cold critic — including the round-1
//! refutation repro: `transport_reset_then_resetup_works` (stale ring view surviving a
//! transport reset left the device silently deaf; fixed via BlkState::reset_pending).

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::block::{BlockBackend, MemBackend, SECTOR_SIZE};
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::blk::SERIAL;
use wasm_vm_core::platform::virt;
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 8 * 1024 * 1024;
const SLOT0: u64 = 0x1000_1000;
const DESC: u64 = virt::DRAM_BASE + 0x10_0000;
const AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
const USED: u64 = virt::DRAM_BASE + 0x12_0000;
const HDR: u64 = virt::DRAM_BASE + 0x13_0000;
const DATA: u64 = virt::DRAM_BASE + 0x14_0000;
const STATUS: u64 = virt::DRAM_BASE + 0x15_0000;

const F_NEXT: u16 = 1;
const F_WRITE: u16 = 2;

struct Ctx {
    slot: std::rc::Rc<std::cell::RefCell<wasm_vm_core::dev::virtio::mmio::VirtioMmio>>,
    seq: u16,
}

fn lifecycle(m: &mut Machine) {
    m.bus_mut().store32(SLOT0 + 0x70, 1).unwrap();
    m.bus_mut().store32(SLOT0 + 0x70, 3).unwrap();
    m.bus_mut().store32(SLOT0 + 0x24, 0).unwrap();
    m.bus_mut().store32(SLOT0 + 0x20, 0).unwrap();
    m.bus_mut().store32(SLOT0 + 0x24, 1).unwrap();
    m.bus_mut().store32(SLOT0 + 0x20, 1).unwrap();
    m.bus_mut().store32(SLOT0 + 0x70, 11).unwrap();
    m.bus_mut().store32(SLOT0 + 0x30, 0).unwrap();
    m.bus_mut().store32(SLOT0 + 0x38, 16).unwrap();
    m.bus_mut().store32(SLOT0 + 0x80, DESC as u32).unwrap();
    m.bus_mut().store32(SLOT0 + 0x84, 0).unwrap();
    m.bus_mut().store32(SLOT0 + 0x90, AVAIL as u32).unwrap();
    m.bus_mut().store32(SLOT0 + 0x94, 0).unwrap();
    m.bus_mut().store32(SLOT0 + 0xa0, USED as u32).unwrap();
    m.bus_mut().store32(SLOT0 + 0xa4, 0).unwrap();
    m.bus_mut().store32(SLOT0 + 0x44, 1).unwrap();
    m.bus_mut().store32(SLOT0 + 0x70, 15).unwrap();
}

fn machine(image: Vec<u8>) -> (Machine, Ctx) {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let backend: Box<dyn BlockBackend> = Box::new(MemBackend::new(image));
    let (slot, _state) = m.enable_virtio_blk(backend);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();
    lifecycle(&mut m);
    (m, Ctx { slot, seq: 0 })
}

fn wdesc(m: &mut Machine, i: u16, addr: u64, len: u32, flags: u16, next: u16) {
    let base = DESC + 16 * u64::from(i);
    m.bus_mut().store64(base, addr).unwrap();
    m.bus_mut().store32(base + 8, len).unwrap();
    m.bus_mut().store16(base + 12, flags).unwrap();
    m.bus_mut().store16(base + 14, next).unwrap();
}

fn write_hdr(m: &mut Machine, at: u64, rtype: u32, sector: u64) {
    m.bus_mut().store32(at, rtype).unwrap();
    m.bus_mut().store32(at + 4, 0).unwrap();
    m.bus_mut().store64(at + 8, sector).unwrap();
}

fn publish(m: &mut Machine, ctx: &mut Ctx, head: u16) {
    m.bus_mut()
        .store16(AVAIL + 4 + 2 * u64::from(ctx.seq % 16), head)
        .unwrap();
    ctx.seq = ctx.seq.wrapping_add(1);
    m.bus_mut().store16(AVAIL + 2, ctx.seq).unwrap();
}

fn kick(m: &mut Machine) {
    m.bus_mut().store32(SLOT0 + 0x50, 0).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
}

fn submit(m: &mut Machine, ctx: &mut Ctx, head: u16) -> u8 {
    publish(m, ctx, head);
    kick(m);
    m.bus_mut().load8(STATUS).unwrap()
}

/// (a) Header split 1+1+14 across THREE descriptors.
#[test]
fn header_split_1_1_14() {
    let (mut m, mut ctx) = machine(vec![0xAB; 16 * SECTOR_SIZE]);
    write_hdr(&mut m, HDR, 0, 3); // IN sector 3
    wdesc(&mut m, 0, HDR, 1, F_NEXT, 1);
    wdesc(&mut m, 1, HDR + 1, 1, F_NEXT, 2);
    wdesc(&mut m, 2, HDR + 2, 14, F_NEXT, 3);
    wdesc(&mut m, 3, DATA, SECTOR_SIZE as u32, F_WRITE | F_NEXT, 4);
    wdesc(&mut m, 4, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0, "3-way split header OK");
    assert_eq!(m.bus_mut().load8(DATA).unwrap(), 0xAB);
}

/// (b) OUT payload split across 5 odd-sized descriptors: 100+412+512+500+524 = 2048 (4 sectors).
#[test]
fn out_payload_5way_odd_split() {
    let (mut m, mut ctx) = machine(vec![0u8; 64 * SECTOR_SIZE]);
    write_hdr(&mut m, HDR, 1, 7); // OUT sector 7
    for i in 0..2048u64 {
        m.bus_mut().store8(DATA + i, (i % 199) as u8).unwrap();
    }
    let splits: [(u64, u32); 5] = [
        (DATA, 100),
        (DATA + 100, 412),
        (DATA + 512, 512),
        (DATA + 1024, 500),
        (DATA + 1524, 524),
    ];
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    for (i, &(a, l)) in splits.iter().enumerate() {
        wdesc(&mut m, 1 + i as u16, a, l, F_NEXT, 2 + i as u16);
    }
    wdesc(&mut m, 6, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0, "5-way OUT OK");
    // Read back with a plain IN and compare.
    write_hdr(&mut m, HDR, 0, 7);
    let rbuf = DATA + 0x8000;
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, rbuf, 2048, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0);
    for i in 0..2048u64 {
        assert_eq!(
            m.bus_mut().load8(rbuf + i).unwrap(),
            (i % 199) as u8,
            "byte {i}"
        );
    }
}

/// (c) IN where the STATUS byte straddles: writable stream = desc(511) + desc(2: last data
/// byte + status). Data = 512 bytes spanning both descs; status = last byte of desc 2.
#[test]
fn in_status_straddles_descriptors() {
    let (mut m, mut ctx) = machine(vec![0x5A; 16 * SECTOR_SIZE]);
    write_hdr(&mut m, HDR, 0, 1); // IN sector 1
    let part2 = DATA + 0x1000; // 2 bytes: [data[511], status]
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 511, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, part2, 2, F_WRITE, 0);
    publish(&mut m, &mut ctx, 0);
    kick(&mut m);
    let status = m.bus_mut().load8(part2 + 1).unwrap();
    assert_eq!(status, 0, "straddled status OK");
    for i in 0..511u64 {
        assert_eq!(m.bus_mut().load8(DATA + i).unwrap(), 0x5A, "data byte {i}");
    }
    assert_eq!(m.bus_mut().load8(part2).unwrap(), 0x5A, "512th data byte");
    assert_eq!(m.bus_mut().load32(USED + 8).unwrap(), 513, "used.len 513");
}

/// (d) Multi-sector request starting at capacity-1 crossing capacity → IOERR.
#[test]
fn in_crossing_capacity_ioerr() {
    let (mut m, mut ctx) = machine(vec![0u8; 64 * SECTOR_SIZE]); // capacity 64
    write_hdr(&mut m, HDR, 0, 63); // last valid sector
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 2 * SECTOR_SIZE as u32, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 1, "cross-capacity IN → IOERR");
    // single sector at 63 still fine
    write_hdr(&mut m, HDR, 0, 63);
    wdesc(&mut m, 1, DATA, SECTOR_SIZE as u32, F_WRITE | F_NEXT, 2);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0, "last sector OK");
}

/// (e) GET_ID with only 5 writable data bytes + status: partial serial, S_OK, used.len 6.
#[test]
fn get_id_short_buffer() {
    let (mut m, mut ctx) = machine(vec![0u8; 8 * SECTOR_SIZE]);
    write_hdr(&mut m, HDR, 8, 0);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 5, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    let st = submit(&mut m, &mut ctx, 0);
    assert_eq!(st, 0, "short GET_ID completes OK (QEMU: MIN(iov, 20))");
    for (i, &want) in SERIAL.iter().enumerate().take(5) {
        assert_eq!(m.bus_mut().load8(DATA + i as u64).unwrap(), want);
    }
    assert_eq!(m.bus_mut().load32(USED + 8).unwrap(), 6, "used.len 6");
}

/// (f) THE RESET ATTACK: valid request → transport reset (Status=0) → full re-setup with a
/// fresh (re-zeroed) ring → valid request. Device MUST work again (ring view rebuilt).
#[test]
fn transport_reset_then_resetup_works() {
    let (mut m, mut ctx) = machine(vec![0xCD; 16 * SECTOR_SIZE]);
    // Valid IN first (advances the device's last_avail_idx to 1).
    write_hdr(&mut m, HDR, 0, 2);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, SECTOR_SIZE as u32, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0, "pre-reset request OK");

    // Driver reset: Status=0, then re-initialize rings like a fresh driver would.
    m.bus_mut().store32(SLOT0 + 0x70, 0).unwrap();
    for off in 0..64u64 {
        m.bus_mut().store8(AVAIL + off, 0).unwrap();
        m.bus_mut().store8(USED + off, 0).unwrap();
    }
    ctx.seq = 0;
    lifecycle(&mut m);

    // Fresh valid request on the fresh ring.
    write_hdr(&mut m, HDR, 0, 2);
    m.bus_mut().store8(STATUS, 0xFF).unwrap(); // poison so we see if it's written
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, SECTOR_SIZE as u32, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    let st = submit(&mut m, &mut ctx, 0);
    let dev_status = m.bus_mut().load32(SLOT0 + 0x70).unwrap();
    assert_eq!(
        dev_status & 64,
        0,
        "device must NOT be NEEDS_RESET after a legitimate reset + re-setup (got status {dev_status:#x})"
    );
    assert_eq!(st, 0, "post-reset request completes OK");
    assert_eq!(m.bus_mut().load8(DATA).unwrap(), 0xCD);
}

/// Kick with QueueReady=0 (before any setup): no wedge, no crash; later setup still works.
#[test]
fn kick_before_ready_is_harmless() {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let (_slot, _state) =
        m.enable_virtio_blk(Box::new(MemBackend::new(vec![0x11; 8 * SECTOR_SIZE])));
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();
    // Kick with nothing configured.
    m.bus_mut().store32(SLOT0 + 0x50, 0).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    let dev_status = m.bus_mut().load32(SLOT0 + 0x70).unwrap();
    assert_eq!(dev_status & 64, 0, "no NEEDS_RESET from early kick");
    // Now do the real setup and a request.
    lifecycle(&mut m);
    let mut ctx = Ctx {
        slot: std::rc::Rc::new(std::cell::RefCell::new(
            wasm_vm_core::dev::virtio::mmio::VirtioMmio::empty(),
        )),
        seq: 0,
    };
    let _ = &ctx.slot;
    write_hdr(&mut m, HDR, 0, 0);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, SECTOR_SIZE as u32, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0, "works after early kick");
    assert_eq!(m.bus_mut().load8(DATA).unwrap(), 0x11);
}

/// N publishes then ONE kick → all N processed; 1 publish + N kicks → exactly 1 completion.
#[test]
fn kick_coalescing_discipline() {
    let (mut m, mut ctx) = machine(vec![0x22; 64 * SECTOR_SIZE]);
    // Three requests published, one kick. Use distinct status bytes.
    for r in 0..3u16 {
        let hdr = HDR + u64::from(r) * 0x100;
        let data = DATA + u64::from(r) * 0x1000;
        let st = STATUS + u64::from(r);
        m.bus_mut().store8(st, 0xFF).unwrap();
        write_hdr(&mut m, hdr, 0, u64::from(r));
        wdesc(&mut m, r * 3, hdr, 16, F_NEXT, r * 3 + 1);
        wdesc(
            &mut m,
            r * 3 + 1,
            data,
            SECTOR_SIZE as u32,
            F_WRITE | F_NEXT,
            r * 3 + 2,
        );
        wdesc(&mut m, r * 3 + 2, st, 1, F_WRITE, 0);
        publish(&mut m, &mut ctx, r * 3);
    }
    kick(&mut m);
    for r in 0..3u64 {
        assert_eq!(m.bus_mut().load8(STATUS + r).unwrap(), 0, "req {r} done");
    }
    assert_eq!(m.bus_mut().load16(USED + 2).unwrap(), 3, "used.idx = 3");
    // 1 publish + 3 kicks → used.idx advances exactly once more (no double-execution).
    write_hdr(&mut m, HDR, 0, 5);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, SECTOR_SIZE as u32, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    publish(&mut m, &mut ctx, 0);
    kick(&mut m);
    kick(&mut m);
    kick(&mut m);
    assert_eq!(m.bus_mut().load16(USED + 2).unwrap(), 4, "exactly one more");
}
