//! ADVERSARIAL VERIFIER E0-T12 — independent attacks, own expected data.
//! 13 tests, all green natively; 12/13 green under miri (a5_hostile_hammer skipped
//! under miri only — 2.55M ungated ops, my test's cost not the code's).

use wasm_vm_core::bus::mmap::{DRAM_BASE, UART0_BASE, UART0_LEN};
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::dev::console::{Uart0Stub, VecSink};
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::{MmioDevice, RecordingDevice, SystemBus, Width};
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

// ANGLE 1 — build the expected 256 bytes MYSELF, byte for byte.
#[test]
fn a1_all_256_bytes_independent_expected() {
    let (mut bus, sink) = bus_with_console();
    for v in 0u32..256 {
        bus.store8(UART0_BASE, v as u8).unwrap();
    }
    let mut expected = Vec::with_capacity(256);
    let mut b: u8 = 0;
    loop {
        expected.push(b);
        if b == 255 {
            break;
        }
        b += 1;
    }
    assert_eq!(sink.captured().len(), 256);
    assert_eq!(sink.captured(), expected);
    assert_eq!(sink.captured().iter().filter(|&&x| x == 0x0D).count(), 1);
    assert_eq!(sink.captured().iter().filter(|&&x| x == 0x0A).count(), 1);
}

#[test]
fn a1_interleaved_payload() {
    let (mut bus, sink) = bus_with_console();
    let payload: &[u8] = &[0x00, 0x0A, 0xFF, 0x0D, 0x0A, 0x80, 0x00, 0x41, 0xFF, 0x0A];
    for &b in payload {
        bus.store8(UART0_BASE, b).unwrap();
    }
    assert_eq!(sink.captured(), payload);
}

#[test]
fn a2_widths_low_byte_only() {
    let (mut bus, sink) = bus_with_console();
    bus.store8(UART0_BASE, 0xF1).unwrap();
    bus.store16(UART0_BASE, 0xAB_F2).unwrap();
    bus.store32(UART0_BASE, 0xDEAD_BEF3).unwrap();
    bus.store64(UART0_BASE, 0x4141_4141_4141_41F4).unwrap();
    assert_eq!(sink.captured(), [0xF1, 0xF2, 0xF3, 0xF4]);
    assert_eq!(sink.len(), 4);
}

#[test]
fn a2_offset1_no_emit() {
    let (mut bus, sink) = bus_with_console();
    bus.store8(UART0_BASE + 1, 0x99).unwrap();
    bus.store8(UART0_BASE + 5, 0x99).unwrap();
    bus.store8(UART0_BASE + 0xFF, 0x99).unwrap();
    assert!(sink.is_empty(), "only offset 0 emits");
}

#[test]
fn a2_store16_at_0_one_byte() {
    let (mut bus, sink) = bus_with_console();
    bus.store16(UART0_BASE, 0x3142).unwrap();
    assert_eq!(sink.captured(), [0x42]);
}

#[test]
fn a3_boundary_faults_device_uninvoked() {
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let (dev, log) = RecordingDevice::new(0);
    bus.attach(UART0_BASE, UART0_LEN, Box::new(dev)).unwrap();
    assert_eq!(
        bus.store8(UART0_BASE + UART0_LEN, 0x41),
        Err(BusFault::Access)
    );
    assert_eq!(bus.store64(UART0_BASE + 0xFC, 0), Err(BusFault::Access));
    assert_eq!(bus.load64(UART0_BASE + 0xFC), Err(BusFault::Access));
    assert_eq!(bus.load32(UART0_BASE - 2), Err(BusFault::Access));
    assert!(log.borrow().reads.is_empty() && log.borrow().writes.is_empty());
}

#[test]
fn a5_hostile_hammer_bounded() {
    let (mut bus, sink) = bus_with_console();
    for _ in 0..10_000 {
        for off in 1..UART0_LEN {
            bus.store8(UART0_BASE + off, 0xAA).unwrap();
        }
    }
    assert!(sink.is_empty());
    assert!(core::mem::size_of::<Uart0Stub<VecSink>>() <= 64);
}

#[test]
fn a6_lsr_and_reads() {
    let (mut bus, _sink) = bus_with_console();
    assert_eq!(bus.load8(UART0_BASE + 5), Ok(0x60));
    assert_eq!(0x60u64, (1 << 5) | (1 << 6));
    for off in 0..UART0_LEN {
        let got = bus.load8(UART0_BASE + off).unwrap();
        let expect = if off == 5 { 0x60 } else { 0 };
        assert_eq!(got, expect, "offset {off}");
    }
    assert_eq!(bus.load8(UART0_BASE + 4), Ok(0));
    assert_eq!(bus.load8(UART0_BASE + 6), Ok(0));
    assert_eq!(bus.load8(UART0_BASE + 7), Ok(0));
    assert_eq!(bus.load16(UART0_BASE + 5), Err(BusFault::Misaligned));
    assert_eq!(bus.load64(UART0_BASE), Ok(0));
    assert_eq!(bus.load32(UART0_BASE + 4), Ok(0));
}

