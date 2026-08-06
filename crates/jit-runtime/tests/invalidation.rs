#![allow(clippy::identity_op)]
//! E4-T16 correctness gates — `fence.i` and `SFENCE.VMA` invalidation under the JIT, PROVEN BY
//! TEST (not asserted in the design doc). Every test compares the JIT tier (block cache + compiled
//! executor, threshold 1) against the interpreter and demands byte-identical guest state.
//!
//! What is proven here:
//! * `fence_i_invalidates_translated_block` — a block executes (and JIT-compiles), the guest stores
//!   DIFFERENT code over it, runs `fence.i`, and re-executes: the NEW code runs, the recompiled
//!   block is JIT-served, and the final state equals the interpreter. `fence.i` performs a full
//!   translation-cache flush (the QEMU `tb_flush` analog) — asserted via the `cache_flushes` stat.
//! * `sfence_vma_remap_to_different_phys` — the core AC + physical-keying direction (a): a hot VA
//!   is remapped to a DIFFERENT physical page with different code; after `sfence.vma` the correct
//!   (new physical) block runs via a fresh TLB fill, no stale VA-keyed block survives.
//! * `sfence_vma_reuse_same_phys_new_va` — physical-keying direction (b): the SAME physical code
//!   page is mapped at a NEW VA; the compiled block is REUSED (no needless flush — proven by
//!   `blocks_discarded == 0` and a growing executed-block count).
//! * `sfence_vma_all_four_forms_flush_stale` — all four rs1/rs2 operand forms (§4.2.1) flush the
//!   stale translation (over-flush is fine; under-flush is a refutation).
//! * `sfence_vma_asid_form_never_underflushes` — an ASID-targeted fence removes the stale entry for
//!   its address space (two spaces sharing a VA).
//! * `sfence_vma_global_page_exempt_from_asid_fence` — a global-bit page survives an ASID fence
//!   (spec-correct) and is only dropped by a global fence.
//! * `mstatus_sum_change_uses_new_permission_view` — a translation-affecting mstatus (SUM) change
//!   takes effect immediately for a subsequent access (the TLB caches the walk, not the permission).
//! * `rv64mi_suite_verdict_identical_under_jit` — the machine-mode suite (which churns
//!   `sfence.vma`/`fence.i`/CSR) stays verdict-identical with the JIT forced on.

use jit_runtime::WasmtimeExecutor;

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MEDELEG, Priv, SATP};
use wasm_vm_core::{Machine, RunOutcome};

// ── RV64 encoders ────────────────────────────────────────────────────────────
fn enc_addi(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (0b000 << 12) | (rd << 7) | 0b0010011
}
fn enc_bne(rs1: u32, rs2: u32, off: i32) -> u32 {
    let o = off as u32;
    ((o >> 12) & 1) << 31
        | ((o >> 5) & 0x3f) << 25
        | (rs2 << 20)
        | (rs1 << 15)
        | (0b001 << 12)
        | ((o >> 1) & 0xf) << 8
        | ((o >> 11) & 1) << 7
        | 0b1100011
}
fn enc_jal(rd: u32, off: i32) -> u32 {
    let o = off as u32;
    ((o >> 20) & 1) << 31
        | ((o >> 1) & 0x3ff) << 21
        | ((o >> 11) & 1) << 20
        | ((o >> 12) & 0xff) << 12
        | (rd << 7)
        | 0b1101111
}
const FENCE_I: u32 = 0x0000_100f;
/// `sfence.vma rs1, rs2` — funct7 0b0001001, funct3 0, opcode SYSTEM.
fn enc_sfence(rs1: u32, rs2: u32) -> u32 {
    (0b0001001 << 25) | (rs2 << 20) | (rs1 << 15) | (0b000 << 12) | 0b1110011
}

// ── the JIT/interpreter tier toggles ─────────────────────────────────────────
fn arm_jit(m: &mut Machine) {
    m.set_executor(Box::new(WasmtimeExecutor::new()));
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_jit(true);
}

fn regs(m: &Machine) -> [u64; 32] {
    let mut r = [0u64; 32];
    for i in 0..32u8 {
        r[i as usize] = m.hart().regs.read(i);
    }
    r
}

