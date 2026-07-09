//! Split virtqueue (E2-T09, spec 1.2 §2.7) — the single ring engine every virtio device
//! reuses: descriptor-table walking, available-ring consumption, used-ring publication,
//! and interrupt suppression. Built hostile-guest-proof: every malformed ring shape is a
//! [`Violation`] (the device maps it to NEEDS_RESET via the E2-T08 transport), never a
//! panic, hang, or out-of-bounds host access.
//!
//! Layout (all little-endian, physical addresses read through the bus):
//! - Descriptor table: 16-byte entries `{ addr: le64, len: le32, flags: le16, next: le16 }`.
//! - Available ring: `{ flags: le16, idx: le16, ring: [le16; qsz] }` — `idx` free-running
//!   mod 2^16, NOT mod qsz.
//! - Used ring: `{ flags: le16, idx: le16, ring: [{ id: le32, len: le32 }; qsz] }` — `len`
//!   is bytes WRITTEN BY THE DEVICE (blk drivers check it).
//!
//! Policy decisions (documented per the task):
//! - `VIRTIO_F_INDIRECT_DESC` is NOT offered → an INDIRECT descriptor is a violation.
//! - `VIRTIO_F_EVENT_IDX` is NOT offered (Epic-2 scope) → suppression is `avail.flags` bit 0.
//! - A readable segment AFTER a writable one is a violation — mirrors QEMU's
//!   "Incorrect order for descriptors" (the spec says drivers never do this; rejecting
//!   loudly beats silently mis-executing a request).
//! - Zero-length descriptors are REJECTED ([`Violation::ZeroLenBuffer`]) — true QEMU
//!   parity: virtio.c's `virtqueue_map_desc` errors "zero sized buffers are not allowed"
//!   and marks the device broken. (Round-1 critic falsified the earlier "QEMU maps them
//!   empty" claim against the actual source; Linux never submits zero-len SG entries.)
//!
//! Single-threaded wasm makes "barriers" ordering discipline: used-ring publication is two
//! named fence-point methods — [`Virtqueue::write_used_element`] THEN
//! [`Virtqueue::publish_used_idx`] — so the JIT/SMP future keeps the order by construction
//! ([`Virtqueue::push_used`] composes them; a test drives the split steps directly).

use alloc::vec::Vec;

use super::mmio::QueueState;
use crate::bus::Bus;
use crate::mmio::SystemBus;
use crate::platform::virt::DRAM_BASE;

// Descriptor flags (§2.7.5).
const DESC_F_NEXT: u16 = 1;
const DESC_F_WRITE: u16 = 2;
const DESC_F_INDIRECT: u16 = 4;
/// avail.flags bit 0: driver asks the device NOT to interrupt on used-buffer.
const AVAIL_F_NO_INTERRUPT: u16 = 1;

/// A hostile or malformed ring shape. The device layer reports it to the transport
/// (NEEDS_RESET + config-change), per the documented policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Violation {
    /// Queue size is 0, not a power of two, or exceeds the transport max.
    BadQueueSize,
    /// avail.idx jumped ahead of the device by more than the queue size.
    AvailIdxJump,
    /// A ring entry or `next` pointer names a descriptor index ≥ queue size.
    BadDescIndex,
    /// The chain is longer than the queue size (self-loop / cycle).
    ChainTooLong,
    /// INDIRECT descriptor seen (feature not offered).
    Indirect,
    /// A descriptor's `[addr, addr+len)` is not fully inside guest DRAM.
    BadAddress,
    /// A device-readable segment followed a device-writable one (QEMU: incorrect order).
    BadOrder,
    /// A zero-length descriptor (QEMU: "zero sized buffers are not allowed").
    ZeroLenBuffer,
}

/// One buffer segment of a popped chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Segment {
    /// Guest-physical address (validated inside DRAM when `len > 0`).
    pub addr: u64,
    pub len: u32,
    /// Device-writable (`VIRTQ_DESC_F_WRITE`)?
    pub writable: bool,
}

