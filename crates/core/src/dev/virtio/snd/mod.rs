//! virtio-snd control plane and one paced playback stream (E5-T19a/E5-T19b).
//!
//! This module owns the guest-visible identity, configuration queries, PCM capability contract,
//! lifecycle validation, and clock-paced output path for the first stream. Event delivery and
//! malformed-queue hardening remain in T19c; guest integration remains in T19d. Wire helpers use
//! explicit little-endian encoding so native and wasm callers observe the same bytes.

use alloc::collections::VecDeque;
use alloc::rc::Rc;
use alloc::vec::Vec;
use core::cell::RefCell;

use super::VirtioDevice;
use super::mmio::VirtioMmio;
use super::queue::{DescriptorChain, Segment, Violation, Virtqueue};
use crate::bus::Bus;
use crate::mmio::SystemBus;

/// Virtio device id assigned to a sound device by virtio 1.2 §5.14.1.
pub const VIRTIO_SND_DEVICE_ID: u32 = 25;

/// Virtqueue indices from virtio 1.2 §5.14.2.
pub const CONTROL_QUEUE: u32 = 0;
pub const EVENT_QUEUE: u32 = 1;
pub const TX_QUEUE: u32 = 2;
pub const RX_QUEUE: u32 = 3;
pub const NUM_QUEUES: u32 = 4;

/// This first sound device exposes one output jack, one output stream, and one channel map.
pub const JACK_COUNT: u32 = 1;
pub const PCM_STREAM_COUNT: u32 = 1;
pub const CHMAP_COUNT: u32 = 1;
const CONFIG_SIZE: usize = 12;

/// virtio-snd control request codes.
pub const VIRTIO_SND_R_JACK_INFO: u32 = 0x0001;
pub const VIRTIO_SND_R_JACK_REMAP: u32 = 0x0002;
pub const VIRTIO_SND_R_PCM_INFO: u32 = 0x0100;
pub const VIRTIO_SND_R_PCM_SET_PARAMS: u32 = 0x0101;
pub const VIRTIO_SND_R_PCM_PREPARE: u32 = 0x0102;
pub const VIRTIO_SND_R_PCM_RELEASE: u32 = 0x0103;
pub const VIRTIO_SND_R_PCM_START: u32 = 0x0104;
pub const VIRTIO_SND_R_PCM_STOP: u32 = 0x0105;
pub const VIRTIO_SND_R_CHMAP_INFO: u32 = 0x0200;

/// virtio-snd control response status codes.
pub const VIRTIO_SND_S_OK: u32 = 0x8000;
pub const VIRTIO_SND_S_BAD_MSG: u32 = 0x8001;
pub const VIRTIO_SND_S_NOT_SUPP: u32 = 0x8002;
pub const VIRTIO_SND_S_IO_ERR: u32 = 0x8003;

/// Status values returned by the control-plane dispatcher.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum SndStatus {
    Ok = VIRTIO_SND_S_OK,
    BadMsg = VIRTIO_SND_S_BAD_MSG,
    NotSupp = VIRTIO_SND_S_NOT_SUPP,
    IoErr = VIRTIO_SND_S_IO_ERR,
}

impl SndStatus {
    /// Return the guest-visible little-endian status code.
    pub const fn code(self) -> u32 {
        self as u32
    }
}

/// Data-flow direction values from virtio-snd.
pub const VIRTIO_SND_D_OUTPUT: u8 = 0;
pub const VIRTIO_SND_D_INPUT: u8 = 1;

/// PCM feature bits. This device advertises none in T19a; event/XRUN support belongs to T19c.
pub const VIRTIO_SND_PCM_F_SHMEM_HOST: u32 = 1 << 0;
pub const VIRTIO_SND_PCM_F_SHMEM_GUEST: u32 = 1 << 1;
pub const VIRTIO_SND_PCM_F_MSG_POLLING: u32 = 1 << 2;
pub const VIRTIO_SND_PCM_F_EVT_SHMEM_PERIODS: u32 = 1 << 3;
pub const VIRTIO_SND_PCM_F_EVT_XRUNS: u32 = 1 << 4;

/// Supported PCM sample format and rate enum values from virtio-snd.
pub const VIRTIO_SND_PCM_FMT_S16: u8 = 5;
pub const VIRTIO_SND_PCM_RATE_44100: u8 = 6;
pub const VIRTIO_SND_PCM_RATE_48000: u8 = 7;
pub const VIRTIO_SND_PCM_RATE_96000: u8 = 10;

/// Standard stereo channel positions from virtio-snd §5.14.6.9.
pub const VIRTIO_SND_CHMAP_FL: u8 = 3;
pub const VIRTIO_SND_CHMAP_FR: u8 = 4;
pub const VIRTIO_SND_CHMAP_MAX_SIZE: usize = 18;

/// Fixed wire sizes of the T19a control structures.
pub const QUERY_INFO_SIZE: usize = 16;
pub const JACK_INFO_SIZE: usize = 24;
pub const PCM_INFO_SIZE: usize = 32;
pub const CHMAP_INFO_SIZE: usize = 24;
pub const PCM_HDR_SIZE: usize = 8;
pub const PCM_SET_PARAMS_SIZE: usize = 24;
/// The output-queue transfer header contains only the stream identifier.
pub const PCM_XFER_HDR_SIZE: usize = 4;
/// The device-written output-queue status is `{ status, latency_bytes }`.
pub const PCM_STATUS_SIZE: usize = 8;

/// One normalized stereo S16 frame is four bytes.
pub const PCM_FRAME_BYTES: u32 = 4;
/// The control contract refuses allocations larger than this bound in later queue slices.
pub const MAX_PCM_BUFFER_BYTES: u32 = 16 * 1024 * 1024;

/// A monotonic nanosecond source injected into the paced playback service.
pub trait AudioClock {
    /// Return the current monotonic time in nanoseconds.
    fn now_ns(&self) -> u64;
}

/// Deterministic, manually advanced clock for native fixtures and embedders.
#[derive(Debug, Default)]
pub struct ManualAudioClock {
    now_ns: core::cell::Cell<u64>,
}

