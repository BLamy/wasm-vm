//! Versioned virtio-snd checkpoint state.
//!
//! Host audio handles, descriptor chains, and shared-memory ring contents are deliberately not
//! part of this format.  A restore recreates the guest-visible stream configuration, drops those
//! ephemeral host buffers, and reports one bounded XRUN for every stream that was running when the
//! checkpoint was taken.

use alloc::collections::VecDeque;
use alloc::vec::Vec;

use super::{
    CAPTURE_STREAM_ID, EVENT_QUEUE, EventState, MAX_PCM_BUFFER_BYTES, MAX_PENDING_SND_EVENTS,
    PCM_FRAME_BYTES, PcmParams, PcmState, PlaybackQueue, SUPPORTED_CAPTURE_PCM_RATE_MASK,
    SUPPORTED_PCM_RATE_MASK, SndEvent, SndState, VIRTIO_SND_EVT_PCM_XRUN,
    VIRTIO_SND_PCM_RATE_48000,
};

const MAGIC: [u8; 8] = *b"WVSND001";
const VERSION: u16 = 1;
const HEADER_LEN: usize = 184;
#[cfg(test)]
const STREAM_BLOCK_LEN: usize = 28;
#[cfg(test)]
const PLAYBACK_QUEUE_LEN: usize = 40;
#[cfg(test)]
const CAPTURE_QUEUE_LEN: usize = 20;
const MAX_SNAPSHOT_PENDING_TRANSFERS: u32 = 4096;

#[cfg(test)]
const OUTPUT_STREAM_OFFSET: usize = 48;
#[cfg(test)]
const CAPTURE_STREAM_OFFSET: usize = OUTPUT_STREAM_OFFSET + STREAM_BLOCK_LEN;
#[cfg(test)]
const PLAYBACK_QUEUE_OFFSET: usize = CAPTURE_STREAM_OFFSET + STREAM_BLOCK_LEN;
#[cfg(test)]
const CAPTURE_QUEUE_OFFSET: usize = PLAYBACK_QUEUE_OFFSET + PLAYBACK_QUEUE_LEN;
#[cfg(test)]
const EVENT_COUNT_OFFSET: usize = CAPTURE_QUEUE_OFFSET + CAPTURE_QUEUE_LEN;
#[cfg(test)]
const DROPPED_XRUNS_OFFSET: usize = EVENT_COUNT_OFFSET + 4;
#[cfg(test)]
const KICKED_OFFSET: usize = DROPPED_XRUNS_OFFSET + 8;
#[cfg(test)]
const RESET_PENDING_OFFSET: usize = KICKED_OFFSET + 4;

/// Errors returned when a sound checkpoint is malformed or cannot be represented safely.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SndSnapshotError {
    /// The payload ended before a complete field or record was available.
    Truncated,
    /// The payload is not a virtio-snd snapshot.
    BadMagic,
    /// The payload version is newer than this decoder understands.
    UnsupportedVersion { found: u16, supported: u16 },
    /// Reserved header flags were set.
    ReservedFlags { found: u16 },
    /// A reserved byte or word was non-zero.
    ReservedBytes { field: &'static str, found: u32 },
    /// A boolean field contained a value other than zero or one.
    InvalidBoolean { field: &'static str, value: u8 },
    /// A stream state byte is outside the five-state lifecycle enum.
    InvalidStreamState { stream: u32, state: u8 },
    /// A non-released stream omitted its parameter block.
    MissingParams { stream: u32 },
    /// A released stream carried a parameter block.
    UnexpectedParams { stream: u32 },
    /// A parameter block failed the same validation used by SET_PARAMS.
    InvalidParams { stream: u32 },
    /// The advertised rate mask is empty or contains an unsupported rate.
    InvalidRateMask { mask: u64 },
    /// A serialized queue contains more discarded transfers than the bounded decoder accepts.
    TooManyPendingTransfers {
        stream: u32,
        found: u32,
        maximum: u32,
    },
    /// Queue byte metadata is inconsistent with its transfer count or bound.
    InvalidPendingMetadata { stream: u32 },
    /// Restored events plus XRUN repair would exceed the bounded event queue.
    TooManyEvents { found: usize, maximum: usize },
    /// An event type or stream identifier is not supported by this format.
    InvalidEvent { event: SndEvent },
    /// Extra bytes followed the final event record.
    TrailingBytes,
    /// A count or encoded length could not fit the wire representation.
    LengthOverflow,
    /// The allocator rejected a bounded reservation.
    OutOfMemory,
}

impl SndSnapshotError {
    /// Stable machine-readable error code for logs and guest-facing diagnostics.
    pub const fn code(self) -> u16 {
        match self {
            Self::Truncated => 1,
            Self::BadMagic => 2,
            Self::UnsupportedVersion { .. } => 3,
            Self::ReservedFlags { .. } => 4,
            Self::ReservedBytes { .. } => 5,
            Self::InvalidBoolean { .. } => 6,
            Self::InvalidStreamState { .. } => 7,
            Self::MissingParams { .. } => 8,
            Self::UnexpectedParams { .. } => 9,
            Self::InvalidParams { .. } => 10,
            Self::InvalidRateMask { .. } => 11,
            Self::TooManyPendingTransfers { .. } => 12,
            Self::InvalidPendingMetadata { .. } => 13,
            Self::TooManyEvents { .. } => 14,
            Self::InvalidEvent { .. } => 15,
            Self::TrailingBytes => 16,
            Self::LengthOverflow => 17,
            Self::OutOfMemory => 18,
        }
    }
}

/// The observable effects of restoring a sound checkpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SndRestoreReport {
    /// Always true: host audio rings are intentionally ephemeral across a restore.
    pub host_audio_rings_discarded: bool,
    /// Number of output transfers described by the checkpoint and discarded on restore.
    pub discarded_playback_transfers: u32,
    /// Number of input transfers described by the checkpoint and discarded on restore.
    pub discarded_capture_transfers: u32,
    /// Number of guest-visible XRUN events queued to repair running streams.
    pub xrun_events: u32,
}

