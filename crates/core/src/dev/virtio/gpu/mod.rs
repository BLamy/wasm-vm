//! The virtio-gpu identity/configuration boundary (Epic 5, E5-T01a).
//!
//! The device is enumerable through virtio-mmio, exposes the fixed virtio-gpu configuration
//! registers, and keeps the protocol wire formats in [`protocol`]. E5-T01b adds the first
//! control-queue command, while later slices add resources and presentation.

pub mod protocol;

use alloc::rc::Rc;
use core::cell::RefCell;

use super::VirtioDevice;
use super::mmio::VirtioMmio;
use super::queue::{DescriptorChain, Virtqueue};
use crate::bus::Bus;
use crate::mmio::SystemBus;

/// Virtio device type assigned to a GPU (virtio spec 1.2 §5.7).
pub const VIRTIO_GPU_DEVICE_ID: u32 = 16;
/// The initial device has one scanout; later display work may make this configurable.
pub const DEFAULT_NUM_SCANOUTS: u32 = 1;
/// E5-T01a exposes no 3D capsets.
pub const DEFAULT_NUM_CAPSETS: u32 = 0;

const CONFIG_LEN: usize = 16;

/// Shared state between the transport-facing device and the run-loop service.
pub struct GpuState {
    events_read: u32,
    kicked: bool,
    reset_pending: bool,
    /// Number of valid GET_DISPLAY_INFO requests completed by the service.
    pub commands_served: u64,
}

/// A minimal virtio-gpu device.  Queue state remains owned by the generic virtio-mmio transport;
/// [`service`] owns the deferred guest-memory work at a free bus boundary.
pub struct VirtioGpu {
    state: Rc<RefCell<GpuState>>,
}

impl VirtioGpu {
    /// Construct the default single-scanout, no-capset device.
    pub fn new() -> Self {
        Self::new_with_state().0
    }

    /// Construct the transport device and the run-loop handle that services its queues.
    pub fn new_with_state() -> (Self, Rc<RefCell<GpuState>>) {
        let state = Rc::new(RefCell::new(GpuState {
            events_read: 0,
            kicked: false,
            reset_pending: false,
            commands_served: 0,
        }));
        (
            Self {
                state: Rc::clone(&state),
            },
            state,
        )
    }

    /// Current display event bits, exposed for the later hotplug slice and tests.
    pub fn events_read(&self) -> u32 {
        self.state.borrow().events_read
    }

    /// Raise display event bits without exposing host pointers to the transport.
    pub fn raise_event(&mut self, bits: u32) {
        self.state.borrow_mut().events_read |= bits;
    }

    fn config_bytes(&self) -> [u8; CONFIG_LEN] {
        let mut out = [0u8; CONFIG_LEN];
        out[0..4].copy_from_slice(&self.events_read().to_le_bytes());
        // `events_clear` is a write-one-to-clear register.  It has no latched read value.
        out[8..12].copy_from_slice(&DEFAULT_NUM_SCANOUTS.to_le_bytes());
        out[12..16].copy_from_slice(&DEFAULT_NUM_CAPSETS.to_le_bytes());
        out
    }
}

impl Default for VirtioGpu {
    fn default() -> Self {
        Self::new()
    }
}

impl VirtioDevice for VirtioGpu {
    fn device_id(&self) -> u32 {
        VIRTIO_GPU_DEVICE_ID
    }

    fn num_queues(&self) -> u32 {
        // controlq (queue 0) and cursorq (queue 1); cursor commands are added by E5-T15.
        2
    }

    fn queue_notify(&mut self, queue: u32) {
        let _ = queue;
        // Bus is borrowed while the MMIO write is being handled.  Defer queue walking until the
        // run-loop boundary, when guest RAM can be borrowed safely.
        self.state.borrow_mut().kicked = true;
    }

    fn config_read(&mut self, offset: u64, width: u8) -> u64 {
        let bytes = self.config_bytes();
        let mut value = 0u64;
        // The transport only calls this with 1/2/4/8, but bounding the loop keeps a direct
        // backend call harmless as well: no shift can exceed the u64 result width.
        for i in 0..usize::from(width.min(8)) {
            let Some(index) = offset
                .checked_add(i as u64)
                .and_then(|n| usize::try_from(n).ok())
            else {
                continue;
            };
            if let Some(byte) = bytes.get(index) {
                value |= u64::from(*byte) << (i * 8);
            }
        }
        value
    }

