//! Declarative virtio-input tablet and relative-mouse capability maps (E5-T14a).
//!
//! The two devices deliberately share the same virtual vendor/version tuple but have distinct
//! product ids and virtio-mmio slots. Keeping the maps here makes the browser adapter a routing
//! layer over stable guest contracts instead of a second source of evdev constants.

use super::{
    AbsInfo, BUS_VIRTUAL, EV_ABS, EV_KEY, EV_REL, EV_SYN, InputDeviceSpec, InputDevids, SYN_REPORT,
};

/// Stable absolute tablet identity exposed through `VIRTIO_INPUT_CFG_ID_NAME`.
pub const TABLET_NAME: &str = "wasm-vm virtio tablet";
/// Stable relative mouse identity exposed through `VIRTIO_INPUT_CFG_ID_NAME`.
pub const MOUSE_NAME: &str = "wasm-vm virtio mouse";

/// Fixed virtual-bus identities used by the pointer fixtures.
pub const TABLET_DEVIDS: InputDevids = InputDevids {
    bustype: BUS_VIRTUAL,
    vendor: 0xfeed,
    product: 0x0002,
    version: 0x0100,
};
pub const MOUSE_DEVIDS: InputDevids = InputDevids {
    bustype: BUS_VIRTUAL,
    vendor: 0xfeed,
    product: 0x0003,
    version: 0x0100,
};

/// Stable virtio-mmio slots: keyboard remains slot 3, then tablet and mouse are adjacent.
pub const TABLET_VIRTIO_SLOT: usize = 4;
pub const MOUSE_VIRTIO_SLOT: usize = 5;
/// First slot not reserved by the browser's standard input device set.
pub const FIRST_FREE_VIRTIO_SLOT: usize = MOUSE_VIRTIO_SLOT + 1;

/// Linux `input-event-codes.h` pointer constants.
pub const ABS_X: u16 = 0;
pub const ABS_Y: u16 = 1;
pub const REL_X: u16 = 0;
pub const REL_Y: u16 = 1;
pub const REL_HWHEEL: u16 = 6;
pub const REL_WHEEL: u16 = 8;
pub const BTN_LEFT: u16 = 0x110;
pub const BTN_RIGHT: u16 = 0x111;
pub const BTN_MIDDLE: u16 = 0x112;
pub const BTN_SIDE: u16 = 0x113;
pub const BTN_EXTRA: u16 = 0x114;
/// Linux `input-prop.h`: an absolute tablet is a direct-input device.
pub const INPUT_PROP_DIRECT: u16 = 1;

const TABLET_ABS_RANGE: AbsInfo = AbsInfo {
    min: 0,
    max: 32767,
    fuzz: 0,
    flat: 0,
    resolution: 0,
};

fn add_common(spec: &mut InputDeviceSpec) {
    assert!(spec.set_event_bit(EV_SYN, SYN_REPORT));
    for button in [BTN_LEFT, BTN_RIGHT, BTN_MIDDLE, BTN_SIDE, BTN_EXTRA] {
        assert!(spec.set_event_bit(EV_KEY, button));
    }
}

/// Build the absolute tablet declaration. Coordinates are deliberately the QEMU/Linux-compatible
/// inclusive `0..32767` range so the browser can map the current CSS rectangle without a backing
/// pixel-size dependency.
pub fn tablet_spec() -> InputDeviceSpec {
    let mut spec = InputDeviceSpec::new(TABLET_NAME, TABLET_DEVIDS);
    assert!(spec.set_property_bit(INPUT_PROP_DIRECT));
    add_common(&mut spec);
    for axis in [ABS_X, ABS_Y] {
        assert!(spec.set_event_bit(EV_ABS, axis));
        assert!(spec.set_abs_info(axis, TABLET_ABS_RANGE));
    }
    spec
}

