//! Virtio-console multiport transport (E5-T23b).
//!
//! The device exposes the standard virtio-console port-0 pair, the two control queues, and one
//! additional port (`org.wasmvm.agent`).  The UART at `UART0_BASE` remains a separate MMIO device;
//! nothing in this module aliases its queue state or output sink.
//!
//! Control packets use the non-legacy little-endian layout from virtio 1.2:
//! `{ le32 id, le16 event, le16 value }`.  A port name is the UTF-8 byte string immediately after
//! its `PORT_NAME` header.  Descriptor chains are bounded by the shared virtqueue walker; malformed
//! application payloads are consumed with a zero used length and counted, while malformed ring
//! shapes take the existing virtio-mmio `NEEDS_RESET` path.

use alloc::collections::VecDeque;
use alloc::rc::Rc;
use alloc::vec::Vec;
use core::cell::RefCell;

use super::VirtioDevice;
use super::mmio::VirtioMmio;
use super::queue::{DescriptorChain, Virtqueue};
use crate::bus::Bus;
use crate::mmio::SystemBus;

/// Virtio device id assigned to a console device.
pub const VIRTIO_CONSOLE_DEVICE_ID: u32 = 3;

/// Device feature bits from virtio-console §5.3.3.
pub const VIRTIO_CONSOLE_F_SIZE: u64 = 1 << 0;
pub const VIRTIO_CONSOLE_F_MULTIPORT: u64 = 1 << 1;
pub const VIRTIO_CONSOLE_F_EMERG_WRITE: u64 = 1 << 2;

/// Virtio-console queue numbers from §5.3.2.  Port 0 always exists; the agent is port 1.
pub const PORT0_RECEIVE_QUEUE: u32 = 0;
pub const PORT0_TRANSMIT_QUEUE: u32 = 1;
pub const CONTROL_RECEIVE_QUEUE: u32 = 2;
pub const CONTROL_TRANSMIT_QUEUE: u32 = 3;
pub const AGENT_RECEIVE_QUEUE: u32 = 4;
pub const AGENT_TRANSMIT_QUEUE: u32 = 5;
pub const NUM_QUEUES: u32 = AGENT_TRANSMIT_QUEUE + 1;

/// The E5 platform keeps port 0 available for the standard virtio-console console and reserves
/// the last virtio-mmio slot for the generic agent port.  UART0 remains at its established address.
pub const VIRTIO_CONSOLE_SLOT: usize = 7;

/// Port number and stable name used by the guest agent channel.
pub const AGENT_PORT_ID: u32 = 1;
pub const AGENT_PORT_NAME: &str = "org.wasmvm.agent";

/// Fixed control header size.
pub const CONTROL_MESSAGE_BYTES: usize = 8;
/// The largest application data frame accepted into one host-side queue entry.
pub const MAX_DATA_FRAME_BYTES: usize = 1 << 20;
/// Default total bytes retained per direction of the agent port.
pub const DEFAULT_DATA_BUDGET: usize = 1 << 20;
/// Control messages are tiny, but a finite budget makes announcement storms bounded too.
pub const DEFAULT_CONTROL_BUDGET: usize = 4096;
/// Default port-0 output budget.  It is independent from the agent budget by construction.
pub const DEFAULT_SERIAL_BUDGET: usize = 64 * 1024;

/// Virtio-console control events from Linux's `virtio_console.h` / virtio 1.2 §5.3.6.2.
pub const VIRTIO_CONSOLE_DEVICE_READY: u16 = 0;
pub const VIRTIO_CONSOLE_PORT_ADD: u16 = 1;
pub const VIRTIO_CONSOLE_DEVICE_ADD: u16 = VIRTIO_CONSOLE_PORT_ADD;
pub const VIRTIO_CONSOLE_PORT_REMOVE: u16 = 2;
pub const VIRTIO_CONSOLE_DEVICE_REMOVE: u16 = VIRTIO_CONSOLE_PORT_REMOVE;
pub const VIRTIO_CONSOLE_PORT_READY: u16 = 3;
pub const VIRTIO_CONSOLE_CONSOLE_PORT: u16 = 4;
pub const VIRTIO_CONSOLE_RESIZE: u16 = 5;
pub const VIRTIO_CONSOLE_PORT_OPEN: u16 = 6;
pub const VIRTIO_CONSOLE_PORT_NAME: u16 = 7;

/// One fixed-size virtio-console control header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConsoleControl {
    pub id: u32,
    pub event: u16,
    pub value: u16,
}

impl ConsoleControl {
    pub const fn new(id: u32, event: u16, value: u16) -> Self {
        Self { id, event, value }
    }

    pub fn to_bytes(self) -> [u8; CONTROL_MESSAGE_BYTES] {
        let mut out = [0u8; CONTROL_MESSAGE_BYTES];
        out[0..4].copy_from_slice(&self.id.to_le_bytes());
        out[4..6].copy_from_slice(&self.event.to_le_bytes());
        out[6..8].copy_from_slice(&self.value.to_le_bytes());
        out
    }

    pub fn from_bytes(bytes: &[u8; CONTROL_MESSAGE_BYTES]) -> Self {
        Self {
            id: u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            event: u16::from_le_bytes([bytes[4], bytes[5]]),
            value: u16::from_le_bytes([bytes[6], bytes[7]]),
        }
    }
}

#[derive(Debug)]
struct PendingControl {
    header: ConsoleControl,
    suffix: Vec<u8>,
}

impl PendingControl {
    fn new(header: ConsoleControl, suffix: Vec<u8>) -> Self {
        Self { header, suffix }
    }

    fn encoded_len(&self) -> usize {
        CONTROL_MESSAGE_BYTES + self.suffix.len()
    }

    fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(self.encoded_len());
        bytes.extend_from_slice(&self.header.to_bytes());
        bytes.extend_from_slice(&self.suffix);
        bytes
    }
}

#[derive(Debug)]
struct PendingData {
    bytes: Vec<u8>,
    offset: usize,
}

