//! Declarative virtio-input identity and configuration protocol (E5-T10a).
//!
//! The configuration surface is a fixed 136-byte window: `select`, `subsel`, `size`, five
//! reserved bytes, and a 128-byte union.  Selector writes only change the two selector bytes;
//! every read derives a fresh zero-filled payload, so an unsupported query cannot expose bytes
//! from the previous query.  Event queues and host injection are added by the following input
//! slices.

use alloc::boxed::Box;
use alloc::collections::VecDeque;
use alloc::rc::Rc;
use core::cell::RefCell;

use super::VirtioDevice;
use super::mmio::VirtioMmio;
use super::queue::{DescriptorChain, Virtqueue};
use crate::bus::Bus;
use crate::mmio::SystemBus;

/// Virtio device id assigned to an input device.
pub const VIRTIO_INPUT_DEVICE_ID: u32 = 18;
/// The event queue is device-to-guest; the status queue is guest-to-device.
pub const EVENT_QUEUE: u32 = 0;
pub const STATUS_QUEUE: u32 = 1;

/// The fixed wire size of one `virtio_input_event`.
pub const INPUT_EVENT_SIZE: usize = 8;

/// One virtio-input event, encoded as `{ le16 type, le16 code, le32 value }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InputEvent {
    pub event_type: u16,
    pub code: u16,
    pub value: i32,
}

impl InputEvent {
    /// Construct an event without exposing the wire representation to callers.
    pub const fn new(event_type: u16, code: u16, value: i32) -> Self {
        Self {
            event_type,
            code,
            value,
        }
    }

    /// Encode the event in the guest-visible little-endian layout.
    pub fn to_bytes(self) -> [u8; INPUT_EVENT_SIZE] {
        let mut out = [0u8; INPUT_EVENT_SIZE];
        out[0..2].copy_from_slice(&self.event_type.to_le_bytes());
        out[2..4].copy_from_slice(&self.code.to_le_bytes());
        out[4..8].copy_from_slice(&self.value.to_le_bytes());
        out
    }

    /// Decode exactly one guest-visible event from its fixed-size wire payload.
    pub fn from_bytes(bytes: &[u8; INPUT_EVENT_SIZE]) -> Self {
        Self {
            event_type: u16::from_le_bytes([bytes[0], bytes[1]]),
            code: u16::from_le_bytes([bytes[2], bytes[3]]),
            value: i32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
        }
    }
}

/// Host callback for guest-to-host events read from virtio-input's statusq (normally EV_LED).
pub trait InputStatusSink {
    fn on_status_event(&mut self, event: InputEvent);
}

impl<F> InputStatusSink for F
where
    F: FnMut(InputEvent),
{
    fn on_status_event(&mut self, event: InputEvent) {
        self(event);
    }
}

/// Default status sink for headless callers that do not need LED/output notifications.
#[derive(Debug, Default)]
pub struct NullStatusSink;

impl InputStatusSink for NullStatusSink {
    fn on_status_event(&mut self, _event: InputEvent) {}
}

/// Shared state between the transport-facing input device and the queue service.
pub struct InputState {
    status_sink: Box<dyn InputStatusSink>,
    kicked: [bool; 2],
    reset_pending: bool,
    pending_events: VecDeque<InputEvent>,
    /// Number of well-formed status events delivered to the host callback.
    pub status_events_served: u64,
}

impl InputState {
    fn new(status_sink: Box<dyn InputStatusSink>) -> Self {
        Self {
            status_sink,
            kicked: [false; 2],
            reset_pending: false,
            pending_events: VecDeque::new(),
            status_events_served: 0,
        }
    }

    /// Queue one event for eventq delivery and request service at the next free bus boundary.
    /// This is the transport primitive used by the injection API in E5-T10c.
    pub fn enqueue_event(&mut self, event: InputEvent) {
        self.pending_events.push_back(event);
        self.kicked[EVENT_QUEUE as usize] = true;
    }

    /// Number of events waiting for a guest eventq buffer.
    pub fn pending_events(&self) -> usize {
        self.pending_events.len()
    }

    fn has_pending_event(&self) -> bool {
        !self.pending_events.is_empty()
    }

    fn queue_kicked(&self, queue: u32) -> bool {
        self.kicked.get(queue as usize).copied().unwrap_or(false)
    }

    fn clear_queue_kick(&mut self, queue: u32) {
        if let Some(kicked) = self.kicked.get_mut(queue as usize) {
            *kicked = false;
        }
    }

    fn mark_queue_kick(&mut self, queue: u32) {
        if let Some(kicked) = self.kicked.get_mut(queue as usize) {
            *kicked = true;
        }
    }
}

/// `virtio_input_config` payload and total wire sizes.
pub const INPUT_CONFIG_UNION_SIZE: usize = 128;
pub const INPUT_CONFIG_PREFIX_SIZE: usize = 8;
pub const INPUT_CONFIG_SIZE: usize = INPUT_CONFIG_PREFIX_SIZE + INPUT_CONFIG_UNION_SIZE;

