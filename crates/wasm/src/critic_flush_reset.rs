//! CRITIC REPRO (E3-T08 claim 5): a `ChunkedBackend::flush_barrier` taken by a FLUSH that is
//! later DISCARDED by a transport reset is never cleared — the next FLUSH after re-setup adopts
//! the STALE barrier instead of taking a fresh one covering newer writes, and acks early.
//!
//! Sequence: write A → FLUSH-1 parks (barrier={A} held in the backend) → transport reset
//! (BlkState::parked cleared; backend untouched) → persist pump drains A → guest re-initializes,
//! writes C → FLUSH-2. Honest behavior: FLUSH-2 must wait for C. Actual: flush() sees the held
//! stale barrier {A}, finds it clear, drops it, commits, returns Ok → FLUSH-2 ACKS while C is
//! still unpersisted. A tab kill now loses C after the guest journal saw its flush complete.

#![allow(clippy::all)]

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use crate::chunked::ChunkedBackend;
use sha2::{Digest, Sha256};
use wasm_vm_core::bus::Bus;
use wasm_vm_core::platform::virt;
use wasm_vm_core::{Machine, RunOutcome};
use wasm_vm_storage::BlockCache;
use wasm_vm_storage::{
    FORMAT_VERSION, ImageManifest, Layout, OverlayDisk, PersistQueue, WriteBackOverlay,
};

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

fn tiny_manifest_store() -> (ImageManifest, Rc<RefCell<BlockCache>>) {
    let data: Vec<u8> = vec![0u8; 16 * 4096];
    let chunks: Vec<String> = data
        .chunks(4096)
        .map(|c| {
            let d = Sha256::digest(c);
            d.iter().map(|b| format!("{b:02x}")).collect()
        })
        .collect();
    let m = ImageManifest {
        version: FORMAT_VERSION,
        image_len: data.len() as u64,
        chunk_size: 4096,
        layout: Layout::Split,
        chunks,
    };
    assert_eq!(m.validate(), Ok(()));
    let store = Rc::new(RefCell::new(BlockCache::new(1 << 30)));
    for (i, c) in data.chunks(4096).enumerate() {
        store.borrow_mut().insert(i, c.to_vec());
    }
    (m, store)
}

fn setup_queue(m: &mut Machine) {
    let w = |m: &mut Machine, off: u64, v: u32| m.bus_mut().store32(SLOT0 + off, v).unwrap();
    w(m, 0x70, 1);
    w(m, 0x70, 3);
    w(m, 0x24, 0);
    w(m, 0x20, (1 << 9) | (1 << 5));
    w(m, 0x24, 1);
    w(m, 0x20, 1);
    w(m, 0x70, 11);
    w(m, 0x30, 0);
    w(m, 0x38, 8);
    w(m, 0x80, DESC as u32);
    w(m, 0x84, 0);
    w(m, 0x90, AVAIL as u32);
    w(m, 0x94, 0);
    w(m, 0xa0, USED as u32);
    w(m, 0xa4, 0);
    w(m, 0x44, 1);
    w(m, 0x70, 15);
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
fn submit(m: &mut Machine, seq: &mut u16, head: u16) {
    let a = AVAIL + 4 + 2 * u64::from(*seq % 8);
    m.bus_mut().store16(a, head).unwrap();
    *seq = seq.wrapping_add(1);
    m.bus_mut().store16(AVAIL + 2, *seq).unwrap();
    m.bus_mut().store32(SLOT0 + 0x50, 0).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
}
fn used_idx(m: &mut Machine) -> u16 {
    m.bus_mut().load16(USED + 2).unwrap()
}
fn zero_rings(m: &mut Machine) {
    for base in [DESC, AVAIL, USED] {
        for i in 0..0x100u64 {
            m.bus_mut().store8(base + i, 0).unwrap();
        }
    }
}

#[test]
fn stale_flush_barrier_survives_transport_reset_and_acks_early() {
    let (manifest, store) = tiny_manifest_store();
    let queue = Rc::new(RefCell::new(PersistQueue::new()));
    let overlay = WriteBackOverlay::with_shared_queue(&manifest, queue.clone(), BTreeMap::new());
    let disk = OverlayDisk::attach(overlay, &manifest).unwrap();
    let backend = ChunkedBackend::from_disk(disk, store);

    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let (_slot, state) = m.enable_virtio_blk(Box::new(backend));
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();
    let mut seq: u16 = 0;
    setup_queue(&mut m);

    // 1. Write A (sector 0 → overlay block 0) — completes, pending {0}.
    write_hdr(&mut m, 1, 0);
    for i in 0..512u64 {
        m.bus_mut().store8(DATA + i, 0xAA).unwrap();
    }
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 512, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut seq, 0);
    assert_eq!(used_idx(&mut m), 1, "write A completed");
    assert_eq!(queue.borrow().unpersisted_count(), 1);

    // 2. FLUSH-1 → parks; the backend now HOLDS barrier {block 0}.
    write_hdr(&mut m, 4, 0);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut seq, 0);
    assert_eq!(used_idx(&mut m), 1, "FLUSH-1 parked");
    assert!(state.borrow().flush_waiting());

    // 3. Transport reset: BlkState::parked is cleared — FLUSH-1 is dead. NOTHING tells the
    //    backend; ChunkedBackend::flush_barrier is still Some([0]).
    m.bus_mut().store32(SLOT0 + 0x70, 0).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    assert!(!state.borrow().flush_waiting(), "parked FLUSH-1 discarded");

    // 4. The persist pump drains block 0 (the STALE barrier's only block).
    let snap = queue.borrow().pending_flush();
    let pairs: Vec<(u64, u64)> = snap.iter().map(|(b, g, _)| (*b, *g)).collect();
    queue.borrow_mut().mark_persisted(&pairs);
    assert_eq!(queue.borrow().unpersisted_count(), 0);

    // 5. Guest re-initializes the device and queue.
    zero_rings(&mut m);
    seq = 0;
    setup_queue(&mut m);

    // 6. Write C (sector 16 → overlay block 2) — completes, pending {2}, NOT durable.
    write_hdr(&mut m, 1, 16);
    for i in 0..512u64 {
        m.bus_mut().store8(DATA + i, 0xCC).unwrap();
    }
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 512, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut seq, 0);
    assert_eq!(used_idx(&mut m), 1, "write C completed");
    assert_eq!(queue.borrow().unpersisted_count(), 1, "C not durable");

    // 7. FLUSH-2 covers write C. HONEST behavior: it must PARK until C durably commits.
    write_hdr(&mut m, 4, 0);
    m.bus_mut().store8(STATUS, 0x77).unwrap();
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut seq, 0);

    assert_eq!(
        used_idx(&mut m),
        1,
        "EARLY ACK: FLUSH-2 completed while write C ({} block(s)) is still unpersisted — \
         the stale barrier from discarded FLUSH-1 was adopted instead of taking a fresh one",
        queue.borrow().unpersisted_count()
    );
}

