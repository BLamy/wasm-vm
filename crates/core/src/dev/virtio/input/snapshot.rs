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

    validate_events(&state.staged_frame, u32::MAX)?;
    let mut serialized_event_count = staged_len;
    let staged_bytes = (staged_len as usize)
        .checked_mul(super::INPUT_EVENT_SIZE)
        .ok_or(InputSnapshotError::LengthOverflow)?;
    let mut encoded_len = HEADER_LEN
        .checked_add(staged_bytes)
        .ok_or(InputSnapshotError::LengthOverflow)?;
    for (index, frame) in state.pending_frames.iter().enumerate() {
        let frame_index = u32_len(index)?;
        let event_count = u32_len(frame.events.len())?;
        if event_count == 0 || event_count > MAX_SNAPSHOT_EVENTS {
            return Err(InputSnapshotError::InvalidFrameLength { frame: frame_index });
        }
        serialized_event_count = serialized_event_count
            .checked_add(event_count)
            .ok_or(InputSnapshotError::LengthOverflow)?;
        if serialized_event_count > MAX_SNAPSHOT_EVENTS {
            return Err(InputSnapshotError::TooManyEvents {
                found: serialized_event_count,
                maximum: MAX_SNAPSHOT_EVENTS,
            });
        }
        validate_events(&frame.events, frame_index)?;
        let frame_bytes = (event_count as usize)
            .checked_mul(super::INPUT_EVENT_SIZE)
            .and_then(|bytes| bytes.checked_add(FRAME_HEADER_LEN))
            .ok_or(InputSnapshotError::LengthOverflow)?;
        encoded_len = encoded_len
            .checked_add(frame_bytes)
            .ok_or(InputSnapshotError::LengthOverflow)?;
    }

    let mut out = Vec::new();
    out.try_reserve_exact(encoded_len)
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
        let next = u32_len(frame.next)?;
        if next > event_count {
            return Err(InputSnapshotError::InvalidFrameIndex {
                frame: frame_index,
                next,
                length: event_count,
            });
        }
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
    let expected_release_count = if state.delivered_keys.is_empty() {
        0
    } else {
        state
            .delivered_keys
            .len()
            .checked_add(1)
            .ok_or(InputSnapshotError::LengthOverflow)?
    };
    let pending_event_count = expected_release_count
        .checked_add(decoded.pending_event_count)
        .ok_or(InputSnapshotError::LengthOverflow)?;
    if pending_event_count > MAX_SNAPSHOT_EVENTS as usize {
        return Err(InputSnapshotError::TooManyEvents {
            found: u32_len(pending_event_count)?,
            maximum: MAX_SNAPSHOT_EVENTS,
        });
    }
    let release_events = state.take_release_frame();

    let release_count = release_events.len();
    debug_assert_eq!(release_count, expected_release_count);
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
    let mut serialized_event_count = staged_len;
    let mut actual_pending = 0u32;
    for frame_index in 0..frame_count {
        reader.require(FRAME_HEADER_LEN)?;
        let next = reader.u32()?;
        let event_count = reader.u32()?;
        if event_count == 0 || event_count > MAX_SNAPSHOT_EVENTS {
            return Err(InputSnapshotError::InvalidFrameLength { frame: frame_index });
        }
        serialized_event_count = serialized_event_count
            .checked_add(event_count)
            .ok_or(InputSnapshotError::LengthOverflow)?;
        if serialized_event_count > MAX_SNAPSHOT_EVENTS {
            return Err(InputSnapshotError::TooManyEvents {
                found: serialized_event_count,
                maximum: MAX_SNAPSHOT_EVENTS,
            });
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

    fn drain(state: &mut InputState) -> Vec<InputEvent> {
        let mut events = Vec::new();
        while let Some(event) = state.next_pending_event() {
            events.push(event);
            state.complete_pending_event(event);
        }
        events
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

    #[test]
    fn verifier_multiframe_order_indices_and_staged_work_are_byte_exact() {
        let mut source =
            InputState::new_with_capabilities(Box::new(super::super::NullStatusSink), None);
        assert!(source.inject_event(EV_KEY, 30, 1));
        source.sync();
        assert!(source.inject_event(super::super::EV_REL, pointer::REL_X, 7));
        assert!(source.inject_event(super::super::EV_REL, pointer::REL_Y, -3));
        source.sync();
        let first = source.next_pending_event().unwrap();
        source.complete_pending_event(first);
        assert!(source.inject_event(super::super::EV_ABS, pointer::ABS_X, 1234));

        let bytes = source.to_snapshot().unwrap();
        let mut restored =
            InputState::new_with_capabilities(Box::new(super::super::NullStatusSink), None);
        let report = restored.restore_snapshot(&bytes).unwrap();

        assert!(report.release_events.is_empty());
        assert_eq!(restored.to_snapshot().unwrap(), bytes);
        assert_eq!(restored.pending_frames.len(), 2);
        assert_eq!(restored.pending_frames[0].next, 1);
        assert_eq!(restored.pending_frames[1].next, 0);
        assert_eq!(restored.staged_event_count, 1);
        assert_eq!(
            drain(&mut restored),
            vec![
                InputEvent::new(EV_SYN, SYN_REPORT, 0),
                InputEvent::new(super::super::EV_REL, pointer::REL_X, 7),
                InputEvent::new(super::super::EV_REL, pointer::REL_Y, -3),
                InputEvent::new(EV_SYN, SYN_REPORT, 0),
            ]
        );
    }

    #[test]
    fn verifier_malformed_headers_preserve_unserialized_delivered_ledger() {
        let base = partially_delivered(
            keyboard::keyboard_spec(),
            InputEvent::new(EV_KEY, keyboard::KEY_A, 1),
        );
        let valid = encode(&base).unwrap();
        let mut attacks = Vec::new();

        let mut zero_frame = valid.clone();
        zero_frame[72..76].copy_from_slice(&0u32.to_le_bytes());
        attacks.push(zero_frame);
        let mut next_past_end = valid.clone();
        next_past_end[68..72].copy_from_slice(&3u32.to_le_bytes());
        attacks.push(next_past_end);
        let mut pending_mismatch = valid.clone();
        pending_mismatch[16..20].copy_from_slice(&2u32.to_le_bytes());
        attacks.push(pending_mismatch);
        let mut invalid_bool = valid.clone();
        invalid_bool[64] = 2;
        attacks.push(invalid_bool);
        let mut reserved = valid.clone();
        reserved[67] = 1;
        attacks.push(reserved);
        let mut trailing = valid.clone();
        trailing.push(0xaa);
        attacks.push(trailing);
        let mut truncated = valid.clone();
        truncated.pop();
        attacks.push(truncated);
        let mut duplicate = valid.clone();
        let event_start = HEADER_LEN + FRAME_HEADER_LEN;
        let first_event =
            duplicate[event_start..event_start + super::super::INPUT_EVENT_SIZE].to_vec();
        duplicate[event_start + super::super::INPUT_EVENT_SIZE
            ..event_start + 2 * super::super::INPUT_EVENT_SIZE]
            .copy_from_slice(&first_event);
        attacks.push(duplicate);

        for payload in attacks {
            let mut target = partially_delivered(
                keyboard::keyboard_spec(),
                InputEvent::new(EV_KEY, keyboard::KEY_A, 1),
            );
            let before = encode(&target).unwrap();
            assert!(restore(&mut target, &payload).is_err());
            assert_eq!(encode(&target).unwrap(), before);
            assert_eq!(
                target.release_all().release_events,
                vec![
                    InputEvent::new(EV_KEY, keyboard::KEY_A, 0),
                    InputEvent::new(EV_SYN, SYN_REPORT, 0),
                ],
                "malformed restore cleared the intentionally unserialized delivered-key ledger"
            );
        }
    }

    #[test]
    fn verifier_release_all_precedes_saved_work_and_survives_host_pressure() {
        let mut target =
            InputState::new_with_capabilities(Box::new(super::super::NullStatusSink), None);
        for code in [keyboard::KEY_A, pointer::BTN_LEFT] {
            assert!(target.inject_event(EV_KEY, code, 1));
            target.sync();
            drain(&mut target);
        }

        let mut saved =
            InputState::new_with_capabilities(Box::new(super::super::NullStatusSink), None);
        assert!(saved.inject_event(super::super::EV_REL, pointer::REL_X, 9));
        saved.sync();
        let payload = saved.to_snapshot().unwrap();
        let report = target.restore_snapshot(&payload).unwrap();
        let releases = vec![
            InputEvent::new(EV_KEY, pointer::BTN_LEFT, 0),
            InputEvent::new(EV_KEY, keyboard::KEY_A, 0),
            InputEvent::new(EV_SYN, SYN_REPORT, 0),
        ];
        assert_eq!(report.release_events, releases);
        assert!(target.delivered_keys.is_empty());
        assert!(target.suppressed_keys.is_empty());
        assert!(target.release_all().release_events.is_empty());
        let reconciled = target.to_snapshot().unwrap();
        let mut replay =
            InputState::new_with_capabilities(Box::new(super::super::NullStatusSink), None);
        replay.restore_snapshot(&reconciled).unwrap();
        assert!(replay.pending_frames.front().unwrap().release_all);
        assert_eq!(replay.to_snapshot().unwrap(), reconciled);

        assert!(target.inject_event(EV_KEY, pointer::BTN_LEFT, 0));
        target.sync();
        assert_eq!(target.pending_frames.len(), 2);
        assert_eq!(target.pending_frames[1].events[0].value, 9);
        target.set_pending_event_budget(2);
        assert!(target.pending_frames.front().unwrap().release_all);
        assert_eq!(target.pending_frames.len(), 1);
        assert!(target.inject_event(EV_KEY, pointer::BTN_LEFT, 1));
        target.sync();
        assert!(target.suppressed_keys.contains(&pointer::BTN_LEFT));
        assert!(target.pending_frames.front().unwrap().release_all);
        assert_eq!(drain(&mut target), releases);
    }

    #[test]
    fn verifier_empty_restore_accepts_fresh_keyboard_tablet_and_mouse_frames() {
        let cases = [
            (
                keyboard::keyboard_spec(),
                InputEvent::new(EV_KEY, keyboard::KEY_A, 1),
            ),
            (
                pointer::tablet_spec(),
                InputEvent::new(super::super::EV_ABS, pointer::ABS_X, 32767),
            ),
            (
                pointer::mouse_spec(),
                InputEvent::new(super::super::EV_REL, pointer::REL_X, -11),
            ),
        ];
        for (spec, fresh) in cases {
            let empty = InputState::new_with_capabilities(
                Box::new(super::super::NullStatusSink),
                Some(spec.clone()),
            );
            let payload = empty.to_snapshot().unwrap();
            let mut restored = InputState::new_with_capabilities(
                Box::new(super::super::NullStatusSink),
                Some(spec),
            );
            restored.restore_snapshot(&payload).unwrap();
            assert!(restored.inject_event(fresh.event_type, fresh.code, fresh.value));
            restored.sync();
            assert_eq!(
                drain(&mut restored),
                vec![fresh, InputEvent::new(EV_SYN, SYN_REPORT, 0)]
            );
        }
    }

    #[test]
    fn verifier_total_serialized_event_cap_is_atomic_on_encode_and_decode() {
        const PENDING_EVENTS: usize = 32_768;
        const STAGED_EVENTS: usize = 32_768;

        let mut state =
            InputState::new_with_capabilities(Box::new(super::super::NullStatusSink), None);
        state.set_pending_event_budget(MAX_SNAPSHOT_BUDGET as usize);
        for value in 0..PENDING_EVENTS - 1 {
            assert!(state.inject_event(super::super::EV_REL, pointer::REL_X, value as i32));
        }
        state.sync();
        for value in 0..STAGED_EVENTS {
            assert!(state.inject_event(super::super::EV_REL, pointer::REL_X, value as i32));
        }
        let mut payload = state.to_snapshot().unwrap();

        assert!(state.inject_event(super::super::EV_REL, pointer::REL_X, STAGED_EVENTS as i32));
        match state.to_snapshot() {
            Err(error) => assert_eq!(
                error,
                InputSnapshotError::TooManyEvents {
                    found: (PENDING_EVENTS + STAGED_EVENTS + 1) as u32,
                    maximum: MAX_SNAPSHOT_EVENTS,
                }
            ),
            Ok(bytes) => panic!("oversized state encoded as {} bytes", bytes.len()),
        }

        let inserted =
            InputEvent::new(super::super::EV_REL, pointer::REL_X, STAGED_EVENTS as i32).to_bytes();
        let insert_at = HEADER_LEN + STAGED_EVENTS * super::super::INPUT_EVENT_SIZE;
        payload.splice(insert_at..insert_at, inserted);
        payload[24..28].copy_from_slice(&((STAGED_EVENTS + 1) as u32).to_le_bytes());
        payload[28..32].copy_from_slice(&((STAGED_EVENTS + 1) as u32).to_le_bytes());

        let mut target = partially_delivered(
            keyboard::keyboard_spec(),
            InputEvent::new(EV_KEY, keyboard::KEY_A, 1),
        );
        let before = target.to_snapshot().unwrap();
        match target.restore_snapshot(&payload) {
            Err(error) => assert_eq!(
                error,
                InputSnapshotError::TooManyEvents {
                    found: (PENDING_EVENTS + STAGED_EVENTS + 1) as u32,
                    maximum: MAX_SNAPSHOT_EVENTS,
                }
            ),
            Ok(_) => panic!("oversized payload restored successfully"),
        }
        assert_eq!(target.to_snapshot().unwrap(), before);
        assert_eq!(
            target.release_all().release_events,
            vec![
                InputEvent::new(EV_KEY, keyboard::KEY_A, 0),
                InputEvent::new(EV_SYN, SYN_REPORT, 0),
            ]
        );
    }

    fn fully_consumed_frame_at_serialized_cap() -> InputState {
        assert_eq!(MAX_SNAPSHOT_EVENTS, 65_536);
        let mut state =
            InputState::new_with_capabilities(Box::new(super::super::NullStatusSink), None);
        state.set_pending_event_budget(MAX_SNAPSHOT_BUDGET as usize);
        let events = (0..MAX_SNAPSHOT_EVENTS)
            .map(|value| InputEvent::new(super::super::EV_REL, pointer::REL_X, value as i32))
            .collect::<Vec<_>>();
        state.pending_frames.push_back(PendingFrame {
            next: events.len(),
            events,
            release_all: false,
        });
        state
    }

    #[test]
    fn verifier_fully_consumed_records_still_obey_total_serialized_cap() {
        let mut state = fully_consumed_frame_at_serialized_cap();
        let payload = state.to_snapshot().unwrap();

        let mut restored =
            InputState::new_with_capabilities(Box::new(super::super::NullStatusSink), None);
        restored.restore_snapshot(&payload).unwrap();
        assert_eq!(restored.pending_event_count, 0);
        assert_eq!(restored.to_snapshot().unwrap(), payload);

        state.staged_frame.push(InputEvent::new(
            super::super::EV_REL,
            pointer::REL_Y,
            i32::MIN,
        ));
        state.staged_event_count = 1;
        assert_eq!(
            state.to_snapshot(),
            Err(InputSnapshotError::TooManyEvents {
                found: MAX_SNAPSHOT_EVENTS + 1,
                maximum: MAX_SNAPSHOT_EVENTS,
            })
        );

        let mut oversized = payload;
        oversized.splice(
            HEADER_LEN..HEADER_LEN,
            InputEvent::new(super::super::EV_REL, pointer::REL_Y, i32::MIN).to_bytes(),
        );
        oversized[24..28].copy_from_slice(&1u32.to_le_bytes());
        oversized[28..32].copy_from_slice(&1u32.to_le_bytes());
        let mut target = partially_delivered(
            keyboard::keyboard_spec(),
            InputEvent::new(EV_KEY, keyboard::KEY_A, 1),
        );
        let before = target.to_snapshot().unwrap();
        assert_eq!(
            target.restore_snapshot(&oversized),
            Err(InputSnapshotError::TooManyEvents {
                found: MAX_SNAPSHOT_EVENTS + 1,
                maximum: MAX_SNAPSHOT_EVENTS,
            })
        );
        assert_eq!(target.to_snapshot().unwrap(), before);
        assert_eq!(
            target.release_all().release_events,
            vec![
                InputEvent::new(EV_KEY, keyboard::KEY_A, 0),
                InputEvent::new(EV_SYN, SYN_REPORT, 0),
            ]
        );
    }

    #[test]
    fn verifier_release_growth_at_serialized_cap_is_atomic() {
        let payload = fully_consumed_frame_at_serialized_cap()
            .to_snapshot()
            .unwrap();
        let mut target =
            InputState::new_with_capabilities(Box::new(super::super::NullStatusSink), None);
        for code in [keyboard::KEY_A, pointer::BTN_LEFT] {
            assert!(target.inject_event(EV_KEY, code, 1));
            target.sync();
            drain(&mut target);
        }
        let before = target.to_snapshot().unwrap();
        let delivered_before = target.delivered_keys.clone();
        let suppressed_before = target.suppressed_keys.clone();

        assert_eq!(
            target.restore_snapshot(&payload),
            Err(InputSnapshotError::TooManyEvents {
                found: MAX_SNAPSHOT_EVENTS + 3,
                maximum: MAX_SNAPSHOT_EVENTS,
            })
        );
        assert_eq!(target.to_snapshot().unwrap(), before);
        assert_eq!(target.delivered_keys, delivered_before);
        assert_eq!(target.suppressed_keys, suppressed_before);
    }
}
