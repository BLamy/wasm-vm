//! Softmmu fast path (perf overhaul) — adversarial verifier regression: self-modifying code
//! patched through a WRITABLE VIRTUAL ALIAS of an executable page, with every patching store served
//! by a live store fast-TLB entry.
//!
//! The fast path hands a RAM store straight to `Bus::ram_store*`, bypassing translation, PMP and
//! device dispatch. The block cache stays coherent only if that path still records the PHYSICAL
//! frame in the code-write log (`SystemBus::note_ram_store` → `Machine::drain_code_writes`). Here
//! the code executes through `VCODE` (R+X) while the patches go through `VALIAS` (R+W+D), a
//! different virtual page mapping the same physical frame — so a VA-keyed shortcut would miss the
//! invalidation. A warm-up store publishes the alias page's store fast entry before the loop, so
//! EVERY patch rides the fast path.
//!
//! Each iteration rewrites the loop head `addi x1, x1, imm` with the next immediate: iteration 1
//! runs the original `imm = 5`, then 1, 2, 3 → x1 = 5 + 1 + 2 + 3 = 11. A stale cached block would
//! keep adding 5 (x1 = 20). Every configuration (legacy, block cache, block cache + interrupt
//! batching, 1-entry cache), with the fast path on and off, must retire the identical trace.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, Priv, SATP};
use wasm_vm_core::trace::HashSink;
use wasm_vm_core::{Machine, RunOutcome};

const V: u64 = 1;
const R: u64 = 1 << 1;
const W: u64 = 1 << 2;
const X: u64 = 1 << 3;
const A: u64 = 1 << 6;
const D: u64 = 1 << 7;

const ROOT: u64 = DRAM_BASE + 0x20_0000;
const CODE_PA: u64 = DRAM_BASE + 0x30_0000;
const VCODE: u64 = 0x1000_0000;
const VALIAS: u64 = 0x2000_0000;

fn pte(pa: u64, perms: u64) -> u64 {
    ((pa >> 12) << 10) | perms
}

fn map(m: &mut Machine, next: &mut u64, va: u64, pa: u64, perms: u64) {
    let mut table = ROOT;
    for level in (1..=2usize).rev() {
        let vpn = (va >> (12 + level * 9)) & 0x1FF;
        let e = m.bus_mut().load64(table + vpn * 8).unwrap();
        table = if e & V != 0 {
            (e >> 10) << 12
        } else {
            let t = *next;
            *next += 0x1000;
            m.bus_mut().store64(table + vpn * 8, pte(t, V)).unwrap();
            t
        };
    }
    let slot = table + ((va >> 12) & 0x1FF) * 8;
    m.bus_mut().store64(slot, pte(pa, perms)).unwrap();
}

fn i_type(imm: i32, rs1: u32, f3: u32, rd: u32, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op
}
fn s_type(imm: i32, rs2: u32, rs1: u32, f3: u32) -> u32 {
    let iu = (imm as u32) & 0xFFF;
    ((iu >> 5) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((iu & 0x1F) << 7) | 0x23
}
fn b_type(imm: i32, rs2: u32, rs1: u32, f3: u32) -> u32 {
    let u = imm as u32;
    ((u >> 12) & 1) << 31
        | ((u >> 5) & 0x3F) << 25
        | rs2 << 20
        | rs1 << 15
        | f3 << 12
        | ((u >> 1) & 0xF) << 8
        | ((u >> 11) & 1) << 7
        | 0x63
}
const ADDI: u32 = 0x13;

#[derive(Clone, Copy, Debug)]
enum Mode {
    Legacy,
    Cache(usize),
    CacheBatched,
}

fn build(fast: bool) -> Machine {
    let mut m = Machine::new(64 * 1024 * 1024);
    m.hart_mut().csr.pmp.allow_all();
    let mut next = ROOT + 0x1000;
    map(&mut m, &mut next, VCODE, CODE_PA, V | R | X | A);
    map(&mut m, &mut next, VALIAS, CODE_PA, V | R | W | A | D);
    // x1 acc, x2 iter, x3 limit, x4 alias base, x5 patch word, x6 imm step (1 << 20).
    let prog: [u32; 7] = [
        s_type(0x100, 0, 4, 0b010), // 0x00: sw x0, 0x100(x4)   warm-up: publish alias entry
        i_type(5, 1, 0, 1, ADDI),   // 0x04: LOOP: addi x1,x1,5  <- patched via the alias
        i_type(1, 2, 0, 2, ADDI),   // 0x08: addi x2,x2,1
        s_type(4, 5, 4, 0b010),     // 0x0c: sw x5, 4(x4)       patch LOOP through VALIAS
        (6 << 20) | (5 << 15) | (5 << 7) | 0x33, // 0x10: add x5,x5,x6  next immediate
        b_type(-16, 3, 2, 0b100),   // 0x14: blt x2,x3,LOOP
        0x0000_006f,                // 0x18: j .
    ];
    for (i, w) in prog.iter().enumerate() {
        m.bus_mut().store32(CODE_PA + 4 * i as u64, *w).unwrap();
    }
    let h = m.hart_mut();
    h.csr
        .access(
            SATP,
            CsrOp::Write,
            (8u64 << 60) | (ROOT >> 12),
            false,
            false,
            0,
        )
        .unwrap();
    h.csr.mode = Priv::S;
    h.regs.pc = VCODE;
    h.regs.write(3, 4);
    h.regs.write(4, VALIAS);
    h.regs.write(5, u64::from(i_type(1, 1, 0, 1, ADDI)));
    h.regs.write(6, 1 << 20);
    if !fast {
        h.tlb.disable_fast_path();
    }
    m
}

fn run(fast: bool, mode: Mode) -> (u64, u64, RunOutcome, u64, usize) {
    let mut m = build(fast);
    match mode {
        Mode::Legacy => m.set_block_cache(false),
        Mode::Cache(cap) => {
            m.set_block_cache_capacity(cap);
            m.set_block_cache(true);
        }
        Mode::CacheBatched => {
            m.set_block_cache(true);
            m.set_interrupt_batching(true);
        }
    }
    let mut sink = HashSink::new();
    let outcome = m.run_traced(300, &mut sink);
    let live = m.hart().tlb.fast_live_entries();
    (
        sink.hash(),
        sink.retired(),
        outcome,
        m.hart().regs.read(1),
        live,
    )
}

#[test]
fn smc_through_a_fast_path_alias_store_invalidates_cached_code() {
    let reference = run(false, Mode::Legacy);
    assert_eq!(
        reference.3, 11,
        "slow-path legacy: every patch must take effect (stale would be 20)"
    );
    for mode in [
        Mode::Legacy,
        Mode::Cache(1 << 12),
        Mode::Cache(1),
        Mode::CacheBatched,
    ] {
        for fast in [false, true] {
            let got = run(fast, mode);
            assert_eq!(
                (got.0, got.1, &got.2, got.3),
                (reference.0, reference.1, &reference.2, reference.3),
                "{mode:?} fast={fast}: diverged from the slow-path legacy run"
            );
            if fast {
                // The fast rig must really have served the alias page (and the code page) from
                // fast entries, or this test proves nothing about the fast path.
                assert!(
                    got.4 >= 2,
                    "{mode:?}: fast path never engaged ({} live)",
                    got.4
                );
            } else {
                assert_eq!(
                    got.4, 0,
                    "{mode:?}: the disabled rig published a fast entry"
                );
            }
        }
    }
}
