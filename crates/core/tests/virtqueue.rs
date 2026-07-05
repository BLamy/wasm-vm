//! E2-T09 split-virtqueue suite: normal chains, the 2^16 idx wrap, fence-point ordering,
//! interrupt suppression, the full malformed-ring matrix, and the charter's hostile fuzzer.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::mmio::QueueState;
use wasm_vm_core::dev::virtio::queue::{Violation, Virtqueue};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;

const RAM: usize = 1024 * 1024;
// Ring layout in the synthetic guest image.
const DESC: u64 = DRAM_BASE + 0x1000;
const AVAIL: u64 = DRAM_BASE + 0x2000;
const USED: u64 = DRAM_BASE + 0x3000;
const DATA: u64 = DRAM_BASE + 0x10000;

fn bus() -> SystemBus {
    SystemBus::new(Ram::new(RAM).unwrap())
}
fn qs(num: u32) -> QueueState {
    QueueState {
        num,
        ready: true,
        desc: DESC,
        driver: AVAIL,
        device: USED,
    }
}
/// Write descriptor `i`: {addr, len, flags, next}.
fn wdesc(b: &mut SystemBus, i: u16, addr: u64, len: u32, flags: u16, next: u16) {
    let base = DESC + 16 * u64::from(i);
    b.store64(base, addr).unwrap();
    b.store32(base + 8, len).unwrap();
    b.store16(base + 12, flags).unwrap();
    b.store16(base + 14, next).unwrap();
}
/// Publish chain head `head` as avail entry `slot` and bump avail.idx to `idx`.
fn publish(b: &mut SystemBus, size: u16, seq: u16, head: u16) {
    b.store16(AVAIL + 4 + 2 * u64::from(seq % size), head)
        .unwrap();
    b.store16(AVAIL + 2, seq.wrapping_add(1)).unwrap();
}

const F_NEXT: u16 = 1;
const F_WRITE: u16 = 2;
const F_INDIRECT: u16 = 4;

#[test]
fn normal_chain_pops_and_used_publishes() {
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    // 3-segment chain: hdr(read) -> payload(read) -> status(write).
    wdesc(&mut b, 0, DATA, 16, F_NEXT, 1);
    wdesc(&mut b, 1, DATA + 0x100, 512, F_NEXT, 2);
    wdesc(&mut b, 2, DATA + 0x400, 1, F_WRITE, 0);
    publish(&mut b, 8, 0, 0);

    let chain = q.pop(&mut b).unwrap().expect("one chain");
    assert_eq!(chain.head, 0);
    assert_eq!(chain.segments.len(), 3);
    assert_eq!(chain.readable().count(), 2);
    assert_eq!(chain.writable().count(), 1);
    assert_eq!(chain.writable_len(), 1);
    assert!(q.pop(&mut b).unwrap().is_none(), "ring idle after one pop");

    q.push_used(&mut b, chain.head, 1).unwrap();
    assert_eq!(b.load16(USED + 2).unwrap(), 1, "used.idx published");
    assert_eq!(b.load32(USED + 4).unwrap(), 0, "id = head");
    assert_eq!(b.load32(USED + 8).unwrap(), 1, "len = written");
}

/// Acceptance: used.idx increments ONLY after the element is fully written — driven via
/// the split fence-point methods.
#[test]
fn used_element_before_idx_ordering() {
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, DATA, 4, F_WRITE, 0);
    publish(&mut b, 8, 0, 0);
    let chain = q.pop(&mut b).unwrap().unwrap();

    q.write_used_element(&mut b, chain.head, 4).unwrap();
    assert_eq!(b.load16(USED + 2).unwrap(), 0, "idx NOT yet published");
    assert_eq!(
        b.load32(USED + 4).unwrap(),
        0,
        "element already written (id)"
    );
    assert_eq!(
        b.load32(USED + 8).unwrap(),
        4,
        "element already written (len)"
    );
    q.publish_used_idx(&mut b).unwrap();
    assert_eq!(b.load16(USED + 2).unwrap(), 1, "idx published second");
}

/// Acceptance: idx wrap at 2^16 — drive 70,000 buffers through a size-8 queue.
#[test]
fn idx_wraps_at_65536() {
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, DATA, 8, 0, 0); // reusable single-descriptor chain
    for seq in 0u32..70_000 {
        publish(&mut b, 8, seq as u16, 0);
        let chain = q.pop(&mut b).unwrap().unwrap_or_else(|| {
            panic!("pop {seq} returned idle");
        });
        q.push_used(&mut b, chain.head, 0).unwrap();
    }
    // used.idx is free-running mod 2^16: 70000 % 65536 == 4464.
    assert_eq!(b.load16(USED + 2).unwrap(), (70_000u32 % 65_536) as u16);
}

/// Acceptance: NO_INTERRUPT suppression honored, next unsuppressed push interrupts.
#[test]
fn no_interrupt_suppression() {
    let mut b = bus();
    let q = Virtqueue::new(&qs(8), 256).unwrap();
    b.store16(AVAIL, 1).unwrap(); // avail.flags = NO_INTERRUPT
    assert!(!q.interrupt_needed(&mut b), "suppressed");
    b.store16(AVAIL, 0).unwrap();
    assert!(q.interrupt_needed(&mut b), "delivered when unsuppressed");
}

