//! E5-T11c: guest-facing keyboard eventq stream and no-repeat fixture.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::Machine;
use wasm_vm_core::RunOutcome;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::input::keyboard::{KEY_A, KEYBOARD_VIRTIO_SLOT, keyboard_spec};
use wasm_vm_core::dev::virtio::input::{EV_KEY, EV_SYN, INPUT_EVENT_SIZE, InputEvent, SYN_REPORT};
use wasm_vm_core::platform::{Platform, virt};

const RAM: usize = 8 * 1024 * 1024;
const EVENT_QUEUE: u32 = 0;
const EVENT_QUEUE_SIZE: u16 = 128;
const EVENT_DESC: u64 = virt::DRAM_BASE + 0x10_0000;
const EVENT_AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
const EVENT_USED: u64 = virt::DRAM_BASE + 0x12_0000;
const EVENT_BUF: u64 = virt::DRAM_BASE + 0x13_0000;

fn configure_eventq(machine: &mut Machine, slot_base: u64, buffer_count: u16) {
    machine.bus_mut().store16(EVENT_AVAIL, 0).unwrap();
    machine.bus_mut().store16(EVENT_USED + 2, 0).unwrap();
    for index in 0..u64::from(EVENT_QUEUE_SIZE) {
        let desc = EVENT_DESC + 16 * index;
        let buffer = EVENT_BUF + u64::from(INPUT_EVENT_SIZE as u16) * index;
        machine.bus_mut().store64(desc, buffer).unwrap();
        machine
            .bus_mut()
            .store32(desc + 8, INPUT_EVENT_SIZE as u32)
            .unwrap();
        machine.bus_mut().store16(desc + 12, 2).unwrap();
        machine.bus_mut().store16(desc + 14, 0).unwrap();
    }

    let write = |machine: &mut Machine, offset: u64, value: u32| {
        machine
            .bus_mut()
            .store32(slot_base + offset, value)
            .unwrap();
    };
    write(machine, 0x30, EVENT_QUEUE);
    write(machine, 0x38, u32::from(EVENT_QUEUE_SIZE));
    write(machine, 0x80, EVENT_DESC as u32);
    write(machine, 0x84, (EVENT_DESC >> 32) as u32);
    write(machine, 0x90, EVENT_AVAIL as u32);
    write(machine, 0x94, (EVENT_AVAIL >> 32) as u32);
    write(machine, 0xa0, EVENT_USED as u32);
    write(machine, 0xa4, (EVENT_USED >> 32) as u32);
    write(machine, 0x44, 1);

    for index in 0..buffer_count {
        machine
            .bus_mut()
            .store16(EVENT_AVAIL + 4 + 2 * u64::from(index), index)
            .unwrap();
    }
    machine
        .bus_mut()
        .store16(EVENT_AVAIL + 2, buffer_count)
        .unwrap();
}

fn read_events(machine: &mut Machine) -> Vec<InputEvent> {
    let used = machine.bus_mut().load16(EVENT_USED + 2).unwrap();
    (0..used)
        .map(|index| {
            let head = machine
                .bus_mut()
                .load32(EVENT_USED + 4 + 8 * u64::from(index))
                .unwrap() as u64;
            assert_eq!(
                machine
                    .bus_mut()
                    .load32(EVENT_USED + 8 + 8 * u64::from(index))
                    .unwrap(),
                INPUT_EVENT_SIZE as u32
            );
            let addr = EVENT_BUF + INPUT_EVENT_SIZE as u64 * head;
            let mut bytes = [0u8; INPUT_EVENT_SIZE];
            for (offset, byte) in bytes.iter_mut().enumerate() {
                *byte = machine.bus_mut().load8(addr + offset as u64).unwrap();
            }
            InputEvent::from_bytes(&bytes)
        })
        .collect()
}

fn run_one_boundary(machine: &mut Machine) {
    assert_eq!(machine.run(1), RunOutcome::MaxInstrs);
}

