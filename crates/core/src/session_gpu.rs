//! Owned GPU result envelopes. Large DMA bytes live in a bounded immutable object
//! window; the common event clock retains only authenticated, small references.
//! Physical transport progress and guest-visible result admission are distinct.
use alloc::{collections::BTreeMap, rc::Rc, vec::Vec};
use core::cell::RefCell;
use sha2::{Digest, Sha256};
pub(crate) mod admission;
pub(crate) mod checkpoint;
mod control;
pub(crate) use control::ControlResultTap;

use crate::dev::virtio::gpu::{
    control3d::{Control3dError, Control3dId},
    submit3d::{Submit3dBacking, Submit3dCompletion, Submit3dExchange, Submit3dKey, Submit3dRows},
};

/// 19/20 are device/network completions; 21 is the owned console drain.
pub const CHANNEL: u16 = 22;
pub const MAX_PAYLOAD: usize = 32 << 20;
pub const MAX_RESIDENT_BYTES: usize = 64 << 20;
pub const MAX_OBJECTS: usize = 256;
pub const MAX_ENVELOPE: usize = 256;
const MAGIC: &[u8; 8] = b"WVGPUR01";

/// Epoch and queue-generation coordinates are rebased only by explicit GPU
/// history restore. Guest resets advance both coordinates and can never wrap.
pub(crate) struct Epochs {
    pub physical: u64,
    pub logical: u64,
    pub physical_queue: u64,
    pub logical_queue: u64,
}
impl Epochs {
    pub fn new(epoch: u64) -> Self {
        Self {
            physical: epoch,
            logical: epoch,
            physical_queue: 1,
            logical_queue: 1,
        }
    }
    pub fn observe(&mut self, physical: u64) -> Result<u64, GpuError> {
        let delta = physical
            .checked_sub(self.physical)
            .ok_or(GpuError::StaleOwner)?;
        let logical = self
            .logical
            .checked_add(delta)
            .filter(|value| *value != 0)
            .ok_or(GpuError::Exhausted)?;
        self.physical = physical;
        self.logical = logical;
        Ok(logical)
    }
    pub fn observe_queue(&mut self, physical: u64) -> Result<u64, GpuError> {
        let logical = self
            .logical_queue
            .checked_add(
                physical
                    .checked_sub(self.physical_queue)
                    .ok_or(GpuError::StaleOwner)?,
            )
            .ok_or(GpuError::Exhausted)?;
        if logical == 0 {
            return Err(GpuError::Exhausted);
        }
        self.physical_queue = physical;
        self.logical_queue = logical;
        Ok(logical)
    }
}

pub(crate) struct GpuSession {
    pub replay: bool,
    pub epochs: Rc<RefCell<Epochs>>,
    pub cursor: u64,
    pub payloads: Payloads,
    pub prepared: Option<admission::PreparedResult>,
    pub transport: alloc::collections::VecDeque<admission::TransportReceipt>,
    pub transport_bytes: usize,
    /// Captured physical work is already settled; future logical DMA has no host reissue.
    pub restored_complete: Option<Submit3dKey>,
}

/// Receipts and their large immutable objects transfer together to the recorder.
pub struct RecordingBatch {
    pub events: Vec<crate::session_clock::SessionDelivery>,
    pub payloads: Vec<Payload>,
}