impl PendingData {
    fn new(bytes: Vec<u8>) -> Self {
        Self { bytes, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }
}

/// Host-owned state shared by the virtio-console device and the run-loop queue service.
pub struct ConsoleState {
    kicked: [bool; NUM_QUEUES as usize],
    reset_pending: bool,
    driver_ready: bool,
    agent_announced: bool,
    guest_ready: bool,
    host_connected: bool,
    guest_connected: bool,
    generation: u64,
    pending_control: VecDeque<PendingControl>,
    pending_control_bytes: usize,
    agent_input: VecDeque<PendingData>,
    agent_input_bytes: usize,
    agent_output: VecDeque<Vec<u8>>,
    agent_output_bytes: usize,
    serial_output: VecDeque<Vec<u8>>,
    serial_output_bytes: usize,
    data_budget: usize,
    control_budget: usize,
    serial_budget: usize,
    /// Application-level malformed control payloads.  Ring violations use the transport counter.
    pub malformed_controls: u64,
    /// Input bytes rejected because the agent port was closed or its bounded buffer was full.
    pub dropped_agent_input_bytes: u64,
    /// Complete guest-to-host agent frames rejected by close, oversize, or backpressure.
    pub dropped_agent_output_frames: u64,
    pub dropped_agent_output_bytes: u64,
    /// Port-0 output frames rejected by its own bounded sink.
    pub dropped_serial_output_frames: u64,
}

impl ConsoleState {
    fn new() -> Self {
        Self {
            kicked: [false; NUM_QUEUES as usize],
            reset_pending: false,
            driver_ready: false,
            agent_announced: false,
            guest_ready: false,
            // The host-side agent endpoint exists as soon as the device is assembled.  The guest
            // still has to complete DEVICE_READY → PORT_READY → PORT_OPEN before data flows.
            host_connected: true,
            guest_connected: false,
            generation: 0,
            pending_control: VecDeque::new(),
            pending_control_bytes: 0,
            agent_input: VecDeque::new(),
            agent_input_bytes: 0,
            agent_output: VecDeque::new(),
            agent_output_bytes: 0,
            serial_output: VecDeque::new(),
            serial_output_bytes: 0,
            data_budget: DEFAULT_DATA_BUDGET,
            control_budget: DEFAULT_CONTROL_BUDGET,
            serial_budget: DEFAULT_SERIAL_BUDGET,
            malformed_controls: 0,
            dropped_agent_input_bytes: 0,
            dropped_agent_output_frames: 0,
            dropped_agent_output_bytes: 0,
            dropped_serial_output_frames: 0,
        }
    }

    /// True only after both the guest and host have opened the named agent port.
    pub fn agent_open(&self) -> bool {
        self.host_connected && self.guest_connected
    }

    /// True only when the virtio-console device and named agent port completed the existing T23e
    /// device/port readiness handshake. Desktop restore uses this as its liveness fence; a
    /// serialized generation never stands in for a live channel.
    pub fn agent_ready_for_restore(&self) -> bool {
        self.driver_ready && self.agent_announced && self.guest_ready && self.agent_open()
    }

    pub fn agent_announced(&self) -> bool {
        self.agent_announced
    }

    pub fn agent_guest_ready(&self) -> bool {
        self.guest_ready
    }

    pub fn host_connected(&self) -> bool {
        self.host_connected
    }

    /// Monotonic transport generation.  A restart/reset always changes it, which gives host code a
    /// cheap way to discard handles or in-flight application state from an older port incarnation.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn pending_control_messages(&self) -> usize {
        self.pending_control.len()
    }

    pub fn agent_input_bytes(&self) -> usize {
        self.agent_input_bytes
    }

    pub fn agent_output_bytes(&self) -> usize {
        self.agent_output_bytes
    }

    pub fn serial_output_bytes(&self) -> usize {
        self.serial_output_bytes
    }

    pub fn set_data_budget(&mut self, budget: usize) {
        self.data_budget = budget;
        self.trim_agent_input();
        self.trim_agent_output();
    }

    pub fn data_budget(&self) -> usize {
        self.data_budget
    }

    /// Host-side endpoint state transition.  Closing drops only agent data; port-0 output has its
    /// own buffer and therefore cannot be starved or accidentally cleared by an agent restart.
    pub fn set_host_connected(&mut self, connected: bool) {
        if self.host_connected == connected {
            return;
        }
        self.host_connected = connected;
        self.guest_connected = false;
        self.clear_agent_data();
        if self.driver_ready && self.agent_announced && self.guest_ready {
            self.queue_control(PendingControl::new(
                ConsoleControl::new(
                    AGENT_PORT_ID,
                    VIRTIO_CONSOLE_PORT_OPEN,
                    u16::from(connected),
                ),
                Vec::new(),
            ));
        }
    }

    /// Drop the current named-port incarnation and announce a fresh one.  This is the deterministic
    /// test seam used by the later host reconnect slice; no old data or queue ownership survives.
    pub fn restart_agent_port(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.agent_announced = false;
        self.guest_ready = false;
        self.guest_connected = false;
        self.clear_agent_data();
        self.pending_control.clear();
        self.pending_control_bytes = 0;
        self.announce_agent_if_ready();
    }

