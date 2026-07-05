//! wasm32 mirror of the E2-T11 virtio-blk checks: identical OUT/IN round-trip + hostile
//! request handling through the full Machine (`wasm-pack test --node`).

#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::block::{MemBackend, SECTOR_SIZE};
use wasm_vm_core::bus::Bus;
use wasm_vm_core::platform::virt;
use wasm_vm_core::{Machine, RunOutcome};

const RAM: usize = 8 * 1024 * 1024;
const SLOT0: u64 = 0x1000_1000;
const DESC: u64 = virt::DRAM_BASE + 0x10_0000;
const AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
const USED: u64 = virt::DRAM_BASE + 0x12_0000;
const HDR: u64 = virt::DRAM_BASE + 0x13_0000;
const DATA: u64 = virt::DRAM_BASE + 0x14_0000;
const STATUS: u64 = virt::DRAM_BASE + 0x15_0000;

#[wasm_bindgen_test]
fn blk_roundtrip_and_hostile_on_wasm32() {
    let mut m = Machine::new(RAM);
    m.enable_clint(10);
    m.enable_plic();
    let (_slot, state) =
        m.enable_virtio_blk(Box::new(MemBackend::new(vec![0u8; 32 * SECTOR_SIZE])));
    m.enable_builtin_sbi();
    m.boot_supervisor(0, 0);
    m.bus_mut().store32(virt::KERNEL_BASE, 0x0000_006F).unwrap();
    // Lifecycle + queue 0 setup.
    for (off, v) in [
        (0x70u64, 1u32),
        (0x70, 3),
        (0x24, 1),
        (0x20, 1),
        (0x70, 11),
        (0x30, 0),
        (0x38, 8),
        (0x80, DESC as u32),
        (0x90, AVAIL as u32),
        (0xa0, USED as u32),
        (0x44, 1),
        (0x70, 15),
    ] {
        m.bus_mut().store32(SLOT0 + off, v).unwrap();
    }
    let wdesc = |m: &mut Machine, i: u64, addr: u64, len: u32, flags: u16, next: u16| {
        let b = DESC + 16 * i;
        m.bus_mut().store64(b, addr).unwrap();
        m.bus_mut().store32(b + 8, len).unwrap();
        m.bus_mut().store16(b + 12, flags).unwrap();
        m.bus_mut().store16(b + 14, next).unwrap();
    };
    // OUT one sector of 0x77 at sector 2.
    m.bus_mut().store32(HDR, 1).unwrap();
    m.bus_mut().store64(HDR + 8, 2).unwrap();
    for i in 0..SECTOR_SIZE {
        m.bus_mut().store8(DATA + i as u64, 0x77).unwrap();
    }
    wdesc(&mut m, 0, HDR, 16, 1, 1);
    wdesc(&mut m, 1, DATA, SECTOR_SIZE as u32, 1, 2);
    wdesc(&mut m, 2, STATUS, 1, 2, 0);
    m.bus_mut().store16(AVAIL + 4, 0).unwrap();
    m.bus_mut().store16(AVAIL + 2, 1).unwrap();
    m.bus_mut().store32(SLOT0 + 0x50, 0).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    assert_eq!(m.bus_mut().load8(STATUS).unwrap(), 0, "OUT OK on wasm32");
    // IN it back.
    m.bus_mut().store32(HDR, 0).unwrap();
    let rbuf = DATA + 0x4000;
    wdesc(&mut m, 1, rbuf, SECTOR_SIZE as u32, 2 | 1, 2);
    m.bus_mut().store16(AVAIL + 4 + 2, 0).unwrap();
    m.bus_mut().store16(AVAIL + 2, 2).unwrap();
    m.bus_mut().store32(SLOT0 + 0x50, 0).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    assert_eq!(m.bus_mut().load8(STATUS).unwrap(), 0, "IN OK");
    assert_eq!(m.bus_mut().load8(rbuf).unwrap(), 0x77, "round-trip");
    // Hostile: garbage type → UNSUPP; flush counter untouched.
    m.bus_mut().store32(HDR, 0xFFFF_FFFF).unwrap();
    wdesc(&mut m, 1, STATUS, 1, 2, 0);
    m.bus_mut().store16(AVAIL + 4 + 4, 0).unwrap();
    m.bus_mut().store16(AVAIL + 2, 3).unwrap();
    m.bus_mut().store32(SLOT0 + 0x50, 0).unwrap();
    assert_eq!(m.run(4), RunOutcome::MaxInstrs);
    assert_eq!(m.bus_mut().load8(STATUS).unwrap(), 2, "UNSUPP");
    assert_eq!(state.borrow().flush_count, 0);
}
