//! Proof-only, head-owned asynchronous submissions. The mailbox never borrows a
//! Machine. Host DMA methods run outside Machine::run and consume one exchange.
use alloc::{boxed::Box, rc::Rc, string::String, vec::Vec};
use core::cell::RefCell;
use sha2::{Digest, Sha256};

use super::{
    control3d::{BackingEntry, Control3dError, Control3dId, Control3dSnapshot, Resource3dMetadata},
    protocol::CtrlHeader,
};

pub const MAX_SUBMISSION_BYTES: usize = 262_144;
pub const MAX_EXCHANGE_BYTES: u64 = 4 * 1024 * 1024;
pub const MAX_EXCHANGES: u64 = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Submit3dKey {
    pub epoch: u64,
    pub sequence: u64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Submit3dBacking {
    pub resource: Control3dId,
    pub generation: u64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Submit3dRows {
    pub offset: u64,
    pub row_bytes: u32,
    pub row_stride: u32,
    pub row_count: u32,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Submit3dExchange {
    pub key: Submit3dKey,
    pub exchange_sequence: u64,
    pub backing: Submit3dBacking,
    pub rows: Submit3dRows,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AcceptedBacking3d {
    pub generation: u64,
    pub byte_length: u64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcceptedResource3d {
    pub identity: Control3dId,
    pub metadata: Resource3dMetadata,
    pub backing: Option<AcceptedBacking3d>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Transfer3dBox {
    pub x: u32,
    pub y: u32,
    pub z: u32,
    pub width: u32,
    pub height: u32,
    pub depth: u32,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Transfer3d {
    pub box_: Transfer3dBox,
    pub offset: u64,
    pub resource_id: u32,
    pub level: u32,
    pub stride: u32,
    pub layer_stride: u32,
    pub direction: u32,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Submit3dKind {
    Commands(Vec<u8>),
    Transfer(Transfer3d),
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Submit3dRequest {
    pub key: Submit3dKey,
    pub context: Control3dId,
    pub header: CtrlHeader,
    pub resources: Vec<AcceptedResource3d>,
    pub kind: Submit3dKind,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Submit3dCompletion {
    pub key: Submit3dKey,
    pub exchange_sequence: u64,
    pub outcome: Result<(), Control3dError>,
    pub gpu_complete: bool,
    pub applied_commands: u32,
    pub draws: u32,
}

/// begin_job runs with pending identity installed, but must only start/queue host
/// work. It may immediately post through its independently held mailbox handle.
pub trait Submit3dSink {
    fn begin_job(&mut self, request: &Submit3dRequest) -> Result<(), Control3dError>;
    fn cancel_job(&mut self, key: Submit3dKey) -> Result<(), Control3dError>;
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Submit3dMailboxSnapshot {
    pub active: Option<Submit3dKey>,
    pub last_exchange: u64,
    pub ready: bool,
}
#[derive(Default)]
struct MailboxState {
    active: Option<Submit3dKey>,
    last_exchange: u64,
    completion: Option<Submit3dCompletion>,
}
#[derive(Clone, Default)]
pub struct Submit3dMailbox(Rc<RefCell<MailboxState>>);
impl Submit3dMailbox {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn inspect(&self) -> Submit3dMailboxSnapshot {
        let state = self.0.borrow();
        Submit3dMailboxSnapshot {
            active: state.active,
            last_exchange: state.last_exchange,
            ready: state.completion.is_some(),
        }
    }
    pub fn post(&self, mut completion: Submit3dCompletion) -> Result<(), Control3dError> {
        let mut state = self.0.borrow_mut();
        if state.active != Some(completion.key) || state.completion.is_some() {
            return Err(Control3dError::InvalidParameter);
        }
        // An exception after scatter may hide its consumed sequence from JS. Only
        // a terminal uncertain failure may adopt it; never a success or retry.
        if completion.outcome == Err(Control3dError::BridgePoisoned) && !completion.gpu_complete {
            completion.exchange_sequence = state.last_exchange;
        }
        if completion.exchange_sequence != state.last_exchange
            || completion.applied_commands > 4096
            || completion.draws > 64
            || (!completion.gpu_complete
                && completion.outcome != Err(Control3dError::BridgePoisoned))
        {
            return Err(Control3dError::InvalidParameter);
        }
        state.completion = Some(completion);
        Ok(())
    }
    fn arm(&self, key: Submit3dKey) {
        *self.0.borrow_mut() = MailboxState {
            active: Some(key),
            ..MailboxState::default()
        };
    }
    fn revoke(&self) {
        *self.0.borrow_mut() = MailboxState::default();
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Submit3dCounters {
    pub admitted: u64,
    pub completed: u64,
    pub cancelled: u64,
    pub fenced: u64,
    pub submission_bytes: u64,
    pub input_bytes: u64,
    pub output_bytes: u64,
    pub exchanges: u64,
    pub applied_commands: u64,
    pub draws: u64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PendingSubmit3dSnapshot {
    pub key: Submit3dKey,
    pub context: Control3dId,
    pub command_type: u32,
    pub fence_id: u64,
    pub flags: u32,
    pub byte_length: u64,
    pub backing_entries: u32,
    pub last_exchange: u64,
    pub completion_ready: bool,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Submit3dSnapshot {
    pub next_sequence: u64,
    pub pending: Option<PendingSubmit3dSnapshot>,
    pub counters: Submit3dCounters,
}
impl Submit3dSnapshot {
    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"WV3DSUB1");
        let c = self.counters;
        for v in [
            self.next_sequence,
            c.admitted,
            c.completed,
            c.cancelled,
            c.fenced,
            c.submission_bytes,
            c.input_bytes,
            c.output_bytes,
            c.exchanges,
            c.applied_commands,
            c.draws,
        ] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.push(u8::from(self.pending.is_some()));
        if let Some(p) = self.pending {
            for v in [
                p.key.epoch,
                p.key.sequence,
                p.context.generation,
                p.fence_id,
                p.byte_length,
                p.last_exchange,
            ] {
                out.extend_from_slice(&v.to_le_bytes());
            }
            for v in [p.context.id, p.command_type, p.flags, p.backing_entries] {
                out.extend_from_slice(&v.to_le_bytes());
            }
            out.push(u8::from(p.completion_ready));
        }
        out
    }
    pub fn hex_digest(&self) -> String {
        use core::fmt::Write;
        let mut out = String::with_capacity(64);
        for byte in Sha256::digest(self.canonical_bytes()) {
            let _ = write!(&mut out, "{byte:02x}");
        }
        out
    }
}

pub(crate) struct PendingSubmit3d {
    pub request: Submit3dRequest,
    pub chain: crate::dev::virtio::queue::DescriptorChain,
    pub queue_generation: u64,
    pub accepted: Control3dSnapshot,
    #[cfg(feature = "gpu-trace")]
    pub trace: super::CommandTraceMeta,
}
pub(crate) struct Submit3dState {
    sink: Box<dyn Submit3dSink>,
    pub mailbox: Submit3dMailbox,
    pub pending: Option<PendingSubmit3d>,
    next_sequence: u64,
    counters: Submit3dCounters,
}
impl Submit3dState {
    pub fn new(sink: Box<dyn Submit3dSink>, mailbox: Submit3dMailbox) -> Self {
        mailbox.revoke();
        Self {
            sink,
            mailbox,
            pending: None,
            next_sequence: 1,
            counters: Submit3dCounters::default(),
        }
    }
    pub fn snapshot(&self) -> Submit3dSnapshot {
        let mailbox = self.mailbox.inspect();
        Submit3dSnapshot {
            next_sequence: self.next_sequence,
            counters: self.counters,
            pending: self.pending.as_ref().map(|p| PendingSubmit3dSnapshot {
                key: p.request.key,
                context: p.request.context,
                command_type: p.request.header.ty,
                fence_id: p.request.header.fence_id,
                flags: p.request.header.flags,
                byte_length: match &p.request.kind {
                    Submit3dKind::Commands(bytes) => bytes.len() as u64,
                    Submit3dKind::Transfer(_) => 72,
                },
                backing_entries: p
                    .accepted
                    .resources
                    .iter()
                    .map(|r| r.backing.as_ref().map_or(0, |v| v.len() as u32))
                    .sum(),
                last_exchange: mailbox.last_exchange,
                completion_ready: mailbox.ready,
            }),
        }
    }
    pub fn next_key(&self, epoch: u64) -> Result<Submit3dKey, Control3dError> {
        self.next_sequence
            .checked_add(1)
            .ok_or(Control3dError::OutOfMemory)?;
        Ok(Submit3dKey {
            epoch,
            sequence: self.next_sequence,
        })
    }
    pub fn begin(&mut self, pending: PendingSubmit3d) {
        let key = pending.request.key;
        self.counters.admitted = self.counters.admitted.saturating_add(1);
        if pending.request.header.flags & super::protocol::FLAG_FENCE != 0 {
            self.counters.fenced = self.counters.fenced.saturating_add(1);
        }
        if let Submit3dKind::Commands(bytes) = &pending.request.kind {
            self.counters.submission_bytes = self
                .counters
                .submission_bytes
                .saturating_add(bytes.len() as u64);
        }
        self.next_sequence += 1;
        self.mailbox.arm(key);
        self.pending = Some(pending);
        if let Err(error) = self
            .sink
            .begin_job(&self.pending.as_ref().expect("installed pending").request)
        {
            // A contradictory post plus callback failure is uncertain host state.
            let already_posted = self.mailbox.inspect().ready;
            if already_posted {
                self.mailbox.0.borrow_mut().completion = None;
            }
            let error = if already_posted {
                Control3dError::BridgePoisoned
            } else {
                error
            };
            let _ = self.mailbox.post(Submit3dCompletion {
                key,
                exchange_sequence: 0,
                outcome: Err(error),
                gpu_complete: error != Control3dError::BridgePoisoned,
                applied_commands: 0,
                draws: 0,
            });
        }
    }
    pub fn revoke(&mut self) {
        self.mailbox.revoke();
        if let Some(pending) = self.pending.take() {
            self.counters.cancelled = self.counters.cancelled.saturating_add(1);
            let _ = self.sink.cancel_job(pending.request.key);
        }
    }
    pub fn take_ready(&mut self) -> Option<(PendingSubmit3d, Submit3dCompletion)> {
        let completion = self.mailbox.0.borrow_mut().completion.take()?;
        let pending = self
            .pending
            .take()
            .expect("mailbox armed only for a pending head");
        self.mailbox.revoke();
        Some((pending, completion))
    }
    pub fn completed(&mut self, c: Submit3dCompletion) {
        self.counters.completed = self.counters.completed.saturating_add(1);
        self.counters.applied_commands = self
            .counters
            .applied_commands
            .saturating_add(u64::from(c.applied_commands));
        self.counters.draws = self.counters.draws.saturating_add(u64::from(c.draws));
    }
    pub fn consume_exchange(&mut self, sequence: u64, bytes: u64, output: bool) {
        self.mailbox.0.borrow_mut().last_exchange = sequence;
        self.counters.exchanges = self.counters.exchanges.saturating_add(1);
        let counter = if output {
            &mut self.counters.output_bytes
        } else {
            &mut self.counters.input_bytes
        };
        *counter = counter.saturating_add(bytes);
    }
    pub fn dma_spans(
        &self,
        exchange: &Submit3dExchange,
        current: &Control3dSnapshot,
    ) -> Result<(Vec<(u64, usize)>, usize), Control3dError> {
        let p = self
            .pending
            .as_ref()
            .ok_or(Control3dError::InvalidParameter)?;
        let m = self.mailbox.inspect();
        if current.poisoned {
            return Err(Control3dError::BridgePoisoned);
        }
        if p.request.key != exchange.key
            || m.active != Some(exchange.key)
            || m.ready
            || exchange.exchange_sequence != m.last_exchange + 1
            || exchange.exchange_sequence > MAX_EXCHANGES
        {
            return Err(Control3dError::InvalidParameter);
        }
        if current.epoch != exchange.key.epoch
            || !current.contexts.iter().any(|c| {
                c.identity == p.request.context && c.resources.contains(&exchange.backing.resource)
            })
        {
            return Err(Control3dError::InvalidContextId);
        }
        let accepted = p
            .accepted
            .resources
            .iter()
            .find(|r| r.identity == exchange.backing.resource)
            .ok_or(Control3dError::InvalidResourceId)?;
        let live = current
            .resources
            .iter()
            .find(|r| r.identity == exchange.backing.resource)
            .ok_or(Control3dError::InvalidResourceId)?;
        if accepted.backing_generation != Some(exchange.backing.generation)
            || live.backing_generation != accepted.backing_generation
            || live.backing != accepted.backing
        {
            return Err(Control3dError::InvalidParameter);
        }
        let entries = accepted
            .backing
            .as_ref()
            .ok_or(Control3dError::InvalidParameter)?;
        row_spans(exchange.rows, entries)
    }
}

pub(crate) fn row_spans(
    rows: Submit3dRows,
    entries: &[BackingEntry],
) -> Result<(Vec<(u64, usize)>, usize), Control3dError> {
    let bad = Control3dError::InvalidParameter;
    let tight = u64::from(rows.row_bytes)
        .checked_mul(u64::from(rows.row_count))
        .ok_or(bad)?;
    if rows.row_bytes == 0
        || rows.row_count == 0
        || rows.row_count > super::control3d::MAX_TEXTURE_SIZE
        || rows.row_stride < rows.row_bytes
        || tight > MAX_EXCHANGE_BYTES
    {
        return Err(bad);
    }
    let end = u64::from(rows.row_count - 1)
        .checked_mul(u64::from(rows.row_stride))
        .and_then(|v| v.checked_add(rows.offset))
        .and_then(|v| v.checked_add(u64::from(rows.row_bytes)))
        .ok_or(bad)?;
    let total: u64 = entries.iter().map(|e| u64::from(e.length)).sum();
    if end > total {
        return Err(bad);
    }
    let mut spans = Vec::new();
    // Each row contributes at most one span plus every SG boundary it crosses.
    let max_spans = (rows.row_count as usize)
        .checked_add(entries.len())
        .ok_or(bad)?;
    spans
        .try_reserve_exact(max_spans)
        .map_err(|_| Control3dError::OutOfMemory)?;
    for row in 0..rows.row_count {
        let mut start = rows.offset + u64::from(row) * u64::from(rows.row_stride);
        let mut left = u64::from(rows.row_bytes);
        for e in entries {
            if start >= u64::from(e.length) {
                start -= u64::from(e.length);
                continue;
            }
            let take = left.min(u64::from(e.length) - start);
            spans.push((e.addr.checked_add(start).ok_or(bad)?, take as usize));
            left -= take;
            start = 0;
            if left == 0 {
                break;
            }
        }
        if left != 0 {
            return Err(bad);
        }
    }
    Ok((spans, tight as usize))
}

pub(crate) fn admit(
    state: &Submit3dState,
    control: Control3dSnapshot,
    chain: crate::dev::virtio::queue::DescriptorChain,
    bus: &mut crate::mmio::SystemBus,
    header: CtrlHeader,
    negotiated: bool,
    queue_generation: Option<u64>,
) -> Result<PendingSubmit3d, Control3dError> {
    use super::{protocol as p, read_readable_at, readable_len};
    use crate::bus::Bus;
    let bad = Control3dError::InvalidParameter;
    if !negotiated {
        return Err(Control3dError::Unspecified);
    }
    if control.poisoned {
        return Err(Control3dError::BridgePoisoned);
    }
    if chain.writable_len() < 24
        || chain
            .writable()
            .any(|s| !bus.ram().ram_contains(s.addr, u64::from(s.len)))
        || header.flags & !p::FLAG_FENCE != 0
        || header.ring_idx != 0
        || header.padding != [0; 3]
    {
        return Err(bad);
    }
    let context = control
        .contexts
        .iter()
        .find(|c| c.identity.id == header.ctx_id)
        .ok_or(Control3dError::InvalidContextId)?;
    let mut resources = Vec::new();
    resources
        .try_reserve_exact(context.resources.len())
        .map_err(|_| Control3dError::OutOfMemory)?;
    for identity in &context.resources {
        let r = control
            .resources
            .iter()
            .find(|r| r.identity == *identity)
            .ok_or(Control3dError::InvalidResourceId)?;
        resources.push(AcceptedResource3d {
            identity: *identity,
            metadata: r.metadata,
            backing: r.backing.as_ref().map(|entries| AcceptedBacking3d {
                generation: r.backing_generation.expect("attached generation"),
                byte_length: entries.iter().map(|e| u64::from(e.length)).sum(),
            }),
        });
    }
    let kind = match header.ty {
        p::CMD_SUBMIT_3D => {
            let h = read_readable_at::<32>(&chain, bus, 0).ok_or(bad)?;
            let size = u32::from_le_bytes(h[24..28].try_into().expect("size")) as usize;
            if h[28..32] != [0; 4]
                || size > MAX_SUBMISSION_BYTES
                || !size.is_multiple_of(4)
                || readable_len(&chain) != Some(32 + size as u64)
            {
                return Err(bad);
            }
            let mut bytes = Vec::new();
            bytes
                .try_reserve_exact(size)
                .map_err(|_| Control3dError::OutOfMemory)?;
            let mut skip = 32u64;
            for segment in chain.readable() {
                if skip >= u64::from(segment.len) {
                    skip -= u64::from(segment.len);
                    continue;
                }
                for offset in skip..u64::from(segment.len) {
                    bytes.push(bus.load8(segment.addr + offset).map_err(|_| bad)?);
                }
                skip = 0;
            }
            Submit3dKind::Commands(bytes)
        }
        p::CMD_TRANSFER_TO_HOST_3D | p::CMD_TRANSFER_FROM_HOST_3D => {
            if readable_len(&chain) != Some(72) {
                return Err(bad);
            }
            let b = read_readable_at::<72>(&chain, bus, 0).ok_or(bad)?;
            let w = |offset| {
                u32::from_le_bytes(b[offset..offset + 4].try_into().expect("transfer word"))
            };
            let t = Transfer3d {
                box_: Transfer3dBox {
                    x: w(24),
                    y: w(28),
                    z: w(32),
                    width: w(36),
                    height: w(40),
                    depth: w(44),
                },
                offset: u64::from_le_bytes(b[48..56].try_into().expect("full offset")),
                resource_id: w(56),
                level: w(60),
                stride: w(64),
                layer_stride: w(68),
                direction: if header.ty == p::CMD_TRANSFER_TO_HOST_3D {
                    1
                } else {
                    2
                },
            };
            let r = resources
                .iter()
                .find(|r| r.identity.id == t.resource_id)
                .ok_or(Control3dError::InvalidResourceId)?;
            validate_transfer(t, r)?;
            Submit3dKind::Transfer(t)
        }
        _ => return Err(Control3dError::Unspecified),
    };
    Ok(PendingSubmit3d {
        request: Submit3dRequest {
            key: state.next_key(control.epoch)?,
            context: context.identity,
            header,
            resources,
            kind,
        },
        chain,
        queue_generation: queue_generation.ok_or(Control3dError::BridgePoisoned)?,
        accepted: control,
        #[cfg(feature = "gpu-trace")]
        trace: super::CommandTraceMeta::default(),
    })
}
fn validate_transfer(t: Transfer3d, r: &AcceptedResource3d) -> Result<(), Control3dError> {
    let bad = Control3dError::InvalidParameter;
    let m = r.metadata;
    let b = t.box_;
    if m.bind == 524_288
        || t.level != 0
        || b.width == 0
        || b.height == 0
        || b.depth != 1
        || b.z != 0
        || u64::from(b.x) + u64::from(b.width) > u64::from(m.width)
        || u64::from(b.y) + u64::from(b.height) > u64::from(m.height)
    {
        return Err(bad);
    }
    let scale = if m.target == 2 { 4 } else { 1 };
    let row_bytes = b.width.checked_mul(scale).ok_or(bad)?;
    let row_stride = if t.stride == 0 {
        m.width.checked_mul(scale).ok_or(bad)?
    } else {
        t.stride
    };
    let layer = if t.layer_stride == 0 {
        row_stride.checked_mul(m.height).ok_or(bad)?
    } else {
        t.layer_stride
    };
    if row_stride < row_bytes || layer < row_stride.checked_mul(b.height).ok_or(bad)? {
        return Err(bad);
    }
    let end = t
        .offset
        .checked_add(u64::from(b.height - 1) * u64::from(row_stride))
        .and_then(|v| v.checked_add(u64::from(row_bytes)))
        .ok_or(bad)?;
    let backing = r.backing.ok_or(bad)?;
    if end > backing.byte_length
        || end - t.offset > MAX_EXCHANGE_BYTES
        || u64::from(row_bytes) * u64::from(b.height) > MAX_EXCHANGE_BYTES
    {
        return Err(bad);
    }
    Ok(())
}
