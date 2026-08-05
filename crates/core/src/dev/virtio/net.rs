//! virtio-net device (E3-T13, spec 1.2 §5.1) — DeviceID 1 on the E2-T08 transport, rings
//! from E2-T09. Two virtqueues: receiveq (queue 0) and transmitq (queue 1). Ethernet frames
//! cross to/from a pluggable [`NetBackend`] as plain `Vec<u8>` — the device owns the
//! `virtio_net_hdr`, the backend never sees it.
//!
//! **Header size — the classic off-by-two.** We do NOT offer `VIRTIO_NET_F_MRG_RXBUF`, but the
//! transport ALWAYS negotiates `VIRTIO_F_VERSION_1`, and Linux's `virtio_net` sizes its header
//! `sizeof(virtio_net_hdr_mrg_rxbuf)` (12 bytes, including `num_buffers`) whenever *either*
//! MRG_RXBUF *or* VERSION_1 is negotiated (`virtnet_probe`: `vi->hdr_len = ...`). So the header
//! is **12 bytes**, not the 10-byte legacy `virtio_net_hdr` — using 10 here would shift every
//! frame by two bytes and corrupt all traffic. `num_buffers` is always 1 (we never merge).
//!
//! **Features offered:** `VIRTIO_F_VERSION_1` (transport) + `VIRTIO_NET_F_MAC` (fixed MAC in
//! config space). **Declined (v1 scope, documented per the task):** `VIRTIO_NET_F_MRG_RXBUF`
//! (simpler single-descriptor rx buffers), checksum/TSO/GSO offloads (the loopback/slirp path
//! needs none), the control virtqueue `VIRTIO_NET_F_CTRL_VQ` and `VIRTIO_NET_F_STATUS` (driver
//! assumes link-up; no rx-mode control). Minimal set the stock driver drives with exactly two
//! queues.
//!
//! **rx starvation:** frames arriving while the guest has posted no free receiveq descriptor are
//! DROPPED and counted ([`NetState::rx_dropped`]), never queued unboundedly — the guest recovers
//! the moment it reposts buffers.
//!
//! **Kick plumbing** mirrors virtio-blk: `queue_notify` fires inside a guest MMIO store (bus
//! borrowed) so it only sets a flag; the Machine run loop calls [`service`] at the next
//! instruction boundary with the bus free.

use alloc::boxed::Box;
use alloc::rc::Rc;
use alloc::vec::Vec;
use core::cell::RefCell;

use super::VirtioDevice;
use super::mmio::VirtioMmio;
use super::queue::{DescriptorChain, Virtqueue};
use crate::bus::Bus;
use crate::mmio::SystemBus;

/// Queue indices (virtio-net convention): receiveq first, transmitq second.
pub const RX_QUEUE: u32 = 0;
pub const TX_QUEUE: u32 = 1;

/// Feature bit (§5.1.3): the device has a fixed MAC in config space.
pub const VIRTIO_NET_F_MAC: u64 = 1 << 5;

/// `virtio_net_hdr_mrg_rxbuf` size — 12 bytes under VERSION_1 (see module docs). The device
/// prepends this to every rx frame and skips it on every tx frame.
pub const NET_HDR_LEN: usize = 12;
/// Byte offset of `num_buffers` (le16) within the header.
const NET_HDR_NUM_BUFFERS_OFF: usize = 10;

/// Fixed locally-administered MAC (52:54:00 = QEMU's OUI; the `x2` bit marks it locally
/// administered, so it never collides with a real NIC).
pub const MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];

/// Loopback's bounded rx staging depth — frames beyond this are dropped at the backend
/// (adversarial: flooding rx must not grow the heap).
const LOOPBACK_CAP: usize = 256;

