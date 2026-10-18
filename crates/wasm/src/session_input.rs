//! E9-T10: synchronous, owned host-input adapters. No browser timestamps are ordering keys.
//! The input-only prefix deliberately does not qualify time, async devices, or network replay.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
use crate::browser_file_transfer::{BrowserFileTransfers, parse_sha256};
use std::{cell::RefCell, collections::VecDeque, rc::Rc};
use wasm_vm_core::{
    Machine,
    dev::uart16550::Uart16550,
    session_clock::{MAX_PAYLOAD, SessionEffect},
};

pub(crate) const UART_OFFER: u16 = 1;
pub(crate) const UART_FEED: u16 = 2;
pub(crate) const KEY: u16 = 3;
pub(crate) const KEY_SYNC: u16 = 4;
pub(crate) const TABLET: u16 = 5;
pub(crate) const TABLET_SYNC: u16 = 6;
pub(crate) const MOUSE: u16 = 7;
pub(crate) const MOUSE_SYNC: u16 = 8;
pub(crate) const DISPLAY: u16 = 9;
pub(crate) const AGENT: u16 = 10;
pub(crate) const HELLO: u16 = 11;
pub(crate) const UPLOAD_BEGIN: u16 = 12;
pub(crate) const UPLOAD_PUSH: u16 = 13;
pub(crate) const UPLOAD_CANCEL: u16 = 14;
pub(crate) const POINTER_MODE: u16 = 15;
pub(crate) const LIFECYCLE: u16 = 16;
pub(crate) const MAX_UART_PENDING: usize = 1 << 20;
// status: 0 applied, 1 refused/failed, 2 accepted prefix, 3 capability rejected, 4 frame drop policy.
pub(crate) type Outcome = [u64; 4];

pub(crate) fn event_bytes(event_type: u16, code: u16, value: i32) -> Vec<u8> {
    [
        event_type.to_le_bytes().as_slice(),
        code.to_le_bytes().as_slice(),
        value.to_le_bytes().as_slice(),
    ]
    .concat()
}
fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap())
}
pub(crate) fn validate(channel: u16, bytes: &[u8]) -> Result<(), &'static str> {
    if bytes.len() > MAX_PAYLOAD {
        return Err("input payload exceeds 1 MiB");
    }
    let valid = match channel {
        UART_OFFER | AGENT => true,
        UART_FEED => !bytes.is_empty() && bytes.len() <= 16,
        KEY | TABLET | MOUSE => bytes.len() == 8,
        HELLO => bytes.is_empty(),
        KEY_SYNC | TABLET_SYNC | MOUSE_SYNC => {
            if bytes.len() < 12 {
                false
            } else {
                let accepted = u64::from_le_bytes(bytes[..8].try_into().unwrap());
                let retained = u32_at(bytes, 8) as usize;
                retained as u64 <= accepted
                    && bytes.len() as u64 == 12 + (retained as u64 + u64::from(accepted != 0)) * 8
                    && (accepted == 0 || bytes[bytes.len() - 8..] == [0; 8])
            }
        }
        DISPLAY => {
            bytes.len() == 8
                && (1..=4095).contains(&u32_at(bytes, 0))
                && (1..=4095).contains(&u32_at(bytes, 4))
        }
        UPLOAD_BEGIN => {
            bytes.len() >= 40 && bytes.len() <= 295 && std::str::from_utf8(&bytes[40..]).is_ok()
        }
        UPLOAD_PUSH => bytes.len() >= 5 && bytes[4] <= 1,
        UPLOAD_CANCEL => bytes.len() == 4,
        POINTER_MODE => bytes.len() == 1 && bytes[0] <= 1,
        LIFECYCLE => bytes.len() == 1 && bytes[0] <= 2,
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err("unsupported or malformed input operation")
    }
}

