---
id: E4-T29
epic: 4
title: Wire the JIT runtime into the runnable VM — native CLI executor + browser executor
priority: 428
status: in-progress
depends_on: [E4-T10, E4-T19, E4-T20, E4-T21, E4-T22, E4-T23]
estimate: L
capstone: false
---

## Goal
The verified JIT stops being dark-shipped and actually drives the VM. `Machine::set_executor`
— today called **only** in `jit-runtime` tests — is invoked from the real boot paths so a
booted guest executes translated blocks: **native** via the wasmtime-backed `WasmtimeExecutor`
behind a CLI flag (interpreter stays the default oracle), and **in-browser** via an in-wasm
executor driven from the E4-T22 CPU worker. This is the missing link between "JIT proven
correct as a component" (E4-T05..T27) and "JIT makes the product fast" (E4-T28 capstone): it
is the prerequisite that turns every deferred CoreMark/gcc *uplift* number and the ≥10×
capstone from unmeasurable into measurable.

## Context
Discovered during Epic-4 validation: the entire JIT is differentially verified (verdict-
identical against the interpreter across the riscv-tests corpus, the lockstep/fuzz rig, and
100k-block differential harnesses) but **no production code attaches an executor**. `crates/cli`
has no `jit-runtime` dependency and no `--jit` flag; `crates/wasm` (browser) has no executor;
`set_executor` has zero non-test callers. The run loop hook (`run_traced_inner` →
`try_jit_block`, E4-T10) is already present and is a no-op whenever the executor is `None`, so
wiring is additive and cannot regress the interpreter path.

Two backends, deliberately different:
- **Native (`WasmtimeExecutor`, E4-T10):** links wasmtime; heavy but already the reference
  executor used in every JIT test. Native carries the *measurement* weight (low-variance dev
  box) and is the immediate unblock for T18–T21 perf debt. It must be **opt-in** (`--jit`) with
  the interpreter as the default so the deterministic oracle, the differential harnesses, and
  reproducible boot-instruction counts are untouched when the flag is off.
- **Browser (in-wasm executor):** the real capstone path — hot blocks compiled to
  `WebAssembly.Module`s and executed via the E4-T18 funcref-table / E4-T19 batch protocol,
  driven from the E4-T22 worker, honoring the E4-T23 device-proxy + E4-T24 timekeeping
  contracts. This is a *new subsystem* the capstone (T28) wrongly assumed already existed.

Determinism/coherence guardrails already built and relied on here: physical-PC keying +
`has_code`/page-granular SMC (E4-T16/T17), generation + bytes `install_check` (E4-T08/T16),
eviction obligations (E4-T20), async-install safety (E4-T21), ICount for lockstep (E4-T24).

## Deliverables
- **Native:** `crates/cli` depends on `jit-runtime`; a `--jit` flag (default off) constructs a
  `WasmtimeExecutor` and calls `Machine::set_executor` in the boot path (`crates/cli/src/boot.rs`).
  `--jit` surfaced through `tools/bench.py` / `tools/boot-alpine.sh` so benchmarks can select it.
- **Browser:** an in-wasm `CompiledBlockExecutor` in `crates/wasm` (or a sibling), wired into the
  E4-T22 worker so a booted browser guest runs translated blocks; UA/isolation-gated with a
  clean interpreter fallback (reuse E4-T22 `selectCpuBackend`).
- **Boot integration proof:** Alpine boots to login with `--jit` (native) and in-browser JIT,
  verdict-/behavior-identical to the interpreter boot; JIT stats (blocks compiled, chain/batch,
  evictions, pause p100) exposed from a real boot.
- **Docs:** `docs/jit-architecture.md` amended with the integration/lifecycle (executor
  construction, flag/probe, teardown) and the "default = interpreter oracle" contract.

## Acceptance criteria
- [ ] `--jit` native boot: unmodified Alpine boots to `login:` with the JIT active (stats show
      >0 blocks compiled and >0 chained), architecturally identical to the interpreter boot
      (same login reached; retired-instruction path consistent modulo documented JIT effects).
- [ ] Interpreter remains the default with `--jit` OFF: determinism, `predecode_diff`, the
      differential harnesses, and boot-instruction anchors are byte-identical to pre-T29 HEAD.
- [ ] Native JIT CoreMark on the dev box records a **real** ledger entry and shows measurable
      uplift over the `level3-interpreter` baseline (number recorded, not asserted ≥10× — that
      threshold is the T28 capstone's job).
- [ ] Browser JIT: a booted browser guest executes translated blocks (stats visible in the
      overlay/console), with a clean interpreter fallback when `crossOriginIsolated` is false.
- [ ] Full riscv-tests verdict-identical with the *integrated* native executor (not just the
      test harness) — reuses E4-T26's matrix driven through the CLI path.
- [ ] No new `clippy -D warnings` / `fmt` violations; `crates/wasm` release build stays green.

## Adversarial verification
Refute that integration is real and safe. (1) **Flag-off inertness:** diff every determinism/
differential/boot-anchor gate at `--jit` off against pre-T29 HEAD — any change refutes "additive,
interpreter untouched." (2) **On-path correctness:** run a real workload (CoreMark, then a paging
guest) under `--jit` and lockstep/spot-check against the interpreter — a divergence is a genuine
JIT-in-anger bug (add the repro to the E4-T25 corpus). (3) **Self-modifying guest under JIT:**
boot a guest whose userspace writes code (the E4-T28 V8/FENCE.I case in miniature) and confirm no
stale-block execution (E4-T16/T17 hold end-to-end, not just in unit tests). (4) **Browser fallback
honesty:** load without COOP/COEP and confirm the interpreter fallback engages cleanly (no half-
initialized executor). (5) **Measurement integrity:** confirm the recorded uplift is the JIT, not
noise — interpreter vs `--jit` A/B on the same dev box, ratios reported (ties into E4-T27).

## Verification log
(empty)
