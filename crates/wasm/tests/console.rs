//! wasm32 mirror of the E0-T12 console suite — byte-exactness and width behavior on
//! the actual wasm32 target (the same VecSink capture the CLI/JS sinks will mirror).

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::{UART0_BASE, UART0_LEN};
use wasm_vm_core::dev::console::{Uart0Stub, VecSink};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

fn bus_with_console() -> (SystemBus, VecSink) {
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let sink = VecSink::new();
    bus.attach(
        UART0_BASE,
        UART0_LEN,
        Box::new(Uart0Stub::new(sink.clone())),
    )
    .unwrap();
    (bus, sink)
}

#[wasm_bindgen_test]
fn byte_exact_and_widths_on_wasm32() {
    let (mut bus, sink) = bus_with_console();
    for &b in b"Hi\n\0\xFF" {
        bus.store8(UART0_BASE, b).unwrap();
    }
    bus.store64(UART0_BASE, 0x4141_4141_4141_4142).unwrap(); // → one 'B'
    assert_eq!(sink.captured(), [0x48, 0x69, 0x0A, 0x00, 0xFF, 0x42]);
}

#[wasm_bindgen_test]
fn lsr_ready_and_boundary_fault_on_wasm32() {
    let (mut bus, sink) = bus_with_console();
    assert_eq!(bus.load8(UART0_BASE + 5), Ok(0x60));
    assert_eq!(bus.load8(UART0_BASE), Ok(0));
    assert!(bus.store8(UART0_BASE + UART0_LEN, 0x41).is_err());
    assert!(sink.is_empty());
}

#[wasm_bindgen_test]
fn all_256_values_exact_on_wasm32() {
    let (mut bus, sink) = bus_with_console();
    for b in 0u16..256 {
        bus.store8(UART0_BASE, b as u8).unwrap();
    }
    let expected: Vec<u8> = (0..=255u8).collect();
    assert_eq!(sink.captured(), expected);
}
