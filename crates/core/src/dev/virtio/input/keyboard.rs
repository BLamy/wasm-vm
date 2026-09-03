//! Declarative virtio-input keyboard capability map (E5-T11a).
//!
//! The host sends make/break events only.  `EV_REP` is deliberately not advertised: Linux and
//! desktop clients own repeat timing once a key-down is delivered, so the browser never creates a
//! second, competing repeat stream.

use super::{
    BUS_VIRTUAL, EV_KEY, EV_LED, EV_MSC, EV_SYN, InputDeviceSpec, InputDevids, SYN_REPORT,
};

/// Stable keyboard identity exposed through `VIRTIO_INPUT_CFG_ID_NAME`.
pub const KEYBOARD_NAME: &str = "wasm-vm virtio keyboard";
/// Fixed virtual-bus identity used by the keyboard fixture.
pub const KEYBOARD_DEVIDS: InputDevids = InputDevids {
    bustype: BUS_VIRTUAL,
    vendor: 0xfeed,
    product: 0x0001,
    version: 0x0100,
};

/// The PC-105 evdev key range used by the instance.  The range starts at KEY_ESC (1) and extends
/// through the physical/media-key portion Linux accepts for a full keyboard device.
pub const PC105_KEY_RANGE: core::ops::RangeInclusive<u16> = 1..=248;

/// Linux input-event-codes.h LED codes.
pub const LED_NUML: u16 = 0;
pub const LED_CAPSL: u16 = 1;
pub const LED_SCROLLL: u16 = 2;
/// Linux input-event-codes.h's optional scan-code event.
pub const MSC_SCAN: u16 = 4;

/// Build the concrete keyboard capability declaration.  EV_REP is intentionally absent.
pub fn keyboard_spec() -> InputDeviceSpec {
    let mut spec = InputDeviceSpec::new(KEYBOARD_NAME, KEYBOARD_DEVIDS);
    assert!(spec.set_event_bit(EV_SYN, SYN_REPORT));
    for code in PC105_KEY_RANGE {
        assert!(spec.set_event_bit(EV_KEY, code));
    }
    for led in [LED_NUML, LED_CAPSL, LED_SCROLLL] {
        assert!(spec.set_event_bit(EV_LED, led));
    }
    assert!(spec.set_event_bit(EV_MSC, MSC_SCAN));
    spec
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::virtio::input::{EV_REP, INPUT_CONFIG_UNION_SIZE};

    fn bit(bitmap: &[u8; INPUT_CONFIG_UNION_SIZE], code: u16) -> bool {
        bitmap[usize::from(code / 8)] & (1 << (code % 8)) != 0
    }

    #[test]
    fn pc105_keyboard_bitmap_is_exact_and_repeat_is_absent() {
        let spec = keyboard_spec();
        let key = spec.event_bitmap(EV_KEY).unwrap();
        for code in 1..=248u16 {
            assert!(bit(key, code), "missing declared key code {code}");
        }
        assert_eq!(key[0], 0xfe, "KEY_RESERVED must remain undeclared");
        assert!(key[1..31].iter().all(|byte| *byte == 0xff));
        assert_eq!(key[31], 0x01, "KEY_MAX edge must remain exact");
        for code in 249..(INPUT_CONFIG_UNION_SIZE * 8) as u16 {
            assert!(!bit(key, code), "undeclared key code {code} was added");
        }

        let led = spec.event_bitmap(EV_LED).unwrap();
        assert!(bit(led, LED_NUML));
        assert!(bit(led, LED_CAPSL));
        assert!(bit(led, LED_SCROLLL));
        assert_eq!(led[0], 0x07);
        assert!(led[1..].iter().all(|byte| *byte == 0));

        let msc = spec.event_bitmap(EV_MSC).unwrap();
        assert!(bit(msc, MSC_SCAN));
        assert_eq!(msc[0], 0x10);
        assert!(msc[1..].iter().all(|byte| *byte == 0));
        let repeat = spec.event_bitmap(EV_REP).unwrap();
        assert!(repeat.iter().all(|byte| *byte == 0));
    }

    #[test]
    fn keyboard_identity_and_event_bitmap_tail_are_stable() {
        let spec = keyboard_spec();
        assert_eq!(spec.name, KEYBOARD_NAME);
        assert_eq!(spec.devids, KEYBOARD_DEVIDS);
        assert_eq!(spec.event_bitmap(EV_SYN).unwrap()[0], 1);
        // 248 is the final declared code: byte 31, bit 0.
        assert_eq!(spec.event_bitmap(EV_KEY).unwrap()[31], 0x01);
    }
}
