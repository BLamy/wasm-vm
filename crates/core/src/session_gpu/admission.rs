//! Exclusive admission of physical progress into the logical guest timeline.
use super::*;
use crate::bus::Bus;
use crate::{
    dev::virtio::gpu::{
        self,
        submit3d::{PendingRequest, Submit3dKind},
    },
    session_clock::{SessionEffect, SessionPhase, SessionPosition},
};

pub(crate) struct PreparedResult {
    pub(super) position: SessionPosition,
    pub(super) result: GpuResult,
    pub(super) payload: Option<Payload>,
}
pub(crate) struct TransportReceipt {
    pub(super) exchange: Submit3dExchange,
    pub(super) layers: Option<(u32, u32)>,
    pub(super) output: bool,
    pub(super) length: usize,
    pub(super) bytes: Vec<u8>,
}
impl crate::Machine {
    /// Record a fresh physical exchange. Replay's physical transport has a separate
    /// receipt-only API: live bytes can never acquire guest write authority there.
    pub fn session_gpu_dma(
        &mut self,
        exchange: &Submit3dExchange,
        output: Option<&[u8]>,
        layers: Option<(u32, u32)>,
    ) -> Result<Vec<u8>, GpuError> {
        if !self.host_ingress_gate.allows_host() || self.session_gpu_replay()? {
            return Err(GpuError::ReplayIngress);
        }
        let (state, _, _, index) = self.gpu.as_ref().ok_or(GpuError::Profile)?;
        let prepared = gpu::prepare_submit3d_dma(
            &self.virtio[*index].0,
            state,
            &self.bus,
            exchange,
            output.map(<[u8]>::len),
            layers,
        )
        .map_err(native_error)?;
        let bytes = if let Some(bytes) = output {
            bytes.to_vec()
        } else {
            prepared.read(&self.bus).map_err(native_error)?
        };
        let reference = PayloadRef::of(&bytes)?;
        let (request_sha256, logical_epoch) = self.gpu_result_identity()?;
        let mut logical = *exchange;
        logical.key.epoch = logical_epoch;
        let kind = if output.is_some() {
            ResultKind::Scatter {
                exchange: logical,
                layers,
                payload: reference,
            }
        } else {
            ResultKind::Gather {
                exchange: logical,
                layers,
                expected: reference,
            }
        };
        let result = GpuResult {
            request_sha256,
            kind,
        };
        self.admit_gpu_result(result, Some(bytes), false)?
            .ok_or(GpuError::Admission)
    }
    /// Supply exactly one authenticated next result. Its position fences dispatch;
    /// missing payloads or replacing an unconsumed result are explicit refusals.
    pub fn prepare_session_gpu_replay(
        &mut self,
        position: SessionPosition,
        result: GpuResult,
        payload: Option<Payload>,
    ) -> Result<(), GpuError> {
        if self.session_replay_limit.is_some() || !self.host_ingress_gate.allows_host() {
            return Err(GpuError::ReplayIngress);
        }
        self.prepare_gpu_replay_owned(position, result, payload)
    }
    fn prepare_gpu_replay_owned(
        &mut self,
        position: SessionPosition,
        result: GpuResult,
        payload: Option<Payload>,
    ) -> Result<(), GpuError> {
        if !self.session_gpu_replay()? {
            return Err(GpuError::ReplayIngress);
        }
        result.validate()?;
        let now = self.session_position().ok_or(GpuError::Inactive)?;
        if position.phase != SessionPhase::Before
            || position.transition < now.transition
            || position.retired < now.retired
            || position.retired > position.transition
            || position.ordinal == 0
            || position.sequence <= now.sequence
            || self.session_gpu.as_ref().unwrap().prepared.is_some()
        {
            return Err(GpuError::Position);
        }
        match result.kind {
            ResultKind::Scatter {
                payload: reference, ..
            } => {
                let p = payload.as_ref().ok_or(GpuError::MissingPayload)?;
                if p.reference != reference || PayloadRef::of(&p.bytes)? != reference {
                    return Err(GpuError::Payload);
                }
            }
            _ if payload.is_some() => return Err(GpuError::Payload),
            _ => {}
        }
        self.session_gpu.as_mut().unwrap().prepared = Some(PreparedResult {
            position,
            result,
            payload,
        });
        Ok(())
    }
    /// Physical replay consumes already admitted DMA receipts. It cannot change RAM,
    /// counters, or the result cursor. An early call is retryable PhysicalPending.
    pub fn replay_session_gpu_transport(
        &mut self,
        exchange: &Submit3dExchange,
        output: Option<&[u8]>,
        layers: Option<(u32, u32)>,
    ) -> Result<Vec<u8>, GpuError> {
        if !self.session_gpu_replay()? {
            return Err(GpuError::ReplayIngress);
        }
        if self.session_sources.borrow().error().is_some() {
            return Err(GpuError::Admission);
        }
        self.revoke_stale_gpu_transport()?;
        let (state, _, _, index) = self.gpu.as_ref().ok_or(GpuError::Profile)?;
        let state = state.borrow();
        let pending = state
            .submit3d
            .as_ref()
            .and_then(|s| s.pending.as_ref())
            .ok_or(GpuError::StaleOwner)?;
        if pending.request.key() != exchange.key
            || self.virtio[*index].0.borrow().queue_generation(0) != Some(pending.queue_generation)
        {
            return Err(GpuError::StaleOwner);
        }
        let session = self.session_gpu.as_mut().unwrap();
        let receipt = session.transport.front().ok_or(GpuError::PhysicalPending)?;
        if receipt.exchange != *exchange
            || receipt.layers != layers
            || receipt.output != output.is_some()
            || output.is_some_and(|bytes| bytes.len() != receipt.length)
        {
            return Err(GpuError::Intent);
        }
        let receipt = session.transport.pop_front().unwrap();
        session.transport_bytes -= receipt.bytes.len();
        Ok(receipt.bytes)
    }
    /// Only the tape-owning ReplayDriver can deliver inside an admitted replay.
    pub(crate) fn replay_recorded_session_gpu(
        &mut self,
        position: SessionPosition,
        result: GpuResult,
        payload: Option<Payload>,
    ) -> Result<(), GpuError> {
        if self.session_replay_limit.is_none()
            || !self.host_ingress_gate.replay_active()
            || !self.session_gpu_replay()?
        {
            return Err(GpuError::ReplayIngress);
        }
        let mut next = self.session_position().ok_or(GpuError::Inactive)?;
        if next.phase != SessionPhase::Before {
            return Err(GpuError::Position);
        }
        next.sequence = next.sequence.checked_add(1).ok_or(GpuError::Exhausted)?;
        next.ordinal = next.ordinal.checked_add(1).ok_or(GpuError::Exhausted)?;
        if next != position {
            return Err(GpuError::Position);
        }
        match result.kind {
            ResultKind::Scatter {
                payload: expected, ..
            } => {
                let supplied = payload.as_ref().ok_or(GpuError::MissingPayload)?;
                if supplied.reference != expected || PayloadRef::of(&supplied.bytes)? != expected {
                    return Err(GpuError::Payload);
                }
            }
            _ if payload.is_some() => return Err(GpuError::Payload),
            _ => {}
        }
        self.admit_gpu_result(result, payload.map(|p| p.bytes), true)
            .map(|_| ())
    }