    fn config_write(&mut self, offset: u64, width: u8, value: u64) {
        // The only writable field in the initial config surface is `events_clear` at offset 4.
        // Model partial writes byte-for-byte so the transport's width-preserving config policy
        // cannot accidentally clear neighboring fields.
        let mut clear = 0u32;
        for i in 0..usize::from(width.min(8)) {
            let Some(index) = offset.checked_add(i as u64) else {
                continue;
            };
            if (4..8).contains(&index) {
                let shift = i * 8;
                clear |= (((value >> shift) & 0xff) as u32) << ((index as usize - 4) * 8);
            }
        }
        self.state.borrow_mut().events_read &= !clear;
    }

    fn reset(&mut self) {
        let mut state = self.state.borrow_mut();
        state.events_read = 0;
        state.kicked = false;
        state.reset_pending = true;
    }
}

/// Read exactly the first control header from a chain's readable descriptors. This bounded read
/// supports headers split at any byte boundary without allocating based on a hostile descriptor
/// length; payload commands are owned by later GPU slices.
fn read_header(chain: &DescriptorChain, bus: &mut SystemBus) -> Option<protocol::CtrlHeader> {
    let mut bytes = [0u8; protocol::CTRL_HDR_SIZE];
    let mut used = 0usize;
    for segment in chain.readable() {
        for offset in 0..segment.len as usize {
            if used == bytes.len() {
                return protocol::CtrlHeader::from_bytes(&bytes);
            }
            bytes[used] = bus.load8(segment.addr + offset as u64).ok()?;
            used += 1;
        }
    }
    (used == bytes.len()).then(|| protocol::CtrlHeader::from_bytes(&bytes))?
}

/// Write a response prefix across all device-writable descriptors. A short tail is truncated at
/// its validated capacity; no byte beyond the provided descriptors is ever addressed.
fn write_prefix(chain: &DescriptorChain, bus: &mut SystemBus, response: &[u8]) -> Result<u32, ()> {
    let mut written = 0usize;
    for segment in chain.writable() {
        for offset in 0..segment.len as usize {
            if written == response.len() {
                return Ok(written as u32);
            }
            bus.store8(segment.addr + offset as u64, response[written])
                .map_err(|_| ())?;
            written += 1;
        }
    }
    Ok(written as u32)
}

fn response_header(request: protocol::CtrlHeader, ty: u32) -> protocol::CtrlHeader {
    protocol::CtrlHeader {
        ty,
        flags: request.flags & protocol::FLAG_FENCE,
        fence_id: if request.flags & protocol::FLAG_FENCE != 0 {
            request.fence_id
        } else {
            0
        },
        ctx_id: request.ctx_id,
        ring_idx: request.ring_idx,
        padding: [0; 3],
    }
}

