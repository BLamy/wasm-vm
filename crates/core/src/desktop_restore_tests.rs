//! Deterministic adversarial proof for the E5-T26e restore transaction.

use super::{
    ComponentPreparation, DesktopRestoreBackend, DesktopRestoreCommit, DesktopRestoreCoordinator,
    DesktopRestoreError, DesktopRestorePreparation, DisplaySize, RESTORE_COMPONENT_ORDER,
    RestoreCallbackError, ViewportDisposition, VirtioDesktopRestoreBackend,
};
use crate::Machine;
use crate::desktop_snapshot::{DesktopSnapshotBuilder, FORMAT_VERSION, section};
use crate::dev::virtio::gpu::protocol;
use crate::dev::virtio::gpu::{TestSink, VirtioGpu};
use crate::dev::virtio::input::{InputDeviceSpec, VirtioInput};
use crate::dev::virtio::snd::VirtioSnd;
use alloc::{boxed::Box, vec::Vec};

fn composite_snapshot() -> Vec<u8> {
    let mut builder = DesktopSnapshotBuilder::new(0x2026_0907);
    builder
        .section(section::GPU, FORMAT_VERSION, b"gpu-state")
        .unwrap();
    builder
        .section(section::INPUT, FORMAT_VERSION, b"input-state")
        .unwrap();
    builder
        .section(section::SOUND, FORMAT_VERSION, b"sound-state")
        .unwrap();
    builder
        .section(section::AGENT, FORMAT_VERSION, b"agent-generation")
        .unwrap();
    builder.finish().unwrap()
}

struct ActualSnapshot {
    blob: Vec<u8>,
    gpu: Vec<u8>,
    input: Vec<u8>,
    sound: Vec<u8>,
}

fn actual_snapshot() -> ActualSnapshot {
    let (_, source_gpu) = VirtioGpu::new_with_state();
    {
        let mut state = source_gpu.borrow_mut();
        state.set_display(1280, 720);
        let resource = state
            .resources
            .create(7, protocol::FORMAT_R8G8B8A8_UNORM, 4, 2)
            .unwrap();
        for (index, pixel) in resource.host_pixels.iter_mut().enumerate() {
            *pixel = 0x1100_0000 | index as u32;
        }
        resource.presented = true;
        state.scanout_resource = Some(7);
    }
    let gpu = source_gpu.borrow().to_snapshot().unwrap();

    let (_, source_input) = VirtioInput::new_with_state(InputDeviceSpec::default());
    let input = source_input.borrow().to_snapshot().unwrap();

    let (_, source_sound) = VirtioSnd::new_with_state();
    let sound = source_sound.borrow().to_snapshot().unwrap();

    let mut builder = DesktopSnapshotBuilder::new(0x2026_0907);
    builder.section(section::GPU, FORMAT_VERSION, &gpu).unwrap();
    builder
        .section(section::INPUT, FORMAT_VERSION, &input)
        .unwrap();
    builder
        .section(section::SOUND, FORMAT_VERSION, &sound)
        .unwrap();
    builder
        .section(section::AGENT, FORMAT_VERSION, &17u64.to_le_bytes())
        .unwrap();
    ActualSnapshot {
        blob: builder.finish().unwrap(),
        gpu,
        input,
        sound,
    }
}

type ConcreteRig = (
    VirtioDesktopRestoreBackend,
    alloc::rc::Rc<core::cell::RefCell<crate::dev::virtio::gpu::GpuState>>,
    alloc::rc::Rc<core::cell::RefCell<crate::dev::virtio::input::InputState>>,
    alloc::rc::Rc<core::cell::RefCell<crate::dev::virtio::snd::SndState>>,
);

fn concrete_backend() -> ConcreteRig {
    let (_, gpu) = VirtioGpu::new_with_state();
    let (_, input) = VirtioInput::new_with_state(InputDeviceSpec::default());
    let (_, sound) = VirtioSnd::new_with_state();
    let backend = VirtioDesktopRestoreBackend::new(
        alloc::rc::Rc::clone(&gpu),
        alloc::rc::Rc::clone(&input),
        alloc::rc::Rc::clone(&sound),
    )
    .unwrap();
    (backend, gpu, input, sound)
}