    /// Paused replay can admit a due frame without inventing a guest transition.
    pub fn deliver_session_gpu_replay(&mut self) -> Result<(), GpuError> {
        if self.session_replay_limit.is_some() || !self.host_ingress_gate.allows_host() {
            return Err(GpuError::ReplayIngress);
        }
        if !self.session_gpu_replay()? {
            return Err(GpuError::ReplayIngress);
        }
        self.apply_prepared_gpu()
    }
    pub(crate) fn next_session_gpu_transition(&self) -> Option<u64> {
        self.session_gpu
            .as_ref()?
            .prepared
            .as_ref()
            .map(|p| p.position.transition)
    }
    fn revoke_stale_gpu_transport(&mut self) -> Result<(), GpuError> {
        let (state, _, _, index) = self.gpu.as_ref().ok_or(GpuError::Profile)?;
        let state = state.borrow();
        let current = state
            .submit3d
            .as_ref()
            .and_then(|s| s.pending.as_ref())
            .and_then(|pending| {
                (self.virtio[*index].0.borrow().queue_generation(0)
                    == Some(pending.queue_generation))
                .then_some(pending.request.key())
            });
        let session = self.session_gpu.as_mut().ok_or(GpuError::Inactive)?;
        session
            .transport
            .retain(|receipt| Some(receipt.exchange.key) == current);
        session.transport_bytes = session.transport.iter().map(|r| r.bytes.len()).sum();
        if session.restored_complete != current {
            session.restored_complete = None;
        }
        Ok(())
    }
    pub(crate) fn prepare_gpu_boundary(&mut self) -> Result<(), GpuError> {
        if self.session_gpu.is_some() {
            self.revoke_stale_gpu_transport()?;
        }
        let Some(session) = self.session_gpu.as_ref() else {
            return Ok(());
        };
        if session.replay {
            if self.session_replay_limit.is_some() {
                return Ok(());
            }
            if session.prepared.is_some() {
                self.apply_prepared_gpu()?;
            }
            let state = &self.gpu.as_ref().ok_or(GpuError::Profile)?.0;
            let pending = state
                .borrow()
                .submit3d
                .as_ref()
                .is_some_and(|s| s.pending.is_some());
            if pending && self.session_gpu.as_ref().unwrap().prepared.is_none() {
                return Err(GpuError::PhysicalPending);
            }
        } else {
            let state = &self.gpu.as_ref().ok_or(GpuError::Profile)?.0;
            let completion = state
                .borrow()
                .submit3d
                .as_ref()
                .and_then(|s| s.physical_completion());
            if let Some(mut completion) = completion {
                let (request_sha256, epoch) = self.gpu_result_identity()?;
                completion.key.epoch = epoch;
                self.admit_gpu_result(
                    GpuResult {
                        request_sha256,
                        kind: ResultKind::Complete(completion),
                    },
                    None,
                    false,
                )?;
            }
        }
        Ok(())
    }
    fn apply_prepared_gpu(&mut self) -> Result<(), GpuError> {
        let now = self.session_position().ok_or(GpuError::Inactive)?;
        let prepared = self
            .session_gpu
            .as_ref()
            .unwrap()
            .prepared
            .as_ref()
            .ok_or(GpuError::PhysicalPending)?;
        if prepared.position.transition > now.transition {
            return Ok(());
        }
        let mut next = now;
        next.sequence = next.sequence.checked_add(1).ok_or(GpuError::Exhausted)?;
        next.ordinal = next.ordinal.checked_add(1).ok_or(GpuError::Exhausted)?;
        if next != prepared.position {
            return Err(GpuError::Position);
        }
        let result = prepared.result;
        let payload = prepared.payload.as_ref().map(|p| p.bytes.clone());
        self.admit_gpu_result(result, payload, true)?;
        self.session_gpu.as_mut().unwrap().prepared = None;
        Ok(())
    }
    fn gpu_result_identity(&self) -> Result<([u8; 32], u64), GpuError> {
        let session = self.session_gpu.as_ref().ok_or(GpuError::Inactive)?;
        let state = self.gpu.as_ref().ok_or(GpuError::Profile)?.0.borrow();
        let submit = state.submit3d.as_ref().ok_or(GpuError::Profile)?;
        let pending = submit.pending.as_ref().ok_or(GpuError::Intent)?;
        let epoch = session
            .epochs
            .borrow_mut()
            .observe(pending.request.key().epoch)?;
        let logical_queue = session
            .epochs
            .borrow_mut()
            .observe_queue(pending.queue_generation)?;
        Ok((request_digest(pending, epoch, logical_queue), epoch))
    }
    /// Every fallible check precedes event reservation. From reservation through
    /// RAM/shadow/ring publication this holds the sole mutable Machine borrow.
    fn admit_gpu_result(
        &mut self,
        result: GpuResult,
        mut bytes: Option<Vec<u8>>,
        replay: bool,
    ) -> Result<Option<Vec<u8>>, GpuError> {
        result.validate()?;
        let session = self.session_gpu.as_ref().ok_or(GpuError::Inactive)?;
        if replay != session.replay {
            return Err(GpuError::ReplayIngress);
        }
        session.cursor.checked_add(1).ok_or(GpuError::Exhausted)?;
        let (intent, epoch) = self.gpu_result_identity()?;
        if intent != result.request_sha256 || result.key().epoch != epoch {
            return Err(GpuError::Intent);
        }
        if self.session_pending_events() != 0 {
            return Err(GpuError::Position);
        }
        let position = self.session_position().ok_or(GpuError::Inactive)?;
        if position.phase != SessionPhase::Before {
            return Err(GpuError::Position);
        }
        let (state, queue, _, index) = self.gpu.as_ref().ok_or(GpuError::Profile)?;
        let state = state.clone();
        let slot = self.virtio[*index].0.clone();
        let physical_key = state
            .borrow()
            .submit3d
            .as_ref()
            .and_then(|s| s.pending.as_ref())
            .ok_or(GpuError::Intent)?
            .request
            .key();
        if physical_key.sequence != result.key().sequence {
            return Err(GpuError::Intent);
        }
        let mut physical_result = result;
        match &mut physical_result.kind {
            ResultKind::Gather { exchange, .. } | ResultKind::Scatter { exchange, .. } => {
                exchange.key = physical_key
            }
            ResultKind::Complete(completion) => completion.key = physical_key,
        }
        let settled = session.restored_complete == Some(physical_key);
        let mut dma = None;
        let mut payload = None;
        match physical_result.kind {
            ResultKind::Gather {
                exchange,
                layers,
                expected,
            } => {
                let plan =
                    gpu::prepare_submit3d_dma(&slot, &state, &self.bus, &exchange, None, layers)
                        .map_err(native_error)?;
                let input = plan.read(&self.bus).map_err(native_error)?;
                if PayloadRef::of(&input)? != expected {
                    return Err(GpuError::Payload);
                }
                bytes = Some(input);
                dma = Some(plan);
            }
            ResultKind::Scatter {
                exchange,
                layers,
                payload: reference,
            } => {
                let data = bytes.as_ref().ok_or(GpuError::MissingPayload)?;
                if PayloadRef::of(data)? != reference {
                    return Err(GpuError::Payload);
                }
                dma = Some(
                    gpu::prepare_submit3d_dma(
                        &slot,
                        &state,
                        &self.bus,
                        &exchange,
                        Some(data.len()),
                        layers,
                    )
                    .map_err(native_error)?,
                );
                if !replay {
                    session.payloads.validate_insert(reference, data)?;
                    payload = Some(Payload {
                        reference,
                        bytes: data.clone(),
                    });
                }
            }
            ResultKind::Complete(completion) => {
                validate_completion(&slot, queue, &state, &self.bus, completion)?;
                if replay && completion.outcome.is_ok() {
                    let physical = state
                        .borrow()
                        .submit3d
                        .as_ref()
                        .unwrap()
                        .physical_completion()
                        .ok_or(GpuError::PhysicalPending)?;
                    if !physical.gpu_complete || physical.outcome.is_err() {
                        return Err(GpuError::PhysicalFailure);
                    }
                    if !settled && !session.transport.is_empty() {
                        return Err(GpuError::PhysicalPending);
                    }
                }
            }
        }
        if replay && !settled && dma.is_some() {
            let retained = if matches!(result.kind, ResultKind::Gather { .. }) {
                bytes.as_ref().unwrap().len()
            } else {
                0
            };
            if session.transport.len() >= MAX_OBJECTS
                || session
                    .transport_bytes
                    .checked_add(retained)
                    .is_none_or(|n| n > MAX_RESIDENT_BYTES)
            {
                return Err(GpuError::Limit);
            }
        }
        let effect = SessionEffect::HostInput {
            channel: CHANNEL,
            bytes: result.encode()?,
        };
        // Cancel a recorded failed job only after the admission reservation succeeds.
        // The callback has no Machine handle; a failed cancellation rolls the reservation
        // back without permitting any guest execution or losing the owned pending request.
        let clock_before = if replay
            && matches!(physical_result.kind,ResultKind::Complete(c) if c.outcome.is_err())
        {
            Some(
                self.session_clock
                    .as_ref()
                    .ok_or(GpuError::Inactive)?
                    .clone(),
            )
        } else {
            None
        };
        let recorded = replay && self.session_replay_limit.is_some();
        (if recorded {
            self.stage_recorded_session_effect(position.transition, effect)
        } else {
            self.stage_session_effect(position.transition, effect)
        })
        .map_err(|_| GpuError::Admission)?;
        if replay
            && let ResultKind::Complete(completion) = physical_result.kind
            && completion.outcome.is_err()
            && !settled
            && state
                .borrow_mut()
                .submit3d
                .as_mut()
                .unwrap()
                .cancel_physical(completion.key)
                .is_err()
        {
            self.session_clock = clock_before;
            return Err(GpuError::PhysicalFailure);
        }
        let mut returned = None;
        let apply = |machine: &mut crate::Machine, channel, _: &[u8]| {
            assert_eq!(channel, CHANNEL);
            let session = machine.session_gpu.as_mut().unwrap();
            let mut length = 0;
            let sequence = match physical_result.kind {
                ResultKind::Gather {
                    exchange, layers, ..
                }
                | ResultKind::Scatter {
                    exchange, layers, ..
                } => {
                    let output = matches!(result.kind, ResultKind::Scatter { .. });
                    let input = bytes.take().unwrap();
                    length = input.len() as u64;
                    dma.as_ref().unwrap().commit(
                        &state,
                        &mut machine.bus,
                        &exchange,
                        output.then_some(input.as_slice()),
                    );
                    if !output && layers.is_none() {
                        state
                            .borrow_mut()
                            .mirror_legacy_input(&exchange, &input)
                            .expect("preflighted legacy mirror");
                    }
                    if let Some(payload) = payload.take() {
                        session
                            .payloads
                            .insert(payload)
                            .expect("preflighted immutable window")
                    }
                    if replay && !settled {
                        let retained = if output { Vec::new() } else { input };
                        session.transport_bytes += retained.len();
                        session.transport.push_back(TransportReceipt {
                            exchange,
                            layers,
                            output,
                            length: length as usize,
                            bytes: retained,
                        });
                        returned = Some(Vec::new());
                    } else {
                        returned = Some(if output { Vec::new() } else { input });
                    }
                    exchange.exchange_sequence
                }
                ResultKind::Complete(completion) => {
                    if completion.outcome.is_err() || settled {
                        session.transport.clear();
                        session.transport_bytes = 0;
                    }
                    session.restored_complete = None;
                    state
                        .borrow_mut()
                        .submit3d
                        .as_mut()
                        .unwrap()
                        .admit_result(completion);
                    let (_, queue, _, _) = machine.gpu.as_mut().unwrap();
                    assert!(matches!(
                        gpu::service_submit3d_completion(&slot, queue, &state, &mut machine.bus),
                        gpu::PendingService::Completed
                    ));
                    completion.exchange_sequence
                }
            };
            session.cursor += 1;
            [
                match result.kind {
                    ResultKind::Gather { .. } => 1,
                    ResultKind::Scatter { .. } => 2,
                    ResultKind::Complete(_) => 3,
                },
                session.cursor,
                length,
                sequence,
            ]
        };
        (if recorded {
            self.deliver_recorded_session_host_boundary(apply)
        } else {
            self.deliver_session_host_boundary(apply)
        })
        .map_err(|_| GpuError::Admission)?;
        Ok(returned)
    }
}
fn native_error(error: Control3dError) -> GpuError {
    match error {
        Control3dError::BridgePoisoned => GpuError::StaleOwner,
        Control3dError::OutOfMemory => GpuError::Limit,
        _ => GpuError::Intent,
    }
}
fn validate_completion(
    slot: &Rc<RefCell<crate::dev::virtio::mmio::VirtioMmio>>,
    queue: &Option<crate::dev::virtio::queue::Virtqueue>,
    state: &Rc<RefCell<gpu::GpuState>>,
    bus: &crate::mmio::SystemBus,
    completion: Submit3dCompletion,
) -> Result<(), GpuError> {
    let s = state.borrow();
    let submit = s.submit3d.as_ref().ok_or(GpuError::Profile)?;
    submit.validate_result(completion).map_err(native_error)?;
    let pending = submit.pending.as_ref().ok_or(GpuError::Intent)?;
    let slot = slot.borrow();
    let qs = slot.queue(0);
    if slot.queue_generation(0) != Some(pending.queue_generation)
        || queue.as_ref().is_none_or(|q| !q.matches_state(qs))
        || !bus.ram().ram_contains(qs.device, 4 + 8 * u64::from(qs.num))
    {
        return Err(GpuError::StaleOwner);
    }
    if pending.chain.writable_len() < 24
        || pending
            .chain
            .writable()
            .any(|s| !bus.ram().ram_contains(s.addr, u64::from(s.len)))
    {
        return Err(GpuError::Intent);
    }
    Ok(())
}
/// Canonical accepted authority, never Debug text or current descriptor-table bytes.
pub(crate) fn request_digest(
    pending: &gpu::submit3d::PendingSubmit3d,
    logical_epoch: u64,
    logical_queue: u64,
) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"wasm-vm-gpu-result-intent-v1\0");
    let mut accepted = pending.accepted.clone();
    accepted.epoch = logical_epoch;
    hash.update(accepted.canonical_bytes());
    hash.update(logical_queue.to_le_bytes());
    hash.update(logical_epoch.to_le_bytes());
    hash.update(pending.request.key().sequence.to_le_bytes());
    hash.update(pending.request.header().to_bytes());
    hash.update(pending.chain.head.to_le_bytes());
    hash.update((pending.chain.segments.len() as u32).to_le_bytes());
    for segment in &pending.chain.segments {
        hash.update(segment.addr.to_le_bytes());
        hash.update(segment.len.to_le_bytes());
        hash.update([u8::from(segment.writable)]);
    }
    match &pending.request {
        PendingRequest::Render(request) => {
            hash.update([1]);
            hash.update(request.context.id.to_le_bytes());
            hash.update(request.context.generation.to_le_bytes());
            match &request.kind {
                Submit3dKind::Commands(bytes) => {
                    hash.update([1]);
                    hash.update((bytes.len() as u32).to_le_bytes());
                    hash.update(bytes);
                }
                Submit3dKind::Transfer(t) => {
                    hash.update([2]);
                    hash.update(t.offset.to_le_bytes());
                    for n in [
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
                    ] {
                        hash.update(n.to_le_bytes());
                    }
                }
            }
        }
        PendingRequest::Scanout(request) => {
            hash.update([2]);
            hash.update(
                gpu::scanout3d::Scanout3dSnapshot {
                    next_generation: 1,
                    binding: Some(request.binding),
                    counters: gpu::scanout3d::Scanout3dCounters::default(),
                }
                .canonical_bytes(),
            );
        }
    }
    hash.finalize().into()
}
