//! E0-T24: interpreter instructions-per-second baseline (native, criterion).
//!
//! Workload: `loops.elf`, whose retired-instruction count was goldened in E0-T14 (48).
//! MIPS = retired / wall time. Each iteration RELOADS the ELF (a clean reset: segments +
//! bss-zero + pc=entry + HTIF re-armed) and runs it to HTIF exit — so the retired count is
//! exactly the golden every iteration (asserted below, not assumed). `Throughput::Elements`
//! makes criterion report **instructions/second** directly.
//!
//! Three benches isolate the E0-T15 zero-cost claim: trace-off (`run`), trace-on with the
//! empty `NullSink`, and trace-on with a recording `VecSink`. The first two must be within
//! ~2% (the zero-cost proof, measured); the third shows the real cost of recording.

use criterion::{Criterion, Throughput, black_box, criterion_group, criterion_main};
use wasm_vm_core::trace::{NullSink, VecSink};
use wasm_vm_core::{Machine, RunOutcome};

const LOOPS: &[u8] = include_bytes!("../../../guest/prebuilt/loops.elf");
/// E0-T14 golden retired-instruction count for loops.elf.
const GOLDEN_RETIRED: u64 = 48;
const RAM_BYTES: usize = 1024 * 1024; // loops runs in 1 MiB; small keeps reset cheap
const BUDGET: u64 = 1000; // > 48, so the guest always reaches HTIF exit

/// Count retired instructions of one loops run — used once per bench to VERIFY the
/// workload size equals the golden (acceptance criterion 2).
fn verify_retired(m: &mut Machine) {
    struct Count(u64);
    impl wasm_vm_core::trace::TraceSink for Count {
        fn retire(&mut self, _: &wasm_vm_core::trace::TraceRecord) {
            self.0 += 1;
        }
    }
    m.load_elf(LOOPS).unwrap();
    let mut c = Count(0);
    let outcome = m.run_traced(BUDGET, &mut c);
    assert_eq!(outcome, RunOutcome::Exited(0), "loops must exit cleanly");
    assert_eq!(
        c.0, GOLDEN_RETIRED,
        "workload retired {} != golden {GOLDEN_RETIRED} — the MIPS denominator is wrong",
        c.0
    );
}

fn bench_interp(c: &mut Criterion) {
    let mut group = c.benchmark_group("interp/loops");
    // Report throughput as instructions/second (Kelem/s in criterion's output).
    group.throughput(Throughput::Elements(GOLDEN_RETIRED));

    let mut machine = Machine::new(RAM_BYTES);
    verify_retired(&mut machine); // fail loudly if the golden count drifts

    // trace-off: the production `run` path (NullSink monomorphized away).
    group.bench_function("trace_off", |b| {
        b.iter(|| {
            machine.load_elf(LOOPS).unwrap();
            let outcome = machine.run(BUDGET);
            // Consume the result so the run cannot be optimized away (dead-code attack).
            black_box(outcome);
            black_box(machine.hart().regs.pc);
        });
    });

    // trace-on with the empty NullSink: must match trace_off within ~2% (zero-cost).
    group.bench_function("trace_on_nullsink", |b| {
        b.iter(|| {
            machine.load_elf(LOOPS).unwrap();
            let outcome = machine.run_traced(BUDGET, &mut NullSink);
            black_box(outcome);
            black_box(machine.hart().regs.pc);
        });
    });

    // trace-on with a recording VecSink: the real cost of capturing every record.
    group.bench_function("trace_on_vecsink", |b| {
        b.iter(|| {
            machine.load_elf(LOOPS).unwrap();
            let mut sink = VecSink::new();
            let outcome = machine.run_traced(BUDGET, &mut sink);
            black_box(outcome);
            black_box(sink.records.len());
            black_box(machine.hart().regs.pc);
        });
    });

    group.finish();
}

criterion_group!(benches, bench_interp);
criterion_main!(benches);
