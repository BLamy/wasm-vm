use super::{Epochs, decode_outcome, outcome_code};
use crate::{
    dev::virtio::gpu::control3d::{
        Control3dError, Control3dEvent, Control3dId, Control3dOperation, Control3dSink,
    },
    session_clock::{
        SessionError,
        sources::{DivergenceReason, ObservationHub, ObservationKind},
    },
};
use alloc::rc::Rc;
use core::cell::RefCell;
use sha2::{Digest, Sha256};

#[derive(Clone)]
pub(crate) struct ControlResultTap {
    pub sources: Rc<RefCell<ObservationHub>>,
    pub epochs: Rc<RefCell<Epochs>>,
}
impl ControlResultTap {
    pub fn replay(&self) -> bool {
        self.sources.borrow().replay()
    }
    pub fn error(&self) -> Option<SessionError> {
        self.sources.borrow().error()
    }
    fn epoch(&self, physical: u64) -> Result<u64, Control3dError> {
        self.epochs.borrow_mut().observe(physical).map_err(|_| {
            self.sources
                .borrow_mut()
                .reject_gpu_observation(DivergenceReason::Intent);
            Control3dError::BridgePoisoned
        })
    }
    pub fn apply(
        &self,
        event: &Control3dEvent,
        sink: &mut dyn Control3dSink,
    ) -> Result<(), Control3dError> {
        let intent = control_digest(event, self.epoch(event.epoch)?);
        self.observe(intent, || sink.apply(event))
    }
    pub fn scanout(
        &self,
        event: &crate::dev::virtio::gpu::scanout3d::Scanout3dEvent,
        sink: &mut dyn crate::dev::virtio::gpu::submit3d::Submit3dSink,
    ) -> Result<(), Control3dError> {
        use crate::dev::virtio::gpu::scanout3d::{Scanout3dCounters, Scanout3dSnapshot};
        let mut hash = Sha256::new();
        hash.update(b"wasm-vm-gpu-scanout-result-v1\0");
        hash.update(self.epoch(event.epoch)?.to_le_bytes());
        hash.update(
            Scanout3dSnapshot {
                next_generation: 1,
                binding: Some(event.binding),
                counters: Scanout3dCounters::default(),
            }
            .canonical_bytes(),
        );
        self.observe(hash.finalize().into(), || sink.bind_scanout(event))
    }
    fn observe(
        &self,
        intent: [u8; 32],
        call: impl FnMut() -> Result<(), Control3dError>,
    ) -> Result<(), Control3dError> {
        let call = RefCell::new(call);
        let bytes = self
            .sources
            .borrow_mut()
            .observe_checked(
                ObservationKind::GpuControl,
                40,
                || {
                    let result = call.borrow_mut()();
                    let mut bytes = intent.to_vec();
                    bytes.extend_from_slice(&u64::from(outcome_code(result)).to_le_bytes());
                    Ok(bytes)
                },
                |bytes| {
                    if bytes.len() != 40 || bytes[..32] != intent {
                        return Err(DivergenceReason::Intent);
                    }
                    let code = u64::from_le_bytes(bytes[32..].try_into().unwrap());
                    let code = u8::try_from(code).map_err(|_| DivergenceReason::Intent)?;
                    let recorded = decode_outcome(code).map_err(|_| DivergenceReason::Intent)?;
                    // Original failure committed no physical resource. Original success
                    // requires real reconstruction; its live status never replaces the log.
                    if recorded.is_ok() && call.borrow_mut()().is_err() {
                        return Err(DivergenceReason::PhysicalWitness);
                    }
                    Ok(())
                },
            )
            .map_err(|_| Control3dError::BridgePoisoned)?;
        let code = u64::from_le_bytes(bytes[32..].try_into().unwrap());
        decode_outcome(code as u8).map_err(|_| Control3dError::BridgePoisoned)?
    }
}

