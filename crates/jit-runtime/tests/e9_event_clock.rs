//! Real Wasmtime blocks, exact event fences, timer boundaries and WFI continuation.
use jit_runtime::WasmtimeExecutor;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE as BASE};
use wasm_vm_core::csr::{CsrOp, MIE, MSTATUS, MTVEC};
use wasm_vm_core::session_clock::SessionEffect;
use wasm_vm_core::trace::{TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};
const DATA: u64 = BASE + 0x4000;
const HANDLER: u64 = BASE + 0x2000;
fn addi(rd: u32, rs: u32, value: i32) -> u32 {
    ((value as u32) << 20) | (rs << 15) | (rd << 7) | 0x13
}
fn jal(offset: i32) -> u32 {
    let o = offset as u32;
    ((o >> 20) & 1) << 31
        | ((o >> 1) & 0x3ff) << 21
        | ((o >> 11) & 1) << 20
        | ((o >> 12) & 0xff) << 12
        | 0x6f
}
fn csr(m: &mut Machine, a: u16, v: u64) {
    m.hart_mut()
        .csr
        .access(a, CsrOp::Write, v, false, false, 0)
        .unwrap();
}
fn board(jit: bool, deadline: u64) -> Machine {
    let mut m = Machine::new(1 << 20);
    for (i, word) in [
        addi(1, 1, 1),
        addi(2, 2, 3),
        addi(3, 3, 5),
        addi(4, 4, 7),
        addi(5, 5, 11),
        jal(-20),
    ]
    .into_iter()
    .enumerate()
    {
        m.bus_mut().store32(BASE + i as u64 * 4, word).unwrap();
    }
    m.hart_mut().regs.pc = BASE;
    m.enable_clint(3).borrow_mut().mtimecmp = deadline;
    m.bus_mut().store32(HANDLER, addi(10, 10, 1)).unwrap();
    m.bus_mut().store32(HANDLER + 4, jal(0)).unwrap();
    csr(&mut m, MTVEC, HANDLER);
    csr(&mut m, MIE, 1 << 7);
    csr(&mut m, MSTATUS, 1 << 3);
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    if jit {
        m.set_executor(Box::new(WasmtimeExecutor::new()));
        m.set_hotness_threshold(1);
        m.set_jit(true)
    }
    m.start_session_clock(1).unwrap();
    assert_eq!(m.run(384), RunOutcome::MaxInstrs);
    if jit {
        assert!(
            m.executor().unwrap().is_compiled(BASE),
            "real loop must be compiled before the attacked boundary"
        )
    }
    m
}
fn write(m: &mut Machine, at: u64, address: u64, bytes: &[u8]) {
    m.stage_session_effect(
        at,
        SessionEffect::WriteRam {
            address,
            bytes: bytes.to_vec(),
        },
    )
    .unwrap();
}
fn artifact(name: &str, bytes: impl AsRef<[u8]>) {
    if let Some(dir) = std::env::var_os("E9_CLOCK_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir);
        let dir = if dir.is_absolute() {
            dir
        } else {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../..")
                .join(dir)
        };
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), bytes).unwrap();
    }
}
#[derive(Default)]
struct Lines(String);
impl TraceSink for Lines {
    fn retire(&mut self, r: &TraceRecord) {
        use std::fmt::Write;
        writeln!(self.0, "{}", fmt_canonical(r)).unwrap();
    }
}
fn run_to(m: &mut Machine, target: u64, quantum: u64) {
    while m.session_position().unwrap().transition < target {
        assert_eq!(
            m.run_session_until(target, quantum),
            Ok(RunOutcome::MaxInstrs)
        )
    }
}
fn trace_to(m: &mut Machine, target: u64, quantum: u64, trace: &mut Lines) {
    while m.session_position().unwrap().transition < target {
        let remaining = target - m.session_position().unwrap().transition;
        assert_eq!(
            m.run_traced(quantum.min(remaining), trace),
            RunOutcome::MaxInstrs
        )
    }
}

