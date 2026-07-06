//! CRITIC (E3-T13 pass 2): hostile probes at the Machine wiring layer.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::block::MemBackend;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::net::{LoopbackBackend, MAC, NET_HDR_LEN};
use wasm_vm_core::platform::virt;
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 8 * 1024 * 1024;
const SLOT1: u64 = 0x1000_2000;

const RX_DESC: u64 = virt::DRAM_BASE + 0x10_0000;
const RX_AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
const RX_USED: u64 = virt::DRAM_BASE + 0x12_0000;
const RX_BUF: u64 = virt::DRAM_BASE + 0x13_0000;
const TX_DESC: u64 = virt::DRAM_BASE + 0x30_0000;
const TX_AVAIL: u64 = virt::DRAM_BASE + 0x31_0000;
const TX_USED: u64 = virt::DRAM_BASE + 0x32_0000;
const TX_BUF: u64 = virt::DRAM_BASE + 0x33_0000;
const F_WRITE: u16 = 2;

fn base_machine() -> Machine {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let _ = m.enable_virtio_blk(Box::new(MemBackend::new(vec![0u8; 512 * 64])));
    m
}

fn park(m: &mut Machine) {
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();
}

fn lifecycle(m: &mut Machine) {
    let w = |m: &mut Machine, off: u64, v: u32| m.bus_mut().store32(SLOT1 + off, v).unwrap();
    w(m, 0x70, 1);
    w(m, 0x70, 3);
    w(m, 0x24, 0);
    w(m, 0x20, 1 << 5);
    w(m, 0x24, 1);
    w(m, 0x20, 1);
    w(m, 0x70, 11);
    for (sel, d, a, u) in [
        (0u32, RX_DESC, RX_AVAIL, RX_USED),
        (1, TX_DESC, TX_AVAIL, TX_USED),
    ] {
        w(m, 0x30, sel);
        w(m, 0x38, 8);
        w(m, 0x80, d as u32);
        w(m, 0x84, 0);
        w(m, 0x90, a as u32);
        w(m, 0x94, 0);
        w(m, 0xa0, u as u32);
        w(m, 0xa4, 0);
        w(m, 0x44, 1);
    }
    w(m, 0x70, 15);
}

fn wdesc(m: &mut Machine, table: u64, i: u16, addr: u64, len: u32, flags: u16, next: u16) {
    let base = table + 16 * u64::from(i);
    m.bus_mut().store64(base, addr).unwrap();
    m.bus_mut().store32(base + 8, len).unwrap();
    m.bus_mut().store16(base + 12, flags).unwrap();
    m.bus_mut().store16(base + 14, next).unwrap();
}
fn publish(m: &mut Machine, avail: u64, size: u16, seq: &mut u16, head: u16) {
    m.bus_mut()
        .store16(avail + 4 + 2 * u64::from(*seq % size), head)
        .unwrap();
    *seq = seq.wrapping_add(1);
    m.bus_mut().store16(avail + 2, *seq).unwrap();
}

fn roundtrip(m: &mut Machine, rx_seq: &mut u16, tx_seq: &mut u16, rx_head: u16, tx_head: u16) {
    wdesc(m, RX_DESC, rx_head, RX_BUF, 2048, F_WRITE, 0);
    publish(m, RX_AVAIL, 8, rx_seq, rx_head);
    let mut frame = Vec::new();
    frame.extend_from_slice(&[0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]);
    frame.extend_from_slice(&MAC);
    frame.extend_from_slice(&[0x08, 0x00]);
    frame.extend(std::iter::repeat(0xA5u8).take(46));
    for i in 0..NET_HDR_LEN {
        m.bus_mut().store8(TX_BUF + i as u64, 0).unwrap();
    }
    for (i, &b) in frame.iter().enumerate() {
        m.bus_mut()
            .store8(TX_BUF + NET_HDR_LEN as u64 + i as u64, b)
            .unwrap();
    }
    wdesc(
        m,
        TX_DESC,
        tx_head,
        TX_BUF,
        (NET_HDR_LEN + frame.len()) as u32,
        0,
        0,
    );
    publish(m, TX_AVAIL, 8, tx_seq, tx_head);
    m.bus_mut().store32(SLOT1 + 0x50, 1).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
}

/// PROBE 1: enable_virtio_net before any slots exist must panic loudly, not index-OOB.
#[test]
#[should_panic(expected = "enable_virtio_slots/enable_virtio_blk before enable_virtio_net")]
fn net_before_slots_panics_with_message() {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let _ = m.enable_virtio_net(Box::new(LoopbackBackend::new()));
}

