| metric (median; host clock / host CPU time) | baseline | candidate | speedup | paired |
|---|---:|---:|---:|---:|
| Native: busybox boot to userland, fast interpreter (s) | 18.56 | 15.37 | **1.21x** | 1.37x |
| Native: busybox boot to userland, --jit (s) | 13.25 | 12.37 | **1.07x** | 1.05x |
| Native: busybox boot to userland, legacy interpreter (s) | 38.71 | 46.51 | **0.83x** | 1.22x |
| Native: busybox boot CPU time, fast (s) | 15.70 | 14.87 | **1.06x** | 1.16x |
| Native: busybox boot CPU time, --jit (s) | 13.21 | 12.33 | **1.07x** | 1.07x |
| Native: busybox boot CPU time, legacy (s) | 38.40 | 33.53 | **1.15x** | 1.21x |
| Native: busybox boot MIPS, fast | 17.5 | 21.2 | **1.21x** | 1.37x |
| Native: busybox boot MIPS, --jit | 24.6 | 26.4 | **1.07x** | 1.05x |
| Native: shell arithmetic loop, fast (s) | 9.87 | 8.71 | **1.13x** | 1.15x |
| Native: shell arithmetic loop, --jit (s) | 8.47 | 7.92 | **1.07x** | 1.07x |
| Native: shell arithmetic loop CPU time, fast (s) | 9.86 | 8.69 | **1.13x** | 1.13x |
| Native: shell arithmetic loop CPU time, --jit (s) | 8.45 | 7.91 | **1.07x** | 1.07x |
| Native: shell loop MIPS, fast | 16.7 | 18.9 | **1.13x** | 1.15x |
| Native: shell loop MIPS, --jit | 19.4 | 20.7 | **1.07x** | 1.07x |
| Native: Alpine ext4 boot to login, fast (s) | 213.3 | 192.4 | **1.11x** | 1.11x |
| Native: Alpine ext4 boot to login, --jit (s) | 281.6 | 266.7 | **1.06x** | 1.06x |
| Native: Alpine boot CPU time, fast (s) | 209.2 | 189.4 | **1.10x** | 1.10x |
| Native: Alpine boot MIPS, --jit | 10.9 | 11.5 | **1.06x** | 1.06x |
| Native: CoreMark (6000 it) host time, fast (s) | 142.5 | 125.9 | **1.13x** | 1.13x |
| Native: CoreMark (6000 it) host time, --jit (s) | 103.6 | 95.1 | **1.09x** | 1.09x |
| Native: CoreMark iterations/s on the host clock, fast | 42.1 | 47.6 | **1.13x** | 1.13x |
| Native: CoreMark iterations/s on the host clock, --jit | 57.9 | 63.1 | **1.09x** | 1.09x |
| Native: CoreMark MIPS, --jit | 21.0 | 22.9 | **1.09x** | 1.09x |
| Native: ALU microbench MIPS (legacy) | 54.2 | 48.4 | **0.89x** | – |
| Native: ALU microbench MIPS (fast) | 83.7 | 88.8 | **1.06x** | – |
| Browser: busybox cold boot to prompt, JIT (s) | 13.51 | 15.05 | **0.90x** | 0.90x |
| Browser: busybox cold boot to prompt, ?jit=0 (s) | 23.77 | 25.19 | **0.94x** | 0.96x |
| Browser: busybox boot MIPS, JIT | 27.5 | 24.4 | **0.89x** | 0.90x |
| Browser: shell arithmetic loop, JIT (s) | 11.26 | 12.56 | **0.90x** | 0.95x |
| Browser: shell arithmetic loop, ?jit=0 (s) | 16.55 | 16.37 | **1.01x** | 0.97x |
| Browser: shell loop MIPS, JIT | 14.7 | 13.2 | **0.90x** | 0.95x |
| Browser: node-alpine snapshot restore to prompt, JIT (s) | 1.25 | 1.26 | **0.99x** | 1.00x |
| Browser: `node -e` compute script, JIT (s) | 36.2 | 37.0 | **0.98x** | 0.98x |
| Browser: `node -e` compute script, ?jit=0 (s) | 58.4 | 58.4 | **1.00x** | 0.96x |
| Browser: `node -e` MIPS, JIT | 12.9 | 12.5 | **0.98x** | 0.98x |

_speedup = ratio of the medians; paired = median of the per-rep ratios (each A/B pair ran back to back, or side by side for Alpine/CoreMark). On a loaded machine prefer the paired column and the CPU-time rows._

Native: Apple M4 Max, reps=3 (Alpine/CoreMark 1), run 2026-09-23T08:41:45+00:00, suite wall 22.3 min, median 1-min load avg 30.7 on 16 CPUs.
Browser: headless Chromium 131.0.6778.33, samples=3, run 2026-09-23T08:41:45.607Z, suite wall 17.1 min, median 1-min load avg 30.6 on 16 CPUs.

