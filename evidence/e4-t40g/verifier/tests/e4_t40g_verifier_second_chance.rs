//! E4-T40g verifier: a successor-memo entry must give its block the second chance a probe hit
//! gives. A hot pair H1<->H2 is entered only through the memo; a stream of cold blocks overflows an
//! 8-slot cache (one probe window) every outer turn. With the touch the hot pair survives the
//! sweeps; without it (the E4-T40f gap) it is evicted and rebuilt every turn. Architecture is
//! checked against the cache-off reference either way.
#![cfg(not(feature = "zicsr-stub"))]
use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;

fn jal(rd: u32, off: i64) -> u32 {
    let o = off as u32;
    ((o >> 20) & 1) << 31
        | ((o >> 1) & 0x3ff) << 21
        | ((o >> 11) & 1) << 20
        | ((o >> 12) & 0xff) << 12
        | rd << 7
        | 0x6f
}
fn addi(rd: u32, rs: u32, imm: i32) -> u32 {
    ((imm as u32) & 0xfff) << 20 | rs << 15 | rd << 7 | 0x13
}
fn bne(rs1: u32, rs2: u32, off: i64) -> u32 {
    let o = off as u32;
    ((o >> 12) & 1) << 31
        | ((o >> 5) & 0x3f) << 25
        | rs2 << 20
        | rs1 << 15
        | 1 << 12
        | ((o >> 1) & 0xf) << 8
        | ((o >> 11) & 1) << 7
        | 0x63
}

const COLD: u64 = 12;
const HOT_TURNS: i32 = 50;

fn machine(cache: Option<usize>) -> Machine {
    let mut m = Machine::new(1024 * 1024);
    let a = DRAM_BASE;
    let h2 = a + 0x40;
    let cold = |i: u64| a + 0x100 + 0x10 * i;
    let r = a + 0x400;
    let mut put = |at: u64, w: u32| m.bus_mut().store32(at, w).unwrap();
    put(a, addi(1, 1, 1));
    put(a + 4, jal(0, h2 as i64 - (a as i64 + 4)));
    put(h2, addi(2, 2, -1));
    put(h2 + 4, bne(2, 0, a as i64 - (h2 as i64 + 4)));
    put(h2 + 8, jal(0, cold(0) as i64 - (h2 as i64 + 8)));
    for i in 0..COLD {
        let next = if i + 1 == COLD { r } else { cold(i + 1) };
        put(cold(i), addi(4, 4, 1));
        put(cold(i) + 4, jal(0, next as i64 - (cold(i) as i64 + 4)));
    }
    put(r, addi(2, 0, HOT_TURNS));
    put(r + 4, jal(0, a as i64 - (r as i64 + 4)));
    m.hart_mut().regs.write(2, HOT_TURNS as u64);
    m.hart_mut().regs.pc = a;
    match cache {
        None => m.set_block_cache(false),
        Some(cap) => {
            m.set_block_cache(true);
            m.set_block_cache_capacity(cap);
        }
    }
    m.set_block_discovery(false);
    m
}

#[test]
fn verifier_memo_entry_keeps_second_chance() {
    let mut reference = machine(None);
    let mut subject = machine(Some(8));
    for _ in 0..200 {
        let _ = reference.run(997);
        let _ = subject.run(997);
    }
    let outer = reference.hart().regs.read(4) / COLD;
    assert!(outer > 100, "outer turns {outer}");
    assert_eq!(subject.hart().regs.read(1), reference.hart().regs.read(1));
    assert_eq!(subject.hart().regs.read(4), reference.hart().regs.read(4));
    assert_eq!(subject.hart().regs.pc, reference.hart().regs.pc);
    assert_eq!(subject.snapshot().hex_digest(), reference.snapshot().hex_digest());
    let (hits, builds) = subject.block_cache_entry_stats();
    std::println!("VERIFIER outer={outer} hits={hits} builds={builds}");
    // The cold stream (12 blocks + H2's fall-through + R) can miss every turn; the hot pair must not.
    assert!(
        builds <= (COLD + 2 + 1) * (outer + 1) + 8,
        "hot pair rebuilt every turn: builds={builds} outer={outer}"
    );
}
