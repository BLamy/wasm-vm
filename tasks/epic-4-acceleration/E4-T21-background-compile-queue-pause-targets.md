---
id: E4-T21
epic: 4
title: JIT compilation off the hot path — compile queue, async installs, pause targets
priority: 421
status: pending
depends_on: [E4-T20]
estimate: M
capstone: false
---

## Goal
Translation work never stalls guest execution perceptibly: hot-block nominations flow to a
compiler running off the execution path (async task now; a dedicated compile worker once
E4-T22 lands, exploiting that `WebAssembly.Module` is postMessage-transferable), execution
continues in the interpreter until installation, and the system meets a hard pause-time
target — no single JIT-attributable stall of the execution thread > 5 ms — verified by
instrumentation, not vibes.

## Context
Interactive latency is a capstone requirement in spirit: "gcc at interactive speed" is
worthless if keystrokes hitch while the JIT compiles gcc's 40k blocks. The pipeline:
nomination queue (E4-T08, generation-tagged) → batch former (E4-T19 grouping) → translate
(`jit-translate`, pure Rust, chunkable) → `WebAssembly.compile` (async, engine-parallel) →
install (cheap: table writes + map insert, done on the execution thread between blocks).
Only the install step may touch execution-thread state; translate/compile must be
interruptible or chunked so even the pre-worker configuration meets targets. Warm-up
policy: bulk-nominate at boot? No — measure a "cold CoreMark" (first run, includes all
compile stalls) vs "warm CoreMark" and keep the gap honest. Stale-install protection
(bytes-match + generation, E4-T08/T16) is what makes async-with-delay safe.

## Deliverables
- Compile pipeline with bounded queue, batch former, async compile, install-point hook in
  the dispatch loop; cancellation on generation bump.
- Pause instrumentation: max/percentile execution-thread stall attributable to JIT
  (translate, compile-await, install), sampled continuously into ProfStats.
- Backpressure: queue-full policy (drop-and-recount, never block execution).
- Cold-vs-warm benchmark mode in `tools/bench.py` (fresh VM per run vs pre-warmed),
  both ledgered.
- Priority ordering: hotter blocks compile first (heap by counter at dequeue).

## Acceptance criteria
- [ ] p100 JIT-attributable execution-thread stall ≤ 5 ms over a full Alpine boot + gcc
      run (instrumented histogram committed as evidence).
- [ ] Typing echo in the xterm.js console remains < 50 ms while gcc compiles in-guest
      with an empty translation cache (scripted keystroke-to-echo measurement).
- [ ] Cold CoreMark ≥ 70% of warm CoreMark (compile pipeline keeps up with a hot loop).
- [ ] Zero stale installs across the E4-T16 fence.i race test rerun against the async
      pipeline (generation checks hold under real asynchrony).
- [ ] Interpreter-until-installed verified: no execution ever blocks awaiting a compile
      (asserted by construction + a test that stalls the compiler and watches progress).

## Adversarial verification
Refute the latency claims with hostile workloads. Attack angles: (1) compile storm — exec
a fresh huge binary (gcc cold, python3 cold) while scripted keystrokes measure echo
latency at 20 Hz; any echo > 50 ms attributable to JIT (correlate with pause histogram)
refutes; (2) starve the pipeline: throttle compile artificially (10x slow flag) and
confirm the guest still makes progress and stats show queue backpressure, not deadlock;
(3) instrumentation honesty: add an independent watchdog (rAF-gap or worker-heartbeat
measurement) and compare against the self-reported pause histogram — self-reports missing
stalls the watchdog sees refutes the instrumentation, and thereby the acceptance evidence;
(4) generation race at scale: run the SMC torture suite (E4-T17) with the async pipeline
and a deliberately laggy compiler (install delay 100 ms) — stale code executing refutes;
(5) check priority: verify via stats that the CoreMark inner loop compiles before cold
periphery when both are queued (priority inversion = refutation of the ordering claim).

## Verification log
(empty)
