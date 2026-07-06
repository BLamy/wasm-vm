//! virtio-blk device (E2-T11, spec 1.2 §5.2) — DeviceID 2 on the E2-T08 transport, rings
//! from E2-T09, storage from E2-T10. The root-filesystem workhorse.
//!
//! Request = one descriptor chain: 16-byte header `{ type: le32, reserved: le32,
//! sector: le64 }` (device-readable) → data segments (readable for OUT, writable for IN)
//! → 1 status byte (device-writable, LAST byte of the writable stream). **No segmentation
//! assumption**: header/data/status are parsed through byte-stream cursors over the
//! chain's segment lists — a header split 4+12 across two descriptors parses identically.
//!
//! `used.len` = total device-WRITTEN bytes (data-in + status). Features offered:
//! `VIRTIO_F_VERSION_1` (transport) + `VIRTIO_BLK_F_FLUSH` + `VIRTIO_BLK_F_RO` when the
//! backend is read-only. Config space: `capacity` (le64 sectors) at offset 0.
//!
//! **Kick plumbing:** `queue_notify` fires INSIDE a guest MMIO store (the bus is borrowed),
//! so it only sets a flag; the Machine run loop calls [`service`] at the next instruction
//! boundary with the bus free — same deferred-level pattern as CLINT/PLIC/UART sync.

use alloc::boxed::Box;
use alloc::rc::Rc;
use alloc::vec;
use core::cell::RefCell;

use super::VirtioDevice;
use super::mmio::VirtioMmio;
use super::queue::{DescriptorChain, Virtqueue};
use crate::block::{BlockBackend, BlockError, SECTOR_SIZE};
use crate::bus::Bus;
use crate::mmio::SystemBus;

// Request types (§5.2.6).
const T_IN: u32 = 0;
const T_OUT: u32 = 1;
const T_FLUSH: u32 = 4;
const T_GET_ID: u32 = 8;
// Status codes.
const S_OK: u8 = 0;
const S_IOERR: u8 = 1;
const S_UNSUPP: u8 = 2;

/// Feature bits (§5.2.3).
pub const VIRTIO_BLK_F_RO: u64 = 1 << 5;
pub const VIRTIO_BLK_F_FLUSH: u64 = 1 << 9;

/// The 20-byte GET_ID serial (stable; zero-padded).
pub const SERIAL: &[u8; 20] = b"wasmvm-blk0\0\0\0\0\0\0\0\0\0";

/// E2-T19 `--blk-log`: one serviced virtio-blk request, for debugging fs corruption/stalls.
#[derive(Debug, Clone, Copy)]
pub struct BlkReq {
    /// Request type: 0=IN(read) 1=OUT(write) 4=FLUSH 8=GET_ID, else the raw value.
    pub rtype: u32,
    /// Starting sector (512-byte units).
    pub sector: u64,
    /// Data bytes transferred (excludes the status byte).
    pub len: u32,
    /// virtio-blk status byte: 0=OK 1=IOERR 2=UNSUPP.
    pub status: u8,
}

/// Shared blk state: the storage backend + the deferred kick flag.
pub struct BlkState {
    pub backend: Box<dyn BlockBackend>,
    kicked: bool,
    /// Transport reset seen (Status=0) — the run-loop service must DROP its cached ring
    /// view before touching anything (critic round-1: a stale Virtqueue survived reset,
    /// leaving the device silently deaf after a legitimate reset + re-setup — the Linux
    /// reboot/driver-reload path — or corrupting guest memory if the rings moved).
    reset_pending: bool,
    /// FLUSH requests actually forwarded to the backend (lie-detector for F_FLUSH).
    pub flush_count: u64,
    /// E2-T19: when `Some`, each serviced request is appended here for `--blk-log`. Off by
    /// default (no cost, and no host-visible allocation on the hot path when disabled).
    blk_log: Option<alloc::vec::Vec<BlkReq>>,
    /// E3-T02: read chains PARKED because their data isn't resident yet — `(chain, awaited_chunk)`.
    /// Re-executed each `service()` boundary; completed (pushed to the used ring, exactly once) when
    /// the chunk arrives. Empty for synchronous backends, which never return `WouldBlock`.
    parked: alloc::vec::Vec<(DescriptorChain, usize)>,
}

