//! Public-API evidence producer, usable with both frozen baseline and candidate libraries.
use std::fmt::Write as _;
use std::time::Instant;

use sha2::{Digest, Sha256};
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::csr::MINSTRET;
use wasm_vm_core::resume::{SectionReader, section};
use wasm_vm_core::trace::{TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};

fn hex(bytes: &[u8]) -> String {
    let mut text = String::new();
    for byte in bytes {
        write!(text, "{byte:02x}").unwrap();
    }
    text
}

#[derive(Default)]
struct Capture(String);
impl TraceSink for Capture {
    fn retire(&mut self, record: &TraceRecord) {
        writeln!(self.0, "{}", fmt_canonical(record)).unwrap();
    }
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    assert!(
        args.len() == 3 || args.len() == 4,
        "BUDGET DIVIDER CACHED [TRACE_FILE]"
    );
    let budget: u64 = args[0].parse().unwrap();
    let divisor: u64 = args[1].parse().unwrap();
    let cached: bool = args[2].parse().unwrap();
    let recording = args.get(3);
    assert!(budget > 0);
    assert_eq!(budget % if recording.is_some() { 3 } else { 4 }, 0);
    let mut m = Machine::new(8192);
    if divisor != 0 {
        m.enable_clint(divisor);
    }
    let words: &[u32] = if recording.is_some() {
        &[0xc010_22f3, 0x0013_0313, 0xff9f_f06f] // rdtime x5; addi x6,1; jal -8
    } else {
        &[0x0012_8293, 0x0023_0313, 0x0062_83b3, 0xff5f_f06f]
    };
    for (i, word) in words.iter().enumerate() {
        m.bus_mut()
            .store32(DRAM_BASE + i as u64 * 4, *word)
            .unwrap();
    }
    m.hart_mut().regs.pc = DRAM_BASE;
    m.set_block_cache(cached);
    m.set_interrupt_batching(cached);
    let mut trace = Capture::default();
    let start = Instant::now();
    let outcome = if recording.is_some() {
        m.run_traced(budget, &mut trace)
    } else {
        m.run(budget)
    };
    let seconds = start.elapsed().as_secs_f64();
    assert_eq!(outcome, RunOutcome::MaxInstrs);
    assert_eq!(m.hart_mut().csr.read(MINSTRET), budget);
    assert_eq!(m.hart().regs.pc, DRAM_BASE);
    if recording.is_some() {
        assert_eq!(m.hart().regs.read(6), budget / 3);
        if let Some(expected) = (budget - 3).checked_div(divisor) {
            assert_eq!(m.hart().regs.read(5), expected);
        }
    } else {
        assert_eq!(m.hart().regs.read(5), budget / 4);
        assert_eq!(m.hart().regs.read(6), budget / 2);
        assert_eq!(m.hart().regs.read(7), 3 * budget / 4);
    }
    let blob = m.save_resume().unwrap();
    let (_, sections) = SectionReader::new(&blob).unwrap();
    let clock = sections
        .map(Result::unwrap)
        .find(|s| s.tag == section::CLOCK)
        .unwrap();
    let phase = u64::from_le_bytes(clock.payload[..8].try_into().unwrap());
    if let Some(expected) = budget.checked_div(divisor) {
        assert_eq!(m.clint_mtime(), expected);
        assert_eq!(phase, budget % divisor);
    }
    if let Some(file) = recording {
        std::fs::write(file, &trace.0).unwrap();
    }
    println!(
        "{{\"cached\":{cached},\"divider\":{divisor},\"seconds\":{seconds},\"retired\":{budget},\"mtime\":{},\"phase\":{phase},\"pc\":{},\"xregs\":{:?},\"snapshotSha256\":\"{}\",\"traceSha256\":\"{}\"}}",
        m.clint_mtime(),
        m.hart().regs.pc,
        m.snapshot().xregs,
        hex(&Sha256::digest(&blob)),
        hex(&Sha256::digest(trace.0.as_bytes()))
    );
}
