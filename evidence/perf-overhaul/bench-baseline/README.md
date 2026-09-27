# Perf-overhaul benchmark baseline (before numbers)

Host wall-clock numbers for the code **before** the perf overhaul, produced by `tools/perf/bench-all.sh`
(harness commit `d378e98a`). They are the "before" column for the overhaul PR. Every figure is
measured on the host: process wall-clock and rusage CPU time natively, page `performance.now()` in
Chromium. Guest clocks are never used as clocks (under the icount clock guest time is derived from
retired instructions, so in-guest timers cannot see host speedups).

## What was measured

| label | native binary | web build |
|---|---|---|
| `baseline` | `wasm-vm-base` = `82978509` + only the `--fixed-rtc-ns` CLI flag (release profile without LTO) | `make web-build` in `wasm-vm-base` (wasm-opt `-O`, 1.61 MB wasm) |
| `candidate` | this branch's LTO-only build (`6f272998`: `[profile.release] lto = "fat"`, `codegen-units = 1`; no interpreter/JIT changes) | `make web-build` in this worktree (same LTO profile + wasm-opt `-O3`, 1.53 MB wasm) |

```sh
RELEASES=/Users/blamy/Documents/Codex/wasm-vm/releases \
  bash tools/perf/bench-all.sh /Users/blamy/Documents/Codex/wasm-vm-base /Users/blamy/Documents/Codex/wasm-vm-t-bench OUT
```

Machine: Apple M4 Max (12P + 4E cores), 128 GB, macOS (Darwin 25.6.0), headless Chromium 131.0.6778.33
(Playwright). The machine was shared with other engineers' builds throughout.

- **This directory** (`SUMMARY.md`, `native/`, `browser/`, `*.log`): 2026-09-23 09:05 UTC, median
  1-minute load average about 10 on 16 CPUs. Sample ranges are tight (for example busybox fast boot
  13.31–13.79 s), so this is the reference run. The suite took **18 minutes** (native 18.4 min and
  browser 16.2 min, run concurrently).
- `heavy-load-run/`: the same command 25 minutes earlier, with a median load average of about 31 and
  peaks of 77. It took 22 minutes. It is kept as a warning about noise. Its ratio-of-medians figure
  for busybox-legacy is 0.83x, while the paired figure is 1.22x and the CPU-time figure is 1.15x.
  When the machine is this busy, trust the paired column and the CPU-time rows.

Every case passed its correctness check (`ok` 3/3 or 1/1). The retired-at-marker counts were
identical between the two binaries: busybox 326,588,165 instructions (legacy) and 325,388,171
(fast and jit), and Alpine to `login:` 3,073,765,362 instructions. So both binaries did exactly the
same guest work. The native `--jit` retires the same count as the fast interpreter.

## Pre-overhaul reference numbers (`baseline` column, reference run)

| workload | fast interpreter | JIT | JIT gain |
|---|---:|---:|---:|
| Native busybox boot to userland | 13.49 s (24.1 MIPS) | 12.93 s (25.2 MIPS) | 1.04x |
| Native busybox boot, legacy interpreter | 36.59 s (8.9 MIPS) | – | – |
| Native shell arithmetic loop (10000 iterations, about 165M instructions) | 9.56 s (17.2 MIPS) | 8.29 s (19.8 MIPS) | 1.15x |
| Native CoreMark, 6000 iterations (about 2.2G instructions) | 100.3 s (59.8 it/s, 21.7 MIPS) | 61.5 s (97.6 it/s, 35.4 MIPS) | 1.63x |
| Native Alpine ext4 boot to `login:` (3.07G instructions) | 217.6 s (14.1 MIPS) | 276.8 s (11.1 MIPS) | **0.79x** |
| Browser busybox cold boot, navigation to prompt | 21.90 s (16.5 MIPS) | 12.92 s (28.5 MIPS) | 1.70x |
| Browser shell arithmetic loop | 14.57 s (11.4 MIPS) | 10.78 s (15.4 MIPS) | 1.35x |
| Browser node-alpine snapshot restore to prompt | 1.29 s | 1.27 s | – |
| Browser `node -e` script, first run after restore (about 0.47G instructions) | 53.7 s (8.6 MIPS) | 35.0 s (13.2 MIPS) | 1.53x |

In the browser, `fast interpreter` means `?jit=0`, which forces the fast interpreter; JIT means the
production default worker JIT. The native ALU microbench (`perf_baseline`) runs at 56.5 MIPS on the
legacy interpreter and 90.1 MIPS on the fast interpreter.

What these numbers say about the owner's complaints:

- **Throughput is 10–35 MIPS** on real workloads. Boot runs at about 25 MIPS natively and about
  28 MIPS in the browser with the JIT. User-mode work in the browser runs at only 8.6–15.4 MIPS.
- **The native JIT barely helps.** It gives 1.04x on the busybox boot and 1.15x on the shell loop,
  and it is 21% slower than the fast interpreter on the Alpine boot, even though 82.5% of Alpine's
  instructions retire through the JIT. Only CoreMark, a tight loop, shows a real gain (1.63x). The
  browser worker JIT does better (1.35–1.70x) but still starts from a slow interpreter.

## LTO-only candidate vs baseline (reference run)

See `SUMMARY.md` for the full table. Paired speedups, candidate over baseline:

- **Native gets 5–22% faster from LTO alone**: legacy boot 1.22x, fast boot 1.13x, JIT boot 1.10x,
  shell loop 1.12x (fast) and 1.07x (JIT), CoreMark 1.18x (fast) and 1.06x (JIT), Alpine 1.10x (fast)
  and 1.05x (JIT). CPU time moves the same way.
- **The microbench test binary gets slower**: `perf_baseline` legacy ALU drops from 56.5 to 49.1 MIPS
  (0.87x); fast ALU rises 1.04x. Both runs showed this, and so did two earlier trial runs. The
  test binary is built with `cargo test --release` in each checkout, so it also gets fat LTO. The
  CLI's legacy path gets faster, not slower.
- **The browser build does not gain**: every browser metric is flat to 6% slower, in both runs. Busybox
  JIT boot is 0.97x (0.90x in the heavy-load run), `?jit=0` boot 0.94x, node 0.98x, shell loop
  0.98–1.00x. The workspace `[profile.release]` LTO also applies to the wasm build, and wasm-opt
  went from `-O` to `-O3`. One or both of those changes seems to slightly hurt V8's code for the
  interpreter. **Follow-up for the integration lead:** run an A/B of wasm-opt `-O` vs `-O3`, and of
  LTO on vs off for `wasm-vm-wasm`, before shipping the web build.

## Comparing the final branch against this baseline

The best comparison is an interleaved A/B against the baseline checkout. It takes about 18 minutes at
pre-overhaul speed, and less as the candidate gets faster:

```sh
RELEASES=/Users/blamy/Documents/Codex/wasm-vm/releases \
  bash tools/perf/bench-all.sh /Users/blamy/Documents/Codex/wasm-vm-base /path/to/final OUT
cat OUT/SUMMARY.md
```

A quicker check runs the candidate alone and compares it with this directory. The two runs happen at
different times on a shared machine, so this comparison is noisier:

```sh
RELEASES=... bash tools/perf/bench-all.sh - /path/to/final OUT
python3 tools/perf/summarize.py --native OUT/native/native.json --browser OUT/browser/browser.json \
  --ref-native evidence/perf-overhaul/bench-baseline/native/native.json \
  --ref-browser evidence/perf-overhaul/bench-baseline/browser/browser.json --ref-label baseline
```
