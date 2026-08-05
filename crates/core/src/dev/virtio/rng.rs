//! virtio-rng entropy device (spec 1.2 §5.4) — DeviceID 4 on the E2-T08 transport, ring from
//! E2-T09. The guest's hardware RNG source: `CONFIG_HW_RANDOM_VIRTIO=y` binds it as `/dev/hwrng`,
//! and the kernel's `rng-core` thread feeds those bytes into the CRNG so `getrandom(2)` /
//! `/dev/urandom` seed promptly. Without it the guest CRNG must scavenge entropy from interrupt
//! timing jitter, which on the interpreter takes many seconds — long enough that early TLS
//! handshakes (openssl's `RAND_bytes` for the ClientHello) fail or stall. That was the E3-T19
//! guest-HTTPS flakiness; a real entropy source removes it.
//!
//! The protocol is the simplest of any virtio device: ONE virtqueue. The driver posts
//! device-writable buffers; the device fills each with random bytes and returns it with
//! `used.len` = bytes written. No config space, no negotiated feature bits beyond the transport's
//! `VIRTIO_F_VERSION_1`.
//!
//! **Kick plumbing** mirrors blk/net: `queue_notify` fires inside a guest MMIO store (bus
//! borrowed), so it only sets a flag; the Machine run loop calls [`service`] at the next
//! instruction boundary with the bus free.

use alloc::boxed::Box;
use alloc::rc::Rc;
use core::cell::RefCell;

use super::VirtioDevice;
use super::mmio::VirtioMmio;
use super::queue::Virtqueue;
use crate::bus::Bus;
use crate::mmio::SystemBus;

/// A source of random bytes for the guest's virtio-rng device. The host supplies a real CSPRNG:
/// `getrandom(2)` natively, `crypto.getRandomValues` in the browser. Tests use a deterministic
/// stub. `fill` must populate the whole slice (a CSPRNG never short-reads).
pub trait EntropySource {
    fn fill(&mut self, out: &mut [u8]);
}

/// Shared rng state: the entropy source + the deferred kick flag + a serviced-bytes counter for
/// tests/instrumentation.
pub struct RngState {
    source: Box<dyn EntropySource>,
    kicked: bool,
    /// Transport reset seen (Status=0) — the run loop drops its cached ring view (blk/net pattern).
    reset_pending: bool,
    /// Total random bytes delivered into guest buffers (lets a test prove the device actually fed
    /// entropy, and how much).
    pub bytes_served: u64,
}

/// Transport-facing half (owned by the VirtioMmio slot).
pub struct VirtioRngDev {
    state: Rc<RefCell<RngState>>,
}

impl VirtioDevice for VirtioRngDev {
    fn device_id(&self) -> u32 {
        4 // entropy
    }
    fn queue_notify(&mut self, _queue: u32) {
        // Bus is borrowed right now — defer to the run-loop boundary.
        self.state.borrow_mut().kicked = true;
    }
    fn reset(&mut self) {
        let mut st = self.state.borrow_mut();
        st.kicked = false;
        st.reset_pending = true; // run loop drops the cached ring view
    }
}

/// Create the device pair: the transport half (plug into a slot) + the shared state the Machine
/// keeps for servicing.
pub fn new(source: Box<dyn EntropySource>) -> (VirtioRngDev, Rc<RefCell<RngState>>) {
    let state = Rc::new(RefCell::new(RngState {
        source,
        kicked: false,
        reset_pending: false,
        bytes_served: 0,
    }));
    (
        VirtioRngDev {
            state: Rc::clone(&state),
        },
        state,
    )
}