/// Maximum evdev event type and code bitmap sizes represented by a declarative spec.
pub const MAX_EVENT_TYPES: usize = 32;
pub const MAX_EVENT_CODES: usize = INPUT_CONFIG_UNION_SIZE * 8;
pub const MAX_ABS_AXES: usize = 64;

/// virtio-input configuration selectors from Linux's `virtio_input.h`.
pub const VIRTIO_INPUT_CFG_UNSET: u8 = 0x00;
pub const VIRTIO_INPUT_CFG_ID_NAME: u8 = 0x01;
pub const VIRTIO_INPUT_CFG_ID_SERIAL: u8 = 0x02;
pub const VIRTIO_INPUT_CFG_ID_DEVIDS: u8 = 0x03;
pub const VIRTIO_INPUT_CFG_PROP_BITS: u8 = 0x10;
pub const VIRTIO_INPUT_CFG_EV_BITS: u8 = 0x11;
pub const VIRTIO_INPUT_CFG_ABS_INFO: u8 = 0x12;

/// Common evdev event types used by the input device instances.
pub const EV_SYN: u16 = 0x00;
pub const EV_KEY: u16 = 0x01;
pub const EV_REL: u16 = 0x02;
pub const EV_ABS: u16 = 0x03;
pub const EV_MSC: u16 = 0x04;
pub const EV_SW: u16 = 0x05;
pub const EV_LED: u16 = 0x11;
pub const EV_SND: u16 = 0x12;
pub const EV_REP: u16 = 0x14;

/// evdev's virtual-bus identifier.
pub const BUS_VIRTUAL: u16 = 0x06;

/// The fixed five-field `virtio_input_absinfo` payload.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AbsInfo {
    pub min: i32,
    pub max: i32,
    pub fuzz: i32,
    pub flat: i32,
    pub resolution: i32,
}

impl AbsInfo {
    /// Encode min/max/fuzz/flat/resolution as five little-endian 32-bit fields.
    pub fn to_bytes(self) -> [u8; 20] {
        let mut out = [0u8; 20];
        out[0..4].copy_from_slice(&self.min.to_le_bytes());
        out[4..8].copy_from_slice(&self.max.to_le_bytes());
        out[8..12].copy_from_slice(&self.fuzz.to_le_bytes());
        out[12..16].copy_from_slice(&self.flat.to_le_bytes());
        out[16..20].copy_from_slice(&self.resolution.to_le_bytes());
        out
    }
}

/// The fixed little-endian `virtio_input_devids` payload.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct InputDevids {
    pub bustype: u16,
    pub vendor: u16,
    pub product: u16,
    pub version: u16,
}

impl InputDevids {
    /// Encode bustype/vendor/product/version as four little-endian 16-bit fields.
    pub fn to_bytes(self) -> [u8; 8] {
        let mut out = [0u8; 8];
        out[0..2].copy_from_slice(&self.bustype.to_le_bytes());
        out[2..4].copy_from_slice(&self.vendor.to_le_bytes());
        out[4..6].copy_from_slice(&self.product.to_le_bytes());
        out[6..8].copy_from_slice(&self.version.to_le_bytes());
        out
    }
}

/// Host-authored capabilities advertised through the virtio-input query protocol.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InputDeviceSpec {
    /// The device name exposed by ID_NAME. Virtio reports bytes without a terminating NUL.
    pub name: &'static str,
    /// Optional serial string exposed by ID_SERIAL.
    pub serial: &'static str,
    pub devids: InputDevids,
    /// Property bitmap, indexed by evdev property code.
    pub prop_bits: [u8; INPUT_CONFIG_UNION_SIZE],
    /// Event-code bitmaps indexed by event type, then by event code.
    pub ev_bits: [[u8; INPUT_CONFIG_UNION_SIZE]; MAX_EVENT_TYPES],
    /// Absolute-axis metadata indexed by ABS_* code.
    pub abs_info: [Option<AbsInfo>; MAX_ABS_AXES],
}

impl Default for InputDeviceSpec {
    fn default() -> Self {
        Self {
            name: "",
            serial: "",
            devids: InputDevids::default(),
            prop_bits: [0; INPUT_CONFIG_UNION_SIZE],
            ev_bits: [[0; INPUT_CONFIG_UNION_SIZE]; MAX_EVENT_TYPES],
            abs_info: [None; MAX_ABS_AXES],
        }
    }
}

impl InputDeviceSpec {
    /// Construct an empty spec with a stable name and device id tuple.
    pub fn new(name: &'static str, devids: InputDevids) -> Self {
        Self {
            name,
            devids,
            ..Self::default()
        }
    }

    /// Set one evdev property bit. Returns false when the code is outside the bounded bitmap.
    pub fn set_property_bit(&mut self, property: u16) -> bool {
        set_bitmap_bit(&mut self.prop_bits, property)
    }

    /// Set one event-code capability bit. Returns false for an unsupported type or code.
    pub fn set_event_bit(&mut self, event_type: u16, code: u16) -> bool {
        let Some(bitmap) = self.ev_bits.get_mut(event_type as usize) else {
            return false;
        };
        set_bitmap_bit(bitmap, code)
    }

