//! Owned asynchronous device completions. Host callbacks hold revocable leases, never guest RAM.
//!
//! A completion is admitted at a before-transition session boundary. Its request identity and
//! immutable payload reference are independent of that delivery position. Replay supplies the same
//! envelope without invoking a host adapter. Checkpoints retain pending requests and device data;
//! restoring replaces the lease incarnation even when numeric request IDs rewind.
use alloc::{collections::BTreeMap, rc::Rc, vec::Vec};
use core::cell::RefCell;
use sha2::{Digest, Sha256};

mod block;
mod codec;
pub use block::{BaseDisk, CompletionBlock};
pub(crate) use codec::{Decoder, put_bytes};

pub const CHANNEL: u16 = 19;
pub const MAX_REQUESTS: usize = 256;
pub const MAX_RESULT: usize = (1 << 20) - 256;
pub const CACHE_BUDGET: usize = 16 << 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceError {
    Inactive,
    Unsupported,
    ReplayIngress,
    StaleLease,
    UnknownRequest,
    Intent,
    Payload,
    Limit,
    Exhausted,
    Position,
    Snapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PayloadRef {
    pub sha256: [u8; 32],
    pub length: u32,
}
impl PayloadRef {
    pub fn of(bytes: &[u8]) -> Result<Self, DeviceError> {
        if bytes.len() > MAX_RESULT {
            return Err(DeviceError::Limit);
        }
        Ok(Self {
            sha256: Sha256::digest(bytes).into(),
            length: bytes.len() as u32,
        })
    }
    fn matches(&self, bytes: &[u8]) -> bool {
        Self::of(bytes).is_ok_and(|actual| actual == *self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceIntent {
    BaseBlock {
        chunk: u32,
        content: PayloadRef,
    },
    /// Bytes delivered to the real virtio-console application/file-agent receive queue.
    Agent {
        generation: u64,
        maximum: u32,
    },
    Capture {
        samples: u32,
        rate: u32,
        channels: u8,
    },
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceRequest {
    pub id: u64,
    pub intent: DeviceIntent,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CompletionStatus {
    Supplied = 0,
    Failed = 1,
    Cancelled = 2,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceCompletion {
    pub request: DeviceRequest,
    pub status: CompletionStatus,
    /// Complete PCM frames for capture; zero for other adapters or unsuccessful results.
    pub frames: u32,
    pub bytes: Vec<u8>,
}
impl DeviceCompletion {
    pub fn validate(&self) -> Result<(), DeviceError> {
        if self.request.id == 0 || self.bytes.len() > MAX_RESULT {
            return Err(DeviceError::Payload);
        }
        if self.status != CompletionStatus::Supplied {
            return if self.bytes.is_empty() && self.frames == 0 {
                Ok(())
            } else {
                Err(DeviceError::Payload)
            };
        }
        match self.request.intent {
            DeviceIntent::BaseBlock { content, .. }
                if self.frames == 0 && content.matches(&self.bytes) =>
            {
                Ok(())
            }
            DeviceIntent::Agent { maximum, .. }
                if self.frames == 0 && maximum > 0 && self.bytes.len() <= maximum as usize =>
            {
                Ok(())
            }
            DeviceIntent::Capture {
                samples,
                rate,
                channels,
            } if rate > 0
                && (1..=2).contains(&channels)
                && samples > 0
                && samples.is_multiple_of(u32::from(channels))
                && self.frames <= samples / u32::from(channels)
                && self.bytes.len() == self.frames as usize * usize::from(channels) * 2 =>
            {
                Ok(())
            }
            _ => Err(DeviceError::Payload),
        }
    }
}

/// The incarnation is private and compared by allocation identity, avoiding wrapping generations.
#[derive(Clone)]
pub struct CompletionLease {
    incarnation: Rc<()>,
    request: DeviceRequest,
}
impl CompletionLease {
    pub fn request(&self) -> &DeviceRequest {
        &self.request
    }
}

#[derive(Clone)]
struct Resident {
    bytes: Vec<u8>,
    cursor: u64,
}
#[derive(Clone, Default)]
struct GuestState {
    next_id: u64,
    cursor: u64,
    pending: BTreeMap<u64, DeviceRequest>,
    resident: BTreeMap<u32, Resident>,
    failed: BTreeMap<u32, CompletionStatus>,
    reads: BTreeMap<(u64, u32), Vec<u32>>,
    overlay: BTreeMap<u64, Vec<u8>>,
    capture_pending: Option<u64>,
    capture_ready: Option<DeviceCompletion>,
    clock_ns: u64,
    capture_epoch: u64,
}
pub(crate) struct DeviceHub {
    base: Option<BaseDisk>,
    agent: bool,
    pub(crate) capture: bool,
    replay: bool,
    incarnation: Rc<()>,
    guest: GuestState,
    pub(crate) error: Option<DeviceError>,
}
impl DeviceHub {
    fn issue(&mut self, intent: DeviceIntent) -> Result<DeviceRequest, DeviceError> {
        if let Some(error) = self.error {
            return Err(error);
        }
        if self.guest.pending.len() >= MAX_REQUESTS {
            return Err(DeviceError::Limit);
        }
        let id = self
            .guest
            .next_id
            .checked_add(1)
            .ok_or(DeviceError::Exhausted)?;
        let request = DeviceRequest { id, intent };
        self.guest.pending.insert(id, request.clone());
        self.guest.next_id = id;
        Ok(request)
    }
    fn validate(&self, completion: &DeviceCompletion) -> Result<(), DeviceError> {
        completion.validate()?;
        if self.guest.pending.get(&completion.request.id) != Some(&completion.request) {
            return Err(DeviceError::UnknownRequest);
        }
        self.guest
            .cursor
            .checked_add(1)
            .ok_or(DeviceError::Exhausted)?;
        if let DeviceIntent::BaseBlock { chunk, .. } = completion.request.intent
            && completion.status == CompletionStatus::Supplied
        {
            let pinned = |key: &u32| self.guest.reads.values().any(|keys| keys.contains(key));
            let retained: usize = self
                .guest
                .resident
                .iter()
                .filter(|(key, _)| pinned(key))
                .map(|(_, r)| r.bytes.len())
                .sum();
            if self.guest.resident.contains_key(&chunk)
                || retained.saturating_add(completion.bytes.len()) > CACHE_BUDGET
            {
                return Err(DeviceError::Limit);
            }
        }
        Ok(())
    }
    fn accept(&mut self, completion: DeviceCompletion) {
        self.guest.pending.remove(&completion.request.id);
        self.guest.cursor += 1;
        match completion.request.intent {
            DeviceIntent::BaseBlock { chunk, .. } => {
                if completion.status == CompletionStatus::Supplied {
                    while self
                        .guest
                        .resident
                        .values()
                        .map(|r| r.bytes.len())
                        .sum::<usize>()
                        + completion.bytes.len()
                        > CACHE_BUDGET
                    {
                        let victim = self
                            .guest
                            .resident
                            .iter()
                            .filter(|(key, _)| {
                                !self.guest.reads.values().any(|keys| keys.contains(key))
                            })
                            .min_by_key(|(_, r)| r.cursor)
                            .map(|(key, _)| *key)
                            .expect("validated capacity");
                        self.guest.resident.remove(&victim);
                    }
                    self.guest.resident.insert(
                        chunk,
                        Resident {
                            bytes: completion.bytes,
                            cursor: self.guest.cursor,
                        },
                    );
                } else {
                    self.guest.failed.insert(chunk, completion.status);
                }
            }
            DeviceIntent::Capture { .. } => self.guest.capture_ready = Some(completion),
            DeviceIntent::Agent { .. } => {}
        }
    }
}

impl crate::Machine {
    pub(crate) fn sync_session_devices(&mut self) {
        let Some(hub) = &self.session_devices else {
            return;
        };
        let mut hub = hub.borrow_mut();
        hub.guest.clock_ns = self.clint_mtime().saturating_mul(100);
        if let Some((_, state, ..)) = &self.snd {
            let state = state.borrow();
            if state.stream.state() == crate::dev::virtio::snd::PcmState::Running {
                hub.error = Some(DeviceError::Unsupported);
            }
            let epoch = state.capture_lifecycle_epoch();
            if hub.guest.capture_epoch != epoch {
                hub.guest
                    .pending
                    .retain(|_, r| !matches!(r.intent, DeviceIntent::Capture { .. }));
                hub.guest.capture_pending = None;
                hub.guest.capture_ready = None;
                hub.guest.capture_epoch = epoch;
            }
        }
        if hub.agent
            && let Some(console) = &self.console
        {
            let state = console.state.borrow();
            let generation = state.generation();
            hub.guest.pending.retain(|_,request| !matches!(request.intent, DeviceIntent::Agent { generation:g, .. } if g != generation));
            if state.agent_ready_for_host()
                && state.agent_input_bytes() == 0
                && !hub
                    .guest
                    .pending
                    .values()
                    .any(|request| matches!(request.intent, DeviceIntent::Agent { .. }))
            {
                let slot = self.virtio[console.slot_index].0.borrow();
                let qs = *slot.queue(crate::dev::virtio::console::AGENT_RECEIVE_QUEUE as usize);
                if qs.ready
                    && let Ok(mut queue) = crate::dev::virtio::queue::Virtqueue::new(&qs, 256)
                {
                    if let Some(actual) = &console.agent_receiveq
                        && actual.matches_state(&qs)
                    {
                        let (avail, used) = actual.ring_indices();
                        queue.set_ring_indices(avail, used);
                    }
                    if let Ok(Some(chain)) = queue.pop(&mut self.bus) {
                        let maximum = chain.writable_len().min(MAX_RESULT as u64) as u32;
                        if maximum != 0
                            && let Err(error) = hub.issue(DeviceIntent::Agent {
                                generation,
                                maximum,
                            })
                        {
                            hub.error = Some(error);
                        }
                    }
                }
            }
        }
    }
    /// Install the qualified adapters before execution. Existing block/host-audio adapters must
    /// be assembled separately, rather than silently being treated as recorded providers.
    pub fn enable_session_devices(
        &mut self,
        base: Option<BaseDisk>,
        agent: bool,
        capture: bool,
        replay: bool,
    ) -> Result<(), DeviceError> {
        if self.session_devices.is_some()
            || self.session_position() != Some(Default::default())
            || !self.virtio.is_empty()
            || self.blk.is_some()
            || !self.extra_blk.is_empty()
            || self.snd.is_some()
            || (agent && self.console.is_some())
        {
            return Err(DeviceError::Unsupported);
        }
        if let Some(base) = &base {
            base.validate()?;
            if self.coherence.base_image_hash != [0; 32]
                && self.coherence.base_image_hash != base.identity
            {
                return Err(DeviceError::Intent);
            }
        }
        if let Some(base) = &base {
            self.coherence.base_image_hash = base.identity;
        }
        let hub = Rc::new(RefCell::new(DeviceHub {
            base,
            agent,
            capture,
            replay,
            incarnation: Rc::new(()),
            guest: GuestState::default(),
            error: None,
        }));
        if self.plic.is_none() {
            self.enable_plic();
        }
        if hub.borrow().base.is_some() {
            self.enable_virtio_blk(alloc::boxed::Box::new(CompletionBlock { hub: hub.clone() }));
        } else if self.virtio.is_empty() {
            self.enable_virtio_slots(None);
        }
        if agent {
            self.enable_virtio_console();
        }
        if capture {
            self.enable_virtio_snd_with_audio_and_capture(
                Rc::new(CompletionAudioClock(hub.clone())),
                alloc::boxed::Box::new(crate::dev::virtio::snd::NullSink::new()),
                true,
            );
            self.snd.as_mut().unwrap().8 = alloc::boxed::Box::new(CompletionCapture(hub.clone()));
        }
        self.session_devices = Some(hub);
        Ok(())
    }
    pub fn session_device_requests(&self) -> Result<Vec<DeviceRequest>, DeviceError> {
        let hub = self
            .session_devices
            .as_ref()
            .ok_or(DeviceError::Inactive)?
            .borrow();
        Ok(hub.guest.pending.values().cloned().collect())
    }
    pub fn session_device_cursor(&self) -> Result<u64, DeviceError> {
        Ok(self
            .session_devices
            .as_ref()
            .ok_or(DeviceError::Inactive)?
            .borrow()
            .guest
            .cursor)
    }
    pub fn lease_session_device(&self, id: u64) -> Result<CompletionLease, DeviceError> {
        let hub = self
            .session_devices
            .as_ref()
            .ok_or(DeviceError::Inactive)?
            .borrow();
        if hub.replay {
            return Err(DeviceError::ReplayIngress);
        }
        let request = hub
            .guest
            .pending
            .get(&id)
            .ok_or(DeviceError::UnknownRequest)?
            .clone();
        Ok(CompletionLease {
            incarnation: hub.incarnation.clone(),
            request,
        })
    }
    pub fn complete_session_device(
        &mut self,
        lease: &CompletionLease,
        status: CompletionStatus,
        frames: u32,
        bytes: Vec<u8>,
    ) -> Result<(), DeviceError> {
        {
            let hub = self
                .session_devices
                .as_ref()
                .ok_or(DeviceError::Inactive)?
                .borrow();
            if hub.replay {
                return Err(DeviceError::ReplayIngress);
            }
            if !Rc::ptr_eq(&hub.incarnation, &lease.incarnation) {
                return Err(DeviceError::StaleLease);
            }
        }
        self.apply_device_completion(DeviceCompletion {
            request: lease.request.clone(),
            status,
            frames,
            bytes,
        })
    }
    /// Replay owners position the machine before calling this; real host ingress is unavailable.
    pub fn replay_session_device(
        &mut self,
        position: crate::session_clock::SessionPosition,
        completion: DeviceCompletion,
    ) -> Result<(), DeviceError> {
        if !self
            .session_devices
            .as_ref()
            .ok_or(DeviceError::Inactive)?
            .borrow()
            .replay
        {
            return Err(DeviceError::ReplayIngress);
        }
        let mut expected = self.session_position().ok_or(DeviceError::Inactive)?;
        if expected.phase != crate::session_clock::SessionPhase::Before {
            return Err(DeviceError::Position);
        }
        expected.ordinal = expected
            .ordinal
            .checked_add(1)
            .ok_or(DeviceError::Exhausted)?;
        expected.sequence = expected
            .sequence
            .checked_add(1)
            .ok_or(DeviceError::Exhausted)?;
        if expected != position {
            return Err(DeviceError::Position);
        }
        self.apply_device_completion(completion)
    }
    fn apply_device_completion(&mut self, completion: DeviceCompletion) -> Result<(), DeviceError> {
        let hub = self
            .session_devices
            .as_ref()
            .ok_or(DeviceError::Inactive)?
            .clone();
        hub.borrow().validate(&completion)?;
        if let DeviceIntent::Agent { generation, .. } = completion.request.intent
            && self
                .console
                .as_ref()
                .is_none_or(|console| console.state.borrow().generation() != generation)
        {
            return Err(DeviceError::StaleLease);
        }
        if self.session_pending_events() != 0 {
            return Err(DeviceError::Position);
        }
        let position = self.session_position().ok_or(DeviceError::Inactive)?;
        let encoded = completion.encode()?;
        self.stage_session_effect(
            position.transition,
            crate::session_clock::SessionEffect::HostInput {
                channel: CHANNEL,
                bytes: encoded,
            },
        )
        .map_err(|_| DeviceError::Position)?;
        let mut completion = Some(completion);
        self.deliver_session_host_boundary(|machine, channel, _| {
            assert_eq!(channel, CHANNEL);
            let completion = completion.take().expect("one exclusive completion");
            let mut accepted = completion.bytes.len() as u64;
            if matches!(completion.request.intent, DeviceIntent::Agent { .. })
                && completion.status == CompletionStatus::Supplied
            {
                accepted = machine
                    .console
                    .as_ref()
                    .unwrap()
                    .state
                    .borrow_mut()
                    .enqueue_agent_input(&completion.bytes) as u64;
            }
            let result = [
                completion.status as u64,
                completion.request.id,
                accepted,
                hub.borrow().guest.cursor + 1,
            ];
            hub.borrow_mut().accept(completion);
            result
        })
        .map_err(|_| DeviceError::Position)
    }
}

struct CompletionAudioClock(Rc<RefCell<DeviceHub>>);
impl crate::dev::virtio::snd::AudioClock for CompletionAudioClock {
    fn now_ns(&self) -> u64 {
        self.0.borrow().guest.clock_ns
    }
}

struct CompletionCapture(Rc<RefCell<DeviceHub>>);
impl crate::dev::virtio::snd::AudioCaptureSource for CompletionCapture {
    fn pull(
        &mut self,
        frames: &mut [i16],
        rate: u32,
        channels: u8,
    ) -> Result<usize, crate::dev::virtio::snd::AudioCaptureError> {
        use crate::dev::virtio::snd::AudioCaptureError as E;
        let mut hub = self.0.borrow_mut();
        if frames.is_empty()
            || frames.len() > MAX_RESULT / 2
            || !(1..=2).contains(&channels)
            || !frames.len().is_multiple_of(usize::from(channels))
            || rate != 48000
        {
            hub.error = Some(DeviceError::Limit);
            return Err(E::Pending);
        }
        let intent = DeviceIntent::Capture {
            samples: frames.len() as u32,
            rate,
            channels,
        };
        if let Some(completion) = hub.guest.capture_ready.take() {
            if completion.request.intent != intent {
                hub.error = Some(DeviceError::Intent);
                return Err(E::Pending);
            }
            hub.guest.capture_pending = None;
            if completion.status != CompletionStatus::Supplied {
                return Err(E::Failed);
            }
            for (sample, bytes) in frames.iter_mut().zip(completion.bytes.chunks_exact(2)) {
                *sample = i16::from_le_bytes([bytes[0], bytes[1]]);
            }
            return Ok(completion.frames as usize);
        }
        if hub.guest.capture_pending.is_none() {
            match hub.issue(intent) {
                Ok(request) => hub.guest.capture_pending = Some(request.id),
                Err(error) => hub.error = Some(error),
            }
        }
        Err(E::Pending)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block::BlockError;
    fn cached_machine() -> crate::Machine {
        let references = (0..34)
            .map(|n| PayloadRef::of(&alloc::vec![n+19;512*1024]).unwrap())
            .collect();
        let mut machine = crate::Machine::new(1 << 20);
        machine.start_session_clock(1).unwrap();
        machine
            .enable_session_devices(
                Some(BaseDisk {
                    identity: [73; 32],
                    sectors: 34 * 1024,
                    chunk_bytes: 512 * 1024,
                    chunks: references,
                }),
                false,
                false,
                false,
            )
            .unwrap();
        machine
    }
    #[test]
    fn cache_eviction_is_deterministic_and_keeps_in_flight_reads_pinned() {
        let mut machine = cached_machine();
        let block = machine.blk.as_ref().unwrap().0.clone();
        let mut buffer = [0; 512];
        for chunk in 0..34 {
            assert_eq!(
                block.borrow_mut().backend.read(chunk * 1024, &mut buffer),
                Err(BlockError::WouldBlock {
                    chunk: chunk as usize
                })
            );
            let request = machine.session_device_requests().unwrap().remove(0);
            let lease = machine.lease_session_device(request.id).unwrap();
            machine
                .complete_session_device(
                    &lease,
                    CompletionStatus::Supplied,
                    0,
                    alloc::vec![chunk as u8+19;512*1024],
                )
                .unwrap();
            machine.take_session_deliveries().unwrap();
            assert_eq!(
                block.borrow_mut().backend.read(chunk * 1024, &mut buffer),
                Ok(())
            );
            assert_eq!(buffer, [chunk as u8 + 19; 512]);
        }
        assert_eq!(machine.session_device_cursor(), Ok(34));
        assert_eq!(
            block.borrow_mut().backend.read(0, &mut buffer),
            Err(BlockError::WouldBlock { chunk: 0 })
        );
        let frame = machine.save_session_resume().unwrap();
        let mut restored = cached_machine();
        restored.load_session_resume(&frame).unwrap();
        assert_eq!(restored.save_session_resume().unwrap(), frame);
        // A different guest keeps all 33 reads posted instead of consuming completed bytes.
        let mut pinned = cached_machine();
        let block = pinned.blk.as_ref().unwrap().0.clone();
        for chunk in 0..33 {
            assert!(
                block
                    .borrow_mut()
                    .backend
                    .read(chunk * 1024, &mut buffer)
                    .is_err()
            );
        }
        for index in 0..32 {
            let request = pinned.session_device_requests().unwrap()[0].clone();
            let lease = pinned.lease_session_device(request.id).unwrap();
            pinned
                .complete_session_device(
                    &lease,
                    CompletionStatus::Supplied,
                    0,
                    alloc::vec![index as u8+19;512*1024],
                )
                .unwrap();
            pinned.take_session_deliveries().unwrap();
            assert_eq!(pinned.session_device_cursor(), Ok(index + 1));
        }
        let request = pinned.session_device_requests().unwrap()[0].clone();
        let lease = pinned.lease_session_device(request.id).unwrap();
        let before = pinned.save_session_resume().unwrap();
        assert_eq!(
            pinned.complete_session_device(
                &lease,
                CompletionStatus::Supplied,
                0,
                alloc::vec![51;512*1024]
            ),
            Err(DeviceError::Limit)
        );
        assert_eq!(pinned.save_session_resume().unwrap(), before);
        if let Ok(dir) = std::env::var("E9_DEVICE_EVIDENCE") {
            let path = std::path::Path::new(&dir);
            std::fs::create_dir_all(path).unwrap();
            std::fs::write(path.join("cache-evicted.resume"), frame).unwrap();
            std::fs::write(path.join("cache-pinned.resume"), before).unwrap();
        }
    }
}
