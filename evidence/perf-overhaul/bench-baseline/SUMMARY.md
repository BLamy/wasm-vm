| metric (median; host clock / host CPU time) | baseline | candidate | speedup | paired |
|---|---:|---:|---:|---:|
| Native: busybox boot to userland, fast interpreter (s) | 13.49 | 11.95 | **1.13x** | 1.13x |
| Native: busybox boot to userland, --jit (s) | 12.93 | 11.84 | **1.09x** | 1.10x |
| Native: busybox boot to userland, legacy interpreter (s) | 36.59 | 29.95 | **1.22x** | 1.22x |
| Native: busybox boot CPU time, fast (s) | 13.46 | 11.93 | **1.13x** | 1.13x |
| Native: busybox boot CPU time, --jit (s) | 12.90 | 11.81 | **1.09x** | 1.10x |
| Native: busybox boot CPU time, legacy (s) | 36.24 | 29.78 | **1.22x** | 1.22x |
| Native: busybox boot MIPS, fast | 24.1 | 27.2 | **1.13x** | 1.13x |
| Native: busybox boot MIPS, --jit | 25.2 | 27.5 | **1.09x** | 1.10x |
| Native: shell arithmetic loop, fast (s) | 9.56 | 8.54 | **1.12x** | 1.12x |
| Native: shell arithmetic loop, --jit (s) | 8.29 | 7.74 | **1.07x** | 1.07x |
| Native: shell arithmetic loop CPU time, fast (s) | 9.55 | 8.52 | **1.12x** | 1.12x |
| Native: shell arithmetic loop CPU time, --jit (s) | 8.28 | 7.73 | **1.07x** | 1.07x |
| Native: shell loop MIPS, fast | 17.2 | 19.2 | **1.12x** | 1.12x |
| Native: shell loop MIPS, --jit | 19.8 | 21.3 | **1.08x** | 1.08x |
| Native: Alpine ext4 boot to login, fast (s) | 217.6 | 198.1 | **1.10x** | 1.10x |
| Native: Alpine ext4 boot to login, --jit (s) | 276.8 | 263.7 | **1.05x** | 1.05x |
| Native: Alpine boot CPU time, fast (s) | 201.8 | 182.2 | **1.11x** | 1.11x |
| Native: Alpine boot MIPS, --jit | 11.1 | 11.7 | **1.05x** | 1.05x |
| Native: CoreMark (6000 it) host time, fast (s) | 100.3 | 85.1 | **1.18x** | 1.18x |
| Native: CoreMark (6000 it) host time, --jit (s) | 61.5 | 58.0 | **1.06x** | 1.06x |
| Native: CoreMark iterations/s on the host clock, fast | 59.8 | 70.5 | **1.18x** | 1.18x |
| Native: CoreMark iterations/s on the host clock, --jit | 97.6 | 103.5 | **1.06x** | 1.06x |
| Native: CoreMark MIPS, --jit | 35.4 | 37.5 | **1.06x** | 1.06x |
| Native: ALU microbench MIPS (legacy) | 56.5 | 49.1 | **0.87x** | – |
| Native: ALU microbench MIPS (fast) | 90.1 | 93.7 | **1.04x** | – |
| Browser: busybox cold boot to prompt, JIT (s) | 12.92 | 13.30 | **0.97x** | 0.97x |
| Browser: busybox cold boot to prompt, ?jit=0 (s) | 21.90 | 23.86 | **0.92x** | 0.94x |
| Browser: busybox boot MIPS, JIT | 28.5 | 27.7 | **0.97x** | 0.97x |
| Browser: shell arithmetic loop, JIT (s) | 10.78 | 11.08 | **0.97x** | 1.00x |
| Browser: shell arithmetic loop, ?jit=0 (s) | 14.57 | 15.08 | **0.97x** | 0.98x |
| Browser: shell loop MIPS, JIT | 15.4 | 15.0 | **0.97x** | 1.00x |
| Browser: node-alpine snapshot restore to prompt, JIT (s) | 1.27 | 1.27 | **1.01x** | 1.00x |
| Browser: `node -e` compute script, JIT (s) | 35.0 | 35.8 | **0.98x** | 0.98x |
| Browser: `node -e` compute script, ?jit=0 (s) | 53.7 | 55.3 | **0.97x** | 0.98x |
| Browser: `node -e` MIPS, JIT | 13.2 | 12.9 | **0.98x** | 0.98x |

_speedup = ratio of the medians; paired = median of the per-rep ratios (each A/B pair ran back to back, or side by side for Alpine/CoreMark). On a loaded machine prefer the paired column and the CPU-time rows._

Native: Apple M4 Max, reps=3 (Alpine/CoreMark 1), run 2026-09-23T09:05:29+00:00, suite wall 18.4 min, median 1-min load avg 9.8 on 16 CPUs.
Browser: headless Chromium 131.0.6778.33, samples=3, run 2026-09-23T09:05:29.283Z, suite wall 16.2 min, median 1-min load avg 10.2 on 16 CPUs.