#[derive(Debug, Clone, Copy)]
struct DecodedStream {
    state: PcmState,
    params: Option<PcmParams>,
}

#[derive(Debug, Clone, Copy)]
struct DecodedPlaybackQueue {
    pending_count: u32,
    _pending_bytes: u32,
    observed_epoch: u64,
    _release_pending: bool,
    _next_xrun_ns: Option<u64>,
    _period_duration_ns: u64,
}

#[derive(Debug, Clone, Copy)]
struct DecodedCaptureQueue {
    pending_count: u32,
    _pending_bytes: u32,
    observed_epoch: u64,
    _release_pending: bool,
}

#[derive(Debug)]
struct DecodedSnd {
    capture_enabled: bool,
    pcm_rate_mask: u64,
    capture_start_count: u64,
    lifecycle_epoch: u64,
    capture_lifecycle_epoch: u64,
    output: DecodedStream,
    capture: DecodedStream,
    playback: DecodedPlaybackQueue,
    capture_queue: DecodedCaptureQueue,
    events: Vec<SndEvent>,
    dropped_xruns: u64,
    kicked: [bool; 4],
    reset_pending: bool,
}

/// Encode the stable guest-visible portion of a sound state.
pub(super) fn encode(state: &SndState) -> Result<Vec<u8>, SndSnapshotError> {
    validate_rate_mask(state.pcm_rate_mask)?;
    validate_stream(
        0,
        state.stream.state(),
        state.stream.params(),
        state.pcm_rate_mask,
        true,
    )?;
    validate_stream(
        CAPTURE_STREAM_ID,
        state.capture_stream.state(),
        state.capture_stream.params(),
        state.pcm_rate_mask,
        state.capture_enabled,
    )?;
    if !state.capture_enabled
        && (state.capture_stream.state() != PcmState::Released
            || state.capture_stream.params().is_some()
            || !state.capture.pending.is_empty())
    {
        return Err(SndSnapshotError::InvalidStreamState {
            stream: CAPTURE_STREAM_ID,
            state: state.capture_stream.state() as u8,
        });
    }

    let playback_count = u32::try_from(state.playback.pending.len())
        .map_err(|_| SndSnapshotError::LengthOverflow)?;
    let capture_count =
        u32::try_from(state.capture.pending.len()).map_err(|_| SndSnapshotError::LengthOverflow)?;
    validate_pending_metadata(
        0,
        playback_count,
        state.playback.pending_bytes(),
        state.stream.params().map(|params| params.period_bytes),
    )?;
    validate_pending_metadata(
        CAPTURE_STREAM_ID,
        capture_count,
        state.capture.pending_bytes(),
        state
            .capture_stream
            .params()
            .map(|params| params.period_bytes),
    )?;

    let event_count =
        u32::try_from(state.events.pending.len()).map_err(|_| SndSnapshotError::LengthOverflow)?;
    if state.events.pending.len() > MAX_PENDING_SND_EVENTS {
        return Err(SndSnapshotError::TooManyEvents {
            found: state.events.pending.len(),
            maximum: MAX_PENDING_SND_EVENTS,
        });
    }
    for event in &state.events.pending {
        validate_event(*event, state.capture_enabled)?;
    }

    let events_bytes = state
        .events
        .pending
        .len()
        .checked_mul(8)
        .ok_or(SndSnapshotError::LengthOverflow)?;
    let total_len = HEADER_LEN
        .checked_add(events_bytes)
        .ok_or(SndSnapshotError::LengthOverflow)?;
    let mut out = Vec::new();
    out.try_reserve_exact(total_len)
        .map_err(|_| SndSnapshotError::OutOfMemory)?;

    out.extend_from_slice(&MAGIC);
    put_u16(&mut out, VERSION);
    put_u16(&mut out, 0);
    put_bool(&mut out, state.capture_enabled);
    out.extend_from_slice(&[0, 0, 0]);
    put_u64(&mut out, state.pcm_rate_mask);
    put_u64(&mut out, state.capture_start_count);
    put_u64(&mut out, state.lifecycle_epoch);
    put_u64(&mut out, state.capture_lifecycle_epoch);
    encode_stream(&mut out, state.stream.state(), state.stream.params());
    encode_stream(
        &mut out,
        state.capture_stream.state(),
        state.capture_stream.params(),
    );
    put_u32(&mut out, playback_count);
    put_u32(&mut out, state.playback.pending_bytes());
    put_u64(&mut out, state.playback.observed_epoch);
    put_bool(&mut out, state.playback.release_pending);
    out.extend_from_slice(&[0, 0, 0]);
    put_bool(&mut out, state.playback.next_xrun_ns.is_some());
    out.extend_from_slice(&[0, 0, 0]);
    put_u64(&mut out, state.playback.next_xrun_ns.unwrap_or(0));
    put_u64(&mut out, state.playback.period_duration_ns);
    put_u32(&mut out, capture_count);
    put_u32(&mut out, state.capture.pending_bytes());
    put_u64(&mut out, state.capture.observed_epoch);
    put_bool(&mut out, state.capture.release_pending);
    out.extend_from_slice(&[0, 0, 0]);
    put_u32(&mut out, event_count);
    put_u64(&mut out, state.events.dropped_xruns);
    for kicked in state.kicked {
        put_bool(&mut out, kicked);
    }
    put_bool(&mut out, state.reset_pending);
    out.extend_from_slice(&[0, 0, 0]);

    debug_assert_eq!(out.len(), HEADER_LEN);
    for event in &state.events.pending {
        out.extend_from_slice(&event.to_bytes());
    }
    Ok(out)
}

