---
id: E4-T04
epic: 4
title: Macro benchmarks and the interpreter baseline ledger
priority: 404
status: pending
depends_on: [E4-T03]
estimate: M
capstone: false
---

## Goal
Two macro benchmarks join the harness — kernel-boot wall clock and an in-guest
`gcc -O2` compile of a pinned non-trivial C file — and all benchmark results start
accumulating in a committed ledger (`bench/ledger.json`), opening with the official
**Level 3 interpreter baseline** numbers that every Epic 4 speedup claim, and the capstone's
"≥10x" and "<5 s boot", will be measured against.

## Context
The capstone is arithmetic on numbers recorded *here*; if the baseline is sloppy the whole
epic's claims are unfalsifiable. Boot time is defined as first byte written by OpenSBI to
UART → login-prompt marker on the serial console (precise, automatable endpoints). The
compile workload is a single-file, dependency-free C program of real size (bundle
`miniz.c`+`miniz.h`, ~10 kLoC) compiled with the guest's Alpine gcc; the gcc/apk versions
are pinned by snapshotting the benchmark disk overlay after installing them once.

## Deliverables
- `tools/bench.py run boot`: measures OpenSBI-first-output → `login:` marker, native and
  browser engines.
- `tools/bench.py run gcc`: boots, runs `time gcc -O2 -c miniz.c` in-guest, parses both
  guest `time` output and host-side wall clock between command echo and prompt return.
- Benchmark overlay extended with pinned gcc toolchain + `miniz.c`; overlay hash recorded.
- `bench/ledger.json`: append-only records `{bench, score, engine, commit, config, date}`;
  `tools/bench.py record` appends, `tools/bench.py report` prints trends.
- Baseline entries committed for all four benchmarks (CoreMark, Dhrystone, boot, gcc) on
  the Level 3 interpreter, both engines, tagged `baseline: level3-interpreter`.

## Acceptance criteria
- [ ] `boot` and `gcc` benchmarks run unattended and emit JSON in both engines.
- [ ] Boot measurement endpoints are byte-pattern-defined in code (not eyeballed) and two
      consecutive boot measurements agree within 5%.
- [ ] Ledger contains Level 3 interpreter baselines for all four benchmarks, both engines,
      with the emulator commit hash recorded.
- [ ] `tools/bench.py report` shows history per benchmark; schema documented in `bench/`.

## Adversarial verification
Refute the baseline's integrity. Attack angles: (1) re-measure all four baselines from a
cold start at the recorded commit — any result differing from the ledger by >10% refutes
the baseline; (2) verify the boot endpoints: instrument the console stream and confirm the
start marker is genuinely OpenSBI's first output, not page-load or WASM-instantiation time
being silently excluded/included inconsistently between engines (the definition must be
identical in both — inconsistency is a refutation); (3) confirm the gcc benchmark actually
compiles at `-O2` (check the command line in the console log) and produces a nonzero `.o`;
(4) mutate one ledger entry and confirm `report`/`record` tooling detects schema violations
or at least never silently rewrites history (append-only property).

## Verification log
(empty)
