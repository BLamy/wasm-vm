//! E3-T08 ordering contract (native, mock backend): a `VIRTIO_BLK_T_FLUSH` is only completed
//! on the used ring after the backend's durable commit resolves. A delayed commit provably
//! delays the used-ring completion; the ack arrives exactly once when the commit lands; a
//! parked FLUSH is never reported to the chunk-fetch layer.

#![cfg(not(feature = "zicsr-stub"))]

use std::cell::Cell;
use std::rc::Rc;

use wasm_vm_core::block::{BlockBackend, BlockError};
use wasm_vm_core::bus::Bus;
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

/// Write-back mock: writes are accepted into memory but "durable" only after the test calls
/// `make_durable()` — `flush()` returns `FlushPending` until then, then `Ok` exactly like the
/// E3-T05 WriteBackOverlay + barrier path. `commits` counts flushes that RESOLVED (the honest
/// commit count the acceptance criterion reads — NOT attempts).
struct MockWriteBack {
    data: Vec<u8>,
    durable: Rc<Cell<bool>>,
    commits: Rc<Cell<u64>>,
    flush_attempts: Rc<Cell<u64>>,
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
        self.durable.set(false); // new write-back data → not durable until the async store lands
        Ok(())
    }
    fn flush(&mut self) -> Result<(), BlockError> {
        self.flush_attempts.set(self.flush_attempts.get() + 1);
        if self.durable.get() {
            self.commits.set(self.commits.get() + 1);
            Ok(())
        } else {
            Err(BlockError::FlushPending)
        }
    }
    fn is_read_only(&self) -> bool {
        false
    }
}

struct Ctx {
    slot: Rc<std::cell::RefCell<wasm_vm_core::dev::virtio::mmio::VirtioMmio>>,
    state: Rc<std::cell::RefCell<wasm_vm_core::dev::virtio::blk::BlkState>>,
    seq: u16,
}

fn machine() -> (Machine, Ctx, Rc<Cell<bool>>, Rc<Cell<u64>>, Rc<Cell<u64>>) {
    let durable = Rc::new(Cell::new(true));
    let commits = Rc::new(Cell::new(0));
    let attempts = Rc::new(Cell::new(0));
    let backend = MockWriteBack {
        data: vec![0u8; 64 * 512],
        durable: Rc::clone(&durable),
        commits: Rc::clone(&commits),
        flush_attempts: Rc::clone(&attempts),
    };
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let (slot, state) = m.enable_virtio_blk(Box::new(backend));
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();
    // Driver lifecycle + queue 0 setup over the real registers (virtio_blk.rs pattern).
    let w = |m: &mut Machine, off: u64, v: u32| m.bus_mut().store32(SLOT0 + off, v).unwrap();
    w(&mut m, 0x70, 1);
    w(&mut m, 0x70, 3);
    w(&mut m, 0x24, 0);
    w(&mut m, 0x20, (1 << 9) | (1 << 5)); // accept FLUSH (+RO harmlessly if offered)
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
    (
        m,
        Ctx {
            slot,
            state,
            seq: 0,
        },
        durable,
        commits,
        attempts,
    )
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

/// The acceptance ordering test: a delayed commit provably delays the FLUSH's used-ring
/// completion; the ack lands exactly once when the commit resolves; the status byte is written
/// only then.
#[test]
fn flush_ack_waits_for_durable_commit() {
    let (mut m, mut ctx, durable, commits, _attempts) = machine();

    // A write makes the backend non-durable (write-back data pending).
    write_hdr(&mut m, 1, 3); // T_OUT sector 3
    for i in 0..512u64 {
        m.bus_mut().store8(DATA + i, 0xAB).unwrap();
    }
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 512, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut ctx, 0);
    assert_eq!(used_idx(&mut m), 1, "write completed");
    assert!(!durable.get(), "write-back data now pending durability");

    // FLUSH: header + status only. The commit has NOT resolved → the request must PARK.
    write_hdr(&mut m, 4, 0); // T_FLUSH
    m.bus_mut().store8(STATUS, 0x77).unwrap(); // poison the status byte to detect early writes
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut ctx, 0);
    assert_eq!(used_idx(&mut m), 1, "FLUSH NOT acked while commit pending");
    assert_eq!(
        m.bus_mut().load8(STATUS).unwrap(),
        0x77,
        "status byte untouched while parked"
    );
    assert_eq!(commits.get(), 0, "no commit resolved yet");
    assert!(
        ctx.state.borrow().flush_waiting(),
        "device reports a parked FLUSH"
    );
    assert!(
        ctx.state.borrow().pending_chunks().is_empty(),
        "a parked FLUSH is NOT a pending chunk (never reported to the fetch layer)"
    );

    // Several boundaries pass; still not durable → still parked (retries are idempotent).
    for _ in 0..5 {
        assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    }
    assert_eq!(used_idx(&mut m), 1, "still parked across boundaries");

    // The async store lands the data → the very next boundary acks the FLUSH exactly once.
    durable.set(true);
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    assert_eq!(used_idx(&mut m), 2, "FLUSH acked after durable commit");
    assert_eq!(m.bus_mut().load8(STATUS).unwrap(), 0, "S_OK written");
    assert_eq!(commits.get(), 1, "exactly one resolved commit");
    assert!(!ctx.state.borrow().flush_waiting());
    assert!(ctx.slot.borrow().irq_level(), "completion raised the IRQ");

    // No double-completion on later boundaries.
    for _ in 0..5 {
        assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    }
    assert_eq!(used_idx(&mut m), 2, "acked exactly once");
    assert_eq!(commits.get(), 1);
}

/// A FLUSH when everything is already durable acks immediately (no park, single boundary).
#[test]
fn flush_immediate_when_durable() {
    let (mut m, mut ctx, durable, commits, attempts) = machine();
    assert!(durable.get());
    write_hdr(&mut m, 4, 0);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut ctx, 0);
    assert_eq!(used_idx(&mut m), 1, "acked same boundary");
    assert_eq!(commits.get(), 1);
    assert_eq!(attempts.get(), 1, "single attempt, no retries");
}

/// Transport reset while a FLUSH is parked: the parked chain is discarded (its descriptors
/// belong to the torn-down queue) — no stale ack after re-setup.
#[test]
fn reset_discards_parked_flush() {
    let (mut m, mut ctx, durable, commits, _attempts) = machine();
    // Make non-durable + park a FLUSH.
    write_hdr(&mut m, 1, 3);
    for i in 0..512u64 {
        m.bus_mut().store8(DATA + i, 1).unwrap();
    }
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 512, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut ctx, 0);
    write_hdr(&mut m, 4, 0);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut ctx, 0);
    assert!(ctx.state.borrow().flush_waiting());

    // Full transport reset, then make durable and run: the OLD flush must never complete.
    m.bus_mut().store32(SLOT0 + 0x70, 0).unwrap();
    durable.set(true);
    for _ in 0..5 {
        assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    }
    assert!(
        !ctx.state.borrow().flush_waiting(),
        "parked FLUSH discarded"
    );
    assert_eq!(commits.get(), 0, "no commit resolved for a discarded FLUSH");
}
