//! Exact session checkpoint family; legacy resume deliberately keeps its fresh-HELLO semantics.
use super::*;
use crate::resume::{Reader, SnapshotError, section};
const LIMIT: usize = 8 << 20;
const ITEMS: usize = 4096;
fn error() -> SnapshotError {
    SnapshotError::BadComponentState {
        tag: section::VIRTIO_CONSOLE,
    }
}
fn integer(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_le_bytes());
}
fn bytes(out: &mut Vec<u8>, value: &[u8]) {
    integer(out, value.len() as u64);
    out.extend_from_slice(value);
}
struct Cursor<'a>(&'a [u8]);
impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], SnapshotError> {
        let value = self.0.get(..n).ok_or_else(error)?;
        self.0 = &self.0[n..];
        Ok(value)
    }
    fn number(&mut self) -> Result<u64, SnapshotError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn count(&mut self, limit: usize) -> Result<usize, SnapshotError> {
        let value = self.number()?;
        if value > limit as u64 {
            return Err(error());
        }
        Ok(value as usize)
    }
    fn boolean(&mut self) -> Result<bool, SnapshotError> {
        match self.take(1)?[0] {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(error()),
        }
    }
    fn bytes(&mut self) -> Result<Vec<u8>, SnapshotError> {
        let count = self.count(LIMIT)?;
        Ok(self.take(count)?.to_vec())
    }
}
impl ConsoleState {
    pub(crate) fn snapshot_session_or_resume(
        &self,
        out: &mut Vec<u8>,
        exact: bool,
    ) -> Result<(), SnapshotError> {
        if !exact {
            self.snapshot_resume(out);
            return Ok(());
        }
        if [self.data_budget, self.control_budget, self.serial_budget]
            .into_iter()
            .any(|budget| budget > LIMIT)
            || [
                self.pending_control.len(),
                self.agent_input.len(),
                self.agent_output.len(),
                self.serial_output.len(),
            ]
            .into_iter()
            .any(|count| count > ITEMS)
        {
            return Err(error());
        }
        let start = out.len();
        out.extend_from_slice(b"WVCONX01");
        for value in self.kicked {
            out.push(u8::from(value));
        }
        for value in [
            self.reset_pending,
            self.resume_agent_tx_blocked,
            self.driver_ready,
            self.agent_announced,
            self.guest_ready,
            self.host_connected,
            self.guest_connected,
        ] {
            out.push(u8::from(value));
        }
        for value in [
            self.generation,
            self.application_hello_generation,
            self.restored_application_hello_generation,
            self.data_budget as u64,
            self.control_budget as u64,
            self.serial_budget as u64,
            self.malformed_controls,
            self.dropped_agent_input_bytes,
            self.dropped_agent_output_frames,
            self.dropped_agent_output_bytes,
            self.dropped_serial_output_frames,
        ] {
            integer(out, value);
        }
        integer(out, self.pending_control.len() as u64);
        for item in &self.pending_control {
            out.extend_from_slice(&item.header.to_bytes());
            bytes(out, &item.suffix);
        }
        integer(out, self.agent_input.len() as u64);
        for item in &self.agent_input {
            integer(out, item.offset as u64);
            bytes(out, &item.bytes);
        }
        for queue in [&self.agent_output, &self.serial_output] {
            integer(out, queue.len() as u64);
            for item in queue {
                bytes(out, item);
            }
        }
        let mut check = ConsoleState::new();
        check.restore_session_or_resume(
            &mut Reader::new(&out[start..], section::VIRTIO_CONSOLE),
            true,
        )?;
        Ok(())
    }
    pub(crate) fn restore_session_or_resume(
        &mut self,
        reader: &mut Reader<'_>,
        exact: bool,
    ) -> Result<(), SnapshotError> {
        if !exact {
            return self.restore_resume(reader);
        }
        let payload = reader.remaining_bytes()?;
        if payload.len() > LIMIT {
            return Err(error());
        }
        let mut cursor = Cursor(payload);
        if cursor.take(8)? != b"WVCONX01" {
            return Err(error());
        }
        let mut value = ConsoleState::new();
        for kick in &mut value.kicked {
            *kick = cursor.boolean()?;
        }
        value.reset_pending = cursor.boolean()?;
        value.resume_agent_tx_blocked = cursor.boolean()?;
        value.driver_ready = cursor.boolean()?;
        value.agent_announced = cursor.boolean()?;
        value.guest_ready = cursor.boolean()?;
        value.host_connected = cursor.boolean()?;
        value.guest_connected = cursor.boolean()?;
        if (value.agent_announced && !value.driver_ready)
            || (value.guest_ready && !value.agent_announced)
            || (value.guest_connected && !value.guest_ready)
        {
            return Err(error());
        }
        value.generation = cursor.number()?;
        value.application_hello_generation = cursor.number()?;
        value.restored_application_hello_generation = cursor.number()?;
        value.data_budget = cursor.count(LIMIT)?;
        value.control_budget = cursor.count(LIMIT)?;
        value.serial_budget = cursor.count(LIMIT)?;
        value.malformed_controls = cursor.number()?;
        value.dropped_agent_input_bytes = cursor.number()?;
        value.dropped_agent_output_frames = cursor.number()?;
        value.dropped_agent_output_bytes = cursor.number()?;
        value.dropped_serial_output_frames = cursor.number()?;
        for _ in 0..cursor.count(ITEMS)? {
            let header = ConsoleControl::from_bytes(cursor.take(8)?.try_into().unwrap());
            let item = PendingControl::new(header, cursor.bytes()?);
            value.pending_control_bytes += item.encoded_len();
            value.pending_control.push_back(item);
        }
        for _ in 0..cursor.count(ITEMS)? {
            let offset = cursor.count(LIMIT)?;
            let bytes = cursor.bytes()?;
            if offset > bytes.len() {
                return Err(error());
            }
            let item = PendingData { bytes, offset };
            value.agent_input_bytes += item.remaining();
            value.agent_input.push_back(item);
        }
        for (queue, count) in [
            (&mut value.agent_output, &mut value.agent_output_bytes),
            (&mut value.serial_output, &mut value.serial_output_bytes),
        ] {
            for _ in 0..cursor.count(ITEMS)? {
                let bytes = cursor.bytes()?;
                *count += bytes.len();
                queue.push_back(bytes);
            }
        }
        if !cursor.0.is_empty()
            || value.pending_control_bytes > value.control_budget
            || value.agent_input_bytes > value.data_budget
            || value.agent_output_bytes > value.data_budget
            || value.serial_output_bytes > value.serial_budget
        {
            return Err(error());
        }
        *self = value;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn encoded(state: &ConsoleState) -> Vec<u8> {
        let mut bytes = Vec::new();
        state.snapshot_session_or_resume(&mut bytes, true).unwrap();
        bytes
    }
    #[test]
    fn exact_console_partial_queues_and_refusals() {
        let mut source = ConsoleState::new();
        source.driver_ready = true;
        source.agent_announced = true;
        source.guest_ready = true;
        source.guest_connected = true;
        source.generation = u64::MAX;
        source.application_hello_generation = 9_007_199_254_740_993;
        source.kicked = [true, false, true, false, true, false];
        source.reset_pending = true;
        source.pending_control.push_back(PendingControl::new(
            ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_OPEN, 1),
            vec![7, 8],
        ));
        source.pending_control_bytes = 10;
        source.agent_input.push_back(PendingData {
            bytes: b"old-prefix remaining".to_vec(),
            offset: 11,
        });
        source.agent_input_bytes = 9;
        source.agent_output.push_back(b"agent output".to_vec());
        source.agent_output_bytes = 12;
        source.serial_output.push_back(b"serial output".to_vec());
        source.serial_output_bytes = 13;
        let bytes = encoded(&source);
        let mut target = ConsoleState::new();
        target
            .restore_session_or_resume(&mut Reader::new(&bytes, section::VIRTIO_CONSOLE), true)
            .unwrap();
        assert_eq!(encoded(&target), bytes);
        for length in 0..bytes.len() {
            assert!(
                target
                    .restore_session_or_resume(
                        &mut Reader::new(&bytes[..length], section::VIRTIO_CONSOLE),
                        true
                    )
                    .is_err()
            );
            assert_eq!(encoded(&target), bytes);
        }
        let mut bad = bytes.clone();
        bad[8] = 2;
        assert!(
            target
                .restore_session_or_resume(&mut Reader::new(&bad, section::VIRTIO_CONSOLE), true)
                .is_err()
        );
        assert_eq!(encoded(&target), bytes);
        let mut bad = bytes.clone();
        bad.push(0);
        assert!(
            target
                .restore_session_or_resume(&mut Reader::new(&bad, section::VIRTIO_CONSOLE), true)
                .is_err()
        );
        assert_eq!(encoded(&target), bytes);
    }
}