fn identity(hash: &mut Sha256, value: Control3dId) {
    hash.update(value.id.to_le_bytes());
    hash.update(value.generation.to_le_bytes());
}
fn bytes(hash: &mut Sha256, value: &[u8]) {
    hash.update((value.len() as u64).to_le_bytes());
    hash.update(value);
}
pub(super) fn control_digest(event: &Control3dEvent, logical_epoch: u64) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"wasm-vm-gpu-control-result-v1\0");
    hash.update(logical_epoch.to_le_bytes());
    match &event.operation {
        Control3dOperation::CreateContext {
            context,
            debug_name,
        } => {
            hash.update([1]);
            identity(&mut hash, *context);
            bytes(&mut hash, debug_name);
        }
        Control3dOperation::DestroyContext { context } => {
            hash.update([2]);
            identity(&mut hash, *context);
        }
        Control3dOperation::CreateResource {
            resource,
            metadata: m,
        } => {
            hash.update([3]);
            identity(&mut hash, *resource);
            for value in [
                m.resource_id,
                m.target,
                m.format,
                m.bind,
                m.width,
                m.height,
                m.depth,
                m.array_size,
                m.last_level,
                m.nr_samples,
                m.flags,
            ] {
                hash.update(value.to_le_bytes());
            }
        }
        Control3dOperation::AttachResource { context, resource } => {
            hash.update([4]);
            identity(&mut hash, *context);
            identity(&mut hash, *resource);
        }
        Control3dOperation::DetachResource { context, resource } => {
            hash.update([5]);
            identity(&mut hash, *context);
            identity(&mut hash, *resource);
        }
        Control3dOperation::AttachBacking {
            resource,
            segments,
            backing_generation,
        } => {
            hash.update([6]);
            identity(&mut hash, *resource);
            hash.update(backing_generation.to_le_bytes());
            hash.update((segments.len() as u32).to_le_bytes());
            for segment in segments {
                hash.update(segment.addr.to_le_bytes());
                hash.update(segment.length.to_le_bytes());
                hash.update(Sha256::digest(&segment.bytes));
            }
        }
        Control3dOperation::DetachBacking {
            resource,
            backing_generation,
        } => {
            hash.update([7]);
            identity(&mut hash, *resource);
            hash.update(backing_generation.to_le_bytes());
        }
        Control3dOperation::UnrefResource { resource } => {
            hash.update([8]);
            identity(&mut hash, *resource);
        }
        Control3dOperation::Reset => hash.update([9]),
    }
    hash.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_clock::{
        SessionClock, SessionEffect,
        sources::{ObservationRecord, ObservationTape, SourcePolicy},
    };
    use alloc::{format, vec};

    struct Sink {
        result: Result<(), Control3dError>,
        calls: usize,
    }
    impl Control3dSink for Sink {
        fn apply(&mut self, _: &Control3dEvent) -> Result<(), Control3dError> {
            self.calls += 1;
            self.result
        }
    }
    fn policy() -> SourcePolicy {
        SourcePolicy {
            version: 1,
            divider: 10,
            timebase_hz: 10_000_000,
        }
    }
    fn event() -> Control3dEvent {
        Control3dEvent {
            epoch: 1,
            operation: Control3dOperation::CreateContext {
                context: Control3dId {
                    id: 7,
                    generation: 1,
                },
                debug_name: b"test".to_vec(),
            },
        }
    }
    fn tap(tape: Option<ObservationTape>, clock: &SessionClock) -> ControlResultTap {
        let sources = Rc::new(RefCell::new(ObservationHub::default()));
        sources
            .borrow_mut()
            .start(policy(), tape, clock.position)
            .unwrap();
        sources.borrow_mut().begin(clock, policy()).unwrap();
        ControlResultTap {
            sources,
            epochs: Rc::new(RefCell::new(Epochs::new(1))),
        }
    }
    fn record(result: Result<(), Control3dError>) -> ObservationTape {
        let mut clock = SessionClock::default();
        let tap = tap(None, &clock);
        let mut sink = Sink { result, calls: 0 };
        assert_eq!(tap.apply(&event(), &mut sink), result);
        assert_eq!(sink.calls, 1);
        tap.sources.borrow_mut().commit(Some(&mut clock)).unwrap();
        let deliveries = clock.take_deliveries();
        assert_eq!(deliveries.len(), 1);
        let SessionEffect::Observation(value) = deliveries[0].effect.clone() else {
            panic!("GPU observation")
        };
        assert_eq!(value.kind, ObservationKind::GpuControl);
        assert_eq!(value.requested, 40);
        // Independently pinned literal protocol: domain, epoch1, create-context,
        // id7/generation1, length4 and ASCII test. Not computed by the encoder.
        let digest: String = value.bytes[..32]
            .iter()
            .map(|v| format!("{v:02x}"))
            .collect();
        assert_eq!(
            digest,
            "72f065e7e703b9cc536cd4d5255a3beb75f14a32d5e6740c29dffca2fc22bf43"
        );
        assert_eq!(
            &value.bytes[32..],
            &u64::from(outcome_code(result)).to_le_bytes()
        );
        ObservationTape {
            policy: policy(),
            records: vec![ObservationRecord {
                position: deliveries[0].position,
                value,
            }],
        }
    }
    #[test]
    fn gpu_control_original_failure_does_not_allocate_on_replay() {
        let tape = record(Err(Control3dError::OutOfMemory));
        let mut clock = SessionClock::default();
        let tap = tap(Some(tape), &clock);
        let mut healthier = Sink {
            result: Ok(()),
            calls: 0,
        };
        assert_eq!(
            tap.apply(&event(), &mut healthier),
            Err(Control3dError::OutOfMemory)
        );
        assert_eq!(
            healthier.calls, 0,
            "failed original operation must not orphan a resource"
        );
        tap.sources.borrow_mut().commit(Some(&mut clock)).unwrap();
        assert_eq!(clock.position.sequence, 1);
    }
    #[test]
    fn gpu_control_success_requires_a_real_physical_witness() {
        let tape = record(Ok(()));
        let mut clock = SessionClock::default();
        let tap = tap(Some(tape), &clock);
        let mut unavailable = Sink {
            result: Err(Control3dError::InvalidResourceId),
            calls: 0,
        };
        assert_eq!(
            tap.apply(&event(), &mut unavailable),
            Err(Control3dError::BridgePoisoned)
        );
        assert_eq!(unavailable.calls, 1);
        assert!(
            matches!(tap.error(),Some(SessionError::SourceDivergence(d))if d.reason==DivergenceReason::PhysicalWitness)
        );
        assert!(tap.sources.borrow_mut().commit(Some(&mut clock)).is_err());
        assert_eq!(clock.position.sequence, 0);
        assert!(clock.take_deliveries().is_empty());
    }
    #[test]
    fn gpu_control_corrupt_intent_and_wide_outcome_refuse_before_cursor_or_host() {
        for corruption in 0..2 {
            let mut tape = record(Ok(()));
            if corruption == 0 {
                tape.records[0].value.bytes[0] ^= 1;
            } else {
                tape.records[0].value.bytes[32..].copy_from_slice(&256u64.to_le_bytes());
            }
            let mut clock = SessionClock::default();
            let tap = tap(Some(tape), &clock);
            let mut sink = Sink {
                result: Ok(()),
                calls: 0,
            };
            assert_eq!(
                tap.apply(&event(), &mut sink),
                Err(Control3dError::BridgePoisoned)
            );
            assert_eq!(sink.calls, 0);
            assert!(
                matches!(tap.error(),Some(SessionError::SourceDivergence(d))if d.reason==DivergenceReason::Intent)
            );
            assert!(tap.sources.borrow_mut().commit(Some(&mut clock)).is_err());
            assert_eq!(clock.position.sequence, 0);
            assert!(clock.take_deliveries().is_empty());
        }
    }
    #[test]
    fn gpu_control_full_event_outbox_refuses_before_physical_side_effect() {
        let mut clock = SessionClock::default();
        for _ in 0..crate::session_clock::MAX_EVENTS {
            clock
                .enqueue(0, SessionEffect::ExternalPending(false))
                .unwrap();
            let delivery = clock.due().unwrap().unwrap();
            clock.acknowledge(delivery);
        }
        let before = clock.position;
        let tap = tap(None, &clock);
        let mut sink = Sink {
            result: Ok(()),
            calls: 0,
        };
        assert_eq!(
            tap.apply(&event(), &mut sink),
            Err(Control3dError::BridgePoisoned)
        );
        assert_eq!(sink.calls, 0);
        assert_eq!(tap.error(), Some(SessionError::QueueFull));
        assert!(tap.sources.borrow_mut().commit(Some(&mut clock)).is_err());
        assert_eq!(clock.position, before);
        assert_eq!(
            clock.take_deliveries().len(),
            crate::session_clock::MAX_EVENTS
        );
    }
    #[test]
    fn every_control_intent_uses_the_independent_literal_wire_fixture() {
        use crate::dev::virtio::gpu::control3d::{BackingSegment, Resource3dMetadata};
        let context = Control3dId {
            id: 7,
            generation: 11,
        };
        let resource = Control3dId {
            id: 3,
            generation: 5,
        };
        let operations = [
            Control3dOperation::CreateContext {
                context,
                debug_name: b"test".to_vec(),
            },
            Control3dOperation::DestroyContext { context },
            Control3dOperation::CreateResource {
                resource,
                metadata: Resource3dMetadata {
                    resource_id: 3,
                    target: 0,
                    format: 64,
                    bind: 16,
                    width: 64,
                    height: 1,
                    depth: 1,
                    array_size: 1,
                    last_level: 0,
                    nr_samples: 0,
                    flags: 0,
                },
            },
            Control3dOperation::AttachResource { context, resource },
            Control3dOperation::DetachResource { context, resource },
            Control3dOperation::AttachBacking {
                resource,
                segments: vec![BackingSegment {
                    addr: 0x80040000,
                    length: 16,
                    bytes: vec![0x77; 16],
                }],
                backing_generation: 4,
            },
            Control3dOperation::DetachBacking {
                resource,
                backing_generation: 4,
            },
            Control3dOperation::UnrefResource { resource },
            Control3dOperation::Reset,
        ];
        let expected =
            include_str!("../../tests/fixtures/session-gpu-results/control-intents-v1.txt");
        for (operation, expected) in operations.into_iter().zip(expected.lines()) {
            let event = Control3dEvent {
                epoch: 1,
                operation,
            };
            let observed: String = control_digest(&event, 1)
                .iter()
                .map(|n| format!("{n:02x}"))
                .collect();
            assert_eq!(observed, expected);
            let mut clock = SessionClock::default();
            let recorder = tap(None, &clock);
            let mut sink = Sink {
                result: Ok(()),
                calls: 0,
            };
            recorder.apply(&event, &mut sink).unwrap();
            recorder
                .sources
                .borrow_mut()
                .commit(Some(&mut clock))
                .unwrap();
            let receipt = clock.take_deliveries().remove(0);
            let SessionEffect::Observation(value) = receipt.effect else {
                panic!()
            };
            let tape = ObservationTape {
                policy: policy(),
                records: vec![ObservationRecord {
                    position: receipt.position,
                    value,
                }],
            };
            let mut clock = SessionClock::default();
            let replay = tap(Some(tape), &clock);
            let mut sink = Sink {
                result: Ok(()),
                calls: 0,
            };
            replay.apply(&event, &mut sink).unwrap();
            assert_eq!(sink.calls, 1);
            replay
                .sources
                .borrow_mut()
                .commit(Some(&mut clock))
                .unwrap();
        }
    }
    #[test]
    fn scanout_binding_results_record_errors_and_require_successful_reconstruction() {
        use crate::dev::virtio::gpu::{
            control3d::Resource3dMetadata, protocol::Rect, scanout3d::*, submit3d::*,
        };
        struct Display {
            result: Result<(), Control3dError>,
            calls: usize,
        }
        impl Submit3dSink for Display {
            fn begin_job(&mut self, _: &Submit3dRequest) -> Result<(), Control3dError> {
                unreachable!()
            }
            fn cancel_job(&mut self, _: Submit3dKey) -> Result<(), Control3dError> {
                unreachable!()
            }
            fn bind_scanout(&mut self, _: &Scanout3dEvent) -> Result<(), Control3dError> {
                self.calls += 1;
                self.result
            }
        }
        let targets = [
            Scanout3dTarget::Disabled,
            Scanout3dTarget::TwoD {
                resource_id: 3,
                format: 67,
                width: 8,
                height: 8,
            },
            Scanout3dTarget::Renderer {
                resource: Control3dId {
                    id: 3,
                    generation: 5,
                },
                metadata: Resource3dMetadata {
                    resource_id: 3,
                    target: 2,
                    format: 67,
                    bind: 2,
                    width: 8,
                    height: 8,
                    depth: 1,
                    array_size: 1,
                    last_level: 0,
                    nr_samples: 0,
                    flags: 0,
                },
            },
        ];
        for target in targets {
            for outcome in [Ok(()), Err(Control3dError::OutOfMemory)] {
                let event = Scanout3dEvent {
                    epoch: 1,
                    binding: Scanout3dBinding {
                        generation: 1,
                        rect: Rect {
                            x: 0,
                            y: 0,
                            width: 8,
                            height: 8,
                        },
                        target,
                    },
                };
                let mut clock = SessionClock::default();
                let recorder = tap(None, &clock);
                let mut display = Display {
                    result: outcome,
                    calls: 0,
                };
                assert_eq!(recorder.scanout(&event, &mut display), outcome);
                assert_eq!(display.calls, 1);
                recorder
                    .sources
                    .borrow_mut()
                    .commit(Some(&mut clock))
                    .unwrap();
                let receipt = clock.take_deliveries().remove(0);
                let SessionEffect::Observation(value) = receipt.effect else {
                    panic!()
                };
                let tape = ObservationTape {
                    policy: policy(),
                    records: vec![ObservationRecord {
                        position: receipt.position,
                        value,
                    }],
                };
                let mut clock = SessionClock::default();
                let replay = tap(Some(tape), &clock);
                let mut display = Display {
                    result: Ok(()),
                    calls: 0,
                };
                assert_eq!(replay.scanout(&event, &mut display), outcome);
                assert_eq!(display.calls, usize::from(outcome.is_ok()));
                replay
                    .sources
                    .borrow_mut()
                    .commit(Some(&mut clock))
                    .unwrap();
                assert_eq!(clock.position.sequence, 1);
            }
        }
    }
}
