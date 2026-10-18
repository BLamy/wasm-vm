//! Exact capture queues for the owned completion adapter. Legacy audio snapshots retain their
//! existing host-ring discard/XRUN policy; that policy cannot represent a session checkpoint.
use super::super::{
    CaptureQueue, PCM_STATUS_SIZE, PcmStream, PendingCapture, Segment, VecDeque, frame_duration_ns,
};
use super::*;
use crate::session_devices::{Decoder, DeviceError, put_bytes};

fn segments(out: &mut Vec<u8>, items: &[Segment]) {
    out.extend_from_slice(&(items.len() as u32).to_le_bytes());
    for item in items {
        out.extend_from_slice(&item.addr.to_le_bytes());
        out.extend_from_slice(&item.len.to_le_bytes());
        out.push(item.writable as u8);
    }
}
fn read_segments(r: &mut Decoder<'_>) -> Result<Vec<Segment>, DeviceError> {
    let mut items = Vec::new();
    for _ in 0..r.count(256)? {
        let addr = r.u64()?;
        let len = r.u32()?;
        let writable = r.bool()?;
        if len == 0 || !writable || addr.checked_add(u64::from(len)).is_none() {
            return Err(DeviceError::Snapshot);
        }
        items.push(Segment {
            addr,
            len,
            writable,
        });
    }
    if items.is_empty() {
        return Err(DeviceError::Snapshot);
    }
    Ok(items)
}
pub(crate) fn encode(state: &SndState) -> Result<Vec<u8>, SndSnapshotError> {
    if state.stream.state() == PcmState::Running || !state.playback.pending.is_empty() {
        return Err(SndSnapshotError::SessionAudioActive);
    }
    let legacy = super::encode(state)?;
    let mut out = b"WVSNDC01".to_vec();
    put_bytes(&mut out, &legacy);
    out.extend_from_slice(&(state.capture.pending.len() as u32).to_le_bytes());
    for transfer in &state.capture.pending {
        out.extend_from_slice(&transfer.head.to_le_bytes());
        out.extend_from_slice(&(transfer.frame_count as u32).to_le_bytes());
        out.push(transfer.channels);
        out.extend_from_slice(&transfer.sample_rate_hz.to_le_bytes());
        out.extend_from_slice(&transfer.period_bytes.to_le_bytes());
        out.extend_from_slice(&transfer.duration_ns.to_le_bytes());
        out.extend_from_slice(&transfer.deadline_ns.to_le_bytes());
        segments(&mut out, &transfer.data_segments);
        segments(&mut out, &transfer.status_segments);
    }
    Ok(out)
}
pub(crate) fn restore(state: &mut SndState, payload: &[u8]) -> Result<(), SndSnapshotError> {
    decode(state, payload).map_err(|_| SndSnapshotError::InvalidPendingMetadata {
        stream: CAPTURE_STREAM_ID,
    })
}
fn decode(state: &mut SndState, payload: &[u8]) -> Result<(), DeviceError> {
    if payload.len() > (2 << 20) {
        return Err(DeviceError::Limit);
    }
    let mut r = Decoder::new(payload);
    if r.take(8)? != b"WVSNDC01" {
        return Err(DeviceError::Snapshot);
    }
    let legacy = r.bytes(1 << 20)?;
    let decoded = super::decode(legacy).map_err(|_| DeviceError::Snapshot)?;
    if decoded.output.state == PcmState::Running || decoded.playback.pending_count != 0 {
        return Err(DeviceError::Unsupported);
    }
    let mut pending = VecDeque::new();
    for _ in 0..r.count(256)? {
        let head = r.u16()?;
        let frame_count = r.u32()? as usize;
        let channels = r.u8()?;
        let sample_rate_hz = r.u32()?;
        let period_bytes = r.u32()?;
        let duration_ns = r.u64()?;
        let deadline_ns = r.u64()?;
        let data_segments = read_segments(&mut r)?;
        let status_segments = read_segments(&mut r)?;
        let Some(params) = decoded.capture.params else {
            return Err(DeviceError::Snapshot);
        };
        if head >= 256
            || pending.iter().any(|p: &PendingCapture| p.head == head)
            || channels != params.channels
            || frame_count == 0
            || frame_count as u64 * u64::from(channels) * 2 != u64::from(period_bytes)
            || period_bytes != params.period_bytes
            || params.sample_rate_hz() != Some(sample_rate_hz)
            || duration_ns != frame_duration_ns(frame_count, sample_rate_hz)
            || data_segments.iter().map(|s| u64::from(s.len)).sum::<u64>() < u64::from(period_bytes)
            || status_segments
                .iter()
                .map(|s| u64::from(s.len))
                .sum::<u64>()
                != PCM_STATUS_SIZE as u64
        {
            return Err(DeviceError::Snapshot);
        }
        pending.push_back(PendingCapture {
            head,
            data_segments,
            status_segments,
            frame_count,
            channels,
            sample_rate_hz,
            period_bytes,
            duration_ns,
            deadline_ns,
        });
    }
    r.finish()?;
    if pending.len() != decoded.capture_queue.pending_count as usize
        || pending.iter().map(|p| p.period_bytes as u64).sum::<u64>()
            != u64::from(decoded.capture_queue._pending_bytes)
    {
        return Err(DeviceError::Snapshot);
    }
    // The entire owned envelope is now valid. No synthesized XRUN and no dropped descriptor.
    state.capture_enabled = decoded.capture_enabled;
    state.pcm_rate_mask = decoded.pcm_rate_mask;
    state.capture_start_count = decoded.capture_start_count;
    state.lifecycle_epoch = decoded.lifecycle_epoch;
    state.capture_lifecycle_epoch = decoded.capture_lifecycle_epoch;
    state.stream = PcmStream {
        state: decoded.output.state,
        params: decoded.output.params,
    };
    state.capture_stream = PcmStream {
        state: decoded.capture.state,
        params: decoded.capture.params,
    };
    state.playback = PlaybackQueue {
        pending: VecDeque::new(),
        observed_epoch: decoded.playback.observed_epoch,
        release_pending: decoded.playback._release_pending,
        next_xrun_ns: decoded.playback._next_xrun_ns,
        period_duration_ns: decoded.playback._period_duration_ns,
    };
    state.capture = CaptureQueue {
        pending,
        observed_epoch: decoded.capture_queue.observed_epoch,
        release_pending: decoded.capture_queue._release_pending,
    };
    state.events = EventState {
        pending: decoded.events.into_iter().collect(),
        dropped_xruns: decoded.dropped_xruns,
    };
    state.kicked = decoded.kicked;
    state.reset_pending = decoded.reset_pending;
    Ok(())
}
