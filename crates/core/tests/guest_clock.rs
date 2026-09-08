//! E5-T26i: actual busy guest rdtime, lifecycle rebasing, and the unchanged ICount oracle.
//! The same deterministic fixtures also execute on wasm32 via crates/wasm/tests/guest_clock.rs.
#![cfg(not(feature = "zicsr-stub"))]

use std::cell::Cell;
use std::rc::Rc;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::platform::virt;
use wasm_vm_core::resume::{SectionReader, SnapshotWriter, section};
use wasm_vm_core::time::{MonotonicClock, TimeMode, WallClockPolicy};
use wasm_vm_core::trace::HashSink;
use wasm_vm_core::{Machine, RunOutcome};

#[derive(Clone, Default)]
struct ManualClock {
    ns: Rc<Cell<u64>>,
    reads: Rc<Cell<u64>>,
}

impl MonotonicClock for ManualClock {
    fn now_nanos(&self) -> u64 {
        self.reads.set(self.reads.get() + 1);
        self.ns.get()
    }
}

fn machine() -> Machine {
    let mut m = Machine::new(64 * 1024);
    m.enable_clint(10);
    // rdtime t0; addi t1,t1,1; jal zero,-8. No WFI, no host register injection per sample.
    for (i, word) in [0xc010_22f3, 0x0013_0313, 0xff9f_f06f]
        .into_iter()
        .enumerate()
    {
        m.bus_mut()
            .store32(virt::DRAM_BASE + 4 * i as u64, word)
            .unwrap();
    }
    m.hart_mut().regs.pc = virt::DRAM_BASE;
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m
}

fn arm(m: &mut Machine, host_ns: u64) -> ManualClock {
    let clock = ManualClock::default();
    clock.ns.set(host_ns);
    m.set_wall_clock(Box::new(clock.clone()), WallClockPolicy::DEFAULT);
    clock
}

