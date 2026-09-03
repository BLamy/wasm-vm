---
id: E4-T04
epic: 4
title: Macro benchmarks and the interpreter baseline ledger
priority: 404
status: verified
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

## Verification debt
_Tracked as debt (the ticket is `partially-verified`); clear on `dev`._
- **In-guest `gcc -O2` bench** (phases 2-3) — needs `apk.static`/`mke2fs` Linux tooling absent on macOS; build the ~300MB gcc overlay + run the compile on `dev`. Plus **browser-engine baselines** (reaping-deferred). Boot bench + ledger are native-verified.

## Verification log
### 2026-09-02 — verifier — VERDICT: verified (user-directed debt closure)

Commit: `069c4ee`.

User directed this verification-debt sweep to accept the existing implementation and historical
verification record and move on. Independent-machine, WebKit, and other environment-specific
follow-up legs are out of scope by direction. This administrative promotion adds no new runtime
claim or evidence artifact; the prior log remains the record of implementation and caveats for
E4-T04.

- 2026-08-05 — **gcc bench DEBT CLEARED on `dev` — real number.** The in-guest `gcc -O2 -c miniz.c` compile ran to completion: **163.98 guest-seconds**, `.o` = **302,904 bytes** (nonzero — genuine compilation), ~88 min host wall on dev's 2 cores (`evidence/e4-t04/gcc-native.json`; ledger entry added). All FOUR native benches (dhrystone 189.7 DMIPS, coremark 261.7 it/s, boot 375s, **gcc 163.98s**) now recorded at the `level3-interpreter` baseline. Remaining debt: the browser-engine entries only (reaping).
- 2026-08-05 — **gcc-bench TOOLING cleared on `dev` (the Linux-tooling debt); the NUMBER is still compiling.** `bench/mk-gcc-image.sh` builds a real pinned Alpine riscv64 toolchain overlay (gcc 13.2.1_git20240309-r1 / musl-dev 1.2.5-r3 / binutils 2.42-r1, 130 MiB, sha256 `167ff7a9…`, gitignored) via `apk.static`; vendored miniz 3.0.2 + PROVENANCE + `gcc-MANIFEST.txt`; `tools/bench.py gcc` runs `gcc -O2 -c miniz.c`, asserts nonzero `.o` + captures the `-O2` command line + `.o` sha256. **No number yet (no fabrication):** the `-O2` compile runs the interpreter at ~1-2 MIPS (gcc's memory/branch-heavy code hammers the translate + device-sync path) → 80+ min on dev's 2 cores; left running (`ssh dev 'cat /tmp/gcc-1run.json'`). Remaining debt: the gcc guest-seconds + a ledger entry once it finishes (it will — cc1 runs correctly, no OOM). commit `710089a`.
- 2026-08-05 — **Phases 1/4/5 landed + validated (commits `4d19194`, `50343e3`); status
  partially-verified.** Boot wall-clock bench, the hash-chained ledger, and the Level-3 baseline doc are
  done and native-verified; the in-guest gcc bench (phases 2-3) is honest debt.
  - **Boot bench (`evidence/e4-t04/boot-native-median3.json`):** `boot_wall_s` median **375.386s** (runs
    373.85/379.05/375.39, spread **1.38% ≤5% ✓**), `boot_retired_instrs` median **2,971,174,099**. Key
    correction: the plan's `OpenSBI` t0 marker never matches (this VM has a BUILT-IN Rust SBI, no OpenSBI
    banner — [[deploy-regen-tasks-json-first]] is unrelated; the real first output is the kernel earlycon
    line); t0 is now the genuine first UART byte. Honest caveat: `boot_retired_instrs` is NOT bit-exact
    (~0.2% jitter — the profile-boot count is stamped in the console quantum where `login:` is first seen,
    not instruction-aligned); assertion relaxed to stable-within-1%, median recorded.
  - **Ledger (`bench/ledger.json`) + tooling:** append-only, `prev_sha256` hash-chain, `record`/`report
    [--verify]`/`run --ledger`. Seeded 3 `level3-interpreter` baselines (dhrystone 189.717 DMIPS, coremark
    261.734 iter/s, boot 375.386s). **Adversarial #4 independently re-confirmed:** `report --verify` exits
    0 clean; corrupting one entry's score → `entry 1 prev_sha256 mismatch (chain broken/tampered)`, exit 1;
    restored → exit 0. Schema documented in `bench/README.md`.
  - **Baseline doc:** `docs/perf/level3-interpreter-baseline.md` (frozen methodology, ~30 MIPS, honest
    "boot_wall is host-dependent; <5s is a future Level-4 target against this metric, not this value";
    `boot_retired_instrs` is the portable regression anchor; gcc row pending).
  - **VERIFICATION DEBT:** (1) the **in-guest gcc `-O2` bench** (phases 2-3) — deferred, no fake number;
    the ~256–400 MB overlay needs `apk.static`/`mke2fs -d` Linux tooling not on this macOS host + a
    many-minutes compile on the interpreter. Remaining: `bench/mk-gcc-image.sh`, vendored `miniz.{c,h}`,
    pinned `gcc-MANIFEST.txt`+sha256, the `gcc` bench, `.gitignore gcc.ext4`, + its ledger/doc rows. Build
    on Linux/`dev`. (2) **browser-engine** baselines — reaping-deferred (endpoints defined engine-identically
    so a browser pass drops in). The AC "both engines / all four benches" thus collides with the macOS
    tooling+reaping constraints; 3/4 benches × native are recorded now.