#[derive(Debug)]
struct RecordingBackend {
    actions: Vec<&'static str>,
    refuse_component: Option<u16>,
    refuse_agent: bool,
    refuse_viewport: bool,
    refuse_commit: bool,
    refuse_repair: bool,
    commit_after_publication_failure: bool,
    committed: bool,
    fallback: bool,
    staged: bool,
    scanout: DisplaySize,
}

impl RecordingBackend {
    fn new() -> Self {
        Self {
            actions: Vec::new(),
            refuse_component: None,
            refuse_agent: false,
            refuse_viewport: false,
            refuse_commit: false,
            refuse_repair: false,
            commit_after_publication_failure: false,
            committed: false,
            fallback: false,
            staged: false,
            scanout: DisplaySize::new(1280, 720),
        }
    }

    fn refusal(code: &'static str) -> RestoreCallbackError {
        RestoreCallbackError::new(code)
    }
}

impl DesktopRestoreBackend for RecordingBackend {
    fn prepare_component(
        &mut self,
        tag: u16,
        _payload: &[u8],
    ) -> Result<ComponentPreparation, RestoreCallbackError> {
        let action = match tag {
            section::GPU => "gpu",
            section::INPUT => "input",
            section::SOUND => "sound",
            _ => "unknown",
        };
        self.actions.push(action);
        if self.refuse_component == Some(tag) {
            return Err(Self::refusal("component_version_refused"));
        }
        self.staged = true;
        Ok(match tag {
            section::GPU => ComponentPreparation {
                scanout: Some(self.scanout),
                ..ComponentPreparation::default()
            },
            section::INPUT => ComponentPreparation {
                input_release_events: 3,
                ..ComponentPreparation::default()
            },
            section::SOUND => ComponentPreparation {
                sound_xrun_events: 1,
                ..ComponentPreparation::default()
            },
            _ => ComponentPreparation::default(),
        })
    }

    fn prepare_agent_rehandshake(&mut self, _payload: &[u8]) -> Result<(), RestoreCallbackError> {
        self.actions.push("agent");
        if self.refuse_agent {
            return Err(Self::refusal("agent_channel_dropped"));
        }
        Ok(())
    }

    fn prepare_viewport(
        &mut self,
        scanout: DisplaySize,
        host_viewport: DisplaySize,
        disposition: ViewportDisposition,
    ) -> Result<(), RestoreCallbackError> {
        self.actions.push(match disposition {
            ViewportDisposition::Native => "viewport-native",
            ViewportDisposition::Letterbox => "viewport-letterbox",
        });
        assert_eq!(scanout, self.scanout);
        assert!(host_viewport.width != 0 && host_viewport.height != 0);
        if self.refuse_viewport {
            return Err(Self::refusal("viewport_replaced"));
        }
        Ok(())
    }

    fn prepare_full_repair(
        &mut self,
        scanout: DisplaySize,
        host_viewport: DisplaySize,
        disposition: ViewportDisposition,
    ) -> Result<DesktopRestorePreparation, RestoreCallbackError> {
        self.actions.push("repair");
        if self.refuse_repair {
            return Err(Self::refusal("missing_full_repair_frame"));
        }
        Ok(DesktopRestorePreparation::new(
            scanout,
            host_viewport,
            disposition,
        ))
    }

    fn commit(
        &mut self,
        _preparation: DesktopRestorePreparation,
    ) -> Result<DesktopRestoreCommit, RestoreCallbackError> {
        self.actions.push("commit");
        if self.refuse_commit {
            return Err(Self::refusal("commit_race"));
        }
        self.committed = true;
        if self.commit_after_publication_failure {
            return Err(Self::refusal("commit_after_publication"));
        }
        Ok(DesktopRestoreCommit::new())
    }

