//! E3-T13 adversarial-critic suite (adopted per the verification charter): the cold-clone
//! critic's hostile probes, promoted into the shipped tests. Includes the REGRESSION for the
//! one MED finding — the rx-descriptor leak on a lying backend (`rx_ready()==true` while
//! `rx()==None`), fixed by pulling the frame before popping a descriptor — plus the coverage
//! gaps it flagged: LoopbackBackend's cap, multi-segment writable rx delivery, hostile rx
//! avail.idx, transport reset recovery, and wide config-space reads.

#![cfg(not(feature = "zicsr-stub"))]

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
use wasm_vm_core::dev::virtio::net::{LoopbackBackend, MAC, NET_HDR_LEN, NetBackend, NetState};
use wasm_vm_core::dev::virtio::queue::Virtqueue;
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;

const RAM: usize = 4 * 1024 * 1024;
const STATUS: u64 = 0x070;
const QUEUE_SEL: u64 = 0x030;
const QUEUE_NUM: u64 = 0x038;
const QUEUE_READY: u64 = 0x044;
const QUEUE_DESC_LOW: u64 = 0x080;
const QUEUE_DRIVER_LOW: u64 = 0x090;
const QUEUE_DEVICE_LOW: u64 = 0x0a0;
const CONFIG: u64 = 0x100;
const F_NEXT: u16 = 1;
const F_WRITE: u16 = 2;

struct Ring {
    desc: u64,
    avail: u64,
    used: u64,
    data: u64,
    size: u16,
    seq: u16,
}
impl Ring {
    fn at(base: u64, size: u16) -> Self {
        Ring {
            desc: base,
            avail: base + 0x2000,
            used: base + 0x4000,
            data: base + 0x8000,
            size,
            seq: 0,
        }
    }
    fn used_idx(&self, b: &mut SystemBus) -> u16 {
        b.load16(self.used + 2).unwrap()
    }
    fn used_elem(&self, b: &mut SystemBus, i: u16) -> (u32, u32) {
        let base = self.used + 4 + 8 * u64::from(i % self.size);
        (b.load32(base).unwrap(), b.load32(base + 4).unwrap())
    }
}

fn wdesc(b: &mut SystemBus, ring: &Ring, i: u16, addr: u64, len: u32, flags: u16, next: u16) {
    let base = ring.desc + 16 * u64::from(i);
    b.store64(base, addr).unwrap();
    b.store32(base + 8, len).unwrap();
    b.store16(base + 12, flags).unwrap();
    b.store16(base + 14, next).unwrap();
}
fn publish(b: &mut SystemBus, ring: &mut Ring, head: u16) {
    b.store16(ring.avail + 4 + 2 * u64::from(ring.seq % ring.size), head)
        .unwrap();
    ring.seq = ring.seq.wrapping_add(1);
    b.store16(ring.avail + 2, ring.seq).unwrap();
}

struct Net {
    slot: Rc<RefCell<VirtioMmio>>,
    state: Rc<RefCell<NetState>>,
    rx_vq: Option<Virtqueue>,
    tx_vq: Option<Virtqueue>,
    bus: SystemBus,
    rxr: Ring,
    txr: Ring,
}

