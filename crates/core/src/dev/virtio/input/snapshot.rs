//! E5-T26c: bounded virtio-input pending-frame snapshots and restore reconciliation.
//!
//! The payload deliberately contains queue work, not the host's physical held-key ledger.  A
//! restore therefore prepends one protected key/button-release frame for anything the target had
//! already delivered, clears the target ledger, and then resumes the decoded pending frames.

use alloc::{
    collections::{BTreeSet, VecDeque},
    vec::Vec,
};

use super::{InputEvent, InputState, PendingFrame};

/// Payload magic for one virtio-input device's snapshot section.
pub const INPUT_SNAPSHOT_MAGIC: [u8; 8] = *b"WVINP001";
/// Current virtio-input payload version.
pub const INPUT_SNAPSHOT_VERSION: u16 = 1;

const HEADER_LEN: usize = 68;
const FRAME_HEADER_LEN: usize = 12;
const MAX_SNAPSHOT_FRAMES: u32 = 4096;
const MAX_SNAPSHOT_EVENTS: u32 = 1 << 16;
const MAX_SNAPSHOT_BUDGET: u32 = 1 << 20;

/// A malformed or unsafe virtio-input snapshot payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputSnapshotError {
    Truncated,
    BadMagic,
    UnsupportedVersion { found: u16, supported: u16 },
    ReservedFlags { found: u16 },
    InvalidBoolean { field: &'static str },
    TooManyFrames { found: u32, maximum: u32 },
    TooManyEvents { found: u32, maximum: u32 },
    InvalidBudget { budget: u32, maximum: u32 },
    InvalidFrameLength { frame: u32 },
    InvalidFrameIndex { frame: u32, next: u32, length: u32 },
    PendingCountMismatch { declared: u32, actual: u32 },
    DuplicateEvent { frame: u32, event: InputEvent },
    TrailingBytes,
    LengthOverflow,
    OutOfMemory,
}

impl InputSnapshotError {
    /// Stable machine-readable code for restore diagnostics.
    pub const fn code(self) -> &'static str {
        match self {
            Self::Truncated => "truncated",
            Self::BadMagic => "bad_magic",
            Self::UnsupportedVersion { .. } => "unsupported_version",
            Self::ReservedFlags { .. } => "reserved_flags",
            Self::InvalidBoolean { .. } => "invalid_boolean",
            Self::TooManyFrames { .. } => "too_many_frames",
            Self::TooManyEvents { .. } => "too_many_events",
            Self::InvalidBudget { .. } => "invalid_budget",
            Self::InvalidFrameLength { .. } => "invalid_frame_length",
            Self::InvalidFrameIndex { .. } => "invalid_frame_index",
            Self::PendingCountMismatch { .. } => "pending_count_mismatch",
            Self::DuplicateEvent { .. } => "duplicate_event",
            Self::TrailingBytes => "trailing_bytes",
            Self::LengthOverflow => "length_overflow",
            Self::OutOfMemory => "out_of_memory",
        }
    }
}

/// Reconciliation facts emitted by a successful restore.  The held set itself is intentionally
/// absent from the serialized bytes; this report records that policy and the concrete release
/// events queued for keys/buttons already delivered by the target state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputRestoreReport {
    pub host_held_set_discarded: bool,
    pub release_events: Vec<InputEvent>,
}

struct DecodedInput {
    pending_frames: VecDeque<PendingFrame>,
    pending_event_count: usize,
    pending_event_budget: usize,
    staged_frame: Vec<InputEvent>,
    staged_event_count: usize,
    dropped_frames: u64,
    dropped_events: u64,
    status_events_served: u64,
    rejected_events: u64,
    kicked: [bool; 2],
    reset_pending: bool,
}

