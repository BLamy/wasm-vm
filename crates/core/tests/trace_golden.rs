//! E0-T16 trace records: golden canonical trace of loops.elf, format-rule tests, and
//! the observer property (tracing never perturbs architectural state). Requires the
//! `trace` feature (VecSink lives there).
#![cfg(feature = "trace")]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::{DRAM_BASE, UART0_BASE, UART0_LEN};
use wasm_vm_core::dev::console::{Uart0Stub, VecSink as ConsoleVecSink};
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;
use wasm_vm_core::trace::{MemOp, TraceRecord, VecSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};

const LOOPS: &[u8] = include_bytes!("../../../guest/prebuilt/loops.elf");
const GOLDEN: &str = include_str!("../../../docs/golden/loops.trace.txt");

/// Run `loops.elf` in a machine, tracing into a VecSink, return the first 40 canonical
/// lines joined with `\n` (trailing newline included).
fn loops_trace_first_40() -> String {
    // Build a Machine but drive stepping manually so we can pass the sink.
    let mut m = Machine::new(64 * 1024);
    m.load_elf(LOOPS).unwrap();
    let mut sink = VecSink::new();
    // Step until we have >= 40 records or the guest exits.
    while sink.records.len() < 40 {
        // Machine owns the hart+bus; step_traced through the exposed accessors.
        if m.step_traced(&mut sink).is_err() {
            break;
        }
        if m.htif_exit().is_some() {
            break;
        }
    }
    let mut s = String::new();
    use core::fmt::Write as _;
    for r in sink.records.iter().take(40) {
        writeln!(s, "{}", fmt_canonical(r)).unwrap();
    }
    s
}

#[test]
fn loops_golden_trace_byte_for_byte() {
    let got = loops_trace_first_40();
    // cmp, not diff: exact bytes.
    assert_eq!(
        got, GOLDEN,
        "canonical trace drifted from the committed golden"
    );
}

/// Regenerate the committed golden after a deliberate format change:
///   cargo test -p wasm-vm-core --features trace --test trace_golden regen -- --ignored
#[test]
#[ignore = "regenerates docs/golden/loops.trace.txt"]
fn regen_golden() {
    let out =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/golden/loops.trace.txt");
    std::fs::write(out, loops_trace_first_40()).unwrap();
}

// ── format rules ────────────────────────────────────────────────────────────

#[test]
fn x0_write_omits_register_field() {
    // A retired op targeting x0 (e.g. `addi x0, x0, 5`) must emit no ` x0 ...` field.
    let r = TraceRecord {
        pc: DRAM_BASE,
        insn: 0x0052_8013,
        rd: None,
        mem: None,
    };
    assert_eq!(
        format!("{}", fmt_canonical(&r)),
        "core 0: 0x0000000080000000 (0x00528013)"
    );
}

#[test]
fn store_value_is_masked_to_width_hex_digits() {
    // sb of 0xABCD → single byte 0xcd, width-2 hex; sh → 4; sw → 8; sd → 16.
    let cases: &[(u8, u64, &str)] = &[
        (1, 0xABCD, "0xcd"),
        (2, 0xDEADBEEF, "0xbeef"),
        (4, 0x1122_3344_5566_7788, "0x55667788"),
        (8, 0x0123_4567_89AB_CDEF, "0x0123456789abcdef"),
    ];
    for &(len, value, expect) in cases {
        let r = TraceRecord {
            pc: 0x80000000,
            insn: 0,
            rd: None,
            mem: Some(MemOp {
                addr: 0x8000_1000,
                len,
                is_store: true,
                value,
            }),
        };
        let line = format!("{}", fmt_canonical(&r));
        assert!(
            line.ends_with(&format!(" mem 0x0000000080001000 {expect}")),
            "len {len}: got `{line}`"
        );
    }
}

#[test]
fn load_emits_rd_then_mem_no_value() {
    // A load: rd field THEN mem field (address only, no value).
    let r = TraceRecord {
        pc: 0x80000000,
        insn: 0,
        rd: Some((5, 0xFF)),
        mem: Some(MemOp {
            addr: 0x8000_1000,
            len: 1,
            is_store: false,
            value: 0,
        }),
    };
    assert_eq!(
        format!("{}", fmt_canonical(&r)),
        "core 0: 0x0000000080000000 (0x00000000) x5 0x00000000000000ff mem 0x0000000080001000"
    );
}

// ── observer property: tracing never perturbs ───────────────────────────────

#[test]
fn tracing_does_not_perturb_architectural_state() {
    // memops.elf run twice: trace-off (NullSink via Machine::run) and trace-on
    // (VecSink). Final register dump + console output must be identical.
    const MEMOPS: &[u8] = include_bytes!("../../../guest/prebuilt/memops.elf");

    // trace-off
    let mut m1 = Machine::new(64 * 1024);
    let s1 = ConsoleVecSink::new();
    m1.bus_mut()
        .attach(UART0_BASE, UART0_LEN, Box::new(Uart0Stub::new(s1.clone())))
        .unwrap();
    m1.load_elf(MEMOPS).unwrap();
    assert_eq!(m1.run(100_000), RunOutcome::Exited(0));
    let dump_off = format!("{}", m1.hart().regs);

    // trace-on
    let mut m2 = Machine::new(64 * 1024);
    let s2 = ConsoleVecSink::new();
    m2.bus_mut()
        .attach(UART0_BASE, UART0_LEN, Box::new(Uart0Stub::new(s2.clone())))
        .unwrap();
    m2.load_elf(MEMOPS).unwrap();
    let mut tsink = VecSink::new();
    loop {
        if m2.step_traced(&mut tsink).is_err() {
            break;
        }
        if m2.htif_exit().is_some() {
            break;
        }
    }
    let dump_on = format!("{}", m2.hart().regs);

    assert_eq!(dump_off, dump_on, "tracing perturbed the register file");
    assert_eq!(
        s1.captured(),
        s2.captured(),
        "tracing perturbed console output"
    );
    assert!(!tsink.records.is_empty(), "trace-on run recorded nothing");
}

#[test]
fn million_instruction_trace_completes() {
    // Trace a long-running self-loop into a VecSink; documents the ~40B/record cost.
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    bus.store32(DRAM_BASE, 0x0000_0013).unwrap(); // nop
    bus.store32(DRAM_BASE + 4, 0xFFDF_F06F).unwrap(); // jal x0, -4 (back to nop)
    let mut sink = VecSink::new();
    for _ in 0..1_000_000 {
        hart.step_traced(&mut bus, &mut sink).unwrap();
    }
    assert_eq!(sink.records.len(), 1_000_000);
}
