//! Literal guest WFI/rdtime/IRQ contracts for the opt-in idle ceiling.
#![cfg(not(feature = "zicsr-stub"))]

use std::{cell::Cell, rc::Rc};
use wasm_vm_core::bus::Bus;
use wasm_vm_core::csr::{CsrOp, MIE, MIP, MSTATUS, MTVEC};
use wasm_vm_core::platform::virt;
use wasm_vm_core::time::{IdlePacer, MonotonicClock, TimeMode, WallClockPolicy};
use wasm_vm_core::trace::{HashSink, TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};

#[derive(Clone, Default)]
struct Clock {
    ns: Rc<Cell<u64>>,
    reads: Rc<Cell<u64>>,
}
impl MonotonicClock for Clock {
    fn now_nanos(&self) -> u64 {
        self.reads.set(self.reads.get() + 1);
        self.ns.get()
    }
}

#[derive(Default)]
struct Capture {
    rows: Vec<TraceRecord>,
}
impl TraceSink for Capture {
    fn retire(&mut self, r: &TraceRecord) {
        self.rows.push(*r);
    }
}

fn fixture(cached: bool, idle: bool, divider: u64, initial: u64, deadline: u64) -> Machine {
    let mut m = Machine::new(64 * 1024);
    m.enable_clint(divider);
    let words = if idle {
        [0x1050_0073, 0xffdf_f06f] // wfi; jal zero,-4
    } else {
        [0xc010_22f3, 0xffdf_f06f] // rdtime t0; jal zero,-4
    };
    for (i, word) in words.into_iter().enumerate() {
        m.bus_mut()
            .store32(virt::DRAM_BASE + i as u64 * 4, word)
            .unwrap();
    }
    m.bus_mut()
        .store64(virt::CLINT_BASE + 0xbff8, initial)
        .unwrap();
    m.bus_mut()
        .store64(virt::CLINT_BASE + 0x4000, deadline)
        .unwrap();
    m.hart_mut()
        .csr
        .access(MIE, CsrOp::Write, 1 << 7, false, false, 0)
        .unwrap();
    m.hart_mut().regs.pc = virt::DRAM_BASE;
    m.set_block_cache(cached);
    m.set_interrupt_batching(cached);
    m
}

fn record(m: &mut Machine, count: u64, label: &str) {
    record_counts(m, count, count, label);
}