/// A popped descriptor chain: the head index (for the used ring) plus its segments in
/// driver order — readable segments first, then writable (the order is enforced).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DescriptorChain {
    pub head: u16,
    pub segments: Vec<Segment>,
}

impl DescriptorChain {
    /// Device-readable segments (request headers, write payloads).
    pub fn readable(&self) -> impl Iterator<Item = &Segment> {
        self.segments.iter().filter(|s| !s.writable)
    }
    /// Device-writable segments (read payloads, status bytes).
    pub fn writable(&self) -> impl Iterator<Item = &Segment> {
        self.segments.iter().filter(|s| s.writable)
    }
    /// Total device-writable capacity in bytes (the ceiling for used.len).
    pub fn writable_len(&self) -> u64 {
        self.writable().map(|s| u64::from(s.len)).sum()
    }
}

/// The device-side view of one split virtqueue. Constructed from the transport's
/// [`QueueState`] when the driver flips `QueueReady`.
pub struct Virtqueue {
    size: u16,
    desc: u64,
    avail: u64,
    used: u64,
    /// Next avail.ring slot the device will consume (free-running mod 2^16).
    last_avail_idx: u16,
    /// Device shadow of used.idx (free-running mod 2^16).
    used_idx: u16,
}

impl Virtqueue {
    /// Build from transport queue state. `max` is the transport's QueueNumMax.
    pub fn new(qs: &QueueState, max: u32) -> Result<Self, Violation> {
        let size = qs.num;
        if size == 0 || size > max || !size.is_power_of_two() || size > 0x8000 {
            return Err(Violation::BadQueueSize);
        }
        Ok(Self {
            size: size as u16,
            desc: qs.desc,
            avail: qs.driver,
            used: qs.device,
            last_avail_idx: 0,
            used_idx: 0,
        })
    }

    pub fn size(&self) -> u16 {
        self.size
    }

    /// Bytes `[addr, addr+len)` fully inside guest DRAM (overflow-safe).
    fn dram_ok(bus: &SystemBus, addr: u64, len: u64) -> bool {
        let end = DRAM_BASE + bus.ram().len() as u64;
        match addr.checked_add(len) {
            Some(e) => addr >= DRAM_BASE && e <= end,
            None => false,
        }
    }

    fn load16(bus: &mut SystemBus, addr: u64) -> Result<u16, Violation> {
        if !Self::dram_ok(bus, addr, 2) {
            return Err(Violation::BadAddress);
        }
        bus.load16(addr).map_err(|_| Violation::BadAddress)
    }