impl ManualAudioClock {
    /// Construct a clock at time zero.
    pub const fn new() -> Self {
        Self {
            now_ns: core::cell::Cell::new(0),
        }
    }

    /// Set the monotonic time. Callers must not move it backwards.
    pub fn set_now_ns(&self, now_ns: u64) {
        self.now_ns.set(now_ns);
    }

    /// Advance the clock without wrapping.
    pub fn advance_ns(&self, delta_ns: u64) {
        self.set_now_ns(self.now_ns().saturating_add(delta_ns));
    }
}

impl AudioClock for ManualAudioClock {
    fn now_ns(&self) -> u64 {
        self.now_ns.get()
    }
}

/// Errors collapsed by the core's host-independent sink boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioSinkError {
    /// The sink could not accept the complete frame batch.
    Failed,
}

/// Host audio destination for one interleaved stereo S16 batch.
pub trait AudioSink {
    /// Consume `frames` at `sample_rate_hz`. The slice is interleaved left/right S16 samples.
    fn push(&mut self, frames: &[i16], sample_rate_hz: u32) -> Result<(), AudioSinkError>;
}

/// No-op sink used by default and by pacing-only callers.
#[derive(Debug, Default)]
pub struct NullSink {
    frames_pushed: u64,
    batches: u64,
}

impl NullSink {
    /// Construct an empty sink.
    pub const fn new() -> Self {
        Self {
            frames_pushed: 0,
            batches: 0,
        }
    }

    /// Number of stereo frames accepted so far.
    pub const fn frames_pushed(&self) -> u64 {
        self.frames_pushed
    }

    /// Number of batches accepted so far.
    pub const fn batches(&self) -> u64 {
        self.batches
    }
}

impl AudioSink for NullSink {
    fn push(&mut self, frames: &[i16], _sample_rate_hz: u32) -> Result<(), AudioSinkError> {
        if !frames.len().is_multiple_of(2) {
            return Err(AudioSinkError::Failed);
        }
        self.frames_pushed = self.frames_pushed.saturating_add((frames.len() / 2) as u64);
        self.batches = self.batches.saturating_add(1);
        Ok(())
    }
}

/// Native WAV sink for deterministic scratch-directory captures.
#[cfg(feature = "std")]
pub struct WavSink {
    file: std::fs::File,
    sample_rate_hz: u32,
    data_bytes: u64,
    finalized: bool,
    failed: bool,
}

#[cfg(feature = "std")]
impl WavSink {
    /// Create a PCM16 stereo WAV with a placeholder RIFF/data size.
    pub fn create(path: impl AsRef<std::path::Path>, sample_rate_hz: u32) -> std::io::Result<Self> {
        if sample_rate_hz == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "sample rate must be non-zero",
            ));
        }
        let mut file = std::fs::File::create(path)?;
        std::io::Write::write_all(&mut file, &wav_header(sample_rate_hz, 0, 0))?;
        Ok(Self {
            file,
            sample_rate_hz,
            data_bytes: 0,
            finalized: false,
            failed: false,
        })
    }

    /// Finalize RIFF/data lengths and flush the capture.
    pub fn finish(mut self) -> std::io::Result<()> {
        let result = self.finish_inner();
        self.finalized = true;
        result
    }

    /// Number of PCM data bytes written before finalization.
    pub const fn data_bytes(&self) -> u64 {
        self.data_bytes
    }

    fn finish_inner(&mut self) -> std::io::Result<()> {
        let data_bytes = u32::try_from(self.data_bytes).map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "WAV data exceeds RIFF size",
            )
        })?;
        let riff_bytes = 36u32.checked_add(data_bytes).ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "WAV RIFF size overflow")
        })?;
        std::io::Seek::seek(&mut self.file, std::io::SeekFrom::Start(4))?;
        std::io::Write::write_all(&mut self.file, &riff_bytes.to_le_bytes())?;
        std::io::Seek::seek(&mut self.file, std::io::SeekFrom::Start(40))?;
        std::io::Write::write_all(&mut self.file, &data_bytes.to_le_bytes())?;
        std::io::Write::flush(&mut self.file)
    }
}

#[cfg(feature = "std")]
impl AudioSink for WavSink {
    fn push(&mut self, frames: &[i16], sample_rate_hz: u32) -> Result<(), AudioSinkError> {
        if self.failed || sample_rate_hz != self.sample_rate_hz || !frames.len().is_multiple_of(2) {
            self.failed = true;
            return Err(AudioSinkError::Failed);
        }
        let byte_len = frames.len().checked_mul(2).ok_or(AudioSinkError::Failed)?;
        let new_total = self
            .data_bytes
            .checked_add(byte_len as u64)
            .filter(|bytes| u32::try_from(*bytes).is_ok());
        let Some(new_total) = new_total else {
            self.failed = true;
            return Err(AudioSinkError::Failed);
        };
        let mut bytes = Vec::with_capacity(byte_len);
        for sample in frames {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        if std::io::Write::write_all(&mut self.file, &bytes).is_err() {
            self.failed = true;
            return Err(AudioSinkError::Failed);
        }
        self.data_bytes = new_total;
        Ok(())
    }
}

#[cfg(feature = "std")]
impl Drop for WavSink {
    fn drop(&mut self) {
        if !self.finalized {
            let _ = self.finish_inner();
        }
    }
}

#[cfg(feature = "std")]
fn wav_header(sample_rate_hz: u32, riff_bytes: u32, data_bytes: u32) -> [u8; 44] {
    let mut header = [0u8; 44];
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&riff_bytes.to_le_bytes());
    header[8..12].copy_from_slice(b"WAVE");
    header[12..16].copy_from_slice(b"fmt ");
    header[16..20].copy_from_slice(&16u32.to_le_bytes());
    header[20..22].copy_from_slice(&1u16.to_le_bytes());
    header[22..24].copy_from_slice(&2u16.to_le_bytes());
    header[24..28].copy_from_slice(&sample_rate_hz.to_le_bytes());
    header[28..32].copy_from_slice(&(sample_rate_hz.saturating_mul(4)).to_le_bytes());
    header[32..34].copy_from_slice(&4u16.to_le_bytes());
    header[34..36].copy_from_slice(&16u16.to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    header
}

/// A virtio-snd item-information request, encoded as four little-endian u32 fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueryInfo {
    pub code: u32,
    pub start_id: u32,
    pub count: u32,
    pub size: u32,
}