impl crate::Machine {
    /// Install before execution with an already admitted ICount/source policy.
    /// The Wasm/profile binding is deliberately left to E9-T18c.
    pub fn enable_session_gpu_results(&mut self, replay: bool) -> Result<(), GpuError> {
        if self.session_gpu.is_some()
            || self.session_clock.is_none()
            || !self.session_sources.borrow().active()
            || self.session_sources.borrow().replay() != replay
            || self.guest_clock_mode() != crate::time::TimeMode::ICount
            || self.irq_stats().retired != 0
        {
            return Err(GpuError::Profile);
        }
        let state = self.gpu.as_ref().ok_or(GpuError::Profile)?.0.clone();
        let epoch = state
            .borrow()
            .control3d_snapshot()
            .ok_or(GpuError::Profile)?
            .epoch;
        let epochs = Rc::new(RefCell::new(Epochs::new(epoch)));
        state
            .borrow_mut()
            .install_session_result_tap(ControlResultTap {
                sources: self.session_sources.clone(),
                epochs: epochs.clone(),
            })?;
        self.session_gpu = Some(GpuSession {
            replay,
            epochs,
            cursor: 0,
            payloads: Payloads::default(),
            prepared: None,
            transport: alloc::collections::VecDeque::new(),
            transport_bytes: 0,
            restored_complete: None,
        });
        Ok(())
    }
    pub fn session_gpu_cursor(&self) -> Result<u64, GpuError> {
        Ok(self.session_gpu.as_ref().ok_or(GpuError::Inactive)?.cursor)
    }
    pub fn session_gpu_replay(&self) -> Result<bool, GpuError> {
        Ok(self.session_gpu.as_ref().ok_or(GpuError::Inactive)?.replay)
    }
    pub fn take_session_gpu_recording(&mut self) -> Result<RecordingBatch, GpuError> {
        if self.session_gpu_replay()? {
            return Err(GpuError::ReplayIngress);
        }
        let events = self
            .take_session_deliveries()
            .map_err(|_| GpuError::Admission)?;
        let payloads = self.session_gpu.as_mut().unwrap().payloads.take_all();
        Ok(RecordingBatch { events, payloads })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuError {
    Inactive,
    Profile,
    ReplayIngress,
    StaleOwner,
    Intent,
    Position,
    Payload,
    MissingPayload,
    Limit,
    Exhausted,
    Malformed,
    PhysicalPending,
    PhysicalFailure,
    Admission,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PayloadRef {
    pub sha256: [u8; 32],
    pub length: u32,
}
impl PayloadRef {
    pub fn of(bytes: &[u8]) -> Result<Self, GpuError> {
        if bytes.is_empty() || bytes.len() > MAX_PAYLOAD {
            return Err(GpuError::Limit);
        }
        Ok(Self {
            sha256: Sha256::digest(bytes).into(),
            length: bytes.len() as u32,
        })
    }
    fn validate(self) -> Result<(), GpuError> {
        if self.length == 0 || self.length as usize > MAX_PAYLOAD {
            Err(GpuError::Limit)
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Payload {
    pub reference: PayloadRef,
    pub bytes: Vec<u8>,
}

/// Ownership transfer does not expose a mutable reference to retained bytes.
/// The embedding persists these objects atomically with their event references.
#[derive(Default)]
pub struct Payloads {
    objects: BTreeMap<[u8; 32], Vec<u8>>,
    resident: usize,
}
impl Payloads {
    fn validate_insert(&self, reference: PayloadRef, bytes: &[u8]) -> Result<(), GpuError> {
        if PayloadRef::of(bytes)? != reference {
            return Err(GpuError::Payload);
        }
        if let Some(previous) = self.objects.get(&reference.sha256) {
            return if previous == bytes {
                Ok(())
            } else {
                Err(GpuError::Payload)
            };
        }
        if self.objects.len() >= MAX_OBJECTS
            || self
                .resident
                .checked_add(bytes.len())
                .is_none_or(|n| n > MAX_RESIDENT_BYTES)
        {
            return Err(GpuError::Limit);
        }
        Ok(())
    }
    pub fn insert(&mut self, payload: Payload) -> Result<(), GpuError> {
        self.validate_insert(payload.reference, &payload.bytes)?;
        if self.objects.contains_key(&payload.reference.sha256) {
            return Ok(());
        }
        let resident = self.resident + payload.bytes.len();
        self.objects.insert(payload.reference.sha256, payload.bytes);
        self.resident = resident;
        Ok(())
    }
    pub fn get(&self, reference: PayloadRef) -> Result<&[u8], GpuError> {
        reference.validate()?;
        let bytes = self
            .objects
            .get(&reference.sha256)
            .ok_or(GpuError::MissingPayload)?;
        if bytes.len() != reference.length as usize {
            return Err(GpuError::Payload);
        }
        Ok(bytes)
    }
    pub fn resident_bytes(&self) -> usize {
        self.resident
    }
    pub fn len(&self) -> usize {
        self.objects.len()
    }
    pub fn is_empty(&self) -> bool {
        self.objects.is_empty()
    }
    pub fn take_all(&mut self) -> Vec<Payload> {
        let objects = core::mem::take(&mut self.objects);
        self.resident = 0;
        objects
            .into_iter()
            .map(|(sha256, bytes)| Payload {
                reference: PayloadRef {
                    sha256,
                    length: bytes.len() as u32,
                },
                bytes,
            })
            .collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResultKind {
    /// Replay reads RAM at the recorded boundary and verifies this hash. Physical
    /// upload timing cannot change the native legacy shadow or its input bytes.
    Gather {
        exchange: Submit3dExchange,
        layers: Option<(u32, u32)>,
        expected: PayloadRef,
    },
    Scatter {
        exchange: Submit3dExchange,
        layers: Option<(u32, u32)>,
        payload: PayloadRef,
    },
    Complete(Submit3dCompletion),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GpuResult {
    /// Canonical accepted request, descriptor authority and virtual identities.
    pub request_sha256: [u8; 32],
    pub kind: ResultKind,
}
impl GpuResult {
    pub fn key(&self) -> Submit3dKey {
        match self.kind {
            ResultKind::Gather { exchange, .. } | ResultKind::Scatter { exchange, .. } => {
                exchange.key
            }
            ResultKind::Complete(value) => value.key,
        }
    }
    pub fn validate(&self) -> Result<(), GpuError> {
        let key = self.key();
        if key.epoch == 0 || key.sequence == 0 || self.request_sha256.iter().all(|v| *v == 0) {
            return Err(GpuError::Intent);
        }
        match self.kind {
            ResultKind::Gather {
                exchange,
                layers,
                expected: reference,
            }
            | ResultKind::Scatter {
                exchange,
                layers,
                payload: reference,
            } => {
                reference.validate()?;
                let count = layers.map_or(1, |(_, count)| count);
                let length = u64::from(exchange.rows.row_bytes)
                    .checked_mul(u64::from(exchange.rows.row_count))
                    .and_then(|n| n.checked_mul(u64::from(count)));
                if exchange.exchange_sequence == 0
                    || exchange.exchange_sequence > 4096
                    || exchange.backing.resource.id == 0
                    || exchange.backing.resource.generation == 0
                    || exchange.backing.generation == 0
                    || length != Some(u64::from(reference.length))
                    || layers.is_some_and(|(stride, count)| stride == 0 || count == 0)
                {
                    return Err(GpuError::Intent);
                }
            }
            ResultKind::Complete(value) => {
                if value.exchange_sequence > 4096
                    || value.applied_commands > 4096
                    || value.draws > 256
                    || (!value.gpu_complete && value.outcome != Err(Control3dError::BridgePoisoned))
                {
                    return Err(GpuError::Intent);
                }
            }
        }
        Ok(())
    }
    pub fn encode(&self) -> Result<Vec<u8>, GpuError> {
        self.validate()?;
        let mut out = MAGIC.to_vec();
        out.push(match self.kind {
            ResultKind::Gather { .. } => 1,
            ResultKind::Scatter { .. } => 2,
            ResultKind::Complete(_) => 3,
        });
        out.extend_from_slice(&self.request_sha256);
        for n in [self.key().epoch, self.key().sequence] {
            out.extend_from_slice(&n.to_le_bytes());
        }
        match self.kind {
            ResultKind::Gather {
                exchange,
                layers,
                expected: reference,
            }
            | ResultKind::Scatter {
                exchange,
                layers,
                payload: reference,
            } => {
                for n in [
                    exchange.exchange_sequence,
                    exchange.backing.resource.generation,
                    exchange.backing.generation,
                    exchange.rows.offset,
                ] {
                    out.extend_from_slice(&n.to_le_bytes());
                }
                for n in [
                    exchange.backing.resource.id,
                    exchange.rows.row_bytes,
                    exchange.rows.row_stride,
                    exchange.rows.row_count,
                ] {
                    out.extend_from_slice(&n.to_le_bytes());
                }
                out.push(u8::from(layers.is_some()));
                if let Some((stride, count)) = layers {
                    out.extend_from_slice(&stride.to_le_bytes());
                    out.extend_from_slice(&count.to_le_bytes());
                }
                out.extend_from_slice(&reference.sha256);
                out.extend_from_slice(&reference.length.to_le_bytes());
            }
            ResultKind::Complete(value) => {
                out.extend_from_slice(&value.exchange_sequence.to_le_bytes());
                out.extend_from_slice(&[outcome_code(value.outcome), u8::from(value.gpu_complete)]);
                out.extend_from_slice(&value.applied_commands.to_le_bytes());
                out.extend_from_slice(&value.draws.to_le_bytes());
            }
        }
        Ok(out)
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, GpuError> {
        if bytes.len() > MAX_ENVELOPE {
            return Err(GpuError::Limit);
        }
        let mut r = Reader { bytes, at: 0 };
        if r.take(8)? != MAGIC {
            return Err(GpuError::Malformed);
        }
        let tag = r.u8()?;
        let request_sha256 = r.take(32)?.try_into().unwrap();
        let key = Submit3dKey {
            epoch: r.u64()?,
            sequence: r.u64()?,
        };
        let kind = match tag {
            1 | 2 => {
                let exchange_sequence = r.u64()?;
                let generation = r.u64()?;
                let backing_generation = r.u64()?;
                let offset = r.u64()?;
                let exchange = Submit3dExchange {
                    key,
                    exchange_sequence,
                    backing: Submit3dBacking {
                        resource: Control3dId {
                            id: r.u32()?,
                            generation,
                        },
                        generation: backing_generation,
                    },
                    rows: Submit3dRows {
                        offset,
                        row_bytes: r.u32()?,
                        row_stride: r.u32()?,
                        row_count: r.u32()?,
                    },
                };
                let layers = match r.u8()? {
                    0 => None,
                    1 => Some((r.u32()?, r.u32()?)),
                    _ => return Err(GpuError::Malformed),
                };
                let reference = PayloadRef {
                    sha256: r.take(32)?.try_into().unwrap(),
                    length: r.u32()?,
                };
                if tag == 1 {
                    ResultKind::Gather {
                        exchange,
                        layers,
                        expected: reference,
                    }
                } else {
                    ResultKind::Scatter {
                        exchange,
                        layers,
                        payload: reference,
                    }
                }
            }
            3 => ResultKind::Complete(Submit3dCompletion {
                key,
                exchange_sequence: r.u64()?,
                outcome: decode_outcome(r.u8()?)?,
                gpu_complete: match r.u8()? {
                    0 => false,
                    1 => true,
                    _ => return Err(GpuError::Malformed),
                },
                applied_commands: r.u32()?,
                draws: r.u32()?,
            }),
            _ => return Err(GpuError::Malformed),
        };
        if r.at != bytes.len() {
            return Err(GpuError::Malformed);
        }
        let result = Self {
            request_sha256,
            kind,
        };
        result.validate()?;
        Ok(result)
    }
}

pub(crate) fn outcome_code(value: Result<(), Control3dError>) -> u8 {
    match value {
        Ok(()) => 0,
        Err(Control3dError::InvalidContextId) => 1,
        Err(Control3dError::InvalidResourceId) => 2,
        Err(Control3dError::InvalidParameter) => 3,
        Err(Control3dError::OutOfMemory) => 4,
        Err(Control3dError::Unspecified) => 5,
        Err(Control3dError::BridgePoisoned) => 6,
    }
}
pub(crate) fn decode_outcome(value: u8) -> Result<Result<(), Control3dError>, GpuError> {
    Ok(match value {
        0 => Ok(()),
        1 => Err(Control3dError::InvalidContextId),
        2 => Err(Control3dError::InvalidResourceId),
        3 => Err(Control3dError::InvalidParameter),
        4 => Err(Control3dError::OutOfMemory),
        5 => Err(Control3dError::Unspecified),
        6 => Err(Control3dError::BridgePoisoned),
        _ => return Err(GpuError::Malformed),
    })
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], GpuError> {
        let end = self.at.checked_add(n).ok_or(GpuError::Malformed)?;
        let value = self.bytes.get(self.at..end).ok_or(GpuError::Malformed)?;
        self.at = end;
        Ok(value)
    }
    fn u8(&mut self) -> Result<u8, GpuError> {
        Ok(self.take(1)?[0])
    }
    fn u32(&mut self) -> Result<u32, GpuError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, GpuError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
}

impl crate::Machine {
    pub(crate) fn gpu_logical_coordinates(&self) -> Result<(u64, u64, u64), GpuError> {
        let session = self.session_gpu.as_ref().ok_or(GpuError::Inactive)?;
        let (gpu, _, _, slot) = self.gpu.as_ref().ok_or(GpuError::Profile)?;
        let physical = gpu
            .borrow()
            .control3d_snapshot()
            .ok_or(GpuError::Profile)?
            .epoch;
        let queue = self.virtio[*slot]
            .0
            .borrow()
            .queue_generation(0)
            .ok_or(GpuError::Profile)?;
        let epochs = session.epochs.borrow();
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
        Ok((logical, logical_queue, session.cursor))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gpu_logical_epoch_never_accepts_stale_or_wrapped_physical_owners() {
        let mut epochs = Epochs::new(3);
        assert_eq!(epochs.observe(4), Ok(4));
        assert_eq!(epochs.observe(3), Err(GpuError::StaleOwner));
        assert_eq!((epochs.physical, epochs.logical), (4, 4));
        epochs.logical = u64::MAX;
        assert_eq!(epochs.observe(5), Err(GpuError::Exhausted));
        assert_eq!((epochs.physical, epochs.logical), (4, u64::MAX));
    }
    #[test]
    fn completion_outcomes_and_layered_envelopes_use_strict_bounded_codecs() {
        let key = Submit3dKey {
            epoch: 1,
            sequence: 1,
        };
        for outcome in [
            Ok(()),
            Err(Control3dError::InvalidContextId),
            Err(Control3dError::InvalidResourceId),
            Err(Control3dError::InvalidParameter),
            Err(Control3dError::OutOfMemory),
            Err(Control3dError::Unspecified),
            Err(Control3dError::BridgePoisoned),
        ] {
            let result = GpuResult {
                request_sha256: [0x77; 32],
                kind: ResultKind::Complete(Submit3dCompletion {
                    key,
                    exchange_sequence: 0,
                    outcome,
                    gpu_complete: outcome != Err(Control3dError::BridgePoisoned),
                    applied_commands: 0,
                    draws: 0,
                }),
            };
            assert_eq!(GpuResult::decode(&result.encode().unwrap()), Ok(result));
            let mut corrupt = result.encode().unwrap();
            corrupt[65] = 7;
            assert_eq!(GpuResult::decode(&corrupt), Err(GpuError::Malformed));
            let mut corrupt = result.encode().unwrap();
            corrupt[66] = 2;
            assert_eq!(GpuResult::decode(&corrupt), Err(GpuError::Malformed));
        }
        for gather in [false, true] {
            let exchange = Submit3dExchange {
                key,
                exchange_sequence: 1,
                backing: Submit3dBacking {
                    resource: Control3dId {
                        id: 3,
                        generation: 4,
                    },
                    generation: 5,
                },
                rows: Submit3dRows {
                    offset: 9,
                    row_bytes: 8,
                    row_stride: 16,
                    row_count: 3,
                },
            };
            let reference = PayloadRef::of(&alloc::vec![1;48]).unwrap();
            let layers = Some((64, 2));
            let kind = if gather {
                ResultKind::Gather {
                    exchange,
                    layers,
                    expected: reference,
                }
            } else {
                ResultKind::Scatter {
                    exchange,
                    layers,
                    payload: reference,
                }
            };
            let result = GpuResult {
                request_sha256: [0x77; 32],
                kind,
            };
            assert_eq!(GpuResult::decode(&result.encode().unwrap()), Ok(result));
            let mut corrupt = result.encode().unwrap();
            corrupt[105] = 2;
            assert_eq!(GpuResult::decode(&corrupt), Err(GpuError::Malformed));
        }
    }
    #[test]
    fn immutable_payload_objects_reject_corruption_and_preserve_deduplication() {
        let bytes = alloc::vec![0x42;16];
        let reference = PayloadRef::of(&bytes).unwrap();
        let mut window = Payloads::default();
        let mut corrupt = bytes.clone();
        corrupt[7] ^= 1;
        assert_eq!(
            window.insert(Payload {
                reference,
                bytes: corrupt
            }),
            Err(GpuError::Payload)
        );
        assert!(window.is_empty());
        window
            .insert(Payload {
                reference,
                bytes: bytes.clone(),
            })
            .unwrap();
        window.insert(Payload { reference, bytes }).unwrap();
        assert_eq!(window.len(), 1);
        assert_eq!(window.resident_bytes(), 16);
        assert_eq!(window.get(reference), Ok(&[0x42; 16][..]));
        assert_eq!(
            window.get(PayloadRef {
                length: 15,
                ..reference
            }),
            Err(GpuError::Payload)
        );
        assert_eq!(
            window.get(PayloadRef {
                sha256: [0; 32],
                ..reference
            }),
            Err(GpuError::MissingPayload)
        );
        assert_eq!(PayloadRef::of(&[]), Err(GpuError::Limit));
        assert_eq!(
            window.get(PayloadRef {
                length: 0,
                ..reference
            }),
            Err(GpuError::Limit)
        );
        let objects = window.take_all();
        assert_eq!(objects.len(), 1);
        assert_eq!(objects[0].reference, reference);
        assert!(window.is_empty());
        assert_eq!(window.resident_bytes(), 0);
    }
    #[cfg(feature = "virgl-control-proof")]
    fn quiet_profile(replay: bool, submission: bool) -> crate::Machine {
        use crate::dev::virtio::gpu::{
            NullSink,
            control3d::{Control3dEvent, Control3dSink},
            submit3d::{Submit3dMailbox, Submit3dRequest, Submit3dSink},
        };
        struct Quiet;
        impl Control3dSink for Quiet {
            fn apply(&mut self, _: &Control3dEvent) -> Result<(), Control3dError> {
                Ok(())
            }
        }
        impl Submit3dSink for Quiet {
            fn begin_job(&mut self, _: &Submit3dRequest) -> Result<(), Control3dError> {
                Ok(())
            }
            fn cancel_job(&mut self, _: Submit3dKey) -> Result<(), Control3dError> {
                Ok(())
            }
        }
        let mut m = crate::Machine::new(1 << 20);
        m.enable_plic();
        m.enable_virtio_slots(None);
        if submission {
            m.enable_virtio_gpu_submit3d_proof(
                alloc::boxed::Box::new(NullSink),
                alloc::boxed::Box::new(Quiet),
                alloc::boxed::Box::new(Quiet),
                Submit3dMailbox::new(),
            )
            .unwrap();
        } else {
            m.enable_virtio_gpu_control3d_proof(
                alloc::boxed::Box::new(NullSink),
                alloc::boxed::Box::new(Quiet),
            )
            .unwrap();
        }
        m.start_session_clock(1).unwrap();
        let policy = m.source_policy();
        m.start_session_sources(
            policy,
            replay.then_some(crate::session_clock::sources::ObservationTape {
                policy,
                records: alloc::vec![],
            }),
        )
        .unwrap();
        m
    }
    #[cfg(feature = "virgl-control-proof")]
    #[test]
    fn gpu_proof_gap_supported_control_only_construction_refuses_result_adapter_without_partial_installation()
     {
        let mut m = quiet_profile(false, false);
        let gpu = m.gpu.as_ref().unwrap().0.clone();
        let before = gpu.borrow().control3d_snapshot().unwrap();
        let position = m.session_position();
        assert_eq!(m.enable_session_gpu_results(false), Err(GpuError::Profile));
        assert!(m.session_gpu.is_none());
        assert_eq!(m.session_position(), position);
        assert_eq!(gpu.borrow().control3d_snapshot().unwrap(), before);
    }
    #[cfg(feature = "virgl-control-proof")]
    #[test]
    fn gpu_proof_gap_prepared_gpu_result_caps_actual_dispatch_forwarding_at_the_next_boundary() {
        use crate::{
            bus::Bus,
            platform::virt,
            session_clock::{SessionPhase, SessionPosition},
        };
        let mut m = quiet_profile(true, true);
        m.enable_session_gpu_results(true).unwrap();
        m.set_block_cache(true);
        m.bus_mut().store32(virt::DRAM_BASE, 0x0000_006f).unwrap();
        m.hart_mut().regs.pc = virt::DRAM_BASE;
        let position = SessionPosition {
            transition: 7,
            retired: 7,
            phase: SessionPhase::Before,
            ordinal: 1,
            sequence: 1,
        };
        let result = GpuResult {
            request_sha256: [0x77; 32],
            kind: ResultKind::Complete(Submit3dCompletion {
                key: Submit3dKey {
                    epoch: 1,
                    sequence: 1,
                },
                exchange_sequence: 0,
                outcome: Ok(()),
                gpu_complete: true,
                applied_commands: 0,
                draws: 0,
            }),
        };
        m.prepare_session_gpu_replay(position, result, None)
            .unwrap();
        assert_eq!(m.next_session_gpu_transition(), Some(7));
        assert_eq!(m.session_dispatch_budget(100), 7);
        assert_eq!(m.session_dispatch_budget(3), 3);
        assert_eq!(
            m.run_session_until(7, 100),
            Ok(crate::RunOutcome::MaxInstrs)
        );
        assert_eq!(m.session_position().unwrap().transition, 7);
        assert_eq!(m.session_dispatch_budget(100), 0);
        m.session_gpu.as_mut().unwrap().prepared = None;
        assert_eq!(m.next_session_gpu_transition(), None);
        assert_eq!(m.session_dispatch_budget(100), 100);
        #[cfg(feature = "std")]
        std::eprintln!(
            "GPU_GAP_G3 future GPU frame caps100-work dispatch to7; reached exact Before7, budget0; removal restores100 without retirement"
        );
    }
}
