//! Independent original-Machine high-phase/source-replacement/IRQ sequence.
#![cfg(not(feature = "zicsr-stub"))]

use std::{cell::Cell, rc::Rc};
use wasm_vm_core::bus::Bus;
use wasm_vm_core::csr::{CsrOp, MCAUSE, MIE, MIP, MSTATUS, MTVEC};
use wasm_vm_core::platform::virt;
use wasm_vm_core::time::{MonotonicClock, TimeMode};
use wasm_vm_core::trace::{HashSink, TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};

#[derive(Clone)]
struct Host {
    ns: Rc<Cell<u64>>,
    reads: Rc<Cell<u64>>,
}

impl Host {
    fn at(ns: u64) -> Self {
        Self {
            ns: Rc::new(Cell::new(ns)),
            reads: Rc::new(Cell::new(0)),
        }
    }
}

impl MonotonicClock for Host {
    fn now_nanos(&self) -> u64 {
        self.reads.set(self.reads.get() + 1);
        self.ns.get()
    }
}

#[derive(Default)]
struct Capture(Vec<TraceRecord>);
impl TraceSink for Capture {
    fn retire(&mut self, record: &TraceRecord) {
        self.0.push(*record);
    }
}

fn fixture(cached: bool, initial: u64) -> Machine {
    let mut machine = Machine::new(64 * 1024);
    machine.enable_clint(37);
    for (offset, word) in [
        (0, 0x0012_8293),      // addi t0,t0,1
        (4, 0xffdf_f06f),      // jal zero,-4
        (0x100, 0x1050_0073),  // wfi
        (0x104, 0xffdf_f06f),  // jal zero,-4
        (0x1000, 0x0013_0313), // addi t1,t1,1
    ] {
        machine
            .bus_mut()
            .store32(virt::DRAM_BASE + offset, word)
            .unwrap();
    }
    machine
        .bus_mut()
        .store64(virt::CLINT_BASE + 0xbff8, initial)
        .unwrap();
    machine
        .bus_mut()
        .store64(virt::CLINT_BASE + 0x4000, initial + 1000)
        .unwrap();
    machine
        .hart_mut()
        .csr
        .access(MIE, CsrOp::Write, (1 << 7) | (1 << 3), false, false, 0)
        .unwrap();
    machine.hart_mut().regs.pc = virt::DRAM_BASE;
    machine.set_block_cache(cached);
    machine.set_interrupt_batching(cached);
    machine
}

fn record(machine: &mut Machine, work: u64, retired: usize, label: &str) {
    let mut capture = Capture::default();
    assert_eq!(
        machine.run_traced(work, &mut capture),
        RunOutcome::MaxInstrs
    );
    assert_eq!(
        capture.0.len(),
        retired,
        "original call must return at its work budget"
    );
    let mut hash = HashSink::new();
    for item in &capture.0 {
        hash.retire(item);
        eprintln!("CRITIC73_TRACE {label} {}", fmt_canonical(item));
    }
    eprintln!(
        "CRITIC73_STATE {label} work={work} retired={retired} mtime={} hash={:016x} digest={}",
        machine.clint_mtime(),
        hash.hash(),
        machine.snapshot().hex_digest()
    );
}