impl QueryInfo {
    /// Encode the exact 16-byte request layout.
    pub fn to_bytes(self) -> [u8; QUERY_INFO_SIZE] {
        let mut out = [0u8; QUERY_INFO_SIZE];
        out[0..4].copy_from_slice(&self.code.to_le_bytes());
        out[4..8].copy_from_slice(&self.start_id.to_le_bytes());
        out[8..12].copy_from_slice(&self.count.to_le_bytes());
        out[12..16].copy_from_slice(&self.size.to_le_bytes());
        out
    }

    /// Decode a complete query request without reading beyond the provided bytes.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < QUERY_INFO_SIZE {
            return None;
        }
        Some(Self {
            code: read_u32(bytes, 0)?,
            start_id: read_u32(bytes, 4)?,
            count: read_u32(bytes, 8)?,
            size: read_u32(bytes, 12)?,
        })
    }
}

/// Information common to every returned sound item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SndInfo {
    pub hda_fn_nid: u32,
}

impl SndInfo {
    fn write_to(self, out: &mut [u8]) {
        out[0..4].copy_from_slice(&self.hda_fn_nid.to_le_bytes());
    }
}

/// One output jack information record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JackInfo {
    pub hda_fn_nid: u32,
    pub features: u32,
    pub hda_reg_defconf: u32,
    pub hda_reg_caps: u32,
    pub connected: u8,
}

impl JackInfo {
    /// The single connected output jack exposed by this device.
    pub const fn output() -> Self {
        Self {
            hda_fn_nid: 0,
            features: 0,
            hda_reg_defconf: 0,
            hda_reg_caps: 0,
            connected: 1,
        }
    }

    /// Encode the exact 24-byte `virtio_snd_jack_info` layout with zero padding.
    pub fn to_bytes(self) -> [u8; JACK_INFO_SIZE] {
        let mut out = [0u8; JACK_INFO_SIZE];
        SndInfo {
            hda_fn_nid: self.hda_fn_nid,
        }
        .write_to(&mut out);
        out[4..8].copy_from_slice(&self.features.to_le_bytes());
        out[8..12].copy_from_slice(&self.hda_reg_defconf.to_le_bytes());
        out[12..16].copy_from_slice(&self.hda_reg_caps.to_le_bytes());
        out[16] = self.connected;
        out
    }
}

/// One output PCM stream capability record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PcmInfo {
    pub hda_fn_nid: u32,
    pub features: u32,
    pub formats: u64,
    pub rates: u64,
    pub direction: u8,
    pub channels_min: u8,
    pub channels_max: u8,
}

impl PcmInfo {
    /// The one stereo S16 output stream, limited to 44.1 kHz and 48 kHz.
    pub const fn output() -> Self {
        Self {
            hda_fn_nid: 0,
            features: 0,
            formats: 1u64 << VIRTIO_SND_PCM_FMT_S16,
            rates: (1u64 << VIRTIO_SND_PCM_RATE_44100) | (1u64 << VIRTIO_SND_PCM_RATE_48000),
            direction: VIRTIO_SND_D_OUTPUT,
            channels_min: 2,
            channels_max: 2,
        }
    }

    /// Encode the exact 32-byte `virtio_snd_pcm_info` layout with zero padding.
    pub fn to_bytes(self) -> [u8; PCM_INFO_SIZE] {
        let mut out = [0u8; PCM_INFO_SIZE];
        SndInfo {
            hda_fn_nid: self.hda_fn_nid,
        }
        .write_to(&mut out);
        out[4..8].copy_from_slice(&self.features.to_le_bytes());
        out[8..16].copy_from_slice(&self.formats.to_le_bytes());
        out[16..24].copy_from_slice(&self.rates.to_le_bytes());
        out[24] = self.direction;
        out[25] = self.channels_min;
        out[26] = self.channels_max;
        out
    }
}

/// One stereo front-left/front-right channel map record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChmapInfo {
    pub hda_fn_nid: u32,
    pub direction: u8,
    pub channels: u8,
    pub positions: [u8; VIRTIO_SND_CHMAP_MAX_SIZE],
}

impl ChmapInfo {
    /// The one interleaved stereo output map.
    pub const fn output() -> Self {
        let mut positions = [0u8; VIRTIO_SND_CHMAP_MAX_SIZE];
        positions[0] = VIRTIO_SND_CHMAP_FL;
        positions[1] = VIRTIO_SND_CHMAP_FR;
        Self {
            hda_fn_nid: 0,
            direction: VIRTIO_SND_D_OUTPUT,
            channels: 2,
            positions,
        }
    }

    /// Encode the exact 24-byte `virtio_snd_chmap_info` layout.
    pub fn to_bytes(self) -> [u8; CHMAP_INFO_SIZE] {
        let mut out = [0u8; CHMAP_INFO_SIZE];
        SndInfo {
            hda_fn_nid: self.hda_fn_nid,
        }
        .write_to(&mut out);
        out[4] = self.direction;
        out[5] = self.channels;
        out[6..24].copy_from_slice(&self.positions);
        out
    }
}

/// A validated `R_PCM_SET_PARAMS` request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PcmParams {
    pub stream_id: u32,
    pub buffer_bytes: u32,
    pub period_bytes: u32,
    pub features: u32,
    pub channels: u8,
    pub format: u8,
    pub rate: u8,
    pub padding: u8,
}

impl Default for PcmParams {
    fn default() -> Self {
        Self {
            stream_id: 0,
            buffer_bytes: 64 * 1024,
            period_bytes: 4096,
            features: 0,
            channels: 2,
            format: VIRTIO_SND_PCM_FMT_S16,
            rate: VIRTIO_SND_PCM_RATE_48000,
            padding: 0,
        }
    }
}

