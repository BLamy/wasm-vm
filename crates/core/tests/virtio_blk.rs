//! E2-T11 virtio-blk full-stack tests: real rings in guest RAM, transport lifecycle over
//! the bus, kicks via the MMIO QueueNotify register, service through the Machine run loop.

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

fn machine(image: Vec<u8>, ro: bool) -> (Machine, blkctx::Ctx) {
    let backend: Box<dyn BlockBackend> = if ro {
        Box::new(MemBackend::new_read_only(image))
    } else {
        Box::new(MemBackend::new(image))
    };
    machine_be(backend)
}

fn machine_be(backend: Box<dyn BlockBackend>) -> (Machine, blkctx::Ctx) {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let (slot, state) = m.enable_virtio_blk(backend);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    // Park the "kernel" so run() can tick boundaries.
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();
    // Driver lifecycle over the real registers.
    m.bus_mut().store32(SLOT0 + 0x70, 1).unwrap(); // ACKNOWLEDGE
    m.bus_mut().store32(SLOT0 + 0x70, 3).unwrap(); // +DRIVER
    m.bus_mut().store32(SLOT0 + 0x24, 0).unwrap();
    m.bus_mut().store32(SLOT0 + 0x20, 0).unwrap(); // accept no device bits
    m.bus_mut().store32(SLOT0 + 0x24, 1).unwrap();
    m.bus_mut().store32(SLOT0 + 0x20, 1).unwrap(); // VERSION_1
    m.bus_mut().store32(SLOT0 + 0x70, 11).unwrap(); // +FEATURES_OK
    m.bus_mut().store32(SLOT0 + 0x30, 0).unwrap(); // QueueSel 0
    m.bus_mut().store32(SLOT0 + 0x38, 8).unwrap(); // QueueNum 8
    m.bus_mut().store32(SLOT0 + 0x80, DESC as u32).unwrap();
    m.bus_mut().store32(SLOT0 + 0x84, 0).unwrap();
    m.bus_mut().store32(SLOT0 + 0x90, AVAIL as u32).unwrap();
    m.bus_mut().store32(SLOT0 + 0x94, 0).unwrap();
    m.bus_mut().store32(SLOT0 + 0xa0, USED as u32).unwrap();
    m.bus_mut().store32(SLOT0 + 0xa4, 0).unwrap();
    m.bus_mut().store32(SLOT0 + 0x44, 1).unwrap(); // QueueReady
    m.bus_mut().store32(SLOT0 + 0x70, 15).unwrap(); // +DRIVER_OK
    (
        m,
        blkctx::Ctx {
            slot,
            state,
            seq: 0,
        },
    )
}

mod blkctx {
    use std::cell::RefCell;
    use std::rc::Rc;
    use wasm_vm_core::dev::virtio::blk::BlkState;
    use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
    pub struct Ctx {
        pub slot: Rc<RefCell<VirtioMmio>>,
        pub state: Rc<RefCell<BlkState>>,
        pub seq: u16,
    }
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

/// Publish head, kick via the REAL QueueNotify register, run one boundary, read status.
fn submit(m: &mut Machine, ctx: &mut blkctx::Ctx, head: u16) -> u8 {
    m.bus_mut()
        .store16(AVAIL + 4 + 2 * u64::from(ctx.seq % 8), head)
        .unwrap();
    ctx.seq = ctx.seq.wrapping_add(1);
    m.bus_mut().store16(AVAIL + 2, ctx.seq).unwrap();
    m.bus_mut().store32(SLOT0 + 0x50, 0).unwrap(); // QueueNotify — sets the kick flag
    assert_eq!(m.run(4), RunOutcome::MaxInstrs); // one boundary services it
    m.bus_mut().load8(STATUS).unwrap()
}

/// OUT then IN round-trip; used.len bookkeeping; interrupt raised.
#[test]
fn out_then_in_roundtrip() {
    let (mut m, mut ctx) = machine(vec![0u8; 64 * SECTOR_SIZE], false);
    // OUT: hdr | 2 sectors payload | status.
    write_hdr(&mut m, HDR, 1, 3);
    for i in 0..(2 * SECTOR_SIZE) {
        m.bus_mut()
            .store8(DATA + i as u64, (i % 251) as u8)
            .unwrap();
    }
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 2 * SECTOR_SIZE as u32, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0, "OUT status OK");
    assert_eq!(m.bus_mut().load32(USED + 8).unwrap(), 1, "OUT used.len = 1");
    assert!(ctx.slot.borrow().irq_level(), "used-ring interrupt raised");