    /// Pop the next available chain, or `None` when the ring is idle.
    ///
    /// Enforces (each → `Err`): avail.idx jumps > qsz; head/next indices ≥ qsz; chains
    /// longer than qsz (loop detection); INDIRECT; out-of-DRAM segments; readable-after-
    /// writable ordering.
    pub fn pop(&mut self, bus: &mut SystemBus) -> Result<Option<DescriptorChain>, Violation> {
        let avail_idx = Self::load16(bus, self.avail.wrapping_add(2))?;
        if avail_idx == self.last_avail_idx {
            return Ok(None);
        }
        // Free-running distance; a hostile driver publishing more entries than the ring
        // holds is a protocol violation (entries would alias).
        if avail_idx.wrapping_sub(self.last_avail_idx) > self.size {
            return Err(Violation::AvailIdxJump);
        }
        let slot = u64::from(self.last_avail_idx % self.size);
        let head = Self::load16(bus, self.avail.wrapping_add(4 + 2 * slot))?;
        if head >= self.size {
            return Err(Violation::BadDescIndex);
        }

        let mut segments = Vec::new();
        let mut seen_writable = false;
        let mut idx = head;
        for _hop in 0..self.size {
            let base = self.desc.wrapping_add(16 * u64::from(idx));
            if !Self::dram_ok(bus, base, 16) {
                return Err(Violation::BadAddress);
            }
            let addr = bus.load64(base).map_err(|_| Violation::BadAddress)?;
            let len = bus.load32(base + 8).map_err(|_| Violation::BadAddress)?;
            let flags = bus.load16(base + 12).map_err(|_| Violation::BadAddress)?;
            let next = bus.load16(base + 14).map_err(|_| Violation::BadAddress)?;

            if flags & DESC_F_INDIRECT != 0 {
                return Err(Violation::Indirect);
            }
            let writable = flags & DESC_F_WRITE != 0;
            if writable {
                seen_writable = true;
            } else if seen_writable {
                return Err(Violation::BadOrder); // readable after writable (QEMU contract)
            }
            // QEMU parity: zero-sized buffers are not allowed (virtqueue_map_desc).
            if len == 0 {
                return Err(Violation::ZeroLenBuffer);
            }
            if !Self::dram_ok(bus, addr, u64::from(len)) {
                return Err(Violation::BadAddress);
            }
            segments.push(Segment {
                addr,
                len,
                writable,
            });

            if flags & DESC_F_NEXT == 0 {
                self.last_avail_idx = self.last_avail_idx.wrapping_add(1);
                return Ok(Some(DescriptorChain { head, segments }));
            }
            if next >= self.size {
                return Err(Violation::BadDescIndex);
            }
            idx = next;
        }
        // qsz hops without an end: a cycle (e.g. self-loop).
        Err(Violation::ChainTooLong)
    }

    /// FENCE POINT 1: write the used-ring ELEMENT for `head` (`written` = bytes the device
    /// wrote into the chain's writable segments). Does NOT publish it — used.idx is
    /// untouched until [`Self::publish_used_idx`].
    pub fn write_used_element(
        &mut self,
        bus: &mut SystemBus,
        head: u16,
        written: u32,
    ) -> Result<(), Violation> {
        let slot = u64::from(self.used_idx % self.size);
        let elem = self.used.wrapping_add(4 + 8 * slot);
        if !Self::dram_ok(bus, elem, 8) {
            return Err(Violation::BadAddress);
        }
        bus.store32(elem, u32::from(head))
            .map_err(|_| Violation::BadAddress)?;
        bus.store32(elem + 4, written)
            .map_err(|_| Violation::BadAddress)?;
        Ok(())
    }

    /// FENCE POINT 2: increment and publish used.idx — the element written by fence point
    /// 1 becomes visible to the driver ONLY here (§2.7.13 write ordering).
    pub fn publish_used_idx(&mut self, bus: &mut SystemBus) -> Result<(), Violation> {
        // On Err the shadow used_idx has already advanced past guest memory — harmless:
        // a publication failure is a Violation, the device goes NEEDS_RESET and the queue
        // is rebuilt from QueueState before reuse (critic advisory, documented).
        self.used_idx = self.used_idx.wrapping_add(1);
        let idx_addr = self.used.wrapping_add(2);
        if !Self::dram_ok(bus, idx_addr, 2) {
            return Err(Violation::BadAddress);
        }
        bus.store16(idx_addr, self.used_idx)
            .map_err(|_| Violation::BadAddress)?;
        Ok(())
    }

    /// Element-then-index composition (the common path).
    pub fn push_used(
        &mut self,
        bus: &mut SystemBus,
        head: u16,
        written: u32,
    ) -> Result<(), Violation> {
        self.write_used_element(bus, head, written)?;
        self.publish_used_idx(bus)
    }

    /// Should the device interrupt after a push? (`!avail.flags.NO_INTERRUPT` — EVENT_IDX
    /// is not offered, so flags are the whole story.)
    pub fn interrupt_needed(&self, bus: &mut SystemBus) -> bool {
        if !Self::dram_ok(bus, self.avail, 2) {
            return true; // unreadable flags: err on the side of interrupting
        }
        bus.load16(self.avail)
            .map(|f| f & AVAIL_F_NO_INTERRUPT == 0)
            .unwrap_or(true)
    }
}
