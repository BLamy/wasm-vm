---
id: E0-T19
epic: 0
title: Run the riscv-tests rv64ui-p suite as a smoke gate with quarantined Zicsr stubs
priority: 19
status: pending
depends_on: [E0-T18, E0-T13]
estimate: M
capstone: false
---

## Goal
The official `riscv-software-src/riscv-tests` rv64ui-p binaries (the RV64I user-level
tests, physical-memory "p" environment) run green under `wasm-vm-cli` and as a `cargo
test` harness — our first externally-authored correctness evidence, ahead of the full
compliance push in Epic 1.

## Context
The p environment's startup code (`riscv-test-env/p/riscv_test.h`) touches machine-mode
CSRs (`mhartid`, `mstatus`, `mtvec`, `medeleg`, `mideleg`, `satp`, `pmpaddr0`,
`pmpcfg0`, `mepc`) and drops into the test via `mret`. Level 0 has no privilege
architecture, so this task adds an explicitly quarantined `zicsr_stub` module (cargo
feature `zicsr-stub`): CSRRW/CSRRS/CSRRC and immediate forms over a plain u64 CSR map
(`mhartid` reads 0), plus `MRET` executed as `pc ← mepc`. The module is throwaway
scaffolding — Epic 1 replaces it with the real CSR file; the feature gate keeps it out of
default builds and out of the E0-T20 trace configuration. Pass/fail per HTIF: `tohost = 1`
pass; `(n << 1) | 1` identifies failing test case `n`.

## Deliverables
- riscv-tests pinned (git submodule or fetched tarball at a SHA recorded in
  `versions.env`) and built in the T13 container via `tools/riscv-tests/build.sh`;
  resulting `rv64ui-p-*` ELFs cached under `tests/riscv-tests-bin/` (committed or
  fetch-on-demand — decide and document).
- `crates/core/src/zicsr_stub.rs` behind `feature = "zicsr-stub"`, with a module-level
  doc comment declaring its deletion in Epic 1.
- Test harness `crates/cli/tests/riscv_tests.rs`: iterates every `rv64ui-p-*` binary,
  runs with the stub feature, asserts `Exited(0)`; a wasm-side harness running the same
  ELFs via `include_bytes!` under `wasm-pack test --node`.
- `make test-riscv` entry point.

## Acceptance criteria
- [ ] Every `rv64ui-p-*` test passes natively **except** an explicit, justified skip list
      (expected: `rv64ui-p-fence_i` — Zifencei; each skip documented in the harness).
- [ ] The same set passes under `wasm-pack test --node`.
- [ ] A failing test reports its riscv-tests case number (decoded from tohost) in the
      assertion message.
- [ ] Default builds (`--no-default-features`, default features) contain no `zicsr_stub`
      symbols (checked via the E0-T15 zero-cost script or `nm`).
- [ ] The riscv-tests SHA is pinned and the build is reproducible in the container.

## Adversarial verification
(1) Mutation test — the heart of this gate: introduce three seeded bugs one at a time
(SRA→SRL swap, B-type imm bit-11 misplacement, LWU sign-extending) and run the suite;
any mutant that stays green refutes the suite's sensitivity and must be recorded.
(2) Run the *entire* rv64ui-p set including skips and diff the observed pass/fail list
against the task's skip list — an undocumented failure refutes. (3) Check the stub can't
mask CPU bugs: confirm `mret` in the stub doesn't paper over a wrong trap cause by
inspecting one test's trace around the env's trap-vector setup. (4) Rebuild the test
binaries from the pinned SHA and `cmp` against the cached ones. (5) Run one test with
`--trace` and confirm the stub's CSR instructions appear retired (they execute, not
skipped) — silently skipping instructions would desync future differential traces.

## Verification log
(empty)
