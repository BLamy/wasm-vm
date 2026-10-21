//! Ordered on-demand RTC/entropy observations. Live providers are never invoked in replay.
//! The immutable log is external; checkpoints retain its policy and consumed observation cursor.
use super::{
    MAX_EVENTS, MAX_OWNED_BYTES, MAX_PAYLOAD, SessionClock, SessionDelivery, SessionEffect,
    SessionError, SessionPhase, SessionPosition,
};
use alloc::{boxed::Box, collections::VecDeque, rc::Rc, vec::Vec};
use core::cell::RefCell;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourcePolicy {
    pub version: u32,
    pub divider: u32,
    pub timebase_hz: u64,
}
impl SourcePolicy {
    pub const VERSION: u32 = 1;
    pub fn validate(self) -> Result<(), SessionError> {
        if self.version != Self::VERSION
            || !(1..=1024).contains(&self.divider)
            || self.timebase_hz != 10_000_000
        {
            return Err(SessionError::ClockPolicyMismatch);
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ObservationKind {
    RtcRead = 1,
    RtcSetLow = 2,
    RtcSetHigh = 3,
    RtcArm = 4,
    RtcPoll = 5,
    Entropy = 6,
}
impl ObservationKind {
    fn decode(value: u8) -> Result<Self, SessionError> {
        Ok(match value {
            1 => Self::RtcRead,
            2 => Self::RtcSetLow,
            3 => Self::RtcSetHigh,
            4 => Self::RtcArm,
            5 => Self::RtcPoll,
            6 => Self::Entropy,
            _ => return Err(SessionError::MalformedObservation),
        })
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DivergenceReason {
    MissingRecord,
    Kind,
    Length,
    Position,
    ProviderUnavailable,
    OutsideRun,
    ExtraRecords,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceDivergence {
    pub reason: DivergenceReason,
    pub position: SessionPosition,
    pub expected: u64,
    pub observed: u64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservationValue {
    pub kind: ObservationKind,
    pub requested: u32,
    /// 0 = supplied, 1 = provider unavailable. Unavailability has no invented payload.
    pub status: u8,
    pub bytes: Vec<u8>,
}
impl ObservationValue {
    pub fn validate(&self) -> Result<(), SessionError> {
        if self.requested == 0
            || self.requested as usize > MAX_PAYLOAD
            || (self.kind != ObservationKind::Entropy && self.requested != 8)
            || self.status > 1
            || (self.status == 0 && self.bytes.len() != self.requested as usize)
            || (self.status == 1 && !self.bytes.is_empty())
        {
            return Err(SessionError::MalformedObservation);
        }
        Ok(())
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservationRecord {
    pub position: SessionPosition,
    pub value: ObservationValue,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservationTape {
    pub policy: SourcePolicy,
    pub records: Vec<ObservationRecord>,
}
impl ObservationTape {
    pub fn validate(&self) -> Result<(), SessionError> {
        self.policy.validate()?;
        if self.records.len() > MAX_EVENTS {
            return Err(SessionError::QueueFull);
        }
        let mut previous: Option<SessionPosition> = None;
        let mut bytes = 0usize;
        for record in &self.records {
            record.value.validate()?;
            let p = record.position;
            if p.phase != SessionPhase::Observe
                || p.ordinal == 0
                || p.sequence == 0
                || p.retired > p.transition
                || previous.is_some_and(|q| {
                    p.transition < q.transition
                        || p.retired < q.retired
                        || p.sequence <= q.sequence
                        || (p.transition == q.transition
                            && p.ordinal != q.ordinal.saturating_add(1))
                        || (p.transition != q.transition && p.ordinal != 1)
                })
            {
                return Err(SessionError::MalformedObservation);
            }
            bytes = bytes
                .checked_add(record.value.bytes.len())
                .ok_or(SessionError::PayloadTooLarge)?;
            if bytes > MAX_OWNED_BYTES {
                return Err(SessionError::PayloadTooLarge);
            }
            previous = Some(p);
        }
        Ok(())
    }
    pub fn encode(&self) -> Result<Vec<u8>, SessionError> {
        self.validate()?;
        let mut out = b"WVOBLOG1".to_vec();
        out.extend_from_slice(&1u32.to_le_bytes());
        put_policy(&mut out, self.policy);
        out.extend_from_slice(&(self.records.len() as u32).to_le_bytes());
        for record in &self.records {
            let p = record.position;
            for n in [p.transition, p.retired, p.sequence] {
                out.extend_from_slice(&n.to_le_bytes());
            }
            out.extend_from_slice(&p.ordinal.to_le_bytes());
            out.extend_from_slice(&[record.value.kind as u8, record.value.status]);
            out.extend_from_slice(&record.value.requested.to_le_bytes());
            out.extend_from_slice(&(record.value.bytes.len() as u32).to_le_bytes());
            out.extend_from_slice(&record.value.bytes);
        }
        Ok(out)
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, SessionError> {
        if bytes.len() > MAX_OWNED_BYTES + MAX_EVENTS * 48 + 32 {
            return Err(SessionError::PayloadTooLarge);
        }
        let mut r = super::Decoder { bytes, at: 0 };
        if r.take(8)? != b"WVOBLOG1" || r.u32()? != 1 {
            return Err(SessionError::MalformedObservation);
        }
        let policy = read_policy(&mut r)?;
        let count = r.u32()? as usize;
        if count > MAX_EVENTS {
            return Err(SessionError::QueueFull);
        }
        let mut records = Vec::with_capacity(count);
        for _ in 0..count {
            let position = SessionPosition {
                transition: r.u64()?,
                retired: r.u64()?,
                sequence: r.u64()?,
                ordinal: r.u32()?,
                phase: SessionPhase::Observe,
            };
            let kind = ObservationKind::decode(r.u8()?)?;
            let status = r.u8()?;
            let requested = r.u32()?;
            let length = r.u32()? as usize;
            if length > MAX_PAYLOAD {
                return Err(SessionError::PayloadTooLarge);
            }
            records.push(ObservationRecord {
                position,
                value: ObservationValue {
                    kind,
                    status,
                    requested,
                    bytes: r.take(length)?.to_vec(),
                },
            });
        }
        if r.at != bytes.len() {
            return Err(SessionError::MalformedObservation);
        }
        let tape = Self { policy, records };
        tape.validate()?;
        Ok(tape)
    }
}
fn put_policy(out: &mut Vec<u8>, policy: SourcePolicy) {
    out.extend_from_slice(&policy.version.to_le_bytes());
    out.extend_from_slice(&policy.divider.to_le_bytes());
    out.extend_from_slice(&policy.timebase_hz.to_le_bytes());
}
fn read_policy(r: &mut super::Decoder<'_>) -> Result<SourcePolicy, SessionError> {
    let policy = SourcePolicy {
        version: r.u32()?,
        divider: r.u32()?,
        timebase_hz: r.u64()?,
    };
    policy.validate()?;
    Ok(policy)
}

#[derive(Clone, Copy)]
struct Scope {
    position: SessionPosition,
    next_ticket: u64,
    pending: usize,
    used_events: usize,
    used_bytes: usize,
}
#[derive(Default)]
pub(crate) struct ObservationHub {
    policy: Option<SourcePolicy>,
    replay: bool,
    remaining: VecDeque<ObservationRecord>,
    last_loaded: Option<SessionPosition>,
    consumed: u64,
    scope: Option<Scope>,
    receipts: Vec<SessionDelivery>,
    error: Option<SessionError>,
}
impl ObservationHub {
    pub fn error(&self) -> Option<SessionError> {
        self.error
    }
    pub fn active(&self) -> bool {
        self.policy.is_some()
    }
    pub fn replay(&self) -> bool {
        self.active() && self.replay
    }
    pub fn policy(&self) -> Option<SourcePolicy> {
        self.policy
    }
    fn fail(
        &mut self,
        reason: DivergenceReason,
        position: SessionPosition,
        expected: u64,
        observed: u64,
    ) -> SessionError {
        let error = SessionError::SourceDivergence(SourceDivergence {
            reason,
            position,
            expected,
            observed,
        });
        self.error.get_or_insert(error);
        error
    }
    pub fn start(
        &mut self,
        policy: SourcePolicy,
        tape: Option<ObservationTape>,
        position: SessionPosition,
    ) -> Result<(), SessionError> {
        if self.active() || self.error.is_some() {
            return Err(SessionError::AlreadyActive);
        }
        policy.validate()?;
        if let Some(tape) = &tape {
            tape.validate()?;
            if tape.policy != policy {
                return Err(SessionError::ClockPolicyMismatch);
            }
        }
        let mut staged = Self {
            policy: Some(policy),
            replay: tape.is_some(),
            ..Self::default()
        };
        if let Some(tape) = tape {
            staged.append(tape, position)?;
        }
        *self = staged;
        Ok(())
    }
    pub fn append(
        &mut self,
        tape: ObservationTape,
        position: SessionPosition,
    ) -> Result<(), SessionError> {
        if !self.replay() || self.error.is_some() {
            return Err(SessionError::Inactive);
        }
        tape.validate()?;
        if Some(tape.policy) != self.policy {
            return Err(SessionError::ClockPolicyMismatch);
        }
        if self.remaining.len() + tape.records.len() > MAX_EVENTS
            || self
                .remaining
                .iter()
                .map(|r| r.value.bytes.len())
                .sum::<usize>()
                + tape
                    .records
                    .iter()
                    .map(|r| r.value.bytes.len())
                    .sum::<usize>()
                > MAX_OWNED_BYTES
        {
            return Err(SessionError::QueueFull);
        }
        let mut previous = self.last_loaded;
        for record in &tape.records {
            let p = record.position;
            if p.transition < position.transition
                || p.retired < position.retired
                || p.sequence <= position.sequence
                || previous.is_some_and(|q| {
                    p.transition < q.transition
                        || p.retired < q.retired
                        || p.sequence <= q.sequence
                        || (p.transition == q.transition
                            && p.ordinal != q.ordinal.saturating_add(1))
                        || (p.transition != q.transition && p.ordinal != 1)
                })
            {
                return Err(SessionError::MalformedObservation);
            }
            previous = Some(p);
        }
        self.remaining.extend(tape.records);
        self.last_loaded = previous;
        Ok(())
    }
    pub fn begin(
        &mut self,
        clock: &SessionClock,
        policy: SourcePolicy,
    ) -> Result<(), SessionError> {
        if let Some(error) = self.error {
            return Err(error);
        }
        if !self.active() {
            return Ok(());
        }
        if self.policy != Some(policy) {
            self.error = Some(SessionError::ClockPolicyMismatch);
            return Err(SessionError::ClockPolicyMismatch);
        }
        if clock.position.phase != SessionPhase::Before {
            return Err(SessionError::ObservationOrder);
        }
        self.scope = Some(Scope {
            position: clock.position,
            next_ticket: clock.next_ticket,
            pending: clock.pending.len(),
            used_events: clock.pending.len() + clock.delivered.len(),
            used_bytes: clock.owned_bytes,
        });
        Ok(())
    }
    pub fn end(&mut self) {
        self.scope = None;
    }
    pub fn finish_replay(&mut self, position: SessionPosition) -> Result<(), SessionError> {
        if let Some(error) = self.error {
            return Err(error);
        }
        if !self.replay() {
            return Err(SessionError::Inactive);
        }
        if let Some(record) = self.remaining.front() {
            let expected = record.position.sequence;
            return Err(self.fail(
                DivergenceReason::ExtraRecords,
                position,
                expected,
                position.sequence,
            ));
        }
        Ok(())
    }
    fn observe(
        &mut self,
        kind: ObservationKind,
        length: usize,
        live: impl FnOnce() -> Result<Vec<u8>, ()>,
    ) -> Result<Vec<u8>, ()> {
        if self.error.is_some() {
            return Err(());
        }
        let Some(mut scope) = self.scope else {
            self.fail(
                DivergenceReason::OutsideRun,
                SessionPosition::default(),
                0,
                kind as u64,
            );
            return Err(());
        };
        let mut position = scope.position;
        position.ordinal = if position.phase == SessionPhase::Observe {
            position.ordinal.checked_add(1)
        } else {
            Some(1)
        }
        .ok_or_else(|| {
            self.error = Some(SessionError::OrdinalExhausted);
        })?;
        position.phase = SessionPhase::Observe;
        position.sequence = position.sequence.checked_add(1).ok_or_else(|| {
            self.error = Some(SessionError::SequenceExhausted);
        })?;
        position
            .sequence
            .checked_add(scope.pending as u64)
            .ok_or_else(|| {
                self.error = Some(SessionError::SequenceExhausted);
            })?;
        let next_ticket = scope.next_ticket.checked_add(1).ok_or_else(|| {
            self.error = Some(SessionError::SequenceExhausted);
        })?;
        let consumed = self.consumed.checked_add(1).ok_or_else(|| {
            self.error = Some(SessionError::SequenceExhausted);
        })?;
        if length == 0 || length > MAX_PAYLOAD {
            self.error = Some(SessionError::PayloadTooLarge);
            return Err(());
        }
        if scope.used_events >= MAX_EVENTS
            || scope.used_bytes.saturating_add(length) > MAX_OWNED_BYTES
        {
            self.error = Some(SessionError::QueueFull);
            return Err(());
        }
        let value = if self.replay {
            let Some(record) = self.remaining.front() else {
                self.fail(DivergenceReason::MissingRecord, position, 0, kind as u64);
                return Err(());
            };
            if record.value.kind != kind {
                self.fail(
                    DivergenceReason::Kind,
                    position,
                    record.value.kind as u64,
                    kind as u64,
                );
                return Err(());
            }
            if record.value.requested as usize != length {
                self.fail(
                    DivergenceReason::Length,
                    position,
                    u64::from(record.value.requested),
                    length as u64,
                );
                return Err(());
            }
            if record.position != position {
                self.fail(
                    DivergenceReason::Position,
                    position,
                    record.position.sequence,
                    position.sequence,
                );
                return Err(());
            }
            self.remaining.pop_front().unwrap().value
        } else {
            match live() {
                Ok(bytes) if bytes.len() == length => ObservationValue {
                    kind,
                    requested: length as u32,
                    status: 0,
                    bytes,
                },
                _ => ObservationValue {
                    kind,
                    requested: length as u32,
                    status: 1,
                    bytes: Vec::new(),
                },
            }
        };
        let result = if value.status == 0 {
            Ok(value.bytes.clone())
        } else {
            self.fail(DivergenceReason::ProviderUnavailable, position, 0, 1);
            Err(())
        };
        scope.used_events += 1;
        scope.used_bytes += value.bytes.len();
        scope.position = position;
        self.receipts.push(SessionDelivery {
            position,
            ticket: scope.next_ticket,
            effect: SessionEffect::Observation(value),
            host_result: None,
        });
        scope.next_ticket = next_ticket;
        self.scope = Some(scope);
        self.consumed = consumed;
        result
    }
    pub fn commit(&mut self, clock: Option<&mut SessionClock>) -> Result<(), SessionError> {
        if !self.receipts.is_empty() {
            let clock = clock.ok_or(SessionError::Inactive)?;
            for receipt in self.receipts.drain(..) {
                if receipt.ticket != clock.next_ticket
                    || receipt.position.sequence != clock.position.sequence + 1
                    || receipt.position.transition != clock.position.transition
                    || receipt.position.retired != clock.position.retired
                {
                    return Err(SessionError::ObservationOrder);
                }
                clock.position = receipt.position;
                clock.next_ticket += 1;
                clock.owned_bytes += receipt.effect.bytes();
                clock.delivered.push(receipt);
            }
        }
        if let Some(error) = self.error {
            return Err(error);
        }
        Ok(())
    }
    pub fn checkpoint(&self) -> Result<Option<Vec<u8>>, SessionError> {
        let Some(policy) = self.policy else {
            return Ok(None);
        };
        if self.error.is_some() || self.scope.is_some() || !self.receipts.is_empty() {
            return Err(SessionError::PendingUndrained);
        }
        let mut out = b"WVOBS001".to_vec();
        put_policy(&mut out, policy);
        out.extend_from_slice(&self.consumed.to_le_bytes());
        Ok(Some(out))
    }
    pub fn check_checkpoint(&self, bytes: &[u8], sequence: u64) -> Result<u64, SessionError> {
        if !self.active()
            || !self.remaining.is_empty()
            || !self.receipts.is_empty()
            || self.error.is_some()
        {
            return Err(SessionError::PendingUndrained);
        }
        let mut r = super::Decoder { bytes, at: 0 };
        if r.take(8)? != b"WVOBS001" || Some(read_policy(&mut r)?) != self.policy {
            return Err(SessionError::ClockPolicyMismatch);
        }
        let consumed = r.u64()?;
        if r.at != bytes.len() || consumed > sequence {
            return Err(SessionError::MalformedObservation);
        }
        Ok(consumed)
    }
    pub fn restore_cursor(&mut self, consumed: u64) {
        self.consumed = consumed;
        self.scope = None;
        self.last_loaded = None;
    }
}

pub(crate) struct ObservedRtc {
    pub source: Box<dyn crate::dev::rtc::WallClock>,
    pub hub: Rc<RefCell<ObservationHub>>,
}
impl crate::dev::rtc::WallClock for ObservedRtc {
    fn now_ns(&self) -> u64 {
        self.sample_ns(crate::dev::rtc::ClockSample::Read)
            .unwrap_or(0)
    }
    fn sample_ns(
        &self,
        intent: crate::dev::rtc::ClockSample,
    ) -> Result<u64, crate::dev::rtc::ClockUnavailable> {
        let mut hub = self.hub.borrow_mut();
        if !hub.active() {
            return self.source.sample_ns(intent);
        }
        let kind = match intent {
            crate::dev::rtc::ClockSample::Read => ObservationKind::RtcRead,
            crate::dev::rtc::ClockSample::SetLow => ObservationKind::RtcSetLow,
            crate::dev::rtc::ClockSample::SetHigh => ObservationKind::RtcSetHigh,
            crate::dev::rtc::ClockSample::Arm => ObservationKind::RtcArm,
            crate::dev::rtc::ClockSample::Poll => ObservationKind::RtcPoll,
        };
        let bytes = hub
            .observe(kind, 8, || {
                self.source
                    .sample_ns(intent)
                    .map(|n| n.to_le_bytes().to_vec())
                    .map_err(|_| ())
            })
            .map_err(|_| crate::dev::rtc::ClockUnavailable)?;
        Ok(u64::from_le_bytes(bytes.try_into().unwrap()))
    }
}
pub(crate) struct ObservedEntropy {
    pub source: Box<dyn crate::dev::virtio::rng::EntropySource>,
    pub hub: Rc<RefCell<ObservationHub>>,
}
impl crate::dev::virtio::rng::EntropySource for ObservedEntropy {
    fn transactional(&self) -> bool {
        self.hub.borrow().active()
    }
    fn fill(&mut self, out: &mut [u8]) {
        self.try_fill(out).expect("entropy provider unavailable");
    }
    fn validate_len(
        &self,
        length: usize,
    ) -> Result<(), crate::dev::virtio::rng::EntropyUnavailable> {
        let mut hub = self.hub.borrow_mut();
        if hub.active() {
            if length == 0 || length > MAX_PAYLOAD {
                hub.error = Some(SessionError::PayloadTooLarge);
                return Err(crate::dev::virtio::rng::EntropyUnavailable);
            }
            return Ok(());
        }
        self.source.validate_len(length)
    }
    fn try_fill(
        &mut self,
        out: &mut [u8],
    ) -> Result<(), crate::dev::virtio::rng::EntropyUnavailable> {
        let mut hub = self.hub.borrow_mut();
        if !hub.active() {
            // Keep the embedding's established non-recording failure policy. The fallible path
            // is admitted only when its failure can be retained as an ordered observation.
            self.source.fill(out);
            return Ok(());
        }
        let bytes = hub
            .observe(ObservationKind::Entropy, out.len(), || {
                self.source.try_fill(out).map_err(|_| ())?;
                Ok(out.to_vec())
            })
            .map_err(|_| crate::dev::virtio::rng::EntropyUnavailable)?;
        out.copy_from_slice(&bytes);
        Ok(())
    }
}

impl crate::Machine {
    pub fn source_policy(&self) -> SourcePolicy {
        SourcePolicy {
            version: SourcePolicy::VERSION,
            divider: u32::try_from(self.clock_div).unwrap_or(0),
            timebase_hz: 10_000_000,
        }
    }
    /// Provider adapter admission only. A complete VM additionally needs completion/network adapters.
    pub fn start_session_sources(
        &mut self,
        policy: SourcePolicy,
        replay: Option<ObservationTape>,
    ) -> Result<(), SessionError> {
        policy.validate()?;
        if self.guest_clock_mode() != crate::time::TimeMode::ICount
            || self.clock_div > 1024
            || policy != self.source_policy()
        {
            return Err(SessionError::ClockPolicyMismatch);
        }
        let position = self.session_position().ok_or(SessionError::Inactive)?;
        if position.phase != SessionPhase::Before {
            return Err(SessionError::ObservationOrder);
        }
        self.session_sources
            .borrow_mut()
            .start(policy, replay, position)
    }
    pub fn append_session_source_replay(
        &mut self,
        tape: ObservationTape,
    ) -> Result<(), SessionError> {
        if self.session_replay_limit.is_some() || !self.host_ingress_gate.allows_host() {
            return Err(SessionError::ReplayActive);
        }
        self.append_owned_session_source_replay(tape)
    }

    /// Only the exact replay driver may extend its authenticated observation window.
    pub(crate) fn append_recorded_session_source_replay(
        &mut self,
        tape: ObservationTape,
    ) -> Result<(), SessionError> {
        self.append_owned_session_source_replay(tape)
    }

    fn append_owned_session_source_replay(
        &mut self,
        tape: ObservationTape,
    ) -> Result<(), SessionError> {
        let position = self.session_position().ok_or(SessionError::Inactive)?;
        self.session_sources.borrow_mut().append(tape, position)
    }
    pub fn session_sources_active(&self) -> bool {
        self.session_sources.borrow().active()
    }
    /// Yield only between complete transitions, before a bounded outbox can fill. The caller
    /// drains/publishes receipts before continuing; the observation phase is never replayed.
    pub fn session_sources_need_flush(&self) -> bool {
        self.session_sources_active()
            && self.session_clock.as_ref().is_some_and(|clock| {
                clock.delivered.len() >= MAX_EVENTS - 4
                    || clock
                        .delivered
                        .iter()
                        .map(|r| r.effect.bytes())
                        .sum::<usize>()
                        >= MAX_OWNED_BYTES - MAX_PAYLOAD
            })
    }
    /// Validate the source context before creating either active component.
    pub fn start_session_clock_with_sources(
        &mut self,
        policy: SourcePolicy,
        replay: Option<ObservationTape>,
    ) -> Result<(), SessionError> {
        policy.validate()?;
        if self.session_sources.borrow().active() || self.session_sources.borrow().error().is_some()
        {
            return Err(SessionError::AlreadyActive);
        }
        if self.guest_clock_mode() != crate::time::TimeMode::ICount
            || policy != self.source_policy()
        {
            return Err(SessionError::ClockPolicyMismatch);
        }
        let mut hub = ObservationHub::default();
        hub.start(policy, replay, SessionPosition::default())?;
        self.start_session_clock(1)?;
        *self.session_sources.borrow_mut() = hub;
        Ok(())
    }
    pub fn finish_session_source_replay(&mut self) -> Result<(), SessionError> {
        let position = self.session_position().ok_or(SessionError::Inactive)?;
        self.session_sources.borrow_mut().finish_replay(position)
    }
    pub(crate) fn begin_source_scope(&mut self) -> Result<(), SessionError> {
        let hub = &mut *self.session_sources.borrow_mut();
        if let Some(clock) = &self.session_clock {
            hub.begin(clock, self.source_policy())
        } else if let Some(error) = hub.error {
            Err(error)
        } else {
            Ok(())
        }
    }
    pub(crate) fn commit_source_scope(&mut self) -> Result<(), SessionError> {
        self.session_sources
            .borrow_mut()
            .commit(self.session_clock.as_mut())
    }
}