/// Build the relative mouse declaration. Both wheel axes are advertised even when a host only
/// emits vertical detents; the horizontal axis remains available for trackpads and shift-wheel.
pub fn mouse_spec() -> InputDeviceSpec {
    let mut spec = InputDeviceSpec::new(MOUSE_NAME, MOUSE_DEVIDS);
    add_common(&mut spec);
    for axis in [REL_X, REL_Y, REL_HWHEEL, REL_WHEEL] {
        assert!(spec.set_event_bit(EV_REL, axis));
    }
    spec
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::virtio::input::{
        INPUT_CONFIG_UNION_SIZE, VIRTIO_INPUT_CFG_ABS_INFO, VIRTIO_INPUT_CFG_ID_DEVIDS,
        VIRTIO_INPUT_CFG_ID_NAME, VirtioInput,
    };
    use crate::dev::virtio::mmio::VirtioMmio;
    use crate::mmio::{MmioDevice, Width};
    use alloc::boxed::Box;
    use alloc::vec::Vec;

    const CONFIG: u64 = 0x100;

    fn bit(bitmap: &[u8; INPUT_CONFIG_UNION_SIZE], code: u16) -> bool {
        bitmap[usize::from(code / 8)] & (1 << (code % 8)) != 0
    }

    fn select(slot: &mut VirtioMmio, selector: u8, subsel: u8) {
        slot.write(CONFIG, Width::B1, u64::from(selector)).unwrap();
        slot.write(CONFIG + 1, Width::B1, u64::from(subsel))
            .unwrap();
    }

    fn read_bytes(slot: &mut VirtioMmio, offset: u64, len: usize) -> Vec<u8> {
        (0..len)
            .map(|index| {
                slot.read(CONFIG + offset + index as u64, Width::B1)
                    .unwrap() as u8
            })
            .collect()
    }

    #[test]
    fn tablet_map_and_absolute_wire_metadata_are_exact() {
        let spec = tablet_spec();
        assert_eq!(spec.name, TABLET_NAME);
        assert_eq!(spec.devids, TABLET_DEVIDS);
        assert!(bit(spec.event_bitmap(EV_SYN).unwrap(), SYN_REPORT));
        for axis in [ABS_X, ABS_Y] {
            assert!(bit(spec.event_bitmap(EV_ABS).unwrap(), axis));
            assert_eq!(spec.abs_info[axis as usize], Some(TABLET_ABS_RANGE));
        }
        for button in [BTN_LEFT, BTN_RIGHT, BTN_MIDDLE, BTN_SIDE, BTN_EXTRA] {
            assert!(bit(spec.event_bitmap(EV_KEY).unwrap(), button));
        }
        assert_eq!(spec.event_bitmap(EV_KEY).unwrap()[34], 0x1f);
        assert_eq!(spec.event_bitmap(EV_KEY).unwrap()[35], 0);
    }

    #[test]
    fn mouse_map_has_only_relative_axes_and_both_wheels() {
        let spec = mouse_spec();
        let rel = spec.event_bitmap(EV_REL).unwrap();
        for axis in [REL_X, REL_Y, REL_HWHEEL, REL_WHEEL] {
            assert!(bit(rel, axis));
        }
        assert_eq!(rel[0], 0x43);
        assert_eq!(rel[1], 0x01);
        assert!(rel[2..].iter().all(|byte| *byte == 0));
        assert!(
            spec.event_bitmap(EV_ABS)
                .unwrap()
                .iter()
                .all(|byte| *byte == 0)
        );
        assert_eq!(spec.abs_info, [None; 64]);
    }

    #[test]
    fn pointer_config_selectors_do_not_cross_contaminate() {
        let spec = tablet_spec();
        let mut slot = VirtioMmio::new(Box::new(VirtioInput::new(spec.clone())));

        select(&mut slot, VIRTIO_INPUT_CFG_ID_NAME, 0);
        assert_eq!(
            read_bytes(&mut slot, 8, TABLET_NAME.len()),
            TABLET_NAME.as_bytes()
        );
        select(&mut slot, VIRTIO_INPUT_CFG_ID_DEVIDS, 0);
        assert_eq!(read_bytes(&mut slot, 8, 8), TABLET_DEVIDS.to_bytes());
        select(&mut slot, VIRTIO_INPUT_CFG_ABS_INFO, ABS_X as u8);
        assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 20);
        assert_eq!(read_bytes(&mut slot, 8, 20), TABLET_ABS_RANGE.to_bytes());

        select(&mut slot, VIRTIO_INPUT_CFG_ABS_INFO, 2);
        assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 0);
        assert_eq!(
            read_bytes(&mut slot, 8, INPUT_CONFIG_UNION_SIZE),
            vec![0; 128]
        );
    }

    #[test]
    fn tablet_absolute_injection_rejects_out_of_range_values() {
        let (device, state) = VirtioInput::new_with_state(tablet_spec());
        let _ = device;
        assert!(state.borrow_mut().inject_event(EV_ABS, ABS_X, 32767));
        assert!(!state.borrow_mut().inject_event(EV_ABS, ABS_Y, 32768));
        assert!(!state.borrow_mut().inject_event(EV_REL, REL_X, 1));
        state.borrow_mut().sync();
        assert_eq!(state.borrow().rejected_events, 2);
        assert_eq!(state.borrow().pending_events(), 2);
    }
}
