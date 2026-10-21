//! Exact, non-wrapping execution coordinates and an owned before-transition mailbox.
//!
//! This is the common scheduling mechanism, not admission of every host/device provider into
//! recording. Provider adapters must enqueue owned effects; the Linux recorder installs those in
//! subsequent slices. Raw `hart_mut`/`bus_mut` and pure `step` are embedding/debug escape hatches,
//! not session execution APIs. Session execution uses `Machine::run` / `run_session_until`.
use alloc::{collections::VecDeque, vec::Vec};
pub mod sources;

pub const MAX_EVENTS: usize = 256;
pub const MAX_PAYLOAD: usize = 1 << 20;
pub const MAX_OWNED_BYTES: usize = 4 << 20;
const MAGIC: &[u8; 8] = b"WVCLK001";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionError {
    Inactive,
    ReplayActive,
    DeviceCompletion(crate::session_devices::DeviceError),
    #[cfg(feature = "virgl-renderer")]
    GpuResult(crate::session_gpu::GpuError),
    Network(crate::session_network::NetworkError),
    AlreadyActive,
    UnsupportedScheduling,
    PositionPast,
    TransitionExhausted,
    RetiredExhausted,
    SequenceExhausted,
    OrdinalExhausted,
    QueueFull,
    PayloadTooLarge,
    InvalidAddress,
    PendingUndrained,
    MalformedSnapshot,
    HostInputPending,
    ClockPolicyMismatch,
    MalformedObservation,
    ObservationOrder,
    SourceDivergence(sources::SourceDivergence),
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum SessionPhase {
    #[default]
    Before,
    Observe,
}
impl SessionPhase {
    pub fn label(self) -> &'static str {
        match self {
            Self::Before => "before",
            Self::Observe => "observe",
        }
    }
}

/// Quiescent position before the next transition. `sequence` is the last delivered event;
/// `ordinal` counts before-phase deliveries at this boundary, then resets on a transition.
/// Observation/after adapters will extend the phase vocabulary without using guest CSRs as IDs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SessionPosition {
    pub transition: u64,
    pub retired: u64,
    pub phase: SessionPhase,
    pub ordinal: u32,
    pub sequence: u64,
}

/// The bounded common effects available before provider-specific adapters are admitted.
/// RAM delivery uses the bus's tracked DMA-write path, including code invalidation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEffect {
    /// Only source adapters may originate observations; callers cannot enqueue one.
    Observation(sources::ObservationValue),
    WriteRam {
        address: u64,
        bytes: Vec<u8>,
    },
    ExternalPending(bool),
    /// Owned embedding input. Execution stops until a synchronous adapter applies and receipts
    /// it at this exact boundary; the ordinary run loop can never silently consume it.
    HostInput {
        channel: u16,
        bytes: Vec<u8>,
    },
}