/// The malformed-ring matrix: each shape completes without panic/hang and reports the
/// documented Violation.
#[test]
fn malformed_ring_matrix() {
    // Self-loop: desc 0 -> desc 0 forever.
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, DATA, 8, F_NEXT, 0);
    publish(&mut b, 8, 0, 0);
    assert_eq!(q.pop(&mut b), Err(Violation::ChainTooLong), "self-loop");

    // next out of range.
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, DATA, 8, F_NEXT, 9);
    publish(&mut b, 8, 0, 0);
    assert_eq!(q.pop(&mut b), Err(Violation::BadDescIndex), "next >= qsz");

    // head out of range.
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    publish(&mut b, 8, 0, 8);
    assert_eq!(q.pop(&mut b), Err(Violation::BadDescIndex), "head >= qsz");

    // addr beyond DRAM.
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, DRAM_BASE + RAM as u64, 8, 0, 0);
    publish(&mut b, 8, 0, 0);
    assert_eq!(q.pop(&mut b), Err(Violation::BadAddress), "addr past DRAM");

    // len overflowing addr (wraps 2^64).
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, u64::MAX - 4, 64, 0, 0);
    publish(&mut b, 8, 0, 0);
    assert_eq!(q.pop(&mut b), Err(Violation::BadAddress), "addr+len wraps");

    // avail.idx jumping ahead by > qsz.
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, DATA, 8, 0, 0);
    b.store16(AVAIL + 2, 9).unwrap(); // 9 > qsz=8 ahead of last_avail=0
    assert_eq!(q.pop(&mut b), Err(Violation::AvailIdxJump), "idx jump");

    // INDIRECT (not offered).
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, DATA, 64, F_INDIRECT, 0);
    publish(&mut b, 8, 0, 0);
    assert_eq!(q.pop(&mut b), Err(Violation::Indirect), "indirect");

    // Readable AFTER writable (QEMU: incorrect order).
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, DATA, 8, F_WRITE | F_NEXT, 1);
    wdesc(&mut b, 1, DATA + 0x100, 8, 0, 0);
    publish(&mut b, 8, 0, 0);
    assert_eq!(
        q.pop(&mut b),
        Err(Violation::BadOrder),
        "readable after writable"
    );

    // Bad queue sizes at construction: 0, non-power-of-two, above max.
    assert_eq!(
        Virtqueue::new(&qs(0), 256).err(),
        Some(Violation::BadQueueSize)
    );
    assert_eq!(
        Virtqueue::new(&qs(6), 256).err(),
        Some(Violation::BadQueueSize)
    );
    assert_eq!(
        Virtqueue::new(&qs(512), 256).err(),
        Some(Violation::BadQueueSize)
    );
}

/// Zero-length descriptor: tolerated (QEMU maps it empty), any addr, chain still pops.
#[test]
fn zero_length_descriptor_tolerated() {
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, 0xDEAD_BEEF_0000, 0, F_NEXT, 1); // len 0: addr unchecked
    wdesc(&mut b, 1, DATA, 4, F_WRITE, 0);
    publish(&mut b, 8, 0, 0);
    let chain = q.pop(&mut b).unwrap().unwrap();
    assert_eq!(chain.segments.len(), 2);
    assert_eq!(chain.segments[0].len, 0);
}

/// Max-length chain (== qsz) pops fine; qsz+1 is impossible (loop guard fires first).
#[test]
fn max_length_chain() {
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    for i in 0u16..8 {
        let last = i == 7;
        wdesc(
            &mut b,
            i,
            DATA + 0x100 * u64::from(i),
            16,
            if last { F_WRITE } else { F_NEXT },
            if last { 0 } else { i + 1 },
        );
    }
    publish(&mut b, 8, 0, 0);
    let chain = q.pop(&mut b).unwrap().unwrap();
    assert_eq!(chain.segments.len(), 8);
}

/// Charter fuzzer: random descriptor tables/rings (~50% valid), 10^5 pop/push cycles —
/// no panic, no infinite loop (each pop is budgeted by construction: ≤ qsz hops), no OOB
/// host access (all guest writes go through the checked bus).
#[test]
fn hostile_ring_fuzz_1e5() {
    let mut b = bus();
    let mut x = 0x9E37_79B9_7F4A_7C15u64;
    let mut next = move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    let mut popped = 0u32;
    let mut violations = 0u32;
    for _round in 0..100_000u32 {
        let size = 8u16;
        // Fresh queue each round → publish sequence restarts at 0.
        let mut q = Virtqueue::new(&qs(u32::from(size)), 256).unwrap();
        let hostile = next() % 2 == 0;
        if hostile {
            // Garbage table: random addr/len/flags/next everywhere.
            for i in 0..size {
                wdesc(
                    &mut b,
                    i,
                    next(),
                    next() as u32,
                    (next() % 8) as u16,
                    (next() % (u64::from(size) + 2)) as u16,
                );
            }
            publish(&mut b, size, 0, (next() % (u64::from(size) + 1)) as u16);
        } else {
            // Valid random chain: 1..=3 in-DRAM descriptors, readable-then-writable order.
            let chain_len = 1 + (next() % 3) as u16;
            for i in 0..chain_len {
                let last = i == chain_len - 1;
                wdesc(
                    &mut b,
                    i,
                    DATA + (next() % 0x8000),
                    (next() % 512) as u32,
                    if last { F_WRITE } else { F_NEXT },
                    if last { 0 } else { i + 1 },
                );
            }
            publish(&mut b, size, 0, 0);
        }
        match q.pop(&mut b) {
            Ok(Some(chain)) => {
                popped += 1;
                let _ = q.push_used(&mut b, chain.head, (next() % 64) as u32);
            }
            Ok(None) => {}
            Err(_) => violations += 1,
        }
    }
    // Sanity: the fuzz actually exercised both paths.
    assert!(popped > 1000, "fuzz popped {popped}");
    assert!(violations > 1000, "fuzz rejected {violations}");
}