- 2026-08-05 — **Design + phased plan (builds on the E4-T03 harness).** Key decisions:
  - **Boot bench:** host wall-clock between the `OpenSBI` banner (t0 — genuinely its first UART output,
    engine-identical) and the `login:` regex, via the E4-T03 `Console` loop; PLUS a deterministic
    `boot_retired_instrs` companion from `--profile-boot`'s `PROFILE_JSON` (regression anchor + cross-
    engine equality check). `boot_wall_s` is the only host-noise metric → median-of-3 + 5% agreement.
    Honest: baseline boot_wall is tens-of-seconds on the ~30 MIPS interpreter; the capstone "<5s" is a
    FUTURE target measured against this metric, not the baseline value.
  - **In-guest gcc bench:** bake REAL pinned Alpine gcc into an overlay via `apk.static` cross-install
    (reuse `tools/rootfs-inner.sh`'s recipe) — not tcc/chibicc (they ignore `-O2`, failing adversarial
    #3). Compile vendored `miniz.c` (~10 kLoC) `-O2 -c` with `-frandom-seed` + `SOURCE_DATE_EPOCH`
    (deterministic `.o`); score = guest seconds (duration) + `.o` size/sha256 + echoed command line.
    Runtime is many minutes on the interpreter — the slowest bench. **DECISION (repo size):** the gcc
    overlay is ~256–400 MB — DO NOT commit it; gitignore it, commit the reproducible `bench/mk-gcc-image.sh`
    + pinned `gcc-MANIFEST.txt` + its sha256 (build-on-demand), unlike the small committed E4-T03 ELFs.
  - **Ledger `bench/ledger.json`:** append-only `{schema_version, entries:[…]}`, each entry with a
    `prev_sha256` HASH-CHAIN (tamper-evident — satisfies adversarial #4), `higher_is_better` to
    distinguish rates (dhry/coremark) from durations (boot/gcc). `bench.py record <result.json>` appends
    (never reorders); `bench.py report --verify` walks the chain + computes speedup vs `level3-interpreter`.
  - **Level-3 baseline** = the 4 benches on release, seeded with the measured Dhrystone 189.7 DMIPS +
    CoreMark 261.7 iter/s + boot + gcc; documented in a new `docs/perf/level3-interpreter-baseline.md`.
  - **Phases:** (1) boot bench [native]; (2) gcc overlay builder + hashes; (3) gcc bench; (4) ledger
    `record`/`report` + hash-chain + seed; (5) baseline doc + adversarial re-measure. Native fully
    verifiable now (box has headroom — the 33-day `yes` orphans were killed); browser stays reaping-
    deferred (AC "both engines" collides with reaping — record native now, mark browser deferred).