/// Run-loop service: consume a pending kick, (re)build the queue-0 ring view when the driver has it
/// ready, then pop each posted buffer, fill its device-writable bytes with entropy, and publish it.
/// Ring violations degrade the slot via `protocol_violation` and drop the ring view (blk pattern).
pub fn service(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<RngState>>,
    bus: &mut SystemBus,
) {
    {
        let mut st = state.borrow_mut();
        // A Status=0 reset must drop the stale ring view even without a kick (blk critic round-1).
        if st.reset_pending {
            st.reset_pending = false;
            *vq = None;
        }
        if !st.kicked {
            return;
        }
        st.kicked = false;
    }
    let qs = *slot.borrow().queue(0);
    if !qs.ready {
        *vq = None;
        return;
    }
    if vq.is_none() {
        match Virtqueue::new(&qs, 256) {
            Ok(q) => *vq = Some(q),
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                return;
            }
        }
    }
    let q = vq.as_mut().expect("just constructed");
    let mut delivered_work = false;
    loop {
        match q.pop(bus) {
            Ok(Some(chain)) => {
                // Fill every device-writable byte of the chain with fresh entropy. A conforming
                // rng driver posts write-only buffers; any readable segment is simply ignored
                // (the queue engine already rejects readable-after-writable ordering).
                let mut written = 0u32;
                for seg in chain.writable() {
                    let mut buf = alloc::vec![0u8; seg.len as usize];
                    state.borrow_mut().source.fill(&mut buf);
                    let mut ok = true;
                    for (i, &byte) in buf.iter().enumerate() {
                        if bus.store8(seg.addr + i as u64, byte).is_err() {
                            ok = false;
                            break;
                        }
                    }
                    if !ok {
                        break;
                    }
                    written += seg.len;
                }
                state.borrow_mut().bytes_served += u64::from(written);
                if q.push_used(bus, chain.head, written).is_err() {
                    slot.borrow_mut().protocol_violation();
                    *vq = None;
                    return;
                }
                delivered_work = true;
            }
            Ok(None) => break,
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                *vq = None;
                return;
            }
        }
    }
    if delivered_work && vq.as_ref().is_some_and(|q| q.interrupt_needed(bus)) {
        slot.borrow_mut().raise_used_irq();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::virtio::mmio::{QueueState, VirtioMmio};
    use crate::dev::virtio::queue::Virtqueue;
    use crate::mmio::SystemBus;
    use crate::platform::virt::DRAM_BASE;
    use crate::ram::Ram;

    /// A deterministic counter "CSPRNG" so the test can assert the exact bytes the device wrote.
    struct CountingSource {
        next: u8,
    }
    impl EntropySource for CountingSource {
        fn fill(&mut self, out: &mut [u8]) {
            for byte in out.iter_mut() {
                *byte = self.next;
                self.next = self.next.wrapping_add(1);
            }
        }
    }

    // Ring layout inside a small guest RAM image, mirroring the virtqueue integration test.
    const DESC: u64 = DRAM_BASE + 0x1000;
    const AVAIL: u64 = DRAM_BASE + 0x2000;
    const USED: u64 = DRAM_BASE + 0x3000;
    const BUF: u64 = DRAM_BASE + 0x4000;

    fn write_desc(bus: &mut SystemBus, idx: u64, addr: u64, len: u32, flags: u16) {
        let base = DESC + 16 * idx;
        bus.store64(base, addr).unwrap();
        bus.store32(base + 8, len).unwrap();
        bus.store16(base + 12, flags).unwrap();
        bus.store16(base + 14, 0).unwrap();
    }

    #[test]
    fn fills_posted_buffer_with_entropy_and_publishes_used() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let (dev, state) = new(Box::new(CountingSource { next: 0xA0 }));
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(dev))));

        // One write-only 16-byte buffer posted on the avail ring.
        const LEN: u32 = 16;
        write_desc(&mut bus, 0, BUF, LEN, 2 /* DESC_F_WRITE */);
        bus.store16(AVAIL, 0).unwrap(); // flags
        bus.store16(AVAIL + 2, 1).unwrap(); // avail.idx = 1
        bus.store16(AVAIL + 4, 0).unwrap(); // ring[0] = desc 0

        // Bring the transport's queue 0 up pointing at our rings and mark it ready + kicked.
        slot.borrow_mut().set_queue_for_test(
            0,
            QueueState {
                num: 8,
                ready: true,
                desc: DESC,
                driver: AVAIL,
                device: USED,
            },
        );
        state.borrow_mut().kicked = true;

        let mut vq: Option<Virtqueue> = None;
        service(&slot, &mut vq, &state, &mut bus);

        // used.idx advanced to 1 and used[0] = { id: 0, len: 16 }.
        assert_eq!(bus.load16(USED + 2).unwrap(), 1, "used.idx advanced");
        assert_eq!(bus.load32(USED + 4).unwrap(), 0, "used elem id = head");
        assert_eq!(
            bus.load32(USED + 8).unwrap(),
            LEN,
            "used.len = bytes written"
        );
        assert_eq!(state.borrow().bytes_served, u64::from(LEN));

        // The buffer holds the deterministic entropy stream 0xA0, 0xA1, ...
        for i in 0..LEN as u64 {
            assert_eq!(bus.load8(BUF + i).unwrap(), 0xA0u8.wrapping_add(i as u8));
        }
    }
}
