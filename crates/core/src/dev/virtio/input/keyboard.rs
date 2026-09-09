//! Declarative virtio-input keyboard capability map (E5-T11a).
//!
//! The host sends make/break events only.  `EV_REP` is deliberately not advertised: Linux and
//! desktop clients own repeat timing once a key-down is delivered, so the browser never creates a
//! second, competing repeat stream.

use alloc::rc::Rc;
use core::cell::RefCell;

use super::{
    BUS_VIRTUAL, EV_KEY, EV_LED, EV_MSC, EV_SYN, InputDeviceSpec, InputDevids, InputEvent,
    InputStatusSink, SYN_REPORT,
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

/// Stable virtio-mmio slot used by the keyboard when the standard slots are attached.
pub const KEYBOARD_VIRTIO_SLOT: usize = 3;

/// Linux input-event-codes.h: the canonical `KEY_A` make/break code.
pub const KEY_A: u16 = 30;
/// Linux input-event-codes.h: an edge code used by keyboard-map adversarial fixtures.
pub const KEY_F24: u16 = 194;

/// The PC-105 evdev key range used by the instance.  The range starts at KEY_ESC (1) and extends
/// through the physical/media-key portion Linux accepts for a full keyboard device.
pub const PC105_KEY_RANGE: core::ops::RangeInclusive<u16> = 1..=248;

/// Linux input-event-codes.h LED codes.
pub const LED_NUML: u16 = 0;
pub const LED_CAPSL: u16 = 1;
pub const LED_SCROLLL: u16 = 2;
/// Linux input-event-codes.h's optional scan-code event.
pub const MSC_SCAN: u16 = 4;

/// Host-owned state mirrored from guest `EV_LED` statusq events.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct KeyboardLedState {
    pub num_lock: bool,
    pub caps_lock: bool,
    pub scroll_lock: bool,
}

/// Shared host/UI handle returned by keyboard registration.
pub type KeyboardLedHandle = Rc<RefCell<KeyboardLedState>>;

impl KeyboardLedState {
    /// Apply one canonical `EV_LED` status event. Unknown event types/codes and non-boolean LED
    /// values are ignored so malformed guest input cannot change the host indicator.
    pub fn apply_status_event(&mut self, event: InputEvent) -> bool {
        if event.event_type != EV_LED || !matches!(event.value, 0 | 1) {
            return false;
        }
        let value = event.value == 1;
        match event.code {
            LED_NUML => self.num_lock = value,
            LED_CAPSL => self.caps_lock = value,
            LED_SCROLLL => self.scroll_lock = value,
            _ => return false,
        }
        true
    }
}

/// `InputStatusSink` adapter that retains the keyboard LED state for a host/UI observer.
pub struct KeyboardLedSink {
    state: KeyboardLedHandle,
}

impl KeyboardLedSink {
    pub fn new(state: KeyboardLedHandle) -> Self {
        Self { state }
    }

    pub fn state(&self) -> KeyboardLedHandle {
        Rc::clone(&self.state)
    }
}

impl InputStatusSink for KeyboardLedSink {
    fn on_status_event(&mut self, event: InputEvent) {
        self.state.borrow_mut().apply_status_event(event);
    }
}

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
    use crate::dev::virtio::input::{
        EV_REP, INPUT_CONFIG_UNION_SIZE, VIRTIO_INPUT_CFG_EV_BITS, VIRTIO_INPUT_CFG_ID_DEVIDS,
        VIRTIO_INPUT_CFG_ID_NAME, VirtioInput,
    };
    use crate::dev::virtio::mmio::VirtioMmio;
    use crate::mmio::{MmioDevice, Width};

    use alloc::rc::Rc;

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

    #[test]
    fn keyboard_led_sink_applies_only_canonical_status_events() {
        let state = Rc::new(RefCell::new(KeyboardLedState::default()));
        let mut sink = KeyboardLedSink::new(Rc::clone(&state));
        for (code, value) in [
            (LED_CAPSL, 1),
            (LED_NUML, 1),
            (LED_CAPSL, 0),
            (LED_SCROLLL, 1),
        ] {
            sink.on_status_event(InputEvent::new(EV_LED, code, value));
        }
        assert_eq!(
            *state.borrow(),
            KeyboardLedState {
                num_lock: true,
                caps_lock: false,
                scroll_lock: true,
            }
        );
        assert!(
            !state
                .borrow_mut()
                .apply_status_event(InputEvent::new(EV_KEY, 30, 1))
        );
        assert!(
            !state
                .borrow_mut()
                .apply_status_event(InputEvent::new(EV_LED, LED_CAPSL, 2))
        );
        assert!(!state.borrow().caps_lock);
    }

    #[test]
    fn keyboard_config_fixture_is_exact_on_native() {
        let spec = keyboard_spec();
        let mut slot = VirtioMmio::new(Box::new(VirtioInput::new(spec.clone())));

        select(&mut slot, VIRTIO_INPUT_CFG_ID_NAME, 0);
        assert_eq!(
            read_bytes(&mut slot, 8, KEYBOARD_NAME.len()),
            KEYBOARD_NAME.as_bytes()
        );

        select(&mut slot, VIRTIO_INPUT_CFG_ID_DEVIDS, 0);
        assert_eq!(slot.read(CONFIG + 2, Width::B1).unwrap(), 8);
        assert_eq!(read_bytes(&mut slot, 8, 8), KEYBOARD_DEVIDS.to_bytes());

        let mut key = [0u8; INPUT_CONFIG_UNION_SIZE];
        key[0] = 0xfe;
        key[1..31].fill(0xff);
        key[31] = 0x01;
        assert_config_bitmap(&mut slot, EV_KEY, 32, &key);

        let mut led = [0u8; INPUT_CONFIG_UNION_SIZE];
        led[0] = (1 << LED_NUML) | (1 << LED_CAPSL) | (1 << LED_SCROLLL);
        assert_config_bitmap(&mut slot, EV_LED, 1, &led);

        let mut msc = [0u8; INPUT_CONFIG_UNION_SIZE];
        msc[0] = 1 << MSC_SCAN;
        assert_config_bitmap(&mut slot, EV_MSC, 1, &msc);

        let mut syn = [0u8; INPUT_CONFIG_UNION_SIZE];
        syn[0] = 1;
        assert_config_bitmap(&mut slot, EV_SYN, 1, &syn);

        let repeat = [0u8; INPUT_CONFIG_UNION_SIZE];
        assert_config_bitmap(&mut slot, EV_REP, 0, &repeat);
    }

    fn assert_config_bitmap(
        slot: &mut VirtioMmio,
        event_type: u16,
        expected_size: usize,
        expected: &[u8; INPUT_CONFIG_UNION_SIZE],
    ) {
        select(slot, VIRTIO_INPUT_CFG_EV_BITS, event_type as u8);
        assert_eq!(
            slot.read(CONFIG + 2, Width::B1).unwrap(),
            expected_size as u64
        );
        assert_eq!(read_bytes(slot, 8, INPUT_CONFIG_UNION_SIZE), expected);
    }
}