    /// Set absolute metadata for an ABS_* axis. Returns false for an out-of-range axis code.
    pub fn set_abs_info(&mut self, axis: u16, info: AbsInfo) -> bool {
        let Some(slot) = self.abs_info.get_mut(axis as usize) else {
            return false;
        };
        *slot = Some(info);
        true
    }

    /// Read-only access to one event bitmap for instance-specific tests and host adapters.
    pub fn event_bitmap(&self, event_type: u16) -> Option<&[u8; INPUT_CONFIG_UNION_SIZE]> {
        self.ev_bits.get(event_type as usize)
    }
}

fn set_bitmap_bit(bitmap: &mut [u8; INPUT_CONFIG_UNION_SIZE], bit: u16) -> bool {
    if usize::from(bit) >= MAX_EVENT_CODES {
        return false;
    }
    let byte = usize::from(bit / 8);
    bitmap[byte] |= 1 << (bit % 8);
    true
}

fn bitmap_size(bitmap: &[u8; INPUT_CONFIG_UNION_SIZE]) -> u8 {
    bitmap
        .iter()
        .rposition(|byte| *byte != 0)
        .map(|index| (index + 1) as u8)
        .unwrap_or(0)
}

/// Transport-facing virtio-input config state. Queue service is deliberately added in T10b.
pub struct VirtioInput {
    spec: InputDeviceSpec,
    select: u8,
    subsel: u8,
    state: Rc<RefCell<InputState>>,
}

impl VirtioInput {
    /// Construct an input device from host-owned, declarative capabilities.
    pub fn new(spec: InputDeviceSpec) -> Self {
        Self::new_with_state(spec).0
    }

    /// Construct an input device and the shared queue-service state using a no-op status sink.
    pub fn new_with_state(spec: InputDeviceSpec) -> (Self, Rc<RefCell<InputState>>) {
        Self::new_with_status_sink_state(spec, Box::new(NullStatusSink))
    }

    /// Construct an input device with a host callback for status/output events.
    pub fn new_with_status_sink(
        spec: InputDeviceSpec,
        status_sink: Box<dyn InputStatusSink>,
    ) -> Self {
        Self::new_with_status_sink_state(spec, status_sink).0
    }

    /// Construct an input device, callback sink, and the shared state used by [`service`].
    pub fn new_with_status_sink_state(
        spec: InputDeviceSpec,
        status_sink: Box<dyn InputStatusSink>,
    ) -> (Self, Rc<RefCell<InputState>>) {
        let state = Rc::new(RefCell::new(InputState::new(status_sink)));
        let device = Self {
            spec,
            select: VIRTIO_INPUT_CFG_UNSET,
            subsel: 0,
            state: Rc::clone(&state),
        };
        (device, state)
    }

    /// Access the immutable capability declaration.
    pub fn spec(&self) -> &InputDeviceSpec {
        &self.spec
    }

    /// Clone the shared queue-service handle for a host run loop.
    pub fn state(&self) -> Rc<RefCell<InputState>> {
        Rc::clone(&self.state)
    }

    /// Current query selector pair, useful for a transport test and later queue slices.
    pub fn selected(&self) -> (u8, u8) {
        (self.select, self.subsel)
    }

    fn query_payload(&self) -> (u8, [u8; INPUT_CONFIG_UNION_SIZE]) {
        let mut payload = [0u8; INPUT_CONFIG_UNION_SIZE];
        let size = match self.select {
            VIRTIO_INPUT_CFG_ID_NAME => copy_string(&mut payload, self.spec.name),
            VIRTIO_INPUT_CFG_ID_SERIAL => copy_string(&mut payload, self.spec.serial),
            VIRTIO_INPUT_CFG_ID_DEVIDS => {
                payload[..8].copy_from_slice(&self.spec.devids.to_bytes());
                8
            }
            VIRTIO_INPUT_CFG_PROP_BITS => {
                payload.copy_from_slice(&self.spec.prop_bits);
                bitmap_size(&self.spec.prop_bits)
            }
            VIRTIO_INPUT_CFG_EV_BITS => {
                let Some(bitmap) = self.spec.ev_bits.get(self.subsel as usize) else {
                    return (0, payload);
                };
                payload.copy_from_slice(bitmap);
                bitmap_size(bitmap)
            }
            VIRTIO_INPUT_CFG_ABS_INFO => {
                let Some(Some(info)) = self.spec.abs_info.get(self.subsel as usize) else {
                    return (0, payload);
                };
                payload[..20].copy_from_slice(&info.to_bytes());
                20
            }
            _ => 0,
        };
        (size, payload)
    }
}

fn copy_string(payload: &mut [u8; INPUT_CONFIG_UNION_SIZE], value: &str) -> u8 {
    let size = value.len().min(INPUT_CONFIG_UNION_SIZE);
    payload[..size].copy_from_slice(&value.as_bytes()[..size]);
    size as u8
}

