//! One transient admission gate shared by a machine and its host-facing device handles.
//!
//! A replay's instruction fence cannot stop a caller holding an earlier UART or input-device
//! `Rc` from changing the saved machine. The gate follows those handles, but is deliberately
//! absent from guest checkpoints: only the replay driver may admit a recorded host callback.

use core::cell::Cell;

#[derive(Default)]
pub(crate) struct SessionIngressGate {
    replay: Cell<bool>,
    recorded: Cell<bool>,
}

impl SessionIngressGate {
    pub(crate) fn allows_host(&self) -> bool {
        !self.replay.get() || self.recorded.get()
    }

    pub(crate) fn begin_replay(&self) {
        self.replay.set(true);
    }

    pub(crate) fn recorded_scope(&self) -> RecordedIngress<'_> {
        assert!(self.replay.get(), "recorded ingress requires active replay");
        let previous = self.recorded.replace(true);
        RecordedIngress {
            gate: self,
            previous,
        }
    }
}

pub(crate) struct RecordedIngress<'a> {
    gate: &'a SessionIngressGate,
    previous: bool,
}

impl Drop for RecordedIngress<'_> {
    fn drop(&mut self) {
        self.gate.recorded.set(self.previous);
    }
}
