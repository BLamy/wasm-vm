//! Pure queue/bounds state for the browser WebSocket adapter. Keeping this independent of web-sys
//! makes every hostile-message and failure branch deterministic under native unit tests; the JS
//! callbacks in `ws_transport` are then thin adapters that call these methods.

use std::collections::VecDeque;

use wasm_vm_slirp::ws_proxy::Frame;

pub(crate) const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_INBOUND_BYTES: usize = 32 * 1024 * 1024;
pub(crate) const MAX_OUTBOUND_BYTES: usize = 4 * 1024 * 1024;

#[derive(Default)]
pub(crate) struct TransportState {
    inbound: VecDeque<(Frame, usize)>,
    inbound_bytes: usize,
    outbound: VecDeque<Vec<u8>>,
    outbound_bytes: usize,
    failed: bool,
}

impl TransportState {
    /// Validate, decode, and queue one WS binary message. Any malformed/oversized message poisons
    /// the transport; overflowing the aggregate cap also clears retained input immediately.
    pub(crate) fn accept_inbound(&mut self, bytes: &[u8]) {
        if bytes.len() > MAX_MESSAGE_BYTES {
            self.failed = true;
            return;
        }
        let Some(frame) = Frame::decode(bytes) else {
            self.failed = true;
            return;
        };
        if self.inbound_bytes.saturating_add(bytes.len()) > MAX_INBOUND_BYTES {
            self.failed = true;
            self.inbound.clear();
            self.inbound_bytes = 0;
            return;
        }
        self.inbound_bytes += bytes.len();
        self.inbound.push_back((frame, bytes.len()));
    }

    /// Encode and queue one outbound frame under the aggregate cap.
    pub(crate) fn queue_outbound(&mut self, frame: Frame) {
        let Some(bytes) = frame.encode() else {
            self.failed = true;
            return;
        };
        if self.outbound_bytes.saturating_add(bytes.len()) > MAX_OUTBOUND_BYTES {
            self.failed = true;
            self.outbound.clear();
            self.outbound_bytes = 0;
            return;
        }
        self.outbound_bytes += bytes.len();
        self.outbound.push_back(bytes);
    }

    pub(crate) fn pop_outbound(&mut self) -> Option<Vec<u8>> {
        let bytes = self.outbound.pop_front()?;
        self.outbound_bytes = self.outbound_bytes.saturating_sub(bytes.len());
        Some(bytes)
    }

    pub(crate) fn drain_inbound(&mut self) -> Vec<Frame> {
        self.inbound_bytes = 0;
        self.inbound.drain(..).map(|(frame, _)| frame).collect()
    }

    /// Shared target for both `onerror` and `onclose`: either event makes every live connector flow
    /// fail on its next poll.
    pub(crate) fn mark_failed(&mut self) {
        self.failed = true;
    }

    pub(crate) fn failed(&self) -> bool {
        self.failed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(payload_len: usize) -> Frame {
        Frame::Data {
            stream: 1,
            bytes: vec![0x5a; payload_len],
        }
    }

    #[test]
    fn malformed_and_oversized_inbound_messages_fail_closed() {
        let mut malformed = TransportState::default();
        malformed.accept_inbound(&[1, 2, 3]);
        assert!(malformed.failed());

        let mut oversized = TransportState::default();
        oversized.accept_inbound(&vec![0; MAX_MESSAGE_BYTES + 1]);
        assert!(oversized.failed());
    }

    #[test]
    fn inbound_aggregate_cap_is_hard_and_clears_retained_frames() {
        let frame = data(MAX_MESSAGE_BYTES - 5).encode().unwrap();
        assert_eq!(frame.len(), MAX_MESSAGE_BYTES);
        let mut state = TransportState::default();
        for _ in 0..32 {
            state.accept_inbound(&frame);
            assert!(!state.failed());
        }
        state.accept_inbound(&frame);
        assert!(state.failed());
        assert!(
            state.drain_inbound().is_empty(),
            "overflow clears the 32 MiB queue"
        );
    }

    #[test]
    fn outbound_aggregate_cap_is_hard_and_clears_retained_frames() {
        let mut state = TransportState::default();
        let frame = data(MAX_MESSAGE_BYTES - 5);
        for _ in 0..4 {
            state.queue_outbound(frame.clone());
            assert!(!state.failed());
        }
        state.queue_outbound(Frame::Data {
            stream: 1,
            bytes: vec![1],
        });
        assert!(state.failed());
        assert!(
            state.pop_outbound().is_none(),
            "overflow clears the 4 MiB queue"
        );
    }

    #[test]
    fn drain_resets_accounting_and_close_or_error_marks_failed() {
        let mut state = TransportState::default();
        let frame = Frame::OpenOk { stream: 3 };
        state.accept_inbound(&frame.encode().unwrap());
        assert_eq!(state.drain_inbound(), vec![frame]);
        // Reusing the full budget after drain proves inbound byte accounting reset.
        let full = data(MAX_MESSAGE_BYTES - 5).encode().unwrap();
        for _ in 0..32 {
            state.accept_inbound(&full);
        }
        assert!(!state.failed());
        state.mark_failed(); // exact callback target shared by browser onclose/onerror
        assert!(state.failed());
    }
}