    fn clear_transient_reconciliation(&mut self) {
        self.actions.push("clear");
        self.staged = false;
    }

    fn cold_boot_fallback(&mut self) {
        self.actions.push("cold");
        self.fallback = true;
    }
}

#[test]
fn valid_composite_restore_stages_in_dependency_order_and_repairs() {
    let mut backend = RecordingBackend::new();
    let mut coordinator = DesktopRestoreCoordinator::new();
    let report = coordinator
        .restore(
            &composite_snapshot(),
            DisplaySize::new(1280, 720),
            &mut backend,
        )
        .unwrap();

    assert_eq!(
        backend.actions,
        [
            "gpu",
            "input",
            "sound",
            "agent",
            "viewport-native",
            "repair",
            "commit"
        ]
    );
    assert_eq!(report.boundary_id, 0x2026_0907);
    assert_eq!(report.scanout, DisplaySize::new(1280, 720));
    assert_eq!(report.host_viewport, DisplaySize::new(1280, 720));
    assert_eq!(report.viewport, ViewportDisposition::Native);
    assert_eq!(report.component_order, RESTORE_COMPONENT_ORDER);
    assert!(report.agent_rehandshake);
    assert_eq!(report.input_release_events, 3);
    assert_eq!(report.sound_xrun_events, 1);
    assert!(report.full_repair_frame);
    assert!(backend.committed);
    assert!(!backend.fallback);
    assert_eq!(coordinator.restore_epoch(), 1);
}

#[test]
fn changed_host_window_keeps_guest_scanout_and_selects_letterbox() {
    let mut backend = RecordingBackend::new();
    let mut coordinator = DesktopRestoreCoordinator::new();
    let report = coordinator
        .restore(
            &composite_snapshot(),
            DisplaySize::new(1024, 768),
            &mut backend,
        )
        .unwrap();

    assert_eq!(report.scanout, DisplaySize::new(1280, 720));
    assert_eq!(report.host_viewport, DisplaySize::new(1024, 768));
    assert_eq!(report.viewport, ViewportDisposition::Letterbox);
    assert!(backend.actions.contains(&"viewport-letterbox"));
}

#[test]
fn component_refusal_clears_staging_and_cold_boots_without_commit() {
    let mut backend = RecordingBackend::new();
    backend.refuse_component = Some(section::SOUND);
    let mut coordinator = DesktopRestoreCoordinator::new();
    let error = coordinator
        .restore(
            &composite_snapshot(),
            DisplaySize::new(1280, 720),
            &mut backend,
        )
        .unwrap_err();

    assert_eq!(
        error,
        DesktopRestoreError::ComponentRefused {
            tag: section::SOUND,
            code: "component_version_refused",
        }
    );
    assert_eq!(error.code(), "component_refused");
    assert_eq!(backend.actions, ["gpu", "input", "sound", "clear", "cold"]);
    assert!(!backend.committed);
    assert!(!backend.staged);
    assert!(backend.fallback);
}

#[test]
fn dropped_agent_channel_never_publishes_viewport_or_device_commit() {
    let mut backend = RecordingBackend::new();
    backend.refuse_agent = true;
    let mut coordinator = DesktopRestoreCoordinator::new();
    let error = coordinator
        .restore(
            &composite_snapshot(),
            DisplaySize::new(1280, 720),
            &mut backend,
        )
        .unwrap_err();

    assert_eq!(
        error,
        DesktopRestoreError::AgentRefused {
            code: "agent_channel_dropped"
        }
    );
    assert_eq!(error.code(), "agent_refused");
    assert_eq!(
        backend.actions,
        ["gpu", "input", "sound", "agent", "clear", "cold"]
    );
    assert!(!backend.actions.contains(&"commit"));
    assert!(!backend.actions.contains(&"viewport-native"));
    assert!(backend.fallback);
}