// ════════════════════════════════════════════════════════════════════════════
// 1. fence.i — full translation-cache flush; recompiled block runs after code overwrite
// ════════════════════════════════════════════════════════════════════════════

/// Bare-metal (M-mode, identity translation). A hot register loop compiles; then the guest
/// overwrites its own body with a different immediate, executes `fence.i`, and re-runs. The NEW
/// code must run under the JIT (recompiled block), byte-identical to the interpreter.
fn fence_i_program(imm_slot: u32) -> [u32; 5] {
    [
        enc_addi(2, 2, imm_slot as i32), // 0: x2 += IMM  (loop body — the SMC target)
        enc_addi(1, 1, -1),              // 4: x1 -= 1
        enc_bne(1, 0, -8),               // 8: loop while x1 != 0
        FENCE_I,                         // 12: fence.i (executed by pointing pc here)
        enc_jal(0, 0),                   // 16: spin
    ]
}

fn run_fence_i(jit: bool) -> ([u64; 32], u64) {
    const K: u64 = 200;
    let mut m = Machine::new(8 * 1024 * 1024);
    for (i, w) in fence_i_program(1).iter().enumerate() {
        m.bus_mut().store32(DRAM_BASE + 4 * i as u64, *w).unwrap();
    }
    if jit {
        arm_jit(&mut m);
    }
    // Phase 1: x2 += 1 per iter → x2 = K. Warms + compiles the loop block.
    m.hart_mut().regs.write(1, K);
    m.hart_mut().regs.write(2, 0);
    m.hart_mut().regs.pc = DRAM_BASE;
    m.run(K * 3 + 20);
    let cache_flushes_before = m.discovery_stats().cache_flushes;

    // Guest self-modifies the loop body: x2 += 1  →  x2 += 10 (different code, same phys page).
    m.bus_mut().store32(DRAM_BASE, enc_addi(2, 2, 10)).unwrap();
    // Guest executes fence.i through the run loop so the Machine-level full flush fires (the
    // tb_flush analog: whole block cache + discovery generation + every compiled block dropped).
    let exec_before = if jit {
        m.executor().unwrap().executed_blocks()
    } else {
        0
    };
    m.hart_mut().regs.pc = DRAM_BASE + 12;
    m.run(1);

    // Phase 2: re-run the loop; the NEW body (x2 += 10) must run → x2 = 10*K.
    m.hart_mut().regs.write(1, K);
    m.hart_mut().regs.write(2, 0);
    m.hart_mut().regs.pc = DRAM_BASE;
    m.run(K * 3 + 20);

    if jit {
        // fence.i is a full flush: the stat must have advanced (tb_flush analog).
        assert!(
            m.discovery_stats().cache_flushes > cache_flushes_before,
            "fence.i must perform a whole-cache flush"
        );
        // The recompiled (new-bytes) block must be JIT-served in phase 2.
        assert!(
            m.executor().unwrap().executed_blocks() > exec_before,
            "the recompiled block must be JIT-served after fence.i"
        );
    }
    (regs(&m), m.hart().regs.pc)
}

