//! Bounded session metadata, exact event positions and read-only replay admission (E9-T02).
//! These codecs do not execute a guest, migrate history, fetch assets or delete old data.
//! All public encode/admit paths validate first; wide JSON integers are decimal strings.

use alloc::collections::BTreeSet;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::fmt;
use serde::{Deserialize, Deserializer, Serialize, Serializer, de::DeserializeOwned};
use sha2::{Digest, Sha256};

pub const MAX_MANIFEST_BYTES: usize = 1 << 20;
pub const MAX_INLINE_BYTES: usize = 1 << 20;
pub const MAX_EVENT_BYTES: usize = 4 * MAX_INLINE_BYTES + 65_536;
pub const MAX_CHUNK_BYTES: u64 = 4 << 20;
pub const MAX_SESSION_BYTES: u64 = 4 << 30;
pub const MAX_INDEX_ENTRIES: usize = 4096;
pub const MAX_EVENTS_PER_CHUNK: u32 = 65_536;
pub const CAPTURE_INPUTS: &[&str] = &[
    "uart",
    "keyboard",
    "pointer",
    "display",
    "lifecycle",
    "mtime",
    "rtc",
    "entropy",
    "timers",
    "block-read",
    "block-write",
    "dma",
    "network",
    "network-time",
    "file-transfer",
    "agent",
    "clipboard",
    "audio-playback",
    "audio-capture",
    "software-gpu",
    "gpu-results",
    "storage-control",
    "checkpoint-control",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    TooLarge(&'static str),
    Malformed(String),
    Version {
        section: &'static str,
        major: u16,
        minor: u16,
    },
    UnsupportedRequired(String),
    Invalid(&'static str),
    Duplicate(&'static str),
    IndexOrder,
    Overflow,
    LengthMismatch {
        expected: u64,
        actual: u64,
    },
    DigestMismatch,
    IdentityMismatch(&'static str),
    MissingAsset(&'static str),
    MissingCapture(String),
}

impl fmt::Display for SessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

/// Never deserialize a JSON number through f64, including values above 2^53.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ExactU64(pub u64);

impl Serialize for ExactU64 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for ExactU64 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        if text.is_empty()
            || text.len() > 20
            || (text.len() > 1 && text.starts_with('0'))
            || !text.bytes().all(|c| c.is_ascii_digit())
        {
            return Err(serde::de::Error::custom(
                "expected canonical unsigned decimal string",
            ));
        }
        text.parse().map(Self).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ContentHash(pub [u8; 32]);

impl ContentHash {
    pub fn of(bytes: &[u8]) -> Self {
        Self(Sha256::digest(bytes).into())
    }
}

impl Serialize for ContentHash {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&crate::encode_hex32(&self.0))
    }
}

impl<'de> Deserialize<'de> for ContentHash {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        if text.len() != 64
            || !text
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        {
            return Err(serde::de::Error::custom("expected lowercase SHA-256"));
        }
        crate::decode_hex32(&text)
            .map(Self)
            .ok_or_else(|| serde::de::Error::custom("invalid SHA-256"))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Version {
    pub major: u16,
    pub minor: u16,
}

impl Version {
    pub const V1: Self = Self { major: 1, minor: 0 };
    fn validate(self, section: &'static str) -> Result<(), SessionError> {
        if self != Self::V1 {
            return Err(SessionError::Version {
                section,
                major: self.major,
                minor: self.minor,
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Before,
    Observe,
    After,
}

/// Sequence distinguishes paused controls; transition distinguishes non-retiring traps/IRQs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Position {
    pub transition: ExactU64,
    pub phase: Phase,
    pub ordinal: u32,
    pub sequence: ExactU64,
    pub retired: ExactU64,
}

impl Position {
    pub const ZERO: Self = Self {
        transition: ExactU64(0),
        phase: Phase::Before,
        ordinal: 0,
        sequence: ExactU64(0),
        retired: ExactU64(0),
    };
    pub fn follows(self, earlier: Self) -> bool {
        (self.transition, self.phase, self.ordinal, self.sequence)
            >= (
                earlier.transition,
                earlier.phase,
                earlier.ordinal,
                earlier.sequence,
            )
            && self.sequence >= earlier.sequence
            && self.retired >= earlier.retired
            && self.retired.0 <= self.transition.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlobRef {
    pub sha256: ContentHash,
    pub length: ExactU64,
}

impl BlobRef {
    pub fn of(bytes: &[u8]) -> Self {
        Self {
            sha256: ContentHash::of(bytes),
            length: ExactU64(bytes.len() as u64),
        }
    }
    pub fn validate(&self) -> Result<(), SessionError> {
        if self.length.0 == 0 || self.length.0 > MAX_SESSION_BYTES {
            return Err(SessionError::Invalid("blob length"));
        }
        Ok(())
    }
    pub fn verify(&self, bytes: &[u8]) -> Result<(), SessionError> {
        self.validate()?;
        if self.length.0 != bytes.len() as u64 {
            return Err(SessionError::LengthMismatch {
                expected: self.length.0,
                actual: bytes.len() as u64,
            });
        }
        if self.sha256 != ContentHash::of(bytes) {
            return Err(SessionError::DigestMismatch);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceIdentity {
    pub id: String,
    pub kind: String,
    pub mmio_base: ExactU64,
    pub mmio_length: u32,
    pub irq: u32,
    pub state_version: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GpuIdentity {
    pub renderer_build: ContentHash,
    pub profile: ContentHash,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MachineIdentity {
    pub vm_build: ContentHash,
    pub wasm_build: ContentHash,
    pub base_image: ContentHash,
    pub kernel: ContentHash,
    pub initramfs: Option<ContentHash>,
    pub ram_bytes: ExactU64,
    pub harts: u16,
    pub devices: Vec<DeviceIdentity>,
    pub gpu: Option<GpuIdentity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClockMode {
    Icount,
    Wall,
    PacedIcount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClockPolicy {
    pub mode: ClockMode,
    pub divider: u32,
    pub timebase_hz: ExactU64,
    pub interactive: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecordingMode {
    CheckpointsOnly,
    ExactReplay,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayPolicy {
    pub mode: RecordingMode,
    pub profile: String,
    pub event_version: Version,
    pub checkpoint_version: Version,
    pub boundary_version: u16,
    pub clock: ClockPolicy,
    pub required_inputs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeAsset {
    pub role: String,
    pub content: BlobRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Extension {
    pub kind: String,
    pub required: bool,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventChunkIndex {
    pub first: Position,
    pub last: Position,
    pub count: u32,
    pub content: BlobRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckpointIndex {
    pub id: String,
    pub position: Position,
    pub next_sequence: ExactU64,
    pub machine: BlobRef,
    pub disk_root: ContentHash,
    pub gpu: Option<BlobRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionManifest {
    pub version: Version,
    pub id: String,
    pub machine: MachineIdentity,
    pub policy: ReplayPolicy,
    pub assets: Vec<RuntimeAsset>,
    pub begin: Position,
    pub end: Position,
    pub events: Vec<EventChunkIndex>,
    pub checkpoints: Vec<CheckpointIndex>,
    pub extensions: Vec<Extension>,
}

/// A caller's real execution build/policy plus capture adapters it has actually installed.
/// Equality is compatibility only; later slices own executable capability qualification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeDescriptor {
    pub machine: MachineIdentity,
    pub policy: ReplayPolicy,
    pub captured_inputs: Vec<String>,
}

/// Created by hashing real retained bytes, never by deserializing a catalogue claim.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedAsset(BlobRef);
impl VerifiedAsset {
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self(BlobRef::of(bytes))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeAvailability {
    Available {
        runtime_index: usize,
    },
    UnavailableRuntime,
    UnavailableAsset {
        sha256: ContentHash,
        length: ExactU64,
    },
}

fn label(value: &str, limit: usize, field: &'static str) -> Result<(), SessionError> {
    if value.is_empty()
        || value.len() > limit
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:/".contains(&b))
    {
        return Err(SessionError::Invalid(field));
    }
    Ok(())
}

fn unique_labels(values: &[String], limit: usize, field: &'static str) -> Result<(), SessionError> {
    if values.len() > limit {
        return Err(SessionError::TooLarge(field));
    }
    let mut seen = BTreeSet::new();
    for value in values {
        label(value, 64, field)?;
        if !seen.insert(value) {
            return Err(SessionError::Duplicate(field));
        }
    }
    Ok(())
}

fn decode<T: DeserializeOwned>(bytes: &[u8], limit: usize) -> Result<T, SessionError> {
    if bytes.len() > limit {
        return Err(SessionError::TooLarge("encoded data"));
    }
    serde_json::from_slice(bytes).map_err(|e| SessionError::Malformed(format!("{e}")))
}

fn encode<T: Serialize>(value: &T, limit: usize) -> Result<Vec<u8>, SessionError> {
    let bytes = serde_json::to_vec(value).map_err(|e| SessionError::Malformed(format!("{e}")))?;
    if bytes.len() > limit {
        return Err(SessionError::TooLarge("encoded data"));
    }
    Ok(bytes)
}

impl SessionManifest {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, SessionError> {
        let manifest: Self = decode(bytes, MAX_MANIFEST_BYTES)?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, SessionError> {
        self.validate()?;
        encode(self, MAX_MANIFEST_BYTES)
    }

    pub fn validate(&self) -> Result<(), SessionError> {
        self.version.validate("manifest")?;
        self.policy.event_version.validate("events")?;
        self.policy.checkpoint_version.validate("checkpoints")?;
        label(&self.id, 64, "session id")?;
        if self.machine.harts != 1
            || !(16 << 20..=1 << 30).contains(&self.machine.ram_bytes.0)
            || !self.machine.ram_bytes.0.is_multiple_of(4096)
        {
            return Err(SessionError::Invalid("one-hart RAM topology"));
        }
        if self.machine.devices.is_empty() || self.machine.devices.len() > 32 {
            return Err(SessionError::Invalid("device topology"));
        }
        let mut ids = BTreeSet::new();
        let mut ranges = Vec::new();
        let mut has_gpu = false;
        for device in &self.machine.devices {
            label(&device.id, 64, "device id")?;
            if !ids.insert(&device.id) {
                return Err(SessionError::Duplicate("device id"));
            }
            if !matches!(
                device.kind.as_str(),
                "uart16550"
                    | "clint"
                    | "plic"
                    | "goldfish-rtc"
                    | "virtio-blk"
                    | "virtio-net"
                    | "virtio-rng"
                    | "virtio-keyboard"
                    | "virtio-tablet"
                    | "virtio-mouse"
                    | "virtio-snd"
                    | "virtio-gpu2d"
                    | "virtio-gpu3d"
                    | "virtio-console"
            ) {
                return Err(SessionError::UnsupportedRequired(device.kind.clone()));
            }
            has_gpu |= device.kind == "virtio-gpu3d";
            let end = device
                .mmio_base
                .0
                .checked_add(u64::from(device.mmio_length))
                .ok_or(SessionError::Overflow)?;
            if device.mmio_length == 0 || device.irq > 1023 || device.state_version != 1 {
                return Err(SessionError::Invalid("device shape"));
            }
            ranges.push((device.mmio_base.0, end));
        }
        ranges.sort_unstable();
        if ranges.windows(2).any(|w| w[0].1 > w[1].0) {
            return Err(SessionError::Invalid("overlapping devices"));
        }
        if has_gpu != self.machine.gpu.is_some() {
            return Err(SessionError::Invalid("GPU profile"));
        }
        let profile = if has_gpu {
            "rv64-linux-gpu-v1"
        } else {
            "rv64-linux-software-v1"
        };
        if self.policy.profile != profile || self.policy.boundary_version != 1 {
            return Err(SessionError::Invalid("replay profile"));
        }
        let clock = &self.policy.clock;
        if !(1..=1024).contains(&clock.divider)
            || clock.timebase_hz.0 != 10_000_000
            || !matches!(
                clock.interactive.as_deref(),
                None | Some("wall-on-keyboard" | "paced-on-keyboard")
            )
            || (clock.interactive.is_some() && (!has_gpu || clock.mode != ClockMode::Icount))
        {
            return Err(SessionError::Invalid("clock policy"));
        }
        unique_labels(&self.policy.required_inputs, 32, "capture inputs")?;
        for input in &self.policy.required_inputs {
            if !CAPTURE_INPUTS.contains(&input.as_str()) {
                return Err(SessionError::UnsupportedRequired(input.clone()));
            }
        }
        if self.policy.mode == RecordingMode::ExactReplay && self.policy.required_inputs.is_empty()
        {
            return Err(SessionError::Invalid("exact replay capture set"));
        }
        if self.policy.mode == RecordingMode::ExactReplay {
            let mut mandatory = alloc::vec!["lifecycle", "storage-control", "checkpoint-control"];
            for device in &self.machine.devices {
                mandatory.extend_from_slice(match device.kind.as_str() {
                    "uart16550" => &["uart"],
                    "clint" => &["timers"],
                    "goldfish-rtc" => &["rtc"],
                    "virtio-blk" => &["block-read", "block-write", "dma"],
                    "virtio-net" => &["network", "network-time", "dma"],
                    "virtio-rng" => &["entropy", "dma"],
                    "virtio-keyboard" => &["keyboard", "dma"],
                    "virtio-tablet" | "virtio-mouse" => &["pointer", "dma"],
                    "virtio-snd" => &["audio-playback", "dma"],
                    "virtio-gpu2d" => &["software-gpu", "display", "dma"],
                    "virtio-gpu3d" => &["gpu-results", "display", "dma"],
                    "virtio-console" => &["agent", "clipboard", "dma"],
                    _ => &[], // Topology kinds have already been validated above.
                });
            }
            if clock.mode != ClockMode::Icount || clock.interactive.is_some() {
                mandatory.push("mtime");
            }
            for input in mandatory {
                if !self
                    .policy
                    .required_inputs
                    .iter()
                    .any(|known| known == input)
                {
                    return Err(SessionError::MissingCapture(input.into()));
                }
            }
        }
        if self.extensions.len() > 16 {
            return Err(SessionError::TooLarge("extensions"));
        }
        let mut extensions = BTreeSet::new();
        for extension in &self.extensions {
            label(&extension.kind, 64, "extension kind")?;
            if !extensions.insert(&extension.kind) {
                return Err(SessionError::Duplicate("extension kind"));
            }
            if extension.bytes.len() > 8192 {
                return Err(SessionError::TooLarge("extension bytes"));
            }
            if extension.required {
                return Err(SessionError::UnsupportedRequired(extension.kind.clone()));
            }
        }
        if self.assets.len() > 16 {
            return Err(SessionError::TooLarge("runtime assets"));
        }
        let mut roles = BTreeSet::new();
        for asset in &self.assets {
            label(&asset.role, 64, "asset role")?;
            if !matches!(
                asset.role.as_str(),
                "vm" | "wasm" | "kernel" | "base" | "initramfs" | "gpu-renderer" | "gpu-pair"
            ) {
                return Err(SessionError::UnsupportedRequired(asset.role.clone()));
            }
            if !roles.insert(asset.role.as_str()) {
                return Err(SessionError::Duplicate("asset role"));
            }
            asset.content.validate()?;
        }
        for (role, hash) in [
            ("vm", Some(self.machine.vm_build)),
            ("wasm", Some(self.machine.wasm_build)),
            ("kernel", Some(self.machine.kernel)),
            ("base", Some(self.machine.base_image)),
            ("initramfs", self.machine.initramfs),
            (
                "gpu-renderer",
                self.machine.gpu.as_ref().map(|g| g.renderer_build),
            ),
        ] {
            if let Some(hash) = hash {
                let asset = self
                    .assets
                    .iter()
                    .find(|a| a.role == role)
                    .ok_or(SessionError::MissingAsset(role))?;
                if asset.content.sha256 != hash {
                    return Err(SessionError::IdentityMismatch(role));
                }
            }
        }
        if self.events.len() > MAX_INDEX_ENTRIES
            || self.checkpoints.is_empty()
            || self.checkpoints.len() > MAX_INDEX_ENTRIES
        {
            return Err(SessionError::TooLarge("session index"));
        }
        if !self.begin.follows(Position::ZERO) || !self.end.follows(self.begin) {
            return Err(SessionError::IndexOrder);
        }
        // Retention may start at a late keyframe without resetting its original counters.
        let mut sequence = self.begin.sequence.0;
        let mut previous = self.begin;
        let mut total = 0u64;
        for chunk in &self.events {
            chunk.content.validate()?;
            if chunk.count == 0
                || chunk.count > MAX_EVENTS_PER_CHUNK
                || chunk.content.length.0 > MAX_CHUNK_BYTES
            {
                return Err(SessionError::Invalid("event chunk shape"));
            }
            let first = sequence.checked_add(1).ok_or(SessionError::Overflow)?;
            let last = first
                .checked_add(u64::from(chunk.count) - 1)
                .ok_or(SessionError::Overflow)?;
            if chunk.first.sequence.0 != first
                || chunk.last.sequence.0 != last
                || (chunk.count == 1 && chunk.first != chunk.last)
                || !chunk.first.follows(previous)
                || !chunk.last.follows(chunk.first)
                || !self.end.follows(chunk.last)
            {
                return Err(SessionError::IndexOrder);
            }
            total = total
                .checked_add(chunk.content.length.0)
                .ok_or(SessionError::Overflow)?;
            sequence = last;
            previous = chunk.last;
        }
        if self.end.sequence.0 != sequence
            || (self.policy.mode == RecordingMode::CheckpointsOnly && !self.events.is_empty())
        {
            return Err(SessionError::IndexOrder);
        }
        let mut checkpoint_ids = BTreeSet::new();
        previous = self.begin;
        for checkpoint in &self.checkpoints {
            label(&checkpoint.id, 64, "checkpoint id")?;
            if !checkpoint_ids.insert(&checkpoint.id) {
                return Err(SessionError::Duplicate("checkpoint id"));
            }
            checkpoint.machine.validate()?;
            if let Some(gpu) = &checkpoint.gpu {
                gpu.validate()?;
            }
            if checkpoint.gpu.is_some() != has_gpu {
                return Err(SessionError::Invalid("checkpoint GPU binding"));
            }
            let next = checkpoint
                .position
                .sequence
                .0
                .checked_add(1)
                .ok_or(SessionError::Overflow)?;
            if checkpoint.next_sequence.0 != next
                || !checkpoint.position.follows(previous)
                || !self.end.follows(checkpoint.position)
            {
                return Err(SessionError::IndexOrder);
            }
            total = total
                .checked_add(checkpoint.machine.length.0)
                .and_then(|n| n.checked_add(checkpoint.gpu.as_ref().map_or(0, |g| g.length.0)))
                .ok_or(SessionError::Overflow)?;
            previous = checkpoint.position;
        }
        if self.checkpoints[0].position != self.begin {
            return Err(SessionError::Invalid("initial checkpoint"));
        }
        if total > MAX_SESSION_BYTES {
            return Err(SessionError::TooLarge("session payload"));
        }
        Ok(())
    }

    /// Read-only compatibility; no attempt to migrate, clear or mutate the recording.
    pub fn admit(&self, runtime: &RuntimeDescriptor) -> Result<(), SessionError> {
        self.validate()?;
        let a = &self.machine;
        let b = &runtime.machine;
        for (name, equal) in [
            ("vm_build", a.vm_build == b.vm_build),
            ("wasm_build", a.wasm_build == b.wasm_build),
            ("base_image", a.base_image == b.base_image),
            ("kernel", a.kernel == b.kernel),
            ("initramfs", a.initramfs == b.initramfs),
            ("RAM", a.ram_bytes == b.ram_bytes),
            ("harts", a.harts == b.harts),
            ("devices", a.devices == b.devices),
            ("GPU", a.gpu == b.gpu),
        ] {
            if !equal {
                return Err(SessionError::IdentityMismatch(name));
            }
        }
        if self.policy != runtime.policy {
            return Err(SessionError::IdentityMismatch("replay policy"));
        }
        for input in &self.policy.required_inputs {
            if !runtime.captured_inputs.contains(input) {
                return Err(SessionError::MissingCapture(input.clone()));
            }
        }
        Ok(())
    }

    /// Resolve old builds only when their exact runtime and all verified asset bytes remain.
    pub fn availability(
        &self,
        runtimes: &[RuntimeDescriptor],
        assets: &[VerifiedAsset],
    ) -> Result<RuntimeAvailability, SessionError> {
        self.validate()?;
        let Some(runtime_index) = runtimes
            .iter()
            .position(|runtime| self.admit(runtime).is_ok())
        else {
            return Ok(RuntimeAvailability::UnavailableRuntime);
        };
        for asset in &self.assets {
            if !assets.iter().any(|available| available.0 == asset.content) {
                return Ok(RuntimeAvailability::UnavailableAsset {
                    sha256: asset.content.sha256,
                    length: asset.content.length,
                });
            }
        }
        Ok(RuntimeAvailability::Available { runtime_index })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "storage", rename_all = "lowercase", deny_unknown_fields)]
pub enum EventPayload {
    Inline { bytes: Vec<u8> },
    Blob { content: BlobRef },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventRecord {
    pub version: Version,
    pub kind: String,
    pub required: bool,
    pub transition: ExactU64,
    pub phase: Phase,
    pub ordinal: u32,
    pub sequence: ExactU64,
    pub retired: ExactU64,
    pub device: String,
    pub intent: Vec<u8>,
    pub status: String,
    pub payload: EventPayload,
}

impl EventRecord {
    pub fn position(&self) -> Position {
        Position {
            transition: self.transition,
            phase: self.phase,
            ordinal: self.ordinal,
            sequence: self.sequence,
            retired: self.retired,
        }
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, SessionError> {
        let record: Self = decode(bytes, MAX_EVENT_BYTES)?;
        record.validate()?;
        Ok(record)
    }
    pub fn to_bytes(&self) -> Result<Vec<u8>, SessionError> {
        self.validate()?;
        encode(self, MAX_EVENT_BYTES)
    }
    pub fn validate(&self) -> Result<(), SessionError> {
        self.version.validate("event")?;
        label(&self.kind, 64, "event kind")?;
        label(&self.device, 64, "event device")?;
        label(&self.status, 128, "event status")?;
        if self.sequence.0 == 0 || !self.position().follows(Position::ZERO) {
            return Err(SessionError::IndexOrder);
        }
        if self.intent.len() > 65_536 {
            return Err(SessionError::TooLarge("event intent"));
        }
        let known = matches!(
            self.kind.as_str(),
            "uart"
                | "keyboard"
                | "tablet"
                | "mouse"
                | "display"
                | "clock"
                | "rtc"
                | "entropy"
                | "block"
                | "network"
                | "agent"
                | "file-transfer"
                | "audio"
                | "gpu"
                | "lifecycle"
        );
        if !known && (self.required || !self.kind.starts_with("annotation.")) {
            return Err(SessionError::UnsupportedRequired(self.kind.clone()));
        }
        if known && !self.required {
            return Err(SessionError::Invalid("optional guest effect"));
        }
        match &self.payload {
            EventPayload::Inline { bytes } if bytes.len() > MAX_INLINE_BYTES => {
                return Err(SessionError::TooLarge("inline event"));
            }
            EventPayload::Blob { content } => {
                content.validate()?;
                if content.length.0 > MAX_CHUNK_BYTES {
                    return Err(SessionError::TooLarge("event blob"));
                }
            }
            _ => {}
        }
        Ok(())
    }
}

fn validate_records(records: &[EventRecord]) -> Result<(), SessionError> {
    if records.is_empty() || records.len() > MAX_EVENTS_PER_CHUNK as usize {
        return Err(SessionError::Invalid("event count"));
    }
    let mut previous: Option<Position> = None;
    for record in records {
        record.validate()?;
        if let Some(earlier) = previous {
            let next = earlier
                .sequence
                .0
                .checked_add(1)
                .ok_or(SessionError::Overflow)?;
            if record.sequence.0 != next || !record.position().follows(earlier) {
                return Err(SessionError::IndexOrder);
            }
        }
        previous = Some(record.position());
    }
    Ok(())
}

impl EventChunkIndex {
    /// Bound the output while writing: never serialize an arbitrarily large vector first.
    pub fn from_records(records: &[EventRecord]) -> Result<(Self, Vec<u8>), SessionError> {
        validate_records(records)?;
        let mut bytes = Vec::new();
        bytes.push(b'[');
        for (index, record) in records.iter().enumerate() {
            let encoded = record.to_bytes()?;
            if bytes
                .len()
                .checked_add(encoded.len())
                .and_then(|n| n.checked_add(2))
                .is_none_or(|n| n > MAX_CHUNK_BYTES as usize)
            {
                return Err(SessionError::TooLarge("event chunk"));
            }
            if index != 0 {
                bytes.push(b',');
            }
            bytes.extend_from_slice(&encoded);
        }
        bytes.push(b']');
        Ok((
            Self {
                first: records[0].position(),
                last: records[records.len() - 1].position(),
                count: records.len() as u32,
                content: BlobRef::of(&bytes),
            },
            bytes,
        ))
    }

    pub fn decode_records(&self, bytes: &[u8]) -> Result<Vec<EventRecord>, SessionError> {
        if self.count == 0
            || self.count > MAX_EVENTS_PER_CHUNK
            || self.content.length.0 > MAX_CHUNK_BYTES
        {
            return Err(SessionError::Invalid("event chunk shape"));
        }
        self.content.verify(bytes)?;
        let records: Vec<EventRecord> = decode(bytes, MAX_CHUNK_BYTES as usize)?;
        validate_records(&records)?;
        if records.len() != self.count as usize
            || records[0].position() != self.first
            || records[records.len() - 1].position() != self.last
        {
            return Err(SessionError::Invalid("event index differs from payload"));
        }
        Ok(records)
    }
}
