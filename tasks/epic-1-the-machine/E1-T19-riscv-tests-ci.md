---
id: E1-T19
epic: 1
title: riscv-tests suite integration in CI with per-test pass/fail reporting
priority: 119
status: pending
depends_on: [E1-T03, E1-T04, E1-T07, E1-T08, E1-T12, E1-T17]
estimate: M
capstone: false
---

## Goal
The official riscv-tests binaries — rv64ui/um/ua/uf/ud/uc in both -p (physical) and -v
(virtual memory) variants, plus rv64mi and rv64si — run as a single command natively and
under wasm32, emitting a per-test pass/fail table, wired into CI as a required job with
an explicit, reviewed known-failure allowlist (target: empty by the capstone).

## Context
riscv-software-src/riscv-tests communicates via the HTIF tohost/fromhost protocol: the
test writes `(test_num << 1) | 1` to the `tohost` symbol on failure or 1 on success. The
-p variants run in M-mode flat physical; -v variants set up Sv39 page tables, run in
U-mode, and exercise trap handling — they are the first integrated consumers of
T09–T12 + T16–T17 together. Binaries are built once with a pinned riscv64-unknown-elf
toolchain (or fetched prebuilt) and vendored/cached at a pinned riscv-tests commit so CI
is hermetic. The wasm32 leg runs the same ELFs through the browser/node harness from
Epic 0. This task is infrastructure: suites already individually passing (per T03–T18
acceptance) become a regression wall.

## Deliverables
- `tools/run_riscv_tests.sh` (native) and a wasm runner target: discover ELFs, run each
  with a per-test timeout and instruction budget, parse tohost, emit a markdown + JSON
  report (`target/riscv-tests-report.{md,json}`) listing every test's status and retire
  count.
- ELF loader support for the tests' entry/symbol conventions (tohost/fromhost addresses
  read from the symbol table, not hard-coded).
- Pinned toolchain/binaries provisioning (Makefile target + lockfile with sha256s).
- CI workflow: native job + wasm job, both diffing the report against the allowlist file
  (`tests/riscv-tests-allowlist.txt`, with a written justification per entry).

## Acceptance criteria
- [ ] One command runs all of rv64ui/um/ua/uf/ud/uc{-p,-v} + rv64mi-p + rv64si-p and
      prints a table with zero unexplained failures (allowlist entries each carry a
      linked task id for their fix).
- [ ] A deliberately broken instruction (mutation test: e.g. flip SLT to unsigned)
      turns the CI job red with the failing tests named in the report.
- [ ] The wasm32 job runs the identical ELF set and produces a report equal to the
      native one (same pass set, same fail set).
- [ ] Hung tests are killed by the instruction budget and reported TIMEOUT (not pass).
- [ ] Report JSON includes riscv-tests commit hash and our git rev; two runs at the same
      revs produce byte-identical reports (determinism).
- [ ] CI wall time for both jobs combined ≤ 15 minutes.

## Adversarial verification
Attack the harness's honesty before the CPU: (1) corrupt a test ELF's tohost write to 3
(fail code) and verify the report says FAIL — a harness that pattern-matches "test ran to
completion" as pass refutes; (2) point the runner at an empty directory — a green report
with zero tests refutes (must error); (3) verify the wasm job actually executes wasm
(inject a wasm-only `cfg` panic and see it fail). Then attack coverage: assert the
discovered test count matches the upstream suite manifests (count rv64ui-p-* etc. against
the riscv-tests build at the pinned commit; a silently-skipped suite refutes). Run the
mutation test matrix — one seeded bug per extension (M/A/F/D/C/priv) — and require each
to be caught by at least one test; an uncaught mutation means the suite isn't actually
wired to that unit. Finally re-run the full thing from a clean clone (no cached
toolchain) to refute hermeticity claims.

## Verification log
(empty)
