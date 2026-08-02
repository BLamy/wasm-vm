//! E3-T12c2 — bounded virtqueue quiesce before snapshot.
//!
//! A snapshot must never capture a half-processed virtio-blk request. `Machine::quiesce` drains the
//! parked (in-flight) set to empty within a bounded pass budget, or REFUSES with a typed residual;
//! `Machine::save_resume` quiesces first and emits no blob on refusal. This proves:
//!   - a chain parked on a RESOLVABLE event drains to empty and the snapshot proceeds;
//!   - a chain parked on an UNRESOLVABLE event refuses within a bounded pass count (no unbounded
//!     wait) and the snapshot is refused, not torn;
//!   - a completed request is neither replayed nor lost across quiesce→snapshot→restore (the
//!     used-ring index is exact).

#![cfg(not(feature = "zicsr-stub"))]

use std::cell::Cell;
use std::rc::Rc;

use wasm_vm_core::block::{BlockBackend, BlockError};
use wasm_vm_core::bus::Bus;
use wasm_vm_core::platform::virt;
use wasm_vm_core::resume::{QuiesceReason, SnapshotError};
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

/// Write-back mock: writes land in RAM but `flush()` returns `FlushPending` until the test flips
/// `durable`, then `Ok` — the E3-T08 barrier path, reused here as the RESOLVABLE parked event.
struct MockWriteBack {
    data: Vec<u8>,
    durable: Rc<Cell<bool>>,
}

impl BlockBackend for MockWriteBack {
    fn capacity_sectors(&self) -> u64 {
        self.data.len() as u64 / 512
    }
    fn read(&mut self, sector: u64, buf: &mut [u8]) -> Result<(), BlockError> {
        let off = sector as usize * 512;
        buf.copy_from_slice(&self.data[off..off + buf.len()]);
        Ok(())
    }
    fn write(&mut self, sector: u64, buf: &[u8]) -> Result<(), BlockError> {
        let off = sector as usize * 512;
        self.data[off..off + buf.len()].copy_from_slice(buf);
        self.durable.set(false);
        Ok(())
    }
    fn flush(&mut self) -> Result<(), BlockError> {
        if self.durable.get() {
            Ok(())
        } else {
            Err(BlockError::FlushPending)
        }
    }
}

/// Lazy read mock: every read reports a base chunk that NEVER arrives (no fetch layer feeds it) —
/// the UNRESOLVABLE parked event. Re-execution stays `WouldBlock`, so the quiesce can only ever
/// refuse, never drain, this chain.
struct NeverArrives;

impl BlockBackend for NeverArrives {
    fn capacity_sectors(&self) -> u64 {
        64
    }
    fn read(&mut self, _sector: u64, _buf: &mut [u8]) -> Result<(), BlockError> {
        Err(BlockError::WouldBlock { chunk: 7 })
    }
    fn write(&mut self, _sector: u64, _buf: &[u8]) -> Result<(), BlockError> {
        Ok(())
    }
    fn flush(&mut self) -> Result<(), BlockError> {
        Ok(())
    }
}

struct Ctx {
    seq: u16,
}

fn machine_with_backend(backend: Box<dyn BlockBackend>) -> (Machine, Ctx) {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let (_slot, _state) = m.enable_virtio_blk(backend);
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();
    let w = |m: &mut Machine, off: u64, v: u32| m.bus_mut().store32(SLOT0 + off, v).unwrap();
    w(&mut m, 0x70, 1);
    w(&mut m, 0x70, 3);
    w(&mut m, 0x24, 0);
    w(&mut m, 0x20, (1 << 9) | (1 << 5)); // accept FLUSH
    w(&mut m, 0x24, 1);
    w(&mut m, 0x20, 1); // VERSION_1
    w(&mut m, 0x70, 11);
    w(&mut m, 0x30, 0);
    w(&mut m, 0x38, 8);
    w(&mut m, 0x80, DESC as u32);
    w(&mut m, 0x84, 0);
    w(&mut m, 0x90, AVAIL as u32);
    w(&mut m, 0x94, 0);
    w(&mut m, 0xa0, USED as u32);
    w(&mut m, 0xa4, 0);
    w(&mut m, 0x44, 1);
    w(&mut m, 0x70, 15);
    (m, Ctx { seq: 0 })
}

fn wdesc(m: &mut Machine, i: u16, addr: u64, len: u32, flags: u16, next: u16) {
    let base = DESC + 16 * u64::from(i);
    m.bus_mut().store64(base, addr).unwrap();
    m.bus_mut().store32(base + 8, len).unwrap();
    m.bus_mut().store16(base + 12, flags).unwrap();
    m.bus_mut().store16(base + 14, next).unwrap();
}
fn write_hdr(m: &mut Machine, rtype: u32, sector: u64) {
    m.bus_mut().store32(HDR, rtype).unwrap();
    m.bus_mut().store32(HDR + 4, 0).unwrap();
    m.bus_mut().store64(HDR + 8, sector).unwrap();
}
/// Publish head + kick + run one boundary (does NOT assume completion).
fn submit(m: &mut Machine, ctx: &mut Ctx, head: u16) {
    let a = AVAIL + 4 + 2 * u64::from(ctx.seq % 8);
    m.bus_mut().store16(a, head).unwrap();
    ctx.seq = ctx.seq.wrapping_add(1);
    m.bus_mut().store16(AVAIL + 2, ctx.seq).unwrap();
    m.bus_mut().store32(SLOT0 + 0x50, 0).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
}
fn used_idx(m: &mut Machine) -> u16 {
    m.bus_mut().load16(USED + 2).unwrap()
}

