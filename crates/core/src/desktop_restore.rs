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

use alloc::{boxed::Box, rc::Rc, vec::Vec};
use core::cell::RefCell;

use crate::desktop_snapshot::{DesktopSnapshot, DesktopSnapshotError, section};
use crate::dev::virtio::console::ConsoleState;
use crate::dev::virtio::gpu::{FrameSink, GpuState, Rect, VirtioGpu};
use crate::dev::virtio::input::{InputDeviceSpec, InputState, VirtioInput};
use crate::dev::virtio::snd::{SndState, VirtioSnd};

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

/// Opaque proof that all detached restore preparation, including the repair frame, completed.
///
/// The fields and constructor are private on purpose. A backend cannot manufacture a successful
/// commit token from a post-commit Boolean; it must return the token supplied by this coordinator's
/// pre-commit preparation path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesktopRestorePreparation {
    scanout: DisplaySize,
    host_viewport: DisplaySize,
    disposition: ViewportDisposition,
}

impl DesktopRestorePreparation {
    fn new(
        scanout: DisplaySize,
        host_viewport: DisplaySize,
        disposition: ViewportDisposition,
    ) -> Self {
        Self {
            scanout,
            host_viewport,
            disposition,
        }
    }
}

/// Opaque proof returned only by a successful live-state commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesktopRestoreCommit {
    _private: (),
}

impl DesktopRestoreCommit {
    fn new() -> Self {
        Self { _private: () }
    }
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
/// `prepare_viewport` must use T22b's fixed viewport and native-pixel letterbox policy.
/// `prepare_full_repair` must prove that the detached GPU restore emitted the one required repair
/// frame before publication. Only `commit` may publish the staged state, and it receives the
/// opaque preparation token rather than a forgeable success Boolean. If `commit` returns an error,
/// the adapter must roll back or treat its live state as unusable; the coordinator will still call
/// both cleanup hooks before cold boot.
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

    /// Prove that the detached staged devices can produce the required full repair frame. This is
    /// deliberately before the live-state commit point.
    fn prepare_full_repair(
        &mut self,
        scanout: DisplaySize,
        host_viewport: DisplaySize,
        disposition: ViewportDisposition,
    ) -> Result<DesktopRestorePreparation, RestoreCallbackError>;

    /// Atomically publish staged guest devices, agent generation, viewport, and the already-proven
    /// repair frame. The private token makes success a typed transaction state, not a callback
    /// attestation that can be returned after a partial publication.
    fn commit(
        &mut self,
        preparation: DesktopRestorePreparation,
    ) -> Result<DesktopRestoreCommit, RestoreCallbackError>;

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

        let preparation = match backend.prepare_full_repair(scanout, host_viewport, disposition) {
            Ok(preparation) => preparation,
            Err(error) => {
                return self.abort(
                    backend,
                    DesktopRestoreError::CommitRefused { code: error.code() },
                );
            }
        };
        let _commit = match backend.commit(preparation) {
            Ok(commit) => commit,
            Err(error) => {
                return self.abort(
                    backend,
                    DesktopRestoreError::CommitRefused { code: error.code() },
                );
            }
        };

