//! wasm32 mirror of the E2-T09 virtqueue checks (`wasm-pack test --node`).

#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::mmio::QueueState;
use wasm_vm_core::dev::virtio::queue::{Violation, Virtqueue};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;

const RAM: usize = 256 * 1024;
const DESC: u64 = DRAM_BASE + 0x1000;
const AVAIL: u64 = DRAM_BASE + 0x2000;
const USED: u64 = DRAM_BASE + 0x3000;
const DATA: u64 = DRAM_BASE + 0x10000;

fn bus() -> SystemBus {
    SystemBus::new(Ram::new(RAM).unwrap())
}
fn qs(num: u32) -> QueueState {
    QueueState {
        num,
        ready: true,
        desc: DESC,
        driver: AVAIL,
        device: USED,
    }
}
fn wdesc(b: &mut SystemBus, i: u16, addr: u64, len: u32, flags: u16, next: u16) {
    let base = DESC + 16 * u64::from(i);
    b.store64(base, addr).unwrap();
    b.store32(base + 8, len).unwrap();
    b.store16(base + 12, flags).unwrap();
    b.store16(base + 14, next).unwrap();
}

#[wasm_bindgen_test]
fn pop_push_wrap_and_violations_on_wasm32() {
    let mut b = bus();
    let mut q = Virtqueue::new(&qs(8), 256).unwrap();
    // Normal 2-seg chain.
    wdesc(&mut b, 0, DATA, 16, 1, 1);
    wdesc(&mut b, 1, DATA + 0x100, 4, 2, 0);
    b.store16(AVAIL + 4, 0).unwrap();
    b.store16(AVAIL + 2, 1).unwrap();
    let chain = q.pop(&mut b).unwrap().unwrap();
    assert_eq!(chain.segments.len(), 2);
    q.push_used(&mut b, chain.head, 4).unwrap();
    assert_eq!(b.load16(USED + 2).unwrap(), 1);
    // Wrap: 70k buffers through the size-8 queue (identical to native).
    wdesc(&mut b, 0, DATA, 8, 0, 0);
    for seq in 1u32..70_000 {
        b.store16(AVAIL + 4 + 2 * u64::from((seq as u16) % 8), 0)
            .unwrap();
        b.store16(AVAIL + 2, (seq as u16).wrapping_add(1)).unwrap();
        let c = q.pop(&mut b).unwrap().unwrap();
        q.push_used(&mut b, c.head, 0).unwrap();
    }
    assert_eq!(b.load16(USED + 2).unwrap(), (70_000u32 % 65_536) as u16);
    // Violations behave identically: self-loop + indirect.
    let mut q2 = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, DATA, 8, 1, 0);
    b.store16(AVAIL + 4, 0).unwrap();
    b.store16(AVAIL + 2, 1).unwrap();
    assert_eq!(q2.pop(&mut b), Err(Violation::ChainTooLong));
    let mut q3 = Virtqueue::new(&qs(8), 256).unwrap();
    wdesc(&mut b, 0, DATA, 8, 4, 0);
    assert_eq!(q3.pop(&mut b), Err(Violation::Indirect));
}
