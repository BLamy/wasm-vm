//! E3-T13 pass 2: virtio-net full-stack through the Machine — device installed in SLOT 1
//! alongside blk in slot 0, driver lifecycle over the real slot-1 registers, kicks via the
//! real QueueNotify MMIO write, servicing at Machine run-loop boundaries, IRQ via the slot's
//! PLIC line. Mirrors the virtio_blk.rs harness one slot over.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::block::MemBackend;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::net::{LoopbackBackend, MAC, NET_HDR_LEN};
use wasm_vm_core::platform::virt;
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 8 * 1024 * 1024;
/// Slot 1 (net): VIRTIO_BASE + 1*stride.
const SLOT1: u64 = 0x1000_2000;

// Ring layout in guest RAM: rx queue then tx queue.
const RX_DESC: u64 = virt::DRAM_BASE + 0x10_0000;
const RX_AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
const RX_USED: u64 = virt::DRAM_BASE + 0x12_0000;
const RX_BUF: u64 = virt::DRAM_BASE + 0x13_0000;
// NOTE: keep clear of KERNEL_BASE (DRAM_BASE + 0x20_0000) — the parking instruction lives
// there; a ring table on top of it overwrites the "kernel" (found the hard way).
const TX_DESC: u64 = virt::DRAM_BASE + 0x30_0000;
const TX_AVAIL: u64 = virt::DRAM_BASE + 0x31_0000;
const TX_USED: u64 = virt::DRAM_BASE + 0x32_0000;
const TX_BUF: u64 = virt::DRAM_BASE + 0x33_0000;

const F_WRITE: u16 = 2;