impl BlkState {
    /// E3-T02: the distinct chunks that parked reads are waiting on — what the async fetch layer
    /// must load next (in park order, deduplicated). Empty unless a lazy backend has parked reads.
    pub fn pending_chunks(&self) -> alloc::vec::Vec<usize> {
        let mut out: alloc::vec::Vec<usize> = alloc::vec::Vec::new();
        for (_, chunk) in &self.parked {
            if !out.contains(chunk) {
                out.push(*chunk);
            }
        }
        out
    }

    /// E2-T19: start recording serviced requests for `--blk-log`.
    pub fn enable_log(&mut self) {
        if self.blk_log.is_none() {
            self.blk_log = Some(alloc::vec::Vec::new());
        }
    }
    /// E2-T19: take + clear the recorded requests (the host drains + prints these).
    pub fn take_log(&mut self) -> alloc::vec::Vec<BlkReq> {
        self.blk_log
            .as_mut()
            .map(core::mem::take)
            .unwrap_or_default()
    }
}

/// Transport-facing half (owned by the VirtioMmio slot).
pub struct VirtioBlkDev {
    state: Rc<RefCell<BlkState>>,
}

impl VirtioDevice for VirtioBlkDev {
    fn device_id(&self) -> u32 {
        2
    }
    fn device_features(&self) -> u64 {
        let mut f = VIRTIO_BLK_F_FLUSH;
        if self.state.borrow().backend.is_read_only() {
            f |= VIRTIO_BLK_F_RO;
        }
        f
    }
    fn queue_notify(&mut self, _queue: u32) {
        // Bus is borrowed right now — defer to the run-loop boundary.
        self.state.borrow_mut().kicked = true;
    }
    fn config_read(&mut self, offset: u64, width: u8) -> u64 {
        // capacity: le64 sectors at offset 0; byte-granular so any width/offset works.
        let cap = self.state.borrow().backend.capacity_sectors();
        let bytes = cap.to_le_bytes();
        let mut v = 0u64;
        for i in 0..width {
            let off = offset + u64::from(i);
            let b = if off < 8 { bytes[off as usize] } else { 0 };
            v |= u64::from(b) << (8 * i);
        }
        v
    }
    fn reset(&mut self) {
        let mut st = self.state.borrow_mut();
        st.kicked = false;
        st.reset_pending = true; // run loop drops the cached ring view (critic round-1)
        // Discard in-flight parked reads: their (head, rbuf, status) descriptors belong to
        // the queue being torn down. A reset during a lazy-fetch window (driver reload,
        // error recovery, kexec) would otherwise replay a stale chain against the
        // re-initialized queue — writing sector data into a repurposed guest buffer and
        // pushing a used-ring entry the new driver never requested (critic round-2 BUG 1).
        st.parked.clear();
    }
}

/// Create the device pair: the transport half (plug into slot 0) + the shared state the
/// Machine keeps for servicing.
pub fn new(backend: Box<dyn BlockBackend>) -> (VirtioBlkDev, Rc<RefCell<BlkState>>) {
    let state = Rc::new(RefCell::new(BlkState {
        backend,
        kicked: false,
        reset_pending: false,
        flush_count: 0,
        blk_log: None,
        parked: alloc::vec::Vec::new(),
    }));
    (
        VirtioBlkDev {
            state: Rc::clone(&state),
        },
        state,
    )
}

/// Byte cursor over a chain's readable or writable segment stream.
struct Cursor<'a> {
    segs: vec::Vec<(u64, u32)>, // (addr, len) in stream order
    seg: usize,
    off: u32,
    bus: &'a mut SystemBus,
}