/// Encode all queue-visible state except the host-held key/button ledger.
pub(crate) fn encode(state: &InputState) -> Result<Vec<u8>, InputSnapshotError> {
    let pending_frames = u32_len(state.pending_frames.len())?;
    let pending_event_count = u32_len(state.pending_event_count)?;
    let pending_event_budget = u32_len(state.pending_event_budget)?;
    let staged_event_count = u32_len(state.staged_event_count)?;
    let staged_len = u32_len(state.staged_frame.len())?;
    if pending_frames > MAX_SNAPSHOT_FRAMES {
        return Err(InputSnapshotError::TooManyFrames {
            found: pending_frames,
            maximum: MAX_SNAPSHOT_FRAMES,
        });
    }
    if pending_event_count > MAX_SNAPSHOT_EVENTS
        || staged_event_count > MAX_SNAPSHOT_EVENTS
        || staged_len > MAX_SNAPSHOT_EVENTS
    {
        return Err(InputSnapshotError::TooManyEvents {
            found: pending_event_count.max(staged_event_count).max(staged_len),
            maximum: MAX_SNAPSHOT_EVENTS,
        });
    }
    if pending_event_budget > MAX_SNAPSHOT_BUDGET || staged_len > pending_event_budget {
        return Err(InputSnapshotError::InvalidBudget {
            budget: pending_event_budget,
            maximum: MAX_SNAPSHOT_BUDGET,
        });
    }

    let mut out = Vec::new();
    out.try_reserve(HEADER_LEN)
        .map_err(|_| InputSnapshotError::OutOfMemory)?;
    out.extend_from_slice(&INPUT_SNAPSHOT_MAGIC);
    out.extend_from_slice(&INPUT_SNAPSHOT_VERSION.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    push_u32(&mut out, pending_frames);
    push_u32(&mut out, pending_event_count);
    push_u32(&mut out, pending_event_budget);
    push_u32(&mut out, staged_event_count);
    push_u32(&mut out, staged_len);
    push_u64(&mut out, state.dropped_frames);
    push_u64(&mut out, state.dropped_events);
    push_u64(&mut out, state.status_events_served);
    push_u64(&mut out, state.rejected_events);
    out.push(u8::from(state.kicked[0]));
    out.push(u8::from(state.kicked[1]));
    out.push(u8::from(state.reset_pending));
    out.push(0);

    for event in &state.staged_frame {
        push_event(&mut out, *event);
    }
    for (index, frame) in state.pending_frames.iter().enumerate() {
        let frame_index = u32_len(index)?;
        let event_count = u32_len(frame.events.len())?;
        if event_count == 0 || event_count > MAX_SNAPSHOT_EVENTS {
            return Err(InputSnapshotError::InvalidFrameLength { frame: frame_index });
        }
        let next = u32_len(frame.next)?;
        if next > event_count {
            return Err(InputSnapshotError::InvalidFrameIndex {
                frame: frame_index,
                next,
                length: event_count,
            });
        }
        out.try_reserve(FRAME_HEADER_LEN)
            .map_err(|_| InputSnapshotError::OutOfMemory)?;
        push_u32(&mut out, next);
        push_u32(&mut out, event_count);
        out.push(u8::from(frame.release_all));
        out.extend_from_slice(&[0u8; 3]);
        for event in &frame.events {
            push_event(&mut out, *event);
        }
    }
    Ok(out)
}

/// Parse and atomically restore one input-device payload.  Any currently delivered key/button is
/// released in a protected frame before the saved pending ring is made visible.
pub(crate) fn restore(
    state: &mut InputState,
    payload: &[u8],
) -> Result<InputRestoreReport, InputSnapshotError> {
    let decoded = decode(payload)?;
    let release_events = state.take_release_frame();

    let release_count = release_events.len();
    let pending_event_count = release_count
        .checked_add(decoded.pending_event_count)
        .ok_or(InputSnapshotError::LengthOverflow)?;
    let mut pending_frames = VecDeque::new();
    if !release_events.is_empty() {
        pending_frames.push_back(PendingFrame {
            events: release_events.clone(),
            next: 0,
            release_all: true,
        });
    }
    pending_frames.extend(decoded.pending_frames);

    state.pending_frames = pending_frames;
    state.pending_event_count = pending_event_count;
    state.pending_event_budget = decoded.pending_event_budget;
    state.staged_frame = decoded.staged_frame;
    state.staged_event_count = decoded.staged_event_count;
    state.dropped_frames = decoded.dropped_frames;
    state.dropped_events = decoded.dropped_events;
    state.status_events_served = decoded.status_events_served;
    state.rejected_events = decoded.rejected_events;
    state.kicked = decoded.kicked;
    if !release_events.is_empty() {
        state.kicked[super::EVENT_QUEUE as usize] = true;
    }
    state.reset_pending = decoded.reset_pending;
    // These sets represent the physical world and are never restored from the blob.
    state.delivered_keys.clear();
    state.suppressed_keys.clear();

    Ok(InputRestoreReport {
        host_held_set_discarded: true,
        release_events,
    })
}

fn decode(payload: &[u8]) -> Result<DecodedInput, InputSnapshotError> {
    let mut reader = Reader::new(payload);
    reader.require(HEADER_LEN)?;
    if reader.take(8)? != INPUT_SNAPSHOT_MAGIC {
        return Err(InputSnapshotError::BadMagic);
    }
    let version = reader.u16()?;
    if version != INPUT_SNAPSHOT_VERSION {
        return Err(InputSnapshotError::UnsupportedVersion {
            found: version,
            supported: INPUT_SNAPSHOT_VERSION,
        });
    }
    let flags = reader.u16()?;
    if flags != 0 {
        return Err(InputSnapshotError::ReservedFlags { found: flags });
    }
    let frame_count = reader.u32()?;
    if frame_count > MAX_SNAPSHOT_FRAMES {
        return Err(InputSnapshotError::TooManyFrames {
            found: frame_count,
            maximum: MAX_SNAPSHOT_FRAMES,
        });
    }
    let declared_pending = reader.u32()?;
    let pending_budget = reader.u32()?;
    if pending_budget > MAX_SNAPSHOT_BUDGET {
        return Err(InputSnapshotError::InvalidBudget {
            budget: pending_budget,
            maximum: MAX_SNAPSHOT_BUDGET,
        });
    }
    let staged_event_count = reader.u32()?;
    let staged_len = reader.u32()?;
    if declared_pending > MAX_SNAPSHOT_EVENTS
        || staged_event_count > MAX_SNAPSHOT_EVENTS
        || staged_len > MAX_SNAPSHOT_EVENTS
    {
        return Err(InputSnapshotError::TooManyEvents {
            found: declared_pending.max(staged_event_count).max(staged_len),
            maximum: MAX_SNAPSHOT_EVENTS,
        });
    }
    if staged_len > pending_budget || staged_len > staged_event_count {
        return Err(InputSnapshotError::InvalidBudget {
            budget: pending_budget,
            maximum: MAX_SNAPSHOT_BUDGET,
        });
    }
    let dropped_frames = reader.u64()?;
    let dropped_events = reader.u64()?;
    let status_events_served = reader.u64()?;
    let rejected_events = reader.u64()?;
    let kicked_event = reader.bool("event_queue_kicked")?;
    let kicked_status = reader.bool("status_queue_kicked")?;
    let reset_pending = reader.bool("reset_pending")?;
    reader.reserved_zero(1)?;

    let mut staged_frame = Vec::new();
    staged_frame
        .try_reserve_exact(staged_len as usize)
        .map_err(|_| InputSnapshotError::OutOfMemory)?;
    for _ in 0..staged_len {
        staged_frame.push(reader.event()?);
    }
    validate_events(&staged_frame, u32::MAX)?;

    let mut pending_frames = VecDeque::new();
    pending_frames
        .try_reserve(frame_count as usize)
        .map_err(|_| InputSnapshotError::OutOfMemory)?;
    let mut actual_pending = 0u32;
    for frame_index in 0..frame_count {
        reader.require(FRAME_HEADER_LEN)?;
        let next = reader.u32()?;
        let event_count = reader.u32()?;
        if event_count == 0 || event_count > MAX_SNAPSHOT_EVENTS {
            return Err(InputSnapshotError::InvalidFrameLength { frame: frame_index });
        }
        if next > event_count {
            return Err(InputSnapshotError::InvalidFrameIndex {
                frame: frame_index,
                next,
                length: event_count,
            });
        }
        let release_all = reader.bool("release_all_frame")?;
        reader.reserved_zero(3)?;
        let mut events = Vec::new();
        events
            .try_reserve_exact(event_count as usize)
            .map_err(|_| InputSnapshotError::OutOfMemory)?;
        for _ in 0..event_count {
            events.push(reader.event()?);
        }
        validate_events(&events, frame_index)?;
        let remaining =
            event_count
                .checked_sub(next)
                .ok_or(InputSnapshotError::InvalidFrameIndex {
                    frame: frame_index,
                    next,
                    length: event_count,
                })?;
        actual_pending = actual_pending
            .checked_add(remaining)
            .ok_or(InputSnapshotError::LengthOverflow)?;
        pending_frames.push_back(PendingFrame {
            events,
            next: next as usize,
            release_all,
        });
    }
    if actual_pending != declared_pending {
        return Err(InputSnapshotError::PendingCountMismatch {
            declared: declared_pending,
            actual: actual_pending,
        });
    }
    if !reader.is_empty() {
        return Err(InputSnapshotError::TrailingBytes);
    }
    Ok(DecodedInput {
        pending_frames,
        pending_event_count: actual_pending as usize,
        pending_event_budget: pending_budget as usize,
        staged_frame,
        staged_event_count: staged_event_count as usize,
        dropped_frames,
        dropped_events,
        status_events_served,
        rejected_events,
        kicked: [kicked_event, kicked_status],
        reset_pending,
    })
}

fn validate_events(events: &[InputEvent], frame: u32) -> Result<(), InputSnapshotError> {
    let mut seen = BTreeSet::new();
    for event in events {
        if !seen.insert((event.event_type, event.code, event.value)) {
            return Err(InputSnapshotError::DuplicateEvent {
                frame,
                event: *event,
            });
        }
    }
    Ok(())
}

fn u32_len(value: usize) -> Result<u32, InputSnapshotError> {
    u32::try_from(value).map_err(|_| InputSnapshotError::LengthOverflow)
}

fn push_event(out: &mut Vec<u8>, event: InputEvent) {
    out.extend_from_slice(&event.event_type.to_le_bytes());
    out.extend_from_slice(&event.code.to_le_bytes());
    out.extend_from_slice(&event.value.to_le_bytes());
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_le_bytes());
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.pos)
    }

    fn is_empty(&self) -> bool {
        self.pos == self.bytes.len()
    }

    fn require(&self, length: usize) -> Result<(), InputSnapshotError> {
        if self.remaining() < length {
            Err(InputSnapshotError::Truncated)
        } else {
            Ok(())
        }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], InputSnapshotError> {
        self.require(length)?;
        let end = self
            .pos
            .checked_add(length)
            .ok_or(InputSnapshotError::LengthOverflow)?;
        let bytes = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(bytes)
    }

    fn bool(&mut self, field: &'static str) -> Result<bool, InputSnapshotError> {
        match self.take(1)?[0] {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(InputSnapshotError::InvalidBoolean { field }),
        }
    }

    fn reserved_zero(&mut self, length: usize) -> Result<(), InputSnapshotError> {
        if self.take(length)?.iter().any(|byte| *byte != 0) {
            Err(InputSnapshotError::ReservedFlags { found: 1 })
        } else {
            Ok(())
        }
    }

    fn u16(&mut self) -> Result<u16, InputSnapshotError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }

    fn u32(&mut self) -> Result<u32, InputSnapshotError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn u64(&mut self) -> Result<u64, InputSnapshotError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }

    fn event(&mut self) -> Result<InputEvent, InputSnapshotError> {
        let bytes = self.take(super::INPUT_EVENT_SIZE)?;
        let fixed: &[u8; super::INPUT_EVENT_SIZE] = bytes.try_into().unwrap();
        Ok(InputEvent::from_bytes(fixed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::virtio::input::{
        BUS_VIRTUAL, EV_KEY, EV_SYN, InputDeviceSpec, InputDevids, SYN_REPORT, keyboard, pointer,
    };
    use alloc::boxed::Box;

    fn generic_spec(name: &'static str, product: u16) -> InputDeviceSpec {
        let mut spec = InputDeviceSpec::new(
            name,
            InputDevids {
                bustype: BUS_VIRTUAL,
                vendor: 0xfeed,
                product,
                version: 1,
            },
        );
        assert!(spec.set_event_bit(EV_SYN, SYN_REPORT));
        assert!(spec.set_event_bit(EV_KEY, 30));
        spec
    }

    fn partially_delivered(spec: InputDeviceSpec, event: InputEvent) -> InputState {
        let mut state =
            InputState::new_with_capabilities(Box::new(super::super::NullStatusSink), Some(spec));
        state.inject_event(event.event_type, event.code, event.value);
        state.sync();
        let first = state.next_pending_event().unwrap();
        state.complete_pending_event(first);
        state
    }

    #[test]
    fn three_input_devices_round_trip_pending_order_and_partial_indices() {
        let mut keyboard = partially_delivered(
            keyboard::keyboard_spec(),
            InputEvent::new(EV_KEY, keyboard::KEY_A, 1),
        );
        let mut tablet = partially_delivered(
            pointer::tablet_spec(),
            InputEvent::new(super::super::EV_ABS, pointer::ABS_X, 1234),
        );
        let mut mouse = partially_delivered(
            pointer::mouse_spec(),
            InputEvent::new(super::super::EV_REL, pointer::REL_X, -4),
        );
        for state in [&mut keyboard, &mut tablet, &mut mouse] {
            let bytes = encode(state).unwrap();
            let mut restored =
                InputState::new_with_capabilities(Box::new(super::super::NullStatusSink), None);
            let report = restore(&mut restored, &bytes).unwrap();
            assert!(report.host_held_set_discarded);
            assert!(report.release_events.is_empty());
            assert_eq!(encode(&restored).unwrap(), bytes);
            assert_eq!(restored.pending_event_count, state.pending_event_count);
            assert_eq!(restored.pending_frames[0].next, 1);
            assert_eq!(
                restored.pending_frames[0].events,
                state.pending_frames[0].events
            );

            let fresh_code = state.pending_frames[0].events[0].code;
            assert!(restored.inject_event(
                state.pending_frames[0].events[0].event_type,
                fresh_code,
                0
            ));
            restored.sync();
            assert!(restored.pending_events() > state.pending_event_count);
        }
    }

    #[test]
    fn restore_discards_held_key_and_button_state_with_one_protected_release_frame() {
        let mut source = partially_delivered(
            pointer::tablet_spec(),
            InputEvent::new(EV_KEY, pointer::BTN_LEFT, 1),
        );
        let payload = encode(&source).unwrap();
        // The partially delivered source has already handed the key-down to the target while its
        // SYN terminator remains pending. Restore over it: the target has a physical key/button
        // believed down, while the saved payload contains only the pending ring.
        assert!(source.delivered_keys.contains(&pointer::BTN_LEFT));
        let before = source.pending_events();
        let report = restore(&mut source, &payload).unwrap();
        assert!(report.host_held_set_discarded);
        assert_eq!(
            report.release_events,
            vec![
                InputEvent::new(EV_KEY, pointer::BTN_LEFT, 0),
                InputEvent::new(EV_SYN, SYN_REPORT, 0)
            ]
        );
        assert_eq!(
            source.pending_events(),
            before + report.release_events.len()
        );
        assert!(source.delivered_keys.is_empty());
        assert!(source.pending_frames.front().unwrap().release_all);
        assert!(source.pending_frames.front().unwrap().events[0].value == 0);
    }

    #[test]
    fn direct_release_all_is_protected_from_budget_eviction() {
        let mut state = partially_delivered(
            keyboard::keyboard_spec(),
            InputEvent::new(EV_KEY, keyboard::KEY_A, 1),
        );
        let report = state.release_all();
        assert_eq!(
            report.release_events,
            vec![
                InputEvent::new(EV_KEY, keyboard::KEY_A, 0),
                InputEvent::new(EV_SYN, SYN_REPORT, 0)
            ]
        );
        assert!(state.pending_frames.front().unwrap().release_all);
        state.set_pending_event_budget(0);
        assert_eq!(
            state.pending_frames.front().unwrap().events,
            report.release_events
        );
        assert_eq!(state.pending_events(), report.release_events.len() + 1);
        assert_eq!(state.pending_frames[1].next, 1);
    }

    #[test]
    fn malformed_ring_lengths_duplicate_events_and_truncation_are_atomic() {
        let mut source =
            partially_delivered(generic_spec("input", 9), InputEvent::new(EV_KEY, 30, 1));
        let valid = encode(&source).unwrap();
        let before = encode(&source).unwrap();

        let mut truncated = valid.clone();
        truncated.pop();
        assert_eq!(
            restore(&mut source, &truncated),
            Err(InputSnapshotError::Truncated)
        );
        assert_eq!(encode(&source).unwrap(), before);

        let mut duplicate = valid.clone();
        // The first pending frame is after the fixed header; duplicate its first event in place of
        // the SYN terminator, preserving framing length while violating the event contract.
        let event_start = HEADER_LEN + FRAME_HEADER_LEN;
        let first_event: [u8; super::super::INPUT_EVENT_SIZE] = duplicate
            [event_start..event_start + super::super::INPUT_EVENT_SIZE]
            .try_into()
            .unwrap();
        duplicate[event_start + super::super::INPUT_EVENT_SIZE
            ..event_start + 2 * super::super::INPUT_EVENT_SIZE]
            .copy_from_slice(&first_event);
        assert!(matches!(
            restore(&mut source, &duplicate),
            Err(InputSnapshotError::DuplicateEvent { .. })
        ));
        assert_eq!(encode(&source).unwrap(), before);

        let mut forged_count = valid;
        forged_count[16..20].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(matches!(
            restore(&mut source, &forged_count),
            Err(InputSnapshotError::TooManyEvents { .. })
        ));
        assert_eq!(encode(&source).unwrap(), before);
    }
}