impl PcmParams {
    /// Encode the exact 24-byte `virtio_snd_pcm_set_params` request layout.
    pub fn to_bytes(self) -> [u8; PCM_SET_PARAMS_SIZE] {
        let mut out = [0u8; PCM_SET_PARAMS_SIZE];
        out[0..4].copy_from_slice(&VIRTIO_SND_R_PCM_SET_PARAMS.to_le_bytes());
        out[4..8].copy_from_slice(&self.stream_id.to_le_bytes());
        out[8..12].copy_from_slice(&self.buffer_bytes.to_le_bytes());
        out[12..16].copy_from_slice(&self.period_bytes.to_le_bytes());
        out[16..20].copy_from_slice(&self.features.to_le_bytes());
        out[20] = self.channels;
        out[21] = self.format;
        out[22] = self.rate;
        out[23] = self.padding;
        out
    }

    /// Decode a complete set-parameters request without interpreting its values.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < PCM_SET_PARAMS_SIZE || read_u32(bytes, 0)? != VIRTIO_SND_R_PCM_SET_PARAMS {
            return None;
        }
        Some(Self {
            stream_id: read_u32(bytes, 4)?,
            buffer_bytes: read_u32(bytes, 8)?,
            period_bytes: read_u32(bytes, 12)?,
            features: read_u32(bytes, 16)?,
            channels: bytes[20],
            format: bytes[21],
            rate: bytes[22],
            padding: bytes[23],
        })
    }

    /// Validate every field against the single stream advertised by [`PcmInfo::output`].
    pub const fn is_valid(self) -> bool {
        self.stream_id == 0
            && self.buffer_bytes >= PCM_FRAME_BYTES
            && self.buffer_bytes <= MAX_PCM_BUFFER_BYTES
            && self.period_bytes >= PCM_FRAME_BYTES
            && self.period_bytes <= self.buffer_bytes
            && self.buffer_bytes.is_multiple_of(PCM_FRAME_BYTES)
            && self.period_bytes.is_multiple_of(PCM_FRAME_BYTES)
            && self.buffer_bytes.is_multiple_of(self.period_bytes)
            && self.features == 0
            && self.channels == 2
            && self.format == VIRTIO_SND_PCM_FMT_S16
            && matches!(
                self.rate,
                VIRTIO_SND_PCM_RATE_44100 | VIRTIO_SND_PCM_RATE_48000
            )
            && self.padding == 0
    }

    /// Convert the virtio enum to the host-independent sample rate used by the clock and sink.
    pub const fn sample_rate_hz(self) -> Option<u32> {
        match self.rate {
            VIRTIO_SND_PCM_RATE_44100 => Some(44_100),
            VIRTIO_SND_PCM_RATE_48000 => Some(48_000),
            _ => None,
        }
    }
}

/// One output-queue transfer header: a stream identifier in little-endian order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PcmXfer {
    pub stream_id: u32,
}

impl PcmXfer {
    /// Encode the exact `virtio_snd_pcm_xfer` header.
    pub fn to_bytes(self) -> [u8; PCM_XFER_HDR_SIZE] {
        self.stream_id.to_le_bytes()
    }

    /// Decode a complete transfer header.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        Some(Self {
            stream_id: read_u32(bytes, 0)?,
        })
    }
}

/// One output-queue completion status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PcmStatus {
    pub status: SndStatus,
    pub latency_bytes: u32,
}

impl PcmStatus {
    /// Encode the exact `virtio_snd_pcm_status` layout.
    pub fn to_bytes(self) -> [u8; PCM_STATUS_SIZE] {
        let mut out = [0u8; PCM_STATUS_SIZE];
        out[0..4].copy_from_slice(&self.status.code().to_le_bytes());
        out[4..8].copy_from_slice(&self.latency_bytes.to_le_bytes());
        out
    }

    /// Decode a complete output-queue completion status.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        let status = match read_u32(bytes, 0)? {
            VIRTIO_SND_S_OK => SndStatus::Ok,
            VIRTIO_SND_S_BAD_MSG => SndStatus::BadMsg,
            VIRTIO_SND_S_NOT_SUPP => SndStatus::NotSupp,
            VIRTIO_SND_S_IO_ERR => SndStatus::IoErr,
            _ => return None,
        };
        Some(Self {
            status,
            latency_bytes: read_u32(bytes, 4)?,
        })
    }
}

/// Result of one paced playback service boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PlaybackReport {
    /// Number of well-formed transfers moved into the pacing queue.
    pub queued: u32,
    /// Number of descriptors published to the used ring.
    pub completed: u32,
    /// Number of malformed transfers completed with `IO_ERR`.
    pub errors: u32,
    /// Stereo frames delivered successfully to the sink at this boundary.
    pub frames_pushed: u64,
    /// `latency_bytes` from the last completion, or current pending latency when idle.
    pub latency_bytes: u32,
    /// Bytes still waiting for the audio clock after this boundary.
    pub pending_bytes: u32,
    /// Deadline of the first pending transfer, if any.
    pub next_deadline_ns: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingPcm {
    head: u16,
    frames: Vec<i16>,
    status_segments: Vec<Segment>,
    sample_rate_hz: u32,
    duration_ns: u64,
    deadline_ns: u64,
}

#[derive(Debug, Default)]
struct PlaybackQueue {
    pending: VecDeque<PendingPcm>,
    observed_epoch: u64,
    release_pending: bool,
}

impl PlaybackQueue {
    fn pending_bytes(&self) -> u32 {
        self.pending.iter().fold(0u32, |total, transfer| {
            total.saturating_add((transfer.frames.len() as u32).saturating_mul(2))
        })
    }

    fn reschedule(&mut self, now_ns: u64) {
        let mut deadline = now_ns;
        for transfer in &mut self.pending {
            deadline = deadline.saturating_add(transfer.duration_ns);
            transfer.deadline_ns = deadline;
        }
    }

    fn clear_schedule(&mut self) {
        for transfer in &mut self.pending {
            transfer.deadline_ns = u64::MAX;
        }
    }
}

/// The five observable states of the one output PCM stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum PcmState {
    #[default]
    Released = 0,
    SetParams = 1,
    Prepared = 2,
    Running = 3,
    Stopped = 4,
}

