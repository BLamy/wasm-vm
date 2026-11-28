//! E4-T40f: turning block discovery off changes nothing the guest can see, only what discovery
//! records; and the block-successor memo leaves execution identical to probing the cache.
#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;

/// Two blocks on two pages calling each other in a loop, with a store each turn.
fn machine(discovery: bool) -> Machine {
    let mut m = Machine::new(1024 * 1024);
    let a = DRAM_BASE;
    let b = DRAM_BASE + 0x1000;
    let words_a: [u32; 4] = [
        0x0010_8093, // addi x1, x1, 1
        0x0011_3023, // sd x1, 0(x2)
        0x0000_0000, // jal x0, b   (patched below)
        0x0000_0013,
    ];
    for (i, w) in words_a.iter().enumerate() {
        m.bus_mut().store32(a + 4 * i as u64, *w).unwrap();
    }
    // jal x0, +0x1000 from a+8 → b
    let off: i64 = (b as i64) - (a as i64 + 8);
    m.bus_mut().store32(a + 8, jal(0, off)).unwrap();
    m.bus_mut().store32(b, 0x0021_8193).unwrap(); // addi x3, x3, 2
    let back: i64 = (a as i64) - (b as i64 + 4);
    m.bus_mut().store32(b + 4, jal(0, back)).unwrap();
    m.hart_mut().regs.write(2, DRAM_BASE + 0x8000);
    m.hart_mut().regs.pc = a;
    m.set_block_cache(true);
    m.set_block_discovery(discovery);
    m
}

fn jal(rd: u32, off: i64) -> u32 {
    let o = off as u32;
    ((o >> 20) & 1) << 31
        | ((o >> 1) & 0x3ff) << 21
        | ((o >> 11) & 1) << 20
        | ((o >> 12) & 0xff) << 12
        | rd << 7
        | 0x6f
}

#[test]
fn discovery_off_runs_the_same_guest_and_records_nothing() {
    let mut on = machine(true);
    let mut off = machine(false);
    for _ in 0..50 {
        let _ = on.run(997);
        let _ = off.run(997);
    }
    assert_eq!(on.hart().regs.read(1), off.hart().regs.read(1));
    assert_eq!(on.hart().regs.read(3), off.hart().regs.read(3));
    assert!(
        on.hart().regs.read(1) > 5_000,
        "the loop ran: x1={}",
        on.hart().regs.read(1)
    );
    assert_eq!(on.snapshot().hex_digest(), off.snapshot().hex_digest());
    assert!(
        on.discovery_stats().nominated > 0,
        "discovery on nominates the hot blocks"
    );
    assert_eq!(
        off.discovery_stats().nominated,
        0,
        "discovery off records nothing"
    );
}

/// A store that rewrites the successor block between turns: the memo must not replay the old
/// code (the store flushes the page; the next entry rebuilds from the new bytes).
#[test]
fn successor_rewritten_by_a_store_runs_its_new_code() {
    let mut m = machine(false);
    let _ = m.run(400);
    let before = m.hart().regs.read(3);
    // addi x3,x3,2 → addi x3,x3,100 in b, written through the bus as a guest store would land.
    m.bus_mut()
        .store32(DRAM_BASE + 0x1000, 0x0641_8193)
        .unwrap();
    let pc = m.hart().regs.pc;
    let turns_before = m.hart().regs.read(1);
    let _ = m.run(400);
    let turns = m.hart().regs.read(1) - turns_before;
    let delta = m.hart().regs.read(3) - before;
    assert!(turns > 10, "pc {pc:#x}");
    // Every turn after the rewrite adds 100 (at most one turn straddles it with the old +2).
    assert!(
        delta >= 100 * (turns - 1),
        "x3 grew by {delta} over {turns} turns"
    );
}
