---
id: E4-T21
epic: 4
title: JIT compilation off the hot path — compile queue, async installs, pause targets
priority: 421
status: partially-verified
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

### 2026-08-06 — partially-verified (headless gates green; booted-guest ACs deferred to dev)

**Built.** The compile pipeline now stages discovery's generation-tagged FIFO nominations into a new
priority compile queue (`crates/core/src/compile_queue.rs`, `CompileQueue`) before the install step:

- **Priority ordering** — the queue pops HOTTEST-first (hotness = `HOT_THRESHOLD` + executions
  accrued while the block waited, tracked by `BlockDiscovery::queued_hotness`). Deliverable 5.
- **Backpressure** — bounded (`DEFAULT_COMPILE_QUEUE_CAP = 256`, tunable) with a **drop-and-recount**
  policy: a full queue drops the colder of {coldest resident, newcomer}, records its phys for
  re-nomination, NEVER blocks execution. Deliverable 3 / adversarial #2.
- **Cancellation on generation bump** — `cancel_stale(live_gen)` drops jobs whose generation went
  stale (a cheap first line of defence); the authoritative refusal is still the per-block
  `install_check` (generation + live-bytes) the pump already ran. Deliverable 1 / adversarial #4.
- **Install-point hook + bounded install work** — `pump_jit_translations` pops ≤ `JIT_INSTALL_BUDGET`
  (64) blocks per boundary, so a compile storm spreads across boundaries instead of one long stall;
  leftovers stay queued with priority preserved. Install remains execution-thread-only (table + map).
- **Pause instrumentation** — `prof::pause::JitPauseStats` (max/mean/percentile ns, `over_5ms`
  counter, power-of-two histogram, plus the HEADLESS `max_install_blocks`/`max_install_bytes` work
  bound). Sampled every pump; wall-ns populated when a host timer is injected, work-bound always.
  Surfaced in `ProfReport` (`jit pause:` line). Deliverable 2.
- **Cold-vs-warm bench mode** — `tools/bench.py run coremark --mode {cold,warm}`; warm does an untimed
  warm-up pass in the same guest session to pre-populate the JIT cache before the measured pass.
  Wired + emitted in the JSON (`"mode"`); ledgered numbers are dev debt (below). Deliverable 4.

**Determinism argument.** No threads were added. The compile queue performs NO guest-observable work —
it only chooses the ORDER and SET of blocks handed to the executor for compilation, and which blocks
are compiled (or when) can never change the guest's architectural trace (a block runs byte-identically
in the interpreter or the JIT — the corpus invariant). Install still happens synchronously at a
dispatch-loop boundary on the execution thread, gated by the existing generation+bytes `install_check`,
so the native/oracle config replays reproducibly. True background-thread compile is deferred to E4-T22
(worker); the async PATH (queue / backpressure / priority / cancellation / stale-install) is fully
exercised by tests today via the model "enqueue now, install later, world may change in between".

**Gates run (all green, real output):**

- `cargo test -p wasm-vm-core --lib` → **164 passed** (incl. `compile_queue::tests` priority /
  backpressure-drop-and-recount / cancellation / no-block-under-flood, and `prof::pause` tests).
- NEW `cargo test -p wasm-vm-core --test async_compile_pipeline` → **2 passed**:
  `interpreter_progresses_while_compiler_stalled` (AC5 — stalled compiler, guest byte-identical to the
  interpreter, 0 blocks ran via JIT ⇒ execution never blocked) and
  `delayed_install_never_installs_stale_bytes` (AC4 model — SMC across the pump, byte-identical).
- AC4 against the REAL wasmtime executor: `cargo test -p wasm-vm-jit-runtime` → **ALL passed**
  (invalidation `11 passed` incl. fence.i/SMC/DMA races, eviction, chaining, precise_traps, batching,
  jit_execution). `predecode_diff` / `predecode_smc_diff` / `predecode_batching` byte-identical.
- Determinism / reproducibility: `riscv_tests_verdict_identical_with_jit` run **3×** → stable
  (`1 passed` each, ~50 s). `cargo test -p wasm-vm-jit-translate` → all passed.
- `cargo clippy -p wasm-vm-core --all-targets -- -D warnings` → exit 0; `cargo fmt --check` → exit 0;
  `cargo build -p wasm-vm-core --target wasm32-unknown-unknown` (no_std) → exit 0.

**Verification debt (deferred to dev — needs a booted-guest / browser-on-Linux harness; the mac
OS-reaps long browser + Alpine boots):**

- **AC1** p100 JIT-attributable exec-thread stall ≤ 5 ms over a full Alpine boot + gcc (instrumented
  histogram committed as evidence). Instrumentation (`JitPauseStats`, `over_5ms`, percentiles) is WIRED;
  the headless surrogate — `max_install_blocks ≤ JIT_INSTALL_BUDGET` — holds, but the booted wall-clock
  histogram is unrun (no fabricated numbers recorded).
- **AC2** typing echo < 50 ms during in-guest gcc with a cold cache (scripted keystroke-to-echo).
- **AC3** cold CoreMark ≥ 70 % warm — bench mode WIRED (`--mode cold|warm`); no numbers ledgered.
- **Adversarials** compile-storm echo-latency + rAF/heartbeat watchdog cross-check vs the self-reported
  pause histogram, and the E4-T17 SMC torture with a deliberately laggy (100 ms) compiler on a real
  booted guest — all need the booted harness and are deferred.