fn encode_stream(out: &mut Vec<u8>, state: PcmState, params: Option<PcmParams>) {
    out.push(state as u8);
    put_bool(out, params.is_some());
    out.extend_from_slice(&[0, 0]);
    if let Some(params) = params {
        out.extend_from_slice(&params.to_bytes());
    } else {
        out.extend_from_slice(&[0; 24]);
    }
}

/// Decode and atomically restore the sound state.
pub(super) fn restore(
    state: &mut SndState,
    payload: &[u8],
) -> Result<SndRestoreReport, SndSnapshotError> {
    let decoded = decode(payload)?;
    let output_running = decoded.output.state == PcmState::Running;
    let capture_running = decoded.capture_enabled && decoded.capture.state == PcmState::Running;
    let xrun_count = usize::from(output_running) + usize::from(capture_running);
    let total_events = decoded
        .events
        .len()
        .checked_add(xrun_count)
        .ok_or(SndSnapshotError::LengthOverflow)?;
    if total_events > MAX_PENDING_SND_EVENTS {
        return Err(SndSnapshotError::TooManyEvents {
            found: total_events,
            maximum: MAX_PENDING_SND_EVENTS,
        });
    }

    let mut pending_events = VecDeque::new();
    pending_events
        .try_reserve_exact(total_events)
        .map_err(|_| SndSnapshotError::OutOfMemory)?;
    for event in decoded.events {
        pending_events.push_back(event);
    }
    if capture_running {
        pending_events.push_front(SndEvent::pcm_xrun(CAPTURE_STREAM_ID));
    }
    if output_running {
        pending_events.push_front(SndEvent::pcm_xrun(0));
    }

    let mut kicked = decoded.kicked;
    if xrun_count != 0 {
        kicked[EVENT_QUEUE as usize] = true;
    }
    let report = SndRestoreReport {
        host_audio_rings_discarded: true,
        discarded_playback_transfers: decoded.playback.pending_count,
        discarded_capture_transfers: decoded.capture_queue.pending_count,
        xrun_events: u32::try_from(xrun_count).map_err(|_| SndSnapshotError::LengthOverflow)?,
    };

    let playback = PlaybackQueue {
        pending: VecDeque::new(),
        observed_epoch: if output_running {
            decoded.lifecycle_epoch.wrapping_sub(1)
        } else {
            decoded.playback.observed_epoch
        },
        release_pending: false,
        next_xrun_ns: None,
        period_duration_ns: 0,
    };
    let capture_queue = super::CaptureQueue {
        pending: VecDeque::new(),
        observed_epoch: if capture_running {
            decoded.capture_lifecycle_epoch.wrapping_sub(1)
        } else {
            decoded.capture_queue.observed_epoch
        },
        release_pending: false,
    };

    // All fallible decoding and reservations are complete before this point. The remaining
    // assignments are the atomic state transition visible to the transport and queue services.
    state.capture_enabled = decoded.capture_enabled;
    state.pcm_rate_mask = decoded.pcm_rate_mask;
    state.capture_start_count = decoded.capture_start_count;
    state.lifecycle_epoch = decoded.lifecycle_epoch;
    state.capture_lifecycle_epoch = decoded.capture_lifecycle_epoch;
    state.stream = super::PcmStream {
        state: decoded.output.state,
        params: decoded.output.params,
    };
    state.capture_stream = super::PcmStream {
        state: decoded.capture.state,
        params: decoded.capture.params,
    };
    state.playback = playback;
    state.capture = capture_queue;
    state.events = EventState {
        pending: pending_events,
        dropped_xruns: decoded.dropped_xruns,
    };
    state.kicked = kicked;
    state.reset_pending = decoded.reset_pending;
    Ok(report)
}