#[test]
fn original_machine_reselection_preserves_high_phase_and_pending_irq_boundary() {
    for cached in [false, true] {
        for initial in [0, (1_u64 << 53) + 1234] {
            let label = format!("cached={cached}/initial={initial}");
            let mut machine = fixture(cached, initial);
            let old = Host::at(1_000_000_000);
            let before = machine.save_resume().unwrap();
            machine
                .set_paced_icount_clock(Box::new(old.clone()))
                .unwrap();
            assert_eq!(machine.save_resume().unwrap(), before);
            record(&mut machine, 77, 77, &format!("{label}/busy"));
            assert_eq!(machine.clint_mtime(), initial + 2);
            assert_eq!(machine.hart().regs.read(5), 39);
            assert_eq!(old.reads.get(), 1, "busy retirement must not sample host");
            machine.hart_mut().regs.pc = virt::DRAM_BASE + 0x100;
            let before_idle = machine.save_resume().unwrap();
            // Busy phase is3 and current time is already2ticks above the stalled ceiling.
            record(
                &mut machine,
                2,
                2,
                &format!("{label}/already-above-ceiling"),
            );
            assert_eq!(machine.clint_mtime(), initial + 2);
            assert_eq!(old.reads.get(), 2);
            assert_eq!(machine.hart_mut().csr.read(MIP) & (1 << 7), 0);

            let next = Host::at(7_000_000_000);
            old.ns.set(u64::MAX);
            let before_reselect = machine.save_resume().unwrap();
            machine
                .set_paced_icount_clock(Box::new(next.clone()))
                .unwrap();
            assert_eq!(machine.save_resume().unwrap(), before_reselect);
            assert_eq!(
                old.reads.get(),
                2,
                "reselection must not consult discarded source"
            );
            assert_eq!(next.reads.get(), 1);
            record(&mut machine, 2, 2, &format!("{label}/new-stalled-source"));
            assert_eq!(machine.clint_mtime(), initial + 2);
            assert_eq!(next.reads.get(), 2);

            next.ns.set(7_000_012_399);
            record(&mut machine, 2, 2, &format!("{label}/fractional-tick"));
            assert_eq!(machine.clint_mtime(), initial + 125);
            next.ns.set(7_000_001_000);
            record(&mut machine, 2, 2, &format!("{label}/backward-host"));
            assert_eq!(machine.clint_mtime(), initial + 125);
            assert_eq!(next.reads.get(), 4);

            // A pending enabled MSIP must prevent sampling this very large host jump.
            next.ns.set(9_000_000_000);
            machine.bus_mut().store32(virt::CLINT_BASE, 1).unwrap();
            record(&mut machine, 2, 2, &format!("{label}/pending-msip"));
            assert_eq!(machine.clint_mtime(), initial + 125);
            assert_eq!(next.reads.get(), 4);
            assert_ne!(machine.hart_mut().csr.read(MIP) & (1 << 3), 0);
            assert_eq!(machine.hart_mut().csr.read(MIP) & (1 << 7), 0);

            machine.bus_mut().store32(virt::CLINT_BASE, 0).unwrap();
            next.ns.set(7_000_099_799);
            record(
                &mut machine,
                2,
                2,
                &format!("{label}/one-ns-before-deadline"),
            );
            assert_eq!(machine.clint_mtime(), initial + 999);
            assert_eq!(machine.hart_mut().csr.read(MIP) & ((1 << 3) | (1 << 7)), 0);
            next.ns.set(7_000_099_800);
            record(&mut machine, 2, 2, &format!("{label}/exact-deadline"));
            assert_eq!(machine.clint_mtime(), initial + 1000);
            assert_ne!(machine.hart_mut().csr.read(MIP) & (1 << 7), 0);
            assert_eq!(next.reads.get(), 6);

            for (csr, value) in [(MTVEC, virt::DRAM_BASE + 0x1000), (MSTATUS, 1 << 3)] {
                machine
                    .hart_mut()
                    .csr
                    .access(csr, CsrOp::Write, value, false, false, 0)
                    .unwrap();
            }
            record(&mut machine, 2, 1, &format!("{label}/original-timer-trap"));
            assert_eq!(machine.hart().regs.read(6), 1);
            assert_eq!(machine.hart().regs.pc, virt::DRAM_BASE + 0x1004);
            assert_eq!(machine.hart_mut().csr.read(MCAUSE), (1_u64 << 63) | 7);
            assert_eq!(old.reads.get(), 2);
            assert_eq!(next.reads.get(), 6);

            // The same architectural snapshot never carries the discarded host policy/epoch.
            let mut unpaced = fixture(cached, 0);
            unpaced.load_resume(&before_idle).unwrap();
            assert_eq!(unpaced.guest_clock_mode(), TimeMode::ICount);
            record(&mut unpaced, 2, 2, &format!("{label}/fresh-unpaced-resume"));
            assert_eq!(unpaced.clint_mtime(), initial + 1000);
            eprintln!("CRITIC73_CASE {label} held");
        }
    }
}
