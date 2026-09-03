//! Declarative virtio-input identity and configuration protocol (E5-T10a).
//!
//! The configuration surface is a fixed 136-byte window: `select`, `subsel`, `size`, five
//! reserved bytes, and a 128-byte union.  Selector writes only change the two selector bytes;
//! every read derives a fresh zero-filled payload, so an unsupported query cannot expose bytes
//! from the previous query.  Event queues and host injection are added by the following input
//! slices.

use super::VirtioDevice;

/// Virtio device id assigned to an input device.
pub const VIRTIO_INPUT_DEVICE_ID: u32 = 18;
/// The event queue is device-to-guest; the status queue is guest-to-device.
pub const EVENT_QUEUE: u32 = 0;
pub const STATUS_QUEUE: u32 = 1;

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
}

impl VirtioInput {
    /// Construct an input device from host-owned, declarative capabilities.
    pub fn new(spec: InputDeviceSpec) -> Self {
        Self {
            spec,
            select: VIRTIO_INPUT_CFG_UNSET,
            subsel: 0,
        }
    }

    /// Access the immutable capability declaration.
    pub fn spec(&self) -> &InputDeviceSpec {
        &self.spec
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
}
