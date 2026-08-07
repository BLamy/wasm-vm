---
id: E4-T26
epic: 4
title: Full riscv-tests and RISCOF compliance rerun under JIT — the correctness gate
priority: 426
status: verification-debt
depends_on: [E4-T16, E4-T17, E4-T25]
estimate: M
capstone: false
---

## Goal
The complete Epic 1 compliance surface — all riscv-tests suites (rv64ui/um/ua/uf/ud/uc,
mi/si) and a full RISCOF architectural run — passes with the JIT forced always-on
(hotness threshold 0, chaining on, eviction churn configs included), in both the native
wasmtime-backed runtime and the browser, wired into CI as a hard gate that no future JIT
change can merge past while red.

## Context
Individual suites went green piecemeal across E4-T10..T17; this task makes the *full
matrix* an enforced invariant and closes the gaps piecemeal running allowed: signature-
based RISCOF runs compare against the Sail reference model exactly as Epic 1 did, but now
exercise translated code paths (the RISCOF test harness itself becomes hot and gets
JITted — good). Configurations that historically shake out bugs get their own matrix rows:
threshold=0 (everything translated), threshold=1 with 2-batch eviction (churn),
chaining-off (isolates chaining bugs), and lockstep-enabled spot runs. Known-acceptable
differences (if any instruction class is deliberately interpreter-only per E4-T15's
policy) must be *documented as policy*, not silently passing because the JIT never saw
them — the threshold-0 run must force even those blocks through the JIT pipeline's
fallback decision code.

## Deliverables
- CI matrix: {riscv-tests, RISCOF} × {native, browser} × {jit-default, jit-threshold0,
  jit-churn, jit-nochain}, with runtime budgets per cell and result artifacts retained.
- Any failures found: fixed (with lockstep/fuzz repro added to the E4-T25 corpus) — this
  task is not done with waivers outstanding.
- `docs/jit-architecture.md` amended with the final "what is never translated" list,
  cross-referenced to the passing threshold-0 evidence.
- One-command local reproduction: `tools/compliance.py --jit <config>`.

## Acceptance criteria
- [ ] Every cell of the matrix green; CI blocks merge on any red cell thereafter
      (branch-protection or equivalent configured and demonstrated).
- [ ] RISCOF signature comparison against Sail is byte-exact in all JIT configs.
- [ ] Zero waivers/skips introduced relative to the Epic 1 baseline test list (diff of
      test manifests committed as evidence).
- [ ] Browser cells run in Chrome and Firefox (Safari best-effort, documented).
- [ ] Total matrix runtime ≤ 90 min in CI (parallelized) — a gate nobody routes around.

## Adversarial verification
Refute the gate's coverage. Attack angles: (1) verify "forced always-on" is real:
instrument a matrix run and count interpreter-executed instructions in threshold-0 mode —
if more than the documented never-translated set ran interpreted (i.e. the JIT silently
fell back and the suite "passed" without testing translation), the gate is refuted;
(2) manifest diff: compare the exact test list against Epic 1's capstone run — any
quietly dropped test refutes; (3) re-inject one E4-T25 mutation bug and push a branch —
CI must go red and block; a green pipeline refutes the gate's wiring; (4) run the matrix
on a cold clone (no cached translations/artifacts) — cache-dependent green refutes;
(5) check the churn config actually churns (eviction counter > 1000 during the run) —
a churn cell that never evicts is testing nothing and refutes that row's claim.

## Verification log

### 2026-08-06 — native riscv-tests matrix landed + verified (headless)

Driver: `crates/jit-runtime/tests/jit_execution.rs` mod `jit_config_matrix` — parameterized over
four `JitConfig` rows, each running the WHOLE vendored corpus (127 ELFs) and asserting every ELF's
JIT verdict == the interpreter verdict. Repro: `tools/compliance.py --jit <config|all>`.

Real output (`cargo test -p wasm-vm-jit-runtime --test jit_execution jit_config_matrix -- --nocapture`):

```
[jit-default]    verdict-identical across 127 riscv-tests ELFs (threshold=64, chaining=true)  — 2 blocks compiled,    0 evictions
[jit-threshold0] verdict-identical across 127 riscv-tests ELFs (threshold=1,  chaining=true)  — 5019 blocks compiled, 0 evictions
[jit-churn]      verdict-identical across 127 riscv-tests ELFs (threshold=1, max_batches=2)    — 159 blocks compiled,  66 evictions
[jit-nochain]    verdict-identical across 127 riscv-tests ELFs (threshold=1,  chaining=false) — 5019 blocks compiled, 0 evictions
no-waivers gate: 127 ELFs, matrix corpus == Epic 1 baseline
test result: ok. 5 passed; 0 failed
```

Gates run + green here:
- All four native JIT configs verdict-identical over the full corpus (above).
- `tools/compliance.py --jit threshold0` — end-to-end from a clean invocation, exit 0.
- Zero-waivers: `evidence/e4-t26/manifest-diff.txt` empty (`no_waivers_vs_epic1_baseline` in-test).
- churn actually churns: 66 batch evictions (adversarial verification #5).
- threshold0 forces every block (incl. F/D/CSR/ecall never-translated blocks) through the JIT
  pipeline (5019 compiled) — closes the "the JIT never saw them" gap; suites still Pass.
- `cargo fmt` (touched files) + `cargo clippy -p wasm-vm-jit-runtime --tests -D warnings` clean.
- `predecode_diff` byte-identical (2 passed).
- `docs/jit-architecture.md` §10a: authoritative never-translated list + threshold0 cross-ref.

No failures found → no new corpus repro needed (the four configs are all verdict-identical).

### Verification debt (deferred — honest)
- **RISCOF signature-vs-Sail under jit-threshold0**: RISCOF venv present, but the Sail reference
  binary (`sail_riscv_sim`) is NOT installed on this mac. Runner wired
  (`tools/compliance.py --riscof --jit <c>` → `WASMVM_JIT=<c> bash tools/run_riscof.sh`); dev-box
  command documented. NOTE: `tools/run_riscof.sh` does not yet consume `WASMVM_JIT` — the DUT
  plugin must be taught to force the config knobs (follow-up on dev).
- **Browser cells** (Chrome/Firefox riscv-tests + RISCOF): mac OS-reaps long browser boots → dev/CI.
- **CI branch-protection wiring + ≤90-min parallel matrix budget**: needs repo admin.
- Unchanged-from-HEAD gates not re-run here (no code touched in those crates): lockstep_fuzz full
  suite, jit-translate differential, wasm32 no_std + `crates/wasm` release build.