    /// Re-fence a live agent channel at a desktop restore commit. The endpoint stays open, but
    /// pre-restore application bytes are discarded and a fresh generation plus close/open control
    /// pair tells the guest agent to restart its session-level HELLO handling.
    pub fn restore_rehandshake(&mut self) -> Option<u64> {
        if !self.agent_ready_for_restore() {
            return None;
        }
        self.generation = self.generation.wrapping_add(1);
        self.clear_agent_data();
        self.pending_control.clear();
        self.pending_control_bytes = 0;
        self.queue_control(PendingControl::new(
            ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_OPEN, 0),
            Vec::new(),
        ));
        self.queue_control(PendingControl::new(
            ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_OPEN, 1),
            Vec::new(),
        ));
        Some(self.generation)
    }

    /// Enqueue host-to-guest bytes.  A partial final chunk is accepted only up to the bounded
    /// budget; the accepted prefix is never reordered or silently synthesized.
    pub fn enqueue_agent_input(&mut self, bytes: &[u8]) -> usize {
        if bytes.is_empty() {
            return 0;
        }
        if !self.agent_open() {
            self.dropped_agent_input_bytes = self
                .dropped_agent_input_bytes
                .saturating_add(bytes.len() as u64);
            return 0;
        }
        let room = self.data_budget.saturating_sub(self.agent_input_bytes);
        let accepted = room.min(bytes.len());
        if accepted != 0 {
            self.agent_input
                .push_back(PendingData::new(bytes[..accepted].to_vec()));
            self.agent_input_bytes += accepted;
            self.mark_queue_kick(AGENT_RECEIVE_QUEUE);
        }
        self.dropped_agent_input_bytes = self
            .dropped_agent_input_bytes
            .saturating_add((bytes.len() - accepted) as u64);
        accepted
    }

    /// Drain complete guest-to-host agent frames in FIFO order.
    pub fn take_agent_output(&mut self) -> Vec<u8> {
        let output = take_frames(&mut self.agent_output, &mut self.agent_output_bytes);
        // A descriptor may have remained posted while the bounded output queue was full.  Draining
        // it is the host-side completion signal, so arrange for the next run boundary to retry it.
        self.mark_queue_kick(AGENT_TRANSMIT_QUEUE);
        output
    }

    /// Drain port-0 output independently from agent output.  This is a test/embedding seam; the
    /// established UART device remains at `UART0_BASE` and does not use this queue.
    pub fn take_serial_output(&mut self) -> Vec<u8> {
        take_frames(&mut self.serial_output, &mut self.serial_output_bytes)
    }

    fn mark_queue_kick(&mut self, queue: u32) {
        if let Some(kicked) = self.kicked.get_mut(queue as usize) {
            *kicked = true;
        }
    }

    fn take_work(&mut self) -> ([bool; NUM_QUEUES as usize], bool) {
        let kicked = self.kicked;
        self.kicked = [false; NUM_QUEUES as usize];
        let pending = !self.pending_control.is_empty()
            || self.agent_input_bytes != 0
            || (self.agent_open() && self.agent_output_bytes < self.data_budget);
        (kicked, pending)
    }

    fn take_reset_pending(&mut self) -> bool {
        let pending = self.reset_pending;
        self.reset_pending = false;
        pending
    }

    fn queue_control(&mut self, packet: PendingControl) {
        let len = packet.encoded_len();
        if len > self.control_budget
            || self.pending_control_bytes.saturating_add(len) > self.control_budget
        {
            self.malformed_controls = self.malformed_controls.saturating_add(1);
            return;
        }
        self.pending_control_bytes += len;
        self.pending_control.push_back(packet);
        self.mark_queue_kick(CONTROL_RECEIVE_QUEUE);
    }

    fn announce_agent_if_ready(&mut self) {
        if !self.driver_ready || self.agent_announced {
            return;
        }
        self.agent_announced = true;
        self.queue_control(PendingControl::new(
            ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_ADD, 0),
            Vec::new(),
        ));
        self.queue_control(PendingControl::new(
            ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_NAME, 0),
            AGENT_PORT_NAME.as_bytes().to_vec(),
        ));
    }

    fn handle_driver_control(&mut self, control: ConsoleControl) {
        match control.event {
            VIRTIO_CONSOLE_DEVICE_READY => {
                if control.value == 1 {
                    self.driver_ready = true;
                    self.announce_agent_if_ready();
                } else if control.value == 0 {
                    self.driver_ready = false;
                    self.agent_announced = false;
                    self.guest_ready = false;
                    self.guest_connected = false;
                    self.clear_agent_data();
                    self.pending_control.clear();
                    self.pending_control_bytes = 0;
                } else {
                    self.note_malformed_control();
                }
            }
            VIRTIO_CONSOLE_PORT_READY => {
                if control.id != AGENT_PORT_ID || !self.agent_announced {
                    self.note_malformed_control();
                    return;
                }
                if control.value == 1 {
                    self.guest_ready = true;
                    if self.host_connected {
                        self.queue_control(PendingControl::new(
                            ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_OPEN, 1),
                            Vec::new(),
                        ));
                    }
                } else if control.value == 0 {
                    self.guest_ready = false;
                    self.guest_connected = false;
                    self.clear_agent_data();
                } else {
                    self.note_malformed_control();
                }
            }
            VIRTIO_CONSOLE_PORT_OPEN => {
                if control.id != AGENT_PORT_ID
                    || !self.agent_announced
                    || !self.guest_ready
                    || control.value > 1
                {
                    self.note_malformed_control();
                    return;
                }
                self.guest_connected = control.value == 1;
                if !self.guest_connected {
                    self.clear_agent_data();
                }
            }
            _ => self.note_malformed_control(),
        }
    }

    fn note_malformed_control(&mut self) {
        self.malformed_controls = self.malformed_controls.saturating_add(1);
    }

    fn clear_agent_data(&mut self) {
        self.agent_input.clear();
        self.agent_input_bytes = 0;
        self.agent_output.clear();
        self.agent_output_bytes = 0;
    }

    fn trim_agent_input(&mut self) {
        while self.agent_input_bytes > self.data_budget {
            let excess = self.agent_input_bytes - self.data_budget;
            let Some(chunk) = self.agent_input.pop_back() else {
                self.agent_input_bytes = 0;
                break;
            };
            let chunk_len = chunk.remaining();
            if chunk_len <= excess {
                self.agent_input_bytes = self.agent_input_bytes.saturating_sub(chunk_len);
            } else {
                let retained = chunk_len - excess;
                self.agent_input_bytes = self.agent_input_bytes.saturating_sub(excess);
                let start = chunk.offset;
                let end = start + retained;
                self.agent_input
                    .push_back(PendingData::new(chunk.bytes[start..end].to_vec()));
            }
        }
    }

    fn trim_agent_output(&mut self) {
        while self.agent_output_bytes > self.data_budget {
            let Some(frame) = self.agent_output.pop_back() else {
                self.agent_output_bytes = 0;
                break;
            };
            self.agent_output_bytes = self.agent_output_bytes.saturating_sub(frame.len());
        }
    }

    fn consume_agent_input(&mut self, count: usize) {
        let mut remaining = count;
        while remaining != 0 {
            let Some(front) = self.agent_input.front_mut() else {
                self.agent_input_bytes = 0;
                break;
            };
            let take = remaining.min(front.remaining());
            front.offset += take;
            remaining -= take;
            self.agent_input_bytes = self.agent_input_bytes.saturating_sub(take);
            if front.remaining() == 0 {
                self.agent_input.pop_front();
            }
        }
    }

    fn agent_input_front(&self) -> Option<&PendingData> {
        self.agent_input.front()
    }

    fn stage_agent_output(&mut self, bytes: Vec<u8>) -> bool {
        if !self.agent_open()
            || bytes.len() > MAX_DATA_FRAME_BYTES
            || self.agent_output_bytes.saturating_add(bytes.len()) > self.data_budget
        {
            self.dropped_agent_output_frames = self.dropped_agent_output_frames.saturating_add(1);
            self.dropped_agent_output_bytes = self
                .dropped_agent_output_bytes
                .saturating_add(bytes.len() as u64);
            return false;
        }
        self.agent_output_bytes += bytes.len();
        self.agent_output.push_back(bytes);
        true
    }

    fn stage_serial_output(&mut self, bytes: Vec<u8>) -> bool {
        if self.serial_output_bytes.saturating_add(bytes.len()) > self.serial_budget {
            self.dropped_serial_output_frames = self.dropped_serial_output_frames.saturating_add(1);
            return false;
        }
        self.serial_output_bytes += bytes.len();
        self.serial_output.push_back(bytes);
        true
    }

    fn reset(&mut self) {
        self.kicked = [false; NUM_QUEUES as usize];
        self.reset_pending = true;
        self.driver_ready = false;
        self.agent_announced = false;
        self.guest_ready = false;
        self.host_connected = true;
        self.guest_connected = false;
        self.generation = self.generation.wrapping_add(1);
        self.pending_control.clear();
        self.pending_control_bytes = 0;
        self.clear_agent_data();
        self.serial_output.clear();
        self.serial_output_bytes = 0;
    }
}