/// PROBE 2: QueueNotify kick on slot 1 BEFORE any lifecycle / QueueReady — the service
/// pass must not build rings, not raise a protocol violation over garbage, and not panic.
#[test]
fn premature_kick_before_driver_ok_is_harmless() {
    let mut m = base_machine();
    let (slot, state) = m.enable_virtio_net(Box::new(LoopbackBackend::new()));
    park(&mut m);
    // Kick with queues not ready.
    m.bus_mut().store32(SLOT1 + 0x50, 1).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    assert!(!slot.borrow().irq_level(), "no IRQ from a premature kick");
    assert_eq!(state.borrow().tx_count, 0);
    assert_eq!(state.borrow().rx_count, 0);
    // DEVICE_NEEDS_RESET (bit 6) must NOT have been set: status still 0.
    let status = m.bus_mut().load32(SLOT1 + 0x70).unwrap();
    assert_eq!(status & (1 << 6), 0, "premature kick flagged NEEDS_RESET");
    // Now do the real lifecycle; everything must still work.
    lifecycle(&mut m);
    let (mut rs, mut ts) = (0u16, 0u16);
    roundtrip(&mut m, &mut rs, &mut ts, 0, 0);
    assert_eq!(m.bus_mut().load16(RX_USED + 2).unwrap(), 1, "rx delivered");
    assert_eq!(state.borrow().rx_count, 1);
}

/// PROBE 3: transport reset (Status=0) after a completed roundtrip, then a full
/// re-lifecycle — the Machine-held ring views must be torn down and rebuilt cleanly.
#[test]
fn reset_midflight_then_relifecycle_roundtrips() {
    let mut m = base_machine();
    let (slot, state) = m.enable_virtio_net(Box::new(LoopbackBackend::new()));
    park(&mut m);
    lifecycle(&mut m);
    let (mut rs, mut ts) = (0u16, 0u16);
    roundtrip(&mut m, &mut rs, &mut ts, 0, 0);
    assert_eq!(state.borrow().rx_count, 1);

    // Transport reset with NO subsequent kick: run some boundaries — the reset must be
    // consumed (views dropped) without needing a kick, and nothing may fire.
    m.bus_mut().store32(SLOT1 + 0x70, 0).unwrap();
    assert_eq!(m.run(8), RunOutcome::MaxInstrs);
    assert!(!slot.borrow().irq_level(), "IRQ level survives reset");

    // Re-lifecycle from scratch (fresh rings, same addresses) and roundtrip again.
    // Zero the used rings so the assertions below see fresh state.
    for a in [RX_USED, TX_USED] {
        for off in 0..16u64 {
            m.bus_mut().store8(a + off, 0).unwrap();
        }
    }
    lifecycle(&mut m);
    let (mut rs2, mut ts2) = (0u16, 0u16);
    roundtrip(&mut m, &mut rs2, &mut ts2, 0, 0);
    assert_eq!(
        m.bus_mut().load16(RX_USED + 2).unwrap(),
        1,
        "rx after reset"
    );
    assert_eq!(state.borrow().rx_count, 2, "second echo delivered");
    assert!(slot.borrow().irq_level(), "IRQ raised after re-lifecycle");
}

/// PROBE 4: install_device into slot 0 (occupied by blk) refuses via Err and returns
/// the device untouched — blk keeps its slot (DeviceID stays 2).
#[test]
fn install_into_occupied_slot0_errs() {
    let mut m = base_machine();
    park(&mut m);
    let slot0 = 0x1000_1000u64;
    assert_eq!(
        m.bus_mut().load32(slot0 + 0x008).unwrap(),
        2,
        "blk in slot 0"
    );
    // Direct unit call against a fresh occupied VirtioMmio (the Machine API has no path
    // that targets slot 0, so probe install_device itself).
    use wasm_vm_core::dev::virtio::mmio::VirtioMmio;
    let (dev1, _s1) = wasm_vm_core::dev::virtio::net::new(Box::new(LoopbackBackend::new()));
    let mut occupied = VirtioMmio::new(Box::new(dev1));
    let (dev2, _s2) = wasm_vm_core::dev::virtio::net::new(Box::new(LoopbackBackend::new()));
    match occupied.install_device(Box::new(dev2)) {
        Err(_returned) => {} // device handed back, not dropped/replaced
        Ok(()) => panic!("install into an occupied transport succeeded"),
    }
    // And the machine's slot 0 is untouched.
    assert_eq!(m.bus_mut().load32(slot0 + 0x008).unwrap(), 2);
}