impl PcmState {
    const fn index(self) -> usize {
        self as usize
    }
}

/// The six state-sensitive control requests used by the exhaustive T19a oracle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PcmControl {
    Info,
    SetParams,
    Prepare,
    Start,
    Stop,
    Release,
}

impl PcmControl {
    const fn index(self) -> usize {
        match self {
            Self::Info => 0,
            Self::SetParams => 1,
            Self::Prepare => 2,
            Self::Start => 3,
            Self::Stop => 4,
            Self::Release => 5,
        }
    }

    /// Request order used by [`PCM_TRANSITION_ORACLE`].
    pub const fn all() -> [Self; PCM_CONTROL_COUNT] {
        [
            Self::Info,
            Self::SetParams,
            Self::Prepare,
            Self::Start,
            Self::Stop,
            Self::Release,
        ]
    }

    /// Map a wire request code to a state-sensitive control request.
    pub const fn from_code(code: u32) -> Option<Self> {
        match code {
            VIRTIO_SND_R_PCM_INFO => Some(Self::Info),
            VIRTIO_SND_R_PCM_SET_PARAMS => Some(Self::SetParams),
            VIRTIO_SND_R_PCM_PREPARE => Some(Self::Prepare),
            VIRTIO_SND_R_PCM_START => Some(Self::Start),
            VIRTIO_SND_R_PCM_STOP => Some(Self::Stop),
            VIRTIO_SND_R_PCM_RELEASE => Some(Self::Release),
            _ => None,
        }
    }
}

pub const PCM_STATE_COUNT: usize = 5;
pub const PCM_CONTROL_COUNT: usize = 6;

/// The checked-in status oracle, in state order Released, SetParams, Prepared, Running, Stopped
/// and request order Info, SetParams, Prepare, Start, Stop, Release.
pub const PCM_TRANSITION_ORACLE: [[SndStatus; PCM_CONTROL_COUNT]; PCM_STATE_COUNT] = [
    [
        SndStatus::Ok,
        SndStatus::Ok,
        SndStatus::BadMsg,
        SndStatus::BadMsg,
        SndStatus::BadMsg,
        SndStatus::BadMsg,
    ],
    [
        SndStatus::Ok,
        SndStatus::BadMsg,
        SndStatus::Ok,
        SndStatus::BadMsg,
        SndStatus::BadMsg,
        SndStatus::BadMsg,
    ],
    [
        SndStatus::Ok,
        SndStatus::BadMsg,
        SndStatus::BadMsg,
        SndStatus::Ok,
        SndStatus::BadMsg,
        SndStatus::Ok,
    ],
    [
        SndStatus::Ok,
        SndStatus::BadMsg,
        SndStatus::BadMsg,
        SndStatus::BadMsg,
        SndStatus::Ok,
        SndStatus::BadMsg,
    ],
    [
        SndStatus::Ok,
        SndStatus::BadMsg,
        SndStatus::BadMsg,
        SndStatus::Ok,
        SndStatus::BadMsg,
        SndStatus::Ok,
    ],
];

/// Alias used by fixtures that refer to the table simply as the transition oracle.
pub const TRANSITION_ORACLE: [[SndStatus; PCM_CONTROL_COUNT]; PCM_STATE_COUNT] =
    PCM_TRANSITION_ORACLE;

/// Result of asking the state machine about one lifecycle request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PcmTransition {
    pub status: SndStatus,
    pub next: PcmState,
}

/// Look up one cell of the explicit state-machine contract.
pub const fn transition(state: PcmState, request: PcmControl) -> PcmTransition {
    let status = PCM_TRANSITION_ORACLE[state.index()][request.index()];
    let next = match (state, request) {
        (PcmState::Released, PcmControl::SetParams) => PcmState::SetParams,
        (PcmState::SetParams, PcmControl::Prepare) => PcmState::Prepared,
        (PcmState::Prepared, PcmControl::Start) => PcmState::Running,
        (PcmState::Prepared, PcmControl::Release) => PcmState::Released,
        (PcmState::Running, PcmControl::Stop) => PcmState::Stopped,
        (PcmState::Stopped, PcmControl::Start) => PcmState::Running,
        (PcmState::Stopped, PcmControl::Release) => PcmState::Released,
        _ => state,
    };
    PcmTransition { status, next }
}

/// The mutable state for one output PCM stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PcmStream {
    state: PcmState,
    params: Option<PcmParams>,
}

impl Default for PcmStream {
    fn default() -> Self {
        Self {
            state: PcmState::Released,
            params: None,
        }
    }
}

impl PcmStream {
    /// Current lifecycle state.
    pub const fn state(&self) -> PcmState {
        self.state
    }

    /// Current parameters, present only after a successful SET_PARAMS and before RELEASE.
    pub const fn params(&self) -> Option<PcmParams> {
        self.params
    }

    /// Apply a validated SET_PARAMS request without mutating state on rejection.
    pub fn set_params(&mut self, params: PcmParams) -> SndStatus {
        let result = transition(self.state, PcmControl::SetParams);
        if result.status != SndStatus::Ok || !params.is_valid() {
            return SndStatus::BadMsg;
        }
        self.params = Some(params);
        self.state = result.next;
        SndStatus::Ok
    }

    /// Apply one non-payload lifecycle request and preserve state on rejection.
    pub fn apply(&mut self, request: PcmControl) -> SndStatus {
        let result = transition(self.state, request);
        if result.status != SndStatus::Ok {
            return result.status;
        }
        self.state = result.next;
        if request == PcmControl::Release {
            self.params = None;
        }
        result.status
    }