fn serial_fixture(events: &[InputEvent], hold_key_events: usize, repeat_events: usize) -> String {
    let mut out = String::from(
        "keyboard-evdev-proof-v1\n\
device=/dev/input/event0\n\
B: EV=20013\n\
B: LED=7\n\
B: MSC=10\n\
EV_REP=absent\n",
    );
    for event in events {
        let label = match (event.event_type, event.code, event.value) {
            (EV_KEY, KEY_A, 1) => "EV_KEY KEY_A 1",
            (EV_KEY, KEY_A, 0) => "EV_KEY KEY_A 0",
            (EV_SYN, SYN_REPORT, 0) => "EV_SYN SYN_REPORT 0",
            _ => panic!("unexpected keyboard fixture event: {event:?}"),
        };
        out.push_str(label);
        out.push('\n');
    }
    out.push_str(&format!(
        "HOLD KEY_A_DOWN events={hold_key_events} repeat={repeat_events}\n"
    ));
    out
}

#[test]
fn keyboard_make_break_stream_matches_serial_fixture() {
    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    let _slots = machine.enable_virtio_slots(None);
    let (_slot, input_state, _leds) = machine.enable_virtio_keyboard();
    let slot_base = Platform::virtio_base(KEYBOARD_VIRTIO_SLOT as u64);
    machine
        .bus_mut()
        .store32(virt::KERNEL_BASE, 0x0000_006f)
        .unwrap();
    machine.hart_mut().regs.pc = virt::KERNEL_BASE;
    configure_eventq(&mut machine, slot_base, 4);

    input_state.borrow_mut().inject_event(EV_KEY, KEY_A, 1);
    input_state.borrow_mut().sync();
    input_state.borrow_mut().inject_event(EV_KEY, KEY_A, 0);
    input_state.borrow_mut().sync();
    run_one_boundary(&mut machine);

    let expected = vec![
        InputEvent::new(EV_KEY, KEY_A, 1),
        InputEvent::new(EV_SYN, SYN_REPORT, 0),
        InputEvent::new(EV_KEY, KEY_A, 0),
        InputEvent::new(EV_SYN, SYN_REPORT, 0),
    ];
    let observed = read_events(&mut machine);
    assert_eq!(observed, expected);
    assert_eq!(input_state.borrow().pending_events(), 0);
    assert_eq!(
        serial_fixture(&observed, 1, 0),
        include_str!("../../../evidence/e5-t11c/keyboard-evdev-serial.txt")
    );
}

#[test]
fn one_keydown_has_no_transport_repeat_and_undeclared_edge_is_not_in_fixture() {
    let spec = keyboard_spec();
    let repeat = spec
        .event_bitmap(wasm_vm_core::dev::virtio::input::EV_REP)
        .unwrap();
    assert!(repeat.iter().all(|byte| *byte == 0));
    assert!(spec.event_bitmap(EV_KEY).unwrap()[31] & 1 != 0);
    assert_eq!(spec.event_bitmap(EV_KEY).unwrap()[31] & 2, 0);

    let mut machine = Machine::new(RAM);
    machine.enable_plic();
    let _slots = machine.enable_virtio_slots(None);
    let (_slot, input_state, _leds) = machine.enable_virtio_keyboard();
    let slot_base = Platform::virtio_base(KEYBOARD_VIRTIO_SLOT as u64);
    machine
        .bus_mut()
        .store32(virt::KERNEL_BASE, 0x0000_006f)
        .unwrap();
    machine.hart_mut().regs.pc = virt::KERNEL_BASE;
    configure_eventq(&mut machine, slot_base, 16);

    input_state.borrow_mut().inject_event(EV_KEY, KEY_A, 1);
    input_state.borrow_mut().sync();
    run_one_boundary(&mut machine);
    for _ in 0..32 {
        run_one_boundary(&mut machine);
    }

    let observed = read_events(&mut machine);
    assert_eq!(
        observed,
        vec![
            InputEvent::new(EV_KEY, KEY_A, 1),
            InputEvent::new(EV_SYN, SYN_REPORT, 0),
        ]
    );
    assert_eq!(
        observed
            .iter()
            .filter(|event| event.event_type == EV_KEY && event.code == KEY_A)
            .count(),
        1
    );
    assert_eq!(input_state.borrow().dropped_events, 0);
}