impl<'a> Cursor<'a> {
    fn readable(chain: &DescriptorChain, bus: &'a mut SystemBus) -> Self {
        Self {
            segs: chain.readable().map(|s| (s.addr, s.len)).collect(),
            seg: 0,
            off: 0,
            bus,
        }
    }
    fn writable(chain: &DescriptorChain, bus: &'a mut SystemBus) -> Self {
        Self {
            segs: chain.writable().map(|s| (s.addr, s.len)).collect(),
            seg: 0,
            off: 0,
            bus,
        }
    }
    fn remaining(&self) -> u64 {
        let mut r = 0u64;
        for (i, &(_, len)) in self.segs.iter().enumerate() {
            if i > self.seg {
                r += u64::from(len);
            } else if i == self.seg {
                r += u64::from(len - self.off);
            }
        }
        r
    }
    fn read_exact(&mut self, out: &mut [u8]) -> bool {
        for byte in out.iter_mut() {
            loop {
                let Some(&(addr, len)) = self.segs.get(self.seg) else {
                    return false;
                };
                if self.off < len {
                    break;
                }
                self.seg += 1;
                self.off = 0;
                let _ = addr;
            }
            let (addr, _) = self.segs[self.seg];
            match self.bus.load8(addr + u64::from(self.off)) {
                Ok(b) => *byte = b,
                Err(_) => return false,
            }
            self.off += 1;
        }
        true
    }
    fn write_all(&mut self, data: &[u8]) -> bool {
        for &byte in data {
            loop {
                let Some(&(_, len)) = self.segs.get(self.seg) else {
                    return false;
                };
                if self.off < len {
                    break;
                }
                self.seg += 1;
                self.off = 0;
            }
            let (addr, _) = self.segs[self.seg];
            if self.bus.store8(addr + u64::from(self.off), byte).is_err() {
                return false;
            }
            self.off += 1;
        }
        true
    }
}

/// Execute one request chain. Returns bytes WRITTEN by the device (data + status byte).
/// Every malformed shape lands in a status byte when one exists; a chain with no writable
/// byte at all (nowhere to report) is a protocol violation.
/// The result of running one request chain. `Done(written)` = completed, push it to the used ring;
/// `Parked{chunk}` = a lazy read whose data isn't resident (E3-T02) — do NOT complete, park and retry
/// once `chunk` arrives; `Invalid` = protocol violation (no status byte), drop the chain.
enum ExecOutcome {
    Done(u32),
    Parked { chunk: usize },
    Invalid,
}

fn execute(chain: &DescriptorChain, state: &mut BlkState, bus: &mut SystemBus) -> ExecOutcome {
    let writable_total = chain.writable_len();
    if writable_total == 0 {
        return ExecOutcome::Invalid; // no status byte possible → protocol violation
    }
    let status_pos = writable_total - 1;

    // Header: 16 readable bytes, possibly split across descriptors.
    let mut hdr = [0u8; 16];
    let mut rc = Cursor::readable(chain, bus);
    let ok = rc.read_exact(&mut hdr);
    let out_len = rc.remaining(); // readable bytes AFTER the header = OUT payload
    drop(rc);
    if !ok {
        write_status(chain, bus, status_pos, S_IOERR);
        return ExecOutcome::Done(1);
    }
    let rtype = u32::from_le_bytes(hdr[0..4].try_into().unwrap());
    let sector = u64::from_le_bytes(hdr[8..16].try_into().unwrap());

    let (status, data_written) = match rtype {
        T_IN => {
            let data_len = status_pos; // all writable bytes except the status byte
            if data_len == 0
                || !data_len.is_multiple_of(SECTOR_SIZE as u64)
                || data_len > u32::MAX as u64
            {
                (S_IOERR, 0)
            } else {
                let mut buf = vec![0u8; data_len as usize];
                match state.backend.read(sector, &mut buf) {
                    Ok(()) => {
                        let mut wc = Cursor::writable(chain, bus);
                        if wc.write_all(&buf) {
                            (S_OK, data_len as u32)
                        } else {
                            (S_IOERR, 0)
                        }
                    }
                    // E3-T02: data not resident — PARK this chain (write nothing, no status) and
                    // retry once `chunk` is fetched. The used ring is never touched for a park.
                    Err(BlockError::WouldBlock { chunk }) => return ExecOutcome::Parked { chunk },
                    Err(_) => (S_IOERR, 0),
                }
            }
        }
        T_OUT => {
            if out_len == 0
                || !out_len.is_multiple_of(SECTOR_SIZE as u64)
                || out_len > u32::MAX as u64
            {
                (S_IOERR, 0)
            } else {
                let mut buf = vec![0u8; out_len as usize];
                let mut rc = Cursor::readable(chain, bus);
                let mut skip = [0u8; 16];
                let _ = rc.read_exact(&mut skip); // re-skip the header
                if !rc.read_exact(&mut buf) {
                    (S_IOERR, 0)
                } else {
                    drop(rc);
                    match state.backend.write(sector, &buf) {
                        Ok(()) => (S_OK, 0),
                        Err(BlockError::ReadOnly) => (S_IOERR, 0),
                        Err(_) => (S_IOERR, 0),
                    }
                }
            }
        }
        T_FLUSH => {
            if sector != 0 {
                (S_IOERR, 0) // spec: driver MUST set sector 0 for FLUSH
            } else {
                state.flush_count += 1;
                match state.backend.flush() {
                    Ok(()) => (S_OK, 0),
                    Err(_) => (S_IOERR, 0),
                }
            }
        }
        T_GET_ID => {
            let room = status_pos.min(20) as usize;
            let mut wc = Cursor::writable(chain, bus);
            if wc.write_all(&SERIAL[..room]) {
                (S_OK, room as u32)
            } else {
                (S_IOERR, 0)
            }
        }
        _ => (S_UNSUPP, 0), // DISCARD / WRITE_ZEROES / garbage types
    };

    // E2-T19 --blk-log: record the serviced request (type/sector/len/status) when enabled.
    if let Some(log) = state.blk_log.as_mut() {
        log.push(BlkReq {
            rtype,
            sector,
            len: data_written,
            status,
        });
    }

    write_status(chain, bus, status_pos, status);
    ExecOutcome::Done(data_written + 1)
}