/// The seam between the virtio-net DEVICE and the outside "network" (a loopback echo now, a
/// slirp user-space TCP/IP stack in E3-T14). Every frame crosses as a plain ethernet frame
/// `Vec<u8>` — **no** `virtio_net_hdr` (the device owns that). Method names are the DEVICE's view.
///
/// **Contract (critic advisory, binding on T14):** `tx`/`rx`/`rx_ready` must NOT re-enter the
/// device state ([`NetState`] or the mmio slot) — they are called while the device holds its
/// `RefCell` borrow (including inside a guest MMIO store during `reset`), so re-entry panics.
pub trait NetBackend {
    /// Give an event-driven backend a chance to advance work that arrived independently of a guest
    /// transmit. The run loop calls this before checking [`Self::rx_ready`]. Synchronous backends
    /// need no maintenance and inherit the no-op default; browser slirp uses it to drain WebSocket
    /// frames into its guest-facing receive queue.
    fn poll(&mut self) {}
    /// True while this backend is waiting for work that can arrive only from outside the
    /// deterministic guest machine (for example a browser WebSocket callback). A WFI must not
    /// fast-forward guest time straight to its next timer deadline while this is true: the host
    /// needs a run-chunk boundary to deliver that external event first.
    fn external_io_pending(&self) -> bool {
        false
    }
    /// Guest → network: the device hands over one ethernet frame the guest just transmitted
    /// (the `virtio_net_hdr` already stripped). Loopback swaps src/dst MAC and stages it for
    /// the guest to receive back; slirp (T14) will feed it into its IP stack. (Task seam name:
    /// the consumer half of `pop_frame_from_guest`.)
    fn tx(&mut self, frame: &[u8]);
    /// Network → guest: the next ethernet frame to deliver to the guest, or `None` if nothing
    /// is pending. The device prepends the `virtio_net_hdr`. (Task seam name: the consumer half
    /// of `push_frame_to_guest`.)
    fn rx(&mut self) -> Option<Vec<u8>>;
    /// Readiness callback: does [`Self::rx`] have a frame ready right now? Lets the run loop
    /// service the receiveq for asynchronously-arriving frames without popping a descriptor.
    fn rx_ready(&self) -> bool;
}

/// The v1 loopback backend: echoes every transmitted frame back to the guest with src/dst MAC
/// swapped (so an ARP/ping to a made-up neighbor returns as if the neighbor answered). Proves
/// the rx/tx paths before any real network stack exists. The staging queue is bounded
/// ([`LOOPBACK_CAP`]); overflow drops the OLDEST frame and counts it, so a guest that stops
/// draining rx cannot grow the host heap.
#[derive(Default)]
pub struct LoopbackBackend {
    staged: alloc::collections::VecDeque<Vec<u8>>,
    /// Frames dropped at the backend because the staging queue was full.
    pub backend_dropped: u64,
}

impl LoopbackBackend {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Swap the destination (bytes 0..6) and source (bytes 6..12) MAC of an ethernet frame in place.
/// A runt shorter than 12 bytes is passed through unchanged (nothing to swap).
fn swap_macs(frame: &mut [u8]) {
    if frame.len() >= 12 {
        for i in 0..6 {
            frame.swap(i, i + 6);
        }
    }
}

impl NetBackend for LoopbackBackend {
    fn tx(&mut self, frame: &[u8]) {
        let mut echoed = frame.to_vec();
        swap_macs(&mut echoed);
        if self.staged.len() >= LOOPBACK_CAP {
            self.staged.pop_front();
            self.backend_dropped += 1;
        }
        self.staged.push_back(echoed);
    }
    fn rx(&mut self) -> Option<Vec<u8>> {
        self.staged.pop_front()
    }
    fn rx_ready(&self) -> bool {
        !self.staged.is_empty()
    }
}

/// Test/diagnostic decorator (E3-T13 deliverable): wraps any [`NetBackend`] and records every
/// frame that crosses in EITHER direction into an in-memory pcap byte buffer for offline
/// inspection (`tcpdump -r`, wireshark). tx frames are captured as the guest emits them; rx
/// frames are captured as the device pulls them from the inner backend — so a loopback capture
/// shows both directions of a ping. Timestamps are a deterministic monotonic counter (no clock
/// — the core crate is deterministic; wall-clock lives in the host).
///
/// **Test/diagnostic use only:** the capture buffer grows without bound (critic advisory) — do
/// not wire this into a long-lived session; use it for bounded acceptance captures.
pub struct PcapBackend<B: NetBackend> {
    inner: B,
    pcap: Vec<u8>,
    /// Monotonic fake-microsecond stamp so records are ordered without a clock dependency.
    tick: u32,
}

impl<B: NetBackend> PcapBackend<B> {
    /// Wrap `inner`, emitting the pcap global header (LINKTYPE_ETHERNET, little-endian).
    pub fn new(inner: B) -> Self {
        let mut pcap = Vec::new();
        // Global header: magic, version 2.4, thiszone 0, sigfigs 0, snaplen 65535, network 1.
        pcap.extend_from_slice(&0xa1b2c3d4u32.to_le_bytes());
        pcap.extend_from_slice(&2u16.to_le_bytes());
        pcap.extend_from_slice(&4u16.to_le_bytes());
        pcap.extend_from_slice(&0i32.to_le_bytes());
        pcap.extend_from_slice(&0u32.to_le_bytes());
        pcap.extend_from_slice(&65535u32.to_le_bytes());
        pcap.extend_from_slice(&1u32.to_le_bytes()); // LINKTYPE_ETHERNET
        Self {
            inner,
            pcap,
            tick: 0,
        }
    }

