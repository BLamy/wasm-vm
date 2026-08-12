//! E4-T08 machine-level: a REAL guest driven through the block cache must nominate its hot loops,
//! expose the counters through the profiling report, and — the load-bearing adversarial property —
//! NEVER install a translation for bytes that no longer match guest memory after self-modification.
//!
//! Byte-identity (nomination is observation-only) is proven by the `predecode_diff` gate; the
//! per-block state machine + generation logic is unit-tested in `dispatch::tests`. Here we drive
//! hand-assembled looping guests through the real run loop so the block-cache hit path, the SMC
//! invalidation path, and the ProfStats seam are all exercised end to end.
#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::trace::HashSink;

// --- tiny RV64 encoders (just what these guests need) ------------------------------------------

#[allow(clippy::identity_op)]
fn enc_addi(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (0b000 << 12) | (rd << 7) | 0b0010011
}
fn enc_bne(rs1: u32, rs2: u32, off: i32) -> u32 {
    // B-type: imm[12|10:5] rs2 rs1 funct3 imm[4:1|11] opcode
    let o = off as u32;
    let imm12 = (o >> 12) & 1;
    let imm11 = (o >> 11) & 1;
    let imm10_5 = (o >> 5) & 0x3f;
    let imm4_1 = (o >> 1) & 0xf;
    (imm12 << 31)
        | (imm10_5 << 25)
        | (rs2 << 20)
        | (rs1 << 15)
        | (0b001 << 12)
        | (imm4_1 << 8)
        | (imm11 << 7)
        | 0b1100011
}
fn enc_sw(rs2: u32, rs1: u32, imm: i32) -> u32 {
    // S-type: imm[11:5] rs2 rs1 010 imm[4:0] 0100011
    let o = imm as u32;
    let imm11_5 = (o >> 5) & 0x7f;
    let imm4_0 = o & 0x1f;
    (imm11_5 << 25) | (rs2 << 20) | (rs1 << 15) | (0b010 << 12) | (imm4_0 << 7) | 0b0100011
}
fn enc_jal(rd: u32, off: i32) -> u32 {
    let o = off as u32;
    let imm20 = (o >> 20) & 1;
    let imm10_1 = (o >> 1) & 0x3ff;
    let imm11 = (o >> 11) & 1;
    let imm19_12 = (o >> 12) & 0xff;
    (imm20 << 31) | (imm10_1 << 21) | (imm11 << 20) | (imm19_12 << 12) | (rd << 7) | 0b1101111
}

fn poke(m: &mut Machine, words: &[u32]) {
    for (i, w) in words.iter().enumerate() {
        m.bus_mut().store32(DRAM_BASE + 4 * i as u64, *w).unwrap();
    }
}

/// A hot decrement loop nominates its body block exactly once; counters surface via `prof_report`.
#[test]
fn hot_loop_nominates_once_and_reports() {
    let mut m = Machine::new(8 * 1024 * 1024);
    // loop:  addi x1,x1,-1 ; bne x1,x0,loop   (block at DRAM+0)
    // after: jal x0,0                          (spin)
    poke(
        &mut m,
        &[
            enc_addi(1, 1, -1),
            enc_bne(1, 0, -4),
            enc_jal(0, 0), // spin forever
        ],
    );
    m.hart_mut().regs.write(1, 100); // loop 100 times
    m.hart_mut().regs.pc = DRAM_BASE;
    m.set_block_cache(true);
    m.set_hotness_threshold(32);

    // Budget covers the 200 loop retires plus only a handful of `spin` retires — so the loop body
    // crosses the threshold (32) but the spin self-loop block never does (stays < 32).
    let mut sink = HashSink::new();
    m.run_traced(210, &mut sink);

    // E4-T30: the loop body is decoded once, then its 99 later taken entries hit the cache. The
    // terminal self-loop builds once and hits 9 more times in the remaining 10-instruction budget.
    // This exact accounting catches the old regression where every branch entry rebuilt the block.
    assert_eq!(
        m.block_cache_entry_stats(),
        (108, 2),
        "hot entries must reuse both decoded blocks instead of rebuilding them"
    );

    let s = m.discovery_stats();
    assert_eq!(
        s.nominated, 1,
        "the single hot loop block nominates exactly once"
    );
    assert_eq!(s.queue_depth, 1);
    // 100 iterations, nominate at the 32nd → 68 post-threshold entries deduped.
    assert!(
        s.deduped >= 60,
        "post-threshold entries must dedup (got {})",
        s.deduped
    );

    // The request describes the loop body: entry PC = DRAM+0, a branch terminator, 2 ops of 4 bytes.
    let req = m.take_translation_requests().pop().unwrap();
    assert_eq!(req.phys_pc, DRAM_BASE);
    assert_eq!(req.op_lens, vec![4u8, 4u8]);
    assert_eq!(req.code_bytes.len(), 8);

    // The counters are exported through the profiling report (E4-T01 ProfStats seam).
    let report = m.prof_report(0, 4);
    assert_eq!(report.discovery.nominated, 1);
    assert!(report.to_json().contains("\"discovery\""));
    assert!(report.to_text().contains("jit discovery: nominated=1"));
}

