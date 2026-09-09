//! E5-T26j: exact deterministic divider/phase semantics, shared with wasm32.
#![cfg(not(feature = "zicsr-stub"))]

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::csr::MIP;
use wasm_vm_core::dev::clint::ClintState;
use wasm_vm_core::platform::virt;
use wasm_vm_core::resume::{SectionReader, SnapshotWriter, section};
use wasm_vm_core::time::{MonotonicClock, TimeMode, WallClockPolicy};
use wasm_vm_core::trace::HashSink;
use wasm_vm_core::{Machine, RunOutcome};

fn machine(divider: u64) -> (Machine, Rc<RefCell<ClintState>>) {
    let mut m = Machine::new(4096);
    let clint = m.enable_clint(divider);
    // rdtime t0; addi t1,t1,1; jal zero,-8. Busy real instructions, never WFI.
    for (i, word) in [0xc010_22f3, 0x0013_0313, 0xff9f_f06f]
        .into_iter()
        .enumerate()
    {
        m.bus_mut()
            .store32(virt::DRAM_BASE + i as u64 * 4, word)
            .unwrap();
    }
    m.hart_mut().regs.pc = virt::DRAM_BASE;
    (m, clint)
}

fn run(m: &mut Machine, count: u64) {
    if count == 0 {
        return;
    }
    let before = m.irq_stats().retired;
    assert_eq!(m.run(count), RunOutcome::MaxInstrs);
    assert_eq!(m.irq_stats().retired - before, count);
}

fn clock(blob: &[u8]) -> [u64; 3] {
    let (_, sections) = SectionReader::new(blob).unwrap();
    let payload = sections
        .map(Result::unwrap)
        .find(|entry| entry.tag == section::CLOCK)
        .unwrap()
        .payload;
    assert_eq!(payload.len(), 24, "existing phase/divider/stimecmp format");
    std::array::from_fn(|i| u64::from_le_bytes(payload[i * 8..i * 8 + 8].try_into().unwrap()))
}