impl SessionEffect {
    fn bytes(&self) -> usize {
        match self {
            Self::WriteRam { bytes, .. } | Self::HostInput { bytes, .. } => bytes.len(),
            Self::ExternalPending(_) => 1,
            Self::Observation(value) => value.bytes.len(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionDelivery {
    pub position: SessionPosition,
    pub ticket: u64,
    pub effect: SessionEffect,
    /// Adapter-defined fixed-size outcome: status, accepted amount, and two diagnostics.
    /// Reserved with the event before mutation, and retained with its owned input.
    pub host_result: Option<[u64; 4]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Queued {
    transition: u64,
    ticket: u64,
    effect: SessionEffect,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct SessionClock {
    pub position: SessionPosition,
    pub idle_pending: bool,
    pub external_pending: bool,
    next_ticket: u64,
    pending: VecDeque<Queued>,
    delivered: Vec<SessionDelivery>,
    owned_bytes: usize,
}

impl SessionClock {
    pub fn enqueue(&mut self, transition: u64, effect: SessionEffect) -> Result<u64, SessionError> {
        if transition < self.position.transition {
            return Err(SessionError::PositionPast);
        }
        if effect.bytes() > MAX_PAYLOAD {
            return Err(SessionError::PayloadTooLarge);
        }
        if self.pending.len() + self.delivered.len() >= MAX_EVENTS
            || self.owned_bytes + effect.bytes() > MAX_OWNED_BYTES
        {
            return Err(SessionError::QueueFull);
        }
        self.position
            .sequence
            .checked_add(self.pending.len() as u64 + 1)
            .ok_or(SessionError::SequenceExhausted)?;
        if transition == self.position.transition {
            let at_boundary = self
                .pending
                .iter()
                .filter(|q| q.transition == transition)
                .count() as u32;
            self.position
                .ordinal
                .checked_add(at_boundary + 1)
                .ok_or(SessionError::OrdinalExhausted)?;
        }
        let next = self
            .next_ticket
            .checked_add(1)
            .ok_or(SessionError::SequenceExhausted)?;
        let ticket = self.next_ticket;
        let index = self
            .pending
            .partition_point(|q| (q.transition, q.ticket) < (transition, ticket));
        self.owned_bytes += effect.bytes();
        self.pending.insert(
            index,
            Queued {
                transition,
                ticket,
                effect,
            },
        );
        self.next_ticket = next;
        Ok(ticket)
    }

    pub fn next_transition(&self) -> Option<u64> {
        self.pending.front().map(|q| q.transition)
    }

    /// All refusal occurs before removing/applying the event. Moving the effect into the receipt
    /// keeps its exact owned bytes available to the future log writer, with a bounded outbox.
    pub fn due(&mut self) -> Result<Option<SessionDelivery>, SessionError> {
        let Some(first) = self.pending.front() else {
            return Ok(None);
        };
        if first.transition != self.position.transition {
            return Ok(None);
        }
        let sequence = self
            .position
            .sequence
            .checked_add(1)
            .ok_or(SessionError::SequenceExhausted)?;
        let ordinal = self
            .position
            .ordinal
            .checked_add(1)
            .ok_or(SessionError::OrdinalExhausted)?;
        let queued = self.pending.pop_front().expect("front checked");
        self.position.sequence = sequence;
        self.position.ordinal = ordinal;
        Ok(Some(SessionDelivery {
            position: self.position,
            ticket: queued.ticket,
            effect: queued.effect,
            host_result: None,
        }))
    }

    fn host_due(&self) -> bool {
        self.pending.front().is_some_and(|q| {
            q.transition == self.position.transition
                && matches!(q.effect, SessionEffect::HostInput { .. })
        })
    }

    pub fn acknowledge(&mut self, delivery: SessionDelivery) {
        self.delivered.push(delivery);
    }

    pub fn take_deliveries(&mut self) -> Vec<SessionDelivery> {
        let out = core::mem::take(&mut self.delivered);
        self.owned_bytes -= out.iter().map(|d| d.effect.bytes()).sum::<usize>();
        out
    }

    pub fn reserve_transition(&self) -> Result<(), SessionError> {
        self.position
            .transition
            .checked_add(1)
            .ok_or(SessionError::TransitionExhausted)?;
        self.position
            .retired
            .checked_add(1)
            .ok_or(SessionError::RetiredExhausted)?;
        Ok(())
    }

    pub fn advance(&mut self, transitions: u64, retired: u64) {
        // The run loop reserves and caps before execution, never repairs an overshoot afterward.
        self.position.transition = self
            .position
            .transition
            .checked_add(transitions)
            .expect("reserved transition span");
        self.position.retired = self
            .position
            .retired
            .checked_add(retired)
            .expect("reserved retire span");
        self.position.ordinal = 0;
        self.position.phase = SessionPhase::Before;
    }

    pub fn validate_addresses(&self, base: u64, length: usize) -> Result<(), SessionError> {
        for queued in &self.pending {
            validate_effect(&queued.effect, base, length)?;
        }
        Ok(())
    }

    pub fn encode(&self) -> Result<Vec<u8>, SessionError> {
        self.encode_inner(false)
    }

    /// A continuation starts at this coordinate, without the parent's queued future or
    /// receipt outbox. Preserve ticket allocation and idle/timer phase; neither is a new input.
    pub(crate) fn encode_recording_branch(&self) -> Result<Vec<u8>, SessionError> {
        let mut branch = self.clone();
        branch.pending.clear();
        branch.delivered.clear();
        branch.owned_bytes = 0;
        branch.encode()
    }

    /// Digest-only view of already applied state. This never publishes a checkpoint;
    /// the real capture API still requires every delivered receipt to be drained.
    #[cfg(feature = "virgl-renderer")]
    pub(crate) fn encode_guest_state(&self) -> Result<Vec<u8>, SessionError> {
        self.encode_inner(true)
    }

    fn encode_inner(&self, guest_state: bool) -> Result<Vec<u8>, SessionError> {
        // The embedding must publish/drain receipts before capture; silently dropping them would
        // admit an applied effect absent from the event log. Pending effects are serialized.
        if (!guest_state && !self.delivered.is_empty())
            || self.position.phase != SessionPhase::Before
        {
            return Err(SessionError::PendingUndrained);
        }
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&1u32.to_le_bytes());
        for n in [
            self.position.transition,
            self.position.retired,
            u64::from(self.position.ordinal),
            self.position.sequence,
            self.next_ticket,
        ] {
            out.extend_from_slice(&n.to_le_bytes());
        }
        out.extend_from_slice(&[u8::from(self.idle_pending), u8::from(self.external_pending)]);
        out.extend_from_slice(&(self.pending.len() as u32).to_le_bytes());
        for q in &self.pending {
            out.extend_from_slice(&q.transition.to_le_bytes());
            out.extend_from_slice(&q.ticket.to_le_bytes());
            match &q.effect {
                SessionEffect::Observation(_) => return Err(SessionError::ObservationOrder),
                SessionEffect::WriteRam { address, bytes } => {
                    out.push(0);
                    out.extend_from_slice(&address.to_le_bytes());
                    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                    out.extend_from_slice(bytes);
                }
                SessionEffect::ExternalPending(value) => {
                    out.extend_from_slice(&[1, u8::from(*value)])
                }
                SessionEffect::HostInput { channel, bytes } => {
                    out.push(2);
                    out.extend_from_slice(&channel.to_le_bytes());
                    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                    out.extend_from_slice(bytes);
                }
            }
        }
        Ok(out)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, SessionError> {
        let bad = SessionError::MalformedSnapshot;
        if bytes.len() > MAX_OWNED_BYTES + MAX_EVENTS * 32 + 64 {
            return Err(bad);
        }
        let mut r = Decoder { bytes, at: 0 };
        if r.take(8)? != MAGIC || r.u32()? != 1 {
            return Err(bad);
        }
        let position = SessionPosition {
            phase: SessionPhase::Before,
            transition: r.u64()?,
            retired: r.u64()?,
            ordinal: r.u64()?.try_into().map_err(|_| bad)?,
            sequence: r.u64()?,
        };
        if position.retired > position.transition || u64::from(position.ordinal) > position.sequence
        {
            return Err(bad);
        }
        let next_ticket = r.u64()?;
        if position.sequence > next_ticket {
            return Err(bad);
        }
        let idle_pending = r.boolean()?;
        let external_pending = r.boolean()?;
        let count = r.u32()? as usize;
        if count > MAX_EVENTS || position.sequence.checked_add(count as u64).is_none() {
            return Err(bad);
        }
        let mut pending = VecDeque::new();
        let mut owned_bytes = 0usize;
        let mut tickets = alloc::collections::BTreeSet::new();
        for _ in 0..count {
            let transition = r.u64()?;
            let ticket = r.u64()?;
            if transition < position.transition
                || ticket >= next_ticket
                || !tickets.insert(ticket)
                || pending
                    .back()
                    .is_some_and(|q: &Queued| (q.transition, q.ticket) >= (transition, ticket))
            {
                return Err(bad);
            }
            let effect = match r.u8()? {
                0 => {
                    let address = r.u64()?;
                    let n = r.u32()? as usize;
                    if n > MAX_PAYLOAD {
                        return Err(bad);
                    }
                    SessionEffect::WriteRam {
                        address,
                        bytes: r.take(n)?.to_vec(),
                    }
                }
                1 => SessionEffect::ExternalPending(r.boolean()?),
                2 => {
                    let channel = u16::from_le_bytes(r.take(2)?.try_into().unwrap());
                    let n = r.u32()? as usize;
                    if channel == 0 || n > MAX_PAYLOAD {
                        return Err(bad);
                    }
                    SessionEffect::HostInput {
                        channel,
                        bytes: r.take(n)?.to_vec(),
                    }
                }
                _ => return Err(bad),
            };
            owned_bytes += effect.bytes();
            if owned_bytes > MAX_OWNED_BYTES {
                return Err(bad);
            }
            pending.push_back(Queued {
                transition,
                ticket,
                effect,
            });
        }
        if r.at != bytes.len() {
            return Err(bad);
        }
        let at_boundary = pending
            .iter()
            .filter(|q| q.transition == position.transition)
            .count() as u32;
        position.ordinal.checked_add(at_boundary).ok_or(bad)?;
        Ok(Self {
            position,
            idle_pending,
            external_pending,
            next_ticket,
            pending,
            delivered: Vec::new(),
            owned_bytes,
        })
    }
}

pub(crate) fn validate_effect(
    effect: &SessionEffect,
    base: u64,
    length: usize,
) -> Result<(), SessionError> {
    if matches!(effect, SessionEffect::Observation(_)) {
        return Err(SessionError::ObservationOrder);
    }
    if matches!(effect, SessionEffect::HostInput { channel: 0, .. }) {
        return Err(SessionError::MalformedSnapshot);
    }
    if let SessionEffect::WriteRam { address, bytes } = effect {
        let valid = address
            .checked_sub(base)
            .and_then(|offset| offset.checked_add(bytes.len() as u64))
            .is_some_and(|end| end <= length as u64);
        if !valid {
            return Err(SessionError::InvalidAddress);
        }
    }
    Ok(())
}

struct Decoder<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Decoder<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], SessionError> {
        let end = self
            .at
            .checked_add(n)
            .ok_or(SessionError::MalformedSnapshot)?;
        let bytes = self
            .bytes
            .get(self.at..end)
            .ok_or(SessionError::MalformedSnapshot)?;
        self.at = end;
        Ok(bytes)
    }
    fn u8(&mut self) -> Result<u8, SessionError> {
        Ok(self.take(1)?[0])
    }
    fn boolean(&mut self) -> Result<bool, SessionError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(SessionError::MalformedSnapshot),
        }
    }
    fn u32(&mut self) -> Result<u32, SessionError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, SessionError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Preparation {
    Ready,
    Fence,
    IdleAdvanced,
}

impl crate::Machine {
    /// Start a fresh single-hart ICount coordinate. Provider admission is separate: an embedding
    /// must stage owned results instead of mutating guest state through debug escape hatches.
    pub fn start_session_clock(&mut self, harts: u32) -> Result<(), SessionError> {
        if cfg!(feature = "zicsr-stub")
            || harts != 1
            || self.guest_clock_mode() != crate::time::TimeMode::ICount
            || !(1..=1024).contains(&self.clock_div)
            || self.tick_accum >= self.clock_div
        {
            return Err(SessionError::UnsupportedScheduling);
        }
        if self.session_clock.is_some() {
            return Err(SessionError::AlreadyActive);
        }
        self.session_clock = Some(SessionClock::default());
        self.session_fence = None;
        Ok(())
    }

    pub fn session_position(&self) -> Option<SessionPosition> {
        self.session_clock.as_ref().map(|s| s.position)
    }

    pub fn session_pending_events(&self) -> usize {
        self.session_clock.as_ref().map_or(0, |s| s.pending.len())
    }

    pub fn stage_session_effect(
        &mut self,
        transition: u64,
        effect: SessionEffect,
    ) -> Result<u64, SessionError> {
        if self.session_replay_limit.is_some() || !self.host_ingress_gate.allows_host() {
            return Err(SessionError::ReplayActive);
        }
        self.stage_owned_session_effect(transition, effect)
    }

    /// The replay driver alone may stage an effect from the authenticated tape. The ordinary
    /// embedding ingress above stays closed for the entire replay, including after its end.
    pub(crate) fn stage_recorded_session_effect(
        &mut self,
        transition: u64,
        effect: SessionEffect,
    ) -> Result<u64, SessionError> {
        if self.session_replay_limit.is_none() {
            return Err(SessionError::Inactive);
        }
        self.stage_owned_session_effect(transition, effect)
    }

    fn stage_owned_session_effect(
        &mut self,
        transition: u64,
        effect: SessionEffect,
    ) -> Result<u64, SessionError> {
        if let Some(error) = self.session_sources.borrow().error() {
            return Err(error);
        }
        validate_effect(&effect, self.bus.ram().base(), self.bus.ram().len())?;
        let clock = self.session_clock.as_mut().ok_or(SessionError::Inactive)?;
        if clock.position.phase != SessionPhase::Before {
            return Err(SessionError::ObservationOrder);
        }
        clock.enqueue(transition, effect)
    }

    pub fn take_session_deliveries(&mut self) -> Result<Vec<SessionDelivery>, SessionError> {
        Ok(self
            .session_clock
            .as_mut()
            .ok_or(SessionError::Inactive)?
            .take_deliveries())
    }

    /// Apply all owned controls at the current before boundary without inventing a retirement
    /// or advancing guest time. This is also the paused-control path; receipts remain ordered
    /// across repeated calls and a snapshot at the same transition.
    pub fn deliver_session_boundary(&mut self) -> Result<(), SessionError> {
        if self.session_replay_limit.is_some() || !self.host_ingress_gate.allows_host() {
            return Err(SessionError::ReplayActive);
        }
        self.deliver_boundary(false, |_, _, _| unreachable!("host input is fenced"))
    }

    pub(crate) fn deliver_recorded_session_boundary(&mut self) -> Result<(), SessionError> {
        if self.session_replay_limit.is_none() {
            return Err(SessionError::Inactive);
        }
        self.deliver_boundary(false, |_, _, _| unreachable!("host input is fenced"))
    }

    /// Invoke a trusted, synchronous input adapter before any guest execution can resume. A
    /// failed application is still an ordered receipt (status in result[0]), never a lost event.
    /// No callback, await, or second guest runner may cross this exclusive Machine borrow.
    pub fn deliver_session_host_boundary(
        &mut self,
        apply: impl FnMut(&mut Self, u16, &[u8]) -> [u64; 4],
    ) -> Result<(), SessionError> {
        if self.session_replay_limit.is_some() || !self.host_ingress_gate.allows_host() {
            return Err(SessionError::ReplayActive);
        }
        self.deliver_boundary(true, apply)
    }

    pub(crate) fn deliver_recorded_session_host_boundary(
        &mut self,
        apply: impl FnMut(&mut Self, u16, &[u8]) -> [u64; 4],
    ) -> Result<(), SessionError> {
        if self.session_replay_limit.is_none() {
            return Err(SessionError::Inactive);
        }
        let gate = alloc::rc::Rc::clone(&self.host_ingress_gate);
        let _recorded = gate.recorded_scope();
        self.deliver_boundary(true, apply)
    }

    fn deliver_boundary(
        &mut self,
        allow_host: bool,
        mut apply: impl FnMut(&mut Self, u16, &[u8]) -> [u64; 4],
    ) -> Result<(), SessionError> {
        if let Some(error) = self.session_sources.borrow().error() {
            return Err(error);
        }
        self.session_clock.as_ref().ok_or(SessionError::Inactive)?;
        if self.guest_clock_mode() != crate::time::TimeMode::ICount {
            return Err(SessionError::UnsupportedScheduling);
        }
        loop {
            if !allow_host && self.session_clock.as_ref().unwrap().host_due() {
                return Err(SessionError::HostInputPending);
            }
            let Some(mut delivery) = self.session_clock.as_mut().unwrap().due()? else {
                break;
            };
            match &delivery.effect {
                SessionEffect::Observation(_) => return Err(SessionError::ObservationOrder),
                SessionEffect::WriteRam { address, bytes } => self
                    .bus
                    .write_ram_slice(*address, bytes)
                    .expect("staged address validated"),
                SessionEffect::ExternalPending(value) => {
                    self.session_clock.as_mut().unwrap().external_pending = *value
                }
                SessionEffect::HostInput { channel, bytes } => {
                    delivery.host_result = Some(apply(self, *channel, bytes));
                }
            }
            self.session_clock.as_mut().unwrap().acknowledge(delivery);
        }
        #[cfg(not(feature = "zicsr-stub"))]
        self.drain_code_writes();
        Ok(())
    }

    /// Stop BEFORE deliveries or execution at `transition`. A subsequent run delivers controls
    /// there before the next transition. A small work budget may stop earlier, never later.
    pub fn run_session_until(
        &mut self,
        transition: u64,
        max_work: u64,
    ) -> Result<crate::RunOutcome, SessionError> {
        self.with_session_fence(transition, |machine| machine.run(max_work))
    }

    pub fn run_session_until_traced<T: crate::trace::TraceSink>(
        &mut self,
        transition: u64,
        max_work: u64,
        sink: &mut T,
    ) -> Result<crate::RunOutcome, SessionError> {
        self.with_session_fence(transition, |machine| machine.run_traced(max_work, sink))
    }

    fn with_session_fence(
        &mut self,
        transition: u64,
        run: impl FnOnce(&mut Self) -> crate::RunOutcome,
    ) -> Result<crate::RunOutcome, SessionError> {
        let position = self.session_position().ok_or(SessionError::Inactive)?;
        if transition < position.transition {
            return Err(SessionError::PositionPast);
        }
        if self.guest_clock_mode() != crate::time::TimeMode::ICount {
            return Err(SessionError::UnsupportedScheduling);
        }
        self.session_fence = Some(transition);
        let outcome = run(self);
        self.session_fence = None;
        match outcome {
            crate::RunOutcome::SessionStopped(error) => Err(error),
            other => Ok(other),
        }
    }

    #[cfg(not(feature = "zicsr-stub"))]
    pub(crate) fn prepare_session_transition(&mut self) -> Result<Preparation, SessionError> {
        let Some(clock) = self.session_clock.as_ref() else {
            return Ok(Preparation::Ready);
        };
        if let Some(error) = self.session_sources.borrow().error() {
            return Err(error);
        }
        if let Some(hub) = &self.session_network
            && let Some(error) = hub.borrow().error
        {
            return Err(SessionError::Network(error));
        }
        if let Some(hub) = &self.session_devices
            && let Some(error) = hub.borrow().error
        {
            return Err(SessionError::DeviceCompletion(error));
        }
        if self.session_sources_need_flush() {
            return Ok(Preparation::Fence);
        }
        if self.guest_clock_mode() != crate::time::TimeMode::ICount {
            return Err(SessionError::UnsupportedScheduling);
        }
        if self.session_fence == Some(clock.position.transition)
            || self
                .session_replay_limit
                .is_some_and(|end| clock.position.transition >= end)
        {
            return Ok(Preparation::Fence);
        }
        clock.reserve_transition()?;
        #[cfg(feature = "virgl-renderer")]
        self.prepare_gpu_boundary()
            .map_err(SessionError::GpuResult)?;
        // Internal transition preparation may drain only effects already admitted by the
        // recording path or the replay driver; public delivery remains closed in replay mode.
        self.deliver_boundary(false, |_, _, _| unreachable!("host input is fenced"))?;
        let clock = self.session_clock.as_mut().unwrap();
        let idle = core::mem::take(&mut clock.idle_pending);
        // Owned network work is guest-derived or explicitly recorded. It must
        // suppress the same idle jump as generic pending controls in both modes.
        if idle && !clock.external_pending && !self.external_net_io_pending() {
            self.sync_clint();
            self.sync_sbi_timer();
            let before = self.clint_mtime();
            self.wfi_fast_forward();
            if self.clint_mtime() != before {
                self.advance_session(1, 0);
                return Ok(Preparation::IdleAdvanced);
            }
        }
        Ok(Preparation::Ready)
    }

    #[cfg(not(feature = "zicsr-stub"))]
    pub(crate) fn session_dispatch_budget(&self, remaining: u64) -> u64 {
        let Some(clock) = self.session_clock.as_ref() else {
            return remaining;
        };
        let mut budget = remaining
            .min(u64::MAX - clock.position.transition)
            .min(u64::MAX - clock.position.retired);
        for target in [
            clock.next_transition(),
            self.session_fence,
            self.session_replay_limit,
            #[cfg(feature = "virgl-renderer")]
            self.next_session_gpu_transition(),
        ]
        .into_iter()
        .flatten()
        {
            budget = budget.min(target - clock.position.transition);
        }
        // An armed RTC samples its external provider at every transition. A compiled span
        // would skip those observation positions and make replay depend on the host quantum.
        // MMIO blocks already fall back through jit_safe, so a disarmed RTC needs no extra fence.
        if self.session_sources_active()
            && self
                .rtc
                .as_ref()
                .is_some_and(|(rtc, _)| rtc.borrow().alarm_armed())
        {
            budget = budget.min(1);
        }
        // Active PCM queues use a frozen guest-derived clock, never a worklet clock.
        if self
            .session_devices
            .as_ref()
            .is_some_and(|hub| hub.borrow().capture)
        {
            budget = budget.min(1);
        }
        // The first UART timeout tick was sampled at this dispatch's boundary. Stop a
        // compiled span before the next tick that would latch a character timeout: that
        // boundary may assert an interrupt, and must run before its guest instruction.
        if let Some((uart, _)) = &self.uart
            && let Some(until_timeout) = uart.borrow().ticks_until_timeout()
        {
            budget = budget.min(until_timeout);
        }
        // Pure compiled work cannot cross the retirement where a derived timer becomes due.
        if let Some(clint) = &self.clint {
            let state = clint.borrow();
            for deadline in [state.mtimecmp, self.sbi_state.stimecmp] {
                if deadline != u64::MAX && deadline > state.mtime {
                    let need = u128::from(deadline - state.mtime)
                        * u128::from(self.clock_div.max(1))
                        - u128::from(self.tick_accum);
                    budget = budget.min(u64::try_from(need).unwrap_or(u64::MAX));
                }
            }
        }
        budget
    }

    #[cfg(not(feature = "zicsr-stub"))]
    pub(crate) fn advance_session(&mut self, transitions: u64, retired: u64) {
        if let Some(clock) = &mut self.session_clock {
            clock.advance(transitions, retired);
            self.session_sources.borrow_mut().end();
            // Quiescent stops include the preceding transition's derived timer bookkeeping.
            // Otherwise a compiled span leaves CSR TIME/MTIP sampled at block entry while the
            // interpreter leaves them sampled at its last instruction: equal RAM/regs, stale CPU.
            self.sync_clint();
            self.sync_sbi_timer();
        }
    }
}

#[cfg(not(feature = "zicsr-stub"))]
pub(crate) fn jit_safe(block: &crate::dispatch::DecodedBlock) -> bool {
    use crate::decode::Instr::*;
    block.ops.iter().all(|op| {
        crate::dispatch::retire_deferrable(&op.instr)
            || matches!(
                op.instr,
                Jal { .. }
                    | Beq { .. }
                    | Bne { .. }
                    | Blt { .. }
                    | Bge { .. }
                    | Bltu { .. }
                    | Bgeu { .. }
            )
    })
}

#[cfg(test)]
mod branch_tests {
    use super::*;
    use alloc::vec;

    #[test]
    fn branch_image_drops_future_and_old_outbox_without_reusing_tickets() {
        let mut parent = SessionClock::default();
        parent.advance(7, 6);
        assert_eq!(
            parent.enqueue(
                7,
                SessionEffect::HostInput {
                    channel: 1,
                    bytes: vec![b'p']
                }
            ),
            Ok(0)
        );
        let delivery = parent.due().unwrap().unwrap();
        parent.acknowledge(delivery);
        assert_eq!(
            parent.enqueue(
                13,
                SessionEffect::HostInput {
                    channel: 1,
                    bytes: vec![b'f']
                }
            ),
            Ok(1)
        );
        let before = parent.clone();
        let encoded = parent.encode_recording_branch().unwrap();
        assert_eq!(parent, before);
        assert_eq!(parent.next_transition(), Some(13));
        assert_eq!(parent.delivered.len(), 1);
        let mut child = SessionClock::decode(&encoded).unwrap();
        assert_eq!(child.position, parent.position);
        assert_eq!(child.next_transition(), None);
        assert!(child.take_deliveries().is_empty());
        assert_eq!(
            child.enqueue(
                7,
                SessionEffect::HostInput {
                    channel: 1,
                    bytes: vec![b'c']
                }
            ),
            Ok(2)
        );
        let next = child.due().unwrap().unwrap();
        assert_eq!(next.position.sequence, 2);
        assert_eq!(next.ticket, 2);
        assert_eq!(
            next.effect,
            SessionEffect::HostInput {
                channel: 1,
                bytes: vec![b'c']
            }
        );
    }
}
