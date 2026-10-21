//! Explicit v2 pending owner. No renderer handle or completion sender is portable.
use super::super::protocol::{self as p, CtrlHeader};
use super::*;
use crate::dev::virtio::queue::{DescriptorChain, Segment};

pub(super) struct PendingCheckpoint {
    pub pending: PendingSubmit3d,
    pub last_exchange: u64,
    pub completion: Submit3dCompletion,
}
impl PendingCheckpoint {
    pub fn rebase(&mut self, epoch: u64, queue: u64) {
        match &mut self.pending.request {
            PendingRequest::Render(r) => r.key.epoch = epoch,
            PendingRequest::Scanout(r) => r.key.epoch = epoch,
        }
        self.pending.accepted.epoch = epoch;
        self.pending.queue_generation = queue;
        self.completion.key.epoch = epoch;
    }
}
fn id(out: &mut Vec<u8>, v: Control3dId) {
    out.extend_from_slice(&v.id.to_le_bytes());
    out.extend_from_slice(&v.generation.to_le_bytes());
}
fn u64s(out: &mut Vec<u8>, v: &[u64]) {
    for n in v {
        out.extend_from_slice(&n.to_le_bytes());
    }
}
fn u32s(out: &mut Vec<u8>, v: &[u32]) {
    for n in v {
        out.extend_from_slice(&n.to_le_bytes());
    }
}
pub(super) fn encode(state: &Submit3dState) -> Result<Vec<u8>, Error> {
    let mut out = Vec::new();
    let Some(pending) = &state.pending else {
        out.push(0);
        return Ok(out);
    };
    let ready = state.physical_completion().ok_or(Error::Busy)?;
    need(ready.gpu_complete && ready.key == pending.request.key())?;
    out.push(1);
    let key = pending.request.key();
    u64s(
        &mut out,
        &[
            key.epoch,
            key.sequence,
            pending.queue_generation,
            state.mailbox.inspect().last_exchange,
        ],
    );
    out.extend_from_slice(&pending.request.header().to_bytes());
    out.extend_from_slice(&pending.chain.head.to_le_bytes());
    u32s(&mut out, &[pending.chain.segments.len() as u32]);
    for s in &pending.chain.segments {
        u64s(&mut out, &[s.addr]);
        u32s(&mut out, &[s.len]);
        out.push(u8::from(s.writable));
    }
    put_blob(&mut out, &pending.accepted.canonical_bytes())?;
    match &pending.request {
        PendingRequest::Render(r) => {
            out.push(1);
            id(&mut out, r.context);
            // Resource metadata is reconstructed from the accepted canonical table.
            u32s(&mut out, &[r.resources.len() as u32]);
            for r in &r.resources {
                id(&mut out, r.identity);
            }
            match &r.kind {
                Submit3dKind::Commands(bytes) => {
                    out.push(1);
                    put_blob(&mut out, bytes)?;
                }
                Submit3dKind::Transfer(t) => {
                    out.push(2);
                    u64s(&mut out, &[t.offset]);
                    u32s(
                        &mut out,
                        &[
                            t.box_.x,
                            t.box_.y,
                            t.box_.z,
                            t.box_.width,
                            t.box_.height,
                            t.box_.depth,
                            t.resource_id,
                            t.level,
                            t.stride,
                            t.layer_stride,
                            t.direction,
                        ],
                    );
                }
            }
        }
        PendingRequest::Scanout(r) => {
            out.push(2);
            put_blob(
                &mut out,
                &Scanout3dSnapshot {
                    next_generation: r.binding.generation + 1,
                    binding: Some(r.binding),
                    counters: Scanout3dCounters::default(),
                }
                .canonical_bytes(),
            )?;
        }
    }
    u64s(&mut out, &[ready.exchange_sequence]);
    out.push(crate::session_gpu::outcome_code(ready.outcome));
    out.push(u8::from(ready.gpu_complete));
    u32s(&mut out, &[ready.applied_commands, ready.draws]);
    out.push(u8::from(cfg!(feature = "gpu-trace")));
    #[cfg(feature = "gpu-trace")]
    {
        let m = pending.trace;
        u32s(&mut out, &[m.command_type]);
        for v in [
            m.submit_sequence,
            m.fence_id,
            m.scanout.map(u64::from),
            m.resource_id.map(u64::from),
            m.resource_width.map(u64::from),
            m.resource_height.map(u64::from),
            m.backing_entries.map(u64::from),
        ] {
            out.push(u8::from(v.is_some()));
            u64s(&mut out, &[v.unwrap_or(0)]);
        }
        out.push(u8::from(m.transfer_words.is_some()));
        u32s(&mut out, &m.transfer_words.unwrap_or([0; 12]));
    }
    // The explicit instrumentation tag makes no-trace builds reject incompatible
    // pending trace metadata rather than silently dropping its diagnostic state.
    Ok(out)
}
pub(super) fn decode(
    bytes: &[u8],
    live: &GpuState,
    control_state: &Control3dSnapshot,
    scanout_state: &Scanout3dSnapshot,
    submit: &Submit3dSnapshot,
    ram_base: u64,
    ram_len: u64,
) -> Result<Option<PendingCheckpoint>, Error> {
    let mut r = Reader::new(bytes);
    match r.u8()? {
        0 => {
            r.finish()?;
            return Ok(None);
        }
        1 => {}
        _ => return Err(Error::Invalid),
    }
    let key = Submit3dKey {
        epoch: r.u64()?,
        sequence: r.u64()?,
    };
    let queue_generation = r.u64()?;
    let last_exchange = r.u64()?;
    need(
        key.epoch == control_state.epoch
            && key.sequence > 0
            && key.sequence.checked_add(1) == Some(submit.next_sequence)
            && queue_generation > 0
            && last_exchange <= MAX_EXCHANGES,
    )?;
    let header = CtrlHeader::from_bytes(r.take(24)?).ok_or(Error::Invalid)?;
    need(header.flags & !p::FLAG_FENCE == 0 && header.ring_idx == 0 && header.padding == [0; 3])?;
    let head = u16::from_le_bytes(r.take(2)?.try_into().map_err(|_| Error::Corrupt)?);
    let mut segments = Vec::new();
    let mut writable = false;
    for _ in 0..r.count(256, 13)? {
        let s = Segment {
            addr: r.u64()?,
            len: r.u32()?,
            writable: match r.u8()? {
                0 => false,
                1 => true,
                _ => return Err(Error::Invalid),
            },
        };
        need(
            s.len > 0
                && s.addr >= ram_base
                && s.addr.checked_add(u64::from(s.len)).is_some_and(|end| {
                    ram_base
                        .checked_add(ram_len)
                        .is_some_and(|limit| end <= limit)
                })
                && (!writable || s.writable),
        )?;
        writable |= s.writable;
        segments.push(s);
    }
    let chain = DescriptorChain { head, segments };
    need(chain.writable_len() >= 24 && chain.readable_len() >= 24)?;
    let accepted = control(
        r.blob(MAX_CONTROL_BYTES)?,
        live.control3d.as_ref().ok_or(Error::Unsupported)?,
        ram_base,
        ram_len,
    )?;
    need(accepted == *control_state)?;
    let request = match r.u8()? {
        1 => {
            let context = r.id()?;
            let ctx = accepted
                .contexts
                .iter()
                .find(|c| c.identity == context)
                .ok_or(Error::Invalid)?;
            need(
                header.ctx_id == context.id
                    || (header.ty == p::CMD_TRANSFER_TO_HOST_2D && header.ctx_id == 0),
            )?;
            let mut resources = Vec::new();
            for _ in 0..r.count(MAX_PRODUCTION_RESOURCES, 12)? {
                let identity = r.id()?;
                need(
                    !resources
                        .iter()
                        .any(|r: &AcceptedResource3d| r.identity == identity),
                )?;
                let saved = accepted
                    .resources
                    .iter()
                    .find(|v| v.identity == identity)
                    .ok_or(Error::Invalid)?;
                resources.push(AcceptedResource3d {
                    identity,
                    metadata: saved.metadata,
                    backing: saved.backing.as_ref().map(|entries| AcceptedBacking3d {
                        generation: saved.backing_generation.expect("validated backing"),
                        byte_length: entries.iter().map(|e| u64::from(e.length)).sum(),
                    }),
                });
            }
            let kind = match r.u8()? {
                1 => {
                    let bytes = r.blob(MAX_SUBMISSION_BYTES)?.to_vec();
                    need(
                        header.ty == p::CMD_SUBMIT_3D
                            && bytes.len().is_multiple_of(4)
                            && chain.readable_len() == 32 + bytes.len() as u64,
                    )?;
                    Submit3dKind::Commands(bytes)
                }
                2 => {
                    let t = Transfer3d {
                        offset: r.u64()?,
                        box_: Transfer3dBox {
                            x: r.u32()?,
                            y: r.u32()?,
                            z: r.u32()?,
                            width: r.u32()?,
                            height: r.u32()?,
                            depth: r.u32()?,
                        },
                        resource_id: r.u32()?,
                        level: r.u32()?,
                        stride: r.u32()?,
                        layer_stride: r.u32()?,
                        direction: r.u32()?,
                    };
                    need(match header.ty {
                        p::CMD_TRANSFER_TO_HOST_2D => {
                            t.direction == 1 && chain.readable_len() == 56
                        }
                        p::CMD_TRANSFER_TO_HOST_3D => {
                            t.direction == 1 && chain.readable_len() == 72
                        }
                        p::CMD_TRANSFER_FROM_HOST_3D => {
                            t.direction == 2 && chain.readable_len() == 72
                        }
                        _ => false,
                    })?;
                    let resource = resources
                        .iter()
                        .find(|v| v.identity.id == t.resource_id)
                        .ok_or(Error::Invalid)?;
                    super::super::submit3d::validate_transfer(t, resource, 32 << 20)
                        .map_err(|_| Error::Invalid)?;
                    Submit3dKind::Transfer(t)
                }
                _ => return Err(Error::Invalid),
            };
            if header.ty == p::CMD_TRANSFER_TO_HOST_2D && header.ctx_id == 0 {
                let Submit3dKind::Transfer(t) = kind else {
                    return Err(Error::Invalid);
                };
                need(
                    resources
                        .iter()
                        .any(|r| r.identity.id == t.resource_id && r.metadata.flags == 1),
                )?;
            }
            let mut expected = ctx.resources.clone();
            if let Submit3dKind::Transfer(t) = kind
                && !expected.iter().any(|id| id.id == t.resource_id)
            {
                expected.push(
                    accepted
                        .resources
                        .iter()
                        .find(|r| r.identity.id == t.resource_id)
                        .ok_or(Error::Invalid)?
                        .identity,
                );
            }
            need(resources.iter().map(|r| r.identity).eq(expected))?;
            PendingRequest::Render(Submit3dRequest {
                key,
                context,
                header,
                resources,
                kind,
            })
        }
        2 => {
            let saved = scanout(r.blob(256)?)?;
            let binding = saved.binding.ok_or(Error::Invalid)?;
            need(
                Some(binding) == scanout_state.binding
                    && header.ty == p::CMD_RESOURCE_FLUSH
                    && chain.readable_len() == 48,
            )?;
            PendingRequest::Scanout(Scanout3dRequest {
                key,
                header,
                binding,
            })
        }
        _ => return Err(Error::Invalid),
    };
    let completion = Submit3dCompletion {
        key,
        exchange_sequence: r.u64()?,
        outcome: crate::session_gpu::decode_outcome(r.u8()?).map_err(|_| Error::Invalid)?,
        gpu_complete: r.u8()? == 1,
        applied_commands: r.u32()?,
        draws: r.u32()?,
    };
    need(
        completion.gpu_complete
            && completion.exchange_sequence <= last_exchange
            && completion.applied_commands <= 4096
            && completion.draws <= 256
            && (!matches!(request, PendingRequest::Scanout(_))
                || (completion.applied_commands == 0 && completion.draws == 0)),
    )?;
    need(r.u8()? == u8::from(cfg!(feature = "gpu-trace")))?;
    #[cfg(feature = "gpu-trace")]
    let trace = {
        let command_type = r.u32()?;
        let mut values = [None; 7];
        for value in &mut values {
            let tag = r.u8()?;
            let n = r.u64()?;
            *value = match tag {
                0 => {
                    need(n == 0)?;
                    None
                }
                1 => Some(n),
                _ => return Err(Error::Invalid),
            }
        }
        let tag = r.u8()?;
        let mut words = [0; 12];
        for v in &mut words {
            *v = r.u32()?;
        }
        let transfer_words = match tag {
            0 => {
                need(words == [0; 12])?;
                None
            }
            1 => Some(words),
            _ => return Err(Error::Invalid),
        };
        let as_u32 = |v: Option<u64>| {
            v.map(|v| u32::try_from(v).map_err(|_| Error::Invalid))
                .transpose()
        };
        super::super::CommandTraceMeta {
            command_type,
            submit_sequence: values[0],
            fence_id: values[1],
            scanout: as_u32(values[2])?,
            resource_id: as_u32(values[3])?,
            resource_width: as_u32(values[4])?,
            resource_height: as_u32(values[5])?,
            backing_entries: as_u32(values[6])?,
            transfer_words,
        }
    };
    r.finish()?;
    Ok(Some(PendingCheckpoint {
        pending: PendingSubmit3d {
            request,
            chain,
            queue_generation,
            accepted,
            #[cfg(feature = "gpu-trace")]
            trace,
        },
        last_exchange,
        completion,
    }))
}