fn machine() -> (
    Machine,
    std::rc::Rc<std::cell::RefCell<wasm_vm_core::dev::virtio::mmio::VirtioMmio>>,
    std::rc::Rc<std::cell::RefCell<wasm_vm_core::dev::virtio::net::NetState>>,
) {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    // blk claims slot 0 (the standard boot shape); net installs into slot 1.
    let _ = m.enable_virtio_blk(Box::new(MemBackend::new(vec![0u8; 512 * 64])));
    let (slot, state) = m.enable_virtio_net(Box::new(LoopbackBackend::new()));
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    // Park the "kernel" so run() can tick boundaries.
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();

    // Driver lifecycle on SLOT 1 over the real registers.
    let w = |m: &mut Machine, off: u64, v: u32| m.bus_mut().store32(SLOT1 + off, v).unwrap();
    w(&mut m, 0x70, 1); // ACKNOWLEDGE
    w(&mut m, 0x70, 3); // +DRIVER
    w(&mut m, 0x24, 0);
    w(&mut m, 0x20, 1 << 5); // accept VIRTIO_NET_F_MAC
    w(&mut m, 0x24, 1);
    w(&mut m, 0x20, 1); // VERSION_1
    w(&mut m, 0x70, 11); // +FEATURES_OK
    // receiveq (0) then transmitq (1).
    for (sel, d, a, u) in [
        (0u32, RX_DESC, RX_AVAIL, RX_USED),
        (1, TX_DESC, TX_AVAIL, TX_USED),
    ] {
        w(&mut m, 0x30, sel);
        w(&mut m, 0x38, 8); // QueueNum
        w(&mut m, 0x80, d as u32);
        w(&mut m, 0x84, 0);
        w(&mut m, 0x90, a as u32);
        w(&mut m, 0x94, 0);
        w(&mut m, 0xa0, u as u32);
        w(&mut m, 0xa4, 0);
        w(&mut m, 0x44, 1); // QueueReady
    }
    w(&mut m, 0x70, 15); // +DRIVER_OK
    (m, slot, state)
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

/// The acceptance shape: config-space MAC on slot 1, then a loopback echo round-trip fully
/// through the Machine run loop with the used-ring IRQ mirrored onto the slot's PLIC line.
#[test]
fn machine_loopback_roundtrip_slot1() {
    let (mut m, slot, state) = machine();

    // Config space: the MAC at slot-1 offset 0x100+.
    for (i, &want) in MAC.iter().enumerate() {
        let got = m.bus_mut().load8(SLOT1 + 0x100 + i as u64).unwrap();
        assert_eq!(got, want, "config MAC byte {i}");
    }
    // DeviceID 1 (net) on slot 1; blk still DeviceID 2 on slot 0.
    assert_eq!(m.bus_mut().load32(SLOT1 + 0x008).unwrap(), 1);
    assert_eq!(m.bus_mut().load32(0x1000_1000 + 0x008).unwrap(), 2);

    // Post one rx buffer.
    let (mut rx_seq, mut tx_seq) = (0u16, 0u16);
    wdesc(&mut m, RX_DESC, 0, RX_BUF, 2048, F_WRITE, 0);
    publish(&mut m, RX_AVAIL, 8, &mut rx_seq, 0);

    // Build a tx frame: 12-byte header + 60-byte ethernet frame to a made-up neighbor.
    let nbr = [0xde, 0xad, 0xbe, 0xef, 0x00, 0x01];
    let mut frame = Vec::new();
    frame.extend_from_slice(&nbr);
    frame.extend_from_slice(&MAC);
    frame.extend_from_slice(&[0x08, 0x00]);
    frame.extend(std::iter::repeat(0xC3u8).take(46));
    for i in 0..NET_HDR_LEN {
        m.bus_mut().store8(TX_BUF + i as u64, 0).unwrap();
    }
    for (i, &b) in frame.iter().enumerate() {
        m.bus_mut()
            .store8(TX_BUF + NET_HDR_LEN as u64 + i as u64, b)
            .unwrap();
    }
    wdesc(
        &mut m,
        TX_DESC,
        0,
        TX_BUF,
        (NET_HDR_LEN + frame.len()) as u32,
        0,
        0,
    );
    publish(&mut m, TX_AVAIL, 8, &mut tx_seq, 0);

    // Kick the transmitq via the REAL QueueNotify register, then run one boundary.
    m.bus_mut().store32(SLOT1 + 0x50, 1).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);

    // tx completed (used.len 0) AND the echo landed in the rx buffer the same boundary.
    assert_eq!(m.bus_mut().load16(TX_USED + 2).unwrap(), 1, "tx used");
    assert_eq!(m.bus_mut().load16(RX_USED + 2).unwrap(), 1, "rx delivered");
    let written = m.bus_mut().load32(RX_USED + 8).unwrap();
    assert_eq!(written as usize, NET_HDR_LEN + frame.len());
    // Echo has dst/src swapped.
    for i in 0..6 {
        let b = m
            .bus_mut()
            .load8(RX_BUF + NET_HDR_LEN as u64 + i as u64)
            .unwrap();
        assert_eq!(b, MAC[i as usize], "echo dst = our MAC");
    }
    // num_buffers=1 at header byte 10.
    assert_eq!(m.bus_mut().load8(RX_BUF + 10).unwrap(), 1);

    // The used-ring interrupt is pending on the slot and its level is visible.
    assert!(slot.borrow().irq_level(), "slot-1 IRQ raised");
    assert_eq!(state.borrow().tx_count, 1);
    assert_eq!(state.borrow().rx_count, 1);
    assert_eq!(state.borrow().rx_dropped, 0);

    // ACK the interrupt through the real register; level drops.
    let int = m.bus_mut().load32(SLOT1 + 0x60).unwrap() as u32;
    assert_ne!(int & 1, 0, "USED_RING bit set");
    m.bus_mut().store32(SLOT1 + 0x64, int).unwrap();
    assert!(!slot.borrow().irq_level(), "IRQ cleared after ACK");
}

/// Installing net twice, or into an occupied slot, must be refused loudly (wiring bug).
#[test]
#[should_panic(expected = "virtio slot 1 already has a device")]
fn double_install_refused() {
    let (mut m, _slot, _state) = machine();
    let _ = m.enable_virtio_net(Box::new(LoopbackBackend::new()));
}
