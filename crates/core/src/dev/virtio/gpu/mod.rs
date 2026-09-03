//! The virtio-gpu identity/configuration boundary (Epic 5, E5-T01a).
//!
//! This slice deliberately stops before queue servicing.  It makes the device enumerable,
//! exposes the fixed virtio-gpu configuration registers, and keeps the protocol wire formats in
//! [`protocol`].  E5-T01b owns control-queue dispatch and display-info command completion.

pub mod protocol;

use super::VirtioDevice;

/// Virtio device type assigned to a GPU (virtio spec 1.2 §5.7).
pub const VIRTIO_GPU_DEVICE_ID: u32 = 16;
/// The initial device has one scanout; later display work may make this configurable.
pub const DEFAULT_NUM_SCANOUTS: u32 = 1;
/// E5-T01a exposes no 3D capsets.
pub const DEFAULT_NUM_CAPSETS: u32 = 0;

const CONFIG_LEN: usize = 16;

/// A minimal virtio-gpu device.  It owns only the configuration surface in this slice; queue
/// state remains owned by the generic virtio-mmio transport until E5-T01b adds servicing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VirtioGpu {
    events_read: u32,
}

impl VirtioGpu {
    /// Construct the default single-scanout, no-capset device.
    pub const fn new() -> Self {
        Self { events_read: 0 }
    }

    /// Current display event bits, exposed for the later hotplug slice and tests.
    pub const fn events_read(&self) -> u32 {
        self.events_read
    }

    /// Raise display event bits without exposing host pointers to the transport.
    pub fn raise_event(&mut self, bits: u32) {
        self.events_read |= bits;
    }

    fn config_bytes(&self) -> [u8; CONFIG_LEN] {
        let mut out = [0u8; CONFIG_LEN];
        out[0..4].copy_from_slice(&self.events_read.to_le_bytes());
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
        self.events_read &= !clear;
    }

    fn reset(&mut self) {
        self.events_read = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::virtio::mmio::VirtioMmio;
    use crate::mmio::{MmioDevice, Width};
    use protocol::{
        CTRL_HDR_SIZE, CtrlHeader, DISPLAY_INFO_RESPONSE_SIZE, DISPLAY_MODE_COUNT,
        DISPLAY_MODE_SIZE, DisplayInfoResponse, RESP_OK_DISPLAY_INFO,
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
}