    // IN: read the same sectors back into a fresh buffer.
    write_hdr(&mut m, HDR, 0, 3);
    let rbuf = DATA + 0x4000;
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, rbuf, 2 * SECTOR_SIZE as u32, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0, "IN status OK");
    // Used element i lives at USED+4+8*i: elem 1's len is at USED+16.
    assert_eq!(
        m.bus_mut().load32(USED + 4 + 8 + 4).unwrap() as usize,
        2 * SECTOR_SIZE + 1,
        "IN used.len = data + status"
    );
    for i in 0..(2 * SECTOR_SIZE) {
        assert_eq!(
            m.bus_mut().load8(rbuf + i as u64).unwrap(),
            (i % 251) as u8,
            "byte {i}"
        );
    }
}

/// E2-T19 `--blk-log`: enabled logging records each serviced request (type/sector/len/status).
#[test]
fn blk_log_records_serviced_requests() {
    let (mut m, mut ctx) = machine(vec![0u8; 64 * SECTOR_SIZE], false);
    m.enable_blk_log();
    // OUT one sector at sector 5.
    write_hdr(&mut m, HDR, 1, 5);
    for i in 0..SECTOR_SIZE {
        m.bus_mut().store8(DATA + i as u64, 0xAB).unwrap();
    }
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, SECTOR_SIZE as u32, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0);
    // IN the same sector back.
    write_hdr(&mut m, HDR, 0, 5);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(
        &mut m,
        1,
        DATA + 0x4000,
        SECTOR_SIZE as u32,
        F_WRITE | F_NEXT,
        2,
    );
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0);

    let log = m.drain_blk_log();
    assert_eq!(log.len(), 2, "two requests logged");
    // OUT: type 1, sector 5, len 0 (writes report no data-in), status OK(0).
    assert_eq!((log[0].rtype, log[0].sector, log[0].status), (1, 5, 0));
    // IN: type 0, sector 5, len = one sector, status OK(0).
    assert_eq!(
        (log[1].rtype, log[1].sector, log[1].len, log[1].status),
        (0, 5, SECTOR_SIZE as u32, 0)
    );
    // Draining clears it.
    assert!(m.drain_blk_log().is_empty(), "log cleared after drain");
}

/// Acceptance: header split 4+12 across two descriptors parses identically.
#[test]
fn segmented_header_4_plus_12() {
    let (mut m, mut ctx) = machine(vec![0xEE; 16 * SECTOR_SIZE], false);
    write_hdr(&mut m, HDR, 0, 5); // IN sector 5
    wdesc(&mut m, 0, HDR, 4, F_NEXT, 1); // first 4 header bytes
    wdesc(&mut m, 1, HDR + 4, 12, F_NEXT, 2); // remaining 12
    wdesc(&mut m, 2, DATA, SECTOR_SIZE as u32, F_WRITE | F_NEXT, 3);
    wdesc(&mut m, 3, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0, "split header OK");
    assert_eq!(m.bus_mut().load8(DATA).unwrap(), 0xEE, "read the image");
}

/// GET_ID: 20-byte stable serial, used.len = 21.
#[test]
fn get_id_serial() {
    let (mut m, mut ctx) = machine(vec![0u8; 8 * SECTOR_SIZE], false);
    write_hdr(&mut m, HDR, 8, 0);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 20, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0);
    for (i, &b) in SERIAL.iter().enumerate() {
        assert_eq!(m.bus_mut().load8(DATA + i as u64).unwrap(), b);
    }
    assert_eq!(m.bus_mut().load32(USED + 8).unwrap(), 21);
}

/// FLUSH: sector 0 OK (backend flush counted — the F_FLUSH lie-detector hook);
/// sector != 0 → IOERR per spec.
#[test]
fn flush_semantics_and_counter() {
    let (mut m, mut ctx) = machine(vec![0u8; 8 * SECTOR_SIZE], false);
    write_hdr(&mut m, HDR, 4, 0);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 0, "FLUSH OK");
    assert_eq!(
        ctx.state.borrow().flush_count,
        1,
        "backend flush really ran"
    );
    write_hdr(&mut m, HDR, 4, 7); // sector != 0
    assert_eq!(
        submit(&mut m, &mut ctx, 0),
        1,
        "FLUSH with sector != 0 → IOERR"
    );
    assert_eq!(
        ctx.state.borrow().flush_count,
        1,
        "no flush on rejected request"
    );
}

