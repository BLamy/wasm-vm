#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::csr::{CsrOp, MCYCLE, MINSTRET};
use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
use wasm_vm_core::{Machine, RunOutcome};
use wasm_vm_wasm::BrowserExecutor;
const C: u64 = DRAM_BASE;
const T: u64 = DRAM_BASE + 0x1000;
const D: u64 = DRAM_BASE + 0x3000;
fn addi(rd: u32, rs: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs << 15) | (rd << 7) | 0x13
}
fn jal(off: i32) -> u32 {
    let o = off as u32;
    ((o >> 20) & 1) << 31
        | ((o >> 1) & 0x3ff) << 21
        | ((o >> 11) & 1) << 20
        | ((o >> 12) & 0xff) << 12
        | 0x6f
}
fn machine(seed: u64, jit: bool) -> Machine {
    let mut m = Machine::new(8 * 1024 * 1024);
    let inc = (seed % 17 + 1) as i32;
    for (p, w) in [
        (C, addi(1, 1, inc)),
        (C + 4, (1 << 20) | (10 << 15) | (2 << 12) | 0x23),
        (C + 8, (6 << 15) | 0x67),
        (T, (1 << 20) | (2 << 15) | (2 << 7) | 0x33),
        (T + 4, jal((C as i64 - (T + 4) as i64) as i32)),
    ] {
        m.bus_mut().store32(p, w).unwrap();
    }
    m.hart_mut().regs.write(1, seed);
    m.hart_mut().regs.write(2, seed.wrapping_mul(11));
    m.hart_mut().regs.write(6, T);
    m.hart_mut().regs.write(10, D);
    m.hart_mut().regs.pc = C;
    if jit {
        let e = BrowserExecutor::new_inline(&m).unwrap();
        m.set_executor(Box::new(e));
        m.set_block_cache(true);
        m.set_interrupt_batching(true);
        m.set_hotness_threshold(1);
        m.set_batch_size(1);
        m.set_chaining(true);
        m.set_dynamic_chaining(false);
        m.set_jit(true);
    }
    m
}
fn snapshot(m: &mut Machine) -> Vec<u64> {
    let mut a = (0..32).map(|i| m.hart().regs.read(i)).collect::<Vec<_>>();
    a.push(m.hart().regs.pc);
    a.push(m.hart().csr.mstatus);
    for addr in [MINSTRET, MCYCLE] {
        a.push(
            m.hart_mut()
                .csr
                .access(addr, CsrOp::Set, 0, true, false, 0)
                .unwrap(),
        );
    }
    for p in [C, C + 8, T, D, D + 8] {
        a.push(m.bus_mut().load64(p).unwrap());
    }
    a
}
fn digest(v: &[u64]) -> u64 {
    v.iter()
        .flat_map(|x| x.to_le_bytes())
        .fold(0xcbf29ce484222325, |h, b| {
            (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
        })
}
#[wasm_bindgen_test]
fn machine_toggle_static_chain_and_architecture_match_interpreter() {
    for seed in [13u64, 197, 0x9b31] {
        let mut oracle = machine(seed, false);
        let mut candidate = machine(seed, true);
        for (stage, on) in [false, true, false, true].into_iter().enumerate() {
            candidate.set_dynamic_chaining(on);
            if stage == 3 {
                oracle.hart_mut().csr.mstatus ^= 1 << 18;
                candidate.hart_mut().csr.mstatus ^= 1 << 18;
            }
            let before = candidate.executor().unwrap().dynamic_link_stats();
            let links_before = candidate.executor().unwrap().direct_chain_links();
            for turn in 0..15 {
                let quantum = [257, 511, 97][(turn + seed as usize) % 3];
                assert_eq!(oracle.run(quantum), RunOutcome::MaxInstrs);
                assert_eq!(candidate.run(quantum), RunOutcome::MaxInstrs);
                assert_eq!(
                    snapshot(&mut candidate),
                    snapshot(&mut oracle),
                    "seed={seed} stage={stage} turn={turn}"
                );
            }
            let e = candidate.executor().unwrap();
            let after = e.dynamic_link_stats();
            assert!(e.executed_blocks() > 0);
            assert!(
                e.direct_chain_links() > links_before,
                "static chains must remain active"
            );
            if on {
                assert!(after.installs > before.installs);
                assert!(after.hits > before.hits);
                assert!(after.live_entries > 0);
            } else {
                assert_eq!(
                    after, before,
                    "disabled stage changed dynamic map or probe state"
                );
            }
            if stage == 0 {
                assert_eq!(after.installs, 0);
                assert_eq!(after.live_entries, 0);
            }
            let n = e.executed_blocks();
            let links = e.direct_chain_links();
            let s = snapshot(&mut candidate);
            console_log!(
                "HELD seed={} stage={} dynamic={} installs={} hits={} live={} static_or_dynamic_links={} jit_calls={} state={:016x}",
                seed,
                stage,
                on,
                after.installs,
                after.hits,
                after.live_entries,
                links,
                n,
                digest(&s)
            );
        }
    }
}
fn block(phys: u64, ops: &[Instr]) -> DecodedBlock {
    DecodedBlock::new(
        phys,
        ops.iter()
            .map(|&instr| MicroOp {
                raw: 0,
                instr,
                len: 4,
            })
            .collect(),
        4 * ops.len() as u64,
    )
}
#[wasm_bindgen_test]
fn later_enable_cannot_hit_forged_authority_and_can_rearm() {
    for seed in [3u64, 19, 101] {
        let mut m = Machine::new(8 * 1024 * 1024);
        let mut e = BrowserExecutor::new_inline(&m).unwrap();
        e.install(&block(
            C,
            &[
                Instr::Addi {
                    rd: 1,
                    rs1: 1,
                    imm: seed as i64,
                },
                Instr::Jalr {
                    rd: 0,
                    rs1: 6,
                    imm: 0,
                },
            ],
        ));
        e.install(&block(
            T,
            &[
                Instr::Addi {
                    rd: 2,
                    rs1: 2,
                    imm: 7,
                },
                Instr::Jal { rd: 0, imm: 4 },
            ],
        ));
        e.set_chaining(true);
        e.set_dynamic_chaining(false);
        m.hart_mut().regs.write(6, T);
        let p: *mut Machine = &mut m;
        let cold = unsafe {
            e.execute_with_budget(C, (*p).hart_mut(), (*p).bus_mut(), 16, 16, true)
                .unwrap()
        };
        assert_eq!(cold.retired, 2);
        assert_eq!(e.dynamic_link_stats().installs, 0);
        e.set_dynamic_chaining(true);
        e.link_dynamic_target(T, T);
        assert!(e.set_dynamic_link_authority_for_test(T, u32::MAX));
        m.hart_mut().regs.pc = C;
        let bad = unsafe {
            e.execute_with_budget(C, (*p).hart_mut(), (*p).bus_mut(), 16, 16, true)
                .unwrap()
        };
        assert_eq!(bad.code, ExitCode::BranchTaken);
        assert_eq!(bad.retired, 2);
        assert_eq!(bad.next_pc, T);
        assert_eq!(m.hart().regs.read(2), 0);
        assert_eq!(e.dynamic_link_stats().hits, 0);
        assert_eq!(e.dynamic_link_stats().refusals, 1);
        e.link_dynamic_target(T, T);
        e.set_dynamic_chaining(false);
        let before = e.dynamic_link_stats();
        m.hart_mut().regs.pc = C;
        let off = unsafe {
            e.execute_with_budget(C, (*p).hart_mut(), (*p).bus_mut(), 16, 16, true)
                .unwrap()
        };
        assert_eq!(off.retired, 2);
        assert_eq!(e.dynamic_link_stats(), before);
        e.set_dynamic_chaining(true);
        m.hart_mut().regs.pc = C;
        let hit = unsafe {
            e.execute_with_budget(C, (*p).hart_mut(), (*p).bus_mut(), 16, 16, true)
                .unwrap()
        };
        assert_eq!(hit.retired, 4);
        assert_eq!(m.hart().regs.read(2), 7);
        assert_eq!(e.dynamic_link_stats().hits, 1);
        console_log!(
            "HELD forged authority seed={} refused=1 target_side_effect=0; reenabled valid hit=1 target_side_effect=7",
            seed
        );
    }
}