    /// Reset the stream to its power-on state.
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

/// Shared sound state between the transport-facing half and later queue services.
pub struct SndState {
    pub stream: PcmStream,
    kicked: [bool; NUM_QUEUES as usize],
    reset_pending: bool,
    lifecycle_epoch: u64,
    playback: PlaybackQueue,
}

impl Default for SndState {
    fn default() -> Self {
        Self {
            stream: PcmStream::default(),
            kicked: [false; NUM_QUEUES as usize],
            reset_pending: false,
            lifecycle_epoch: 0,
            playback: PlaybackQueue::default(),
        }
    }
}

impl SndState {
    /// Construct a reset sound state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Dispatch a logical control request and return a status header plus any info payload.
    pub fn handle_control(&mut self, request: &[u8]) -> Vec<u8> {
        let Some(code) = read_u32(request, 0) else {
            return response(SndStatus::BadMsg, &[]);
        };
        match code {
            VIRTIO_SND_R_JACK_INFO => self.handle_query(
                request,
                VIRTIO_SND_R_JACK_INFO,
                JACK_INFO_SIZE,
                &JackInfo::output().to_bytes(),
            ),
            VIRTIO_SND_R_PCM_INFO => self.handle_query(
                request,
                VIRTIO_SND_R_PCM_INFO,
                PCM_INFO_SIZE,
                &PcmInfo::output().to_bytes(),
            ),
            VIRTIO_SND_R_CHMAP_INFO => self.handle_query(
                request,
                VIRTIO_SND_R_CHMAP_INFO,
                CHMAP_INFO_SIZE,
                &ChmapInfo::output().to_bytes(),
            ),
            VIRTIO_SND_R_PCM_SET_PARAMS => {
                if request.len() != PCM_SET_PARAMS_SIZE {
                    return response(SndStatus::BadMsg, &[]);
                }
                let Some(params) = PcmParams::from_bytes(request) else {
                    return response(SndStatus::BadMsg, &[]);
                };
                if !self.playback.pending.is_empty() {
                    return response(SndStatus::BadMsg, &[]);
                }
                response(
                    self.apply_stream_control(PcmControl::SetParams, Some(params)),
                    &[],
                )
            }
            VIRTIO_SND_R_PCM_PREPARE
            | VIRTIO_SND_R_PCM_START
            | VIRTIO_SND_R_PCM_STOP
            | VIRTIO_SND_R_PCM_RELEASE => self.handle_pcm_lifecycle(request, code),
            VIRTIO_SND_R_JACK_REMAP => response(SndStatus::NotSupp, &[]),
            _ => response(SndStatus::NotSupp, &[]),
        }
    }

    fn handle_query(&self, request: &[u8], code: u32, item_size: usize, payload: &[u8]) -> Vec<u8> {
        let valid = request.len() == QUERY_INFO_SIZE
            && QueryInfo::from_bytes(request).is_some_and(|query| {
                query.code == code
                    && query.start_id == 0
                    && query.count == 1
                    && query.size == item_size as u32
            });
        if valid {
            response(SndStatus::Ok, payload)
        } else {
            response(SndStatus::BadMsg, &[])
        }
    }

    fn handle_pcm_lifecycle(&mut self, request: &[u8], code: u32) -> Vec<u8> {
        if request.len() != PCM_HDR_SIZE
            || read_u32(request, 0) != Some(code)
            || read_u32(request, 4) != Some(0)
        {
            return response(SndStatus::BadMsg, &[]);
        }
        let Some(control) = PcmControl::from_code(code) else {
            return response(SndStatus::NotSupp, &[]);
        };
        response(self.apply_stream_control(control, None), &[])
    }

    fn apply_stream_control(
        &mut self,
        control: PcmControl,
        params: Option<PcmParams>,
    ) -> SndStatus {
        let status = match (control, params) {
            (PcmControl::SetParams, Some(params)) => self.stream.set_params(params),
            (PcmControl::SetParams, None) => SndStatus::BadMsg,
            (_, Some(_)) => SndStatus::BadMsg,
            (control, None) => self.stream.apply(control),
        };
        if status == SndStatus::Ok && control != PcmControl::Info {
            self.lifecycle_epoch = self.lifecycle_epoch.wrapping_add(1);
            if control == PcmControl::Release {
                self.playback.release_pending = true;
            }
        }
        status
    }

    /// Number of output transfers held for clock-paced completion.
    pub fn playback_pending_count(&self) -> usize {
        self.playback.pending.len()
    }

    /// Service one txq boundary using an injected clock and sink.
    ///
    /// Available transfers are copied out of guest RAM and retained until their individual audio
    /// deadlines. Completion writes one `PcmStatus` to the writable tail and publishes exactly one
    /// used-ring entry. The queue is capped at its ring size while a clock is held still, so a
    /// hostile producer cannot grow host memory without bound before T19c's queue hardening.
    pub fn service_playback(
        &mut self,
        queue: &mut Virtqueue,
        bus: &mut SystemBus,
        clock: &dyn AudioClock,
        sink: &mut dyn AudioSink,
    ) -> Result<PlaybackReport, Violation> {
        let now_ns = clock.now_ns();
        self.sync_playback_lifecycle(now_ns);
        let mut report = PlaybackReport::default();

        if self.playback.release_pending {
            self.flush_released(queue, bus, &mut report)?;
            self.playback.release_pending = false;
        }

        if self.stream.state() == PcmState::Running {
            let Some(params) = self.stream.params() else {
                return Ok(self.finish_report(report));
            };
            let Some(sample_rate_hz) = params.sample_rate_hz() else {
                return Ok(self.finish_report(report));
            };

            self.complete_ready(queue, bus, now_ns, sink, &mut report)?;
            while self.playback.pending.len() < usize::from(queue.size()) {
                let Some(chain) = queue.pop(bus)? else {
                    break;
                };
                match self.decode_transfer(&chain, bus, params, sample_rate_hz, now_ns)? {
                    Ok(transfer) => {
                        self.playback.pending.push_back(transfer);
                        report.queued = report.queued.saturating_add(1);
                    }
                    Err(status_segments) => {
                        let written = write_pcm_status(
                            bus,
                            &status_segments,
                            PcmStatus {
                                status: SndStatus::IoErr,
                                latency_bytes: self.playback.pending_bytes(),
                            },
                        )?;
                        queue.push_used(bus, chain.head, written)?;
                        report.completed = report.completed.saturating_add(1);
                        report.errors = report.errors.saturating_add(1);
                    }
                }
            }
            self.complete_ready(queue, bus, now_ns, sink, &mut report)?;
        }

        Ok(self.finish_report(report))
    }

