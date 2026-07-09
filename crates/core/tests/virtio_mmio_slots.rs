//! E2-T08 integration: the eight virtio-mmio slots probed over the REAL bus (the kernel's
//! probe order — magic, version, DeviceID), and a slot interrupt delivered to the S-mode
//! guest through PLIC IRQ 1 via the run-loop level mirror.

#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::VirtioDevice;
use wasm_vm_core::dev::virtio::mmio::MAGIC;
use wasm_vm_core::platform::{Platform, virt};
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 8 * 1024 * 1024;

struct BlkPlaceholder;
impl VirtioDevice for BlkPlaceholder {
    fn device_id(&self) -> u32 {
        2
    }
}

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, 0b0010011)
}
fn lui(rd: u8, imm20: u32) -> u32 {
    (imm20 << 12) | ((rd as u32) << 7) | 0b0110111
}
fn csrrw(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b001 << 12) | ((rd as u32) << 7) | 0b1110011
}
fn csrrs(rd: u8, csr: u32, rs1: u8) -> u32 {
    (csr << 20) | ((rs1 as u32) << 15) | (0b010 << 12) | ((rd as u32) << 7) | 0b1110011
}
fn lw(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b010, rd, 0b0000011)
}
fn s_type(imm: i32, rs2: u8, rs1: u8, f3: u32) -> u32 {
    let iu = (imm as u32) & 0xFFF;
    ((iu >> 5) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((iu & 0x1F) << 7)
        | 0b0100011
}
fn sw(rs2: u8, rs1: u8, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 0b010)
}
const SRET: u32 = 0x1020_0073;
const JDOT: u32 = 0x0000_006F;

/// Kernel-style probe of all 8 slots over the bus: magic + version everywhere; slot 0 is
/// the blk placeholder (DeviceID 2), slots 1..=7 are empty (DeviceID 0, silently skipped).
#[test]
fn all_eight_slots_probe_like_a_kernel() {
    let mut m = Machine::new(RAM);
    m.enable_plic();
    let slots = m.enable_virtio_slots(Some(Box::new(BlkPlaceholder)));
    assert_eq!(slots.len(), 8);
    for i in 0..virt::VIRTIO_COUNT {
        let base = Platform::virtio_base(i);
        assert_eq!(m.bus_mut().load32(base).unwrap(), MAGIC, "slot {i} magic");
        assert_eq!(m.bus_mut().load32(base + 4).unwrap(), 2, "slot {i} version");
        let dev_id = m.bus_mut().load32(base + 8).unwrap();
        assert_eq!(dev_id, if i == 0 { 2 } else { 0 }, "slot {i} DeviceID");
        // Arbitrary write to an empty slot: tolerated, still probes clean after.
        m.bus_mut().store32(base + 0x70, 0xFF).unwrap();
        if i != 0 {
            assert_eq!(m.bus_mut().load32(base + 0x70).unwrap(), 0, "empty stays 0");
        }
    }
}

/// A used-ring interrupt on slot 0 reaches the S-mode guest as PLIC IRQ 1 through the
/// run-loop level mirror; the guest claims, ACKs the transport, completes — line settles.
#[test]
fn slot0_interrupt_reaches_guest_via_plic() {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let slots = m.enable_virtio_slots(Some(Box::new(BlkPlaceholder)));
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);

    // Guest: stvec, sie.SEIE, sstatus.SIE; PLIC prio[1]=1, ctx1 enable bit1, threshold 0; park.
    let mut code = vec![
        lui(5, 0x80201),
        addi(5, 5, -0x800),
        i_type(32, 5, 0b001, 5, 0b0010011),
        i_type(32, 5, 0b101, 5, 0b0010011),
        csrrw(0, 0x105, 5),
        addi(5, 0, 0x200),
        csrrs(0, 0x104, 5),
        addi(5, 0, 0x2),
        csrrs(0, 0x100, 5),
        lui(5, 0x0C000),
        addi(6, 0, 1),
        sw(6, 5, 4), // priority[1] = 1  (PLIC_BASE + 4*1)
        lui(5, 0x0C002),
        addi(6, 0, 2),
        sw(6, 5, 0x80), // enable ctx1 bit 1
        lui(5, 0x0C201),
        sw(0, 5, 0), // threshold 0
        JDOT,
    ];
    code.push(JDOT);
    // Handler: claim → ACK the transport's InterruptStatus (write 0x1 to slot0+0x64) →
    // complete → count → sret.
    let handler = vec![
        addi(28, 28, 1),
        lui(5, 0x0C201),
        lw(6, 5, 4), // claim (expect 1)
        addi(29, 6, 0),
        lui(7, 0x10001), // slot 0 base 0x1000_1000
        addi(30, 0, 1),
        sw(30, 7, 0x64), // InterruptACK: clear used-ring bit
        sw(6, 5, 4),     // complete
        SRET,
    ];
    for (i, insn) in code.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 4 * i as u64, *insn)
            .unwrap();
    }
    for (i, insn) in handler.iter().enumerate() {
        m.bus_mut()
            .store32(virt::KERNEL_BASE + 0x800 + 4 * i as u64, *insn)
            .unwrap();
    }

    // Let the guest set up, then the "device" reports a used buffer.
    assert_eq!(m.run(200), RunOutcome::MaxInstrs);
    slots[0].borrow_mut().raise_used_irq();
    assert_eq!(m.run(2000), RunOutcome::MaxInstrs);
    assert_eq!(m.hart().regs.read(28), 1, "exactly one delivery");
    assert_eq!(m.hart().regs.read(29), 1, "claimed PLIC source 1 (slot 0)");
    assert!(
        !slots[0].borrow().irq_level(),
        "ACK cleared the level — line settled"
    );
}
