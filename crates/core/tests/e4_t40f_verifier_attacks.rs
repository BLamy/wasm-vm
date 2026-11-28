//! E4-T40f verifier attacks (promoted in E4-T40g): guest SMC rewriting the remembered successor (same page and another
//! page), cache toggle / capacity change with `prev_block` held, and a self-loop block (its own
//! successor and `prev_block`) rewritten between run chunks, which only `live` protects.
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
const ADD2: u32 = 0x0021_8193; // addi x3,x3,2
const ADD100: u32 = 0x0641_8193; // addi x3,x3,100

/// A: addi x1,1; xor x5,x5,x7; sw x5,0(x6); jal B.   B: addi x3,? ; jal A.
/// A guest store rewrites B every turn (alternating +100/+2). `b_off` puts B on A's page or another.
fn smc(mode: &str, b_off: u64, discovery: bool) -> Machine {
    let mut m = Machine::new(1024 * 1024);
    let a = DRAM_BASE;
    let b = DRAM_BASE + b_off;
    let words = [0x0010_8093u32, 0x0072_C2B3, 0x0053_2023];
    for (i, w) in words.iter().enumerate() {
        m.bus_mut().store32(a + 4 * i as u64, *w).unwrap();
    }
    m.bus_mut()
        .store32(a + 12, jal(0, b as i64 - (a as i64 + 12)))
        .unwrap();
    m.bus_mut().store32(b, ADD2).unwrap();
    m.bus_mut()
        .store32(b + 4, jal(0, a as i64 - (b as i64 + 4)))
        .unwrap();
    let r = &mut m.hart_mut().regs;
    r.write(5, ADD2 as u64);
    r.write(7, (ADD2 ^ ADD100) as u64);
    r.write(6, b);
    r.pc = a;
    match mode {
        "off" => m.set_block_cache(false),
        "cap1" => {
            m.set_block_cache(true);
            m.set_block_cache_capacity(1);
        }
        _ => m.set_block_cache(true),
    }
    m.set_block_discovery(discovery);
    m
}

#[test]
fn verifier_guest_smc_successor_same_and_other_page() {
    for b_off in [0x100u64, 0x2000] {
        let mut reference = smc("off", b_off, true);
        let mut subjects = [
            smc("on", b_off, false),
            smc("on", b_off, true),
            smc("cap1", b_off, false),
        ];
        for chunk in [1u64, 3, 7, 997, 4096] {
            for _ in 0..40 {
                let _ = reference.run(chunk);
                for s in subjects.iter_mut() {
                    let _ = s.run(chunk);
                }
            }
        }
        let x1 = reference.hart().regs.read(1);
        let x3 = reference.hart().regs.read(3);
        assert!(x1 > 10_000, "loop ran x1={x1}");
        for s in &subjects {
            assert_eq!(s.hart().regs.read(1), x1, "b_off {b_off:#x}");
            assert_eq!(s.hart().regs.read(3), x3, "b_off {b_off:#x}");
            assert_eq!(s.hart().regs.pc, reference.hart().regs.pc);
            assert_eq!(s.snapshot().hex_digest(), reference.snapshot().hex_digest());
        }
        let (hits, builds) = subjects[0].block_cache_entry_stats();
        std::println!("VERIFIER b_off={b_off:#x} x1={x1} x3={x3} hits={hits} builds={builds}");
        assert!(
            builds > x1 / 2,
            "every turn rebuilds B (and A when on its page): builds={builds}"
        );
    }
}

/// Cache toggled off with prev_block held, code rewritten by the host while off, toggled on.
#[test]
fn verifier_toggle_and_capacity_change_with_prev_block_held() {
    let mut m = smc("on", 0x2000, false);
    let mut reference = smc("off", 0x2000, false);
    let _ = m.run(5003);
    let _ = reference.run(5003);
    m.set_block_cache(false);
    // rewrite B's jal target slot + body while the cache (and code-write log) is off
    for x in [&mut m, &mut reference] {
        x.bus_mut()
            .store32(DRAM_BASE + 0x2000, 0x0011_8193)
            .unwrap(); // addi x3,x3,1
        x.hart_mut().regs.write(7, 0); // stop toggling: A keeps storing x5
    }
    let _ = m.run(10);
    let _ = reference.run(10);
    m.set_block_cache(true);
    let _ = m.run(5000);
    let _ = reference.run(5000);
    m.set_block_cache_capacity(2);
    let _ = m.run(5000);
    let _ = reference.run(5000);
    assert_eq!(m.hart().regs.read(3), reference.hart().regs.read(3));
    assert_eq!(m.snapshot().hex_digest(), reference.snapshot().hex_digest());
}

/// A self-loop block is its own remembered successor AND the machine's `prev_block`, so a strong
/// handle outlives the page flush: only `live` stops the memo replaying the old bytes after a
/// host/DMA write lands between run chunks.
#[test]
fn verifier_self_loop_rewritten_between_chunks_runs_new_code() {
    for mode in ["on", "cap1"] {
        let mut m = Machine::new(1024 * 1024);
        let a = DRAM_BASE;
        m.bus_mut().store32(a, ADD2).unwrap();
        m.bus_mut().store32(a + 4, jal(0, -4)).unwrap();
        m.hart_mut().regs.pc = a;
        m.set_block_cache(true);
        if mode == "cap1" {
            m.set_block_cache_capacity(1);
        }
        m.set_block_discovery(false);
        let _ = m.run(1000); // 500 turns, ends at a block boundary (pc == a)
        assert_eq!(m.hart().regs.pc, a);
        let before = m.hart().regs.read(3);
        assert_eq!(before, 1000);
        m.bus_mut().store32(a, ADD100).unwrap();
        let _ = m.run(1000);
        let delta = m.hart().regs.read(3) - before;
        assert_eq!(
            delta,
            500 * 100,
            "mode {mode}: stale self-loop replayed (delta {delta})"
        );
    }
}