/// Write the status byte at writable-stream position `pos`.
fn write_status(chain: &DescriptorChain, bus: &mut SystemBus, pos: u64, status: u8) {
    let mut remaining = pos;
    for seg in chain.writable() {
        let len = u64::from(seg.len);
        if remaining < len {
            let _ = bus.store8(seg.addr + remaining, status);
            return;
        }
        remaining -= len;
    }
}

/// Run-loop service: consume a pending kick, (re)build the queue-0 ring view when the
/// driver has it ready, pop-execute-push until idle, interrupt per suppression flags.
/// Ring [`Violation`]s degrade the slot via `protocol_violation` and drop the ring view.
pub fn service(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<BlkState>>,
    bus: &mut SystemBus,
) {
    {
        let mut st = state.borrow_mut();
        // Reset tear-down happens even without a kick: the stale ring view must never
        // survive a Status=0 write (critic round-1 refutation).
        if st.reset_pending {
            st.reset_pending = false;
            *vq = None;
        }
        // Proceed on a kick OR when there are parked reads to retry (E3-T02): a chunk may have
        // arrived since the last boundary, so we must re-service even without a fresh kick.
        if !st.kicked && st.parked.is_empty() {
            return;
        }
        st.kicked = false;
    }
    // (Re)build the ring view from transport state.
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
    // E3-T02: retry PARKED reads first. Drain them (so `execute` can re-borrow state); a chain whose
    // data is now resident completes — pushed to the used ring EXACTLY ONCE — and is dropped; one
    // still absent is re-parked. Re-executing a stored chain is idempotent (it re-reads the guest
    // descriptors + backend and writes nothing to the guest until it can complete). Out-of-order used
    // completion is legal in virtio (the used elem carries the head).
    let parked = core::mem::take(&mut state.borrow_mut().parked);
    for (chain, _) in parked {
        // Bind first so the `state.borrow_mut()` temporary is released before the arms re-borrow it.
        let outcome = execute(&chain, &mut state.borrow_mut(), bus);
        match outcome {
            ExecOutcome::Done(w) => {
                if q.push_used(bus, chain.head, w).is_err() {
                    slot.borrow_mut().protocol_violation();
                    *vq = None;
                    return;
                }
                delivered_work = true;
            }
            ExecOutcome::Parked { chunk } => state.borrow_mut().parked.push((chain, chunk)),
            // A chain valid enough to have parked cannot become a protocol violation on re-exec.
            ExecOutcome::Invalid => {}
        }
    }
    loop {
        match q.pop(bus) {
            Ok(Some(chain)) => {
                // Bind first so the `state.borrow_mut()` temporary is released before the arms re-borrow it.
                let outcome = execute(&chain, &mut state.borrow_mut(), bus);
                match outcome {
                    ExecOutcome::Done(w) => {
                        if q.push_used(bus, chain.head, w).is_err() {
                            slot.borrow_mut().protocol_violation();
                            *vq = None;
                            return;
                        }
                        delivered_work = true;
                    }
                    // E3-T02: data not resident — keep the chain OUT of the used ring and retry next
                    // boundary (once the fetch layer has populated `chunk`).
                    ExecOutcome::Parked { chunk } => {
                        state.borrow_mut().parked.push((chain, chunk));
                    }
                    ExecOutcome::Invalid => {
                        // No status byte anywhere: protocol violation, chain dropped.
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
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