fn take_frames(frames: &mut VecDeque<Vec<u8>>, byte_count: &mut usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(*byte_count);
    while let Some(frame) = frames.pop_front() {
        out.extend_from_slice(&frame);
    }
    *byte_count = 0;
    out
}

/// Transport-facing virtio-console declaration.
pub struct VirtioConsole {
    state: Rc<RefCell<ConsoleState>>,
    cols: u16,
    rows: u16,
    max_nr_ports: u32,
}

impl VirtioConsole {
    pub fn new() -> Self {
        Self::new_with_state().0
    }

    pub fn new_with_state() -> (Self, Rc<RefCell<ConsoleState>>) {
        let state = Rc::new(RefCell::new(ConsoleState::new()));
        let device = Self {
            state: Rc::clone(&state),
            cols: 80,
            rows: 25,
            // Port 0 is the standard console port and port 1 is the named agent port.
            max_nr_ports: AGENT_PORT_ID + 1,
        };
        (device, state)
    }

    pub fn state(&self) -> Rc<RefCell<ConsoleState>> {
        Rc::clone(&self.state)
    }

    pub fn agent_port_name(&self) -> &'static str {
        AGENT_PORT_NAME
    }

    fn config_byte(&self, index: usize) -> u8 {
        let mut bytes = [0u8; 12];
        bytes[0..2].copy_from_slice(&self.cols.to_le_bytes());
        bytes[2..4].copy_from_slice(&self.rows.to_le_bytes());
        bytes[4..8].copy_from_slice(&self.max_nr_ports.to_le_bytes());
        // emerg_wr is not offered, so it is a read-as-zero field.
        bytes.get(index).copied().unwrap_or(0)
    }
}

impl Default for VirtioConsole {
    fn default() -> Self {
        Self::new()
    }
}

impl VirtioDevice for VirtioConsole {
    fn device_id(&self) -> u32 {
        VIRTIO_CONSOLE_DEVICE_ID
    }

    fn device_features(&self) -> u64 {
        VIRTIO_CONSOLE_F_MULTIPORT
    }

    fn num_queues(&self) -> u32 {
        NUM_QUEUES
    }

    fn queue_notify(&mut self, queue: u32) {
        self.state.borrow_mut().mark_queue_kick(queue);
    }

    fn config_read(&mut self, offset: u64, width: u8) -> u64 {
        let mut value = 0u64;
        for byte_index in 0..usize::from(width.min(8)) {
            let Some(index) = offset
                .checked_add(byte_index as u64)
                .and_then(|value| usize::try_from(value).ok())
            else {
                continue;
            };
            value |= u64::from(self.config_byte(index)) << (byte_index * 8);
        }
        value
    }

    fn reset(&mut self) {
        self.state.borrow_mut().reset();
    }
}

fn prepare_queue(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    index: u32,
) -> Result<bool, ()> {
    let queue_state = *slot.borrow().queue(index as usize);
    if !queue_state.ready {
        *vq = None;
        return Ok(false);
    }
    if vq
        .as_ref()
        .is_some_and(|queue| !queue.matches_state(&queue_state))
    {
        *vq = None;
    }
    if vq.is_none() {
        match Virtqueue::new(&queue_state, 256) {
            Ok(queue) => *vq = Some(queue),
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                *vq = None;
                return Err(());
            }
        }
    }
    Ok(true)
}

fn read_exact(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    expected: usize,
) -> Result<Option<Vec<u8>>, ()> {
    if chain.writable().next().is_some() || chain.readable_len() != expected as u64 {
        return Ok(None);
    }
    let mut bytes = Vec::with_capacity(expected);
    for segment in chain.readable() {
        for offset in 0..segment.len as usize {
            bytes.push(bus.load8(segment.addr + offset as u64).map_err(|_| ())?);
        }
    }
    Ok(Some(bytes))
}