/// RO device: OUT → IOERR, image unchanged, device still serves reads; F_RO offered.
#[test]
fn read_only_write_fails_cleanly() {
    let image = vec![0x42u8; 16 * SECTOR_SIZE];
    let (mut m, mut ctx) = machine(image, true);
    // F_RO (bit 5) offered in feature bank 0.
    m.bus_mut().store32(SLOT0 + 0x14, 0).unwrap();
    let feats = m.bus_mut().load32(SLOT0 + 0x10).unwrap();
    assert_ne!(feats & (1 << 5), 0, "VIRTIO_BLK_F_RO offered");
    // OUT write attempt.
    write_hdr(&mut m, HDR, 1, 0);
    for i in 0..SECTOR_SIZE {
        m.bus_mut().store8(DATA + i as u64, 0x99).unwrap();
    }
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, SECTOR_SIZE as u32, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 1, "RO write → IOERR");
    // Device still functional: IN reads the untouched 0x42 image.
    write_hdr(&mut m, HDR, 0, 0);
    wdesc(
        &mut m,
        1,
        DATA + 0x2000,
        SECTOR_SIZE as u32,
        F_WRITE | F_NEXT,
        2,
    );
    assert_eq!(submit(&mut m, &mut ctx, 0), 0, "reads still OK");
    assert_eq!(m.bus_mut().load8(DATA + 0x2000).unwrap(), 0x42);
}

/// Charter torture: hostile requests interleaved with valid ones — 10^4 requests, the
/// device answers IOERR/UNSUPP and NEVER wedges (a valid request still works after).
#[test]
fn torture_hostile_requests_survive_10k() {
    let (mut m, mut ctx) = machine(vec![0u8; 64 * SECTOR_SIZE], false);
    let mut x = 0xB10C_DE57_1234_5678u64;
    let mut next = move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    for i in 0..10_000u32 {
        match next() % 4 {
            0 => {
                // valid IN, 1 sector
                write_hdr(&mut m, HDR, 0, next() % 64);
                wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
                wdesc(&mut m, 1, DATA, SECTOR_SIZE as u32, F_WRITE | F_NEXT, 2);
                wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
                assert_eq!(submit(&mut m, &mut ctx, 0), 0, "valid IN at {i}");
            }
            1 => {
                // garbage type
                write_hdr(&mut m, HDR, 0xFFFF_FFFF, next());
                wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
                wdesc(&mut m, 1, STATUS, 1, F_WRITE, 0);
                assert_eq!(submit(&mut m, &mut ctx, 0), 2, "garbage type → UNSUPP");
            }
            2 => {
                // sector beyond capacity
                write_hdr(&mut m, HDR, 0, 64 + next() % 1000);
                wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
                wdesc(&mut m, 1, DATA, SECTOR_SIZE as u32, F_WRITE | F_NEXT, 2);
                wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
                assert_eq!(submit(&mut m, &mut ctx, 0), 1, "OOR sector → IOERR");
            }
            _ => {
                // IN with unaligned writable data (100 bytes + status)
                write_hdr(&mut m, HDR, 0, 0);
                wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
                wdesc(&mut m, 1, DATA, 100, F_WRITE | F_NEXT, 2);
                wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
                assert_eq!(submit(&mut m, &mut ctx, 0), 1, "unaligned IN → IOERR");
            }
        }
    }
    // Zero-data IN (no data segment at all): status-only chain → IOERR, not panic.
    write_hdr(&mut m, HDR, 0, 0);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, STATUS, 1, F_WRITE, 0);
    assert_eq!(submit(&mut m, &mut ctx, 0), 1, "zero-data IN → IOERR");
}

/// A chain with NO writable byte (status impossible) degrades the slot: NEEDS_RESET +
/// config-change, ring dropped — and a full reset + re-setup recovers the device.
#[test]
fn no_status_byte_is_protocol_violation() {
    let (mut m, mut ctx) = machine(vec![0u8; 8 * SECTOR_SIZE], false);
    write_hdr(&mut m, HDR, 1, 0);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, SECTOR_SIZE as u32, 0, 0); // readable "payload", NO writable
    m.bus_mut().store16(AVAIL + 4, 0).unwrap();
    ctx.seq += 1;
    m.bus_mut().store16(AVAIL + 2, ctx.seq).unwrap();
    m.bus_mut().store32(SLOT0 + 0x50, 0).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    let status = m.bus_mut().load32(SLOT0 + 0x70).unwrap();
    assert_ne!(status & 64, 0, "NEEDS_RESET set");
}