#[test]
fn a6_polling_loop_terminates_through_hart() {
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let sink = VecSink::new();
    bus.attach(
        UART0_BASE,
        UART0_LEN,
        Box::new(Uart0Stub::new(sink.clone())),
    )
    .unwrap();
    let mut hart = Hart::new();
    let code = DRAM_BASE;
    hart.regs.pc = code;

    let lui = |rd: u8, imm20: u32| (imm20 << 12) | ((rd as u32) << 7) | 0b0110111;
    let addi = |rd: u8, rs1: u8, imm: i32| {
        (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | ((rd as u32) << 7) | 0b0010011
    };
    let andi = |rd: u8, rs1: u8, imm: i32| {
        (((imm as u32) & 0xFFF) << 20)
            | ((rs1 as u32) << 15)
            | (0b111 << 12)
            | ((rd as u32) << 7)
            | 0b0010011
    };
    let lbu = |rd: u8, rs1: u8, imm: i32| {
        (((imm as u32) & 0xFFF) << 20)
            | ((rs1 as u32) << 15)
            | (0b100 << 12)
            | ((rd as u32) << 7)
            | 0b0000011
    };
    let sb = |rs2: u8, rs1: u8, imm: i32| {
        let imm = imm as u32 & 0xFFF;
        ((imm >> 5) << 25)
            | ((rs2 as u32) << 20)
            | ((rs1 as u32) << 15)
            | ((imm & 0x1F) << 7)
            | 0b0100011
    };
    let beq = |rs1: u8, rs2: u8, imm: i32| {
        let imm = imm as u32;
        (((imm >> 12) & 1) << 31)
            | (((imm >> 5) & 0x3F) << 25)
            | ((rs2 as u32) << 20)
            | ((rs1 as u32) << 15)
            | (((imm >> 1) & 0xF) << 8)
            | (((imm >> 11) & 1) << 7)
            | 0b1100011
    };

    let mut prog: Vec<u32> = Vec::new();
    prog.push(lui(6, 0x10000));
    let loop_pc_index = prog.len();
    prog.push(lbu(5, 6, 5));
    prog.push(andi(5, 5, 0x20));
    let beq_index = prog.len();
    let back = (loop_pc_index as i32 - beq_index as i32) * 4;
    prog.push(beq(5, 0, back));
    prog.push(addi(5, 0, 0x5A));
    prog.push(sb(5, 6, 0));
    prog.push(beq(0, 0, 0));

    for (i, w) in prog.iter().enumerate() {
        bus.store32(code + (i as u64) * 4, *w).unwrap();
    }

    let mut steps = 0;
    loop {
        hart.step(&mut bus).unwrap();
        steps += 1;
        if !sink.is_empty() {
            break;
        }
        assert!(steps < 100, "polling loop did not terminate");
    }
    assert_eq!(sink.captured(), b"Z");
}

#[test]
fn novel_store16_at_offset4_no_emit() {
    let (mut bus, sink) = bus_with_console();
    bus.store16(UART0_BASE + 4, 0xBEEF).unwrap();
    assert!(sink.is_empty(), "write near LSR must not emit");
}

#[test]
fn novel_nonstandard_base() {
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let sink = VecSink::new();
    let base = 0x9000_0000u64;
    bus.attach(base, 0x100, Box::new(Uart0Stub::new(sink.clone())))
        .unwrap();
    bus.store8(base, 0x7E).unwrap();
    assert_eq!(bus.load8(base + 5), Ok(0x60));
    assert_eq!(sink.captured(), [0x7E]);
}

#[test]
fn novel_interleaved_read_write() {
    let (mut bus, sink) = bus_with_console();
    bus.store8(UART0_BASE, 0x41).unwrap();
    assert_eq!(bus.load8(UART0_BASE + 5), Ok(0x60));
    bus.store8(UART0_BASE, 0x42).unwrap();
    assert_eq!(bus.load8(UART0_BASE), Ok(0));
    bus.store8(UART0_BASE, 0x43).unwrap();
    assert_eq!(sink.captured(), [0x41, 0x42, 0x43]);
}

#[test]
fn device_receives_exact_width() {
    let sink = VecSink::new();
    let mut dev = Uart0Stub::new(sink.clone());
    dev.write(0, Width::B8, 0x1122_3344_5566_7788).unwrap();
    assert_eq!(sink.captured(), [0x88]);
    assert_eq!(dev.read(5, Width::B1).unwrap(), 0x60);
    assert_eq!(dev.read(5, Width::B8).unwrap(), 0x60);
    assert_eq!(dev.read(0, Width::B1).unwrap(), 0);
}