/// Discovery is INERT when the block cache is off — nothing is counted or nominated.
#[test]
fn discovery_inert_without_block_cache() {
    let mut m = Machine::new(8 * 1024 * 1024);
    poke(
        &mut m,
        &[enc_addi(1, 1, -1), enc_bne(1, 0, -4), enc_jal(0, 0)],
    );
    m.hart_mut().regs.write(1, 100);
    m.hart_mut().regs.pc = DRAM_BASE;
    m.set_block_cache(false);
    let mut sink = HashSink::new();
    m.run_traced(1_000, &mut sink);
    let s = m.discovery_stats();
    assert_eq!(s.nominated, 0);
    assert_eq!(s.candidates, 0);
}

/// ADVERSARIAL (ticket AC): a self-modifying block goes hot, is nominated, then the guest
/// overwrites its own code. The pending request must be dropped at install — refuting the
/// "never installs stale bytes" claim requires an install to proceed with mismatched bytes, and
/// this asserts it never does (generation bumped AND snapshot ≠ live memory).
#[test]
fn self_modified_block_never_installs_stale_bytes() {
    let mut m = Machine::new(8 * 1024 * 1024);
    // loop:  addi x1,x1,-1 ; bne x1,x0,loop      (hot block at DRAM+0)
    // after: sw x0,0(x5)   ; overwrite DRAM+0 (its own code page) -> SMC invalidation
    // spin:  jal x0,0
    poke(
        &mut m,
        &[
            enc_addi(1, 1, -1),
            enc_bne(1, 0, -4),
            enc_sw(0, 5, 0), // store x0 (=0) to [x5] = DRAM+0
            enc_jal(0, 0),
        ],
    );
    m.hart_mut().regs.write(1, 80); // loop 80 times → nominate (threshold 32)
    m.hart_mut().regs.write(5, DRAM_BASE); // x5 -> the hot block's entry (its own code)
    m.hart_mut().regs.pc = DRAM_BASE;
    m.set_block_cache(true);
    m.set_hotness_threshold(32);

    let gen_before = m.discovery_stats().generation;
    let mut sink = HashSink::new();
    m.run_traced(1_000, &mut sink);

    let s = m.discovery_stats();
    assert!(
        s.nominated >= 1,
        "the hot block was nominated before the overwrite"
    );
    assert!(
        s.generation > gen_before,
        "the self-modifying store must bump the discovery generation (invalidation)"
    );

    // The old request is still queued (invalidation leaves it for install-time validation). Read the
    // now-overwritten live bytes and confirm the request refuses to install.
    let reqs = m.take_translation_requests();
    let stale = reqs
        .into_iter()
        .find(|r| r.phys_pc == DRAM_BASE)
        .expect("the nominated request for the hot block");
    assert_ne!(
        stale.generation, s.generation,
        "the request carries the pre-invalidation generation"
    );

    let mut live = Vec::new();
    for i in 0..2u64 {
        let w = m.bus_mut().load32(DRAM_BASE + 4 * i).unwrap();
        live.extend_from_slice(&w.to_le_bytes());
    }
    // The first word (DRAM+0) was overwritten to 0 by the guest store, so the snapshot differs.
    assert_ne!(
        stale.code_bytes, live,
        "guest overwrote its own code — snapshot must differ"
    );
    assert!(
        !m.discovery_install_check(&stale, &live),
        "stale request must NEVER install against self-modified bytes"
    );
    assert_eq!(m.discovery_stats().dropped_stale, 1);
}