/// AC1 (resolvable) + AC2: a FLUSH parked on a durability barrier is drained to empty by `quiesce`
/// once the barrier clears; the completed request advances the used ring EXACTLY ONCE; the snapshot
/// then proceeds and round-trips the used-ring index byte-for-byte into a fresh machine.
#[test]
fn quiesce_drains_resolvable_flush_then_snapshots_coherently() {
    let durable = Rc::new(Cell::new(true));
    let backend = MockWriteBack {
        data: vec![0u8; 64 * 512],
        durable: Rc::clone(&durable),
    };
    let (mut m, mut ctx) = machine_with_backend(Box::new(backend));

    // A write makes the backend non-durable, then a FLUSH parks (barrier not yet clear).
    write_hdr(&mut m, 1, 3); // T_OUT sector 3
    for i in 0..512u64 {
        m.bus_mut().store8(DATA + i, 0xAB).unwrap();
    }
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 512, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut ctx, 0);
    assert_eq!(used_idx(&mut m), 1, "write completed");

    write_hdr(&mut m, 4, 0); // T_FLUSH
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut ctx, 0);
    assert_eq!(used_idx(&mut m), 1, "FLUSH parked — not yet acked");

    // While the barrier is held the machine is NON-quiesced: quiesce refuses, save emits no blob.
    assert_eq!(
        m.quiesce(),
        Err(SnapshotError::NotQuiesced {
            reason: QuiesceReason::Flush,
            in_flight: 1,
        }),
        "a held FLUSH barrier is a bounded refusal, not a torn snapshot"
    );
    assert!(matches!(
        m.save_resume(),
        Err(SnapshotError::NotQuiesced { .. })
    ));

    // The barrier clears → quiesce drains the parked FLUSH to empty and the snapshot proceeds.
    durable.set(true);
    m.quiesce().expect("resolvable event drains to empty");
    assert_eq!(used_idx(&mut m), 2, "FLUSH acked exactly once by the drain");
    let blob = m.save_resume().expect("quiesced machine snapshots");

    // AC2: the completed request is neither replayed nor lost across snapshot→restore. A fresh
    // machine restores the same used-ring index and re-serializes to the identical blob.
    let (mut b, _bctx) = machine_with_backend(Box::new(MockWriteBack {
        data: vec![0u8; 64 * 512],
        durable: Rc::new(Cell::new(true)),
    }));
    b.load_resume(&blob).expect("load_resume");
    assert_eq!(
        b.save_resume().expect("restored machine is quiesced"),
        blob,
        "used-ring index + transport round-trip exactly across quiesce→snapshot→restore"
    );

    // Idempotence: re-quiescing an already-empty machine neither pushes a used elem nor errors.
    m.quiesce().expect("already quiesced");
    assert_eq!(used_idx(&mut m), 2, "no replay of the completed request");
}

/// AC1 (unresolvable): a read parked on a base chunk that never arrives cannot be drained. Quiesce
/// refuses within the BOUNDED pass budget (no unbounded wait) and the snapshot is refused, not torn.
#[test]
fn quiesce_refuses_unresolvable_chunk_within_bounded_passes() {
    let (mut m, mut ctx) = machine_with_backend(Box::new(NeverArrives));

    // A T_IN read whose data is never resident → the chain parks on ParkReason::Chunk forever.
    write_hdr(&mut m, 0, 1); // T_IN sector 1
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 512, F_WRITE | F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut ctx, 0);
    assert_eq!(
        used_idx(&mut m),
        0,
        "read parked — nothing on the used ring"
    );

    // Quiesce returns (does not hang) with the typed residual naming the chunk fetch.
    assert_eq!(
        m.quiesce(),
        Err(SnapshotError::NotQuiesced {
            reason: QuiesceReason::Chunk,
            in_flight: 1,
        }),
        "an unresolvable chunk is a bounded refusal"
    );
    // save_resume refuses too and emits no blob.
    assert!(matches!(
        m.save_resume(),
        Err(SnapshotError::NotQuiesced {
            reason: QuiesceReason::Chunk,
            ..
        })
    ));
    // Still torn-free: the request is neither acked nor lost — it is simply still parked.
    assert_eq!(used_idx(&mut m), 0, "no partial completion emitted");
}

/// A machine with no in-flight work quiesces trivially and snapshots — the common case must not be
/// penalised by the quiesce gate.
#[test]
fn quiesce_is_a_noop_when_nothing_is_parked() {
    let (mut m, _ctx) = machine_with_backend(Box::new(MockWriteBack {
        data: vec![0u8; 64 * 512],
        durable: Rc::new(Cell::new(true)),
    }));
    m.quiesce().expect("empty in-flight set");
    assert!(m.save_resume().is_ok());
}
