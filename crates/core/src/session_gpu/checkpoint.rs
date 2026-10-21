//! Pending GPU history is an explicit, authenticated extension of native resume.
//! Logical identities survive; physical epochs, queue generations and leases do not.
use super::{
    admission::{PreparedResult, TransportReceipt, request_digest},
    *,
};
use crate::bus::Bus;
use crate::{
    dev::virtio::gpu::checkpoint::PreparedGpuCheckpoint,
    session_clock::{SessionClock, SessionPhase, SessionPosition},
};
const MAGIC: &[u8; 8] = b"WVGFRNT1";
const MAX_BYTES: usize = 160 * 1024 * 1024 + 1024 * 1024;
fn need(v: bool) -> Result<(), GpuError> {
    if v { Ok(()) } else { Err(GpuError::Malformed) }
}
fn n64(out: &mut Vec<u8>, v: u64) {
    out.extend_from_slice(&v.to_le_bytes());
}
fn n32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}
fn blob(out: &mut Vec<u8>, v: &[u8]) {
    n32(out, v.len() as u32);
    out.extend_from_slice(v);
}
fn position(out: &mut Vec<u8>, p: SessionPosition) {
    n64(out, p.transition);
    n64(out, p.retired);
    n32(out, p.ordinal);
    n64(out, p.sequence);
}
struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], GpuError> {
        let end = self.at.checked_add(n).ok_or(GpuError::Malformed)?;
        let bytes = self.bytes.get(self.at..end).ok_or(GpuError::Malformed)?;
        self.at = end;
        Ok(bytes)
    }
    fn u8(&mut self) -> Result<u8, GpuError> {
        Ok(self.take(1)?[0])
    }
    fn bool(&mut self) -> Result<bool, GpuError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(GpuError::Malformed),
        }
    }
    fn u32(&mut self) -> Result<u32, GpuError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, GpuError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn blob(&mut self, max: usize) -> Result<&'a [u8], GpuError> {
        let n = self.u32()? as usize;
        need(n <= max)?;
        self.take(n)
    }
    fn count(&mut self) -> Result<usize, GpuError> {
        let n = self.u32()? as usize;
        need(n <= MAX_OBJECTS)?;
        Ok(n)
    }
    fn position(&mut self) -> Result<SessionPosition, GpuError> {
        Ok(SessionPosition {
            transition: self.u64()?,
            retired: self.u64()?,
            ordinal: self.u32()?,
            sequence: self.u64()?,
            phase: SessionPhase::Before,
        })
    }
    fn payload(&mut self) -> Result<Payload, GpuError> {
        let reference = PayloadRef {
            sha256: self.take(32)?.try_into().unwrap(),
            length: self.u32()?,
        };
        let bytes = self.blob(MAX_PAYLOAD)?;
        need(PayloadRef::of(bytes)? == reference)?;
        Ok(Payload {
            reference,
            bytes: bytes.to_vec(),
        })
    }
}
fn payload(out: &mut Vec<u8>, p: &Payload) {
    out.extend_from_slice(&p.reference.sha256);
    n32(out, p.reference.length);
    blob(out, &p.bytes);
}