    fn sync_playback_lifecycle(&mut self, now_ns: u64) {
        if self.playback.observed_epoch == self.lifecycle_epoch {
            return;
        }
        self.playback.observed_epoch = self.lifecycle_epoch;
        match self.stream.state() {
            PcmState::Running => self.playback.reschedule(now_ns),
            PcmState::Stopped => self.playback.clear_schedule(),
            PcmState::Released | PcmState::SetParams | PcmState::Prepared => {
                self.playback.clear_schedule()
            }
        }
    }

    fn decode_transfer(
        &self,
        chain: &DescriptorChain,
        bus: &mut SystemBus,
        params: PcmParams,
        sample_rate_hz: u32,
        now_ns: u64,
    ) -> Result<Result<PendingPcm, Vec<Segment>>, Violation> {
        let status_segments: Vec<Segment> = chain.writable().copied().collect();
        if chain.writable_len() < PCM_STATUS_SIZE as u64 {
            return Ok(Err(status_segments));
        }

        let mut readable = Vec::new();
        for segment in chain.readable() {
            for offset in 0..u64::from(segment.len) {
                let address = segment
                    .addr
                    .checked_add(offset)
                    .ok_or(Violation::BadAddress)?;
                readable.push(bus.load8(address).map_err(|_| Violation::BadAddress)?);
            }
        }
        let Some(xfer) = PcmXfer::from_bytes(&readable) else {
            return Ok(Err(status_segments));
        };
        let pcm = readable
            .get(PCM_XFER_HDR_SIZE..)
            .ok_or(Violation::BadAddress)?;
        let pcm_bytes = u32::try_from(pcm.len()).map_err(|_| Violation::BadAddress)?;
        if xfer.stream_id != 0
            || pcm.is_empty()
            || !pcm_bytes.is_multiple_of(PCM_FRAME_BYTES)
            || pcm_bytes > params.buffer_bytes
        {
            return Ok(Err(status_segments));
        }

        let mut frames = Vec::with_capacity(pcm.len() / 2);
        for sample in pcm.chunks_exact(2) {
            frames.push(i16::from_le_bytes([sample[0], sample[1]]));
        }
        let frame_count = frames.len() / 2;
        let duration_ns = frame_duration_ns(frame_count, sample_rate_hz);
        let deadline_ns = self
            .playback
            .pending
            .back()
            .map(|last| last.deadline_ns.saturating_add(last.duration_ns))
            .unwrap_or_else(|| now_ns.saturating_add(duration_ns));
        Ok(Ok(PendingPcm {
            head: chain.head,
            frames,
            status_segments,
            sample_rate_hz,
            duration_ns,
            deadline_ns,
        }))
    }

    fn complete_ready(
        &mut self,
        queue: &mut Virtqueue,
        bus: &mut SystemBus,
        now_ns: u64,
        sink: &mut dyn AudioSink,
        report: &mut PlaybackReport,
    ) -> Result<(), Violation> {
        loop {
            let ready = self
                .playback
                .pending
                .front()
                .is_some_and(|transfer| transfer.deadline_ns <= now_ns);
            if !ready {
                break;
            }
            let transfer = self.playback.pending.pop_front().expect("checked above");
            let pushed = sink.push(&transfer.frames, transfer.sample_rate_hz).is_ok();
            let status = if pushed {
                report.frames_pushed = report
                    .frames_pushed
                    .saturating_add((transfer.frames.len() / 2) as u64);
                SndStatus::Ok
            } else {
                report.errors = report.errors.saturating_add(1);
                SndStatus::IoErr
            };
            let latency_bytes = self.playback.pending_bytes();
            let written = write_pcm_status(
                bus,
                &transfer.status_segments,
                PcmStatus {
                    status,
                    latency_bytes,
                },
            )?;
            queue.push_used(bus, transfer.head, written)?;
            report.completed = report.completed.saturating_add(1);
        }
        Ok(())
    }

    fn flush_released(
        &mut self,
        queue: &mut Virtqueue,
        bus: &mut SystemBus,
        report: &mut PlaybackReport,
    ) -> Result<(), Violation> {
        while let Some(transfer) = self.playback.pending.pop_front() {
            let written = write_pcm_status(
                bus,
                &transfer.status_segments,
                PcmStatus {
                    status: SndStatus::IoErr,
                    latency_bytes: self.playback.pending_bytes(),
                },
            )?;
            queue.push_used(bus, transfer.head, written)?;
            report.completed = report.completed.saturating_add(1);
            report.errors = report.errors.saturating_add(1);
        }
        Ok(())
    }

    fn finish_report(&self, mut report: PlaybackReport) -> PlaybackReport {
        report.pending_bytes = self.playback.pending_bytes();
        report.latency_bytes = report.pending_bytes;
        report.next_deadline_ns = self
            .playback
            .pending
            .front()
            .map(|transfer| transfer.deadline_ns);
        report
    }

    /// Mark a queue kick for later service at a free bus boundary.
    pub fn mark_queue_kick(&mut self, queue: u32) {
        if let Some(kicked) = self.kicked.get_mut(queue as usize) {
            *kicked = true;
        }
    }

    /// Consume one deferred queue-kick flag.
    pub fn take_queue_kick(&mut self, queue: u32) -> bool {
        let Some(kicked) = self.kicked.get_mut(queue as usize) else {
            return false;
        };
        let was_kicked = *kicked;
        *kicked = false;
        was_kicked
    }

    /// Consume the reset marker so a later queue service can drop stale ring views.
    pub fn take_reset_pending(&mut self) -> bool {
        let pending = self.reset_pending;
        self.reset_pending = false;
        pending
    }

    /// Reset stream and deferred transport state.
    pub fn reset(&mut self) {
        self.stream.reset();
        self.kicked = [false; NUM_QUEUES as usize];
        self.reset_pending = true;
        self.lifecycle_epoch = 0;
        self.playback = PlaybackQueue::default();
    }
}

/// Transport-facing virtio-snd device. Event delivery and guest integration are later slices.
pub struct VirtioSnd {
    state: Rc<RefCell<SndState>>,
}

impl VirtioSnd {
    /// Construct the default one-jack, one-output-stream device.
    pub fn new() -> Self {
        Self::new_with_state().0
    }

