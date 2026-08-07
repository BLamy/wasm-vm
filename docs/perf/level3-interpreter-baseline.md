# Level-3 interpreter performance baseline (E4-T04)

The **official Level-3 interpreter baseline** — the frozen set of numbers every Epic-4 speedup
claim, and the capstone's "≥10× CoreMark" and "<5 s boot" targets, are measured *against*. If this
baseline is sloppy the whole epic's arithmetic is unfalsifiable, so the workloads, build profile, and
host are all pinned here, and the measured values are committed to the tamper-evident hash-chained
ledger `bench/ledger.json` (see `bench/README.md`).

This complements the **Level-1 micro-benchmark baseline** (`docs/perf/level1-baseline.md`), which
isolates single subsystems (alu/branch/memory/fp MIPS). Level 3 measures whole, standard *macro/
micro workloads* end-to-end in the guest: CoreMark, Dhrystone, cold boot, and (deferred) an in-guest
`gcc -O2` compile.

## Methodology (frozen)

- **Harness:** `tools/bench.py` (`run coremark|dhrystone|boot`), the E4-T03/T04 boot →
  console-drive → parse → JSON pipeline. Always the `--release` `wasm-vm` (never debug — ~100×
  slower). Native engine only on this host (browser reaping-deferred — see below).
- **CoreMark / Dhrystone:** pinned, committed statically-linked rv64gc ELFs run in-guest, bracketed
  by per-run sentinels; the harness enforces each ELF's sha256 against `bench/guest/SHA256SUMS` and
  rejects any run whose in-benchmark integrity self-check (CoreMark CRC / `seedcrc==0xe9f5`,
  Dhrystone `Int_Glob==5` …) fails. Score is median-of-3.
- **Boot:** wall clock between **byte-pattern-defined endpoints** — t0 = the guest's genuine first
  UART byte (this VM has a built-in Rust SBI, `earlycon=sbi`; it prints **no OpenSBI banner**, so the
  first console output is the kernel's earlycon line), t1 = the getty `login:` regex. Runs with
  `--profile-boot`, which halts the VM at login and emits `PROFILE_JSON`; its `total_retired` is the
  companion `boot_retired_instrs` anchor. `boot_wall_s` is median-of-3 (host-noisy); the retired
  anchor is near-deterministic (asserted stable within 1%).
- **Ledger:** every value here is a `baseline: "level3-interpreter"` entry in `bench/ledger.json`,
  each carrying the emulator commit hash, config, and a `prev_sha256` chain link.
- **Regenerate:** `python3 tools/bench.py run <bench> --engine native --runs 3 --json out.json`,
  then `python3 tools/bench.py record out.json --baseline level3-interpreter`.

## Measurement — 2026-08-05

| Field | Value |
|-------|-------|
| Host CPU / OS | Apple M-series (aarch64, `Darwin arm64`) / macOS 26.2 (25C56) |
| rustc | 1.96.0 (ac68faa20 2026-05-25) |
| Build profile | `--release` (default: lto=false, codegen-units=16, opt-level=3) |
| Guest kernel / rootfs | Linux 6.6.63 (`releases/kernel/6.6.63/Image`) / pinned Alpine ext4 |
| Guest toolchain (micro-benches) | gcc-13-riscv64-linux-gnu 13.3.0, `-static -O2 -g0 -march=rv64gc -mabi=lp64d` |
| RAM | 256 MiB |

### Native aarch64 baselines (release, median-of-3)

| Benchmark | Score | Unit | Higher better | Spread | Anchor |
|-----------|------:|------|:-------------:|-------:|--------|
| Dhrystone | **189.717** | DMIPS | yes | 0.0% | — |
| CoreMark  | **261.734** | iterations/sec | yes | 0.01% | — |
| boot      | **375.386** | seconds | no | 1.38% | `boot_retired_instrs` = 2,971,174,099 (spread 0.1%) |
| gcc `-O2 -c miniz.c` | *pending (phases 2–3, deferred)* | seconds | no | — | — |

Boot's two consecutive measurements agree well within the 5% acceptance bar (spread 1.38%).

## Honest framing (read this before quoting any number)

- **The interpreter is ~30 MIPS.** Level-1 measured 27–35 MIPS per subsystem; CoreMark/Dhrystone
  here are the whole-workload confirmation of that order of magnitude. Every "≥10×" Epic-4 claim is
  arithmetic on *these* CoreMark/Dhrystone numbers, not on aspiration.
- **`boot_wall_s` is host-dependent** — 375 s (~6.25 min) is the wall time to boot Alpine to a login
  prompt on *this* ~30 MIPS interpreter on *this* host. It is **not** a portable constant; it scales
  with host speed and interpreter throughput. The capstone's **"<5 s boot" is a FUTURE Level-4
  target** measured against *this metric's definition* (first UART byte → getty `login:`), **not**
  against this baseline value. Comparing a future JIT's boot_wall_s to 375 s is the intended use;
  treating 375 s as "the boot time" is not.
- **`boot_retired_instrs` is the portable anchor.** Unlike wall time, the retired-instruction count
  at getty-login (~2.97 B) is host-independent and near-deterministic — the right regression sentinel
  and the cross-engine equality check (native vs wasm should match here). It jitters ~0.2% only from
  profiler quantum granularity, not from guest nondeterminism.

## Scope / deferred (honest)

- **gcc `-O2 -c miniz.c` macro bench (phases 2–3):** DEFERRED. Requires baking a pinned Alpine gcc
  toolchain into a ~256–400 MB ext4 overlay (`bench/mk-gcc-image.sh`, build-on-demand, NOT committed)
  plus vendored `miniz.c`. Not built in this pass; the ledger + doc rows are placeholders. No number
  is fabricated. This is the only Epic-4 baseline row still open.
- **Browser engine ("both engines" in the AC):** reaping-deferred. The Alpine browser boot OS-reaps
  on the dev mac (see the E3 memory note); `--engine browser` raises `SystemExit` unless forced. The
  wasm interpreter is the same `wasm-vm-core` proven bit-identical to native in E1-T22, so the boot
  endpoints are defined identically for both engines; the browser measurement pass awaits a host that
  can sustain the ~40-min browser boot.

## Cross-reference

- **Level-1 baseline** (`docs/perf/level1-baseline.md`): subsystem MIPS isolation + the 15-MIPS CI
  floor guard. Level 3 here is the standard-workload macro layer on top of that.
- **Ledger schema + tooling:** `bench/README.md`.
</content>
</invoke>
