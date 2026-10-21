//! One ordered, bounded replay of a session prefix. The source checkpoint is loaded once; a
//! mismatch stops the candidate at its first observed position and never seeks past it.
use alloc::{string::String, vec, vec::Vec};
use sha2::{Digest, Sha256};

use crate::session_clock::{
    MAX_EVENTS, MAX_OWNED_BYTES, SessionDelivery, SessionEffect, SessionError, SessionPhase,
    SessionPosition,
    sources::{DivergenceReason, ObservationRecord, ObservationTape},
};
use crate::{Machine, RunOutcome};

pub const MAX_REPLAY_EVENTS: usize = 4096;
pub const MAX_REPLAY_BYTES: usize = 64 << 20;
pub const MAX_INITIAL_BYTES: usize = 512 << 20;
/// Owned host console drain. Its payload is the exact SBI-then-UART byte stream removed at this
/// boundary; replay compares it before mutating the host queue and never calls the JS sink.
pub const OUTPUT_DRAIN_CHANNEL: u16 = 21;

fn coordinate(p: SessionPosition) -> (u64, SessionPhase, u32, u64) {
    (p.transition, p.phase, p.ordinal, p.sequence)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StateWitness {
    /// Quiescent position after all recorded effects at this point have been drained.
    pub position: SessionPosition,
    /// SHA-256 of the complete native session resume (CPU, RAM, devices, disk overlay, clock).
    pub resume_sha256: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct ReplayPlan {
    pub begin: SessionPosition,
    pub end: SessionPosition,
    pub initial_resume: Vec<u8>,
    pub events: Vec<SessionDelivery>,
    pub witnesses: Vec<StateWitness>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayReason {
    InvalidPlan,
    InitialCheckpoint,
    MissingEvent,
    ExtraEvent,
    MisorderedEvent,
    EventPayload,
    Adapter,
    StateDigest,
    Runtime,
    Stalled,
    Exhausted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayDivergence {
    pub reason: ReplayReason,
    pub position: SessionPosition,
    /// Zero-based index of the first event that did not match, or the next expected event.
    pub event_index: usize,
    pub detail: String,
}

impl ReplayPlan {
    pub fn validate(&self) -> Result<(), ReplayDivergence> {
        let fail = |detail: &'static str| ReplayDivergence {
            reason: ReplayReason::InvalidPlan,
            position: self.begin,
            event_index: 0,
            detail: detail.into(),
        };
        if self.begin.phase != SessionPhase::Before
            || self.end.phase != SessionPhase::Before
            || self.begin.transition > self.end.transition
            || self.begin.sequence > self.end.sequence
            || self.begin.retired > self.begin.transition
            || self.end.retired > self.end.transition
            || self.initial_resume.is_empty()
            || self.initial_resume.len() > MAX_INITIAL_BYTES
            || self.events.len() > MAX_REPLAY_EVENTS
            || self.witnesses.is_empty()
            || self.witnesses.len() > MAX_REPLAY_EVENTS
        {
            return Err(fail("invalid interval or bound"));
        }
        let mut previous = self.begin;
        let mut bytes = 0usize;
        for (index, event) in self.events.iter().enumerate() {
            let p = event.position;
            let effect_phase = if matches!(event.effect, SessionEffect::Observation(_)) {
                SessionPhase::Observe
            } else {
                SessionPhase::Before
            };
            if p.phase != effect_phase
                || p.transition < self.begin.transition
                || p.transition > self.end.transition
                || (p.phase == SessionPhase::Observe && p.transition == self.end.transition)
                || p.retired < previous.retired
                || p.retired > p.transition
                || (p.transition == previous.transition && p.retired != previous.retired)
                || p.sequence
                    != previous
                        .sequence
                        .checked_add(1)
                        .ok_or_else(|| fail("sequence overflow"))?
                || p.ordinal == 0
                || (p.transition == previous.transition
                    && p.phase == previous.phase
                    && previous.ordinal.checked_add(1) != Some(p.ordinal))
                || (p.transition != previous.transition || p.phase != previous.phase)
                    && p.ordinal != 1
                || (p.transition, p.phase, p.ordinal)
                    <= (previous.transition, previous.phase, previous.ordinal)
            {
                return Err(ReplayDivergence {
                    reason: ReplayReason::InvalidPlan,
                    position: p,
                    event_index: index,
                    detail: "event order or coordinate".into(),
                });
            }
            bytes = bytes
                .checked_add(match &event.effect {
                    SessionEffect::Observation(v) => v.bytes.len(),
                    SessionEffect::HostInput { bytes, .. }
                    | SessionEffect::WriteRam { bytes, .. } => bytes.len(),
                    SessionEffect::ExternalPending(_) => 1,
                })
                .ok_or_else(|| ReplayDivergence {
                    reason: ReplayReason::InvalidPlan,
                    position: p,
                    event_index: index,
                    detail: "event byte overflow".into(),
                })?;
            if bytes > MAX_REPLAY_BYTES {
                return Err(ReplayDivergence {
                    reason: ReplayReason::InvalidPlan,
                    position: p,
                    event_index: index,
                    detail: "event byte bound exceeded".into(),
                });
            }
            previous = p;
        }
        let mut previous_witness = None;
        for witness in &self.witnesses {
            let p = witness.position;
            if p.phase != SessionPhase::Before
                || p.transition < self.begin.transition
                || p.transition > self.end.transition
                || p.retired > p.transition
                || previous_witness.is_some_and(|q| coordinate(q) >= coordinate(p))
            {
                return Err(fail("witness order"));
            }
            previous_witness = Some(p);
        }
        if self.witnesses[0].position != self.begin
            || self.witnesses.last().unwrap().position != self.end
        {
            return Err(fail("initial and final witnesses required"));
        }
        if self.end.sequence > previous.sequence {
            let missing = previous.sequence + 1;
            let position = self
                .witnesses
                .iter()
                .find(|witness| witness.position.sequence == missing)
                .map_or(self.end, |witness| witness.position);
            return Err(ReplayDivergence {
                reason: ReplayReason::MissingEvent,
                position,
                event_index: self.events.len(),
                detail: alloc::format!(
                    "missing event sequence {missing} after {:?}; declared end is {:?}; reported position is the earliest retained witness for that sequence, or the declared end boundary",
                    previous,
                    self.end
                ),
            });
        }
        if self.end.sequence < previous.sequence {
            let index = self
                .events
                .iter()
                .position(|event| event.position.sequence > self.end.sequence)
                .unwrap_or(self.events.len() - 1);
            return Err(ReplayDivergence {
                reason: ReplayReason::ExtraEvent,
                position: self.events[index].position,
                event_index: index,
                detail: alloc::format!(
                    "event sequence {} exceeds declared end sequence {}",
                    self.events[index].position.sequence,
                    self.end.sequence
                ),
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplayStatus {
    Ready,
    Completed,
    Diverged,
}

pub struct ReplayDriver {
    plan: ReplayPlan,
    event_cursor: usize,
    witness_cursor: usize,
    status: ReplayStatus,
    first_failure: Option<ReplayDivergence>,
    expected_device_cursor: Option<u64>,
    expected_network_cursor: Option<u64>,
    source_chunks: Vec<ObservationTape>,
    source_chunk_index: usize,
    source_loaded: usize,
    #[cfg(feature = "virgl-renderer")]
    gpu: Option<GpuReplayState>,
}

#[cfg(feature = "virgl-renderer")]
pub struct GpuReplayConfig {
    pub renderer_digest: [u8; 32],
    /// Present only after the candidate's authenticated RAM page graph is reconstructed.
    pub ram_digest: Option<[u8; 32]>,
    /// One bounded checkpoint interval, copied and authenticated before any restore.
    pub payloads: Vec<crate::session_gpu::Payload>,
}
#[cfg(feature = "virgl-renderer")]
struct GpuReplayState {
    renderer_digest: [u8; 32],
    ram_digest: Option<[u8; 32]>,
    payloads: alloc::collections::BTreeMap<[u8; 32], crate::session_gpu::Payload>,
    expected_cursor: Option<u64>,
}
#[cfg(feature = "virgl-renderer")]
impl GpuReplayState {
    fn new(plan: &ReplayPlan, config: GpuReplayConfig) -> Result<Self, ReplayDivergence> {
        use crate::session_gpu::{
            GpuResult, MAX_OBJECTS, MAX_RESIDENT_BYTES, PayloadRef, ResultKind,
        };
        let fail = |detail: &str| ReplayDivergence {
            reason: ReplayReason::InvalidPlan,
            position: plan.begin,
            event_index: 0,
            detail: detail.into(),
        };
        if config.renderer_digest == [0; 32] || config.payloads.len() > MAX_OBJECTS {
            return Err(fail("GPU interval bound or renderer identity"));
        }
        let mut payloads = alloc::collections::BTreeMap::new();
        let mut total = 0usize;
        for payload in config.payloads {
            total = total
                .checked_add(payload.bytes.len())
                .ok_or_else(|| fail("GPU interval overflow"))?;
            if total > MAX_RESIDENT_BYTES
                || PayloadRef::of(&payload.bytes).ok() != Some(payload.reference)
                || payloads.insert(payload.reference.sha256, payload).is_some()
            {
                return Err(fail("GPU payload digest, duplicate or interval budget"));
            }
        }
        let mut required = alloc::collections::BTreeMap::new();
        for (index, event) in plan.events.iter().enumerate() {
            if let SessionEffect::HostInput {
                channel: crate::session_gpu::CHANNEL,
                bytes,
            } = &event.effect
            {
                let result = GpuResult::decode(bytes).map_err(|_| ReplayDivergence {
                    event_index: index,
                    position: event.position,
                    ..fail("GPU envelope")
                })?;
                let reference = match result.kind {
                    // Upload bytes are deterministic guest RAM, checked against this hash.
                    // Only GPU-to-guest observations require an external durable body.
                    ResultKind::Scatter { payload, .. } => Some(payload),
                    _ => None,
                };
                if let Some(reference) = reference {
                    if payloads
                        .get(&reference.sha256)
                        .is_none_or(|p| p.reference != reference)
                    {
                        return Err(ReplayDivergence {
                            event_index: index,
                            position: event.position,
                            ..fail("missing or conflicting GPU payload")
                        });
                    }
                    required.insert(reference.sha256, reference);
                }
            }
        }
        if required.len() != payloads.len() {
            return Err(fail("unreferenced GPU payload"));
        }
        Ok(Self {
            renderer_digest: config.renderer_digest,
            ram_digest: config.ram_digest,
            payloads,
            expected_cursor: None,
        })
    }
}

impl ReplayDriver {
    fn source_tapes(
        plan: &ReplayPlan,
        policy: crate::session_clock::sources::SourcePolicy,
    ) -> Result<Vec<ObservationTape>, ReplayDivergence> {
        let observations: Vec<_> = plan
            .events
            .iter()
            .filter_map(|event| {
                if let SessionEffect::Observation(value) = &event.effect {
                    Some(ObservationRecord {
                        position: event.position,
                        value: value.clone(),
                    })
                } else {
                    None
                }
            })
            .collect();
        let mut chunks = Vec::new();
        let mut start = 0;
        while start < observations.len() {
            let mut end = start;
            let mut bytes = 0usize;
            while end < observations.len() {
                let transition = observations[end].position.transition;
                let mut group_end = end;
                let mut group_bytes = 0usize;
                while group_end < observations.len()
                    && observations[group_end].position.transition == transition
                {
                    group_bytes += observations[group_end].value.bytes.len();
                    group_end += 1;
                }
                if group_end - end > MAX_EVENTS || group_bytes > MAX_OWNED_BYTES {
                    return Err(ReplayDivergence {
                        reason: ReplayReason::InvalidPlan,
                        position: observations[end].position,
                        event_index: 0,
                        detail: "one transition exceeds observation window".into(),
                    });
                }
                if end > start
                    && (group_end - start > MAX_EVENTS || bytes + group_bytes > MAX_OWNED_BYTES)
                {
                    break;
                }
                bytes += group_bytes;
                end = group_end;
            }
            let tape = ObservationTape {
                policy,
                records: observations[start..end].to_vec(),
            };
            tape.validate().map_err(|e| ReplayDivergence {
                reason: ReplayReason::InvalidPlan,
                position: observations[start].position,
                event_index: 0,
                detail: alloc::format!("observation chunk: {e:?}"),
            })?;
            chunks.push(tape);
            start = end;
        }
        if chunks.is_empty() {
            chunks.push(ObservationTape {
                policy,
                records: vec![],
            });
        }
        Ok(chunks)
    }

    fn source_fence(&self) -> Option<u64> {
        if self.source_chunk_index + 1 >= self.source_chunks.len() {
            return None;
        }
        self.source_chunks[self.source_chunk_index]
            .records
            .last()?
            .position
            .transition
            .checked_add(1)
    }

    fn append_source_window(&mut self, machine: &mut Machine) -> Result<(), ReplayDivergence> {
        let Some(fence) = self.source_fence() else {
            return Ok(());
        };
        let position = machine.session_position().unwrap_or(self.plan.begin);
        if position.transition < fence {
            return Ok(());
        }
        let consumed = self.plan.events[..self.event_cursor]
            .iter()
            .filter(|e| matches!(e.effect, SessionEffect::Observation(_)))
            .count();
        if consumed != self.source_loaded {
            let expected = self.plan.events[self.event_cursor].position;
            return Err(self.failure_at(
                expected,
                ReplayReason::MissingEvent,
                alloc::format!(
                    "observation window reached transition {fence} before recorded event at {expected:?}"
                ),
            ));
        }
        let next = self.source_chunk_index + 1;
        machine
            .append_recorded_session_source_replay(self.source_chunks[next].clone())
            .map_err(|e| {
                self.failure(
                    machine,
                    ReplayReason::Runtime,
                    alloc::format!("observation window append: {e:?}"),
                )
            })?;
        self.source_loaded += self.source_chunks[next].records.len();
        self.source_chunk_index = next;
        Ok(())
    }

    /// The caller constructs a replay-mode machine with the recorded device topology and no
    /// live host providers. The empty source mode precedes restore; recorded observations are
    /// installed only after the checkpoint's own cursor has been authenticated.
    pub fn start(machine: &mut Machine, plan: ReplayPlan) -> Result<Self, ReplayDivergence> {
        Self::start_inner(
            machine,
            plan,
            #[cfg(feature = "virgl-renderer")]
            None,
        )
    }

    #[cfg(feature = "virgl-renderer")]
    pub fn start_gpu(
        machine: &mut Machine,
        plan: ReplayPlan,
        gpu: GpuReplayConfig,
    ) -> Result<Self, ReplayDivergence> {
        Self::start_inner(machine, plan, Some(gpu))
    }

    fn start_inner(
        machine: &mut Machine,
        plan: ReplayPlan,
        #[cfg(feature = "virgl-renderer")] gpu: Option<GpuReplayConfig>,
    ) -> Result<Self, ReplayDivergence> {
        plan.validate()?;
        #[cfg(feature = "virgl-renderer")]
        let gpu = gpu
            .map(|config| GpuReplayState::new(&plan, config))
            .transpose()?;
        let source_chunks = Self::source_tapes(&plan, machine.source_policy())?;
        let source_loaded = source_chunks[0].records.len();
        let mut driver = Self {
            plan,
            event_cursor: 0,
            witness_cursor: 0,
            status: ReplayStatus::Ready,
            first_failure: None,
            expected_device_cursor: None,
            expected_network_cursor: None,
            source_chunks,
            source_chunk_index: 0,
            source_loaded,
            #[cfg(feature = "virgl-renderer")]
            gpu,
        };
        if machine.session_position() != Some(SessionPosition::default())
            || machine.session_sources_active()
        {
            return Err(driver.failure(
                machine,
                ReplayReason::InitialCheckpoint,
                "replay machine is not fresh".into(),
            ));
        }
        machine
            .start_session_sources(
                machine.source_policy(),
                Some(ObservationTape {
                    policy: machine.source_policy(),
                    records: vec![],
                }),
            )
            .map_err(|e| {
                driver.failure(
                    machine,
                    ReplayReason::InitialCheckpoint,
                    alloc::format!("source admission: {e:?}"),
                )
            })?;
        #[cfg(feature = "virgl-renderer")]
        if driver.gpu.is_some() {
            machine.enable_session_gpu_results(true).map_err(|e| {
                driver.failure(
                    machine,
                    ReplayReason::InitialCheckpoint,
                    alloc::format!("GPU result adapter: {e:?}"),
                )
            })?;
        }
        machine.host_ingress_gate.begin_replay();
        let ingress_gate = alloc::rc::Rc::clone(&machine.host_ingress_gate);
        let initial_restore = {
            let _recorded = ingress_gate.recorded_scope();
            #[cfg(feature = "virgl-renderer")]
            if let Some(gpu) = &driver.gpu {
                machine.load_recorded_gpu_history(
                    &driver.plan.initial_resume,
                    &gpu.renderer_digest,
                    gpu.ram_digest.as_ref(),
                )
            } else {
                machine.load_session_resume(&driver.plan.initial_resume)
            }
            #[cfg(not(feature = "virgl-renderer"))]
            machine.load_session_resume(&driver.plan.initial_resume)
        };
        initial_restore.map_err(|e| {
            driver.failure(
                machine,
                ReplayReason::InitialCheckpoint,
                alloc::format!("initial restore: {e:?}"),
            )
        })?;
        if machine.session_position() != Some(driver.plan.begin) {
            return Err(driver.failure(
                machine,
                ReplayReason::InitialCheckpoint,
                "initial coordinate differs".into(),
            ));
        }
        machine
            .append_recorded_session_source_replay(driver.source_chunks[0].clone())
            .map_err(|e| {
                driver.failure(
                    machine,
                    ReplayReason::InitialCheckpoint,
                    alloc::format!("source window: {e:?}"),
                )
            })?;
        if machine.session_devices.is_some() {
            if machine.session_device_replay() != Ok(true) {
                return Err(driver.failure(
                    machine,
                    ReplayReason::InitialCheckpoint,
                    "device adapter is live".into(),
                ));
            }
            let initial = machine.session_device_cursor().map_err(|e| {
                driver.failure(
                    machine,
                    ReplayReason::InitialCheckpoint,
                    alloc::format!("device cursor: {e:?}"),
                )
            })?;
            let count = driver
                .plan
                .events
                .iter()
                .filter(|e| {
                    matches!(
                        e.effect,
                        SessionEffect::HostInput {
                            channel: crate::session_devices::CHANNEL,
                            ..
                        }
                    )
                })
                .count() as u64;
            driver.expected_device_cursor = Some(initial.checked_add(count).ok_or_else(|| {
                driver.failure(
                    machine,
                    ReplayReason::InvalidPlan,
                    "device cursor overflow".into(),
                )
            })?);
        }
        if machine.session_network.is_some() {
            if machine.session_network_replay() != Ok(true) {
                return Err(driver.failure(
                    machine,
                    ReplayReason::InitialCheckpoint,
                    "network adapter is live".into(),
                ));
            }
            let initial = machine.session_network_cursor().map_err(|e| {
                driver.failure(
                    machine,
                    ReplayReason::InitialCheckpoint,
                    alloc::format!("network cursor: {e:?}"),
                )
            })?;
            let count = driver
                .plan
                .events
                .iter()
                .filter(|e| {
                    matches!(
                        e.effect,
                        SessionEffect::HostInput {
                            channel: crate::session_network::CHANNEL,
                            ..
                        }
                    )
                })
                .count() as u64;
            driver.expected_network_cursor = Some(initial.checked_add(count).ok_or_else(|| {
                driver.failure(
                    machine,
                    ReplayReason::InvalidPlan,
                    "network cursor overflow".into(),
                )
            })?);
        }
        #[cfg(feature = "virgl-renderer")]
        if driver.gpu.is_some() {
            let initial = machine.session_gpu_cursor().map_err(|e| {
                driver.failure(
                    machine,
                    ReplayReason::InitialCheckpoint,
                    alloc::format!("GPU cursor: {e:?}"),
                )
            })?;
            let count = driver
                .plan
                .events
                .iter()
                .filter(|e| {
                    matches!(
                        &e.effect,
                        SessionEffect::HostInput {
                            channel: crate::session_gpu::CHANNEL,
                            ..
                        }
                    )
                })
                .count() as u64;
            let expected = initial.checked_add(count).ok_or_else(|| {
                driver.failure(
                    machine,
                    ReplayReason::InvalidPlan,
                    "GPU cursor overflow".into(),
                )
            })?;
            driver.gpu.as_mut().unwrap().expected_cursor = Some(expected);
        }
        machine.session_replay_limit = Some(driver.plan.end.transition);
        driver.check_witnesses(machine)?;
        Ok(driver)
    }

    pub fn status(&self) -> ReplayStatus {
        self.status
    }
    pub fn first_failure(&self) -> Option<&ReplayDivergence> {
        self.first_failure.as_ref()
    }
    pub fn event_cursor(&self) -> usize {
        self.event_cursor
    }
    pub fn end(&self) -> SessionPosition {
        self.plan.end
    }

    fn failure(
        &mut self,
        machine: &Machine,
        reason: ReplayReason,
        detail: String,
    ) -> ReplayDivergence {
        self.failure_at(
            machine.session_position().unwrap_or(self.plan.begin),
            reason,
            detail,
        )
    }

    fn failure_at(
        &mut self,
        position: SessionPosition,
        reason: ReplayReason,
        detail: String,
    ) -> ReplayDivergence {
        let failure = ReplayDivergence {
            reason,
            position,
            event_index: self.event_cursor,
            detail,
        };
        self.status = ReplayStatus::Diverged;
        if self.first_failure.is_none() {
            self.first_failure = Some(failure.clone());
        }
        failure
    }

    fn check_witnesses(&mut self, machine: &mut Machine) -> Result<(), ReplayDivergence> {
        while let Some(expected) = self.plan.witnesses.get(self.witness_cursor).copied() {
            let actual_position = machine.session_position().unwrap_or(self.plan.begin);
            if actual_position == expected.position {
                #[cfg(feature = "virgl-renderer")]
                let gpu_digest = if self.gpu.is_some() {
                    Some(machine.gpu_session_state_digest())
                } else {
                    None
                };
                #[cfg(not(feature = "virgl-renderer"))]
                let gpu_digest: Option<
                    Result<[u8; 32], crate::resume::SnapshotError>,
                > = None;
                let actual = if let Some(digest) = gpu_digest {
                    digest
                } else {
                    machine
                        .save_session_resume()
                        .map(|bytes| Sha256::digest(&bytes).into())
                }
                .map_err(|e| {
                    self.failure(
                        machine,
                        ReplayReason::Runtime,
                        alloc::format!("witness snapshot: {e:?}"),
                    )
                })?;
                if actual != expected.resume_sha256 {
                    return Err(self.failure(
                        machine,
                        ReplayReason::StateDigest,
                        alloc::format!(
                            "resume SHA-256 differs: expected {:02x?}, observed {:02x?}",
                            expected.resume_sha256,
                            actual
                        ),
                    ));
                }
                self.witness_cursor += 1;
            } else if actual_position.transition > expected.position.transition
                || (actual_position.transition == expected.position.transition
                    && actual_position.sequence > expected.position.sequence)
            {
                return Err(self.failure_at(
                    expected.position,
                    ReplayReason::StateDigest,
                    "missed exact state witness".into(),
                ));
            } else {
                break;
            }
        }
        Ok(())
    }

    fn compare_deliveries(&mut self, machine: &mut Machine) -> Result<(), ReplayDivergence> {
        let delivered = machine.take_session_deliveries().map_err(|e| {
            self.failure(
                machine,
                ReplayReason::Runtime,
                alloc::format!("delivery drain: {e:?}"),
            )
        })?;
        for actual in delivered {
            let Some(expected) = self.plan.events.get(self.event_cursor) else {
                return Err(self.failure_at(
                    actual.position,
                    ReplayReason::ExtraEvent,
                    alloc::format!("extra delivery at {:?}", actual.position),
                ));
            };
            if actual != *expected {
                let reason = if actual.position != expected.position {
                    ReplayReason::MisorderedEvent
                } else {
                    ReplayReason::EventPayload
                };
                let first_position = if coordinate(actual.position) < coordinate(expected.position)
                {
                    actual.position
                } else {
                    expected.position
                };
                return Err(self.failure_at(
                    first_position,
                    reason,
                    alloc::format!(
                        "receipt differs: expected {:?}, observed {:?}",
                        expected.position,
                        actual.position
                    ),
                ));
            }
            self.event_cursor += 1;
        }
        Ok(())
    }

    fn apply_before(
        &mut self,
        machine: &mut Machine,
        apply_input: &mut impl FnMut(&mut Machine, u16, &[u8]) -> [u64; 4],
    ) -> Result<bool, ReplayDivergence> {
        let expected = self.plan.events[self.event_cursor].clone();
        let result = match expected.effect {
            SessionEffect::WriteRam { address, bytes } => machine
                .stage_recorded_session_effect(
                    expected.position.transition,
                    SessionEffect::WriteRam { address, bytes },
                )
                .and_then(|_| machine.deliver_recorded_session_boundary())
                .map_err(|e| alloc::format!("RAM delivery: {e:?}")),
            SessionEffect::ExternalPending(value) => machine
                .stage_recorded_session_effect(
                    expected.position.transition,
                    SessionEffect::ExternalPending(value),
                )
                .and_then(|_| machine.deliver_recorded_session_boundary())
                .map_err(|e| alloc::format!("pending delivery: {e:?}")),
            #[cfg(feature = "virgl-renderer")]
            SessionEffect::HostInput {
                channel: crate::session_gpu::CHANNEL,
                bytes,
            } => {
                if self.gpu.is_none() {
                    return Err(self.failure_at(
                        expected.position,
                        ReplayReason::Adapter,
                        "GPU replay adapter absent".into(),
                    ));
                }
                let result = crate::session_gpu::GpuResult::decode(&bytes).map_err(|e| {
                    self.failure_at(
                        expected.position,
                        ReplayReason::EventPayload,
                        alloc::format!("GPU envelope: {e:?}"),
                    )
                })?;
                let payload =
                    if let crate::session_gpu::ResultKind::Scatter { payload, .. } = result.kind {
                        self.gpu
                            .as_ref()
                            .unwrap()
                            .payloads
                            .get(&payload.sha256)
                            .cloned()
                    } else {
                        None
                    };
                match machine.replay_recorded_session_gpu(expected.position, result, payload) {
                    Ok(()) => Ok(()),
                    Err(crate::session_gpu::GpuError::PhysicalPending) => return Ok(false),
                    Err(error) => Err(alloc::format!("GPU result admission: {error:?}")),
                }
            }
            SessionEffect::HostInput {
                channel: crate::session_devices::CHANNEL,
                bytes,
            } => crate::session_devices::DeviceCompletion::decode(&bytes)
                .map_err(|e| alloc::format!("device envelope: {e:?}"))
                .and_then(|event| {
                    machine
                        .replay_recorded_session_device(expected.position, event)
                        .map_err(|e| alloc::format!("device intent: {e:?}"))
                }),
            SessionEffect::HostInput {
                channel: crate::session_network::CHANNEL,
                bytes,
            } => crate::session_network::NetworkEvent::decode(&bytes)
                .map_err(|e| alloc::format!("network envelope: {e:?}"))
                .and_then(|event| {
                    machine
                        .replay_recorded_session_network(expected.position, event)
                        .map_err(|e| alloc::format!("network intent: {e:?}"))
                }),
            SessionEffect::HostInput { channel, bytes }
                if (1..=16).contains(&channel) || channel == OUTPUT_DRAIN_CHANNEL =>
            {
                machine
                    .stage_recorded_session_effect(
                        expected.position.transition,
                        SessionEffect::HostInput { channel, bytes },
                    )
                    .and_then(|_| {
                        machine.deliver_recorded_session_host_boundary(|m, ch, data| {
                            apply_input(m, ch, data)
                        })
                    })
                    .map_err(|e| alloc::format!("input delivery: {e:?}"))
            }
            _ => Err("unsupported event channel or phase".into()),
        };
        result
            .map_err(|detail| self.failure_at(expected.position, ReplayReason::Adapter, detail))?;
        self.compare_deliveries(machine)?;
        self.check_witnesses(machine)?;
        Ok(true)
    }

    /// Advance by at most `quantum` guest transitions toward a quiescent recorded coordinate.
    /// `target` may name the state immediately before or after one of several deliveries at the
    /// same boundary. Returning `false` leaves the driver ready for another bounded call; it
    /// never exposes an observation in the middle of a guest transition as a seek result.
    pub fn run_chunk_to(
        &mut self,
        machine: &mut Machine,
        target: SessionPosition,
        quantum: u64,
        apply_input: impl FnMut(&mut Machine, u16, &[u8]) -> [u64; 4],
    ) -> Result<bool, ReplayDivergence> {
        self.run_chunk_to_fence(machine, target, false, quantum, apply_input)
    }

    /// Stop immediately before the next architectural transition at this number, after applying
    /// all recorded before-boundary deliveries. A reverse step therefore preserves events that
    /// preceded the instruction being reversed. The resulting full position supplies the actual
    /// retirement and event counts, including traps and WFI advances.
    pub fn run_chunk_to_transition(
        &mut self,
        machine: &mut Machine,
        transition: u64,
        quantum: u64,
        apply_input: impl FnMut(&mut Machine, u16, &[u8]) -> [u64; 4],
    ) -> Result<bool, ReplayDivergence> {
        let target = SessionPosition {
            transition,
            ..self.plan.begin
        };
        self.run_chunk_to_fence(machine, target, true, quantum, apply_input)
    }

    fn run_chunk_to_fence(
        &mut self,
        machine: &mut Machine,
        target: SessionPosition,
        transition_only: bool,
        quantum: u64,
        mut apply_input: impl FnMut(&mut Machine, u16, &[u8]) -> [u64; 4],
    ) -> Result<bool, ReplayDivergence> {
        if self.status != ReplayStatus::Ready {
            return Err(self.first_failure.clone().unwrap_or(ReplayDivergence {
                reason: ReplayReason::Exhausted,
                position: machine.session_position().unwrap_or(self.plan.end),
                event_index: self.event_cursor,
                detail: "replay is stopped".into(),
            }));
        }
        if quantum == 0 {
            return Err(self.failure(machine, ReplayReason::Exhausted, "budget is zero".into()));
        }
        if (!transition_only && target.phase != SessionPhase::Before)
            || target.retired > target.transition
            || (transition_only
                && (target.transition < self.plan.begin.transition
                    || target.transition > self.plan.end.transition
                    || target.transition
                        < machine
                            .session_position()
                            .unwrap_or(self.plan.begin)
                            .transition))
            || (!transition_only
                && (coordinate(target) < coordinate(self.plan.begin)
                    || coordinate(target) > coordinate(self.plan.end)
                    || coordinate(target)
                        < coordinate(machine.session_position().unwrap_or(self.plan.begin))))
        {
            return Err(self.failure_at(
                target,
                ReplayReason::InvalidPlan,
                "seek target outside remaining replay".into(),
            ));
        }
        let mut delivered = 0;
        loop {
            self.append_source_window(machine)?;
            self.check_witnesses(machine)?;
            let position = machine.session_position().unwrap_or(self.plan.begin);
            let before_event_pending =
                self.plan
                    .events
                    .get(self.event_cursor)
                    .is_some_and(|event| {
                        event.position.phase == SessionPhase::Before
                            && event.position.transition == position.transition
                    });
            if transition_only && position.transition == target.transition && !before_event_pending
            {
                return Ok(true);
            }
            if !transition_only && position == target {
                if target != self.plan.end {
                    return Ok(true);
                }
                // The terminal coordinate must also exhaust all receipts and source windows.
            } else if !transition_only
                && target != self.plan.end
                && position.transition >= target.transition
                && (position.sequence >= target.sequence || !before_event_pending)
            {
                return Err(self.failure_at(
                    target,
                    ReplayReason::Exhausted,
                    "seek coordinate is not a quiescent recorded boundary".into(),
                ));
            }
            if before_event_pending {
                if !self.apply_before(machine, &mut apply_input)? {
                    return Ok(false);
                }
                // A dense same-boundary tape must not monopolize a cancellable browser chunk.
                delivered += 1;
                if delivered >= quantum.min(64) {
                    return Ok(false);
                }
                continue;
            }
            if position == self.plan.end {
                if self.event_cursor != self.plan.events.len() {
                    return Err(self.failure_at(
                        self.plan.events[self.event_cursor].position,
                        ReplayReason::MissingEvent,
                        "declared end retains unconsumed event".into(),
                    ));
                }
                if self.witness_cursor != self.plan.witnesses.len() {
                    return Err(self.failure(
                        machine,
                        ReplayReason::StateDigest,
                        "declared end retains unconsumed state witness".into(),
                    ));
                }
                machine.finish_session_source_replay().map_err(|e| {
                    self.failure(
                        machine,
                        ReplayReason::Exhausted,
                        alloc::format!("source exhaustion: {e:?}"),
                    )
                })?;
                if let Some(expected_cursor) = self.expected_device_cursor {
                    let actual = machine.session_device_cursor().map_err(|e| {
                        self.failure(
                            machine,
                            ReplayReason::Runtime,
                            alloc::format!("device cursor: {e:?}"),
                        )
                    })?;
                    if actual != expected_cursor {
                        return Err(self.failure(
                            machine,
                            ReplayReason::Exhausted,
                            alloc::format!(
                                "device cursor expected {expected_cursor}, observed {actual}"
                            ),
                        ));
                    }
                }
                if let Some(expected_cursor) = self.expected_network_cursor {
                    machine
                        .finish_session_network_replay(expected_cursor)
                        .map_err(|e| {
                            self.failure(
                                machine,
                                ReplayReason::Exhausted,
                                alloc::format!("network exhaustion: {e:?}"),
                            )
                        })?;
                }
                #[cfg(feature = "virgl-renderer")]
                if let Some(expected) = self.gpu.as_ref().and_then(|gpu| gpu.expected_cursor)
                    && machine.session_gpu_cursor() != Ok(expected)
                {
                    return Err(self.failure(
                        machine,
                        ReplayReason::Exhausted,
                        "GPU result cursor".into(),
                    ));
                }
                self.status = ReplayStatus::Completed;
                return Ok(true);
            }
            if position.transition >= self.plan.end.transition {
                return Err(self.failure(
                    machine,
                    ReplayReason::Exhausted,
                    "end coordinate differs".into(),
                ));
            }
            let mut fence = target.transition;
            if let Some(expected) = self.plan.events[self.event_cursor..].iter().find(|e| {
                e.position.phase == SessionPhase::Before
                    && e.position.transition > position.transition
            }) {
                fence = fence.min(expected.position.transition);
            }
            if let Some(witness) = self.plan.witnesses.get(self.witness_cursor)
                && witness.position.transition > position.transition
            {
                fence = fence.min(witness.position.transition);
            }
            if let Some(source_fence) = self.source_fence() {
                fence = fence.min(source_fence);
            }
            let before = position;
            let before_cursor = self.event_cursor;
            let before_witness = self.witness_cursor;
            let outcome = match machine.run_session_until(fence, quantum) {
                Ok(outcome) => outcome,
                Err(SessionError::SourceDivergence(source)) => {
                    // Earlier receipts from this work quantum may still be buffered. Compare
                    // those first so the reported index belongs to the first failing event.
                    self.compare_deliveries(machine)?;
                    let reason = match source.reason {
                        DivergenceReason::MissingRecord => ReplayReason::MissingEvent,
                        DivergenceReason::ExtraRecords => ReplayReason::ExtraEvent,
                        DivergenceReason::Position => ReplayReason::MisorderedEvent,
                        DivergenceReason::Kind
                        | DivergenceReason::Length
                        | DivergenceReason::Intent
                        | DivergenceReason::ProviderUnavailable => ReplayReason::EventPayload,
                        DivergenceReason::PhysicalWitness => ReplayReason::Adapter,
                        DivergenceReason::OutsideRun => ReplayReason::Runtime,
                    };
                    let position = self
                        .plan
                        .events
                        .get(self.event_cursor)
                        .map(|event| event.position)
                        .filter(|expected| coordinate(*expected) < coordinate(source.position))
                        .unwrap_or(source.position);
                    return Err(self.failure_at(
                        position,
                        reason,
                        alloc::format!("source observation differs: {source:?}"),
                    ));
                }
                Err(error) => {
                    return Err(self.failure(
                        machine,
                        ReplayReason::Runtime,
                        alloc::format!("guest run: {error:?}"),
                    ));
                }
            };
            self.compare_deliveries(machine)?;
            self.check_witnesses(machine)?;
            if outcome != RunOutcome::MaxInstrs {
                return Err(self.failure(
                    machine,
                    ReplayReason::Runtime,
                    alloc::format!("guest ended early: {outcome:?}"),
                ));
            }
            if machine.session_position() == Some(before)
                && self.event_cursor == before_cursor
                && self.witness_cursor == before_witness
            {
                return Err(self.failure(
                    machine,
                    ReplayReason::Stalled,
                    "no transition or delivery".into(),
                ));
            }
            // A browser caller can now yield to a newer seek request. The next call will drain
            // any events at this boundary before running another guest work quantum.
            return Ok(false);
        }
    }

    /// Unbounded replay is retained for deterministic batch verification. Each inner call still
    /// respects the guest work quantum; callers needing cancellation use `run_chunk_to` directly.
    pub fn run_to_end(
        &mut self,
        machine: &mut Machine,
        quantum: u64,
        mut apply_input: impl FnMut(&mut Machine, u16, &[u8]) -> [u64; 4],
    ) -> Result<(), ReplayDivergence> {
        while !self.run_chunk_to(machine, self.plan.end, quantum, &mut apply_input)? {}
        Ok(())
    }
}

#[cfg(test)]
mod admission_tests {
    use super::*;
    use crate::session_clock::sources::{ObservationKind, ObservationValue, SourcePolicy};
    use sha2::{Digest, Sha256};

    fn policy() -> SourcePolicy {
        SourcePolicy {
            version: SourcePolicy::VERSION,
            divider: 1,
            timebase_hz: 10_000_000,
        }
    }

    fn observations(count: usize, same_transition: bool, payload: usize) -> ReplayPlan {
        let begin = SessionPosition::default();
        let end = SessionPosition {
            transition: if same_transition { 1 } else { count as u64 + 2 },
            retired: if same_transition { 1 } else { count as u64 + 2 },
            sequence: count as u64,
            ..begin
        };
        let events = (0..count)
            .map(|index| SessionDelivery {
                position: SessionPosition {
                    transition: if same_transition { 0 } else { index as u64 + 1 },
                    retired: if same_transition { 0 } else { index as u64 + 1 },
                    phase: SessionPhase::Observe,
                    ordinal: if same_transition { index as u32 + 1 } else { 1 },
                    sequence: index as u64 + 1,
                },
                ticket: index as u64 + 1,
                effect: SessionEffect::Observation(ObservationValue {
                    kind: ObservationKind::Entropy,
                    requested: payload as u32,
                    status: 0,
                    bytes: vec![7; payload],
                }),
                host_result: None,
            })
            .collect();
        ReplayPlan {
            begin,
            end,
            initial_resume: vec![1],
            events,
            witnesses: vec![
                StateWitness {
                    position: begin,
                    resume_sha256: [0; 32],
                },
                StateWitness {
                    position: end,
                    resume_sha256: [0; 32],
                },
            ],
        }
    }

    #[test]
    fn source_windows_split_only_between_transitions_and_refuse_oversize_groups() {
        let split = observations(MAX_EVENTS + 1, false, 8);
        split.validate().unwrap();
        let windows = ReplayDriver::source_tapes(&split, policy()).unwrap();
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].records.len(), MAX_EVENTS);
        assert_eq!(windows[1].records.len(), 1);

        let too_many = observations(MAX_EVENTS + 1, true, 8);
        too_many.validate().unwrap();
        let error = ReplayDriver::source_tapes(&too_many, policy()).unwrap_err();
        assert_eq!(error.reason, ReplayReason::InvalidPlan);
        assert_eq!(error.position, too_many.events[0].position);
        assert_eq!(error.detail, "one transition exceeds observation window");

        let too_large = observations(5, true, 1 << 20);
        too_large.validate().unwrap();
        let error = ReplayDriver::source_tapes(&too_large, policy()).unwrap_err();
        assert_eq!(error.reason, ReplayReason::InvalidPlan);
        assert_eq!(error.detail, "one transition exceeds observation window");

        let mut malformed = observations(1, true, 8);
        if let SessionEffect::Observation(value) = &mut malformed.events[0].effect {
            value.requested = 0;
        }
        malformed.validate().unwrap();
        let error = ReplayDriver::source_tapes(&malformed, policy()).unwrap_err();
        assert_eq!(error.reason, ReplayReason::InvalidPlan);
        assert!(
            error
                .detail
                .contains("observation chunk: MalformedObservation")
        );
    }

    #[test]
    fn source_window_advance_preserves_the_first_missing_receipt_or_append_error() {
        let plan = observations(MAX_EVENTS + 1, false, 8);
        let chunks = ReplayDriver::source_tapes(&plan, policy()).unwrap();
        let mut machine = Machine::new(1 << 20);
        machine.enable_clint(1);
        let base = crate::bus::mmap::DRAM_BASE;
        let program = [0x13, 0, 0, 0].repeat(300);
        machine.bus_mut().write_ram_slice(base, &program).unwrap();
        machine.hart_mut().regs.pc = base;
        machine.start_session_clock(1).unwrap();
        let fence = chunks[0].records.last().unwrap().position.transition + 1;
        assert_eq!(
            machine.run_session_until(fence, fence).unwrap(),
            RunOutcome::MaxInstrs
        );

        let driver = |cursor| ReplayDriver {
            plan: plan.clone(),
            event_cursor: cursor,
            witness_cursor: 0,
            status: ReplayStatus::Ready,
            first_failure: None,
            expected_device_cursor: None,
            expected_network_cursor: None,
            source_chunks: chunks.clone(),
            source_chunk_index: 0,
            source_loaded: MAX_EVENTS,
            #[cfg(feature = "virgl-renderer")]
            gpu: None,
        };
        let mut missing = driver(1);
        let failure = missing.append_source_window(&mut machine).unwrap_err();
        assert_eq!(failure.reason, ReplayReason::MissingEvent);
        assert_eq!(failure.position, plan.events[1].position);
        assert_eq!(failure.event_index, 1);
        assert_eq!(missing.first_failure(), Some(&failure));
        assert_eq!(missing.source_chunk_index, 0);

        let mut refused = driver(MAX_EVENTS);
        let failure = refused.append_source_window(&mut machine).unwrap_err();
        assert_eq!(failure.reason, ReplayReason::Runtime);
        assert!(failure.detail.contains("observation window append"));
        assert_eq!(failure.event_index, MAX_EVENTS);
        assert_eq!(refused.first_failure(), Some(&failure));
        assert_eq!(refused.source_chunk_index, 0);
    }

    #[test]
    fn actual_extra_and_both_misordered_receipts_name_the_first_coordinate() {
        let fixture = || {
            let mut machine = Machine::new(1 << 20);
            machine.enable_clint(1);
            let base = crate::bus::mmap::DRAM_BASE;
            machine
                .bus_mut()
                .write_ram_slice(base, &[0x93, 0x80, 0x10, 0x00, 0x93, 0x80, 0x10, 0x00])
                .unwrap();
            machine.hart_mut().regs.pc = base;
            machine.start_session_clock(1).unwrap();
            machine
        };
        let position = |transition, retired, ordinal, sequence| SessionPosition {
            transition,
            retired,
            phase: SessionPhase::Before,
            ordinal,
            sequence,
        };
        for (label, expected_at, actual_at) in [
            ("extra", None, 0),
            ("actual-earlier", Some(1), 0),
            ("expected-earlier", Some(0), 1),
        ] {
            let mut original = fixture();
            original
                .start_session_sources(original.source_policy(), None)
                .unwrap();
            let begin = position(0, 0, 0, 0);
            let initial_resume = original.save_session_resume().unwrap();
            let first = StateWitness {
                position: begin,
                resume_sha256: Sha256::digest(&initial_resume).into(),
            };
            let end = if expected_at.is_some() {
                position(2, 2, 0, 1)
            } else {
                begin
            };
            let events = expected_at.map_or_else(Vec::new, |at| {
                vec![SessionDelivery {
                    position: position(at, at, 1, 1),
                    ticket: 0,
                    effect: SessionEffect::ExternalPending(false),
                    host_result: None,
                }]
            });
            let witnesses = if end == begin {
                vec![first]
            } else {
                vec![
                    first,
                    StateWitness {
                        position: end,
                        resume_sha256: [0; 32],
                    },
                ]
            };
            let plan = ReplayPlan {
                begin,
                end,
                initial_resume,
                events,
                witnesses,
            };
            plan.validate().unwrap();
            let mut machine = fixture();
            let mut driver = ReplayDriver::start(&mut machine, plan).unwrap();
            if actual_at == 1 {
                assert_eq!(
                    machine.run_session_until(1, 1).unwrap(),
                    RunOutcome::MaxInstrs
                );
            }
            machine
                .stage_recorded_session_effect(actual_at, SessionEffect::ExternalPending(false))
                .unwrap();
            machine.deliver_recorded_session_boundary().unwrap();
            let error = driver.compare_deliveries(&mut machine).unwrap_err();
            assert_eq!(
                error.reason,
                if expected_at.is_some() {
                    ReplayReason::MisorderedEvent
                } else {
                    ReplayReason::ExtraEvent
                },
                "{label}"
            );
            assert_eq!(error.position, position(0, 0, 1, 1), "{label}");
            assert_eq!(error.event_index, 0, "{label}");
            assert_eq!(driver.first_failure(), Some(&error), "{label}");
        }
    }
}
