---
id: E0-T19
epic: 0
title: Run the riscv-tests rv64ui-p suite as a smoke gate with quarantined Zicsr stubs
priority: 19
status: implemented
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
### 2026-07-03 — worker claim — branch task/e0-t19-riscv-tests (stacked on e0-t18)
Deliverables: the official riscv-tests rv64ui-p suite runs green under a cargo harness.
- PINNED: tools/toolchain/versions.env gains RISCV_TESTS_SHA=34e6b6d1… + RISCV_TEST_ENV_SHA=
  6de71edb…. tools/riscv-tests/build.sh clones both at those exact SHAs IN THE T13 CONTAINER
  and compiles every isa/rv64ui/*.S against env/p, writing rv64ui-p-* ELFs to
  tests/riscv-tests-bin/ (COMMITTED — 54 ELFs, 716K — so the cargo harness needs NO Docker;
  documented in build.sh header). -march=rv64i_zicsr_zifencei so the p-env's CSR startup +
  fence_i assemble; the emulator still runs pure rv64i + the quarantined stub.
- REPRODUCIBLE: two-step compile-to-fixed-input.o then link (a one-step build leaks the random
  temp .o name into .strtab — same E0-T14 pitfall), + -ffile-prefix-map, -frandom-seed=rv64ui-
  <name>, -Wl,--build-id=none, SOURCE_DATE_EPOCH=0. Verified: two clean rebuilds are BYTE-
  IDENTICAL (shasum of all ELFs matches; .strtab has no temp-.o name).
- STUB: crates/core/src/zicsr_stub.rs behind feature=zicsr-stub, module doc declares deletion in
  Epic 1. CsrFile (flat u64 map, mhartid reads 0), execute() handles CSRRW/S/C + immediate forms
  (rd←OLD csr, set/clear with x0 source is a no-write) and MRET (pc←mepc) / WFI (nop). Hooks in at
  the ONE point the base decoder returns Err(IllegalInstr) for CSR/xRET, only under the feature —
  default builds are byte-for-byte unchanged. Executed CSR ops RETIRE and are traced (not skipped).
  Hart gains a cfg-gated csrs field.
- COMPLETION convention: the env exits via `li a7,93; ecall` (Level-0 EcallFromM): a0==0 pass,
  a0=(n<<1)|1 fails case n; the harness reports the case number. (A direct tohost write / Exited is
  also honored.)
- HARNESS: crates/core/tests/riscv_tests.rs (#![cfg(feature=zicsr-stub)]) reads the committed ELFs
  via std::fs, runs each, asserts pass, SKIP list = {fence_i: Zifencei; ma_data: exercises MISALIGNED
  access succeeding, which Level 0 deliberately faults per E0-T08 — correct behavior, documented}.
  52 run green, 2 skipped. crates/wasm/tests/riscv_tests.rs (generated, include_bytes the same 52
  ELFs, #![cfg(all(wasm32, zicsr-stub))]) passes under wasm-pack test --node --features zicsr-stub.
- QUARANTINE: tools/riscv-tests/check-quarantine.sh — default release build has 0 `zicsr` symbols
  (nm), feature build has 2 (proves the check discriminates). make test-riscv runs native+wasm; CI
  ci.yml test job runs the native suite + quarantine, wasm job runs the wasm suite.
- SENSITIVITY (self-checked): SRA→SRL mutation → rv64ui-p-sra FAILS at case #3; reverted. The suite
  catches decoder bugs and names the case (verifier angle 1).
Gates: fmt; clippy --workspace --all-targets --all-features -D warnings 0; workspace tests 0 FAILED
(riscv cfg'd out of the default run); riscv native suite ok (52 pass, 2 skip); quarantine OK; wasm
riscv ok; zero-cost --selftest OK; feature matrix builds.
rr: N/A (macOS). Verifier angles open: mutation trio SRA/SRL + B-imm bit-11 + LWU-sign (angle 1),
full set incl. skips diffed vs SKIP (2), mret not masking a wrong trap cause (3), rebuild+cmp vs
committed (4, byte-identical here), and --trace of a test showing the stub's CSR ops retired (5).