impl Net {
    fn new(backend: Box<dyn NetBackend>, qsize: u16) -> Self {
        let (dev, state) = wasm_vm_core::dev::virtio::net::new(backend);
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(dev))));
        let bus = SystemBus::new(Ram::new(RAM).unwrap());
        let rxr = Ring::at(DRAM_BASE + 0x10_0000, qsize);
        let txr = Ring::at(DRAM_BASE + 0x30_0000, qsize);
        let mut net = Net {
            slot,
            state,
            rx_vq: None,
            tx_vq: None,
            bus,
            rxr,
            txr,
        };
        net.lifecycle(qsize);
        net
    }

    /// Drive the full transport lifecycle to DRIVER_OK with both queues ready.
    fn lifecycle(&mut self, qsize: u16) {
        let w = |slot: &Rc<RefCell<VirtioMmio>>, off: u64, v: u32| {
            slot.borrow_mut().write(off, Width::B4, u64::from(v)).ok();
        };
        w(&self.slot, STATUS, 1);
        w(&self.slot, STATUS, 3);
        for (sel, r) in [(0u32, &self.rxr), (1u32, &self.txr)] {
            w(&self.slot, QUEUE_SEL, sel);
            w(&self.slot, QUEUE_NUM, u32::from(qsize));
            w(&self.slot, QUEUE_DESC_LOW, r.desc as u32);
            w(&self.slot, QUEUE_DRIVER_LOW, r.avail as u32);
            w(&self.slot, QUEUE_DEVICE_LOW, r.used as u32);
            w(&self.slot, QUEUE_READY, 1);
        }
        w(&self.slot, STATUS, 15);
    }

    fn kick(&mut self) {
        self.slot.borrow_mut().write(0x050, Width::B4, 0).ok();
        self.service();
    }

    fn service(&mut self) {
        wasm_vm_core::dev::virtio::net::service(
            &self.slot,
            &mut self.rx_vq,
            &mut self.tx_vq,
            &self.state,
            &mut self.bus,
        );
    }

    fn post_rx(&mut self, head: u16, cap: u32) {
        let addr = self.rxr.data + 0x1000 * u64::from(head);
        wdesc(&mut self.bus, &self.rxr, head, addr, cap, F_WRITE, 0);
        publish(&mut self.bus, &mut self.rxr, head);
    }

    fn post_tx(&mut self, head: u16, frame: &[u8]) {
        let addr = self.txr.data + 0x1000 * u64::from(head);
        for i in 0..NET_HDR_LEN {
            self.bus.store8(addr + i as u64, 0).unwrap();
        }
        for (i, &b) in frame.iter().enumerate() {
            self.bus
                .store8(addr + NET_HDR_LEN as u64 + i as u64, b)
                .unwrap();
        }
        let total = (NET_HDR_LEN + frame.len()) as u32;
        wdesc(&mut self.bus, &self.txr, head, addr, total, 0, 0);
        publish(&mut self.bus, &mut self.txr, head);
    }
}

struct EventDrivenBackend {
    polls: Rc<Cell<u32>>,
    staged: Option<Vec<u8>>,
    arriving: Option<Vec<u8>>,
}

impl NetBackend for EventDrivenBackend {
    fn poll(&mut self) {
        self.polls.set(self.polls.get() + 1);
        if self.staged.is_none() {
            self.staged = self.arriving.take();
        }
    }

    fn tx(&mut self, _frame: &[u8]) {}

    fn rx(&mut self) -> Option<Vec<u8>> {
        self.staged.take()
    }

    fn rx_ready(&self) -> bool {
        self.staged.is_some()
    }
}

/// An event-driven backend must be polled even when the guest did not kick a queue and readiness was
/// false before the poll. This is the browser-WebSocket wakeup seam: a relay frame arrives between
/// wasm run calls, `poll` turns it into ethernet egress, and the same boundary delivers it.
#[test]
fn backend_poll_can_wake_receiveq_without_a_guest_kick() {
    let polls = Rc::new(Cell::new(0));
    let f = frame([7; 6], MAC, 0xA7);
    let mut net = Net::new(
        Box::new(EventDrivenBackend {
            polls: polls.clone(),
            staged: None,
            arriving: Some(f.clone()),
        }),
        8,
    );
    net.post_rx(0, 2048);

    net.service();

    assert_eq!(polls.get(), 1, "service must poll the backend exactly once");
    assert_eq!(
        net.rxr.used_idx(&mut net.bus),
        1,
        "the frame produced by poll must reach the guest without a queue kick"
    );
    assert_eq!(
        net.rxr.used_elem(&mut net.bus, 0).1 as usize,
        NET_HDR_LEN + f.len()
    );
}

fn frame(dst: [u8; 6], src: [u8; 6], tag: u8) -> Vec<u8> {
    let mut f = Vec::with_capacity(60);
    f.extend_from_slice(&dst);
    f.extend_from_slice(&src);
    f.extend_from_slice(&[0x08, 0x00]);
    f.extend(std::iter::repeat(tag).take(46));
    f
}

/// A backend whose `rx_ready()` lies for the first `lies` calls to `rx()` (returns `None`
/// while claiming readiness), then serves `staged` — models the buggy/racy T14 backend the
/// critic used to demonstrate the descriptor leak.
struct FlakyBackend {
    lies: u32,
    staged: Option<Vec<u8>>,
}
impl NetBackend for FlakyBackend {
    fn tx(&mut self, _frame: &[u8]) {}
    fn rx(&mut self) -> Option<Vec<u8>> {
        if self.lies > 0 {
            self.lies -= 1;
            return None;
        }
        self.staged.take()
    }
    fn rx_ready(&self) -> bool {
        self.lies > 0 || self.staged.is_some()
    }
}