pub(crate) struct PreparedFrontier {
    session: GpuSession,
    epochs: Epochs,
}
impl PreparedFrontier {
    pub(crate) fn commit(self, m: &mut crate::Machine) {
        *self.session.epochs.borrow_mut() = self.epochs;
        m.session_gpu = Some(self.session);
    }
}
impl crate::Machine {
    pub(crate) fn encode_gpu_frontier(&self, gpu_bytes: &[u8]) -> Result<Vec<u8>, GpuError> {
        let s = self.session_gpu.as_ref().ok_or(GpuError::Inactive)?;
        let clock = self.session_clock.as_ref().ok_or(GpuError::Inactive)?;
        need(
            clock.position.phase == SessionPhase::Before
                && self.session_pending_events() == 0
                && self.extra_blk.is_empty(),
        )?;
        let (gpu, _, _, slot) = self.gpu.as_ref().ok_or(GpuError::Profile)?;
        let gpu = gpu.borrow();
        let physical = gpu.control3d_snapshot().ok_or(GpuError::Profile)?.epoch;
        let queue = self.virtio[*slot]
            .0
            .borrow()
            .queue_generation(0)
            .ok_or(GpuError::Exhausted)?;
        let epochs = s.epochs.borrow();
        let logical = epochs
            .logical
            .checked_add(
                physical
                    .checked_sub(epochs.physical)
                    .ok_or(GpuError::StaleOwner)?,
            )
            .ok_or(GpuError::Exhausted)?;
        let logical_queue = epochs
            .logical_queue
            .checked_add(
                queue
                    .checked_sub(epochs.physical_queue)
                    .ok_or(GpuError::StaleOwner)?,
            )
            .ok_or(GpuError::Exhausted)?;
        let pending = gpu.submit3d.as_ref().and_then(|s| s.pending.as_ref());
        let intent = pending
            .map(|p| request_digest(p, logical, logical_queue))
            .unwrap_or([0; 32]);
        let mut out = MAGIC.to_vec();
        out.extend_from_slice(&Sha256::digest(gpu_bytes));
        out.push(u8::from(s.replay));
        for v in [physical, logical, queue, logical_queue, s.cursor] {
            n64(&mut out, v);
        }
        out.extend_from_slice(&intent);
        position(&mut out, clock.position);
        n32(&mut out, s.payloads.len() as u32);
        for (sha, bytes) in &s.payloads.objects {
            out.extend_from_slice(sha);
            n32(&mut out, bytes.len() as u32);
            blob(&mut out, bytes);
        }
        out.push(u8::from(s.prepared.is_some()));
        if let Some(p) = &s.prepared {
            position(&mut out, p.position);
            blob(&mut out, &p.result.encode()?);
            out.push(u8::from(p.payload.is_some()));
            if let Some(p) = &p.payload {
                payload(&mut out, p);
            }
        }
        n32(&mut out, s.transport.len() as u32);
        for t in &s.transport {
            let e = t.exchange;
            for v in [
                logical,
                e.key.sequence,
                e.exchange_sequence,
                e.backing.resource.generation,
                e.backing.generation,
                e.rows.offset,
            ] {
                n64(&mut out, v);
            }
            for v in [
                e.backing.resource.id,
                e.rows.row_bytes,
                e.rows.row_stride,
                e.rows.row_count,
            ] {
                n32(&mut out, v);
            }
            out.push(u8::from(t.layers.is_some()));
            if let Some((stride, count)) = t.layers {
                n32(&mut out, stride);
                n32(&mut out, count);
            }
            out.push(u8::from(t.output));
            n32(&mut out, t.length as u32);
            if t.output {
                out.extend_from_slice(&[0; 32]);
            } else {
                out.extend_from_slice(&Sha256::digest(&t.bytes));
            }
            blob(&mut out, &t.bytes);
        }
        need(out.len() <= MAX_BYTES)?;
        let sha = Sha256::digest(&out);
        out.extend_from_slice(&sha);
        Ok(out)
    }
    pub(crate) fn prepare_gpu_frontier(
        &self,
        bytes: &[u8],
        gpu_bytes: &[u8],
        native: &mut PreparedGpuCheckpoint,
        clock: &SessionClock,
        ram_sparse: &[u8],
    ) -> Result<PreparedFrontier, GpuError> {
        let current = self.session_gpu.as_ref().ok_or(GpuError::Inactive)?;
        need(bytes.len() >= 32 && bytes.len() <= MAX_BYTES + 32)?;
        let (body, digest) = bytes.split_at(bytes.len() - 32);
        need(Sha256::digest(body).as_slice() == digest)?;
        let mut r = Cursor { bytes: body, at: 0 };
        need(r.take(8)? == MAGIC && r.take(32)? == Sha256::digest(gpu_bytes).as_slice())?;
        let replay = r.bool()?;
        need(replay == current.replay)?;
        let saved_physical = r.u64()?;
        let logical = r.u64()?;
        let saved_queue = r.u64()?;
        let logical_queue = r.u64()?;
        let cursor = r.u64()?;
        need(
            saved_physical == native.saved_epoch
                && logical > 0
                && saved_queue > 0
                && logical_queue > 0
                && cursor <= clock.position.sequence
                && self.session_pending_events() == 0
                && clock.next_transition().is_none(),
        )?;
        let intent: [u8; 32] = r.take(32)?.try_into().unwrap();
        need(r.position()? == clock.position && clock.position.phase == SessionPhase::Before)?;
        let (transport, rings, _) =
            crate::parse_resume_device_prefix(gpu_bytes, crate::resume::section::VIRTIO_GPU, 2)
                .map_err(|_| GpuError::Malformed)?;
        let slot_index = self.gpu.as_ref().ok_or(GpuError::Profile)?.3;
        let restored_queue = self.virtio[slot_index]
            .0
            .borrow()
            .queue_generation(0)
            .and_then(|n| n.checked_add(1))
            .ok_or(GpuError::Exhausted)?;
        let pending = native.pending_owner();
        if let Some((p, last, physical)) = pending {
            need(
                p.request.key().epoch == saved_physical
                    && p.queue_generation == saved_queue
                    && request_digest(p, logical, logical_queue) == intent
                    && p.chain.head < transport.queue(0).num as u16
                    && transport.driver_has_feature(1)
                    && rings[0].0
                    && rings[0].1.wrapping_sub(rings[0].2) == 1
                    && physical.gpu_complete
                    && (replay || last == physical.exchange_sequence),
            )?;
            let qs = transport.queue(0);
            need(
                qs.desc.is_multiple_of(16)
                    && qs.driver.is_multiple_of(2)
                    && qs.device.is_multiple_of(4),
            )?;
            let ram = self.bus.ram();
            for (base, length) in [
                (qs.desc, 16 * u64::from(qs.num)),
                (qs.driver, 6 + 2 * u64::from(qs.num)),
                (qs.device, 6 + 8 * u64::from(qs.num)),
            ] {
                need(ram.ram_contains(base, length))?;
            }
            let offset = usize::try_from(
                qs.device
                    .checked_add(2)
                    .and_then(|v| v.checked_sub(self.ram_base()))
                    .ok_or(GpuError::Malformed)?,
            )
            .map_err(|_| GpuError::Malformed)?;
            let mut used = [0; 2];
            crate::resume::read_sparse_range(ram_sparse, self.ram_len(), offset, &mut used)
                .map_err(|_| GpuError::Malformed)?;
            need(u16::from_le_bytes(used) == rings[0].2)?;
        } else {
            need(intent == [0; 32] && (!rings[0].0 || rings[0].1 == rings[0].2))?;
        }
        let mut payloads = Payloads::default();
        let mut previous = None;
        for _ in 0..r.count()? {
            let p = r.payload()?;
            need(previous.is_none_or(|v| v < p.reference.sha256))?;
            previous = Some(p.reference.sha256);
            payloads.insert(p)?;
        }
        let prepared = if r.bool()? {
            let position = r.position()?;
            let result = GpuResult::decode(r.blob(MAX_ENVELOPE)?)?;
            need(
                replay
                    && position.transition >= clock.position.transition
                    && position.retired >= clock.position.retired
                    && position.retired <= position.transition
                    && position.ordinal > 0
                    && position.sequence > clock.position.sequence,
            )?;
            let payload = if r.bool()? { Some(r.payload()?) } else { None };
            match result.kind {
                ResultKind::Scatter {
                    payload: reference, ..
                } => need(payload.as_ref().is_some_and(|p| p.reference == reference))?,
                _ => need(payload.is_none())?,
            }
            if position.transition == clock.position.transition {
                need(
                    position.retired == clock.position.retired
                        && clock.position.ordinal.checked_add(1) == Some(position.ordinal)
                        && clock.position.sequence.checked_add(1) == Some(position.sequence),
                )?;
            }
            if let Some((p, last, physical)) = pending {
                need(
                    result.key()
                        == Submit3dKey {
                            epoch: logical,
                            sequence: p.request.key().sequence,
                        }
                        && result.request_sha256 == intent,
                )?;
                match result.kind {
                    ResultKind::Gather {
                        exchange, layers, ..
                    }
                    | ResultKind::Scatter {
                        exchange, layers, ..
                    } => {
                        need(last.checked_add(1) == Some(exchange.exchange_sequence))?;
                        crate::dev::virtio::gpu::checkpoint::validate_pending_exchange(
                            p, &exchange, layers,
                        )
                        .map_err(|_| GpuError::Intent)?;
                    }
                    ResultKind::Complete(c) => {
                        need(
                            c.exchange_sequence == last
                                && (c.outcome.is_err() || physical.outcome.is_ok()),
                        )?;
                    }
                }
            }
            Some(PreparedResult {
                position,
                result,
                payload,
            })
        } else {
            None
        };
        let mut receipts = alloc::collections::VecDeque::new();
        let mut transport_bytes = 0usize;
        let mut previous = 0;
        for _ in 0..r.count()? {
            need(replay)?;
            let (p, last, _) = pending.ok_or(GpuError::Intent)?;
            let epoch = r.u64()?;
            let sequence = r.u64()?;
            let exchange_sequence = r.u64()?;
            let resource_generation = r.u64()?;
            let generation = r.u64()?;
            let offset = r.u64()?;
            let mut exchange = Submit3dExchange {
                key: Submit3dKey { epoch, sequence },
                exchange_sequence,
                backing: Submit3dBacking {
                    resource: Control3dId {
                        id: r.u32()?,
                        generation: resource_generation,
                    },
                    generation,
                },
                rows: Submit3dRows {
                    offset,
                    row_bytes: r.u32()?,
                    row_stride: r.u32()?,
                    row_count: r.u32()?,
                },
            };
            let layers = if r.bool()? {
                Some((r.u32()?, r.u32()?))
            } else {
                None
            };
            let output = r.bool()?;
            let length = r.u32()? as usize;
            let sha = r.take(32)?;
            need(
                exchange.key
                    == (Submit3dKey {
                        epoch: logical,
                        sequence: p.request.key().sequence,
                    })
                    && exchange.exchange_sequence > previous
                    && exchange.exchange_sequence <= last
                    && length > 0
                    && length <= MAX_PAYLOAD
                    && u64::from(exchange.rows.row_bytes)
                        .checked_mul(u64::from(exchange.rows.row_count))
                        .and_then(|n| {
                            n.checked_mul(u64::from(layers.map_or(1, |(_, count)| count)))
                        })
                        == Some(length as u64),
            )?;
            crate::dev::virtio::gpu::checkpoint::validate_pending_exchange(p, &exchange, layers)
                .map_err(|_| GpuError::Intent)?;
            previous = exchange.exchange_sequence;
            let bytes = r.blob(MAX_PAYLOAD)?;
            if output {
                need(bytes.is_empty() && sha == [0; 32])?;
            } else {
                need(bytes.len() == length && Sha256::digest(bytes).as_slice() == sha)?;
            }
            transport_bytes = transport_bytes
                .checked_add(bytes.len())
                .ok_or(GpuError::Limit)?;
            need(transport_bytes <= MAX_RESIDENT_BYTES)?;
            exchange.key.epoch = native.restored_epoch;
            receipts.push_back(TransportReceipt {
                exchange,
                layers,
                output,
                length,
                bytes: bytes.to_vec(),
            });
        }
        need(
            r.at == r.bytes.len()
                && (replay || prepared.is_none())
                && (replay || receipts.is_empty()),
        )?;
        let restored_complete = pending.map(|(p, _, _)| Submit3dKey {
            epoch: native.restored_epoch,
            sequence: p.request.key().sequence,
        });
        native.rebase_pending(restored_queue);
        Ok(PreparedFrontier {
            session: GpuSession {
                replay,
                epochs: current.epochs.clone(),
                cursor,
                payloads,
                prepared,
                transport: receipts,
                transport_bytes,
                restored_complete,
            },
            epochs: Epochs {
                physical: native.restored_epoch,
                logical,
                physical_queue: restored_queue,
                logical_queue,
            },
        })
    }
}
