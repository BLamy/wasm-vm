| metric (median; host clock / host CPU time) | baseline | candidate | speedup | paired |
|---|---:|---:|---:|---:|
| Native: busybox boot to userland, fast interpreter (s) | 13.05 | 3.39 | **3.85x** | 3.85x |
| Native: busybox boot to userland, --jit (s) | 11.92 | 5.04 | **2.36x** | 2.38x |
| Native: busybox boot to userland, legacy interpreter (s) | 35.16 | 5.81 | **6.05x** | 6.04x |
| Native: busybox boot CPU time, fast (s) | 13.03 | 3.38 | **3.86x** | 3.86x |
| Native: busybox boot CPU time, --jit (s) | 11.90 | 5.03 | **2.37x** | 2.37x |
| Native: busybox boot CPU time, legacy (s) | 35.09 | 5.79 | **6.07x** | 6.05x |
| Native: busybox boot MIPS, fast | 25.0 | 96.3 | **3.86x** | 3.86x |
| Native: busybox boot MIPS, --jit | 27.4 | 66.8 | **2.44x** | 2.45x |
| Native: shell arithmetic loop, fast (s) | 9.00 | 2.33 | **3.86x** | 3.88x |
| Native: shell arithmetic loop, --jit (s) | 7.74 | 3.44 | **2.25x** | 2.25x |
| Native: shell arithmetic loop CPU time, fast (s) | 8.99 | 2.33 | **3.86x** | 3.87x |
| Native: shell arithmetic loop CPU time, --jit (s) | 7.73 | 3.45 | **2.24x** | 2.24x |
| Native: shell loop MIPS, fast | 18.2 | 70.8 | **3.88x** | 3.88x |
| Native: shell loop MIPS, --jit | 21.3 | 47.9 | **2.25x** | 2.25x |
| Native: Alpine ext4 boot to login, fast (s) | 175.9 | 53.8 | **3.27x** | 3.27x |
| Native: Alpine ext4 boot to login, --jit (s) | 225.5 | 85.9 | **2.63x** | 2.63x |
| Native: Alpine boot CPU time, fast (s) | 175.8 | 53.7 | **3.27x** | 3.27x |
| Native: Alpine boot MIPS, --jit | 13.6 | 36.1 | **2.65x** | 2.65x |
| Native: CoreMark (6000 it) host time, fast (s) | 85.8 | 20.9 | **4.10x** | 4.10x |
| Native: CoreMark (6000 it) host time, --jit (s) | 55.9 | 27.3 | **2.05x** | 2.05x |
| Native: CoreMark iterations/s on the host clock, fast | 69.9 | 286.6 | **4.10x** | 4.10x |
| Native: CoreMark iterations/s on the host clock, --jit | 107.3 | 219.6 | **2.05x** | 2.05x |
| Native: CoreMark MIPS, --jit | 38.9 | 79.6 | **2.05x** | 2.05x |
| Native: ALU microbench MIPS (legacy) | 58.0 | 74.3 | **1.28x** | – |
| Native: ALU microbench MIPS (fast) | 92.7 | 160.1 | **1.73x** | – |
| Browser: busybox cold boot to prompt, JIT (s) | 12.36 | 4.73 | **2.61x** | 2.61x |
| Browser: busybox cold boot to prompt, ?jit=0 (s) | 21.20 | 5.33 | **3.98x** | 3.98x |
| Browser: busybox boot MIPS, JIT | 29.8 | 84.3 | **2.83x** | 2.82x |
| Browser: shell arithmetic loop, JIT (s) | 10.26 | 3.88 | **2.65x** | 2.66x |
| Browser: shell arithmetic loop, ?jit=0 (s) | 14.29 | 2.99 | **4.78x** | 4.78x |
| Browser: shell loop MIPS, JIT | 16.2 | 42.8 | **2.65x** | 2.66x |
| Browser: node-alpine snapshot restore to prompt, JIT (s) | 1.27 | 1.27 | **1.00x** | 1.00x |
| Browser: `node -e` compute script, JIT (s) | 32.9 | 18.5 | **1.78x** | 1.78x |
| Browser: `node -e` compute script, ?jit=0 (s) | 50.4 | 31.5 | **1.60x** | 1.60x |
| Browser: `node -e` MIPS, JIT | 14.2 | 25.1 | **1.77x** | 1.78x |

_speedup = ratio of the medians; paired = median of the per-rep ratios (each A/B pair ran back to back, or side by side for Alpine/CoreMark). On a loaded machine prefer the paired column and the CPU-time rows._

Native: Apple M4 Max, reps=3 (Alpine/CoreMark 1), run 2026-09-27T20:13:16+00:00, suite wall 13.4 min, median 1-min load avg 3.2 on 16 CPUs.
Browser: headless Chromium 131.0.6778.33, samples=3, run 2026-09-27T20:13:16.667Z, suite wall 11.2 min, median 1-min load avg 3.3 on 16 CPUs.