fn decode(payload: &[u8]) -> Result<DecodedSnd, SndSnapshotError> {
    if payload.len() < HEADER_LEN {
        return Err(SndSnapshotError::Truncated);
    }
    let mut reader = Reader::new(payload);
    if reader.take(8)? != MAGIC {
        return Err(SndSnapshotError::BadMagic);
    }
    let version = reader.u16()?;
    if version != VERSION {
        return Err(SndSnapshotError::UnsupportedVersion {
            found: version,
            supported: VERSION,
        });
    }
    let flags = reader.u16()?;
    if flags != 0 {
        return Err(SndSnapshotError::ReservedFlags { found: flags });
    }
    let capture_enabled = read_bool(&mut reader, "capture_enabled")?;
    reserved(&mut reader, "capture_enabled_reserved", 3)?;
    let pcm_rate_mask = reader.u64()?;
    validate_rate_mask(pcm_rate_mask)?;
    let capture_start_count = reader.u64()?;
    let lifecycle_epoch = reader.u64()?;
    let capture_lifecycle_epoch = reader.u64()?;
    let output = decode_stream(&mut reader, 0)?;
    let capture = decode_stream(&mut reader, CAPTURE_STREAM_ID)?;
    let playback = decode_playback_queue(&mut reader)?;
    let capture_queue = decode_capture_queue(&mut reader)?;
    let event_count = reader.u32()?;
    let dropped_xruns = reader.u64()?;
    let mut kicked = [false; 4];
    for (index, value) in kicked.iter_mut().enumerate() {
        *value = read_bool(&mut reader, KICK_FIELDS[index])?;
    }
    let reset_pending = read_bool(&mut reader, "reset_pending")?;
    reserved(&mut reader, "reset_pending_reserved", 3)?;

    if event_count as usize > MAX_PENDING_SND_EVENTS {
        return Err(SndSnapshotError::TooManyEvents {
            found: event_count as usize,
            maximum: MAX_PENDING_SND_EVENTS,
        });
    }
    let mut events = Vec::new();
    events
        .try_reserve_exact(event_count as usize)
        .map_err(|_| SndSnapshotError::OutOfMemory)?;
    for _ in 0..event_count {
        let event = SndEvent::from_bytes(reader.take(8)?).ok_or(SndSnapshotError::Truncated)?;
        validate_event(event, capture_enabled)?;
        events.push(event);
    }
    if reader.remaining() != 0 {
        return Err(SndSnapshotError::TrailingBytes);
    }

    validate_stream(0, output.state, output.params, pcm_rate_mask, true)?;
    validate_stream(
        CAPTURE_STREAM_ID,
        capture.state,
        capture.params,
        pcm_rate_mask,
        capture_enabled,
    )?;
    validate_pending_metadata(
        0,
        playback.pending_count,
        playback._pending_bytes,
        output.params.map(|params| params.period_bytes),
    )?;
    validate_pending_metadata(
        CAPTURE_STREAM_ID,
        capture_queue.pending_count,
        capture_queue._pending_bytes,
        capture.params.map(|params| params.period_bytes),
    )?;
    if !capture_enabled
        && (capture.state != PcmState::Released
            || capture.params.is_some()
            || capture_queue.pending_count != 0
            || capture_queue._pending_bytes != 0)
    {
        return Err(SndSnapshotError::InvalidStreamState {
            stream: CAPTURE_STREAM_ID,
            state: capture.state as u8,
        });
    }

    Ok(DecodedSnd {
        capture_enabled,
        pcm_rate_mask,
        capture_start_count,
        lifecycle_epoch,
        capture_lifecycle_epoch,
        output,
        capture,
        playback,
        capture_queue,
        events,
        dropped_xruns,
        kicked,
        reset_pending,
    })
}