    /// The pcap bytes captured so far (a complete, parseable file).
    pub fn pcap(&self) -> &[u8] {
        &self.pcap
    }

    /// Number of frames captured (records after the 24-byte global header).
    pub fn frame_count(&self) -> usize {
        let mut off = 24usize;
        let mut n = 0;
        while off + 16 <= self.pcap.len() {
            let incl =
                u32::from_le_bytes(self.pcap[off + 8..off + 12].try_into().unwrap()) as usize;
            off += 16 + incl;
            n += 1;
        }
        n
    }

    fn record(&mut self, frame: &[u8]) {
        let ts = self.tick;
        self.tick += 1;
        self.pcap.extend_from_slice(&ts.to_le_bytes()); // ts_sec (monotonic tick)
        self.pcap.extend_from_slice(&0u32.to_le_bytes()); // ts_usec
        self.pcap
            .extend_from_slice(&(frame.len() as u32).to_le_bytes()); // incl_len
        self.pcap
            .extend_from_slice(&(frame.len() as u32).to_le_bytes()); // orig_len
        self.pcap.extend_from_slice(frame);
    }
}

impl<B: NetBackend> NetBackend for PcapBackend<B> {
    fn poll(&mut self) {
        self.inner.poll();
    }
    fn external_io_pending(&self) -> bool {
        self.inner.external_io_pending()
    }
    fn tx(&mut self, frame: &[u8]) {
        self.record(frame);
        self.inner.tx(frame);
    }
    fn rx(&mut self) -> Option<Vec<u8>> {
        let f = self.inner.rx();
        if let Some(frame) = &f {
            self.record(frame);
        }
        f
    }
    fn rx_ready(&self) -> bool {
        self.inner.rx_ready()
    }
}

/// Shared net state: the backend + the deferred kick flag + drop accounting.
pub struct NetState {
    pub backend: Box<dyn NetBackend>,
    kicked: bool,
    /// Transport reset seen (Status=0) — the run loop drops its cached ring views (blk pattern).
    reset_pending: bool,
    /// rx frames dropped because the guest had no free receiveq descriptor (or the frame did
    /// not fit the posted buffer). Bounded-memory guarantee: this grows, the heap does not.
    pub rx_dropped: u64,
    /// tx frames delivered to the backend (instrumentation for tests / future FLUSH accounting).
    pub tx_count: u64,
    /// rx frames delivered into a guest buffer.
    pub rx_count: u64,
}

impl NetState {
    /// True when [`service`] has work to do without a fresh kick — an asynchronously-arrived
    /// rx frame the run loop should deliver this boundary.
    pub fn rx_ready(&self) -> bool {
        self.backend.rx_ready()
    }
}

/// Transport-facing half (owned by the VirtioMmio slot).
pub struct VirtioNetDev {
    state: Rc<RefCell<NetState>>,
}

impl VirtioDevice for VirtioNetDev {
    fn device_id(&self) -> u32 {
        1 // network
    }
    fn device_features(&self) -> u64 {
        VIRTIO_NET_F_MAC
    }
    fn num_queues(&self) -> u32 {
        2 // receiveq (0) + transmitq (1); no control queue in v1
    }
    fn queue_notify(&mut self, _queue: u32) {
        // Bus is borrowed right now — defer to the run-loop boundary. Either queue's kick
        // services both (they share the slot).
        self.state.borrow_mut().kicked = true;
    }
    fn config_read(&mut self, offset: u64, width: u8) -> u64 {
        // Config space is just the 6-byte MAC at offset 0 (no STATUS/MQ fields offered).
        let mut v = 0u64;
        for i in 0..width {
            let off = offset + u64::from(i);
            let b = if off < 6 { MAC[off as usize] } else { 0 };
            v |= u64::from(b) << (8 * i);
        }
        v
    }
    fn reset(&mut self) {
        let mut st = self.state.borrow_mut();
        st.kicked = false;
        st.reset_pending = true;
        // Drop any frames the backend staged for the torn-down queue: their destination
        // descriptors belong to a ring being reinitialized (driver reload / reboot).
        while st.backend.rx().is_some() {}
    }
}

/// Create the device pair: the transport half (plug into a slot) + the shared state the Machine
/// keeps for servicing.
pub fn new(backend: Box<dyn NetBackend>) -> (VirtioNetDev, Rc<RefCell<NetState>>) {
    let state = Rc::new(RefCell::new(NetState {
        backend,
        kicked: false,
        reset_pending: false,
        rx_dropped: 0,
        tx_count: 0,
        rx_count: 0,
    }));
    (
        VirtioNetDev {
            state: Rc::clone(&state),
        },
        state,
    )
}

/// Collect every device-readable byte of `chain` from guest memory into a `Vec` (frames are
/// small — MTU-scale — so a copy is cheap and lets header/frame split across any descriptor
/// boundary parse identically). `None` on a bad guest address.
fn read_all(chain: &DescriptorChain, bus: &mut SystemBus) -> Option<Vec<u8>> {
    let total: u64 = chain.readable().map(|s| u64::from(s.len)).sum();
    let mut out = Vec::with_capacity(total as usize);
    for seg in chain.readable() {
        for i in 0..u64::from(seg.len) {
            out.push(bus.load8(seg.addr + i).ok()?);
        }
    }
    Some(out)
}

/// Write `data` across `chain`'s device-writable segments in order. Returns `false` if `data`
/// exceeds the writable capacity (frame too big for the posted rx buffer — a drop) or a store
/// faults.
fn write_all(chain: &DescriptorChain, bus: &mut SystemBus, data: &[u8]) -> bool {
    if data.len() as u64 > chain.writable_len() {
        return false;
    }
    let mut pos = 0usize;
    for seg in chain.writable() {
        for i in 0..u64::from(seg.len) {
            if pos >= data.len() {
                return true;
            }
            if bus.store8(seg.addr + i, data[pos]).is_err() {
                return false;
            }
            pos += 1;
        }
    }
    true
}

/// Build the `virtio_net_hdr` (12 bytes) for a delivered rx frame: all zero (no offloads,
/// GSO_NONE) except `num_buffers = 1` (we never merge buffers).
fn rx_header() -> [u8; NET_HDR_LEN] {
    let mut h = [0u8; NET_HDR_LEN];
    h[NET_HDR_NUM_BUFFERS_OFF] = 1; // num_buffers = 1 (le16)
    h
}

/// Process the transmitq: drain every guest-posted tx chain, hand its frame to the backend, and
/// return each descriptor on the used ring (`used.len = 0` — the device wrote nothing to guest
/// memory on tx). Returns whether any buffer was used, or a ring [`Violation`] to degrade on.
fn service_tx(
    tx: &mut Virtqueue,
    state: &Rc<RefCell<NetState>>,
    bus: &mut SystemBus,
) -> Result<bool, super::queue::Violation> {
    let mut used = false;
    while let Some(chain) = tx.pop(bus)? {
        if let Some(buf) = read_all(&chain, bus) {
            // The frame is everything after the 12-byte virtio_net_hdr. A chain with a
            // short/absent header carries no frame — still return the buffer so we never
            // wedge the ring.
            let frame = if buf.len() > NET_HDR_LEN {
                &buf[NET_HDR_LEN..]
            } else {
                &[][..]
            };
            let mut st = state.borrow_mut();
            st.backend.tx(frame);
            st.tx_count += 1;
        }
        tx.push_used(bus, chain.head, 0)?;
        used = true;
    }
    Ok(used)
}

/// Process the receiveq: deliver backend frames into guest-posted rx buffers, prepending the
/// `virtio_net_hdr`. A frame with no free rx descriptor (or too large for the posted buffer) is
/// DROPPED and counted — bounded memory, guest recovers on repost. Returns whether any buffer
/// was used, or a ring [`Violation`].
fn service_rx(
    rx: &mut Virtqueue,
    state: &Rc<RefCell<NetState>>,
    bus: &mut SystemBus,
) -> Result<bool, super::queue::Violation> {
    let mut used = false;
    loop {
        if !state.borrow().backend.rx_ready() {
            break;
        }
        // Pull the frame BEFORE popping a descriptor (critic MED, E3-T13 pass 1): a guest
        // buffer is only consumed once we hold a real frame, so a backend whose `rx_ready()`
        // lies (returns true while `rx()` yields `None` — a buggy/racy T14 backend) can never
        // leak a posted rx descriptor. The old pop-then-pull order silently lost a descriptor
        // per lie: consumed from avail, never published on used.
        let frame = match state.borrow_mut().backend.rx() {
            Some(f) => f,
            None => break, // rx_ready lied; no descriptor was touched
        };
        match rx.pop(bus)? {
            Some(chain) => {
                let mut buf = Vec::with_capacity(NET_HDR_LEN + frame.len());
                buf.extend_from_slice(&rx_header());
                buf.extend_from_slice(&frame);
                if write_all(&chain, bus, &buf) {
                    rx.push_used(bus, chain.head, buf.len() as u32)?;
                    state.borrow_mut().rx_count += 1;
                } else {
                    // Frame did not fit the posted buffer: drop it, but STILL return the
                    // descriptor (len 0) so the guest's buffer isn't stranded. Linux's
                    // virtnet guards len < hdr_len first (pr_debug + rx_length_errors++ +
                    // repost) — graceful; QEMU without MRG_RXBUF virtio_error()s instead,
                    // which is worse (critic claim 5: documented deviation, keep ours).
                    rx.push_used(bus, chain.head, 0)?;
                    state.borrow_mut().rx_dropped += 1;
                }
                used = true;
            }
            None => {
                // No free rx descriptor: the frame we hold is dropped (counted). Looping
                // drains the whole backlog so the backend queue — and the host heap — stays
                // bounded.
                state.borrow_mut().rx_dropped += 1;
            }
        }
    }
    Ok(used)
}

/// Run-loop service: consume a pending kick (or an async rx frame), (re)build the two ring
/// views, drain tx then rx, and raise the used-ring interrupt if buffers were used and the
/// driver did not suppress it. Ring [`Violation`]s degrade the slot via `protocol_violation`
/// and drop the ring views (blk pattern).
pub fn service(
    slot: &Rc<RefCell<VirtioMmio>>,
    rx_vq: &mut Option<Virtqueue>,
    tx_vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<NetState>>,
    bus: &mut SystemBus,
) {
    {
        let mut st = state.borrow_mut();
        if st.reset_pending {
            st.reset_pending = false;
            *rx_vq = None;
            *tx_vq = None;
        }
        // Event-driven backends (for example browser WebSockets) receive work independently of a
        // guest kick. Advance them before testing readiness so their newly-produced frame can wake
        // the receiveq on this same instruction boundary.
        st.backend.poll();
        // Proceed on a kick OR when the backend has an async rx frame to deliver.
        if !st.kicked && !st.backend.rx_ready() {
            return;
        }
        st.kicked = false;
    }

    // (Re)build both ring views from transport state. Both queues must be ready; the driver
    // brings them up together before DRIVER_OK.
    let (rx_qs, tx_qs) = {
        let s = slot.borrow();
        (*s.queue(RX_QUEUE as usize), *s.queue(TX_QUEUE as usize))
    };
    if !rx_qs.ready || !tx_qs.ready {
        *rx_vq = None;
        *tx_vq = None;
        return;
    }
    if rx_vq.is_none() {
        match Virtqueue::new(&rx_qs, 256) {
            Ok(q) => *rx_vq = Some(q),
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                return;
            }
        }
    }
    if tx_vq.is_none() {
        match Virtqueue::new(&tx_qs, 256) {
            Ok(q) => *tx_vq = Some(q),
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                return;
            }
        }
    }

    let mut delivered = false;
    // TX first: a loopback tx stages the echoed frame, which the following rx pass delivers in
    // the same boundary (so a guest ping gets its reply without waiting a tick).
    match service_tx(tx_vq.as_mut().expect("just built"), state, bus) {
        Ok(u) => delivered |= u,
        Err(_) => {
            slot.borrow_mut().protocol_violation();
            *rx_vq = None;
            *tx_vq = None;
            return;
        }
    }
    match service_rx(rx_vq.as_mut().expect("just built"), state, bus) {
        Ok(u) => delivered |= u,
        Err(_) => {
            slot.borrow_mut().protocol_violation();
            *rx_vq = None;
            *tx_vq = None;
            return;
        }
    }

    // One IRQ covers both queues (shared slot). Suppress per each queue's avail.flags.
    if delivered {
        let rx_irq = rx_vq.as_ref().is_some_and(|q| q.interrupt_needed(bus));
        let tx_irq = tx_vq.as_ref().is_some_and(|q| q.interrupt_needed(bus));
        if rx_irq || tx_irq {
            slot.borrow_mut().raise_used_irq();
        }
    }
}