    /// Construct the transport device and a shared state handle for queue services.
    pub fn new_with_state() -> (Self, Rc<RefCell<SndState>>) {
        let state = Rc::new(RefCell::new(SndState::new()));
        (
            Self {
                state: Rc::clone(&state),
            },
            state,
        )
    }

    /// Shared state handle for the ordered playback/event slices.
    pub fn state_handle(&self) -> Rc<RefCell<SndState>> {
        Rc::clone(&self.state)
    }

    /// Dispatch one guest control request and return its complete response bytes.
    pub fn handle_control(&mut self, request: &[u8]) -> Vec<u8> {
        self.state.borrow_mut().handle_control(request)
    }

    /// Alias for callers that model the control queue as a direct request/response operation.
    pub fn control(&mut self, request: &[u8]) -> Vec<u8> {
        self.handle_control(request)
    }

    /// Current stream state snapshot.
    pub fn stream_state(&self) -> PcmState {
        self.state.borrow().stream.state()
    }

    /// Current stream parameters snapshot.
    pub fn stream_params(&self) -> Option<PcmParams> {
        self.state.borrow().stream.params()
    }

    fn config_bytes() -> [u8; CONFIG_SIZE] {
        let mut out = [0u8; CONFIG_SIZE];
        out[0..4].copy_from_slice(&JACK_COUNT.to_le_bytes());
        out[4..8].copy_from_slice(&PCM_STREAM_COUNT.to_le_bytes());
        out[8..12].copy_from_slice(&CHMAP_COUNT.to_le_bytes());
        out
    }
}

impl Default for VirtioSnd {
    fn default() -> Self {
        Self::new()
    }
}

/// Create the transport device and its shared queue-service state.
pub fn new() -> (VirtioSnd, Rc<RefCell<SndState>>) {
    VirtioSnd::new_with_state()
}

impl VirtioDevice for VirtioSnd {
    fn device_id(&self) -> u32 {
        VIRTIO_SND_DEVICE_ID
    }

    fn num_queues(&self) -> u32 {
        NUM_QUEUES
    }

    fn queue_notify(&mut self, queue: u32) {
        self.state.borrow_mut().mark_queue_kick(queue);
    }

    fn config_read(&mut self, offset: u64, width: u8) -> u64 {
        let bytes = Self::config_bytes();
        let mut value = 0u64;
        for byte_index in 0..usize::from(width.min(8)) {
            let Some(index) = offset
                .checked_add(byte_index as u64)
                .and_then(|index| usize::try_from(index).ok())
            else {
                continue;
            };
            if let Some(byte) = bytes.get(index) {
                value |= u64::from(*byte) << (byte_index * 8);
            }
        }
        value
    }

    fn reset(&mut self) {
        self.state.borrow_mut().reset();
    }
}

/// Run-loop service for the playback txq. The caller supplies the clock and sink, so the core
/// remains deterministic and browser/OS audio policy stays outside the device implementation.
pub fn service(
    slot: &Rc<RefCell<VirtioMmio>>,
    tx_vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<SndState>>,
    clock: &dyn AudioClock,
    sink: &mut dyn AudioSink,
    bus: &mut SystemBus,
) -> PlaybackReport {
    let (reset, kicked, active) = {
        let mut state = state.borrow_mut();
        let reset = state.take_reset_pending();
        let kicked = state.take_queue_kick(TX_QUEUE);
        let active = state.stream.state() == PcmState::Running
            || !state.playback.pending.is_empty()
            || state.playback.release_pending;
        (reset, kicked, active)
    };
    if reset {
        *tx_vq = None;
    }
    if !kicked && !active {
        return PlaybackReport::default();
    }

    let queue_state = *slot.borrow().queue(TX_QUEUE as usize);
    if !queue_state.ready {
        *tx_vq = None;
        return PlaybackReport::default();
    }
    if tx_vq.is_none() {
        match Virtqueue::new(&queue_state, 256) {
            Ok(queue) => *tx_vq = Some(queue),
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                return PlaybackReport::default();
            }
        }
    }

    let result = state.borrow_mut().service_playback(
        tx_vq.as_mut().expect("just constructed"),
        bus,
        clock,
        sink,
    );
    let Ok(report) = result else {
        slot.borrow_mut().protocol_violation();
        *tx_vq = None;
        return PlaybackReport::default();
    };
    if report.completed != 0
        && tx_vq
            .as_ref()
            .is_some_and(|queue| queue.interrupt_needed(bus))
    {
        slot.borrow_mut().raise_used_irq();
    }
    report
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let end = offset.checked_add(4)?;
    Some(u32::from_le_bytes(bytes.get(offset..end)?.try_into().ok()?))
}

fn response(status: SndStatus, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + payload.len());
    out.extend_from_slice(&status.code().to_le_bytes());
    out.extend_from_slice(payload);
    out
}

fn frame_duration_ns(frame_count: usize, sample_rate_hz: u32) -> u64 {
    let numerator = (frame_count as u64).saturating_mul(1_000_000_000);
    numerator.saturating_add(u64::from(sample_rate_hz).saturating_sub(1))
        / u64::from(sample_rate_hz)
}

fn write_pcm_status(
    bus: &mut SystemBus,
    segments: &[Segment],
    status: PcmStatus,
) -> Result<u32, Violation> {
    if segments
        .iter()
        .map(|segment| u64::from(segment.len))
        .sum::<u64>()
        < PCM_STATUS_SIZE as u64
    {
        return Ok(0);
    }
    let bytes = status.to_bytes();
    let mut written = 0usize;
    for segment in segments {
        for offset in 0..u64::from(segment.len) {
            if written == bytes.len() {
                return Ok(written as u32);
            }
            let address = segment
                .addr
                .checked_add(offset)
                .ok_or(Violation::BadAddress)?;
            bus.store8(address, bytes[written])
                .map_err(|_| Violation::BadAddress)?;
            written += 1;
        }
    }
    Ok(written as u32)
}
