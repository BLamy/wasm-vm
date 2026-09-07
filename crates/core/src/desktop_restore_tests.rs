//! Deterministic adversarial proof for the E5-T26e restore transaction.

use super::{
    ComponentPreparation, DesktopRestoreBackend, DesktopRestoreCoordinator, DesktopRestoreEffects,
    DesktopRestoreError, DisplaySize, RESTORE_COMPONENT_ORDER, RestoreCallbackError,
    ViewportDisposition,
};
use crate::desktop_snapshot::{DesktopSnapshotBuilder, FORMAT_VERSION, section};
use alloc::vec::Vec;

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

#[derive(Debug)]
struct RecordingBackend {
    actions: Vec<&'static str>,
    refuse_component: Option<u16>,
    refuse_agent: bool,
    refuse_viewport: bool,
    refuse_commit: bool,
    publish_repair: bool,
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
            publish_repair: true,
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

    fn commit(&mut self) -> Result<DesktopRestoreEffects, RestoreCallbackError> {
        self.actions.push("commit");
        if self.refuse_commit {
            return Err(Self::refusal("commit_race"));
        }
        self.committed = true;
        Ok(DesktopRestoreEffects {
            full_repair_frame: self.publish_repair,
        })
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
    repair_backend.publish_repair = false;
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
            "commit",
            "clear",
            "cold"
        ]
    );
    assert!(repair_backend.fallback);
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
