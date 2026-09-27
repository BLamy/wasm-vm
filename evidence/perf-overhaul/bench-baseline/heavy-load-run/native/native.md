# Native benchmark (2026-09-23T08:41:45+00:00)

Host: arm64 · Apple M4 Max · reps=3 (alpine/coremark reps=1, up to 4 concurrent) · medians · interleaved=True

- **baseline**: `/Users/blamy/Documents/Codex/wasm-vm-base/target/release/wasm-vm` rev `8297850913` (+uncommitted crate changes) sha256 `90a84c60f52a`
- **candidate**: `/Users/blamy/Documents/Codex/wasm-vm-t-bench/target/release/wasm-vm` rev `ce356fd482` sha256 `08f309cb9a01`

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-legacy | wall s | 38.71 [36.29–57.69] | 46.51 [31.21–47.38] | 0.83x (paired 1.22x) | 3/3 · 3/3 |
| busybox-legacy | MIPS (profile) | 8.4 [5.7–9.0] | 7.0 [6.9–10.5] | 0.83x (paired 1.22x) | 3/3 · 3/3 |
| busybox-legacy | cpu s | 38.40 [36.22–40.45] | 33.53 [31.13–35.07] | 1.15x (paired 1.21x) | 3/3 · 3/3 |
| busybox-fast | wall s | 18.56 [15.77–28.17] | 15.37 [13.53–19.38] | 1.21x (paired 1.37x) | 3/3 · 3/3 |
| busybox-fast | MIPS (profile) | 17.5 [11.6–20.6] | 21.2 [16.8–24.1] | 1.21x (paired 1.37x) | 3/3 · 3/3 |
| busybox-fast | cpu s | 15.70 [15.18–17.54] | 14.87 [13.09–15.02] | 1.06x (paired 1.16x) | 3/3 · 3/3 |
| busybox-jit | wall s | 13.25 [12.90–13.53] | 12.37 [12.28–27.46] | 1.07x (paired 1.05x) | 3/3 · 3/3 |
| busybox-jit | MIPS (profile) | 24.6 [24.1–25.3] | 26.4 [11.9–26.6] | 1.07x (paired 1.05x) | 3/3 · 3/3 |
| busybox-jit | cpu s | 13.21 [12.84–13.48] | 12.33 [12.00–16.16] | 1.07x (paired 1.07x) | 3/3 · 3/3 |
| busybox-jit | JIT-retired fraction | 0.926 | 0.926 | 1.00x | 3/3 · 3/3 |
| alpine-fast | wall s | 213.32 | 192.40 | 1.11x | 1/1 · 1/1 |
| alpine-fast | MIPS (profile) | 14.4 | 16.0 | 1.11x | 1/1 · 1/1 |
| alpine-fast | cpu s | 209.23 | 189.39 | 1.10x | 1/1 · 1/1 |
| alpine-jit | wall s | 281.59 | 266.69 | 1.06x | 1/1 · 1/1 |
| alpine-jit | MIPS (profile) | 10.9 | 11.5 | 1.06x | 1/1 · 1/1 |
| alpine-jit | cpu s | 275.61 | 260.91 | 1.06x | 1/1 · 1/1 |
| alpine-jit | JIT-retired fraction | 0.825 | 0.825 | 1.00x | 1/1 · 1/1 |
| compute-fast | region wall s | 9.87 [9.52–25.32] | 8.71 [8.58–16.29] | 1.13x (paired 1.15x) | 3/3 · 3/3 |
| compute-fast | region cpu s | 9.86 [9.49–13.03] | 8.69 [8.57–11.55] | 1.13x (paired 1.13x) | 3/3 · 3/3 |
| compute-fast | MIPS (icount est.) | 16.7 [6.5–17.3] | 18.9 [10.1–19.2] | 1.13x (paired 1.15x) | 3/3 · 3/3 |
| compute-jit | region wall s | 8.47 [8.02–13.63] | 7.92 [7.63–10.85] | 1.07x (paired 1.07x) | 3/3 · 3/3 |
| compute-jit | region cpu s | 8.45 [8.00–11.34] | 7.91 [7.60–10.21] | 1.07x (paired 1.07x) | 3/3 · 3/3 |
| compute-jit | MIPS (icount est.) | 19.4 [12.0–20.4] | 20.7 [15.1–21.6] | 1.07x (paired 1.07x) | 3/3 · 3/3 |
| coremark-fast | region wall s | 142.45 | 125.94 | 1.13x | 1/1 · 1/1 |
| coremark-fast | region cpu s | 107.80 | 92.56 | 1.16x | 1/1 · 1/1 |
| coremark-fast | MIPS (icount est.) | 15.3 | 17.3 | 1.13x | 1/1 · 1/1 |
| coremark-fast | CoreMark iterations/s (host clock) | 42.1 | 47.6 | 1.13x | 1/1 · 1/1 |
| coremark-jit | region wall s | 103.60 | 95.10 | 1.09x | 1/1 · 1/1 |
| coremark-jit | region cpu s | 71.67 | 66.58 | 1.08x | 1/1 · 1/1 |
| coremark-jit | MIPS (icount est.) | 21.0 | 22.9 | 1.09x | 1/1 · 1/1 |
| coremark-jit | CoreMark iterations/s (host clock) | 57.9 | 63.1 | 1.09x | 1/1 · 1/1 |
| microbench | alu MIPS (legacy) | 54.2 | 48.4 | 0.89x | 3/3 · 3/3 |
| microbench | branch MIPS (legacy) | 60.2 | 53.7 | 0.89x | 3/3 · 3/3 |
| microbench | memory MIPS (legacy) | 51.5 | 47.3 | 0.92x | 3/3 · 3/3 |
| microbench | fp MIPS (legacy) | 50.2 | 45.7 | 0.91x | 3/3 · 3/3 |
| microbench | alu MIPS (fast) | 83.7 | 88.8 | 1.06x | 3/3 · 3/3 |

Median 1-minute load average during the runs: busybox-legacy/baseline=11.9, busybox-legacy/candidate=17.1, busybox-fast/baseline=32.2, busybox-fast/candidate=46.3, busybox-jit/baseline=42.4, busybox-jit/candidate=37.1, compute-fast/baseline=33.5, compute-fast/candidate=26.9, compute-jit/baseline=20.9, compute-jit/candidate=17.6, microbench/baseline=30.7, microbench/candidate=34.4, coremark-jit/candidate=19.6, coremark-jit/baseline=19.6, coremark-fast/candidate=19.6, coremark-fast/baseline=19.6, alpine-fast/candidate=76.8, alpine-fast/baseline=76.8, alpine-jit/candidate=76.8, alpine-jit/baseline=76.8

Cells: median [min–max over reps]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back; alpine/coremark pairs ran side by side when concurrent).

wall s = host wall-clock of the whole process; cpu s = its user+sys rusage; MIPS (profile) = retired-at-marker / profiled wall; region wall s = host time from Enter to the done marker; region cpu s = emulator user+sys CPU inside that region; MIPS (icount est.) = guest-uptime delta x 1e8 / region wall (guest time is used only as an instruction counter, never as a clock).