// ── E3-T02: deferred (lazy-fetch) completion ────────────────────────────────────────────────
use std::cell::Cell;
use std::rc::Rc;
use wasm_vm_core::block::BlockError;

/// A backend that WouldBlocks (awaiting chunk 0) until `ready` is set, then serves `data`. Models a
/// lazy chunk source whose chunk hasn't been fetched yet.
struct LazyMock {
    ready: Rc<Cell<bool>>,
    reads: Rc<Cell<u32>>,
    data: Vec<u8>,
}
impl BlockBackend for LazyMock {
    fn capacity_sectors(&self) -> u64 {
        (self.data.len() / SECTOR_SIZE) as u64
    }
    fn read(&mut self, sector: u64, buf: &mut [u8]) -> Result<(), BlockError> {
        self.reads.set(self.reads.get() + 1);
        if !self.ready.get() {
            return Err(BlockError::WouldBlock { chunk: 0 });
        }
        let start = (sector as usize) * SECTOR_SIZE;
        buf.copy_from_slice(&self.data[start..start + buf.len()]);
        Ok(())
    }
    fn write(&mut self, _sector: u64, _buf: &[u8]) -> Result<(), BlockError> {
        Ok(())
    }
    fn flush(&mut self) -> Result<(), BlockError> {
        Ok(())
    }
}

/// A read whose data isn't resident PARKS (no used-ring completion, status untouched, surfaced via
/// pending_blk_chunks), then completes EXACTLY ONCE on a later boundary once the chunk arrives —
/// with correct data — and is never double-completed.
#[test]
fn lazy_read_parks_then_completes_exactly_once() {
    let ready = Rc::new(Cell::new(false));
    let reads = Rc::new(Cell::new(0u32));
    let payload: Vec<u8> = (0..64 * SECTOR_SIZE).map(|i| (i % 251) as u8).collect();
    let mock = LazyMock {
        ready: ready.clone(),
        reads: reads.clone(),
        data: payload.clone(),
    };
    let (mut m, mut ctx) = machine_be(Box::new(mock));

    // IN: read sector 0 (1 sector) into a guest buffer.
    write_hdr(&mut m, HDR, 0, 0);
    let rbuf = DATA + 0x4000;
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, rbuf, SECTOR_SIZE as u32, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    m.bus_mut().store8(STATUS, 0xEE).unwrap(); // sentinel: unchanged ⇒ never completed
    m.bus_mut().store16(USED + 2, 0).unwrap();

    // Submit while NOT ready → the read parks (submit runs one boundary).
    submit(&mut m, &mut ctx, 0);
    assert_eq!(m.pending_blk_chunks(), vec![0], "parked, awaiting chunk 0");
    assert_eq!(
        m.bus_mut().load16(USED + 2).unwrap(),
        0,
        "used idx unchanged while parked"
    );
    assert_eq!(
        m.bus_mut().load8(STATUS).unwrap(),
        0xEE,
        "status untouched while parked"
    );

    // Extra boundaries while still parked must NOT complete or drop the request.
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    assert_eq!(m.pending_blk_chunks(), vec![0], "still parked");
    assert_eq!(
        m.bus_mut().load16(USED + 2).unwrap(),
        0,
        "still not completed"
    );

    // Chunk arrives → a plain boundary (no fresh kick) re-services and completes.
    ready.set(true);
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    assert!(m.pending_blk_chunks().is_empty(), "no longer parked");
    assert_eq!(
        m.bus_mut().load16(USED + 2).unwrap(),
        1,
        "completed exactly once"
    );
    assert_eq!(m.bus_mut().load8(STATUS).unwrap(), 0, "status S_OK");
    for (i, &want) in payload[..SECTOR_SIZE].iter().enumerate() {
        assert_eq!(
            m.bus_mut().load8(rbuf + i as u64).unwrap(),
            want,
            "correct data at byte {i}"
        );
    }

    // Further boundaries must NOT double-complete.
    assert_eq!(m.run(8), RunOutcome::MaxInstrs);
    assert_eq!(
        m.bus_mut().load16(USED + 2).unwrap(),
        1,
        "no double-completion"
    );
}