fn rdtime(m: &mut Machine) -> u64 {
    let retired = m.irq_stats().retired;
    let loops = m.hart().regs.read(6);
    assert_eq!(m.run(3), RunOutcome::MaxInstrs);
    assert_eq!(m.irq_stats().retired, retired + 3);
    assert_eq!(m.hart().regs.read(6), loops + 1, "busy guest loop retired");
    m.hart().regs.read(5)
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn busy_rdtime_tracks_ten_mhz_not_retire_count_and_clamps_jitter() {
    let mut wall = machine();
    let mut icount = machine();
    let epoch = 73_000_000_000;
    let clock = arm(&mut wall, epoch);
    assert_eq!(wall.guest_clock_mode(), TimeMode::WallClock);
    assert_eq!(wall.guest_clock_div(), 10);
    for step in 1..=10 {
        clock.ns.set(epoch + step * 100_000_000);
        assert_eq!(rdtime(&mut wall), step * 1_000_000);
        rdtime(&mut icount);
    }
    assert_eq!(wall.clint_mtime(), 10_000_000);
    assert_eq!(icount.clint_mtime(), 3);
    assert_eq!(wall.irq_stats().retired, icount.irq_stats().retired);
    clock.ns.set(epoch + 900_000_000); // actual backward jitter
    assert_eq!(rdtime(&mut wall), 10_000_000);
    clock.ns.set(epoch + 1_001_000_000);
    assert_eq!(rdtime(&mut wall), 10_010_000);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn explicit_resume_freezes_pause_but_background_retains_jump_policy() {
    let mut m = machine();
    let clock = arm(&mut m, 0);
    clock.ns.set(50_000_000);
    let before = rdtime(&mut m);
    clock.ns.set(600_050_000_000); // explicit ten-minute pause, no guest runs
    m.rebase_guest_clock();
    assert_eq!(m.clint_mtime(), before);
    assert_eq!(rdtime(&mut m), before);
    assert!(m.take_time_jump().is_none());
    clock.ns.set(600_051_000_000);
    assert_eq!(rdtime(&mut m), before + 10_000);
    // Ordinary background time is not rebased and must still use E4-T24's jump policy.
    clock.ns.set(1_200_051_000_000);
    assert_eq!(rdtime(&mut m), before + 10_000 + 6_000_000_000);
    assert!(m.take_time_jump().is_some());
    clock.ns.set(1_800_051_000_000);
    rdtime(&mut m);
    m.rebase_guest_clock();
    assert!(
        m.take_time_jump().is_none(),
        "old epoch notification was discarded"
    );
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn fresh_and_same_machine_restore_rebase_at_restored_mtime_and_preserve_deadline() {
    let mut source = machine();
    let source_clock = arm(&mut source, 90_000_000_000);
    source_clock.ns.set(90_100_000_000);
    let saved_time = rdtime(&mut source);
    let deadline = saved_time + 20_000;
    source
        .bus_mut()
        .store64(virt::CLINT_BASE + 0x4000, deadline)
        .unwrap();
    let blob = source.save_resume().unwrap();
    // Save must not sample/serialize the host epoch.
    let reads = source_clock.reads.get();
    source_clock.ns.set(9_000_000_000_000);
    assert_eq!(source.save_resume().unwrap(), blob);
    assert_eq!(source_clock.reads.get(), reads);

    let mut fresh = machine();
    let fresh_clock = arm(&mut fresh, 0); // unrelated host realm, no pre-seeded guest state
    fresh.load_resume(&blob).unwrap();
    assert_eq!(fresh.guest_clock_mode(), TimeMode::WallClock);
    assert_eq!(fresh.save_resume().unwrap(), blob);
    assert_eq!(rdtime(&mut fresh), saved_time);
    fresh_clock.ns.set(1_000_000);
    assert_eq!(rdtime(&mut fresh), saved_time + 10_000);
    assert_eq!(
        fresh.hart_mut().csr.read(wasm_vm_core::csr::MIP) & (1 << 7),
        0
    );
    fresh_clock.ns.set(2_000_000);
    assert_eq!(rdtime(&mut fresh), deadline);
    assert_ne!(
        fresh.hart_mut().csr.read(wasm_vm_core::csr::MIP) & (1 << 7),
        0
    );

    // Dirty the old machine's clock floor beyond the snapshot; restore must replace that floor.
    assert!(rdtime(&mut source) > saved_time);
    source.load_resume(&blob).unwrap();
    assert_eq!(source.save_resume().unwrap(), blob);
    assert!(source.take_time_jump().is_none());
    assert_eq!(rdtime(&mut source), saved_time);
    source_clock.ns.set(9_000_001_000_000);
    assert_eq!(rdtime(&mut source), saved_time + 10_000);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn rejected_resume_preserves_policy_anchor_and_guest_state() {
    for bad_tag in [section::CPU, section::RAM, section::CLINT, section::CLOCK] {
        let mut m = machine();
        let clock = arm(&mut m, 1_000_000_000);
        clock.ns.set(1_010_000_000);
        assert_eq!(rdtime(&mut m), 100_000);
        let before = m.save_resume().unwrap();
        let (header, sections) = SectionReader::new(&before).unwrap();
        let mut writer = SnapshotWriter::new(
            &header.core_hash,
            &header.base_image_hash,
            header.overlay_generation,
        );
        for entry in sections {
            let entry = entry.unwrap();
            writer.section(
                entry.tag,
                if entry.tag == bad_tag {
                    &[]
                } else {
                    entry.payload
                },
            );
        }
        let reads = clock.reads.get();
        clock.ns.set(1_020_000_000);
        assert!(
            m.load_resume(&writer.finish()).is_err(),
            "malformed tag {bad_tag}"
        );
        assert_eq!(
            clock.reads.get(),
            reads,
            "refusal must not sample/rebase the clock"
        );
        assert_eq!(m.guest_clock_mode(), TimeMode::WallClock);
        assert_eq!(m.save_resume().unwrap(), before);
        // A misplaced rebase on refusal would produce 100_000 here instead of 200_000.
        assert_eq!(rdtime(&mut m), 200_000);
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn icount_rebase_selection_and_restore_preserve_trace_digest_and_subtick_phase() {
    let mut control = machine();
    let mut selected = machine();
    let clock = arm(&mut selected, 42_000_000_000);
    selected.set_icount_clock();
    let reads = clock.reads.get();
    let mut control_trace = HashSink::new();
    let mut selected_trace = HashSink::new();
    for count in [7, 14, 103, 5, 11] {
        assert_eq!(
            control.run_traced(count, &mut control_trace),
            RunOutcome::MaxInstrs
        );
        clock.ns.set(clock.ns.get() + 600_000_000_000);
        selected.rebase_guest_clock();
        selected.set_icount_clock();
        assert_eq!(
            selected.run_traced(count, &mut selected_trace),
            RunOutcome::MaxInstrs
        );
        let blob = selected.save_resume().unwrap();
        selected.load_resume(&blob).unwrap();
        assert_eq!(
            selected.save_resume().unwrap(),
            control.save_resume().unwrap()
        );
    }
    assert_eq!(selected.guest_clock_mode(), TimeMode::ICount);
    assert_eq!(clock.reads.get(), reads);
    assert_eq!(selected_trace.retired(), 140);
    assert_eq!(selected_trace.hash(), control_trace.hash());
    assert_eq!(
        selected.snapshot().hex_digest(),
        control.snapshot().hex_digest()
    );
    assert_eq!(selected.clint_mtime(), 14);
}