fn read_frame(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>, ()> {
    if chain.writable().next().is_some() || chain.readable_len() == 0 {
        return Ok(None);
    }
    if chain.readable_len() > max_bytes as u64 {
        return Ok(None);
    }
    let length = chain.readable_len() as usize;
    let mut bytes = Vec::with_capacity(length);
    for segment in chain.readable() {
        for offset in 0..segment.len as usize {
            bytes.push(bus.load8(segment.addr + offset as u64).map_err(|_| ())?);
        }
    }
    Ok(Some(bytes))
}

fn write_packet(chain: &DescriptorChain, bus: &mut SystemBus, bytes: &[u8]) -> Result<bool, ()> {
    if chain.readable().next().is_some() || chain.writable_len() < bytes.len() as u64 {
        return Ok(false);
    }
    let mut written = 0usize;
    for segment in chain.writable() {
        let count = (bytes.len() - written).min(segment.len as usize);
        for (offset, byte) in bytes[written..written + count].iter().copied().enumerate() {
            bus.store8(segment.addr + offset as u64, byte)
                .map_err(|_| ())?;
        }
        written += count;
        if written == bytes.len() {
            break;
        }
    }
    Ok(written == bytes.len())
}

fn write_agent_stream(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    source: &PendingData,
) -> Result<usize, ()> {
    if chain.readable().next().is_some() {
        return Ok(0);
    }
    let count = source
        .remaining()
        .min(chain.writable_len().min(usize::MAX as u64) as usize);
    let mut written = 0usize;
    for segment in chain.writable() {
        let segment_count = (count - written).min(segment.len as usize);
        let start = source.offset + written;
        for (offset, byte) in source.bytes[start..start + segment_count]
            .iter()
            .copied()
            .enumerate()
        {
            bus.store8(segment.addr + offset as u64, byte)
                .map_err(|_| ())?;
        }
        written += segment_count;
        if written == count {
            break;
        }
    }
    Ok(written)
}

fn service_control_tx(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<ConsoleState>>,
    bus: &mut SystemBus,
) -> Result<bool, ()> {
    if !prepare_queue(slot, vq, CONTROL_TRANSMIT_QUEUE)? {
        return Ok(false);
    }
    let queue = vq.as_mut().expect("control transmit queue was prepared");
    let mut completed = false;
    while let Some(chain) = queue.pop(bus).map_err(|_| ())? {
        match read_exact(&chain, bus, CONTROL_MESSAGE_BYTES)? {
            Some(bytes) => state
                .borrow_mut()
                .handle_driver_control(ConsoleControl::from_bytes(
                    bytes[..].try_into().map_err(|_| ())?,
                )),
            None => state.borrow_mut().note_malformed_control(),
        }
        queue.push_used(bus, chain.head, 0).map_err(|_| ())?;
        completed = true;
    }
    if completed && queue.interrupt_needed(bus) {
        slot.borrow_mut().raise_used_irq();
    }
    Ok(completed)
}

fn service_control_rx(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<ConsoleState>>,
    bus: &mut SystemBus,
) -> Result<bool, ()> {
    if !prepare_queue(slot, vq, CONTROL_RECEIVE_QUEUE)? {
        return Ok(false);
    }
    let queue = vq.as_mut().expect("control receive queue was prepared");
    let mut completed = false;
    loop {
        let Some(bytes) = state
            .borrow()
            .pending_control
            .front()
            .map(PendingControl::encode)
        else {
            break;
        };
        let Some(chain) = queue.pop(bus).map_err(|_| ())? else {
            break;
        };
        if write_packet(&chain, bus, &bytes)? {
            let packet_len = bytes.len();
            let mut state = state.borrow_mut();
            state.pending_control.pop_front();
            state.pending_control_bytes = state.pending_control_bytes.saturating_sub(packet_len);
            queue
                .push_used(bus, chain.head, packet_len as u32)
                .map_err(|_| ())?;
        } else {
            // Keep the packet pending.  The undersized/mis-directed descriptor is completed with
            // zero and the next posted buffer gets another chance at the same packet.
            queue.push_used(bus, chain.head, 0).map_err(|_| ())?;
        }
        completed = true;
    }
    if completed && queue.interrupt_needed(bus) {
        slot.borrow_mut().raise_used_irq();
    }
    Ok(completed)
}

fn service_serial_tx(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<ConsoleState>>,
    bus: &mut SystemBus,
) -> Result<bool, ()> {
    if !prepare_queue(slot, vq, PORT0_TRANSMIT_QUEUE)? {
        return Ok(false);
    }
    let queue = vq.as_mut().expect("port-0 transmit queue was prepared");
    let mut completed = false;
    loop {
        if state.borrow().serial_output_bytes >= state.borrow().serial_budget {
            break;
        }
        let Some(chain) = queue.pop(bus).map_err(|_| ())? else {
            break;
        };
        let bytes = read_frame(&chain, bus, MAX_DATA_FRAME_BYTES)?;
        let written = match bytes {
            Some(bytes) if state.borrow_mut().stage_serial_output(bytes.clone()) => {
                bytes.len() as u32
            }
            Some(_) | None => 0,
        };
        queue.push_used(bus, chain.head, written).map_err(|_| ())?;
        completed = true;
    }
    if completed && queue.interrupt_needed(bus) {
        slot.borrow_mut().raise_used_irq();
    }
    Ok(completed)
}

fn service_agent_tx(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<ConsoleState>>,
    bus: &mut SystemBus,
) -> Result<bool, ()> {
    if !prepare_queue(slot, vq, AGENT_TRANSMIT_QUEUE)? {
        return Ok(false);
    }
    let queue = vq.as_mut().expect("agent transmit queue was prepared");
    let mut completed = false;
    loop {
        // A full host queue is real backpressure: leave the available descriptor posted so a
        // later drain/reopen can consume it.  This is also what prevents a saturated agent from
        // touching port-0 descriptors.
        let can_try = {
            let state = state.borrow();
            state.agent_open() && state.agent_output_bytes < state.data_budget
        };
        if !can_try {
            break;
        }
        let Some(chain) = queue.pop(bus).map_err(|_| ())? else {
            break;
        };
        let bytes = read_frame(&chain, bus, MAX_DATA_FRAME_BYTES)?;
        let written = match bytes {
            Some(bytes) => {
                let length = bytes.len() as u32;
                if state.borrow_mut().stage_agent_output(bytes) {
                    length
                } else {
                    0
                }
            }
            None => 0,
        };
        queue.push_used(bus, chain.head, written).map_err(|_| ())?;
        completed = true;
    }
    if completed && queue.interrupt_needed(bus) {
        slot.borrow_mut().raise_used_irq();
    }
    Ok(completed)
}

fn service_agent_rx(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<ConsoleState>>,
    bus: &mut SystemBus,
) -> Result<bool, ()> {
    if !prepare_queue(slot, vq, AGENT_RECEIVE_QUEUE)? {
        return Ok(false);
    }
    let queue = vq.as_mut().expect("agent receive queue was prepared");
    let mut completed = false;
    loop {
        if !state.borrow().agent_open() {
            break;
        }
        if state.borrow().agent_input_bytes == 0 {
            break;
        }
        let Some(chain) = queue.pop(bus).map_err(|_| ())? else {
            break;
        };
        let written = {
            let mut state = state.borrow_mut();
            let Some(source) = state.agent_input_front() else {
                break;
            };
            let written = write_agent_stream(&chain, bus, source)?;
            if written != 0 {
                state.consume_agent_input(written);
            }
            written
        };
        queue
            .push_used(bus, chain.head, written as u32)
            .map_err(|_| ())?;
        completed = true;
    }
    if completed && queue.interrupt_needed(bus) {
        slot.borrow_mut().raise_used_irq();
    }
    Ok(completed)
}

/// Run-loop service for the six virtio-console queues.  Port 0 and the named agent use separate
/// ring views and bounded host buffers; control messages are handled before data so a PORT_OPEN
/// response can make the agent queues live in the same boundary.
#[allow(clippy::too_many_arguments)]
pub fn service(
    slot: &Rc<RefCell<VirtioMmio>>,
    port0_receiveq: &mut Option<Virtqueue>,
    port0_transmitq: &mut Option<Virtqueue>,
    control_receiveq: &mut Option<Virtqueue>,
    control_transmitq: &mut Option<Virtqueue>,
    agent_receiveq: &mut Option<Virtqueue>,
    agent_transmitq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<ConsoleState>>,
    bus: &mut SystemBus,
) {
    let (kicked, pending) = {
        let mut state = state.borrow_mut();
        let reset = state.take_reset_pending();
        if reset {
            *port0_receiveq = None;
            *port0_transmitq = None;
            *control_receiveq = None;
            *control_transmitq = None;
            *agent_receiveq = None;
            *agent_transmitq = None;
        }
        state.take_work()
    };
    if !pending && !kicked.iter().any(|kicked| *kicked) {
        return;
    }

    let fail = |slot: &Rc<RefCell<VirtioMmio>>, queues: &mut [&mut Option<Virtqueue>]| {
        slot.borrow_mut().protocol_violation();
        for queue in queues {
            **queue = None;
        }
    };

    if kicked[CONTROL_TRANSMIT_QUEUE as usize] {
        match service_control_tx(slot, control_transmitq, state, bus) {
            Ok(_) => {}
            Err(()) => {
                fail(
                    slot,
                    &mut [
                        port0_receiveq,
                        port0_transmitq,
                        control_receiveq,
                        control_transmitq,
                        agent_receiveq,
                        agent_transmitq,
                    ],
                );
                return;
            }
        }
    }
    if kicked[CONTROL_RECEIVE_QUEUE as usize] || !state.borrow().pending_control.is_empty() {
        match service_control_rx(slot, control_receiveq, state, bus) {
            Ok(_) => {}
            Err(()) => {
                fail(
                    slot,
                    &mut [
                        port0_receiveq,
                        port0_transmitq,
                        control_receiveq,
                        control_transmitq,
                        agent_receiveq,
                        agent_transmitq,
                    ],
                );
                return;
            }
        }
    }
    if kicked[PORT0_TRANSMIT_QUEUE as usize] {
        match service_serial_tx(slot, port0_transmitq, state, bus) {
            Ok(_) => {}
            Err(()) => {
                fail(
                    slot,
                    &mut [
                        port0_receiveq,
                        port0_transmitq,
                        control_receiveq,
                        control_transmitq,
                        agent_receiveq,
                        agent_transmitq,
                    ],
                );
                return;
            }
        }
    }
    if kicked[AGENT_TRANSMIT_QUEUE as usize] {
        match service_agent_tx(slot, agent_transmitq, state, bus) {
            Ok(_) => {}
            Err(()) => {
                fail(
                    slot,
                    &mut [
                        port0_receiveq,
                        port0_transmitq,
                        control_receiveq,
                        control_transmitq,
                        agent_receiveq,
                        agent_transmitq,
                    ],
                );
                return;
            }
        }
    }
    if kicked[AGENT_RECEIVE_QUEUE as usize] || state.borrow().agent_input_bytes != 0 {
        match service_agent_rx(slot, agent_receiveq, state, bus) {
            Ok(_) => {}
            Err(()) => {
                fail(
                    slot,
                    &mut [
                        port0_receiveq,
                        port0_transmitq,
                        control_receiveq,
                        control_transmitq,
                        agent_receiveq,
                        agent_transmitq,
                    ],
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::virtio::mmio::QueueState;
    use crate::mmio::{MmioDevice, Width};
    use crate::platform::virt::DRAM_BASE;
    use crate::ram::Ram;
    use alloc::boxed::Box;

    const DESC: u64 = DRAM_BASE + 0x10_000;
    const AVAIL: u64 = DRAM_BASE + 0x20_000;
    const USED: u64 = DRAM_BASE + 0x30_000;
    const DATA: u64 = DRAM_BASE + 0x40_000;
    const QUEUE_SIZE: u16 = 16;

    fn fixture() -> (
        Rc<RefCell<VirtioMmio>>,
        Rc<RefCell<ConsoleState>>,
        SystemBus,
    ) {
        let (device, state) = VirtioConsole::new_with_state();
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
        let bus = SystemBus::new(Ram::new(8 * 1024 * 1024).unwrap());
        (slot, state, bus)
    }

    fn setup_queue(
        bus: &mut SystemBus,
        slot: &Rc<RefCell<VirtioMmio>>,
        queue: u32,
        desc: u64,
        avail: u64,
        used: u64,
    ) {
        bus.store16(avail, 0).unwrap();
        bus.store16(avail + 2, 0).unwrap();
        bus.store16(used + 2, 0).unwrap();
        slot.borrow_mut().set_queue_for_test(
            queue as usize,
            QueueState {
                num: u32::from(QUEUE_SIZE),
                ready: true,
                desc,
                driver: avail,
                device: used,
            },
        );
    }

    fn descriptor(
        bus: &mut SystemBus,
        desc: u64,
        index: u16,
        addr: u64,
        len: u32,
        flags: u16,
        next: u16,
    ) {
        let base = desc + 16 * u64::from(index);
        bus.store64(base, addr).unwrap();
        bus.store32(base + 8, len).unwrap();
        bus.store16(base + 12, flags).unwrap();
        bus.store16(base + 14, next).unwrap();
    }

    fn post(bus: &mut SystemBus, avail: u64, ordinal: u16, head: u16) {
        bus.store16(avail + 4 + 2 * u64::from(ordinal % QUEUE_SIZE), head)
            .unwrap();
        bus.store16(avail + 2, ordinal.wrapping_add(1)).unwrap();
    }

    fn notify(slot: &Rc<RefCell<VirtioMmio>>, queue: u32) {
        slot.borrow_mut()
            .write(0x50, Width::B4, u64::from(queue))
            .unwrap();
    }

    fn control(bus: &mut SystemBus, addr: u64, control: ConsoleControl) {
        for (offset, byte) in control.to_bytes().iter().copied().enumerate() {
            bus.store8(addr + offset as u64, byte).unwrap();
        }
    }

    #[test]
    fn virtio_console_advertises_multiport_device_id_config_and_six_queue_layout() {
        let (slot, _state, _bus) = fixture();
        assert_eq!(slot.borrow().device_id(), VIRTIO_CONSOLE_DEVICE_ID);
        assert_eq!(slot.borrow().queue(5), &QueueState::default());
        assert_eq!(slot.borrow_mut().read(0x100 + 4, Width::B4).unwrap(), 2);
        assert_eq!(slot.borrow_mut().read(0x100 + 8, Width::B4).unwrap(), 0);
        slot.borrow_mut()
            .write(0x14, Width::B4, 0)
            .expect("feature selector");
        assert_eq!(
            slot.borrow_mut().read(0x10, Width::B4).unwrap() & VIRTIO_CONSOLE_F_MULTIPORT,
            VIRTIO_CONSOLE_F_MULTIPORT
        );
        slot.borrow_mut()
            .write(0x14, Width::B4, 1)
            .expect("feature selector high bank");
        assert_eq!(slot.borrow_mut().read(0x10, Width::B4).unwrap(), 1);
    }

    #[test]
    fn virtio_console_split_control_announcement_and_coalesced_data_are_bounded() {
        let (slot, state, mut bus) = fixture();
        for queue in [
            CONTROL_RECEIVE_QUEUE,
            CONTROL_TRANSMIT_QUEUE,
            AGENT_RECEIVE_QUEUE,
            AGENT_TRANSMIT_QUEUE,
            PORT0_TRANSMIT_QUEUE,
        ] {
            setup_queue(
                &mut bus,
                &slot,
                queue,
                DESC + u64::from(queue) * 0x1000,
                AVAIL + u64::from(queue) * 0x1000,
                USED + u64::from(queue) * 0x1000,
            );
        }

        // DEVICE_READY arrives as two readable descriptors (a one-byte/dribble hostile shape).
        descriptor(&mut bus, DESC + 0x3000, 0, DATA, 4, 1, 1);
        descriptor(&mut bus, DESC + 0x3000, 1, DATA + 4, 4, 0, 0);
        control(
            &mut bus,
            DATA,
            ConsoleControl::new(0, VIRTIO_CONSOLE_DEVICE_READY, 1),
        );
        post(&mut bus, AVAIL + 0x3000, 0, 0);
        notify(&slot, CONTROL_TRANSMIT_QUEUE);

        // Two receive descriptors observe ADD then NAME, with the name bytes immediately after
        // its header as required by the virtio-console wire contract.
        descriptor(&mut bus, DESC + 0x2000, 0, DATA + 0x100, 8, 2, 0);
        descriptor(
            &mut bus,
            DESC + 0x2000,
            1,
            DATA + 0x200,
            8 + AGENT_PORT_NAME.len() as u32,
            2,
            0,
        );
        post(&mut bus, AVAIL + 0x2000, 0, 0);
        post(&mut bus, AVAIL + 0x2000, 1, 1);
        notify(&slot, CONTROL_RECEIVE_QUEUE);
        let mut port0_rx = None;
        let mut port0_tx = None;
        let mut control_rx = None;
        let mut control_tx = None;
        let mut agent_rx = None;
        let mut agent_tx = None;
        service(
            &slot,
            &mut port0_rx,
            &mut port0_tx,
            &mut control_rx,
            &mut control_tx,
            &mut agent_rx,
            &mut agent_tx,
            &state,
            &mut bus,
        );
        assert!(state.borrow().agent_announced());
        assert_eq!(bus.load16(USED + 0x2000 + 2).unwrap(), 2);
        assert_eq!(
            ConsoleControl::from_bytes(&bus.load64(DATA + 0x100).unwrap().to_le_bytes()),
            ConsoleControl::new(AGENT_PORT_ID, VIRTIO_CONSOLE_PORT_ADD, 0)
        );
        let mut name = [0u8; 8 + AGENT_PORT_NAME.len()];
        for (offset, byte) in name.iter_mut().enumerate() {
            *byte = bus.load8(DATA + 0x200 + offset as u64).unwrap();
        }
        assert_eq!(&name[8..], AGENT_PORT_NAME.as_bytes());

        // A malformed control payload is consumed safely with used.len=0 and no transport panic.
        descriptor(&mut bus, DESC + 0x3000, 2, DATA + 0x300, 7, 1, 0);
        post(&mut bus, AVAIL + 0x3000, 2, 2);
        notify(&slot, CONTROL_TRANSMIT_QUEUE);
        service(
            &slot,
            &mut port0_rx,
            &mut port0_tx,
            &mut control_rx,
            &mut control_tx,
            &mut agent_rx,
            &mut agent_tx,
            &state,
            &mut bus,
        );
        assert_eq!(state.borrow().malformed_controls, 1);
        assert_eq!(bus.load32(USED + 0x3000 + 4 + 8 * 2 + 4).unwrap(), 0);
    }

    #[test]
    fn virtio_console_agent_and_port0_data_queues_keep_frame_bytes_and_backpressure_separate() {
        let (slot, state, mut bus) = fixture();
        state.borrow_mut().set_data_budget(64);
        {
            let mut state = state.borrow_mut();
            state.driver_ready = true;
            state.agent_announced = true;
            state.guest_ready = true;
            state.guest_connected = true;
        }
        for queue in [
            AGENT_RECEIVE_QUEUE,
            AGENT_TRANSMIT_QUEUE,
            PORT0_TRANSMIT_QUEUE,
        ] {
            setup_queue(
                &mut bus,
                &slot,
                queue,
                DESC + u64::from(queue) * 0x1000,
                AVAIL + u64::from(queue) * 0x1000,
                USED + u64::from(queue) * 0x1000,
            );
        }

        // Host-to-guest stream is preserved across split writable descriptors.
        let inbound = b"agent-input-frame";
        assert_eq!(
            state.borrow_mut().enqueue_agent_input(inbound),
            inbound.len()
        );
        descriptor(&mut bus, DESC + 0x4000, 0, DATA + 0x400, 5, 2, 1);
        descriptor(&mut bus, DESC + 0x4000, 1, DATA + 0x405, 64, 2, 0);
        post(&mut bus, AVAIL + 0x4000, 0, 0);
        notify(&slot, AGENT_RECEIVE_QUEUE);

        // Guest-to-host agent frame and port-0 frame are coalesced in one service pass.
        let agent_frame = b"agent-output-frame";
        let serial_frame = b"serial-still-independent";
        for (offset, byte) in agent_frame.iter().copied().enumerate() {
            bus.store8(DATA + 0x500 + offset as u64, byte).unwrap();
        }
        for (offset, byte) in serial_frame.iter().copied().enumerate() {
            bus.store8(DATA + 0x600 + offset as u64, byte).unwrap();
        }
        descriptor(
            &mut bus,
            DESC + 0x5000,
            0,
            DATA + 0x500,
            agent_frame.len() as u32,
            0,
            0,
        );
        descriptor(
            &mut bus,
            DESC + 0x1000,
            0,
            DATA + 0x600,
            serial_frame.len() as u32,
            0,
            0,
        );
        post(&mut bus, AVAIL + 0x5000, 0, 0);
        post(&mut bus, AVAIL + 0x1000, 0, 0);
        notify(&slot, AGENT_TRANSMIT_QUEUE);
        notify(&slot, PORT0_TRANSMIT_QUEUE);
        service(
            &slot, &mut None, &mut None, &mut None, &mut None, &mut None, &mut None, &state,
            &mut bus,
        );
        // The temporary queue views above are intentionally not reusable; the direct service pass
        // still proves the host-side state transition and is followed by a normal view below.
        assert_eq!(state.borrow().agent_output_bytes, agent_frame.len());
        assert_eq!(state.borrow().serial_output_bytes, serial_frame.len());

        // Fill the agent queue with many frames.  Its bounded budget rejects the tail while the
        // independent port-0 sink remains usable.
        let mut agent_tx = None;
        let mut serial_tx = None;
        setup_queue(
            &mut bus,
            &slot,
            AGENT_TRANSMIT_QUEUE,
            DESC + 0x5000,
            AVAIL + 0x5000,
            USED + 0x5000,
        );
        setup_queue(
            &mut bus,
            &slot,
            PORT0_TRANSMIT_QUEUE,
            DESC + 0x1000,
            AVAIL + 0x1000,
            USED + 0x1000,
        );
        let payload = [0xA5u8; 8];
        for (offset, byte) in payload.iter().copied().enumerate() {
            bus.store8(DATA + 0x700 + offset as u64, byte).unwrap();
        }
        for index in 0..10_000u16 {
            descriptor(
                &mut bus,
                DESC + 0x5000,
                index % QUEUE_SIZE,
                DATA + 0x700,
                8,
                0,
                0,
            );
            post(&mut bus, AVAIL + 0x5000, index, index % QUEUE_SIZE);
            notify(&slot, AGENT_TRANSMIT_QUEUE);
            service(
                &slot,
                &mut None,
                &mut serial_tx,
                &mut None,
                &mut None,
                &mut None,
                &mut agent_tx,
                &state,
                &mut bus,
            );
        }
        assert!(state.borrow().agent_output_bytes <= 64);
        assert!(state.borrow().dropped_agent_output_frames > 9_000);

        // A serial descriptor is still consumed while agent output is full.
        let serial_again = b"serial-after-agent-full";
        for (offset, byte) in serial_again.iter().copied().enumerate() {
            bus.store8(DATA + 0x800 + offset as u64, byte).unwrap();
        }
        descriptor(
            &mut bus,
            DESC + 0x1000,
            1,
            DATA + 0x800,
            serial_again.len() as u32,
            0,
            0,
        );
        post(&mut bus, AVAIL + 0x1000, 1, 1);
        notify(&slot, PORT0_TRANSMIT_QUEUE);
        service(
            &slot,
            &mut None,
            &mut serial_tx,
            &mut None,
            &mut None,
            &mut None,
            &mut agent_tx,
            &state,
            &mut bus,
        );
        assert!(state.borrow().serial_output_bytes >= serial_again.len());
    }

    #[test]
    fn virtio_console_lifecycle_restart_and_reset_drop_stale_agent_state() {
        let (slot, state, mut bus) = fixture();
        {
            let mut state = state.borrow_mut();
            state.driver_ready = true;
            state.agent_announced = true;
            state.guest_ready = true;
            state.guest_connected = true;
            state.agent_input.push_back(PendingData::new(vec![1, 2, 3]));
            state.agent_input_bytes = 3;
            state.agent_output.push_back(vec![4, 5, 6]);
            state.agent_output_bytes = 3;
        }
        let before = state.borrow().generation();
        state.borrow_mut().restart_agent_port();
        assert_eq!(state.borrow().generation(), before + 1);
        assert!(!state.borrow().agent_open());
        assert_eq!(state.borrow().agent_input_bytes, 0);
        assert_eq!(state.borrow().agent_output_bytes, 0);
        assert_eq!(state.borrow().pending_control_messages(), 2);

        slot.borrow_mut().write(0x70, Width::B4, 0).unwrap();
        service(
            &slot, &mut None, &mut None, &mut None, &mut None, &mut None, &mut None, &state,
            &mut bus,
        );
        assert!(!state.borrow().agent_announced());
        assert_eq!(state.borrow().pending_control_messages(), 0);
    }

    #[test]
    fn restore_rehandshake_requires_live_agent_and_fences_old_application_bytes() {
        let (_slot, state, _bus) = fixture();
        assert!(!state.borrow().agent_ready_for_restore());
        assert_eq!(state.borrow_mut().restore_rehandshake(), None);

        {
            let mut state = state.borrow_mut();
            state.driver_ready = true;
            state.agent_announced = true;
            state.guest_ready = true;
            state.guest_connected = true;
            state.agent_input.push_back(PendingData::new(vec![1, 2, 3]));
            state.agent_input_bytes = 3;
            state.agent_output.push_back(vec![4, 5, 6]);
            state.agent_output_bytes = 3;
        }
        let before = state.borrow().generation();
        assert!(state.borrow().agent_ready_for_restore());
        assert_eq!(state.borrow_mut().restore_rehandshake(), Some(before + 1));
        assert!(state.borrow().agent_ready_for_restore());
        assert_eq!(state.borrow().agent_input_bytes, 0);
        assert_eq!(state.borrow().agent_output_bytes, 0);
        assert_eq!(state.borrow().pending_control_messages(), 2);
    }
}
