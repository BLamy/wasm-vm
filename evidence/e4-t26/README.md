# E4-T26 — riscv-tests compliance rerun under JIT (native matrix)

The full Epic 1 riscv-tests corpus (127 ELFs: rv64ui/um/ua/uf/ud/uc + rv64mi) must reach a
verdict **byte/verdict-identical to the interpreter** under FOUR distinct JIT configurations.
Driver: `crates/jit-runtime/tests/jit_execution.rs` mod `jit_config_matrix`. One-command local
repro: `tools/compliance.py --jit <config|all>`.

## Per-config pass counts (real output, `cargo test ... jit_config_matrix -- --nocapture`)

```
[jit-default]    verdict-identical across 127 riscv-tests ELFs (threshold=64, cache_capacity=None,  max_batches=None,    chaining=true)  — 2 blocks compiled,    0 batch evictions
[jit-threshold0] verdict-identical across 127 riscv-tests ELFs (threshold=1,  cache_capacity=None,  max_batches=None,    chaining=true)  — 5019 blocks compiled, 0 batch evictions
[jit-churn]      verdict-identical across 127 riscv-tests ELFs (threshold=1,  cache_capacity=Some(1), max_batches=Some(2), chaining=true)  — 159 blocks compiled,  66 batch evictions
[jit-nochain]    verdict-identical across 127 riscv-tests ELFs (threshold=1,  cache_capacity=None,  max_batches=None,    chaining=false) — 5019 blocks compiled, 0 batch evictions
no-waivers gate: 127 ELFs, matrix corpus == Epic 1 baseline
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured
```

- **jit-threshold0** compiles 5019 blocks: every block (incl. the never-translated F/D/CSR/ecall
  blocks) is driven through the JIT pipeline's translate + fallback-decision code, and the suites
  still pass identically — closing the "the JIT never saw them" gap.
- **jit-churn** evicts **66 batches** during the run (BatchLru, max_batches=2) — the eviction path
  is genuinely exercised (adversarial verification #5: the churn row actually churns).

## Zero-waivers gate

- `epic1-baseline-manifest.txt` — the Epic 1 baseline test list (the vendored corpus; E1-T29
  allowlist is EMPTY).
- `jit-matrix-manifest.txt` — the exact ELF set the JIT-config matrix runs.
- `manifest-diff.txt` — **empty** (`diff` rc=0): zero tests dropped relative to the Epic 1 baseline.
  Enforced in-test by `jit_config_matrix::no_waivers_vs_epic1_baseline`.

## Verification debt (deferred to the dev box / CI)

- **RISCOF signature-vs-Sail architectural run under jit-threshold0** — the RISCOF venv is present
  (`compliance/.venv/bin/riscof`) but the Sail reference-model binary (`sail_riscv_sim`) is **not
  installed on this host**, so no signature comparison can run here. Dev-box command wired in
  `tools/compliance.py --riscof --jit <config>` → `WASMVM_JIT=<config> bash tools/run_riscof.sh`.
  (Note: `tools/run_riscof.sh` currently does not yet read `WASMVM_JIT`; the DUT plugin must be
  taught to force the config knobs — tracked below.)
- **Browser cells** (Chrome/Firefox riscv-tests + RISCOF) — the mac OS-reaps long browser boots;
  run on the Linux dev box / CI.
- **CI branch-protection wiring + ≤90-min parallel matrix budget** — needs repo admin.