#[test]
fn viewport_and_repair_failures_use_the_same_clean_fallback() {
    let mut viewport_backend = RecordingBackend::new();
    viewport_backend.refuse_viewport = true;
    let mut coordinator = DesktopRestoreCoordinator::new();
    let viewport_error = coordinator
        .restore(
            &composite_snapshot(),
            DisplaySize::new(1280, 720),
            &mut viewport_backend,
        )
        .unwrap_err();
    assert_eq!(viewport_error.code(), "viewport_refused");
    assert_eq!(viewport_backend.actions.last(), Some(&"cold"));

    let mut repair_backend = RecordingBackend::new();
    repair_backend.refuse_repair = true;
    let repair_error = coordinator
        .restore(
            &composite_snapshot(),
            DisplaySize::new(1280, 720),
            &mut repair_backend,
        )
        .unwrap_err();
    assert_eq!(repair_error.code(), "commit_refused");
    assert_eq!(
        repair_backend.actions,
        [
            "gpu",
            "input",
            "sound",
            "agent",
            "viewport-native",
            "repair",
            "clear",
            "cold"
        ]
    );
    assert!(repair_backend.fallback);
}

#[test]
fn commit_failure_after_publication_is_cold_booted() {
    let mut backend = RecordingBackend::new();
    backend.commit_after_publication_failure = true;
    let mut coordinator = DesktopRestoreCoordinator::new();
    let error = coordinator
        .restore(
            &composite_snapshot(),
            DisplaySize::new(1280, 720),
            &mut backend,
        )
        .unwrap_err();

    assert_eq!(error.code(), "commit_refused");
    assert!(backend.committed);
    assert_eq!(backend.actions.last(), Some(&"cold"));
}

#[test]
fn missing_or_malformed_composite_never_enters_component_staging() {
    let mut missing_agent = DesktopSnapshotBuilder::new(7);
    missing_agent
        .section(section::GPU, FORMAT_VERSION, b"gpu")
        .unwrap();
    missing_agent
        .section(section::INPUT, FORMAT_VERSION, b"input")
        .unwrap();
    missing_agent
        .section(section::SOUND, FORMAT_VERSION, b"sound")
        .unwrap();
    let missing_agent = missing_agent.finish().unwrap();
    let mut backend = RecordingBackend::new();
    let mut coordinator = DesktopRestoreCoordinator::new();
    assert_eq!(
        coordinator
            .restore(&missing_agent, DisplaySize::new(1280, 720), &mut backend)
            .unwrap_err(),
        DesktopRestoreError::MissingSection {
            tag: section::AGENT
        }
    );
    assert_eq!(backend.actions, ["clear", "cold"]);

    let mut malformed = composite_snapshot();
    let last = malformed.len() - 1;
    malformed[last] ^= 1;
    let before = backend.actions.len();
    let error = coordinator
        .restore(&malformed, DisplaySize::new(1280, 720), &mut backend)
        .unwrap_err();
    assert_eq!(error.code(), "envelope_digest_mismatch");
    assert_eq!(&backend.actions[before..], ["clear", "cold"]);

    // The outer section version is checked before its payload digest or any component callback,
    // so a newer component cannot be half-applied even if its old digest remains in the blob.
    let mut forward = composite_snapshot();
    forward[30..32].copy_from_slice(&(FORMAT_VERSION + 1).to_le_bytes());
    let before = backend.actions.len();
    let error = coordinator
        .restore(&forward, DisplaySize::new(1280, 720), &mut backend)
        .unwrap_err();
    assert_eq!(error.code(), "unsupported_section_version");
    assert_eq!(&backend.actions[before..], ["clear", "cold"]);
}

#[test]
fn invalid_host_dimensions_are_rejected_before_callbacks() {
    let mut backend = RecordingBackend::new();
    let mut coordinator = DesktopRestoreCoordinator::new();
    let error = coordinator
        .restore(
            &composite_snapshot(),
            DisplaySize::new(0, 768),
            &mut backend,
        )
        .unwrap_err();
    assert_eq!(error.code(), "invalid_display_size");
    assert_eq!(backend.actions, ["clear", "cold"]);
}