impl Default for VirtioInput {
    fn default() -> Self {
        Self::new(InputDeviceSpec::default())
    }
}

impl VirtioDevice for VirtioInput {
    fn device_id(&self) -> u32 {
        VIRTIO_INPUT_DEVICE_ID
    }

    fn num_queues(&self) -> u32 {
        2
    }

    fn queue_notify(&mut self, queue: u32) {
        // The bus is borrowed during QueueNotify; defer descriptor walking to [`service`].
        self.state.borrow_mut().mark_queue_kick(queue);
    }

    fn config_read(&mut self, offset: u64, width: u8) -> u64 {
        let (size, payload) = self.query_payload();
        let mut value = 0u64;
        for byte_index in 0..usize::from(width.min(8)) {
            let Some(index) = offset
                .checked_add(byte_index as u64)
                .and_then(|index| usize::try_from(index).ok())
            else {
                continue;
            };
            let byte = match index {
                0 => self.select,
                1 => self.subsel,
                2 => size,
                3..INPUT_CONFIG_PREFIX_SIZE => 0,
                INPUT_CONFIG_PREFIX_SIZE..INPUT_CONFIG_SIZE => {
                    payload[index - INPUT_CONFIG_PREFIX_SIZE]
                }
                _ => 0,
            };
            value |= u64::from(byte) << (byte_index * 8);
        }
        value
    }

    fn config_write(&mut self, offset: u64, width: u8, value: u64) {
        for byte_index in 0..usize::from(width.min(8)) {
            let Some(index) = offset.checked_add(byte_index as u64) else {
                continue;
            };
            match index {
                0 => self.select = ((value >> (byte_index * 8)) & 0xff) as u8,
                1 => self.subsel = ((value >> (byte_index * 8)) & 0xff) as u8,
                _ => {}
            }
        }
    }

    fn reset(&mut self) {
        self.select = VIRTIO_INPUT_CFG_UNSET;
        self.subsel = 0;
        let mut state = self.state.borrow_mut();
        state.kicked = [false; 2];
        state.reset_pending = true;
        state.pending_events.clear();
    }
}

enum QueuePreparation {
    Ready,
    NotReady,
    Violation,
}

fn prepare_queue(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    queue: u32,
) -> QueuePreparation {
    let queue_state = *slot.borrow().queue(queue as usize);
    if !queue_state.ready {
        *vq = None;
        return QueuePreparation::NotReady;
    }
    if vq.is_none() {
        match Virtqueue::new(&queue_state, 256) {
            Ok(queue) => *vq = Some(queue),
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                *vq = None;
                return QueuePreparation::Violation;
            }
        }
    }
    QueuePreparation::Ready
}

fn total_readable(chain: &DescriptorChain) -> u64 {
    chain.readable().map(|segment| u64::from(segment.len)).sum()
}

fn write_event(chain: &DescriptorChain, bus: &mut SystemBus, event: InputEvent) -> Result<u32, ()> {
    // eventq is device-to-guest.  A syntactically valid but wrongly-directed chain is consumed
    // with a zero-length used entry; it cannot cause a partial event write.
    if total_readable(chain) != 0 || chain.writable_len() < INPUT_EVENT_SIZE as u64 {
        return Ok(0);
    }
    let bytes = event.to_bytes();
    let mut written = 0usize;
    for segment in chain.writable() {
        let remaining = bytes.len() - written;
        let count = remaining.min(segment.len as usize);
        for (offset, byte) in bytes[written..written + count].iter().copied().enumerate() {
            bus.store8(segment.addr + offset as u64, byte)
                .map_err(|_| ())?;
        }
        written += count;
        if written == bytes.len() {
            break;
        }
    }
    if written == bytes.len() {
        Ok(INPUT_EVENT_SIZE as u32)
    } else {
        Err(())
    }
}

fn read_status_event(chain: &DescriptorChain, bus: &mut SystemBus) -> Option<InputEvent> {
    // statusq is guest-to-device.  Read the complete fixed-size event before invoking the host;
    // a short or wrongly-directed chain is therefore harmless and callback-free.
    if chain.writable().next().is_some() || total_readable(chain) < INPUT_EVENT_SIZE as u64 {
        return None;
    }
    let mut bytes = [0u8; INPUT_EVENT_SIZE];
    let mut read = 0usize;
    for segment in chain.readable() {
        let remaining = bytes.len() - read;
        let count = remaining.min(segment.len as usize);
        for (offset, byte) in bytes[read..read + count].iter_mut().enumerate() {
            *byte = bus.load8(segment.addr + offset as u64).ok()?;
        }
        read += count;
        if read == bytes.len() {
            break;
        }
    }
    (read == bytes.len()).then(|| InputEvent::from_bytes(&bytes))
}