/// Service the virtio-gpu control queue after a deferred QueueNotify kick.
///
/// A short request is consumed with a zero-length used entry. Unsupported commands receive the
/// fixed 24-byte `RESP_ERR_UNSPEC` response; both paths preserve ring progress for the next chain.
pub fn service(
    slot: &Rc<RefCell<VirtioMmio>>,
    vq: &mut Option<Virtqueue>,
    state: &Rc<RefCell<GpuState>>,
    bus: &mut SystemBus,
) {
    {
        let mut state = state.borrow_mut();
        if state.reset_pending {
            state.reset_pending = false;
            *vq = None;
        }
        if !state.kicked {
            return;
        }
        state.kicked = false;
    }

    let queue_state = *slot.borrow().queue(0);
    if !queue_state.ready {
        *vq = None;
        return;
    }
    if vq.is_none() {
        match Virtqueue::new(&queue_state, 256) {
            Ok(queue) => *vq = Some(queue),
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                return;
            }
        }
    }

    let queue = vq.as_mut().expect("queue was constructed above");
    let mut delivered_work = false;
    loop {
        let chain = match queue.pop(bus) {
            Ok(Some(chain)) => chain,
            Ok(None) => break,
            Err(_) => {
                slot.borrow_mut().protocol_violation();
                *vq = None;
                return;
            }
        };

        let written = match read_header(&chain, bus) {
            Some(request) if request.ty == protocol::CMD_GET_DISPLAY_INFO => {
                let response = protocol::DisplayInfoResponse::new(response_header(
                    request,
                    protocol::RESP_OK_DISPLAY_INFO,
                ))
                .to_bytes();
                match write_prefix(&chain, bus, &response) {
                    Ok(written) => {
                        state.borrow_mut().commands_served += 1;
                        written
                    }
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            Some(request) => {
                let response = response_header(request, protocol::RESP_ERR_UNSPEC).to_bytes();
                match write_prefix(&chain, bus, &response) {
                    Ok(written) => written,
                    Err(()) => {
                        slot.borrow_mut().protocol_violation();
                        *vq = None;
                        return;
                    }
                }
            }
            _ => 0,
        };

        if queue.push_used(bus, chain.head, written).is_err() {
            slot.borrow_mut().protocol_violation();
            *vq = None;
            return;
        }
        delivered_work = true;
    }

    if delivered_work && queue.interrupt_needed(bus) {
        slot.borrow_mut().raise_used_irq();
    }
}

#[cfg(test)]
mod tests {
    use alloc::rc::Rc;
    use core::cell::RefCell;

    use super::*;
    use crate::bus::Bus;
    use crate::dev::virtio::mmio::{QueueState, VirtioMmio};
    use crate::mmio::{MmioDevice, SystemBus, Width};
    use crate::platform::virt::DRAM_BASE;
    use crate::ram::Ram;
    use protocol::{
        CTRL_HDR_SIZE, CtrlHeader, DISPLAY_INFO_RESPONSE_SIZE, DISPLAY_MODE_COUNT,
        DISPLAY_MODE_SIZE, DisplayInfoResponse, DisplayMode, RESP_OK_DISPLAY_INFO,
    };

    const CONFIG_SPACE: u64 = 0x100;
    const DEVICE_FEATURES: u64 = 0x010;
    const DEVICE_FEATURES_SEL: u64 = 0x014;
    const DRIVER_FEATURES: u64 = 0x020;
    const DRIVER_FEATURES_SEL: u64 = 0x024;
    const QUEUE_SEL: u64 = 0x030;
    const QUEUE_NUM_MAX: u64 = 0x034;
    const STATUS: u64 = 0x070;
    const DEVICE_ID: u64 = 0x008;
    const STATUS_ACKNOWLEDGE: u32 = 1;
    const STATUS_DRIVER: u32 = 2;
    const STATUS_FEATURES_OK: u32 = 8;
    const STATUS_NEEDS_RESET: u32 = 64;

    const DESC: u64 = DRAM_BASE + 0x1000;
    const AVAIL: u64 = DRAM_BASE + 0x2000;
    const USED: u64 = DRAM_BASE + 0x3000;
    const REQUEST: u64 = DRAM_BASE + 0x4000;
    const RESPONSE: u64 = DRAM_BASE + 0x5000;

    fn write_desc(bus: &mut SystemBus, index: u64, addr: u64, len: u32, flags: u16, next: u16) {
        let base = DESC + 16 * index;
        bus.store64(base, addr).unwrap();
        bus.store32(base + 8, len).unwrap();
        bus.store16(base + 12, flags).unwrap();
        bus.store16(base + 14, next).unwrap();
    }

    fn write_bytes(bus: &mut SystemBus, addr: u64, bytes: &[u8]) {
        for (offset, byte) in bytes.iter().copied().enumerate() {
            bus.store8(addr + offset as u64, byte).unwrap();
        }
    }

    fn queue_for_test(
        bus: &mut SystemBus,
        descriptors: &[(u64, u32, u16, u16)],
    ) -> (
        Rc<RefCell<VirtioMmio>>,
        Rc<RefCell<GpuState>>,
        Option<Virtqueue>,
    ) {
        for (index, &(addr, len, flags, next)) in descriptors.iter().enumerate() {
            write_desc(bus, index as u64, addr, len, flags, next);
        }
        bus.store16(AVAIL, 0).unwrap();
        bus.store16(AVAIL + 2, 1).unwrap();
        bus.store16(AVAIL + 4, 0).unwrap();
        bus.store16(USED, 0).unwrap();
        let (device, state) = VirtioGpu::new_with_state();
        let slot = Rc::new(RefCell::new(VirtioMmio::new(Box::new(device))));
        slot.borrow_mut().set_queue_for_test(
            0,
            QueueState {
                num: 8,
                ready: true,
                desc: DESC,
                driver: AVAIL,
                device: USED,
            },
        );
        (slot, state, None)
    }

    fn set_avail_heads(bus: &mut SystemBus, heads: &[u16]) {
        bus.store16(AVAIL + 2, heads.len() as u16).unwrap();
        for (index, head) in heads.iter().copied().enumerate() {
            bus.store16(AVAIL + 4 + 2 * index as u64, head).unwrap();
        }
    }

    fn read32(slot: &mut VirtioMmio, offset: u64) -> u32 {
        slot.read(offset, Width::B4).unwrap() as u32
    }

    fn write32(slot: &mut VirtioMmio, offset: u64, value: u32) {
        slot.write(offset, Width::B4, u64::from(value)).unwrap();
    }

    #[test]
    fn gpu_protocol_wire_fixtures() {
        let header = CtrlHeader {
            ty: RESP_OK_DISPLAY_INFO,
            flags: 0xA1B2_C3D4,
            fence_id: 0x1122_3344_5566_7788,
            ctx_id: 0x0102_0304,
            ring_idx: 0x05,
            padding: [0x06, 0x07, 0x08],
        };
        assert_eq!(
            header.to_bytes(),
            [
                0x01, 0x11, 0x00, 0x00, // type
                0xD4, 0xC3, 0xB2, 0xA1, // flags
                0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, // fence_id
                0x04, 0x03, 0x02, 0x01, // ctx_id
                0x05, 0x06, 0x07, 0x08, // ring_idx + padding
            ]
        );
        assert_eq!(CtrlHeader::from_bytes(&header.to_bytes()), Some(header));

        let response = DisplayInfoResponse::new(header);
        let bytes = response.to_bytes();
        assert_eq!(bytes.len(), DISPLAY_INFO_RESPONSE_SIZE);
        assert_eq!(CTRL_HDR_SIZE, 24);
        assert_eq!(DISPLAY_MODE_SIZE, 24);
        assert_eq!(DISPLAY_MODE_COUNT, 16);
        assert_eq!(&bytes[..CTRL_HDR_SIZE], &header.to_bytes());

        // Every pmode is compared independently against the little-endian wire fixture: only
        // scanout 0 is enabled, and its rectangle is exactly 1280x800 at the origin.
        for index in 0..DISPLAY_MODE_COUNT {
            let start = CTRL_HDR_SIZE + index * DISPLAY_MODE_SIZE;
            let end = start + DISPLAY_MODE_SIZE;
            let expected = if index == 0 {
                [
                    0x00, 0x00, 0x00, 0x00, // x
                    0x00, 0x00, 0x00, 0x00, // y
                    0x00, 0x05, 0x00, 0x00, // width = 1280
                    0x20, 0x03, 0x00, 0x00, // height = 800
                    0x01, 0x00, 0x00, 0x00, // enabled
                    0x00, 0x00, 0x00, 0x00, // flags
                ]
            } else {
                [0u8; DISPLAY_MODE_SIZE]
            };
            assert_eq!(&bytes[start..end], expected.as_slice(), "pmode {index}");
        }
        assert_eq!(DisplayInfoResponse::from_bytes(&bytes), Some(response));
    }

    #[test]
    fn gpu_mmio_identity_features_and_config() {
        let mut slot = VirtioMmio::new(Box::new(VirtioGpu::new()));
        assert_eq!(read32(&mut slot, DEVICE_ID), VIRTIO_GPU_DEVICE_ID);

        write32(&mut slot, STATUS, STATUS_ACKNOWLEDGE | STATUS_DRIVER);
        write32(&mut slot, DEVICE_FEATURES_SEL, 0);
        assert_eq!(read32(&mut slot, DEVICE_FEATURES), 0);
        write32(&mut slot, DEVICE_FEATURES_SEL, 1);
        assert_eq!(read32(&mut slot, DEVICE_FEATURES), 1, "VERSION_1 offered");

        write32(&mut slot, DRIVER_FEATURES_SEL, 1);
        write32(&mut slot, DRIVER_FEATURES, 1);
        write32(
            &mut slot,
            STATUS,
            STATUS_ACKNOWLEDGE | STATUS_DRIVER | STATUS_FEATURES_OK,
        );
        assert_ne!(read32(&mut slot, STATUS) & STATUS_FEATURES_OK, 0);

        // Queue 0 is controlq and queue 1 is cursorq; no third queue is exposed.
        write32(&mut slot, QUEUE_SEL, 0);
        assert_eq!(read32(&mut slot, QUEUE_NUM_MAX), 256);
        write32(&mut slot, QUEUE_SEL, 1);
        assert_eq!(read32(&mut slot, QUEUE_NUM_MAX), 256);
        write32(&mut slot, QUEUE_SEL, 2);
        assert_eq!(read32(&mut slot, QUEUE_NUM_MAX), 0);

        assert_eq!(slot.read(CONFIG_SPACE, Width::B4).unwrap(), 0);
        assert_eq!(slot.read(CONFIG_SPACE + 4, Width::B4).unwrap(), 0);
        assert_eq!(slot.read(CONFIG_SPACE + 8, Width::B4).unwrap(), 1);
        assert_eq!(slot.read(CONFIG_SPACE + 12, Width::B4).unwrap(), 0);
        assert_eq!(slot.read(CONFIG_SPACE + 8, Width::B8).unwrap(), 1);
    }

    #[test]
    fn unsupported_feature_does_not_mutate_config() {
        let mut slot = VirtioMmio::new(Box::new(VirtioGpu::new()));
        write32(&mut slot, STATUS, STATUS_ACKNOWLEDGE | STATUS_DRIVER);
        write32(&mut slot, DRIVER_FEATURES_SEL, 0);
        write32(&mut slot, DRIVER_FEATURES, 1); // device offers no bit 0
        write32(
            &mut slot,
            STATUS,
            STATUS_ACKNOWLEDGE | STATUS_DRIVER | STATUS_FEATURES_OK,
        );
        assert_eq!(read32(&mut slot, STATUS) & STATUS_FEATURES_OK, 0);
        assert_eq!(slot.read(CONFIG_SPACE + 8, Width::B4).unwrap(), 1);
        assert_eq!(slot.read(CONFIG_SPACE + 12, Width::B4).unwrap(), 0);
    }

    #[test]
    fn display_event_clear_is_write_one_to_clear() {
        let mut gpu = VirtioGpu::new();
        gpu.raise_event(0b1011);
        assert_eq!(gpu.events_read(), 0b1011);
        gpu.config_write(4, 1, 0b0001);
        assert_eq!(gpu.events_read(), 0b1010);
    }

    #[test]
    fn virtio_gpu_display_info_contiguous_fenced() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = CtrlHeader {
            ty: protocol::CMD_GET_DISPLAY_INFO,
            flags: protocol::FLAG_FENCE,
            fence_id: 0xCAFE_BABE_1122_3344,
            ctx_id: 0x1020_3040,
            ring_idx: 3,
            padding: [0xAA, 0xBB, 0xCC],
        };
        write_bytes(&mut bus, REQUEST, &request.to_bytes());
        let (slot, state, mut vq) =
            queue_for_test(&mut bus, &[(REQUEST, 24, 1, 1), (RESPONSE, 408, 2, 0)]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 1, "used ring published");
        assert_eq!(bus.load32(USED + 4).unwrap(), 0, "head returned");
        assert_eq!(bus.load32(USED + 8).unwrap(), 408, "full response written");
        let mut bytes = [0u8; DISPLAY_INFO_RESPONSE_SIZE];
        for (offset, byte) in bytes.iter_mut().enumerate() {
            *byte = bus.load8(RESPONSE + offset as u64).unwrap();
        }
        let response = DisplayInfoResponse::from_bytes(&bytes).unwrap();
        assert_eq!(response.header.ty, protocol::RESP_OK_DISPLAY_INFO);
        assert_eq!(response.header.flags, protocol::FLAG_FENCE);
        assert_eq!(response.header.fence_id, request.fence_id);
        assert_eq!(response.header.ctx_id, request.ctx_id);
        assert_eq!(response.header.ring_idx, request.ring_idx);
        assert_eq!(response.header.padding, [0; 3]);
        assert_eq!(response.modes[0].width, 1280);
        assert_eq!(response.modes[0].height, 800);
        assert_eq!(response.modes[0].enabled, 1);
        assert!(
            response.modes[1..]
                .iter()
                .all(|mode| *mode == DisplayMode::default())
        );
        assert_eq!(state.borrow().commands_served, 1);
        assert!(slot.borrow().irq_level(), "used-ring interrupt raised");
    }

    #[test]
    fn virtio_gpu_display_info_split_header_unfenced() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = CtrlHeader {
            ty: protocol::CMD_GET_DISPLAY_INFO,
            flags: 0,
            fence_id: 0xDEAD_BEEF,
            ctx_id: 7,
            ring_idx: 1,
            padding: [9, 8, 7],
        };
        write_bytes(&mut bus, REQUEST, &request.to_bytes());
        let (slot, state, mut vq) = queue_for_test(
            &mut bus,
            &[
                (REQUEST, 12, 1, 1),
                (REQUEST + 12, 12, 1, 2),
                (RESPONSE, 408, 2, 0),
            ],
        );
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 1);
        assert_eq!(bus.load32(USED + 8).unwrap(), 408);
        let mut bytes = [0u8; DISPLAY_INFO_RESPONSE_SIZE];
        for (offset, byte) in bytes.iter_mut().enumerate() {
            *byte = bus.load8(RESPONSE + offset as u64).unwrap();
        }
        let response = DisplayInfoResponse::from_bytes(&bytes).unwrap();
        assert_eq!(
            response.header.flags, 0,
            "unfenced response has no fence flag"
        );
        assert_eq!(
            response.header.fence_id, 0,
            "unfenced response has no fence id"
        );
        assert_eq!(response.header.ctx_id, request.ctx_id);
        assert_eq!(state.borrow().commands_served, 1);
    }

    #[test]
    fn virtio_gpu_display_info_short_tail_is_bounded() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        let request = CtrlHeader {
            ty: protocol::CMD_GET_DISPLAY_INFO,
            ..CtrlHeader::default()
        };
        write_bytes(&mut bus, REQUEST, &request.to_bytes());
        for offset in 0..64u64 {
            bus.store8(RESPONSE + 32 + offset, 0xA5).unwrap();
        }
        let (slot, state, mut vq) =
            queue_for_test(&mut bus, &[(REQUEST, 24, 1, 1), (RESPONSE, 32, 2, 0)]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 1);
        assert_eq!(bus.load32(USED + 8).unwrap(), 32, "tail truncates safely");
        for offset in 0..64u64 {
            assert_eq!(
                bus.load8(RESPONSE + 32 + offset).unwrap(),
                0xA5,
                "write escaped short tail at byte {offset}"
            );
        }
    }

    #[test]
    fn virtio_gpu_malformed_requests_make_progress_and_recover() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        const ERROR_RESPONSE: u64 = RESPONSE;
        const SHORT_RESPONSE: u64 = RESPONSE + 0x400;
        const VALID_RESPONSE: u64 = RESPONSE + 0x800;

        let unknown = CtrlHeader {
            ty: 0xDEAD,
            flags: protocol::FLAG_FENCE,
            fence_id: 0x1111,
            ctx_id: 1,
            ring_idx: 2,
            padding: [1, 2, 3],
        };
        let short = [protocol::CMD_GET_DISPLAY_INFO as u8];
        let valid = CtrlHeader {
            ty: protocol::CMD_GET_DISPLAY_INFO,
            ..CtrlHeader::default()
        };
        write_bytes(&mut bus, REQUEST, &unknown.to_bytes());
        write_bytes(&mut bus, REQUEST + 0x100, &short);
        write_bytes(&mut bus, REQUEST + 0x200, &valid.to_bytes());
        for offset in 0..408u64 {
            bus.store8(SHORT_RESPONSE + offset, 0xCC).unwrap();
        }

        // Chain 0: unsupported command + writable error response.
        // Chain 2: one-byte request + writable buffer (must be consumed without writing).
        // Chain 4: valid request with no writable descriptors (must still advance the ring).
        // Chain 5: valid request proving the queue remains usable afterward.
        let descriptors = [
            (REQUEST, 24, 1, 1),
            (ERROR_RESPONSE, 24, 2, 0),
            (REQUEST + 0x100, 1, 1, 3),
            (SHORT_RESPONSE, 408, 2, 0),
            (REQUEST + 0x200, 24, 0, 0),
            (REQUEST + 0x200, 24, 1, 6),
            (VALID_RESPONSE, 408, 2, 0),
        ];
        let (slot, state, mut vq) = queue_for_test(&mut bus, &descriptors);
        set_avail_heads(&mut bus, &[0, 2, 4, 5]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert_eq!(bus.load16(USED + 2).unwrap(), 4, "all four chains consumed");
        assert_eq!(bus.load32(USED + 8).unwrap(), 24, "error response length");
        assert_eq!(bus.load32(USED + 16).unwrap(), 0, "short request length");
        assert_eq!(bus.load32(USED + 24).unwrap(), 0, "no writable tail length");
        assert_eq!(bus.load32(USED + 32).unwrap(), 408, "valid response length");
        let error = [
            bus.load8(ERROR_RESPONSE).unwrap(),
            bus.load8(ERROR_RESPONSE + 1).unwrap(),
            bus.load8(ERROR_RESPONSE + 2).unwrap(),
            bus.load8(ERROR_RESPONSE + 3).unwrap(),
        ];
        assert_eq!(u32::from_le_bytes(error), protocol::RESP_ERR_UNSPEC);
        for offset in 0..408u64 {
            assert_eq!(
                bus.load8(SHORT_RESPONSE + offset).unwrap(),
                0xCC,
                "short request wrote at byte {offset}"
            );
        }
        let mut valid_bytes = [0u8; DISPLAY_INFO_RESPONSE_SIZE];
        for (offset, byte) in valid_bytes.iter_mut().enumerate() {
            *byte = bus.load8(VALID_RESPONSE + offset as u64).unwrap();
        }
        let valid_response = DisplayInfoResponse::from_bytes(&valid_bytes).unwrap();
        assert_eq!(valid_response.header.ty, protocol::RESP_OK_DISPLAY_INFO);
        assert_eq!(valid_response.modes[0].enabled, 1);
        assert_eq!(valid_response.modes[0].width, 1280);
        assert_eq!(state.borrow().commands_served, 2);
    }

    #[test]
    fn virtio_gpu_malformed_guest_address_is_rejected_without_write() {
        let mut bus = SystemBus::new(Ram::new(1 << 20).unwrap());
        write_bytes(
            &mut bus,
            REQUEST,
            &CtrlHeader {
                ty: protocol::CMD_GET_DISPLAY_INFO,
                ..CtrlHeader::default()
            }
            .to_bytes(),
        );
        let end_straddling = DRAM_BASE + (1 << 20) as u64 - 8;
        let (slot, state, mut vq) =
            queue_for_test(&mut bus, &[(REQUEST, 24, 1, 1), (end_straddling, 24, 2, 0)]);
        slot.borrow_mut().write(0x050, Width::B4, 0).unwrap();

        service(&slot, &mut vq, &state, &mut bus);

        assert!(vq.is_none(), "bad descriptor drops the cached queue view");
        assert_ne!(
            read32(&mut slot.borrow_mut(), STATUS) & STATUS_NEEDS_RESET,
            0
        );
        assert_eq!(state.borrow().commands_served, 0);
        assert_eq!(bus.load16(USED + 2).unwrap(), 0, "no stale used entry");
    }
}
