//! E4-T05 Phase B — page-granular block-cache invalidation, proven byte-identical.
//!
//! Phase A flushed the WHOLE cache on any store; Phase B keeps a page-level has-code bitmap and
//! only drops blocks in a written-to code page. The correctness knife-edge: a guest store that
//! PATCHES an already-cached instruction (self-modifying code) WITHOUT `fence.i` must still take
//! effect — because the legacy (cache-off) path re-decodes every fetch and sees the new bytes
//! immediately, so cache-ON must invalidate on the store to stay byte-identical. A missed
//! page invalidation here = the cached (stale) op replays = a diverging retire trace.
//!
//! This is the store-patches-cached-block-then-re-executes case (beyond `rv64ui-p-fence_i`, which
//! uses an explicit `fence.i`). The device/DMA-writes-code trigger is routed through the SAME
//! physical-frame log (`SystemBus::code_write_log` → `Machine::drain_code_writes`), verified by
//! inspection: every virtio guest-RAM write reaches RAM via `bus.store*`, which records the frame.

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::trace::HashSink;
use wasm_vm_core::{Machine, RunOutcome};

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
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
fn b_type(imm: i32, rs2: u8, rs1: u8, f3: u32) -> u32 {
    let u = imm as u32;
    ((u >> 12) & 1) << 31
        | ((u >> 5) & 0x3F) << 25
        | (rs2 as u32) << 20
        | (rs1 as u32) << 15
        | f3 << 12
        | ((u >> 1) & 0xF) << 8
        | ((u >> 11) & 1) << 7
        | 0b110_0011
}

const ADDI: u32 = 0b001_0011;

/// Build a self-modifying guest: a loop whose FIRST instruction (`addi x1,x1,5`) is rewritten to
/// `addi x1,x1,1` by a store inside the same (cached) block, then re-entered. Iteration 1 adds 5;
/// every later iteration must add 1 — which only holds if the store invalidated the cached block.
fn load_smc(m: &mut Machine) {
    // x1 acc, x2 iter, x3 limit(=4), x4 patch addr(=DRAM_BASE), x5 patched word.
    let w_new = i_type(1, 1, 0b000, 1, ADDI); // addi x1, x1, 1
    let prog: [u32; 5] = [
        i_type(5, 1, 0b000, 1, ADDI), // 0x00 LOOP: addi x1,x1,5  <- PATCH TARGET
        i_type(1, 2, 0b000, 2, ADDI), // 0x04: addi x2,x2,1
        s_type(0, 5, 4, 0b010),       // 0x08: sw x5,0(x4)  -> patches 0x00
        b_type(-12, 3, 2, 0b100),     // 0x0c: blt x2,x3,LOOP (rs1=x2,rs2=x3; back to 0x00)
        0x0000_006f,                  // 0x10: jal x0,0 (spin — deterministic tail)
    ];
    let bus = m.bus_mut();
    for (i, w) in prog.iter().enumerate() {
        bus.store32(DRAM_BASE + 4 * i as u64, *w).unwrap();
    }
    let h = m.hart_mut();
    h.regs.pc = DRAM_BASE;
    h.regs.write(3, 4); // limit
    h.regs.write(4, DRAM_BASE); // patch target address
    h.regs.write(5, u64::from(w_new)); // patched instruction word
}

fn run(budget: u64, cache: Option<usize>) -> (u64, u64, RunOutcome, u64) {
    let mut m = Machine::new(64 * 1024 * 1024);
    load_smc(&mut m);
    match cache {
        None => m.set_block_cache(false),
        Some(cap) => {
            m.set_block_cache_capacity(cap);
            m.set_block_cache(true);
        }
    }
    let mut sink = HashSink::new();
    let outcome = m.run_traced(budget, &mut sink);
    let acc = m.hart().regs.read(1);
    (sink.hash(), sink.retired(), outcome, acc)
}

#[test]
fn smc_store_patches_cached_block_is_byte_identical() {
    let budget = 200;
    let off = run(budget, None);
    // Sanity: iteration 1 adds 5, iterations 2..4 add 1 each → x1 = 5 + 3*1 = 8. (Not 5+3*5=20,
    // which is what a STALE cached block would produce.)
    assert_eq!(
        off.3, 8,
        "cache-off accumulator: SMC patch must take effect"
    );
    assert!(off.1 > 15, "run too short ({} retires)", off.1);

    let big = run(budget, Some(1 << 12));
    assert_eq!(
        (off.0, off.1, &off.2, off.3),
        (big.0, big.1, &big.2, big.3),
        "big cache diverged from legacy on self-modifying code"
    );

    let one = run(budget, Some(1));
    assert_eq!(
        (off.0, off.1, &off.2, off.3),
        (one.0, one.1, &one.2, one.3),
        "1-entry (pathological) cache diverged from legacy on self-modifying code"
    );
}