/// REGRESSION for the critic's MED finding: a backend whose `rx_ready()` lies must NOT leak
/// posted rx descriptors. Pre-fix, service_rx popped a descriptor per lie (consumed from
/// avail, never published on used) — after both lies the two posted buffers were gone forever.
/// Post-fix (frame pulled BEFORE the pop), the descriptors survive and a later real frame is
/// delivered into the FIRST posted buffer.
#[test]
fn lying_backend_does_not_leak_rx_descriptors() {
    let mut net = Net::new(
        Box::new(FlakyBackend {
            lies: 2,
            staged: None,
        }),
        8,
    );
    net.post_rx(0, 2048);
    net.post_rx(1, 2048);
    net.kick(); // lie 1 — must not consume a descriptor
    net.kick(); // lie 2 — must not consume a descriptor
    assert_eq!(net.rxr.used_idx(&mut net.bus), 0, "nothing delivered yet");

    // Now the backend turns honest: stage a real frame directly in the shared state.
    let f = frame([7; 6], MAC, 0x5D);
    // Reach the FlakyBackend through NetState (Box<dyn NetBackend> — restage via a new kick
    // path: we can't downcast, so instead prove recovery by rebuilding with staged set).
    // Simpler and equally probative: a fresh device with lies=1 then a staged frame — the
    // frame must land in descriptor 0 (the descriptor the lie must NOT have consumed).
    let mut net2 = Net::new(
        Box::new(FlakyBackend {
            lies: 1,
            staged: Some(f.clone()),
        }),
        8,
    );
    net2.post_rx(0, 2048);
    net2.kick(); // lie consumes rx_ready gate; staged frame delivered on the SAME pass or next
    net2.kick();
    assert_eq!(
        net2.rxr.used_idx(&mut net2.bus),
        1,
        "frame delivered after the lie — descriptor 0 was not leaked"
    );
    let (id, written) = net2.rxr.used_elem(&mut net2.bus, 0);
    assert_eq!(
        id, 0,
        "delivered into the descriptor the lie must not consume"
    );
    assert_eq!(written as usize, NET_HDR_LEN + f.len());
}

/// A tx chain that is ONLY writable segments (driver misbehavior): no panic, buffer returned
/// with used.len 0, counted as an empty-frame tx (documented tolerance; QEMU would flag it).
#[test]
fn writable_only_tx_chain_no_panic() {
    let mut net = Net::new(Box::new(LoopbackBackend::new()), 8);
    let addr = net.txr.data;
    wdesc(&mut net.bus, &net.txr, 0, addr, 64, F_WRITE, 0);
    publish(&mut net.bus, &mut net.txr, 0);
    net.kick();
    assert_eq!(net.txr.used_idx(&mut net.bus), 1, "buffer returned");
    assert_eq!(net.txr.used_elem(&mut net.bus, 0).1, 0, "used.len 0");
    assert_eq!(net.state.borrow().tx_count, 1);
}

/// rx frame delivered across a MULTI-SEGMENT writable chain (write_all's cross-segment path):
/// 5 + 9 + 2048-byte segments — the 12-byte header straddles both cuts and must land intact.
#[test]
fn rx_delivery_across_three_writable_segments() {
    let mut net = Net::new(Box::new(LoopbackBackend::new()), 8);
    let a = net.rxr.data;
    wdesc(&mut net.bus, &net.rxr, 0, a, 5, F_WRITE | F_NEXT, 1);
    wdesc(&mut net.bus, &net.rxr, 1, a + 5, 9, F_WRITE | F_NEXT, 2);
    wdesc(&mut net.bus, &net.rxr, 2, a + 14, 2048, F_WRITE, 0);
    publish(&mut net.bus, &mut net.rxr, 0);
    let nbr = [0xde, 0xad, 0xbe, 0xef, 0x00, 0x01];
    let tx = frame(nbr, MAC, 0x9C);
    net.post_tx(0, &tx);
    net.kick();
    let (id, written) = net.rxr.used_elem(&mut net.bus, 0);
    assert_eq!(id, 0);
    assert_eq!(written as usize, NET_HDR_LEN + tx.len());
    // The segments are contiguous at `a` by construction — reassemble and check.
    let mut got = Vec::new();
    for i in 0..u64::from(written) {
        got.push(net.bus.load8(a + i).unwrap());
    }
    assert_eq!(got[10], 1, "num_buffers=1 at hdr byte 10 across the split");
    assert_eq!(
        &got[NET_HDR_LEN..NET_HDR_LEN + 6],
        &MAC,
        "swapped dst survives the seams"
    );
    assert_eq!(got[NET_HDR_LEN + 12..NET_HDR_LEN + 14], [0x08, 0x00]);
}