fn decode_stream(reader: &mut Reader<'_>, stream: u32) -> Result<DecodedStream, SndSnapshotError> {
    let state = match reader.u8()? {
        0 => PcmState::Released,
        1 => PcmState::SetParams,
        2 => PcmState::Prepared,
        3 => PcmState::Running,
        4 => PcmState::Stopped,
        value => {
            return Err(SndSnapshotError::InvalidStreamState {
                stream,
                state: value,
            });
        }
    };
    let has_params = read_bool(reader, "stream_has_params")?;
    reserved(reader, "stream_reserved", 2)?;
    let params_bytes = reader.take(24)?;
    let params = if has_params {
        Some(
            PcmParams::from_bytes(params_bytes)
                .ok_or(SndSnapshotError::InvalidParams { stream })?,
        )
    } else {
        None
    };
    if state == PcmState::Released {
        if params.is_some() {
            return Err(SndSnapshotError::UnexpectedParams { stream });
        }
    } else if params.is_none() {
        return Err(SndSnapshotError::MissingParams { stream });
    }
    Ok(DecodedStream { state, params })
}

fn decode_playback_queue(
    reader: &mut Reader<'_>,
) -> Result<DecodedPlaybackQueue, SndSnapshotError> {
    let pending_count = reader.u32()?;
    let pending_bytes = reader.u32()?;
    validate_pending_metadata(0, pending_count, pending_bytes, None)?;
    let observed_epoch = reader.u64()?;
    let release_pending = read_bool(reader, "playback_release_pending")?;
    reserved(reader, "playback_release_reserved", 3)?;
    let next_present = read_bool(reader, "playback_next_xrun_present")?;
    reserved(reader, "playback_next_xrun_reserved", 3)?;
    let next_xrun_ns = reader.u64()?;
    let period_duration_ns = reader.u64()?;
    if !next_present && next_xrun_ns != 0 {
        return Err(SndSnapshotError::InvalidPendingMetadata { stream: 0 });
    }
    Ok(DecodedPlaybackQueue {
        pending_count,
        _pending_bytes: pending_bytes,
        observed_epoch,
        _release_pending: release_pending,
        _next_xrun_ns: next_present.then_some(next_xrun_ns),
        _period_duration_ns: period_duration_ns,
    })
}

fn decode_capture_queue(reader: &mut Reader<'_>) -> Result<DecodedCaptureQueue, SndSnapshotError> {
    let pending_count = reader.u32()?;
    let pending_bytes = reader.u32()?;
    validate_pending_metadata(CAPTURE_STREAM_ID, pending_count, pending_bytes, None)?;
    let observed_epoch = reader.u64()?;
    let release_pending = read_bool(reader, "capture_release_pending")?;
    reserved(reader, "capture_release_reserved", 3)?;
    Ok(DecodedCaptureQueue {
        pending_count,
        _pending_bytes: pending_bytes,
        observed_epoch,
        _release_pending: release_pending,
    })
}

fn validate_rate_mask(mask: u64) -> Result<(), SndSnapshotError> {
    if mask == 0 || mask & !SUPPORTED_PCM_RATE_MASK != 0 {
        return Err(SndSnapshotError::InvalidRateMask { mask });
    }
    Ok(())
}

