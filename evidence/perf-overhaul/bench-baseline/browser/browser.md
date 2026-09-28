# Browser benchmark (2026-09-23T09:05:29.283Z)

Chromium 131.0.6778.33 (headless=true) · Apple M4 Max · samples=3 · medians · interleaved=true

- **baseline**: `/Users/blamy/Documents/Codex/wasm-vm-base/web` rev `8297850913` (+uncommitted changes) wasm sha256 `f09e025172e4` (1.61 MB)
- **candidate**: `/Users/blamy/Documents/Codex/wasm-vm-t-bench/web` rev `d378e98af0` wasm sha256 `97a93031f137` (1.53 MB)

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-jit | (a) cold boot: navigation -> shell prompt s | 12.92 [12.81–15.21] | 13.30 [13.30–13.46] | 0.97x (paired 0.97x) | 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (boot span, wall) | 28.5 [24.2–29.0] | 27.6 [27.3–27.6] | 0.97x (paired 0.97x) | 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (inside runChunk) | 28.5 [24.2–29.1] | 27.7 [27.3–27.7] | 0.97x (paired 0.97x) | 3/3 · 3/3 |
| busybox-jit | (a) boot JIT-retired fraction | 0.706 | 0.705 | 1.00x | 3/3 · 3/3 |
| busybox-jit | (b) shell loop x10000: Enter -> done s | 10.78 [10.53–12.60] | 11.08 [10.76–12.58] | 0.97x (paired 1.00x) | 3/3 · 3/3 |
| busybox-jit | (b) shell loop MIPS (wall) | 15.4 [13.2–15.8] | 15.0 [13.2–15.4] | 0.97x (paired 1.00x) | 3/3 · 3/3 |
| busybox-jit | (b) shell loop JIT-retired fraction | 0.526 | 0.523 | 0.99x | 3/3 · 3/3 |
| busybox-nojit | (a) cold boot: navigation -> shell prompt s | 21.90 [21.75–22.46] | 23.86 [22.40–25.43] | 0.92x (paired 0.94x) | 3/3 · 3/3 |
| busybox-nojit | (a) boot MIPS (boot span, wall) | 16.5 [16.1–16.6] | 15.2 [14.2–16.1] | 0.92x (paired 0.94x) | 3/3 · 3/3 |
| busybox-nojit | (a) boot MIPS (inside runChunk) | 16.5 [16.1–16.7] | 15.2 [14.2–16.1] | 0.92x (paired 0.94x) | 3/3 · 3/3 |
| busybox-nojit | (b) shell loop x10000: Enter -> done s | 14.57 [14.53–15.57] | 15.08 [14.86–15.90] | 0.97x (paired 0.98x) | 3/3 · 3/3 |
| busybox-nojit | (b) shell loop MIPS (wall) | 11.4 [10.7–11.4] | 11.0 [10.4–11.2] | 0.97x (paired 0.98x) | 3/3 · 3/3 |
| node-jit | (c) snapshot restore: navigation -> prompt s | 1.27 [1.25–1.36] | 1.27 [1.26–1.31] | 1.01x (paired 1.00x) | 3/3 · 3/3 |
| node-jit | (c) node -e script: Enter -> done s | 34.99 [34.24–37.05] | 35.82 [35.01–37.71] | 0.98x (paired 0.98x) | 3/3 · 3/3 |
| node-jit | (c) node -e MIPS (wall) | 13.2 [12.5–13.6] | 12.9 [12.3–13.3] | 0.98x (paired 0.98x) | 3/3 · 3/3 |
| node-jit | (c) node -e JIT-retired fraction | 0.477 | 0.484 | 1.01x | 3/3 · 3/3 |
| node-nojit | (c) snapshot restore: navigation -> prompt s | 1.29 [1.28–1.38] | 1.34 [1.29–1.35] | 0.97x (paired 1.00x) | 3/3 · 3/3 |
| node-nojit | (c) node -e script: Enter -> done s | 53.69 [53.43–57.30] | 55.34 [54.40–57.45] | 0.97x (paired 0.98x) | 3/3 · 3/3 |
| node-nojit | (c) node -e MIPS (wall) | 8.6 [8.1–8.7] | 8.4 [8.1–8.5] | 0.97x (paired 0.98x) | 3/3 · 3/3 |

Cells: median [min–max over samples]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back).

All times are host clock (page performance.now()); MIPS = worker retired-instruction counter delta / host time. 'boot span' runs from the page's guest-booting event (includes kernel fetch + worker/wasm start) to the prompt; 'inside runChunk' divides by the worker's summed slice time (excludes scheduler yields and idle).

Median 1-minute load average: busybox-jit/baseline=11.8, busybox-jit/candidate=9.8, busybox-nojit/baseline=10.4, busybox-nojit/candidate=9.9, node-jit/baseline=9.6, node-jit/candidate=9.7, node-nojit/baseline=15.4, node-nojit/candidate=10.6