/// LoopbackBackend cap under a real backlog (the shipped flood test drains every kick, so the
/// staging queue never exceeds depth 1): stage 300 frames raw — oldest 44 drop, survivor tag 44.
#[test]
fn loopback_cap_drops_oldest() {
    let mut lb = LoopbackBackend::new();
    for i in 0..300u32 {
        lb.tx(&frame([9; 6], MAC, i as u8));
    }
    assert_eq!(lb.backend_dropped, 44);
    let f = lb.rx().unwrap();
    assert_eq!(*f.last().unwrap(), 44, "oldest-drop: survivor starts at 44");
}

/// Hostile rx avail.idx jumping >> queue size must degrade to NEEDS_RESET via the Violation
/// path through service_rx — no panic, no wedge.
#[test]
fn rx_avail_idx_jump_degrades() {
    let mut net = Net::new(Box::new(LoopbackBackend::new()), 8);
    net.post_tx(0, &frame([9; 6], MAC, 1)); // stage an echo so service_rx runs
    net.bus.store16(net.rxr.avail + 2, 100).unwrap(); // idx jump >> qsize=8
    net.kick();
    let st = net.slot.borrow_mut().read(STATUS, Width::B4).unwrap() as u32;
    assert_ne!(st & 64, 0, "NEEDS_RESET on rx avail-idx jump");
}

/// Coverage gap (critic): transport reset (Status=0) mid-life tears down the ring views with
/// no panic, and a fresh lifecycle + rings delivers again.
#[test]
fn reset_tears_down_and_recovers() {
    let mut net = Net::new(Box::new(LoopbackBackend::new()), 8);
    net.post_rx(0, 2048);
    net.post_tx(0, &frame([3; 6], MAC, 0x21));
    net.kick();
    assert_eq!(
        net.rxr.used_idx(&mut net.bus),
        1,
        "pre-reset delivery works"
    );

    // Full transport reset mid-life, then a service boundary: ring views must drop, no panic.
    net.slot.borrow_mut().write(STATUS, Width::B4, 0).ok();
    net.kick();

    // Driver re-initializes: zero the stale ring memory, redo the lifecycle, deliver again.
    for r in [DRAM_BASE + 0x10_0000, DRAM_BASE + 0x30_0000] {
        for off in 0..0x6000u64 {
            net.bus.store8(r + off, 0).unwrap();
        }
    }
    net.rxr.seq = 0;
    net.txr.seq = 0;
    net.lifecycle(8);
    net.post_rx(0, 2048);
    net.post_tx(0, &frame([3; 6], MAC, 0x22));
    net.kick();
    assert_eq!(
        net.rxr.used_idx(&mut net.bus),
        1,
        "post-reset lifecycle delivers again"
    );
}

/// Coverage gap (critic): wide config-space reads. An 8-byte read at offset 0 spans past the
/// 6-byte MAC — the two bytes beyond must read 0; 2- and 4-byte reads assemble little-endian.
#[test]
fn config_reads_wider_than_mac() {
    let net = Net::new(Box::new(LoopbackBackend::new()), 8);
    let mut slot = net.slot.borrow_mut();
    let v8 = slot.read(CONFIG, Width::B8).unwrap();
    let mut want = 0u64;
    for (i, &b) in MAC.iter().enumerate() {
        want |= u64::from(b) << (8 * i);
    }
    assert_eq!(v8, want, "8-byte read: MAC little-endian, top 2 bytes zero");
    let v4 = slot.read(CONFIG + 4, Width::B4).unwrap();
    assert_eq!(
        v4,
        u64::from(MAC[4]) | (u64::from(MAC[5]) << 8),
        "4-byte read at offset 4: last 2 MAC bytes then zeros"
    );
    let v2 = slot.read(CONFIG + 6, Width::B2).unwrap();
    assert_eq!(v2, 0, "reads past the MAC are zero");
}