/// CRITIC PROBE (claim 3): two FLUSHes in flight WITHOUT a reset — write A, FLUSH-1 parks
/// (barrier {A}), write B, drain A only, FLUSH-2 arrives. Because service() retries parked
/// chains BEFORE fresh pops, FLUSH-1 (the barrier holder) always clears/acks first and FLUSH-2
/// then takes its own fresh barrier covering B. Expect: FLUSH-2 does NOT ack while B is pending.
#[test]
fn two_flushes_no_reset_second_flush_covers_newer_write() {
    let (manifest, store) = tiny_manifest_store();
    let queue = Rc::new(RefCell::new(PersistQueue::new()));
    let overlay = WriteBackOverlay::with_shared_queue(&manifest, queue.clone(), BTreeMap::new());
    let disk = OverlayDisk::attach(overlay, &manifest).unwrap();
    let backend = ChunkedBackend::from_disk(disk, store);

    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let (_slot, state) = m.enable_virtio_blk(Box::new(backend));
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();
    let mut seq: u16 = 0;
    setup_queue(&mut m);

    // Write A (block 0), FLUSH-1 parks with barrier {0}.
    write_hdr(&mut m, 1, 0);
    for i in 0..512u64 {
        m.bus_mut().store8(DATA + i, 0xAA).unwrap();
    }
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 512, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut seq, 0);
    assert_eq!(used_idx(&mut m), 1);
    write_hdr(&mut m, 4, 0);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut seq, 0);
    assert_eq!(used_idx(&mut m), 1, "FLUSH-1 parked");
    assert!(state.borrow().flush_waiting());

    // Write B (block 2) using descriptors 3..6 so the parked FLUSH-1 chain (desc 0,2) is untouched.
    write_hdr2(&mut m, 1, 16);
    for i in 0..512u64 {
        m.bus_mut().store8(DATA + 4096 + i, 0xBB).unwrap();
    }
    wdesc(&mut m, 3, HDR2, 16, F_NEXT, 4);
    wdesc(&mut m, 4, DATA + 4096, 512, F_NEXT, 5);
    wdesc(&mut m, 5, STATUS + 8, 1, F_WRITE, 0);
    submit(&mut m, &mut seq, 3);
    assert_eq!(
        used_idx(&mut m),
        2,
        "write B completed (out-of-order ahead of parked FLUSH-1)"
    );
    assert_eq!(queue.borrow().unpersisted_count(), 2);

    // Drain ONLY block 0 (A) — the persist round the barrier covers.
    let snap = queue.borrow().pending_flush();
    let only_a: Vec<(u64, u64)> = snap
        .iter()
        .filter(|(b, _, _)| *b == 0)
        .map(|(b, g, _)| (*b, *g))
        .collect();
    queue.borrow_mut().mark_persisted(&only_a);
    assert_eq!(queue.borrow().unpersisted_count(), 1, "B still pending");

    // FLUSH-2 (desc 6..8): covers write B. It must NOT ack while B is unpersisted.
    write_hdr2(&mut m, 4, 0);
    wdesc(&mut m, 6, HDR2, 16, F_NEXT, 7);
    wdesc(&mut m, 7, STATUS + 8, 1, F_WRITE, 0);
    submit(&mut m, &mut seq, 6);
    // This boundary: parked FLUSH-1 retried FIRST → barrier {0} clear → acks. Then FLUSH-2
    // fresh-popped → takes its own barrier {2} → parks.
    assert_eq!(
        used_idx(&mut m),
        3,
        "FLUSH-1 acked (its barrier {{A}} is durable)"
    );
    assert!(
        state.borrow().flush_waiting(),
        "FLUSH-2 must be parked awaiting write B — an ack here would be an early ack"
    );

    // Drain B → FLUSH-2 acks.
    let snap2 = queue.borrow().pending_flush();
    let p2: Vec<(u64, u64)> = snap2.iter().map(|(b, g, _)| (*b, *g)).collect();
    queue.borrow_mut().mark_persisted(&p2);
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    assert_eq!(used_idx(&mut m), 4, "FLUSH-2 acked only after B durable");
}