fn validate_stream(
    stream: u32,
    state: PcmState,
    params: Option<PcmParams>,
    rate_mask: u64,
    capture_enabled: bool,
) -> Result<(), SndSnapshotError> {
    if stream == CAPTURE_STREAM_ID && !capture_enabled {
        if state != PcmState::Released || params.is_some() {
            return Err(SndSnapshotError::InvalidStreamState {
                stream,
                state: state as u8,
            });
        }
        return Ok(());
    }
    match params {
        Some(params) => {
            let valid = if stream == CAPTURE_STREAM_ID {
                params.is_valid_for(CAPTURE_STREAM_ID, 1, 2)
                    && params.rate == VIRTIO_SND_PCM_RATE_48000
                    && (SUPPORTED_CAPTURE_PCM_RATE_MASK & (1u64 << params.rate)) != 0
            } else {
                params.is_valid_for(stream, 2, 2)
                    && params.rate < 64
                    && (rate_mask & (1u64 << params.rate)) != 0
            };
            if !valid {
                return Err(SndSnapshotError::InvalidParams { stream });
            }
            if state == PcmState::Released {
                return Err(SndSnapshotError::UnexpectedParams { stream });
            }
        }
        None if state != PcmState::Released => {
            return Err(SndSnapshotError::MissingParams { stream });
        }
        None => {}
    }
    Ok(())
}

fn validate_pending_metadata(
    stream: u32,
    count: u32,
    bytes: u32,
    period_bytes: Option<u32>,
) -> Result<(), SndSnapshotError> {
    if count > MAX_SNAPSHOT_PENDING_TRANSFERS {
        return Err(SndSnapshotError::TooManyPendingTransfers {
            stream,
            found: count,
            maximum: MAX_SNAPSHOT_PENDING_TRANSFERS,
        });
    }
    if (count == 0) != (bytes == 0)
        || u64::from(bytes) > u64::from(count) * u64::from(MAX_PCM_BUFFER_BYTES)
    {
        return Err(SndSnapshotError::InvalidPendingMetadata { stream });
    }
    if let Some(period_bytes) = period_bytes {
        let expected = u64::from(count)
            .checked_mul(u64::from(period_bytes))
            .ok_or(SndSnapshotError::InvalidPendingMetadata { stream })?;
        if expected != u64::from(bytes) {
            return Err(SndSnapshotError::InvalidPendingMetadata { stream });
        }
    } else if !bytes.is_multiple_of(PCM_FRAME_BYTES) {
        return Err(SndSnapshotError::InvalidPendingMetadata { stream });
    }
    Ok(())
}

fn validate_event(event: SndEvent, capture_enabled: bool) -> Result<(), SndSnapshotError> {
    if event.event != VIRTIO_SND_EVT_PCM_XRUN
        || event.data > CAPTURE_STREAM_ID
        || (event.data == CAPTURE_STREAM_ID && !capture_enabled)
    {
        return Err(SndSnapshotError::InvalidEvent { event });
    }
    Ok(())
}

const KICK_FIELDS: [&str; 4] = ["control_kicked", "event_kicked", "tx_kicked", "rx_kicked"];

fn read_bool(reader: &mut Reader<'_>, field: &'static str) -> Result<bool, SndSnapshotError> {
    match reader.u8()? {
        0 => Ok(false),
        1 => Ok(true),
        value => Err(SndSnapshotError::InvalidBoolean { field, value }),
    }
}

fn reserved(
    reader: &mut Reader<'_>,
    field: &'static str,
    len: usize,
) -> Result<(), SndSnapshotError> {
    let bytes = reader.take(len)?;
    if bytes.iter().any(|byte| *byte != 0) {
        let found = bytes.iter().fold(0u32, |value, byte| {
            value.saturating_mul(256).saturating_add(u32::from(*byte))
        });
        return Err(SndSnapshotError::ReservedBytes { field, found });
    }
    Ok(())
}

fn put_bool(out: &mut Vec<u8>, value: bool) {
    out.push(u8::from(value));
}

