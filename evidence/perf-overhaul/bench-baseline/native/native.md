# Native benchmark (2026-09-23T09:05:29+00:00)

Host: arm64 · Apple M4 Max · reps=3 (alpine/coremark reps=1, up to 4 concurrent) · medians · interleaved=True

- **baseline**: `/Users/blamy/Documents/Codex/wasm-vm-base/target/release/wasm-vm` rev `8297850913` (+uncommitted crate changes) sha256 `90a84c60f52a`
- **candidate**: `/Users/blamy/Documents/Codex/wasm-vm-t-bench/target/release/wasm-vm` rev `d378e98af0` sha256 `08f309cb9a01`

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-legacy | wall s | 36.59 [36.27–37.04] | 29.95 [29.50–30.71] | 1.22x (paired 1.22x) | 3/3 · 3/3 |
| busybox-legacy | MIPS (profile) | 8.9 [8.8–9.0] | 10.9 [10.6–11.1] | 1.22x (paired 1.22x) | 3/3 · 3/3 |
| busybox-legacy | cpu s | 36.24 [36.20–36.51] | 29.78 [29.44–29.88] | 1.22x (paired 1.22x) | 3/3 · 3/3 |
| busybox-fast | wall s | 13.49 [13.31–13.79] | 11.95 [11.92–12.20] | 1.13x (paired 1.13x) | 3/3 · 3/3 |
| busybox-fast | MIPS (profile) | 24.1 [23.6–24.5] | 27.2 [26.7–27.3] | 1.13x (paired 1.13x) | 3/3 · 3/3 |
| busybox-fast | cpu s | 13.46 [13.28–13.76] | 11.93 [11.89–12.17] | 1.13x (paired 1.13x) | 3/3 · 3/3 |
| busybox-jit | wall s | 12.93 [12.84–13.09] | 11.84 [11.78–11.96] | 1.09x (paired 1.10x) | 3/3 · 3/3 |
| busybox-jit | MIPS (profile) | 25.2 [24.9–25.4] | 27.5 [27.3–27.7] | 1.09x (paired 1.10x) | 3/3 · 3/3 |
| busybox-jit | cpu s | 12.90 [12.80–12.96] | 11.81 [11.75–11.93] | 1.09x (paired 1.10x) | 3/3 · 3/3 |
| busybox-jit | JIT-retired fraction | 0.926 | 0.926 | 1.00x | 3/3 · 3/3 |
| alpine-fast | wall s | 217.62 | 198.08 | 1.10x | 1/1 · 1/1 |
| alpine-fast | MIPS (profile) | 14.1 | 15.5 | 1.10x | 1/1 · 1/1 |
| alpine-fast | cpu s | 201.84 | 182.21 | 1.11x | 1/1 · 1/1 |
| alpine-jit | wall s | 276.80 | 263.72 | 1.05x | 1/1 · 1/1 |
| alpine-jit | MIPS (profile) | 11.1 | 11.7 | 1.05x | 1/1 · 1/1 |
| alpine-jit | cpu s | 260.97 | 247.51 | 1.05x | 1/1 · 1/1 |
| alpine-jit | JIT-retired fraction | 0.825 | 0.825 | 1.00x | 1/1 · 1/1 |
| compute-fast | region wall s | 9.56 [9.36–11.40] | 8.54 [8.38–10.53] | 1.12x (paired 1.12x) | 3/3 · 3/3 |
| compute-fast | region cpu s | 9.55 [9.35–11.28] | 8.52 [8.37–10.31] | 1.12x (paired 1.12x) | 3/3 · 3/3 |
| compute-fast | MIPS (icount est.) | 17.2 [14.4–17.6] | 19.2 [15.7–19.7] | 1.12x (paired 1.12x) | 3/3 · 3/3 |
| compute-jit | region wall s | 8.29 [7.99–9.58] | 7.74 [7.73–7.80] | 1.07x (paired 1.07x) | 3/3 · 3/3 |
| compute-jit | region cpu s | 8.28 [7.97–9.00] | 7.73 [7.72–7.78] | 1.07x (paired 1.07x) | 3/3 · 3/3 |
| compute-jit | MIPS (icount est.) | 19.8 [17.1–20.5] | 21.3 [21.0–21.4] | 1.08x (paired 1.08x) | 3/3 · 3/3 |
| coremark-fast | region wall s | 100.30 | 85.06 | 1.18x | 1/1 · 1/1 |
| coremark-fast | region cpu s | 94.41 | 79.11 | 1.19x | 1/1 · 1/1 |
| coremark-fast | MIPS (icount est.) | 21.7 | 25.6 | 1.18x | 1/1 · 1/1 |
| coremark-fast | CoreMark iterations/s (host clock) | 59.8 | 70.5 | 1.18x | 1/1 · 1/1 |
| coremark-jit | region wall s | 61.47 | 57.99 | 1.06x | 1/1 · 1/1 |
| coremark-jit | region cpu s | 60.99 | 57.58 | 1.06x | 1/1 · 1/1 |
| coremark-jit | MIPS (icount est.) | 35.4 | 37.5 | 1.06x | 1/1 · 1/1 |
| coremark-jit | CoreMark iterations/s (host clock) | 97.6 | 103.5 | 1.06x | 1/1 · 1/1 |
| microbench | alu MIPS (legacy) | 56.5 | 49.1 | 0.87x | 3/3 · 3/3 |
| microbench | branch MIPS (legacy) | 63.7 | 55.2 | 0.87x | 3/3 · 3/3 |
| microbench | memory MIPS (legacy) | 54.6 | 48.0 | 0.88x | 3/3 · 3/3 |
| microbench | fp MIPS (legacy) | 52.0 | 47.6 | 0.92x | 3/3 · 3/3 |
| microbench | alu MIPS (fast) | 90.1 | 93.7 | 1.04x | 3/3 · 3/3 |

Median 1-minute load average during the runs: busybox-legacy/baseline=11.9, busybox-legacy/candidate=9.9, busybox-fast/baseline=9.6, busybox-fast/candidate=8.8, busybox-jit/baseline=8.1, busybox-jit/candidate=8.3, compute-fast/baseline=9.1, compute-fast/candidate=9.4, compute-jit/baseline=9.1, compute-jit/candidate=14.1, microbench/baseline=10.9, microbench/candidate=11.3, coremark-jit/candidate=9.5, coremark-jit/baseline=9.5, coremark-fast/candidate=9.5, coremark-fast/baseline=9.5, alpine-fast/candidate=23.8, alpine-fast/baseline=23.8, alpine-jit/candidate=23.8, alpine-jit/baseline=23.8

Cells: median [min–max over reps]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back; alpine/coremark pairs ran side by side when concurrent).

wall s = host wall-clock of the whole process; cpu s = its user+sys rusage; MIPS (profile) = retired-at-marker / profiled wall; region wall s = host time from Enter to the done marker; region cpu s = emulator user+sys CPU inside that region; MIPS (icount est.) = guest-uptime delta x 1e8 / region wall (guest time is used only as an instruction counter, never as a clock).
