//! Actual guest rdtime and resume fixtures, also run through wasm-bindgen-test.
#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::csr::MINSTRET;
use wasm_vm_core::resume::{SectionReader, SnapshotWriter, section};
use wasm_vm_core::trace::{HashSink, TraceRecord, TraceSink};
use wasm_vm_core::{Machine, RunOutcome};

#[derive(Default)]
struct Capture {
    records: Vec<TraceRecord>,
}

impl TraceSink for Capture {
    fn retire(&mut self, record: &TraceRecord) {
        self.records.push(*record);
    }
}

fn machine(divisor: u64, cached: bool, batched: bool) -> Machine {
    let mut m = Machine::new(4096);
    m.enable_clint(divisor);
    // rdtime x5; addi x6,x6,1; jal x0,-8. Every time read is a real guest CSR access.
    for (i, word) in [0xc010_22f3, 0x0013_0313, 0xff9f_f06f]
        .into_iter()
        .enumerate()
    {
        m.bus_mut().store32(DRAM_BASE + i as u64 * 4, word).unwrap();
    }
    m.hart_mut().regs.pc = DRAM_BASE;
    m.set_block_cache(cached);
    m.set_interrupt_batching(batched);
    m
}

fn phase(m: &mut Machine) -> u64 {
    let bytes = m.save_resume().unwrap();
    let (_, sections) = SectionReader::new(&bytes).unwrap();
    let clock = sections
        .map(Result::unwrap)
        .find(|s| s.tag == section::CLOCK)
        .unwrap();
    u64::from_le_bytes(clock.payload[..8].try_into().unwrap())
}

fn restore_phase(m: &mut Machine, phase: u64, mtime: u64) {
    let bytes = m.save_resume().unwrap();
    let (header, sections) = SectionReader::new(&bytes).unwrap();
    let mut writer = SnapshotWriter::new(
        &header.core_hash,
        &header.base_image_hash,
        header.overlay_generation,
    );
    for entry in sections.map(Result::unwrap) {
        let mut payload = entry.payload.to_vec();
        if entry.tag == section::CLOCK {
            payload[..8].copy_from_slice(&phase.to_le_bytes());
        }
        writer.section(entry.tag, &payload);
    }
    m.load_resume(&writer.finish()).unwrap();
    m.bus_mut()
        .store64(wasm_vm_core::bus::mmap::CLINT_BASE + 0xbff8, mtime)
        .unwrap();
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
#[cfg_attr(not(target_arch = "wasm32"), test)]
fn guest_rdtime_split_budgets_and_resume_match_independent_clock_oracle() {
    for divisor in [1, 3, 10, 64, 1024, u64::MAX] {
        for start_phase in [0, divisor - 1] {
            for start_time in [0, u64::MAX - 1] {
                for (cached, batched) in [(false, false), (true, false), (true, true)] {
                    let mut m = machine(divisor, cached, batched);
                    restore_phase(&mut m, start_phase, start_time);
                    let mut trace = Capture::default();
                    let mut retired = 0u64;
                    for span in [1, 2, 31, 3, 63, 1, 64, 27] {
                        assert_eq!(m.run_traced(span, &mut trace), RunOutcome::MaxInstrs);
                        retired += span;
                        let total = u128::from(start_phase) + u128::from(retired);
                        assert_eq!(phase(&mut m), (total % u128::from(divisor)) as u64);
                        assert_eq!(
                            m.clint_mtime(),
                            start_time.wrapping_add((total / u128::from(divisor)) as u64)
                        );
                        assert_eq!(m.hart_mut().csr.read(MINSTRET), retired);
                        if retired == 101 {
                            let bytes = m.save_resume().unwrap();
                            let mut restored = machine(divisor, cached, batched);
                            restored.load_resume(&bytes).unwrap();
                            assert_eq!(restored.save_resume().unwrap(), bytes);
                            m = restored;
                        }
                    }
                    assert_eq!(trace.records.len(), 192);
                    assert_eq!(m.hart().regs.read(6), 64);
                    assert_eq!(m.hart().regs.pc, DRAM_BASE);
                    for (index, record) in trace.records.iter().enumerate() {
                        if index % 3 == 0 {
                            let ticks =
                                (u128::from(start_phase) + index as u128) / u128::from(divisor);
                            assert_eq!(record.rd, Some((5, start_time.wrapping_add(ticks as u64))));
                        }
                    }
                    let mut digest = HashSink::new();
                    for record in &trace.records {
                        digest.retire(record);
                    }
                    println!(
                        "clock-guest div={divisor} phase={start_phase} start={start_time} cached={cached} batched={batched} trace={:016x} state={}",
                        digest.hash(),
                        m.snapshot().hex_digest()
                    );
                }
            }
        }
    }
}
