//! E5-T26e: atomic desktop restore ordering and host reconciliation.
//!
//! The device codecs in E5-T26b--d each own their payload format and their local atomicity. This
//! module owns the boundary *between* those codecs and the host-facing pieces that cannot be
//! serialized: the agent transport, the browser viewport, and the presentation repair. A backend
//! stages every component into detached state through [`DesktopRestoreBackend`], then commits once
//! all four sections and the host plan are ready. A refusal at any point clears transient work and
//! selects the caller's cold-boot path; no callback is allowed to publish a half-restored desktop.
//!
//! The module is deliberately `no_std` and does not know about JavaScript, canvases, or a
//! particular virtio device layout. Browser/native hosts adapt their existing T26b--d, T22b, and
//! T23d contracts to the callbacks below.

use crate::desktop_snapshot::{DesktopSnapshot, DesktopSnapshotError, section};

/// The maximum guest/host pixel dimension accepted by the desktop restore coordinator.
///
/// This mirrors the virtio-GPU EDID limit used by T22/T26b. The coordinator validates the host
/// plan as well as the GPU result so a malicious or stale host size cannot enter a reconciliation
/// callback.
pub const MAX_RESTORE_DIMENSION: u32 = 4095;

/// Component staging order. The agent section is staged after the three device sections because
/// its HELLO is the host/guest liveness fence for the restored desktop.
pub const RESTORE_COMPONENT_ORDER: [u16; 4] =
    [section::GPU, section::INPUT, section::SOUND, section::AGENT];

/// A validated pixel-size pair used by the restore plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DisplaySize {
    pub width: u32,
    pub height: u32,
}

impl DisplaySize {
    /// Construct a size. Validation is performed by the coordinator so callers can keep a
    /// fallible boundary around untrusted host/guest values.
    pub const fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }

    fn is_valid(self) -> bool {
        self.width != 0
            && self.height != 0
            && self.width <= MAX_RESTORE_DIMENSION
            && self.height <= MAX_RESTORE_DIMENSION
    }
}

/// How the restored guest scanout is presented in the current host window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewportDisposition {
    /// The host target and guest scanout have identical native dimensions.
    Native,
    /// The host target changed while suspended; T22b keeps the guest scanout dimensions and
    /// clips/letterboxes the repair frame at native pixel scale.
    Letterbox,
}

/// The result of staging one device component. The GPU callback must return the snapshotted
/// scanout dimensions; input and sound return their reconciliation counts. The values are facts
/// collected before the single commit point, not permission to mutate live state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ComponentPreparation {
    /// The GPU's bound scanout resource dimensions. Must be `Some` for the GPU component.
    pub scanout: Option<DisplaySize>,
    /// Number of release events queued by the input restore (T26c).
    pub input_release_events: u32,
    /// Number of guest-visible XRUN repairs queued by the sound restore (T26d).
    pub sound_xrun_events: u32,
}

/// A typed, stable callback refusal. Device-specific errors are mapped to their existing stable
/// code at the adapter boundary; the coordinator never stringifies or parses an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RestoreCallbackError {
    code: &'static str,
}

impl RestoreCallbackError {
    /// Construct a callback refusal from a stable diagnostic code.
    pub const fn new(code: &'static str) -> Self {
        Self { code }
    }

    /// Return the stable diagnostic code supplied by the adapter.
    pub const fn code(self) -> &'static str {
        self.code
    }
}

/// Effects observed at the one live-state commit point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesktopRestoreEffects {
    /// A valid restore must publish one full scanout repair frame. A backend that cannot do so
    /// returns `false`, which the coordinator treats as a failed restore and cold-boots.
    pub full_repair_frame: bool,
}

/// A fully reconciled desktop restore report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesktopRestoreReport {
    pub boundary_id: u64,
    pub scanout: DisplaySize,
    pub host_viewport: DisplaySize,
    pub viewport: ViewportDisposition,
    pub component_order: [u16; 4],
    pub agent_rehandshake: bool,
    pub input_release_events: u32,
    pub sound_xrun_events: u32,
    pub full_repair_frame: bool,
}