pub(crate) struct InputCapture {
    pub replay: bool,
    pub paused: bool,
    pub stopped: bool,
}
impl InputCapture {
    pub fn new(replay: bool) -> Self {
        Self {
            replay,
            paused: true,
            stopped: false,
        }
    }
    pub fn apply(
        &mut self,
        context: InputContext<'_>,
        channel: u16,
        bytes: &[u8],
        recorded: bool,
    ) -> Result<Outcome, String> {
        if self.stopped {
            return Err("input prefix is stopped".into());
        }
        if recorded != self.replay {
            return Err("live input is forbidden during replay".into());
        }
        let normalized;
        let bytes = if !recorded && matches!(channel, KEY_SYNC | TABLET_SYNC | MOUSE_SYNC) {
            let state = match channel {
                KEY_SYNC => context.machine.keyboard_input(),
                TABLET_SYNC => context.machine.tablet_input(),
                _ => context.machine.mouse_input(),
            };
            normalized = state
                .map_or_else(
                    || Some(vec![0; 12]),
                    |state| state.borrow().session_host_frame(),
                )
                .ok_or("input frame exceeds capture budget")?;
            normalized.as_slice()
        } else {
            bytes
        };
        validate(channel, bytes).map_err(str::to_owned)?;
        if context.machine.session_pending_events() != 0 {
            return Err("input boundary already has staged work".into());
        }
        let position = context
            .machine
            .session_position()
            .ok_or("input clock is inactive")?;
        context
            .machine
            .stage_session_effect(
                position.transition,
                SessionEffect::HostInput {
                    channel,
                    bytes: bytes.to_vec(),
                },
            )
            .map_err(|e| format!("input reserve: {e:?}"))?;
        let InputContext {
            machine,
            pending,
            uart,
            mut transfers,
        } = context;
        let mut result = [1, 0, 0, 0];
        machine
            .deliver_session_host_boundary(|machine, channel, bytes| {
                result = apply(
                    machine,
                    pending,
                    uart,
                    transfers.as_deref_mut(),
                    channel,
                    bytes,
                );
                result
            })
            .map_err(|e| format!("input delivery: {e:?}"))?;
        if channel == LIFECYCLE && result[0] == 0 {
            match bytes[0] {
                0 => self.paused = true,
                1 => self.paused = false,
                2 => {
                    self.paused = true;
                    self.stopped = true
                }
                _ => unreachable!(),
            }
        }
        Ok(result)
    }
}
pub(crate) struct InputContext<'a> {
    pub machine: &'a mut Machine,
    pub pending: &'a mut VecDeque<u8>,
    pub uart: &'a Rc<RefCell<Uart16550>>,
    pub transfers: Option<&'a mut BrowserFileTransfers>,
}
pub(crate) fn apply(
    machine: &mut Machine,
    pending: &mut VecDeque<u8>,
    uart: &Rc<RefCell<Uart16550>>,
    transfers: Option<&mut BrowserFileTransfers>,
    channel: u16,
    bytes: &[u8],
) -> Outcome {
    // The decoder also protects restored opaque mailbox entries; no unchecked slice is read.
    if validate(channel, bytes).is_err() {
        return [1, 0, 0, 0];
    }
    match channel {
        UART_OFFER => {
            if pending.len().saturating_add(bytes.len()) > MAX_UART_PENDING {
                return [1, 0, pending.len() as u64, 0];
            }
            pending.extend(bytes);
            [0, bytes.len() as u64, pending.len() as u64, 0]
        }
        UART_FEED => {
            if uart.borrow().rx_free() < bytes.len()
                || pending
                    .iter()
                    .take(bytes.len())
                    .copied()
                    .ne(bytes.iter().copied())
                || pending.len() < bytes.len()
            {
                return [1, 0, 0, 0];
            }
            uart.borrow_mut().push_input(bytes);
            pending.drain(..bytes.len());
            [0, bytes.len() as u64, pending.len() as u64, 0]
        }
        KEY | KEY_SYNC | TABLET | TABLET_SYNC | MOUSE | MOUSE_SYNC => {
            let state = match channel {
                KEY | KEY_SYNC => machine.keyboard_input(),
                TABLET | TABLET_SYNC => machine.tablet_input(),
                _ => machine.mouse_input(),
            };
            let Some(state) = state else {
                return [1, 0, 0, 0];
            };
            let mut state = state.borrow_mut();
            if matches!(channel, KEY_SYNC | TABLET_SYNC | MOUSE_SYNC) {
                if state.session_host_frame().as_deref() != Some(bytes) {
                    return [1, 0, 0, 0];
                }
                let before = state.dropped_frames;
                state.sync();
                return [
                    if state.dropped_frames == before { 0 } else { 4 },
                    state.pending_events() as u64,
                    state.dropped_frames,
                    state.dropped_events,
                ];
            }
            let accepted = {
                state.inject_event(
                    u16::from_le_bytes(bytes[0..2].try_into().unwrap()),
                    u16::from_le_bytes(bytes[2..4].try_into().unwrap()),
                    i32::from_le_bytes(bytes[4..8].try_into().unwrap()),
                )
            };
            [
                if accepted { 0 } else { 3 },
                state.pending_events() as u64,
                state.dropped_frames,
                state.rejected_events,
            ]
        }
        DISPLAY => {
            let Some((_, state)) = machine.virtio_gpu() else {
                return [1, 0, 0, 0];
            };
            state
                .borrow_mut()
                .set_display(u32_at(bytes, 0), u32_at(bytes, 4));
            [0, 1, 0, 0]
        }
        AGENT => {
            let Some(state) = machine.virtio_console() else {
                return [1, 0, 0, 0];
            };
            let accepted = state.borrow_mut().enqueue_agent_input(bytes);
            [
                if accepted == bytes.len() { 0 } else { 2 },
                accepted as u64,
                0,
                0,
            ]
        }
        HELLO => [
            if machine.confirm_virtio_console_agent_hello().is_some() {
                0
            } else {
                1
            },
            0,
            0,
            0,
        ],
        UPLOAD_BEGIN => {
            let Some(transfers) = transfers else {
                return [1, 0, 0, 0];
            };
            match transfers.begin_upload(
                u32_at(bytes, 0) as usize,
                String::from_utf8(bytes[40..].to_vec()).unwrap(),
                u64::from(u32_at(bytes, 4)),
                bytes[8..40].try_into().unwrap(),
            ) {
                Ok(stream) => [0, u64::from(stream), 0, 0],
                Err(error) => [1, 0, 0, error as u64],
            }
        }
        UPLOAD_PUSH => {
            let Some(transfers) = transfers else {
                return [1, 0, 0, 0];
            };
            match transfers.push_upload(u32_at(bytes, 0), &bytes[5..], bytes[4] != 0) {
                Ok(buffered) => [0, (bytes.len() - 5) as u64, buffered as u64, 0],
                Err(error) => [1, 0, 0, error as u64],
            }
        }
        UPLOAD_CANCEL => {
            let Some(transfers) = transfers else {
                return [1, 0, 0, 0];
            };
            match transfers.cancel(u32_at(bytes, 0)) {
                Ok(()) => [0, 0, 0, 0],
                Err(error) => [1, 0, 0, error as u64],
            }
        }
        POINTER_MODE | LIFECYCLE => [0, u64::from(bytes[0]), 0, 0],
        _ => [1, 0, 0, 0],
    }
}

pub(crate) fn upload_begin(
    slot: u32,
    name: &str,
    total: u32,
    sha: &str,
) -> Result<Vec<u8>, String> {
    if name.len() > 255 {
        return Err("file name exceeds 255 bytes".into());
    }
    let hash = parse_sha256(sha).map_err(|e| format!("file upload SHA-256: {e:?}"))?;
    Ok([
        slot.to_le_bytes().as_slice(),
        total.to_le_bytes().as_slice(),
        hash.as_slice(),
        name.as_bytes(),
    ]
    .concat())
}

// The browser boundary is deliberately thin; the native adapter above is used unchanged in tests.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod browser;

#[cfg(test)]
mod tests;
