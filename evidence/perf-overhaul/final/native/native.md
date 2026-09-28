# Native benchmark (2026-09-27T20:13:16+00:00)

Host: arm64 · Apple M4 Max · reps=3 (alpine/coremark reps=1, up to 4 concurrent) · medians · interleaved=True

- **baseline**: `/Users/blamy/Documents/Codex/wasm-vm-base/target/release/wasm-vm` rev `8297850913` (+uncommitted crate changes) sha256 `90a84c60f52a`
- **candidate**: `/Users/blamy/Documents/Codex/wasm-vm-perf/target/release/wasm-vm` rev `fe98912fa2` sha256 `0395489773e2`

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-legacy | wall s | 35.16 [34.96–35.40] | 5.81 [5.79–5.82] | 6.05x (paired 6.04x) | 3/3 · 3/3 |
| busybox-legacy | MIPS (profile) | 9.3 [9.2–9.3] | 56.3 [56.2–56.5] | 6.06x (paired 6.05x) | 3/3 · 3/3 |
| busybox-legacy | cpu s | 35.09 [34.93–35.36] | 5.79 [5.78–5.81] | 6.07x (paired 6.05x) | 3/3 · 3/3 |
| busybox-fast | wall s | 13.05 [12.92–13.12] | 3.39 [3.37–3.40] | 3.85x (paired 3.85x) | 3/3 · 3/3 |
| busybox-fast | MIPS (profile) | 25.0 [24.8–25.2] | 96.3 [96.1–96.9] | 3.86x (paired 3.86x) | 3/3 · 3/3 |
| busybox-fast | cpu s | 13.03 [12.90–13.10] | 3.38 [3.36–3.39] | 3.86x (paired 3.86x) | 3/3 · 3/3 |
| busybox-jit | wall s | 11.92 [11.85–12.07] | 5.04 [5.02–5.08] | 2.36x (paired 2.38x) | 3/3 · 3/3 |
| busybox-jit | MIPS (profile) | 27.4 [27.0–27.5] | 66.8 [66.2–67.0] | 2.44x (paired 2.45x) | 3/3 · 3/3 |
| busybox-jit | cpu s | 11.90 [11.83–12.03] | 5.03 [5.01–5.07] | 2.37x (paired 2.37x) | 3/3 · 3/3 |
| busybox-jit | JIT-retired fraction | 0.926 | 0.947 | 1.02x | 3/3 · 3/3 |
| alpine-fast | wall s | 175.94 | 53.80 | 3.27x | 1/1 · 1/1 |
| alpine-fast | MIPS (profile) | 17.5 | 57.1 | 3.27x | 1/1 · 1/1 |
| alpine-fast | cpu s | 175.79 | 53.70 | 3.27x | 1/1 · 1/1 |
| alpine-jit | wall s | 225.51 | 85.89 | 2.63x | 1/1 · 1/1 |
| alpine-jit | MIPS (profile) | 13.6 | 36.1 | 2.65x | 1/1 · 1/1 |
| alpine-jit | cpu s | 225.35 | 85.76 | 2.63x | 1/1 · 1/1 |
| alpine-jit | JIT-retired fraction | 0.825 | 0.888 | 1.08x | 1/1 · 1/1 |
| compute-fast | region wall s | 9.00 [8.99–9.03] | 2.33 [2.29–2.33] | 3.86x (paired 3.88x) | 3/3 · 3/3 |
| compute-fast | region cpu s | 8.99 [8.98–9.02] | 2.33 [2.29–2.33] | 3.86x (paired 3.87x) | 3/3 · 3/3 |
| compute-fast | MIPS (icount est.) | 18.2 [18.2–18.3] | 70.8 [70.4–71.5] | 3.88x (paired 3.88x) | 3/3 · 3/3 |
| compute-jit | region wall s | 7.74 [7.62–7.75] | 3.44 [3.43–3.47] | 2.25x (paired 2.25x) | 3/3 · 3/3 |
| compute-jit | region cpu s | 7.73 [7.62–7.73] | 3.45 [3.43–3.46] | 2.24x (paired 2.24x) | 3/3 · 3/3 |
| compute-jit | MIPS (icount est.) | 21.3 [21.2–21.6] | 47.9 [47.3–47.9] | 2.25x (paired 2.25x) | 3/3 · 3/3 |
| coremark-fast | region wall s | 85.80 | 20.93 | 4.10x | 1/1 · 1/1 |
| coremark-fast | region cpu s | 85.71 | 20.92 | 4.10x | 1/1 · 1/1 |
| coremark-fast | MIPS (icount est.) | 25.4 | 104.0 | 4.10x | 1/1 · 1/1 |
| coremark-fast | CoreMark iterations/s (host clock) | 69.9 | 286.6 | 4.10x | 1/1 · 1/1 |
| coremark-jit | region wall s | 55.93 | 27.33 | 2.05x | 1/1 · 1/1 |
| coremark-jit | region cpu s | 55.87 | 27.31 | 2.05x | 1/1 · 1/1 |
| coremark-jit | MIPS (icount est.) | 38.9 | 79.6 | 2.05x | 1/1 · 1/1 |
| coremark-jit | CoreMark iterations/s (host clock) | 107.3 | 219.6 | 2.05x | 1/1 · 1/1 |
| microbench | alu MIPS (legacy) | 58.0 | 74.3 | 1.28x | 3/3 · 3/3 |
| microbench | branch MIPS (legacy) | 66.1 | 91.6 | 1.39x | 3/3 · 3/3 |
| microbench | memory MIPS (legacy) | 56.8 | 84.2 | 1.48x | 3/3 · 3/3 |
| microbench | fp MIPS (legacy) | 54.5 | 73.5 | 1.35x | 3/3 · 3/3 |
| microbench | alu MIPS (fast) | 92.7 | 160.1 | 1.73x | 3/3 · 3/3 |

Median 1-minute load average during the runs: busybox-legacy/baseline=3.4, busybox-legacy/candidate=2.8, busybox-fast/baseline=2.7, busybox-fast/candidate=3.5, busybox-jit/baseline=3.2, busybox-jit/candidate=3.2, compute-fast/baseline=3.2, compute-fast/candidate=3.3, compute-jit/baseline=3.5, compute-jit/candidate=3.5, microbench/baseline=2.5, microbench/candidate=2.5, coremark-fast/candidate=2.3, coremark-fast/baseline=2.3, coremark-jit/candidate=2.3, coremark-jit/baseline=2.3, alpine-fast/candidate=3.2, alpine-fast/baseline=3.2, alpine-jit/candidate=3.2, alpine-jit/baseline=3.2

Cells: median [min–max over reps]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back; alpine/coremark pairs ran side by side when concurrent).

wall s = host wall-clock of the whole process; cpu s = its user+sys rusage; MIPS (profile) = retired-at-marker / profiled wall; region wall s = host time from Enter to the done marker; region cpu s = emulator user+sys CPU inside that region; MIPS (icount est.) = guest-uptime delta x 1e8 / region wall (guest time is used only as an instruction counter, never as a clock).