        Ok(DesktopRestoreReport {
            boundary_id: snapshot.boundary_id(),
            scanout,
            host_viewport,
            viewport: disposition,
            component_order: RESTORE_COMPONENT_ORDER,
            agent_rehandshake: true,
            input_release_events: input_preparation.input_release_events,
            sound_xrun_events: sound_preparation.sound_xrun_events,
            full_repair_frame: true,
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

/// Host-side state that is published together with a successful composite restore.
///
/// The browser/native presentation layer can copy this small value into its own viewport and
/// agent bookkeeping. Keeping it in the concrete adapter makes the native proof exercise the same
/// state transition as the production coordinator rather than a mock Boolean callback.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DesktopRestoreHostState {
    pub agent_generation: u64,
    pub agent_ready: bool,
    pub viewport: Option<(DisplaySize, DisplaySize, ViewportDisposition)>,
    pub repair_frames: u32,
}

type ViewportPlan = (DisplaySize, DisplaySize, ViewportDisposition);

/// Reset the live desktop surfaces to fresh power-on state.
///
/// A component that is missing before a backend can be constructed must still clear the live
/// presentation; resetting only the retained host tuple leaves a stale frame visible after an
/// early agent/device refusal. The concrete transaction backend keeps its captured power-on
/// snapshots separately so rollback remains tied to the restore attempt's true baseline.
pub(crate) fn reset_live_desktop_to_cold(
    gpu: Option<&Rc<RefCell<GpuState>>>,
    input: Option<&Rc<RefCell<InputState>>>,
    sound: Option<&Rc<RefCell<SndState>>>,
    agent: Option<&Rc<RefCell<ConsoleState>>>,
    host: &Rc<RefCell<DesktopRestoreHostState>>,
) {
    let (_, cold_gpu_state) = VirtioGpu::new_with_state();
    let (_, cold_input_state) = VirtioInput::new_with_state(InputDeviceSpec::default());
    let (_, cold_sound_state) = VirtioSnd::new_with_state();
    let cold_gpu = cold_gpu_state.borrow().to_snapshot().ok();
    let cold_input = cold_input_state.borrow().to_snapshot().ok();
    let cold_sound = cold_sound_state.borrow().to_snapshot().ok();

    if let (Some(target), Some(snapshot)) = (gpu, cold_gpu.as_deref()) {
        let mut state = target.borrow_mut();
        state.frame_sink.clear();
        let _ = state.restore_snapshot(snapshot);
        // Restoring a scanout can emit a repair frame. It is a device-state reset, not a
        // host-visible presentation, so clear that frame before returning to the caller.
        state.frame_sink.clear();
    }
    if let (Some(target), Some(snapshot)) = (input, cold_input.as_deref()) {
        let _ = target.borrow_mut().restore_snapshot(snapshot);
    }
    if let (Some(target), Some(snapshot)) = (sound, cold_sound.as_deref()) {
        let _ = target.borrow_mut().restore_snapshot(snapshot);
    }
    if let Some(agent) = agent {
        agent.borrow_mut().restart_agent_port();
    }
    *host.borrow_mut() = DesktopRestoreHostState::default();
}

#[derive(Debug)]
struct RepairFrameCounter {
    frames: Rc<RefCell<u32>>,
}

impl FrameSink for RepairFrameCounter {
    fn flush(
        &mut self,
        _scanout: Option<u32>,
        _format: u32,
        _rect: Rect,
        _resource_width: u32,
        _resource_height: u32,
        _pixels: &[u32],
    ) {
        let mut frames = self.frames.borrow_mut();
        *frames = frames.saturating_add(1);
    }

    fn clear(&mut self) {
        *self.frames.borrow_mut() = 0;
    }
}

/// Concrete native adapter for the T26b--d codecs and the T23/T22 host boundary.
///
/// Each component is decoded into a detached device first. `prepare_full_repair` requires the
/// detached GPU codec to have emitted exactly one frame before `commit` can be called. The live
/// devices are then updated in one adapter transaction with serialized rollback snapshots; a
/// failure after any individual device update restores the prior state and the coordinator's
/// cold-boot hook resets all three devices plus host state.
pub struct VirtioDesktopRestoreBackend {
    gpu: Rc<RefCell<GpuState>>,
    input: Rc<RefCell<InputState>>,
    sound: Rc<RefCell<SndState>>,
    cold_gpu: Vec<u8>,
    cold_input: Vec<u8>,
    cold_sound: Vec<u8>,
    staged_gpu: Option<Vec<u8>>,
    staged_input: Option<Vec<u8>>,
    staged_sound: Option<Vec<u8>>,
    staged_gpu_scanout: Option<DisplaySize>,
    staged_gpu_has_scanout: bool,
    staged_gpu_repair_frames: u32,
    staged_input_release_events: u32,
    staged_sound_xrun_events: u32,
    staged_agent_generation: Option<u64>,
    staged_viewport: Option<ViewportPlan>,
    host: Rc<RefCell<DesktopRestoreHostState>>,
    agent: Option<Rc<RefCell<ConsoleState>>>,
    agent_available: bool,
    viewport_available: bool,
    fail_commit_after_gpu: bool,
}

impl VirtioDesktopRestoreBackend {
    /// Capture the clean device snapshots used by the cold-boot fallback.
    pub fn new(
        gpu: Rc<RefCell<GpuState>>,
        input: Rc<RefCell<InputState>>,
        sound: Rc<RefCell<SndState>>,
    ) -> Result<Self, RestoreCallbackError> {
        Self::new_inner(
            gpu,
            input,
            sound,
            None,
            Rc::new(RefCell::new(DesktopRestoreHostState::default())),
        )
    }

    /// Construct the production adapter with the live T23e agent channel and persistent host
    /// reconciliation state owned by the machine. Success is impossible unless that channel has
    /// completed the existing device/port HELLO sequence.
    pub fn new_with_agent(
        gpu: Rc<RefCell<GpuState>>,
        input: Rc<RefCell<InputState>>,
        sound: Rc<RefCell<SndState>>,
        agent: Rc<RefCell<ConsoleState>>,
        host: Rc<RefCell<DesktopRestoreHostState>>,
    ) -> Result<Self, RestoreCallbackError> {
        Self::new_inner(gpu, input, sound, Some(agent), host)
    }

    fn new_inner(
        gpu: Rc<RefCell<GpuState>>,
        input: Rc<RefCell<InputState>>,
        sound: Rc<RefCell<SndState>>,
        agent: Option<Rc<RefCell<ConsoleState>>>,
        host: Rc<RefCell<DesktopRestoreHostState>>,
    ) -> Result<Self, RestoreCallbackError> {
        // Cold fallback means power-on state, not whatever dirty state happened to be live when
        // the adapter was assembled. Fresh headless devices provide only those baseline payloads;
        // the live handles retain their real sinks and queue capabilities.
        let (_, cold_gpu_state) = VirtioGpu::new_with_state();
        let (_, cold_input_state) = VirtioInput::new_with_state(InputDeviceSpec::default());
        let (_, cold_sound_state) = VirtioSnd::new_with_state();
        let cold_gpu = cold_gpu_state
            .borrow()
            .to_snapshot()
            .map_err(|_| RestoreCallbackError::new("gpu_cold_snapshot_unavailable"))?;
        let cold_input = cold_input_state
            .borrow()
            .to_snapshot()
            .map_err(|_| RestoreCallbackError::new("input_cold_snapshot_unavailable"))?;
        let cold_sound = cold_sound_state
            .borrow()
            .to_snapshot()
            .map_err(|_| RestoreCallbackError::new("sound_cold_snapshot_unavailable"))?;
        Ok(Self {
            gpu,
            input,
            sound,
            cold_gpu,
            cold_input,
            cold_sound,
            staged_gpu: None,
            staged_input: None,
            staged_sound: None,
            staged_gpu_scanout: None,
            staged_gpu_has_scanout: false,
            staged_gpu_repair_frames: 0,
            staged_input_release_events: 0,
            staged_sound_xrun_events: 0,
            staged_agent_generation: None,
            staged_viewport: None,
            host,
            agent,
            agent_available: true,
            viewport_available: true,
            fail_commit_after_gpu: false,
        })
    }

    /// Host-facing state published by the last successful commit.
    pub fn host_state(&self) -> DesktopRestoreHostState {
        *self.host.borrow()
    }

    /// Make the agent handshake refuse during a native adversarial run.
    pub fn set_agent_available(&mut self, available: bool) {
        self.agent_available = available;
    }

    /// Make the viewport publication refuse during a native adversarial run.
    pub fn set_viewport_available(&mut self, available: bool) {
        self.viewport_available = available;
    }

    /// Inject a bounded failure after the live GPU has been restored, exercising rollback and the
    /// coordinator's cold fallback without weakening the normal success path.
    pub fn set_fail_commit_after_gpu(&mut self, fail: bool) {
        self.fail_commit_after_gpu = fail;
    }

    fn refusal(code: &'static str) -> RestoreCallbackError {
        RestoreCallbackError::new(code)
    }

    fn clear_staged(&mut self) {
        self.staged_gpu = None;
        self.staged_input = None;
        self.staged_sound = None;
        self.staged_gpu_scanout = None;
        self.staged_gpu_has_scanout = false;
        self.staged_gpu_repair_frames = 0;
        self.staged_input_release_events = 0;
        self.staged_sound_xrun_events = 0;
        self.staged_agent_generation = None;
        self.staged_viewport = None;
    }

    fn rollback(&self, gpu: &[u8], input: &[u8], sound: &[u8]) {
        let mut gpu_state = self.gpu.borrow_mut();
        // restore_snapshot publishes a full repair frame when a scanout is bound. Clear both
        // before and after it so a failed transaction cannot expose either the partial commit or
        // the rollback frame through a retained browser/native surface.
        gpu_state.frame_sink.clear();
        let _ = gpu_state.restore_snapshot(gpu);
        gpu_state.frame_sink.clear();
        drop(gpu_state);
        let _ = self.input.borrow_mut().restore_snapshot(input);
        let _ = self.sound.borrow_mut().restore_snapshot(sound);
    }
}

impl DesktopRestoreBackend for VirtioDesktopRestoreBackend {
    fn prepare_component(
        &mut self,
        tag: u16,
        payload: &[u8],
    ) -> Result<ComponentPreparation, RestoreCallbackError> {
        match tag {
            section::GPU => {
                let frames = Rc::new(RefCell::new(0));
                let (_, state) = VirtioGpu::new_with_sink_state(Box::new(RepairFrameCounter {
                    frames: Rc::clone(&frames),
                }));
                state
                    .borrow_mut()
                    .restore_snapshot(payload)
                    .map_err(|_| Self::refusal("gpu_snapshot_refused"))?;
                let state = state.borrow();
                let (width, height) = state.display_size();
                let scanout = DisplaySize::new(width, height);
                self.staged_gpu = Some(payload.to_vec());
                self.staged_gpu_scanout = Some(scanout);
                self.staged_gpu_has_scanout = state.scanout_resource.is_some();
                self.staged_gpu_repair_frames = *frames.borrow();
                Ok(ComponentPreparation {
                    scanout: Some(scanout),
                    ..ComponentPreparation::default()
                })
            }
            section::INPUT => {
                let (_, state) = VirtioInput::new_with_state(InputDeviceSpec::default());
                let report = state
                    .borrow_mut()
                    .restore_snapshot(payload)
                    .map_err(|_| Self::refusal("input_snapshot_refused"))?;
                let release_events = u32::try_from(report.release_events.len())
                    .map_err(|_| Self::refusal("input_release_count_overflow"))?;
                self.staged_input = Some(payload.to_vec());
                self.staged_input_release_events = release_events;
                Ok(ComponentPreparation {
                    input_release_events: release_events,
                    ..ComponentPreparation::default()
                })
            }
            section::SOUND => {
                let (_, state) = VirtioSnd::new_with_state();
                let report = state
                    .borrow_mut()
                    .restore_snapshot(payload)
                    .map_err(|_| Self::refusal("sound_snapshot_refused"))?;
                self.staged_sound = Some(payload.to_vec());
                self.staged_sound_xrun_events = report.xrun_events;
                Ok(ComponentPreparation {
                    sound_xrun_events: report.xrun_events,
                    ..ComponentPreparation::default()
                })
            }
            _ => Err(Self::refusal("unknown_restore_component")),
        }
    }

    fn prepare_agent_rehandshake(&mut self, payload: &[u8]) -> Result<(), RestoreCallbackError> {
        if !self.agent_available {
            return Err(Self::refusal("agent_channel_dropped"));
        }
        let bytes: [u8; 8] = payload
            .try_into()
            .map_err(|_| Self::refusal("agent_generation_invalid"))?;
        if let Some(agent) = &self.agent
            && !agent.borrow().agent_ready_for_restore()
        {
            return Err(Self::refusal("agent_hello_incomplete"));
        }
        self.staged_agent_generation = Some(u64::from_le_bytes(bytes));
        Ok(())
    }

    fn prepare_viewport(
        &mut self,
        scanout: DisplaySize,
        host_viewport: DisplaySize,
        disposition: ViewportDisposition,
    ) -> Result<(), RestoreCallbackError> {
        if !self.viewport_available {
            return Err(Self::refusal("viewport_unavailable"));
        }
        self.staged_viewport = Some((scanout, host_viewport, disposition));
        Ok(())
    }

    fn prepare_full_repair(
        &mut self,
        scanout: DisplaySize,
        host_viewport: DisplaySize,
        disposition: ViewportDisposition,
    ) -> Result<DesktopRestorePreparation, RestoreCallbackError> {
        if self.staged_gpu.is_none()
            || self.staged_input.is_none()
            || self.staged_sound.is_none()
            || self.staged_agent_generation.is_none()
            || self.staged_viewport != Some((scanout, host_viewport, disposition))
            || self.staged_gpu_scanout != Some(scanout)
            || !self.staged_gpu_has_scanout
            || self.staged_gpu_repair_frames != 1
        {
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
        preparation: DesktopRestorePreparation,
    ) -> Result<DesktopRestoreCommit, RestoreCallbackError> {
        let Some(gpu_payload) = self.staged_gpu.as_deref() else {
            return Err(Self::refusal("gpu_not_staged"));
        };
        let Some(input_payload) = self.staged_input.as_deref() else {
            return Err(Self::refusal("input_not_staged"));
        };
        let Some(sound_payload) = self.staged_sound.as_deref() else {
            return Err(Self::refusal("sound_not_staged"));
        };
        let Some(agent_generation) = self.staged_agent_generation else {
            return Err(Self::refusal("agent_not_staged"));
        };
        if self.staged_viewport
            != Some((
                preparation.scanout,
                preparation.host_viewport,
                preparation.disposition,
            ))
        {
            return Err(Self::refusal("stale_restore_preparation"));
        }

        let gpu_before = self
            .gpu
            .borrow()
            .to_snapshot()
            .map_err(|_| Self::refusal("gpu_rollback_snapshot_unavailable"))?;
        let input_before = self
            .input
            .borrow()
            .to_snapshot()
            .map_err(|_| Self::refusal("input_rollback_snapshot_unavailable"))?;
        let sound_before = self
            .sound
            .borrow()
            .to_snapshot()
            .map_err(|_| Self::refusal("sound_rollback_snapshot_unavailable"))?;

        let result = if self.gpu.borrow_mut().restore_snapshot(gpu_payload).is_err() {
            Err(Self::refusal("gpu_commit_refused"))
        } else if self.fail_commit_after_gpu {
            Err(Self::refusal("commit_injected_failure"))
        } else if self
            .input
            .borrow_mut()
            .restore_snapshot(input_payload)
            .is_err()
        {
            Err(Self::refusal("input_commit_refused"))
        } else if self
            .sound
            .borrow_mut()
            .restore_snapshot(sound_payload)
            .is_err()
        {
            Err(Self::refusal("sound_commit_refused"))
        } else {
            Ok(())
        };
        if let Err(error) = result {
            self.rollback(&gpu_before, &input_before, &sound_before);
            return Err(error);
        }

        let agent_generation = if let Some(agent) = &self.agent {
            let Some(generation) = agent.borrow_mut().restore_rehandshake() else {
                self.rollback(&gpu_before, &input_before, &sound_before);
                return Err(Self::refusal("agent_rehandshake_refused"));
            };
            generation
        } else {
            agent_generation
        };
        {
            let mut host = self.host.borrow_mut();
            host.agent_generation = agent_generation;
            host.agent_ready = true;
            host.viewport = self.staged_viewport;
            host.repair_frames = host.repair_frames.saturating_add(1);
        }
        self.clear_staged();
        Ok(DesktopRestoreCommit::new())
    }

    fn clear_transient_reconciliation(&mut self) {
        self.clear_staged();
    }

    fn cold_boot_fallback(&mut self) {
        let mut gpu = self.gpu.borrow_mut();
        gpu.frame_sink.clear();
        let _ = gpu.restore_snapshot(&self.cold_gpu);
        gpu.frame_sink.clear();
        drop(gpu);
        let _ = self.input.borrow_mut().restore_snapshot(&self.cold_input);
        let _ = self.sound.borrow_mut().restore_snapshot(&self.cold_sound);
        if let Some(agent) = &self.agent {
            agent.borrow_mut().restart_agent_port();
        }
        *self.host.borrow_mut() = DesktopRestoreHostState::default();
        self.clear_staged();
    }
}

#[cfg(test)]
#[path = "desktop_restore_tests.rs"]
mod desktop_restore_tests;
