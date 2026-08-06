# Perf-regression runner setup (E4-T27)

The performance gate (`tools/bench_ci.py`) turns benchmarks into a merge-blocking invariant.
Its trustworthiness depends on a **low-noise, pinned runner**. This is the operational recipe;
provisioning the box is CI-admin / dev debt (see the ticket's Verification debt).

## Why a dedicated runner

Shared GitHub-hosted runners are co-tenanted and thermally variable — exactly the conditions
that produce false perf failures. The gate mitigates noise in software (interleaved A/B ratios,
median-of-5 + MAD outlier rejection, two-tier bands), but the *last* mile — demonstrating **10
consecutive no-op runs with zero false fails** (AC2) and **<1 spurious hard-fail across 25 runs
in a day** (adversarial #2) — can only be shown on the actual runner class. Do not claim those
ACs green on a shared mac; this repo's mac also OS-reaps multi-minute boots (see the E3 memory).

## Runner class

- Label the runner `[self-hosted, perf-runner]` (matches `.github/workflows/perf-regression.yml`).
- Dedicated physical box or a pinned isolated VM — **not** shared with other CI.
- Pin CPU frequency governor to `performance`; disable turbo/boost for repeatability
  (`cpupower frequency-set -g performance`; `echo 1 > /sys/devices/system/cpu/intel_pstate/no_turbo`).
- Pin the process to isolated cores (`taskset`/`cset shield`); no other tenants on those cores.
- Capture provenance every run: `uname -a`, `rustc --version`, and the browser version.

## Warmup

- One untimed warmup boot before the measured series (drops cold-cache first-run outliers).
- The A/B runner already interleaves baseline/candidate so slow thermal drift hits both arms
  equally; still, let the box idle to a steady thermal state before the job.

## Browser benches (pinned headless Chromium)

- Browser metrics (`mmio_*`, `echo_latency_*`, `keystroke_*`) are **advisory** in
  `bench/thresholds.toml` until this is stood up — they warn, never fail the build.
- Pin the exact Chromium build (e.g. via `@sitespeed.io/browsertime` or a vendored revision),
  record `chromium --version` into the run artifact, and only then flip their `gate` to
  `gating` in `thresholds.toml`.

## Local / offline invocation

```
# gate logic (no benchmark run — pure math, always available):
python3 tools/bench_ci.py selftest

# evaluate recorded/synthetic samples against thresholds (CI gate contract, exit 1 = hard fail):
python3 tools/bench_ci.py evaluate --candidate samples.json

# live interleaved A/B (needs the runner + built release wasm-vm):
python3 tools/bench_ci.py run --baseline-commit <ref> --metrics coremark,dhrystone,boot --pairs 5

# promote a new rolling-best baseline (requires a rationale; no silent ratchet-down):
python3 tools/bench.py bless coremark --score <s> --rationale "<why>"

# trend dashboard from the ledger (one command):
python3 tools/bench_ci.py trend --out bench/trend.html
```