fn put_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn put_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn put_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_le_bytes());
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], SndSnapshotError> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or(SndSnapshotError::LengthOverflow)?;
        if end > self.bytes.len() {
            return Err(SndSnapshotError::Truncated);
        }
        let bytes = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(bytes)
    }

    fn u8(&mut self) -> Result<u8, SndSnapshotError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, SndSnapshotError> {
        let bytes = self.take(2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    }

    fn u32(&mut self) -> Result<u32, SndSnapshotError> {
        let bytes = self.take(4)?;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn u64(&mut self) -> Result<u64, SndSnapshotError> {
        let bytes = self.take(8)?;
        Ok(u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]))
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::virtio::snd::{
        PcmControl, PcmParams, SndStatus, VIRTIO_SND_R_PCM_PREPARE, VIRTIO_SND_R_PCM_START,
        VIRTIO_SND_R_PCM_STOP, VIRTIO_SND_S_OK,
    };

    fn status(response: &[u8]) -> u32 {
        u32::from_le_bytes([response[0], response[1], response[2], response[3]])
    }

    fn lifecycle_request(code: u32, stream_id: u32) -> [u8; 8] {
        let mut request = [0; 8];
        request[..4].copy_from_slice(&code.to_le_bytes());
        request[4..].copy_from_slice(&stream_id.to_le_bytes());
        request
    }

    fn configure_running(state: &mut SndState, stream_id: u32) {
        let params = PcmParams {
            stream_id,
            channels: if stream_id == CAPTURE_STREAM_ID { 1 } else { 2 },
            ..PcmParams::default()
        };
        assert_eq!(
            status(&state.handle_control(&params.to_bytes())),
            VIRTIO_SND_S_OK
        );
        assert_eq!(
            status(&state.handle_control(&lifecycle_request(VIRTIO_SND_R_PCM_PREPARE, stream_id,))),
            VIRTIO_SND_S_OK
        );
        assert_eq!(
            status(&state.handle_control(&lifecycle_request(VIRTIO_SND_R_PCM_START, stream_id,))),
            VIRTIO_SND_S_OK
        );
    }

    #[test]
    fn running_restore_discards_ephemeral_rings_and_repairs_both_streams() {
        let mut source = SndState::new();
        source.set_capture_enabled(true);
        configure_running(&mut source, 0);
        configure_running(&mut source, CAPTURE_STREAM_ID);
        source.playback.pending.push_back(super::super::PendingPcm {
            head: 7,
            frames: vec![1; 2048],
            status_segments: Vec::new(),
            sample_rate_hz: 48_000,
            duration_ns: 1,
            deadline_ns: 1,
        });
        source
            .capture
            .pending
            .push_back(super::super::PendingCapture {
                head: 8,
                data_segments: Vec::new(),
                status_segments: Vec::new(),
                frame_count: 1,
                channels: 1,
                sample_rate_hz: 48_000,
                period_bytes: 4096,
                duration_ns: 1,
                deadline_ns: 1,
            });
        source.events.pending.push_back(SndEvent::pcm_xrun(0));
        source.kicked[2] = true;
        let payload = source.to_snapshot().expect("encode snapshot");

        let mut restored = SndState::new();
        let report = restored
            .restore_snapshot(&payload)
            .expect("restore snapshot");
        assert_eq!(
            report,
            SndRestoreReport {
                host_audio_rings_discarded: true,
                discarded_playback_transfers: 1,
                discarded_capture_transfers: 1,
                xrun_events: 2,
            }
        );
        assert!(restored.capture_enabled());
        assert_eq!(restored.stream.state(), PcmState::Running);
        assert_eq!(restored.capture_stream_state(), PcmState::Running);
        assert_eq!(restored.playback_pending_count(), 0);
        assert_eq!(restored.capture_pending_count(), 0);
        assert_eq!(restored.pending_event_count(), 3);
        assert_eq!(restored.next_event(), Some(SndEvent::pcm_xrun(0)));
        assert!(restored.take_queue_kick(EVENT_QUEUE));
    }

    #[test]
    fn malformed_restore_is_atomic_and_rejects_bad_params() {
        let mut state = SndState::new();
        configure_running(&mut state, 0);
        let payload = state.to_snapshot().expect("encode snapshot");
        let before = state.to_snapshot().expect("encode baseline");
        let mut malformed = payload;
        malformed[64..68].copy_from_slice(&0u32.to_le_bytes());
        assert_eq!(
            state.restore_snapshot(&malformed),
            Err(SndSnapshotError::InvalidParams { stream: 0 })
        );
        assert_eq!(state.to_snapshot().expect("encode after rejection"), before);
    }

    #[test]
    fn pending_period_metadata_is_exact_and_atomic_for_both_streams() {
        let mut output_source = SndState::new();
        configure_running(&mut output_source, 0);
        let mut output_payload = output_source.to_snapshot().expect("encode output snapshot");
        output_payload[PLAYBACK_QUEUE_OFFSET..PLAYBACK_QUEUE_OFFSET + 4]
            .copy_from_slice(&1u32.to_le_bytes());
        output_payload[PLAYBACK_QUEUE_OFFSET + 4..PLAYBACK_QUEUE_OFFSET + 8]
            .copy_from_slice(&1u32.to_le_bytes());
        let mut output_target = SndState::new();
        configure_running(&mut output_target, 0);
        let output_before = output_target.to_snapshot().expect("encode output target");
        assert_eq!(
            output_target.restore_snapshot(&output_payload),
            Err(SndSnapshotError::InvalidPendingMetadata { stream: 0 })
        );
        assert_eq!(
            output_target
                .to_snapshot()
                .expect("encode output after rejection"),
            output_before
        );

        let mut capture_source = SndState::new();
        capture_source.set_capture_enabled(true);
        configure_running(&mut capture_source, CAPTURE_STREAM_ID);
        let mut capture_payload = capture_source
            .to_snapshot()
            .expect("encode capture snapshot");
        capture_payload[CAPTURE_QUEUE_OFFSET..CAPTURE_QUEUE_OFFSET + 4]
            .copy_from_slice(&1u32.to_le_bytes());
        capture_payload[CAPTURE_QUEUE_OFFSET + 4..CAPTURE_QUEUE_OFFSET + 8]
            .copy_from_slice(&1u32.to_le_bytes());
        let mut capture_target = SndState::new();
        capture_target.set_capture_enabled(true);
        configure_running(&mut capture_target, CAPTURE_STREAM_ID);
        let capture_before = capture_target.to_snapshot().expect("encode capture target");
        assert_eq!(
            capture_target.restore_snapshot(&capture_payload),
            Err(SndSnapshotError::InvalidPendingMetadata {
                stream: CAPTURE_STREAM_ID
            })
        );
        assert_eq!(
            capture_target
                .to_snapshot()
                .expect("encode capture after rejection"),
            capture_before
        );
    }

    #[test]
    fn running_repair_respects_the_event_budget_before_mutation() {
        let mut source = SndState::new();
        configure_running(&mut source, 0);
        for _ in 0..MAX_PENDING_SND_EVENTS {
            source.events.pending.push_back(SndEvent::pcm_xrun(0));
        }
        let payload = source.to_snapshot().expect("encode snapshot");
        let mut target = SndState::new();
        let before = target.to_snapshot().expect("encode baseline");
        assert_eq!(
            target.restore_snapshot(&payload),
            Err(SndSnapshotError::TooManyEvents {
                found: MAX_PENDING_SND_EVENTS + 1,
                maximum: MAX_PENDING_SND_EVENTS,
            })
        );
        assert_eq!(
            target.to_snapshot().expect("encode after rejection"),
            before
        );
    }

    #[test]
    fn stopped_stream_round_trip_preserves_configuration_without_xrun() {
        let mut source = SndState::new();
        configure_running(&mut source, 0);
        assert_eq!(
            status(&source.handle_control(&lifecycle_request(VIRTIO_SND_R_PCM_STOP, 0,))),
            SndStatus::Ok.code()
        );
        source.events.pending.push_back(SndEvent::pcm_xrun(0));
        let payload = source.to_snapshot().expect("encode snapshot");
        let mut restored = SndState::new();
        let report = restored
            .restore_snapshot(&payload)
            .expect("restore snapshot");
        assert_eq!(report.xrun_events, 0);
        assert_eq!(restored.stream.state(), PcmState::Stopped);
        assert_eq!(restored.pending_event_count(), 1);
        assert_eq!(restored.stream.params(), source.stream.params());
    }

    #[test]
    fn snapshot_header_has_stable_size_before_event_records() {
        let state = SndState::new();
        let payload = state.to_snapshot().expect("encode snapshot");
        assert_eq!(payload.len(), HEADER_LEN);
        assert_eq!(
            &payload[OUTPUT_STREAM_OFFSET..OUTPUT_STREAM_OFFSET + 1],
            &[0]
        );
        assert_eq!(
            &payload[CAPTURE_STREAM_OFFSET..CAPTURE_STREAM_OFFSET + 1],
            &[0]
        );
        assert_eq!(
            u32::from_le_bytes([
                payload[EVENT_COUNT_OFFSET],
                payload[EVENT_COUNT_OFFSET + 1],
                payload[EVENT_COUNT_OFFSET + 2],
                payload[EVENT_COUNT_OFFSET + 3],
            ]),
            0
        );
        assert_eq!(RESET_PENDING_OFFSET, HEADER_LEN - 4);
        assert_eq!(PcmControl::Info.index(), 0);
    }
}