#[test]
fn concrete_backend_round_trips_the_t26b_to_d_codecs_and_host_state() {
    let snapshot = actual_snapshot();
    let (mut backend, gpu, input, sound) = concrete_backend();
    let mut coordinator = DesktopRestoreCoordinator::new();
    let report = coordinator
        .restore(&snapshot.blob, DisplaySize::new(1024, 768), &mut backend)
        .unwrap();

    assert_eq!(report.viewport, ViewportDisposition::Letterbox);
    assert!(report.full_repair_frame);
    assert_eq!(report.input_release_events, 0);
    assert_eq!(report.sound_xrun_events, 0);
    assert_eq!(gpu.borrow().scanout_resource, Some(7));
    assert_eq!(gpu.borrow().to_snapshot().unwrap(), snapshot.gpu);
    assert_eq!(input.borrow().to_snapshot().unwrap(), snapshot.input);
    assert_eq!(sound.borrow().to_snapshot().unwrap(), snapshot.sound);
    assert_eq!(
        backend.host_state(),
        super::DesktopRestoreHostState {
            agent_generation: 17,
            agent_ready: true,
            viewport: Some((
                DisplaySize::new(1280, 720),
                DisplaySize::new(1024, 768),
                ViewportDisposition::Letterbox,
            )),
            repair_frames: 1,
        }
    );
}

#[test]
fn concrete_backend_refusals_leave_all_devices_in_the_cold_state() {
    let snapshot = actual_snapshot();
    let cases = [
        ("gpu", {
            let mut payload = snapshot.gpu.clone();
            payload[0] ^= 1;
            payload
        }),
        ("input", {
            let mut payload = snapshot.input.clone();
            payload[0] ^= 1;
            payload
        }),
        ("sound", {
            let mut payload = snapshot.sound.clone();
            payload[0] ^= 1;
            payload
        }),
    ];

    for (name, payload) in cases {
        let mut builder = DesktopSnapshotBuilder::new(0x2026_0907);
        let gpu_payload = if name == "gpu" {
            payload.as_slice()
        } else {
            snapshot.gpu.as_slice()
        };
        let input_payload = if name == "input" {
            payload.as_slice()
        } else {
            snapshot.input.as_slice()
        };
        let sound_payload = if name == "sound" {
            payload.as_slice()
        } else {
            snapshot.sound.as_slice()
        };
        builder
            .section(section::GPU, FORMAT_VERSION, gpu_payload)
            .unwrap();
        builder
            .section(section::INPUT, FORMAT_VERSION, input_payload)
            .unwrap();
        builder
            .section(section::SOUND, FORMAT_VERSION, sound_payload)
            .unwrap();
        builder
            .section(section::AGENT, FORMAT_VERSION, &17u64.to_le_bytes())
            .unwrap();
        let blob = builder.finish().unwrap();
        let (mut backend, gpu, input, sound) = concrete_backend();
        let cold_gpu = gpu.borrow().to_snapshot().unwrap();
        let cold_input = input.borrow().to_snapshot().unwrap();
        let cold_sound = sound.borrow().to_snapshot().unwrap();
        let error = DesktopRestoreCoordinator::new().restore(
            &blob,
            DisplaySize::new(1280, 720),
            &mut backend,
        );
        assert!(error.is_err(), "{name} refusal unexpectedly succeeded");
        assert_eq!(gpu.borrow().to_snapshot().unwrap(), cold_gpu);
        assert_eq!(input.borrow().to_snapshot().unwrap(), cold_input);
        assert_eq!(sound.borrow().to_snapshot().unwrap(), cold_sound);
        assert_eq!(
            backend.host_state(),
            super::DesktopRestoreHostState::default()
        );
    }

    let host_refusals = ["agent", "viewport", "repair", "commit"];
    for refusal in host_refusals {
        let (mut backend, gpu, input, sound) = concrete_backend();
        let cold_gpu = gpu.borrow().to_snapshot().unwrap();
        let cold_input = input.borrow().to_snapshot().unwrap();
        let cold_sound = sound.borrow().to_snapshot().unwrap();
        match refusal {
            "agent" => backend.set_agent_available(false),
            "viewport" => backend.set_viewport_available(false),
            "repair" => {
                // A valid envelope with an unbound scanout cannot satisfy the pre-commit repair
                // proof, so this exercises the former post-commit Boolean attack.
            }
            "commit" => backend.set_fail_commit_after_gpu(true),
            _ => unreachable!(),
        }
        let blob = if refusal == "repair" {
            let (_, empty_gpu) = VirtioGpu::new_with_state();
            let empty_gpu = empty_gpu.borrow().to_snapshot().unwrap();
            let mut builder = DesktopSnapshotBuilder::new(0x2026_0907);
            builder
                .section(section::GPU, FORMAT_VERSION, &empty_gpu)
                .unwrap();
            builder
                .section(section::INPUT, FORMAT_VERSION, &snapshot.input)
                .unwrap();
            builder
                .section(section::SOUND, FORMAT_VERSION, &snapshot.sound)
                .unwrap();
            builder
                .section(section::AGENT, FORMAT_VERSION, &17u64.to_le_bytes())
                .unwrap();
            builder.finish().unwrap()
        } else {
            snapshot.blob.clone()
        };
        let error = DesktopRestoreCoordinator::new().restore(
            &blob,
            DisplaySize::new(1280, 720),
            &mut backend,
        );
        assert!(error.is_err(), "{refusal} refusal unexpectedly succeeded");
        assert_eq!(gpu.borrow().to_snapshot().unwrap(), cold_gpu);
        assert_eq!(input.borrow().to_snapshot().unwrap(), cold_input);
        assert_eq!(sound.borrow().to_snapshot().unwrap(), cold_sound);
        assert_eq!(
            backend.host_state(),
            super::DesktopRestoreHostState::default()
        );
    }
}