/// A refusal from envelope validation, component staging, host reconciliation, or the final
/// commit. `code()` is stable enough to persist in a host diagnostic or browser evidence record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DesktopRestoreError {
    /// The outer desktop envelope failed before any component callback ran.
    Snapshot(DesktopSnapshotError),
    /// A composite restore must contain all four component sections.
    MissingSection { tag: u16 },
    /// The GPU callback did not return a valid bound scanout size.
    MissingScanout,
    /// A callback returned an invalid guest or host size.
    InvalidDisplaySize {
        field: &'static str,
        width: u32,
        height: u32,
    },
    /// A device codec refused its already-framed payload.
    ComponentRefused { tag: u16, code: &'static str },
    /// The agent could not complete its restore-time HELLO handshake.
    AgentRefused { code: &'static str },
    /// T22b could not accept the deterministic native/letterbox plan.
    ViewportRefused { code: &'static str },
    /// The backend could not atomically publish the staged device and host state.
    CommitRefused { code: &'static str },
}

impl DesktopRestoreError {
    /// Stable machine-readable error code for host logs and persisted diagnostics.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Snapshot(error) => error.code(),
            Self::MissingSection { .. } => "missing_section",
            Self::MissingScanout => "missing_scanout",
            Self::InvalidDisplaySize { .. } => "invalid_display_size",
            Self::ComponentRefused { .. } => "component_refused",
            Self::AgentRefused { .. } => "agent_refused",
            Self::ViewportRefused { .. } => "viewport_refused",
            Self::CommitRefused { .. } => "commit_refused",
        }
    }
}

/// Adapter for the existing device codecs and host surfaces.
///
/// `prepare_component` must validate and stage GPU, input, and sound state in detached storage;
/// it must not replace live state. `prepare_agent_rehandshake` must wait for the existing T23d
/// HELLO/Channel generation and stage any reconnect bookkeeping without publishing stale data.
/// `prepare_viewport` must use T22b's fixed viewport and native-pixel letterbox policy. Only
/// `commit` may publish the staged state. If `commit` returns an error, the adapter must treat its
/// live state as unusable; the coordinator will still call both cleanup hooks before cold boot.
pub trait DesktopRestoreBackend {
    /// Validate/stage one of GPU, input, or sound. The callback is invoked in
    /// [`RESTORE_COMPONENT_ORDER`] order, excluding the agent section.
    fn prepare_component(
        &mut self,
        tag: u16,
        payload: &[u8],
    ) -> Result<ComponentPreparation, RestoreCallbackError>;

    /// Re-handshake the existing agent Channel from the AGENT section. A dropped channel is a
    /// refusal, not a successful restore with silently lost sends.
    fn prepare_agent_rehandshake(&mut self, payload: &[u8]) -> Result<(), RestoreCallbackError>;

    /// Stage the host viewport/presentation plan. The guest scanout size is never changed here.
    fn prepare_viewport(
        &mut self,
        scanout: DisplaySize,
        host_viewport: DisplaySize,
        disposition: ViewportDisposition,
    ) -> Result<(), RestoreCallbackError>;

    /// Atomically publish staged guest devices, agent generation, viewport, and one full repair
    /// frame. Returning `full_repair_frame: false` is a refusal.
    fn commit(&mut self) -> Result<DesktopRestoreEffects, RestoreCallbackError>;

    /// Clear queues, reconnect attempts, timers, and other transient reconciliation work after a
    /// refusal. This must be idempotent.
    fn clear_transient_reconciliation(&mut self);

    /// Leave the machine in the host's clean cold-boot state. This is intentionally infallible at
    /// the coordinator boundary: a host may log the original typed error and start its normal cold
    /// boot path even if a best-effort cleanup reports separately.
    fn cold_boot_fallback(&mut self);
}

/// Owns restore epochs and enforces the single composite restore transaction.
#[derive(Debug, Default, Clone, Copy)]
pub struct DesktopRestoreCoordinator {
    restore_epoch: u64,
}

impl DesktopRestoreCoordinator {
    /// Create an idle coordinator.
    pub const fn new() -> Self {
        Self { restore_epoch: 0 }
    }

    /// Monotonic restore-attempt counter, useful for host logs and stale callback fences.
    pub const fn restore_epoch(&self) -> u64 {
        self.restore_epoch
    }

    /// Parse, stage, reconcile, and atomically commit one composite desktop snapshot.
    ///
    /// The whole envelope is parsed before the first callback. Every required component is then
    /// staged in dependency order. Any error — including an agent drop, a changed/invalid host
    /// viewport, or a missing repair frame — calls `clear_transient_reconciliation` followed by
    /// `cold_boot_fallback` before the typed error is returned.
    pub fn restore<B: DesktopRestoreBackend>(
        &mut self,
        blob: &[u8],
        host_viewport: DisplaySize,
        backend: &mut B,
    ) -> Result<DesktopRestoreReport, DesktopRestoreError> {
        self.restore_epoch = self.restore_epoch.wrapping_add(1);

        let snapshot = match DesktopSnapshot::parse(blob) {
            Ok(snapshot) => snapshot,
            Err(error) => return self.abort(backend, DesktopRestoreError::Snapshot(error)),
        };
        if !host_viewport.is_valid() {
            return self.abort(
                backend,
                DesktopRestoreError::InvalidDisplaySize {
                    field: "host_viewport",
                    width: host_viewport.width,
                    height: host_viewport.height,
                },
            );
        }

        let gpu = match snapshot.section(section::GPU) {
            Some(section) => section,
            None => {
                return self.abort(
                    backend,
                    DesktopRestoreError::MissingSection { tag: section::GPU },
                );
            }
        };
        let input = match snapshot.section(section::INPUT) {
            Some(section) => section,
            None => {
                return self.abort(
                    backend,
                    DesktopRestoreError::MissingSection {
                        tag: section::INPUT,
                    },
                );
            }
        };
        let sound = match snapshot.section(section::SOUND) {
            Some(section) => section,
            None => {
                return self.abort(
                    backend,
                    DesktopRestoreError::MissingSection {
                        tag: section::SOUND,
                    },
                );
            }
        };
        let agent = match snapshot.section(section::AGENT) {
            Some(section) => section,
            None => {
                return self.abort(
                    backend,
                    DesktopRestoreError::MissingSection {
                        tag: section::AGENT,
                    },
                );
            }
        };

        let gpu_preparation = match backend.prepare_component(section::GPU, &gpu.payload) {
            Ok(preparation) => preparation,
            Err(error) => {
                return self.abort(
                    backend,
                    DesktopRestoreError::ComponentRefused {
                        tag: section::GPU,
                        code: error.code(),
                    },
                );
            }
        };
        let scanout = match gpu_preparation.scanout {
            Some(scanout) if scanout.is_valid() => scanout,
            Some(scanout) => {
                return self.abort(
                    backend,
                    DesktopRestoreError::InvalidDisplaySize {
                        field: "guest_scanout",
                        width: scanout.width,
                        height: scanout.height,
                    },
                );
            }
            None => return self.abort(backend, DesktopRestoreError::MissingScanout),
        };

        let input_preparation = match backend.prepare_component(section::INPUT, &input.payload) {
            Ok(preparation) => preparation,
            Err(error) => {
                return self.abort(
                    backend,
                    DesktopRestoreError::ComponentRefused {
                        tag: section::INPUT,
                        code: error.code(),
                    },
                );
            }
        };
        let sound_preparation = match backend.prepare_component(section::SOUND, &sound.payload) {
            Ok(preparation) => preparation,
            Err(error) => {
                return self.abort(
                    backend,
                    DesktopRestoreError::ComponentRefused {
                        tag: section::SOUND,
                        code: error.code(),
                    },
                );
            }
        };

        if let Err(error) = backend.prepare_agent_rehandshake(&agent.payload) {
            return self.abort(
                backend,
                DesktopRestoreError::AgentRefused { code: error.code() },
            );
        }

        let disposition = if scanout == host_viewport {
            ViewportDisposition::Native
        } else {
            ViewportDisposition::Letterbox
        };
        if let Err(error) = backend.prepare_viewport(scanout, host_viewport, disposition) {
            return self.abort(
                backend,
                DesktopRestoreError::ViewportRefused { code: error.code() },
            );
        }

        let effects = match backend.commit() {
            Ok(effects) => effects,
            Err(error) => {
                return self.abort(
                    backend,
                    DesktopRestoreError::CommitRefused { code: error.code() },
                );
            }
        };
        if !effects.full_repair_frame {
            return self.abort(
                backend,
                DesktopRestoreError::CommitRefused {
                    code: "missing_full_repair_frame",
                },
            );
        }

        Ok(DesktopRestoreReport {
            boundary_id: snapshot.boundary_id(),
            scanout,
            host_viewport,
            viewport: disposition,
            component_order: RESTORE_COMPONENT_ORDER,
            agent_rehandshake: true,
            input_release_events: input_preparation.input_release_events,
            sound_xrun_events: sound_preparation.sound_xrun_events,
            full_repair_frame: effects.full_repair_frame,
        })
    }

    fn abort<B: DesktopRestoreBackend>(
        &self,
        backend: &mut B,
        error: DesktopRestoreError,
    ) -> Result<DesktopRestoreReport, DesktopRestoreError> {
        backend.clear_transient_reconciliation();
        backend.cold_boot_fallback();
        Err(error)
    }
}

#[cfg(test)]
#[path = "desktop_restore_tests.rs"]
mod desktop_restore_tests;