fn notify_status_sink(state: &Rc<RefCell<InputState>>, event: InputEvent) {
    // Do not hold the shared-state RefCell borrow across host code.  A callback may legitimately
    // inspect or enqueue input while it runs; the temporary no-op replacement keeps that re-entry
    // from becoming a RefCell panic while preserving exactly one callback per valid event.
    let mut sink = {
        let mut state = state.borrow_mut();
        state.status_events_served = state.status_events_served.saturating_add(1);
        core::mem::replace(&mut state.status_sink, Box::new(NullStatusSink))
    };
    sink.on_status_event(event);
    state.borrow_mut().status_sink = sink;
}

fn service_eventq(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<InputState>>,
    bus: &mut SystemBus,
) -> bool {
    if !matches!(
        prepare_queue(slot, vq, EVENT_QUEUE),
        QueuePreparation::Ready
    ) {
        return false;
    }
    let queue = vq.as_mut().expect("eventq was prepared");
    let mut completed = false;
    loop {
        let Some(event) = state.borrow().pending_events.front().copied() else {
            break;
        };
        let chain = match queue.pop(bus) {
            Ok(Some(chain)) => chain,
            Ok(None) => break,
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                *vq = None;
                return completed;
            }
        };
        let written = match write_event(&chain, bus, event) {
            Ok(written) => written,
            Err(()) => {
                slot.borrow_mut().protocol_violation();
                *vq = None;
                return completed;
            }
        };
        if written == INPUT_EVENT_SIZE as u32 {
            // Remove the event only after the entire eight-byte payload was written.  An
            // undersized or wrongly-directed buffer remains recoverable on the next kick.
            state.borrow_mut().pending_events.pop_front();
        }
        if queue.push_used(bus, chain.head, written).is_err() {
            slot.borrow_mut().protocol_violation();
            *vq = None;
            return completed;
        }
        completed = true;
    }
    if completed && queue.interrupt_needed(bus) {
        slot.borrow_mut().raise_used_irq();
    }
    completed
}

fn service_statusq(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<InputState>>,
    bus: &mut SystemBus,
) -> bool {
    if !matches!(
        prepare_queue(slot, vq, STATUS_QUEUE),
        QueuePreparation::Ready
    ) {
        return false;
    }
    let queue = vq.as_mut().expect("statusq was prepared");
    let mut completed = false;
    loop {
        let chain = match queue.pop(bus) {
            Ok(Some(chain)) => chain,
            Ok(None) => break,
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                *vq = None;
                return completed;
            }
        };
        if let Some(event) = read_status_event(&chain, bus) {
            notify_status_sink(state, event);
        }
        // statusq is device-readable, so no guest bytes are written back.
        if queue.push_used(bus, chain.head, 0).is_err() {
            slot.borrow_mut().protocol_violation();
            *vq = None;
            return completed;
        }
        completed = true;
    }
    if completed && queue.interrupt_needed(bus) {
        slot.borrow_mut().raise_used_irq();
    }
    completed
}