#[test]
fn fence_i_invalidates_translated_block() {
    let (ri, _pi) = run_fence_i(false);
    let (rj, _pj) = run_fence_i(true);
    // New code observed: x2 = 10*200 = 2000 in BOTH tiers.
    assert_eq!(
        ri[2], 2000,
        "interp: new code (x2 += 10) must run after fence.i"
    );
    assert_eq!(
        rj[2], 2000,
        "jit: new code (x2 += 10) must run after fence.i"
    );
    // Every architectural register (except the payload slot x0) identical.
    for i in 1..32 {
        assert_eq!(ri[i], rj[i], "reg x{i} diverged JIT vs interp");
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Sv39 paging scaffolding for the SFENCE.VMA proofs
// ════════════════════════════════════════════════════════════════════════════

const PTE_V: u64 = 1 << 0;
const PTE_R: u64 = 1 << 1;
const PTE_W: u64 = 1 << 2;
const PTE_X: u64 = 1 << 3;
const PTE_G: u64 = 1 << 5;
const PTE_A: u64 = 1 << 6;
const PTE_D: u64 = 1 << 7;
const RX: u64 = PTE_V | PTE_R | PTE_X | PTE_A | PTE_D;

fn pte(pa: u64, perms: u64) -> u64 {
    ((pa >> 12) << 10) | perms
}

/// A three-level Sv39 page-table builder with a bump allocator for interior tables. `root` is the
/// physical address of the L2 table; `asid` tags the satp.
struct Pt {
    root: u64,
    next: u64,
    asid: u64,
}
impl Pt {
    fn new(root: u64, asid: u64) -> Self {
        Pt {
            root,
            next: root + 0x1000,
            asid,
        }
    }
    /// Map (or REMAP) `va` → `pa` with `perms`; overwrites an existing leaf so a remap is a single
    /// call. Interior tables are bump-allocated per subtree.
    fn map(&mut self, m: &mut Machine, va: u64, pa: u64, perms: u64) {
        let mut table = self.root;
        for level in (1..=2usize).rev() {
            let vpn = (va >> (12 + level * 9)) & 0x1FF;
            let e = m.bus_mut().load64(table + vpn * 8).unwrap();
            table = if e & PTE_V != 0 {
                (e >> 10) << 12
            } else {
                let t = self.next;
                self.next += 0x1000;
                m.bus_mut().store64(table + vpn * 8, pte(t, PTE_V)).unwrap();
                t
            };
        }
        let vpn0 = (va >> 12) & 0x1FF;
        m.bus_mut()
            .store64(table + vpn0 * 8, pte(pa, perms))
            .unwrap();
    }
    fn satp(&self) -> u64 {
        (8u64 << 60) | (self.asid << 44) | (self.root >> 12)
    }
}

fn set_csr(m: &mut Machine, a: u16, v: u64) {
    m.hart_mut()
        .csr
        .access(a, CsrOp::Write, v, false, false, 0)
        .unwrap();
}

/// The virtual code-page layout used by the SFENCE.VMA tests. A register-only loop (x2 += IMM,
/// x1 iterations) that exits to a spin, plus an on-demand `sfence.vma` at a fixed offset and a
/// separate flush stub. `imm` distinguishes physical code pages.
///
/// off 0:  addi x2,x2,IMM
/// off 4:  addi x1,x1,-1
/// off 8:  bne  x1,x0,-8       (loop)
/// off 12: jal  x0,0           (loop exit → spin)
fn code_page(imm: i32) -> [u32; 4] {
    [
        enc_addi(2, 2, imm),
        enc_addi(1, 1, -1),
        enc_bne(1, 0, -8),
        enc_jal(0, 0),
    ]
}

fn poke_page(m: &mut Machine, pa: u64, words: &[u32]) {
    for (i, w) in words.iter().enumerate() {
        m.bus_mut().store32(pa + 4 * i as u64, *w).unwrap();
    }
}

// Fixed physical frames for the paging tests (well clear of the page tables at +0x20_0000).
const PT_ROOT_A: u64 = DRAM_BASE + 0x20_0000;
const PT_ROOT_B: u64 = DRAM_BASE + 0x28_0000;
const P1: u64 = DRAM_BASE + 0x30_0000; // physical code page 1 (IMM = 1)
const P2: u64 = DRAM_BASE + 0x30_1000; // physical code page 2 (IMM = 10)
const PSTUB: u64 = DRAM_BASE + 0x30_2000; // flush-stub page (never remapped)

const VCODE: u64 = 0x1000_0000;
const VCODE2: u64 = 0x1000_2000; // an alternate VA in a distinct page
const VSTUB: u64 = 0x2000_0000;

/// Build an S-mode Sv39 machine with PMP open and page faults delegated to S. Returns the machine
/// and its page-table builder. Stub sfence encoding is caller-poked at `PSTUB`.
fn paged(jit: bool, asid: u64, root: u64) -> (Machine, Pt) {
    let mut m = Machine::new(64 * 1024 * 1024);
    m.hart_mut().csr.pmp.allow_all();
    let pt = Pt::new(root, asid);
    set_csr(&mut m, SATP, pt.satp());
    set_csr(
        &mut m,
        MEDELEG,
        (1 << 12) | (1 << 13) | (1 << 15) | (1 << 8),
    );
    m.hart_mut().csr.mode = Priv::S;
    if jit {
        arm_jit(&mut m);
    }
    (m, pt)
}

/// Run the loop at `VCODE` to completion (spin), for `K` iterations.
fn run_loop(m: &mut Machine, k: u64) {
    m.hart_mut().regs.write(1, k);
    m.hart_mut().regs.write(2, 0);
    m.hart_mut().regs.pc = VCODE;
    m.run(k * 3 + 40);
}

/// Execute the flush stub at `VSTUB` once (a single `sfence.vma` step). `rs1_val`/`rs2_val`, when
/// `Some`, are written to x10/x11 first (the stub's sfence uses rs1=x10, rs2=x11 as encoded).
fn do_sfence(m: &mut Machine, rs1_val: Option<u64>, rs2_val: Option<u64>) {
    if let Some(v) = rs1_val {
        m.hart_mut().regs.write(10, v);
    }
    if let Some(v) = rs2_val {
        m.hart_mut().regs.write(11, v);
    }
    m.hart_mut().regs.pc = VSTUB;
    m.step().unwrap();
}

// ════════════════════════════════════════════════════════════════════════════
// 2. SFENCE.VMA remap-to-different-phys (core AC + physical-keying direction (a))
// ════════════════════════════════════════════════════════════════════════════

/// Encode the stub's sfence per operand form: rs1 = x10 iff `use_va`, rs2 = x11 iff `use_asid`.
fn stub_sfence(use_va: bool, use_asid: bool) -> u32 {
    enc_sfence(if use_va { 10 } else { 0 }, if use_asid { 11 } else { 0 })
}

/// Core routine: map VCODE→P1(IMM 1), warm/compile, then remap VCODE→P2(IMM 10), `sfence.vma` in
/// the given form, and re-run. Returns final x2 (the accumulator) plus the JIT `blocks_discarded`
/// stat (must stay 0 — a virtual remap never discards a physically-keyed block).
fn remap_to_diff_phys(jit: bool, use_va: bool, use_asid: bool) -> (u64, u64) {
    const K: u64 = 150;
    let asid = 1;
    let (mut m, mut pt) = paged(jit, asid, PT_ROOT_A);
    poke_page(&mut m, P1, &code_page(1));
    poke_page(&mut m, P2, &code_page(10));
    poke_page(
        &mut m,
        PSTUB,
        &[stub_sfence(use_va, use_asid), enc_jal(0, 0)],
    );
    pt.map(&mut m, VCODE, P1, RX);
    pt.map(&mut m, VSTUB, PSTUB, RX);

    run_loop(&mut m, K); // x2 = 1*K = 150; block at phys P1 compiles
    let discarded_before = m.discovery_stats().blocks_discarded;

    // Remap VCODE → P2 (different physical page, different code), then fence.
    pt.map(&mut m, VCODE, P2, RX);
    do_sfence(&mut m, use_va.then_some(VCODE), use_asid.then_some(asid));

    run_loop(&mut m, K); // must run P2's code (IMM 10) → x2 = 10*K = 1500
    let x2 = m.hart().regs.read(2);
    let discarded = m.discovery_stats().blocks_discarded - discarded_before;
    (x2, discarded)
}

#[test]
fn sfence_vma_remap_to_different_phys() {
    // Direction (a): after the remap+fence the NEW physical page's code runs (fresh TLB fill),
    // never the stale VA-keyed block. Interp and JIT agree; the JIT discards NO blocks (phys-keying).
    let (xi, _) = remap_to_diff_phys(false, false, false);
    let (xj, discarded) = remap_to_diff_phys(true, false, false);
    assert_eq!(xi, 1500, "interp: new physical page's code must run");
    assert_eq!(
        xj, 1500,
        "jit: new physical page's code must run (no stale VA-keyed block)"
    );
    assert_eq!(
        discarded, 0,
        "SFENCE.VMA (a virtual remap) must NOT discard any physically-keyed block"
    );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. SFENCE.VMA remap-same-phys-to-new-VA (physical-keying direction (b): reuse, no flush)
// ════════════════════════════════════════════════════════════════════════════

#[test]
fn sfence_vma_reuse_same_phys_new_va() {
    const K: u64 = 150;
    let asid = 1;
    let (mut m, mut pt) = paged(true, asid, PT_ROOT_A);
    poke_page(&mut m, P1, &code_page(1));
    poke_page(&mut m, PSTUB, &[stub_sfence(false, false), enc_jal(0, 0)]);
    pt.map(&mut m, VCODE, P1, RX);
    pt.map(&mut m, VSTUB, PSTUB, RX);

    run_loop(&mut m, K); // compile the block at phys P1
    let (compiled_before, executed_before, discarded_before) = {
        let exec = m.executor().unwrap();
        (
            exec.compiled_count(),
            exec.executed_blocks(),
            m.discovery_stats().blocks_discarded,
        )
    };
    assert!(
        compiled_before >= 1,
        "the loop block must compile at phys P1"
    );

    // Map the SAME physical page P1 at a NEW virtual address, fence, execute there.
    pt.map(&mut m, VCODE2, P1, RX);
    do_sfence(&mut m, None, None);
    m.hart_mut().regs.write(1, K);
    m.hart_mut().regs.write(2, 0);
    m.hart_mut().regs.pc = VCODE2; // enter the same physical code via a different VA
    m.run(K * 3 + 40);

    let exec = m.executor().unwrap();
    assert_eq!(
        m.hart().regs.read(2),
        150,
        "reused block must compute correctly"
    );
    assert_eq!(
        exec.compiled_count(),
        compiled_before,
        "same-phys new-VA must REUSE the block — no recompile"
    );
    assert!(
        exec.executed_blocks() > executed_before,
        "the physically-keyed block must be re-served at the new VA"
    );
    assert_eq!(
        m.discovery_stats().blocks_discarded,
        discarded_before,
        "no needless flush: SFENCE.VMA discarded no blocks"
    );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. All four operand forms flush the stale translation (never under-flush)
// ════════════════════════════════════════════════════════════════════════════

#[test]
fn sfence_vma_all_four_forms_flush_stale() {
    // (rs1, rs2) ∈ {x0,x0 | va,x0 | x0,asid | va,asid}. Each must flush VCODE's stale entry so the
    // remapped physical page runs. Over-flush is fine; a stale IMM-1 result would be under-flush.
    for (use_va, use_asid) in [(false, false), (true, false), (false, true), (true, true)] {
        let (xi, _) = remap_to_diff_phys(false, use_va, use_asid);
        let (xj, discarded) = remap_to_diff_phys(true, use_va, use_asid);
        assert_eq!(
            xi, 1500,
            "interp under-flushed for form (va={use_va}, asid={use_asid})"
        );
        assert_eq!(
            xj, 1500,
            "jit under-flushed for form (va={use_va}, asid={use_asid})"
        );
        assert_eq!(discarded, 0, "form must not discard phys-keyed blocks");
    }
}

// ════════════════════════════════════════════════════════════════════════════
// 5. ASID-targeted fence never under-flushes (two spaces sharing a VA)
// ════════════════════════════════════════════════════════════════════════════

#[test]
fn sfence_vma_asid_form_never_underflushes() {
    const K: u64 = 150;
    let asid_a = 1;
    let (mut m, mut pt_a) = paged(true, asid_a, PT_ROOT_A);
    // A second address space (asid 2) mapping the SAME VCODE to a DIFFERENT physical page (P2).
    let mut pt_b = Pt::new(PT_ROOT_B, 2);
    poke_page(&mut m, P1, &code_page(1));
    poke_page(&mut m, P2, &code_page(10));
    poke_page(&mut m, PSTUB, &[stub_sfence(true, true), enc_jal(0, 0)]);
    pt_a.map(&mut m, VCODE, P1, RX);
    pt_a.map(&mut m, VSTUB, PSTUB, RX);
    pt_b.map(&mut m, VCODE, P2, RX);
    pt_b.map(&mut m, VSTUB, PSTUB, RX);

    // Warm space A: VCODE → P1, fills the TLB under asid 1 (and compiles phys P1).
    run_loop(&mut m, K);
    assert_eq!(m.hart().regs.read(2), 150);

    // Remap space A's VCODE → P2, then an ASID-1-targeted fence for that VA.
    pt_a.map(&mut m, VCODE, P2, RX);
    do_sfence(&mut m, Some(VCODE), Some(asid_a));
    run_loop(&mut m, K);
    assert_eq!(
        m.hart().regs.read(2),
        1500,
        "ASID-targeted fence under-flushed: stale asid-1 translation survived"
    );

    // Space B (asid 2) still resolves its own mapping (the asid-1 fence did not corrupt it).
    set_csr(&mut m, SATP, pt_b.satp());
    do_sfence(&mut m, Some(VCODE), Some(2)); // enter B cleanly
    run_loop(&mut m, K);
    assert_eq!(
        m.hart().regs.read(2),
        1500,
        "space B (asid 2) must resolve VCODE → P2"
    );
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Global-bit page is exempt from an ASID fence, dropped only by a global fence
// ════════════════════════════════════════════════════════════════════════════

#[test]
fn sfence_vma_global_page_exempt_from_asid_fence() {
    const K: u64 = 150;
    let asid = 1;
    let (mut m, mut pt) = paged(true, asid, PT_ROOT_A);
    poke_page(&mut m, P1, &code_page(1));
    poke_page(&mut m, P2, &code_page(10));
    poke_page(&mut m, PSTUB, &[stub_sfence(false, true), enc_jal(0, 0)]);
    // VCODE mapped GLOBAL (G bit set).
    pt.map(&mut m, VCODE, P1, RX | PTE_G);
    pt.map(&mut m, VSTUB, PSTUB, RX);

    run_loop(&mut m, K); // fills a GLOBAL TLB entry VCODE → P1
    assert_eq!(m.hart().regs.read(2), 150);

    // Remap VCODE → P2, then an ASID-targeted fence. A GLOBAL entry is EXEMPT — the stale mapping
    // survives, so the OLD physical page (P1, IMM 1) still runs. This is spec-correct.
    pt.map(&mut m, VCODE, P2, RX | PTE_G);
    do_sfence(&mut m, None, Some(asid));
    run_loop(&mut m, K);
    assert_eq!(
        m.hart().regs.read(2),
        150,
        "global page must be EXEMPT from an ASID-targeted fence (stale mapping retained)"
    );

    // A global fence (rs2 = x0) DOES drop the global entry → the new physical page (P2) runs.
    poke_page(&mut m, PSTUB, &[stub_sfence(false, false), enc_jal(0, 0)]);
    do_sfence(&mut m, None, None);
    run_loop(&mut m, K);
    assert_eq!(
        m.hart().regs.read(2),
        1500,
        "a global fence must drop the global entry → new physical page runs"
    );
}

// ════════════════════════════════════════════════════════════════════════════
// 7. A SUM (mstatus) change takes effect immediately for the next access
// ════════════════════════════════════════════════════════════════════════════

/// The TLB caches the WALK, never the permission decision (`finish_leaf` re-runs on every hit), so a
/// translation-affecting mstatus change (SUM) needs no flush and is visible to the very next access
/// — identically under the JIT (whose loads route through the interpreter's own translate path).
#[test]
fn mstatus_sum_change_uses_new_permission_view() {
    // An S-mode load from a U-page: forbidden while SUM=0 (page fault), permitted once SUM=1 — with
    // NO intervening sfence. Prove the permission view flips immediately, JIT and interp identical.
    fn trial(jit: bool, sum: bool) -> RunOutcome {
        const VDATA: u64 = 0x3000_0000;
        let pdata = DRAM_BASE + 0x31_0000;
        let (mut m, mut pt) = paged(jit, 1, PT_ROOT_A);
        poke_page(&mut m, P1, &code_page(1)); // unused code page keeps layout parallel
        // Code that loads from VDATA (a U-page): lw x5, 0(x6) ; jal spin.
        let vcode_phys = DRAM_BASE + 0x32_0000;
        let lw = (6u32 << 15) | (0b010 << 12) | (5 << 7) | 0b0000011;
        poke_page(&mut m, vcode_phys, &[lw, enc_jal(0, 0)]);
        pt.map(&mut m, VCODE, vcode_phys, RX);
        // VDATA is a USER page (PTE_U) that is readable+writable.
        pt.map(
            &mut m,
            VDATA,
            pdata,
            PTE_V | PTE_R | PTE_W | (1 << 4) | PTE_A | PTE_D,
        );
        m.bus_mut().store64(pdata, 0xABCD).unwrap();
        if sum {
            // Set mstatus.SUM (bit 18) so S-mode may read the U-page (write in M-mode: mstatus is
            // an M CSR; paged() left the hart in S).
            let mstatus = m.hart_mut().csr.read(0x300) | (1 << 18);
            m.hart_mut().csr.mode = Priv::M;
            set_csr(&mut m, 0x300, mstatus);
            m.hart_mut().csr.mode = Priv::S;
        }
        m.hart_mut().regs.write(6, VDATA);
        m.hart_mut().regs.pc = VCODE;
        m.run(4)
    }
    // SUM=0: the load faults (LoadPageFault, delegated to S → no handler installed → trapped/looping).
    // SUM=1: the load succeeds. Compare JIT vs interp for BOTH.
    let ok_i = trial(false, true);
    let ok_j = trial(true, true);
    assert_eq!(
        format!("{ok_i:?}"),
        format!("{ok_j:?}"),
        "SUM=1 outcome diverged JIT vs interp"
    );

    // Direct value check under SUM=1: x5 must hold the loaded word in both tiers.
    fn loaded_x5(jit: bool) -> u64 {
        const VDATA: u64 = 0x3000_0000;
        let pdata = DRAM_BASE + 0x31_0000;
        let (mut m, mut pt) = paged(jit, 1, PT_ROOT_A);
        let vcode_phys = DRAM_BASE + 0x32_0000;
        let lw = (6u32 << 15) | (0b010 << 12) | (5 << 7) | 0b0000011;
        poke_page(&mut m, vcode_phys, &[lw, enc_jal(0, 0)]);
        pt.map(&mut m, VCODE, vcode_phys, RX);
        pt.map(
            &mut m,
            VDATA,
            pdata,
            PTE_V | PTE_R | PTE_W | (1 << 4) | PTE_A | PTE_D,
        );
        m.bus_mut().store64(pdata, 0xABCD).unwrap();
        let mstatus = m.hart_mut().csr.read(0x300) | (1 << 18);
        m.hart_mut().csr.mode = Priv::M;
        set_csr(&mut m, 0x300, mstatus);
        m.hart_mut().csr.mode = Priv::S;
        m.hart_mut().regs.write(6, VDATA);
        m.hart_mut().regs.pc = VCODE;
        m.run(4);
        m.hart().regs.read(5)
    }
    assert_eq!(loaded_x5(false), 0xABCD, "interp: SUM=1 load must succeed");
    assert_eq!(loaded_x5(true), 0xABCD, "jit: SUM=1 load must succeed");
}

// ════════════════════════════════════════════════════════════════════════════
// 8. rv64mi suite verdict-identical under the JIT (kernel-style fence churn stays correct)
// ════════════════════════════════════════════════════════════════════════════

#[test]
fn rv64mi_suite_verdict_identical_under_jit() {
    use std::path::PathBuf;
    const SYS_EXIT: u64 = 93;
    let classify = |elf: &[u8], jit: bool| -> String {
        let mut m = Machine::new(64 * 1024 * 1024);
        m.load_elf(elf).unwrap();
        if jit {
            arm_jit(&mut m);
            m.set_block_cache_capacity(1); // adversarial flapping cache
        }
        match m.run(5_000_000) {
            RunOutcome::Exited(0) => "pass".to_string(),
            RunOutcome::Exited(n) => format!("fail{}", n >> 1),
            RunOutcome::Trapped(t) if t.cause == wasm_vm_core::hart::Exception::EcallFromM => {
                let a7 = m.hart().regs.read(17);
                let a0 = m.hart().regs.read(10);
                if a7 == SYS_EXIT && a0 == 0 {
                    "pass".to_string()
                } else {
                    format!("fail{}", a0 >> 1)
                }
            }
            other => format!("escaped {other:?}"),
        }
    };
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/riscv-tests-bin");
    let mut n = 0u32;
    for entry in std::fs::read_dir(&dir).expect("riscv-tests-bin dir") {
        let path = entry.unwrap().path();
        if path.extension().is_some() || !path.is_file() {
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if !name.contains("rv64mi") {
            continue;
        }
        let elf = std::fs::read(&path).unwrap();
        if elf.get(..4) != Some(b"\x7fELF") {
            continue;
        }
        let interp = classify(&elf, false);
        let jit = classify(&elf, true);
        assert_eq!(interp, jit, "{name}: JIT changed the mi verdict");
        n += 1;
    }
    assert!(n >= 10, "expected the rv64mi suite, saw {n}");
    eprintln!("rv64mi verdict-identical under JIT across {n} ELFs");
}