const HDR2: u64 = virt::DRAM_BASE + 0x16_0000;
fn write_hdr2(m: &mut Machine, rtype: u32, sector: u64) {
    m.bus_mut().store32(HDR2, rtype).unwrap();
    m.bus_mut().store32(HDR2 + 4, 0).unwrap();
    m.bus_mut().store64(HDR2 + 8, sector).unwrap();
}

/// CRITIC PROBE (claim 4): a chunk-parked read and a flush-park coexist — pending_chunks()
/// reports the chunk exactly once and never the flush.
#[test]
fn combined_chunk_and_flush_parks_report_only_the_chunk() {
    // Build the store WITHOUT chunk 5 so a read of sector 40 parks on it.
    let (manifest, _full) = tiny_manifest_store();
    let store = Rc::new(RefCell::new(BlockCache::new(1 << 30)));
    let data: Vec<u8> = vec![0u8; 16 * 4096];
    for (i, c) in data.chunks(4096).enumerate() {
        if i != 5 {
            store.borrow_mut().insert(i, c.to_vec());
        }
    }
    let queue = Rc::new(RefCell::new(PersistQueue::new()));
    let overlay = WriteBackOverlay::with_shared_queue(&manifest, queue.clone(), BTreeMap::new());
    let disk = OverlayDisk::attach(overlay, &manifest).unwrap();
    let backend = ChunkedBackend::from_disk(disk, store);

    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let (_slot, state) = m.enable_virtio_blk(Box::new(backend));
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();
    let mut seq: u16 = 0;
    setup_queue(&mut m);

    // Write A (block 0, resident chunk) → pending, then FLUSH parks.
    write_hdr(&mut m, 1, 0);
    for i in 0..512u64 {
        m.bus_mut().store8(DATA + i, 0xAA).unwrap();
    }
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 1);
    wdesc(&mut m, 1, DATA, 512, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut seq, 0);
    assert_eq!(used_idx(&mut m), 1);
    write_hdr(&mut m, 4, 0);
    wdesc(&mut m, 0, HDR, 16, F_NEXT, 2);
    wdesc(&mut m, 2, STATUS, 1, F_WRITE, 0);
    submit(&mut m, &mut seq, 0);
    assert_eq!(used_idx(&mut m), 1, "FLUSH parked");

    // Read sector 40 (chunk 5, absent) → chunk-park.
    write_hdr2(&mut m, 0, 40); // T_IN
    wdesc(&mut m, 3, HDR2, 16, F_NEXT, 4);
    wdesc(&mut m, 4, DATA + 8192, 512, F_NEXT | F_WRITE, 5);
    wdesc(&mut m, 5, STATUS + 8, 1, F_WRITE, 0);
    submit(&mut m, &mut seq, 3);
    assert_eq!(used_idx(&mut m), 1, "read parked on chunk 5");
    assert!(state.borrow().flush_waiting());
    assert_eq!(
        state.borrow().pending_chunks(),
        vec![5],
        "chunk reported once; flush park never reported"
    );
}