/// Run-loop service for the two virtio-input queues.
///
/// QueueNotify only records a deferred kick because the guest bus is still borrowed at the
/// MMIO write.  This function is called at a free bus boundary, consumes bounded descriptor
/// chains, and maps queue violations to the existing virtio-mmio NEEDS_RESET path.  Eventq
/// buffers that are too short are completed with `used.len = 0` and left pending; they are never
/// partially written or allowed to invoke the status callback.
pub fn service(
    slot: &Rc<RefCell<VirtioMmio>>,
    eventq: &mut Option<Virtqueue>,
    statusq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<InputState>>,
    bus: &mut SystemBus,
) {
    let (event_work, status_work) = {
        let mut state = state.borrow_mut();
        if state.reset_pending {
            state.reset_pending = false;
            *eventq = None;
            *statusq = None;
        }
        let event_work = state.queue_kicked(EVENT_QUEUE) || state.has_pending_event();
        let status_work = state.queue_kicked(STATUS_QUEUE);
        if event_work {
            state.clear_queue_kick(EVENT_QUEUE);
        }
        if status_work {
            state.clear_queue_kick(STATUS_QUEUE);
        }
        (event_work, status_work)
    };

    // Handle status first so a guest LED update can be observed before a host-generated event is
    // delivered in the same boundary.  Both queues still make progress independently.
    if status_work {
        service_statusq(slot, statusq, state, bus);
    }
    if event_work {
        service_eventq(slot, eventq, state, bus);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::virtio::mmio::VirtioMmio;
    use crate::mmio::{MmioDevice, Width};
    use alloc::boxed::Box;

    const CONFIG: u64 = 0x100;

    fn fixture_spec() -> InputDeviceSpec {
        let mut spec = InputDeviceSpec::new(
            "qemu fixture input",
            InputDevids {
                bustype: BUS_VIRTUAL,
                vendor: 0x1234,
                product: 0x5678,
                version: 0x0102,
            },
        );
        spec.serial = "fixture-serial";
        assert!(spec.set_property_bit(3));
        assert!(spec.set_event_bit(EV_SYN, 0));
        assert!(spec.set_event_bit(EV_KEY, 1));
        assert!(spec.set_event_bit(EV_KEY, 30));
        assert!(spec.set_event_bit(EV_ABS, 0));
        assert!(spec.set_abs_info(
            0,
            AbsInfo {
                min: -10,
                max: 32767,
                fuzz: 2,
                flat: 3,
                resolution: 100,
            }
        ));
        spec
    }

    fn select(slot: &mut VirtioMmio, select: u8, subsel: u8) {
        slot.write(CONFIG, Width::B1, u64::from(select)).unwrap();
        slot.write(CONFIG + 1, Width::B1, u64::from(subsel))
            .unwrap();
    }

    fn read_bytes(slot: &mut VirtioMmio, offset: u64, len: usize) -> alloc::vec::Vec<u8> {
        (0..len)
            .map(|index| {
                slot.read(CONFIG + offset + index as u64, Width::B1)
                    .unwrap() as u8
            })
            .collect()
    }

    #[test]
    fn input_config_fixture_matches_little_endian_wire_bytes() {
        let spec = fixture_spec();
        let mut slot = VirtioMmio::new(Box::new(VirtioInput::new(spec.clone())));

        select(&mut slot, VIRTIO_INPUT_CFG_ID_NAME, 0);
        assert_eq!(
            slot.read(CONFIG + 2, Width::B1).unwrap() as u8,
            spec.name.len() as u8
        );
        assert_eq!(
            read_bytes(&mut slot, 8, spec.name.len()),
            spec.name.as_bytes()
        );

        select(&mut slot, VIRTIO_INPUT_CFG_ID_DEVIDS, 0);
        assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 8);
        assert_eq!(
            read_bytes(&mut slot, 8, 8),
            [0x06, 0x00, 0x34, 0x12, 0x78, 0x56, 0x02, 0x01]
        );

        select(&mut slot, VIRTIO_INPUT_CFG_PROP_BITS, 0);
        assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 1);
        assert_eq!(read_bytes(&mut slot, 8, 1), [0x08]);

        select(&mut slot, VIRTIO_INPUT_CFG_EV_BITS, EV_KEY as u8);
        assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 4);
        assert_eq!(read_bytes(&mut slot, 8, 4), [0x02, 0x00, 0x00, 0x40]);

        select(&mut slot, VIRTIO_INPUT_CFG_ABS_INFO, 0);
        assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 20);
        assert_eq!(read_bytes(&mut slot, 8, 20), fixture_abs_bytes());
    }

    fn fixture_abs_bytes() -> [u8; 20] {
        AbsInfo {
            min: -10,
            max: 32767,
            fuzz: 2,
            flat: 3,
            resolution: 100,
        }
        .to_bytes()
    }

    #[test]
    fn input_config_unsupported_queries_are_zero_and_do_not_leak_previous_payload() {
        let mut slot = VirtioMmio::new(Box::new(VirtioInput::new(fixture_spec())));
        select(&mut slot, VIRTIO_INPUT_CFG_EV_BITS, EV_KEY as u8);
        assert_eq!(read_bytes(&mut slot, 8, 4), [0x02, 0x00, 0x00, 0x40]);

        select(&mut slot, VIRTIO_INPUT_CFG_EV_BITS, EV_REL as u8);
        assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 0);
        assert_eq!(
            read_bytes(&mut slot, 8, INPUT_CONFIG_UNION_SIZE),
            vec![0; 128]
        );

        select(&mut slot, 0xff, 0xff);
        assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 0);
        assert_eq!(
            read_bytes(&mut slot, 8, INPUT_CONFIG_UNION_SIZE),
            vec![0; 128]
        );
        assert_eq!(
            slot.read(CONFIG + INPUT_CONFIG_SIZE as u64, Width::B1)
                .unwrap(),
            0
        );
    }

    #[test]
    fn input_config_selector_writes_are_width_preserving_and_resettable() {
        let mut input = VirtioInput::new(fixture_spec());
        input.config_write(
            0,
            2,
            u64::from(VIRTIO_INPUT_CFG_ABS_INFO) | (u64::from(0x03u8) << 8),
        );
        assert_eq!(input.selected(), (VIRTIO_INPUT_CFG_ABS_INFO, 3));
        assert_eq!(input.config_read(2, 1), 0);
        input.reset();
        assert_eq!(input.selected(), (VIRTIO_INPUT_CFG_UNSET, 0));
        assert_eq!(input.config_read(2, 1), 0);
    }

    const EVENT_DESC: u64 = crate::platform::virt::DRAM_BASE + 0x6000;
    const EVENT_AVAIL: u64 = crate::platform::virt::DRAM_BASE + 0x7000;
    const EVENT_USED: u64 = crate::platform::virt::DRAM_BASE + 0x8000;
    const EVENT_BUF: u64 = crate::platform::virt::DRAM_BASE + 0x9000;
    const STATUS_DESC: u64 = crate::platform::virt::DRAM_BASE + 0xa000;
    const STATUS_AVAIL: u64 = crate::platform::virt::DRAM_BASE + 0xb000;
    const STATUS_USED: u64 = crate::platform::virt::DRAM_BASE + 0xc000;
    const STATUS_BUF: u64 = crate::platform::virt::DRAM_BASE + 0xd000;
    const QUEUE_NOTIFY: u64 = 0x050;

    fn write_desc(
        bus: &mut crate::mmio::SystemBus,
        base: u64,
        index: u64,
        addr: u64,
        len: u32,
        flags: u16,
        next: u16,
    ) {
        let desc = base + 16 * index;
        bus.store64(desc, addr).unwrap();
        bus.store32(desc + 8, len).unwrap();
        bus.store16(desc + 12, flags).unwrap();
        bus.store16(desc + 14, next).unwrap();
    }

    fn setup_queue(
        bus: &mut crate::mmio::SystemBus,
        slot: &Rc<RefCell<VirtioMmio>>,
        index: usize,
        desc: u64,
        avail: u64,
        used: u64,
    ) {
        bus.store16(avail, 0).unwrap();
        bus.store16(avail + 2, 0).unwrap();
        bus.store16(used + 2, 0).unwrap();
        slot.borrow_mut().set_queue_for_test(
            index,
            crate::dev::virtio::mmio::QueueState {
                num: 8,
                ready: true,
                desc,
                driver: avail,
                device: used,
            },
        );
    }

    fn post_chain(bus: &mut crate::mmio::SystemBus, avail: u64, ordinal: u16, head: u16) {
        bus.store16(avail + 4 + 2 * u64::from(ordinal), head)
            .unwrap();
        bus.store16(avail + 2, ordinal + 1).unwrap();
    }

    #[test]
    fn input_event_wire_layout_is_fixed_and_little_endian() {
        let event = InputEvent::new(EV_KEY, 0x1234, -2);
        assert_eq!(
            event.to_bytes(),
            [0x01, 0x00, 0x34, 0x12, 0xfe, 0xff, 0xff, 0xff]
        );
        assert_eq!(InputEvent::from_bytes(&event.to_bytes()), event);
    }

    #[test]
    fn eventq_writes_one_event_across_split_descriptors_and_exact_used_len() {
        let mut bus = crate::mmio::SystemBus::new(crate::ram::Ram::new(1 << 20).unwrap());
        let (device, state) = VirtioInput::new_with_state(fixture_spec());
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
        setup_queue(
            &mut bus,
            &slot,
            EVENT_QUEUE as usize,
            EVENT_DESC,
            EVENT_AVAIL,
            EVENT_USED,
        );
        // The device owns its used-index shadow; a hostile guest value must not redirect the
        // first completion away from the shadow slot.
        bus.store16(EVENT_USED + 2, u16::MAX).unwrap();
        write_desc(&mut bus, EVENT_DESC, 0, EVENT_BUF, 3, 1 | 2, 1);
        write_desc(&mut bus, EVENT_DESC, 1, EVENT_BUF + 3, 5, 2, 0);
        post_chain(&mut bus, EVENT_AVAIL, 0, 0);

        let event = InputEvent::new(EV_KEY, 30, 1);
        state.borrow_mut().enqueue_event(event);
        let mut eventq = None;
        let mut statusq = None;
        service(&slot, &mut eventq, &mut statusq, &state, &mut bus);

        assert_eq!(state.borrow().pending_events(), 0);
        assert_eq!(bus.load16(EVENT_USED + 2).unwrap(), 1);
        assert_eq!(bus.load32(EVENT_USED + 4).unwrap(), 0);
        assert_eq!(bus.load32(EVENT_USED + 8).unwrap(), INPUT_EVENT_SIZE as u32);
        assert_eq!(
            (0..INPUT_EVENT_SIZE)
                .map(|offset| bus.load8(EVENT_BUF + offset as u64).unwrap())
                .collect::<alloc::vec::Vec<_>>(),
            event.to_bytes()
        );
    }

    #[test]
    fn short_event_buffer_is_not_partially_written_and_ring_recovers() {
        let mut bus = crate::mmio::SystemBus::new(crate::ram::Ram::new(1 << 20).unwrap());
        let (device, state) = VirtioInput::new_with_state(fixture_spec());
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
        setup_queue(
            &mut bus,
            &slot,
            EVENT_QUEUE as usize,
            EVENT_DESC,
            EVENT_AVAIL,
            EVENT_USED,
        );
        write_desc(&mut bus, EVENT_DESC, 0, EVENT_BUF, 4, 2, 0);
        post_chain(&mut bus, EVENT_AVAIL, 0, 0);
        let event = InputEvent::new(EV_KEY, 30, 1);
        state.borrow_mut().enqueue_event(event);

        let mut eventq = None;
        let mut statusq = None;
        service(&slot, &mut eventq, &mut statusq, &state, &mut bus);
        assert_eq!(state.borrow().pending_events(), 1);
        assert_eq!(bus.load16(EVENT_USED + 2).unwrap(), 1);
        assert_eq!(bus.load32(EVENT_USED + 8).unwrap(), 0);
        assert_eq!(
            (0..4)
                .map(|offset| bus.load8(EVENT_BUF + offset).unwrap())
                .collect::<alloc::vec::Vec<_>>(),
            [0, 0, 0, 0]
        );

        write_desc(&mut bus, EVENT_DESC, 1, EVENT_BUF + 4, 8, 2, 0);
        post_chain(&mut bus, EVENT_AVAIL, 1, 1);
        service(&slot, &mut eventq, &mut statusq, &state, &mut bus);
        assert_eq!(state.borrow().pending_events(), 0);
        assert_eq!(bus.load16(EVENT_USED + 2).unwrap(), 2);
        assert_eq!(bus.load32(EVENT_USED + 12).unwrap(), 1);
        assert_eq!(
            bus.load32(EVENT_USED + 16).unwrap(),
            INPUT_EVENT_SIZE as u32
        );
        assert_eq!(
            (0..INPUT_EVENT_SIZE)
                .map(|offset| bus.load8(EVENT_BUF + 4 + offset as u64).unwrap())
                .collect::<alloc::vec::Vec<_>>(),
            event.to_bytes()
        );
    }

    #[test]
    fn statusq_reads_split_event_and_rejects_short_or_wrong_direction() {
        let mut bus = crate::mmio::SystemBus::new(crate::ram::Ram::new(1 << 20).unwrap());
        let captured = Rc::new(RefCell::new(alloc::vec::Vec::new()));
        let captured_by_sink = Rc::clone(&captured);
        let (device, state) = VirtioInput::new_with_status_sink_state(
            fixture_spec(),
            Box::new(move |event: InputEvent| captured_by_sink.borrow_mut().push(event)),
        );
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
        setup_queue(
            &mut bus,
            &slot,
            STATUS_QUEUE as usize,
            STATUS_DESC,
            STATUS_AVAIL,
            STATUS_USED,
        );

        write_desc(&mut bus, STATUS_DESC, 0, STATUS_BUF, 4, 0, 0);
        post_chain(&mut bus, STATUS_AVAIL, 0, 0);
        slot.borrow_mut()
            .write(QUEUE_NOTIFY, Width::B4, u64::from(STATUS_QUEUE))
            .unwrap();
        let mut eventq = None;
        let mut statusq = None;
        service(&slot, &mut eventq, &mut statusq, &state, &mut bus);
        assert!(captured.borrow().is_empty());
        assert_eq!(bus.load16(STATUS_USED + 2).unwrap(), 1);
        assert_eq!(bus.load32(STATUS_USED + 8).unwrap(), 0);

        write_desc(&mut bus, STATUS_DESC, 1, STATUS_BUF + 8, 8, 2, 0);
        post_chain(&mut bus, STATUS_AVAIL, 1, 1);
        slot.borrow_mut()
            .write(QUEUE_NOTIFY, Width::B4, u64::from(STATUS_QUEUE))
            .unwrap();
        service(&slot, &mut eventq, &mut statusq, &state, &mut bus);
        assert!(captured.borrow().is_empty());
        assert_eq!(bus.load16(STATUS_USED + 2).unwrap(), 2);

        let event = InputEvent::new(EV_LED, 3, 1);
        let bytes = event.to_bytes();
        for (offset, byte) in bytes.iter().copied().enumerate() {
            bus.store8(STATUS_BUF + 16 + offset as u64, byte).unwrap();
        }
        write_desc(&mut bus, STATUS_DESC, 2, STATUS_BUF + 16, 2, 1, 3);
        write_desc(&mut bus, STATUS_DESC, 3, STATUS_BUF + 18, 6, 0, 0);
        post_chain(&mut bus, STATUS_AVAIL, 2, 2);
        slot.borrow_mut()
            .write(QUEUE_NOTIFY, Width::B4, u64::from(STATUS_QUEUE))
            .unwrap();
        service(&slot, &mut eventq, &mut statusq, &state, &mut bus);
        assert_eq!(captured.borrow().as_slice(), &[event]);
        assert_eq!(state.borrow().status_events_served, 1);
        assert_eq!(bus.load16(STATUS_USED + 2).unwrap(), 3);
    }

    #[test]
    fn unsupported_queue_shape_is_bounded_and_requests_reset() {
        let mut bus = crate::mmio::SystemBus::new(crate::ram::Ram::new(1 << 20).unwrap());
        let (device, state) = VirtioInput::new_with_state(fixture_spec());
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
        slot.borrow_mut().set_queue_for_test(
            EVENT_QUEUE as usize,
            crate::dev::virtio::mmio::QueueState {
                num: 3,
                ready: true,
                desc: EVENT_DESC,
                driver: EVENT_AVAIL,
                device: EVENT_USED,
            },
        );
        state
            .borrow_mut()
            .enqueue_event(InputEvent::new(EV_KEY, 30, 1));
        let mut eventq = None;
        let mut statusq = None;
        service(&slot, &mut eventq, &mut statusq, &state, &mut bus);
        assert_eq!(slot.borrow_mut().read(0x070, Width::B4).unwrap(), 64);
        assert!(eventq.is_none());
        assert_eq!(state.borrow().pending_events(), 1);
    }
}
