//! E0-T12 console integration suite: byte-exactness through the bus, width behavior,
//! boundary faults, flood, and a guest program actually printing via `sb`.

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::{UART0_BASE, UART0_LEN};
use wasm_vm_core::dev::console::{Uart0Stub, VecSink};
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

// 1M natively; 5k under miri (interpreting 1M stores would take ~an hour and only
// re-proves the O(1)-device-state property the smaller count already shows).
#[cfg(miri)]
const FLOOD: u32 = 5_000;
#[cfg(not(miri))]
const FLOOD: u32 = 1_000_000;

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

// ── acceptance anchors ──────────────────────────────────────────────────────

#[test]
fn binary_safe_no_translation_acceptance() {
    // "Hi\n\0\xFF" → exactly 48 69 0A 00 FF, no CRLF, no UTF-8 validation.
    let (mut bus, sink) = bus_with_console();
    for &b in b"Hi\n\0\xFF" {
        bus.store8(UART0_BASE, b).unwrap();
    }
    assert_eq!(sink.captured(), [0x48, 0x69, 0x0A, 0x00, 0xFF]);
}

#[test]
fn all_256_byte_values_round_trip_exactly_acceptance() {
    // Adversarial angle 1 done proactively: emit every byte value, compare byte-exact.
    let (mut bus, sink) = bus_with_console();
    for b in 0u16..256 {
        bus.store8(UART0_BASE, b as u8).unwrap();
    }
    let expected: Vec<u8> = (0..=255u8).collect();
    assert_eq!(sink.captured(), expected, "any translation refutes");
}

#[test]
fn every_width_emits_exactly_one_low_byte_acceptance() {
    // sd 0x4141_4141_4141_4142 → single 'B' (0x42), not eight bytes.
    let (mut bus, sink) = bus_with_console();
    bus.store8(UART0_BASE, 0x41).unwrap();
    bus.store16(UART0_BASE, 0xFF42).unwrap();
    bus.store32(UART0_BASE, 0xDEAD_BE43).unwrap();
    bus.store64(UART0_BASE, 0x4141_4141_4141_4144).unwrap();
    assert_eq!(sink.captured(), [0x41, 0x42, 0x43, 0x44]);
    assert_eq!(sink.len(), 4, "one byte per store regardless of width");
}

#[test]
fn one_past_window_is_bus_access_fault_acceptance() {
    // Adversarial angle 3: store at UART0_BASE + 0x100 (one past the window) must be
    // an access fault (unmapped hole), NOT a silent device ignore.
    let (mut bus, sink) = bus_with_console();
    assert!(bus.store8(UART0_BASE + UART0_LEN, 0x41).is_err());
    // last valid offset (0xFF) still routes to the device (ignored, no emit)
    bus.store8(UART0_BASE + UART0_LEN - 1, 0x41).unwrap();
    assert!(
        sink.is_empty(),
        "only THR emits; the last offset is ignored"
    );
}

#[test]
fn million_byte_flood_completes_device_state_bounded() {
    // Adversarial angle 5 shape + flood: device holds no growing buffer.
    let (mut bus, sink) = bus_with_console();
    for i in 0..FLOOD {
        bus.store8(UART0_BASE, i as u8).unwrap();
    }
    assert_eq!(sink.len(), FLOOD as usize);
    // Hostile guest hammering all 255 unused offsets: bounded log state, no growth.
    for _ in 0..1000 {
        for off in 1..UART0_LEN {
            if off == 5 {
                continue;
            }
            bus.store8(UART0_BASE + off, 0xAA).unwrap();
        }
    }
    assert_eq!(
        sink.len(),
        FLOOD as usize,
        "non-THR writes never reach the sink"
    );
}

// ── a guest program actually printing ───────────────────────────────────────

#[test]
fn guest_prints_hello_via_sb_loop() {
    // A tiny program: for each byte of "Hi!\n", sb it to UART0 (x6 = base), then halt.
    // Instructions are seeded directly; x5 holds each byte, x6 the console address.
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let sink = VecSink::new();
    bus.attach(
        UART0_BASE,
        UART0_LEN,
        Box::new(Uart0Stub::new(sink.clone())),
    )
    .unwrap();
    let mut hart = Hart::new();
    let code = wasm_vm_core::bus::mmap::DRAM_BASE;
    hart.regs.pc = code;
    hart.regs.write(6, UART0_BASE);

    // sb x5, 0(x6)
    let sb = |rs2: u8, rs1: u8| ((rs2 as u32) << 20) | ((rs1 as u32) << 15) | 0b0100011;
    // addi x5, x0, imm
    let li = |imm: i32| (((imm as u32) & 0xFFF) << 20) | (5 << 7) | 0b0010011;
    let mut at = code;
    let put = |bus: &mut SystemBus, w: u32, at: &mut u64| {
        bus.store32(*at, w).unwrap();
        *at += 4;
    };
    for &c in b"Hi!\n" {
        put(&mut bus, li(i32::from(c)), &mut at);
        put(&mut bus, sb(5, 6), &mut at);
    }
    let n_instrs = 8; // 4 chars × (li + sb)
    for _ in 0..n_instrs {
        hart.step(&mut bus).unwrap();
    }
    assert_eq!(sink.captured(), b"Hi!\n");
}