#[test]
fn actual_compiled_blocks_stop_at_edges_and_inside_blocks_without_shifted_delivery() {
    for target in [600, 601, 605] {
        for quantum in [1, 5, 6, 7, 31, 512] {
            let mut plain = board(false, u64::MAX);
            let mut jit = board(true, u64::MAX);
            for m in [&mut plain, &mut jit] {
                write(m, target + 2, DATA + 1, &[33]);
                write(m, target, DATA, &[11]);
                write(m, target, DATA, &[22]);
            }
            let before = jit.executor().unwrap().executed_blocks();
            let mut trace = Lines::default();
            trace_to(&mut plain, target, quantum, &mut trace);
            run_to(&mut jit, target, quantum);
            assert_eq!(jit.session_position(), plain.session_position());
            assert_eq!(jit.session_pending_events(), 3);
            assert_eq!(jit.bus_mut().load8(DATA).unwrap(), 0);
            assert_eq!(
                jit.save_session_resume().unwrap(),
                plain.save_session_resume().unwrap(),
                "pre-delivery target={target} q={quantum}"
            );
            let compiled = jit.executor().unwrap().executed_blocks() - before;
            if quantum >= 6 {
                assert!(
                    compiled > 0,
                    "not a fake JIT or an interpreter-only fence: target={target} q={quantum}"
                )
            }
            assert_eq!(plain.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
            assert_eq!(jit.run(1), RunOutcome::MaxInstrs);
            let expected = plain.take_session_deliveries().unwrap();
            let actual = jit.take_session_deliveries().unwrap();
            assert_eq!(actual, expected);
            assert_eq!(
                actual
                    .iter()
                    .map(|d| (
                        d.position.transition,
                        d.position.ordinal,
                        d.position.sequence
                    ))
                    .collect::<Vec<_>>(),
                vec![(target, 1, 1), (target, 2, 2)]
            );
            assert_eq!(jit.bus_mut().load8(DATA).unwrap(), 22);
            run_to(&mut jit, target + 4, quantum);
            trace_to(&mut plain, target + 4, quantum, &mut trace);
            assert_eq!(
                jit.take_session_deliveries().unwrap(),
                plain.take_session_deliveries().unwrap()
            );
            let snapshot = jit.save_session_resume().unwrap();
            assert_eq!(snapshot, plain.save_session_resume().unwrap());
            artifact(&format!("jit-target-{target}-q{quantum}.resume"), snapshot);
            artifact(&format!("jit-target-{target}-q{quantum}.trace"), trace.0);
            println!(
                "target={target} quantum={quantum} real_compiled_blocks={compiled} position={:?} state={}",
                jit.session_position().unwrap(),
                jit.snapshot().hex_digest()
            );
        }
    }
}

#[test]
fn pending_event_itself_fences_jit_even_without_an_explicit_seek_stop() {
    for quantum in [1, 7, 128, 1024] {
        let mut plain = board(false, u64::MAX);
        let mut jit = board(true, u64::MAX);
        for m in [&mut plain, &mut jit] {
            write(m, 601, BASE + 4, &addi(2, 2, 19).to_le_bytes());
            write(m, 605, DATA, b"later");
        }
        let mut trace = Lines::default();
        trace_to(&mut plain, 1000, quantum, &mut trace);
        while jit.session_position().unwrap().transition < 1000 {
            let n = quantum.min(1000 - jit.session_position().unwrap().transition);
            assert_eq!(jit.run(n), RunOutcome::MaxInstrs)
        }
        let deliveries = jit.take_session_deliveries().unwrap();
        assert_eq!(deliveries, plain.take_session_deliveries().unwrap());
        assert_eq!(
            deliveries
                .iter()
                .map(|d| d.position.transition)
                .collect::<Vec<_>>(),
            vec![601, 605]
        );
        assert_eq!(
            jit.save_session_resume().unwrap(),
            plain.save_session_resume().unwrap()
        );
        assert!(jit.hart().regs.read(2) > plain.session_position().unwrap().transition / 2);
        artifact(
            &format!("jit-mailbox-q{quantum}.resume"),
            jit.save_session_resume().unwrap(),
        );
        artifact(&format!("jit-mailbox-q{quantum}.trace"), trace.0);
    }
}

#[test]
fn timer_deadline_inside_compiled_block_has_the_same_nonretiring_interrupt_position() {
    // deadline 197 * divider 3 = retirement 591, inside the six-instruction loop.
    for quantum in [1, 7, 31, 1024] {
        let mut plain = board(false, 197);
        let mut jit = board(true, 197);
        for m in [&mut plain, &mut jit] {
            write(m, 590, DATA, b"a");
            write(m, 591, DATA, b"b");
        }
        let mut trace = Lines::default();
        trace_to(&mut plain, 592, quantum, &mut trace);
        run_to(&mut jit, 592, quantum);
        assert_eq!(
            (
                jit.session_position().unwrap().transition,
                jit.session_position().unwrap().retired,
                jit.hart().regs.pc,
                jit.clint_mtime()
            ),
            (592, 591, HANDLER, 197)
        );
        assert_eq!(jit.irq_stats().int[7], 1);
        let deliveries = jit.take_session_deliveries().unwrap();
        assert_eq!(deliveries, plain.take_session_deliveries().unwrap());
        assert_eq!(deliveries[1].position.retired, 591);
        assert_eq!(
            jit.save_session_resume().unwrap(),
            plain.save_session_resume().unwrap()
        );
        artifact(
            &format!("jit-timer-q{quantum}.resume"),
            jit.save_session_resume().unwrap(),
        );
        artifact(&format!("jit-timer-q{quantum}.trace"), trace.0);
        println!(
            "timer q={quantum} exact_irq_transition=592 retired=591 real_jit_retired={}",
            jit.executor().unwrap().retired_via_jit()
        );
    }
}

#[test]
fn wfi_in_a_previously_compiled_loop_stops_before_idle_then_before_interrupt() {
    for quantum in [1, 7, 1024] {
        let mut plain = board(false, 1000);
        let mut jit = board(true, 1000);
        for m in [&mut plain, &mut jit] {
            write(m, 600, BASE, &0x10500073u32.to_le_bytes());
        }
        let mut trace = Lines::default();
        trace_to(&mut plain, 601, quantum, &mut trace);
        run_to(&mut jit, 601, quantum);
        assert_eq!(
            (
                jit.session_position().unwrap().transition,
                jit.session_position().unwrap().retired,
                jit.clint_mtime()
            ),
            (601, 601, 200)
        );
        assert_eq!(
            jit.take_session_deliveries().unwrap(),
            plain.take_session_deliveries().unwrap()
        );
        let keyframe = jit.save_session_resume().unwrap();
        assert_eq!(keyframe, plain.save_session_resume().unwrap());
        artifact(&format!("jit-wfi-before-idle-q{quantum}.resume"), &keyframe);
        // Reconstruct into a different compiled cache; native restore discards derived modules.
        let mut restored = board(true, 1000);
        restored.load_session_resume(&keyframe).unwrap();
        for target in [602, 603] {
            run_to(&mut jit, target, quantum);
            run_to(&mut restored, target, quantum);
            trace_to(&mut plain, target, quantum, &mut trace);
            assert_eq!(
                jit.save_session_resume().unwrap(),
                plain.save_session_resume().unwrap()
            );
            assert_eq!(
                restored.save_session_resume().unwrap(),
                plain.save_session_resume().unwrap()
            );
        }
        assert_eq!(
            (
                jit.session_position().unwrap().transition,
                jit.session_position().unwrap().retired,
                jit.clint_mtime(),
                jit.hart().regs.pc
            ),
            (603, 601, 1000, HANDLER)
        );
        artifact(
            &format!("jit-wfi-after-interrupt-q{quantum}.resume"),
            jit.save_session_resume().unwrap(),
        );
        artifact(&format!("jit-wfi-q{quantum}.trace"), trace.0);
    }
}