#[test]
fn rollback_clears_live_sink_and_uses_power_on_baseline() {
    let snapshot = actual_snapshot();
    let sink = TestSink::new();
    let (_, gpu) = VirtioGpu::new_with_sink_state(Box::new(sink.clone()));
    let (_, input) = VirtioInput::new_with_state(InputDeviceSpec::default());
    let (_, sound) = VirtioSnd::new_with_state();
    let mut backend = VirtioDesktopRestoreBackend::new(
        alloc::rc::Rc::clone(&gpu),
        alloc::rc::Rc::clone(&input),
        alloc::rc::Rc::clone(&sound),
    )
    .unwrap();
    backend.set_fail_commit_after_gpu(true);
    assert!(
        DesktopRestoreCoordinator::new()
            .restore(&snapshot.blob, DisplaySize::new(1280, 720), &mut backend)
            .is_err()
    );

    assert!(sink.is_empty(), "rollback left a stale host frame");
    assert_eq!(gpu.borrow().scanout_resource, None);
    assert_eq!(gpu.borrow().display_size(), (1280, 800));
}

#[test]
fn machine_refuses_restore_without_the_production_agent_channel() {
    let snapshot = actual_snapshot();
    let mut machine = Machine::new(16 * 1024 * 1024);
    machine.enable_plic();
    machine.enable_virtio_slots(None);
    machine.enable_virtio_keyboard();
    machine.enable_virtio_snd();
    machine
        .enable_virtio_gpu(Box::new(crate::dev::virtio::gpu::NullSink))
        .expect("GPU slot is available");

    let error = machine
        .restore_desktop_snapshot(&snapshot.blob, DisplaySize::new(1280, 720))
        .unwrap_err();
    assert_eq!(error.code(), "commit_refused");
    assert_eq!(
        machine.desktop_restore_host_state(),
        super::DesktopRestoreHostState::default()
    );
}