fn record_counts(m: &mut Machine, count: u64, retired: u64, label: &str) {
    let mut capture = Capture::default();
    assert_eq!(m.run_traced(count, &mut capture), RunOutcome::MaxInstrs);
    assert_eq!(
        capture.rows.len() as u64,
        retired,
        "bounded host turn returns"
    );
    let mut hash = HashSink::new();
    for r in &capture.rows {
        hash.retire(r);
        eprintln!("PACED_TRACE {label} {}", fmt_canonical(r));
    }
    eprintln!(
        "PACED_STATE {label} work={count} retired={retired} mtime={} hash={:016x} digest={}",
        m.clint_mtime(),
        hash.hash(),
        m.snapshot().hex_digest()
    );
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn future_deadline_waits_for_host_progress_without_freezing_retirement_or_irq() {
    for cached in [false, true] {
        for initial in [0, 71_000_000] {
            let deadline = initial + 200_000;
            let mut m = fixture(cached, true, 1024, initial, deadline);
            let clock = Clock::default();
            clock.ns.set(5_000_000_000);
            m.set_paced_icount_clock(Box::new(clock.clone())).unwrap();
            assert_eq!(m.guest_clock_mode(), TimeMode::PacedICount);
            assert_eq!(m.clint_mtime(), initial);
            // The first host turn has no elapsed time: it cannot jump20ms to the timer.
            record(&mut m, 2, "stalled-host");
            assert_eq!(m.clint_mtime(), initial);
            assert_eq!(m.hart_mut().csr.read(MIP) & (1 << 7), 0);
            // Simulate subsequent host tasks between bounded original machine calls.
            for (ns, expected) in [(5_005_000_000, 50_000), (5_002_000_000, 50_000)] {
                clock.ns.set(ns);
                record(&mut m, 2, "advance-or-backward-host");
                assert_eq!(m.clint_mtime(), initial + expected);
                assert_eq!(m.hart_mut().csr.read(MIP) & (1 << 7), 0);
            }
            clock.ns.set(5_020_000_000);
            record(&mut m, 2, "exact-deadline");
            assert_eq!(m.clint_mtime(), deadline);
            assert_ne!(m.hart_mut().csr.read(MIP) & (1 << 7), 0);
            // Enable architectural delivery and execute the real trap handler.
            let handler = virt::DRAM_BASE + 0x1000;
            m.bus_mut().store32(handler, 0x0013_0313).unwrap(); // addi t1,t1,1
            for (csr, value) in [(MTVEC, handler), (MSTATUS, 1 << 3)] {
                m.hart_mut()
                    .csr
                    .access(csr, CsrOp::Write, value, false, false, 0)
                    .unwrap();
            }
            record_counts(&mut m, 2, 1, "timer-handler");
            assert_eq!(m.hart().regs.read(6), 1);
            assert_eq!(m.hart().regs.pc, handler + 4);
        }
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn software_irq_wakes_at_a_stalled_host_ceiling() {
    for cached in [false, true] {
        let mut m = fixture(cached, true, 64, 0, 1_000_000);
        let clock = Clock::default();
        m.set_paced_icount_clock(Box::new(clock)).unwrap();
        record(&mut m, 2, "no-host-progress");
        assert_eq!(m.clint_mtime(), 0);
        let handler = virt::DRAM_BASE + 0x1000;
        m.bus_mut().store32(handler, 0x0013_0313).unwrap();
        for (csr, value) in [(MTVEC, handler), (MIE, 1 << 3), (MSTATUS, 1 << 3)] {
            m.hart_mut()
                .csr
                .access(csr, CsrOp::Write, value, false, false, 0)
                .unwrap();
        }
        m.bus_mut().store32(virt::CLINT_BASE, 1).unwrap();
        record_counts(&mut m, 2, 1, "host-irq-handler");
        assert_eq!(m.hart().regs.read(6), 1);
        assert_eq!(m.clint_mtime(), 0);
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn busy_guest_and_snapshot_bytes_remain_retire_derived_without_host_sampling() {
    for cached in [false, true] {
        let mut paced = fixture(cached, false, 64, 17, u64::MAX);
        let mut control = fixture(cached, false, 64, 17, u64::MAX);
        let clock = Clock::default();
        paced
            .set_paced_icount_clock(Box::new(clock.clone()))
            .unwrap();
        let reads = clock.reads.get();
        for (host, count) in [(0, 7), (40_000_000_000, 113), (2, 8)] {
            clock.ns.set(host);
            assert_eq!(paced.run(count), RunOutcome::MaxInstrs);
            assert_eq!(control.run(count), RunOutcome::MaxInstrs);
            assert_eq!(paced.save_resume().unwrap(), control.save_resume().unwrap());
        }
        assert_eq!(paced.clint_mtime(), 19);
        assert_eq!(
            clock.reads.get(),
            reads,
            "busy time does not sample host time"
        );
        assert_eq!(paced.irq_stats().retired, 128);
        assert_eq!(paced.hart().regs.read(5), control.hart().regs.read(5));
        assert!(paced.set_icount_divider(10).is_err());
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn pause_and_successful_restore_rebase_but_rejected_restore_keeps_the_anchor() {
    let mut m = fixture(true, true, 1024, 91, 2_000_091);
    let clock = Clock::default();
    m.set_paced_icount_clock(Box::new(clock.clone())).unwrap();
    clock.ns.set(1_000_000);
    record(&mut m, 2, "before-pause");
    assert_eq!(m.clint_mtime(), 10_091);
    let saved = m.save_resume().unwrap();
    clock.ns.set(600_001_000_000);
    m.rebase_guest_clock();
    record(&mut m, 2, "after-pause");
    assert_eq!(m.clint_mtime(), 10_091);
    clock.ns.set(600_002_000_000);
    record(&mut m, 2, "after-resume-progress");
    assert_eq!(m.clint_mtime(), 20_091);
    let reads = clock.reads.get();
    assert!(m.load_resume(&[0; 32]).is_err());
    assert_eq!(clock.reads.get(), reads, "refusal cannot rebase");
    clock.ns.set(600_003_000_000);
    record(&mut m, 2, "after-refused-restore");
    assert_eq!(m.clint_mtime(), 30_091);
    m.load_resume(&saved).unwrap();
    assert_eq!(m.guest_clock_mode(), TimeMode::PacedICount);
    assert_eq!(m.clint_mtime(), 10_091);
    record(&mut m, 2, "same-machine-restored");
    assert_eq!(m.clint_mtime(), 10_091);
    let mut fresh = fixture(false, true, 1024, 0, u64::MAX);
    let other = Clock::default();
    other.ns.set(9_000_000_000);
    fresh
        .set_paced_icount_clock(Box::new(other.clone()))
        .unwrap();
    fresh.load_resume(&saved).unwrap();
    record(&mut fresh, 2, "fresh-machine-restored");
    assert_eq!(fresh.clint_mtime(), 10_091);
    other.ns.set(9_001_000_000);
    record(&mut fresh, 2, "fresh-restored-progress");
    assert_eq!(fresh.clint_mtime(), 20_091);
    assert!(fresh.take_time_jump().is_none());
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn ceiling_arithmetic_never_rewinds_and_selection_preserves_unpaced_modes() {
    let mut p = IdlePacer::new(100, 500, 10_000_000);
    assert_eq!(p.limit_deadline(99, 700, 1000), 700);
    assert_eq!(p.limit_deadline(50_100, 700, 1000), 1000);
    assert_eq!(p.limit_deadline(100, 700, 1000), 1000);
    let mut p = IdlePacer::new(0, u64::MAX - 10, u64::MAX);
    assert_eq!(p.limit_deadline(u64::MAX, u64::MAX - 5, u64::MAX), u64::MAX);
    let mut no_clint = Machine::new(4096);
    let clock = Clock::default();
    assert!(
        no_clint
            .set_paced_icount_clock(Box::new(clock.clone()))
            .is_err()
    );
    assert_eq!(clock.reads.get(), 0);
    assert_eq!(no_clint.guest_clock_mode(), TimeMode::ICount);
    for cached in [false, true] {
        let mut m = fixture(cached, true, 64, 43, 100_043);
        m.set_paced_icount_clock(Box::new(clock.clone())).unwrap();
        m.set_icount_clock();
        let reads = clock.reads.get();
        record(&mut m, 2, "unpaced-control");
        assert_eq!(m.clint_mtime(), 100_043);
        assert_eq!(clock.reads.get(), reads);
        m.set_wall_clock(Box::new(clock.clone()), WallClockPolicy::DEFAULT);
        assert_eq!(m.guest_clock_mode(), TimeMode::WallClock);
        m.set_paced_icount_clock(Box::new(clock.clone())).unwrap();
        assert_eq!(m.guest_clock_mode(), TimeMode::PacedICount);
        assert_eq!(m.clint_mtime(), 100_043);
    }
}