fn with_clock(blob: &[u8], fields: [u64; 3]) -> Vec<u8> {
    let (header, sections) = SectionReader::new(blob).unwrap();
    let mut writer = SnapshotWriter::new(
        &header.core_hash,
        &header.base_image_hash,
        header.overlay_generation,
    );
    let payload: Vec<u8> = fields.into_iter().flat_map(u64::to_le_bytes).collect();
    for entry in sections.map(Result::unwrap) {
        writer.section(
            entry.tag,
            if entry.tag == section::CLOCK {
                &payload
            } else {
                entry.payload
            },
        );
    }
    writer.finish()
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn all_small_ratios_and_phases_preserve_state_and_land_the_next_tick_exactly() {
    for old in 1..=16 {
        for new in 1..=16 {
            for phase in 0..old {
                let (mut m, clint) = machine(old);
                run(&mut m, phase);
                let before = m.save_resume().unwrap();
                let mut fields = clock(&before);
                assert_eq!(fields[..2], [phase, old]);
                let mapped = phase * new / old; // Small independent integer oracle.
                m.set_icount_divider(new).unwrap();
                fields[0] = mapped;
                fields[1] = new;
                assert_eq!(m.save_resume().unwrap(), with_clock(&before, fields));
                assert_eq!(m.guest_clock_div(), new);
                assert_eq!(clint.borrow().mtime, 0);
                run(&mut m, new - mapped - 1);
                assert_eq!(
                    clint.borrow().mtime,
                    0,
                    "old={old}, new={new}, phase={phase}"
                );
                run(&mut m, 1);
                assert_eq!(
                    clint.borrow().mtime,
                    1,
                    "retained CLINT handle must advance"
                );
                assert_eq!(clock(&m.save_resume().unwrap())[..2], [0, new]);
            }
        }
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn same_divider_is_byte_exact_and_preserves_pending_irqs_device_and_cache_identity() {
    let (mut m, clint) = machine(10);
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(2);
    m.set_jit(true);
    m.set_batch_size(7);
    clint.borrow_mut().mtime = 50;
    clint.borrow_mut().mtimecmp = 49;
    clint.borrow_mut().msip = true;
    run(&mut m, 7);
    let before = m.save_resume().unwrap();
    let mip = m.hart_mut().csr.read(MIP);
    assert_eq!(mip & ((1 << 7) | (1 << 3)), (1 << 7) | (1 << 3));
    let cache = m.block_cache_entry_stats();
    let discovery = m.discovery_stats();
    let jit = m.jit_cache_stats();
    let registry = m.jit_registry();
    // No compiled executor is installed in this core fixture. Its effective
    // policy must stay unchanged; the WASM wrapper test warms a real executor.
    let active = m.jit_active();
    let batch_size = m.batch_size();
    m.set_icount_divider(10).unwrap();
    assert_eq!(m.save_resume().unwrap(), before);
    m.set_icount_divider(3).unwrap();
    let mut fields = clock(&before);
    fields[0] = 2;
    fields[1] = 3;
    assert_eq!(m.save_resume().unwrap(), with_clock(&before, fields));
    assert_eq!(m.hart_mut().csr.read(MIP), mip);
    assert_eq!(m.block_cache_entry_stats(), cache);
    assert_eq!(m.discovery_stats(), discovery);
    assert_eq!(m.jit_cache_stats(), jit);
    assert_eq!(m.jit_registry(), registry);
    assert_eq!(m.batch_size(), batch_size);
    assert!(m.block_cache_enabled());
    assert!(m.interrupt_batching());
    assert_eq!(m.jit_active(), active);
    assert_eq!(m.bus_mut().load64(virt::CLINT_BASE + 0x4000).unwrap(), 49);
    assert_eq!(m.bus_mut().load32(virt::CLINT_BASE).unwrap(), 1);
    run(&mut m, 1);
    assert_eq!(clint.borrow().mtime, 51);
    assert_eq!(clint.borrow().mtimecmp, 49);
    assert!(clint.borrow().msip);
    clint.borrow_mut().msip = false;
    assert_eq!(m.bus_mut().load32(virt::CLINT_BASE).unwrap(), 0);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn missing_clint_and_out_of_range_inputs_are_atomic() {
    let mut missing = Machine::new(4096);
    let before = missing.save_resume().unwrap();
    for value in [1, 10, 1024] {
        assert!(missing.set_icount_divider(value).is_err());
        assert_eq!(missing.save_resume().unwrap(), before);
    }
    let (mut m, _) = machine(10);
    run(&mut m, 7);
    let before = m.save_resume().unwrap();
    for value in [0, 1025, u64::MAX] {
        assert!(m.set_icount_divider(value).is_err());
        assert_eq!(m.save_resume().unwrap(), before);
        assert_eq!(m.guest_clock_mode(), TimeMode::ICount);
    }
}

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

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn wall_mode_refuses_even_same_divider_without_touching_the_host_anchor() {
    let (mut m, _) = machine(10);
    run(&mut m, 7);
    let host = ManualClock::default();
    m.set_wall_clock(Box::new(host.clone()), WallClockPolicy::DEFAULT);
    let reads = host.reads.get();
    let before = m.save_resume().unwrap();
    host.ns.set(1_000_000);
    for value in [1, 10, 1024] {
        assert!(m.set_icount_divider(value).is_err());
        assert_eq!(m.save_resume().unwrap(), before);
        assert_eq!(host.reads.get(), reads);
        assert_eq!(m.guest_clock_mode(), TimeMode::WallClock);
    }
    run(&mut m, 1);
    assert_eq!(
        m.clint_mtime(),
        10_000,
        "refusal cannot rebase away elapsed wall time"
    );
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn huge_prior_dividers_and_resumed_phases_map_with_full_u128_precision() {
    for old in [1025, 1 << 32, 1 << 63, u64::MAX] {
        for phase in [0, 1, old / 2, old - 1] {
            for new in [1, 3, 1024] {
                let (mut m, clint) = machine(old); // Existing API admits any u64 prior divider.
                let before = m.save_resume().unwrap();
                m.load_resume(&with_clock(&before, [phase, old, u64::MAX - 37]))
                    .unwrap();
                let before = m.save_resume().unwrap();
                let mapped = (u128::from(phase) * u128::from(new) / u128::from(old)) as u64;
                m.set_icount_divider(new).unwrap();
                assert_eq!(
                    m.save_resume().unwrap(),
                    with_clock(&before, [mapped, new, u64::MAX - 37])
                );
                if phase == old - 1 {
                    assert_eq!(mapped, new - 1, "near-one phase must not wrap its multiply");
                }
                run(&mut m, new - mapped - 1);
                assert_eq!(clint.borrow().mtime, 0);
                run(&mut m, 1);
                assert_eq!(clint.borrow().mtime, 1);
            }
        }
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn invalid_saved_phases_refuse_before_same_divider_or_any_other_mutation() {
    for (phase, old) in [
        (0, 0),
        (1, 0),
        (10, 10),
        (u64::MAX, u64::MAX),
        (u64::MAX, 1),
    ] {
        let (mut m, _) = machine(10);
        let blob = m.save_resume().unwrap();
        // The existing wire reader accepts these u64 fields; the new setter must fail closed.
        m.load_resume(&with_clock(&blob, [phase, old, 1234]))
            .unwrap();
        let before = m.save_resume().unwrap();
        for new in [1, 10, 1024] {
            assert!(
                m.set_icount_divider(new).is_err(),
                "phase={phase}, old={old}, new={new}"
            );
            assert_eq!(m.save_resume().unwrap(), before);
        }
    }
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn resume_retains_selected_phase_and_explicit_post_restore_override_maps_it_once() {
    let (mut source, _) = machine(10);
    run(&mut source, 7);
    source.set_icount_divider(3).unwrap();
    let blob = source.save_resume().unwrap();
    assert_eq!(clock(&blob)[..2], [2, 3]);
    let (mut fresh, clint) = machine(64);
    run(&mut fresh, 129);
    fresh.load_resume(&blob).unwrap();
    assert_eq!(fresh.save_resume().unwrap(), blob);
    assert_eq!(
        fresh.guest_clock_div(),
        3,
        "omission honors the saved divider"
    );
    run(&mut fresh, 1);
    assert_eq!(clint.borrow().mtime, 1);
    fresh.load_resume(&blob).unwrap();
    fresh.set_icount_divider(10).unwrap();
    assert_eq!(clock(&fresh.save_resume().unwrap())[..2], [6, 10]);
    run(&mut fresh, 3);
    assert_eq!(clint.borrow().mtime, 0);
    run(&mut fresh, 1);
    assert_eq!(clint.borrow().mtime, 1);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn busy_guest_rdtime_matches_independent_phase_oracle_and_trace_across_cache_modes() {
    let mut digests = Vec::new();
    for cached in [false, true] {
        let (mut m, _) = machine(10);
        m.set_block_cache(cached);
        m.set_interrupt_batching(cached);
        let (mut divider, mut phase, mut mtime) = (10, 0, 0);
        let mut trace = HashSink::new();
        for retired in 0..1100 {
            let new = match retired {
                7 => Some(3),
                20 => Some(1024),
                1030 => Some(1),
                1040 => Some(10),
                1067 => Some(16),
                _ => None,
            };
            if let Some(new) = new {
                phase = phase * new / divider;
                divider = new;
                m.set_icount_divider(new).unwrap();
            }
            assert_eq!(m.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
            if retired % 3 == 0 {
                assert_eq!(
                    m.hart().regs.read(5),
                    mtime,
                    "guest rdtime at retirement {retired}"
                );
            }
            phase += 1;
            if phase == divider {
                phase = 0;
                mtime += 1;
            }
            assert_eq!(m.clint_mtime(), mtime);
        }
        assert_eq!(trace.retired(), 1100);
        assert_eq!(clock(&m.save_resume().unwrap())[..2], [phase, divider]);
        digests.push((trace.hash(), m.snapshot().hex_digest()));
    }
    assert_eq!(digests[0], digests[1]);
    // Pinned native result after independently checking every guest rdtime;
    // this same fixture must match these bytes on the 32-bit WASM target.
    assert_eq!(digests[0].0, 0x4ddc_3922_97eb_e1dc);
    assert_eq!(
        digests[0].1,
        "c7d032c22b596d220102600fedf6e5de9e0f7e38487e0367eb4b8a7d4b51f7c4"
    );
    #[cfg(not(target_arch = "wasm32"))]
    println!(
        "ICOUNT_DIVIDER_PARITY trace={:016x} snapshot={}",
        digests[0].0, digests[0].1
    );
    #[cfg(target_arch = "wasm32")]
    wasm_bindgen_test::console_log!(
        "ICOUNT_DIVIDER_PARITY trace={:016x} snapshot={}",
        digests[0].0,
        digests[0].1
    );
}
