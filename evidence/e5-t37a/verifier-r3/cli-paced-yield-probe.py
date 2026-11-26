#!/usr/bin/env python3
"""E5-T37a round-3 verifier — scratch instrumentation of the native CLI's run loop.

NOT part of the product and never committed applied: `apply` edits crates/cli/src/boot.rs in
place, `revert` restores it with `git checkout` and re-touches it. With no WVM_R3_* variable set
the patched binary behaves exactly like the unpatched one.

What it adds to `run_machine` (the loop that calls `Machine::run_traced` one quantum at a time):

  WVM_R3_PACED_STEP_NS=<ns>   select the paced ICount clock on a host clock that starts at 1 s and
                              advances <ns> per READING (deterministic: two runs that consult it
                              at the same points see the same times);
  WVM_R3_YIELD=1              select the idle yield (`set_paced_idle_policy(true, lag)`); without
                              it the policy is `(false, lag)`;
  WVM_R3_LAG_NS=<ns>          the busy-lag bound for either;
  WVM_R3_STOP_RETIRED=<n>     stop exactly after the n-th retirement counted from the start of the
                              loop (quanta while more than one quantum is left, then one work slot
                              at a time), so a run whose calls return early and one whose calls do
                              not stop at the same guest instruction.

After every call it asks `take_idle_wait_nanos()` (immediately, before the loop's own host work)
and at the end prints one `r3-probe:` line: calls, reported waits, their sum, retirements, wfis,
host-clock readings, interrupts taken, turbo entries.
"""
import subprocess
import sys

PATH = "crates/cli/src/boot.rs"

EDITS = [
    (
        """    let mut profiler = profiler;
    let mut total = 0u64;
    loop {
        if total >= a.max_instrs {
            return RunOutcome::MaxInstrs;
        }
        let step = a.quantum.min(a.max_instrs - total);
        let o = m.run_traced(step, sink);
""",
        """    let mut profiler = profiler;
    let mut total = 0u64;
    // ── E5-T37a round-3 verifier probe (scratch patch) ──
    let r3_env = |k: &str| std::env::var(k).ok().and_then(|v| v.parse::<u64>().ok());
    let r3_on = r3_env("WVM_R3_PACED_STEP_NS").is_some();
    let r3_start = m.irq_stats().retired;
    let r3_stop = r3_env("WVM_R3_STOP_RETIRED").map(|n| r3_start + n);
    let (mut r3_calls, mut r3_yields, mut r3_wait_ns) = (0u64, 0u64, 0u128);
    let r3_reads = Rc::new(Cell::new(0u64));
    if let Some(step) = r3_env("WVM_R3_PACED_STEP_NS") {
        struct R3Step(Cell<u64>, u64, Rc<Cell<u64>>);
        impl wasm_vm_core::time::MonotonicClock for R3Step {
            fn now_nanos(&self) -> u64 {
                self.2.set(self.2.get() + 1);
                let now = self.0.get();
                self.0.set(now + self.1);
                now
            }
        }
        m.set_paced_icount_clock(Box::new(R3Step(
            Cell::new(1_000_000_000),
            step,
            Rc::clone(&r3_reads),
        )))
        .expect("r3 probe: paced clock");
        m.set_paced_idle_policy(std::env::var("WVM_R3_YIELD").is_ok(), r3_env("WVM_R3_LAG_NS"));
    }
    let r3_report = |m: &Machine, calls: u64, yields: u64, wait_ns: u128, reads: u64| {
        if r3_on {
            eprintln!(
                "r3-probe: calls={calls} yields={yields} reported_wait_ms={} retired={} wfi={} \\
                 host_reads={reads} interrupts={} turbo_entries={}",
                wait_ns / 1_000_000,
                m.irq_stats().retired - r3_start,
                m.irq_stats().wfi,
                m.irq_stats().int.iter().sum::<u64>(),
                m.turbo_stats().entries,
            );
        }
    };
    loop {
        if total >= a.max_instrs {
            r3_report(m, r3_calls, r3_yields, r3_wait_ns, r3_reads.get());
            return RunOutcome::MaxInstrs;
        }
        let mut step = a.quantum.min(a.max_instrs - total);
        if let Some(stop) = r3_stop {
            let left = stop.saturating_sub(m.irq_stats().retired);
            if left == 0 {
                r3_report(m, r3_calls, r3_yields, r3_wait_ns, r3_reads.get());
                return RunOutcome::MaxInstrs;
            }
            step = if left > a.quantum { a.quantum } else { 1 };
        }
        let o = m.run_traced(step, sink);
        r3_calls += 1;
        if let Some(ns) = m.take_idle_wait_nanos() {
            r3_yields += 1;
            r3_wait_ns += u128::from(ns);
        }
""",
    ),
    (
        """        match o {
            RunOutcome::MaxInstrs => total += step,
            other => return other,
        }
    }
}

/// Spawn a thread that reads host stdin in chunks""",
        """        match o {
            RunOutcome::MaxInstrs => {
                if r3_stop.is_none() {
                    total += step;
                }
            }
            other => {
                r3_report(m, r3_calls, r3_yields, r3_wait_ns, r3_reads.get());
                return other;
            }
        }
    }
}

/// Spawn a thread that reads host stdin in chunks""",
    ),
]


def main() -> None:
    if sys.argv[1:] == ["revert"]:
        subprocess.run(["git", "checkout", "--", PATH], check=True)
        subprocess.run(["touch", PATH], check=True)
        return
    assert sys.argv[1:] == ["apply"], "usage: cli-paced-yield-probe.py apply|revert"
    src = open(PATH).read()
    for old, new in EDITS:
        assert src.count(old) == 1, old[:60]
        src = src.replace(old, new)
    open(PATH, "w").write(src)


if __name__ == "__main__":
    main()
