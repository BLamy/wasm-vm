---
id: E1-T24
epic: 1
title: "Capstone: Level 1 threshold — riscv-tests and RISCOF green, native and WASM"
priority: 124
status: pending
depends_on: [E1-T13, E1-T14, E1-T18, E1-T20, E1-T21, E1-T22, E1-T23]
estimate: L
capstone: true
---

## Goal
The Level 1 exit gate from ROADMAP.md, demonstrated end-to-end from a cold start: the
complete RV64GC machine passes riscv-tests — rv64ui, rv64um, rv64ua, rv64uf, rv64ud,
rv64uc (both -p and -v variants), rv64mi, rv64si — AND a full RISCOF architectural
compliance run, in the native build and the wasm32 build, with zero allowlist/exclusion
entries. After this, a Linux misbehavior is never silently a CPU bug.

## Context
T19 built the riscv-tests wall and T20 the RISCOF flow, each tolerating a documented
allowlist during development. The capstone burns both allowlists to zero and freezes the
result as the epic's demonstrable threshold. Per tasks/README.md, a capstone must be
demonstrated from a cold start: fresh clone, fresh browser profile, no development
residue. The demo is one command plus one page: `tools/level1_gate.sh` runs native
riscv-tests, native RISCOF, the wasm riscv-tests job, and the wasm signature-equivalence
check, and writes a single consolidated report; a static page shows the wasm leg running
live in a browser tab (the ROADMAP's "in both native and WASM builds", made visible).

## Deliverables
- `tools/level1_gate.sh`: clean-tree check → provision pinned deps → run all four legs →
  emit `target/level1-report.md` with per-suite counts, RISCOF summary, git revs, and
  sha256 of the wasm artifact.
- Empty `tests/riscv-tests-allowlist.txt` and empty `compliance/EXCLUSIONS.md` (files
  present, zero entries) — with the T19/T20 CI diffs now enforcing emptiness.
- Browser demo page (`www/compliance.html`): loads the wasm module, runs the full
  riscv-tests set with a live per-test pass/fail table, finishing with a green/red
  verdict banner.
- CI: the gate script as a required workflow; README badge row for Level 1.
- A tagged release commit `level-1` once verified.

## Acceptance criteria
- [ ] From a fresh clone on a machine that has never built the project (recorded:
      host, OS, toolchain provisioning log), `tools/level1_gate.sh` exits 0.
- [ ] riscv-tests: every discovered test in rv64ui/um/ua/uf/ud/uc{-p,-v}, rv64mi-p,
      rv64si-p reports PASS in both native and wasm legs; discovered count matches the
      pinned upstream manifest count.
- [ ] RISCOF: 0 failed signature comparisons across I/M/A/F/D/C/Zicsr/Zifencei/privilege
      suites against the pinned Sail reference; exclusion file empty.
- [ ] wasm leg signatures byte-identical to native leg signatures (T22 machinery).
- [ ] `www/compliance.html` in a fresh browser profile (Chrome and Firefox) completes
      the suite with the green banner in ≤ 10 minutes on the recorded reference machine.
- [ ] The consolidated report is committed alongside the `level-1` tag and contains all
      pins (riscv-tests, riscv-arch-test, sail, toolchain shas).

## Adversarial verification
This is the epic gate — assume the implementer's environment is lying. Re-run the entire
gate from a fresh clone on a DIFFERENT machine and a fresh browser profile; any leg
failing refutes. Verify the wasm leg is real: hash the wasm artifact the browser fetched
(DevTools network tab) against the report's sha256, and mutate one instruction
implementation to confirm both native AND wasm legs go red independently (a wasm leg
that proxies native results would only redden once). Verify count integrity:
independently enumerate the pinned riscv-tests and riscv-arch-test suites and match the
report's discovered counts — missing tests refute. Verify allowlist emptiness in the
enforcing CI code, not just the files (a runner flag skipping the diff refutes). Spot-
audit five RISCOF signatures by hand against Sail logs. Then go beyond the gate: run the
T21 fuzzer for a fresh 100M-instruction nightly against this exact rev — a new divergence
does not automatically refute the capstone (the gate is the suites), but any divergence
traced to a spec violation of a suite-tested behavior does. Finally, kill the browser tab
mid-run and reload: the demo must restart cleanly (no wedged state), else the cold-start
claim is refuted.

## Verification log
(empty)
