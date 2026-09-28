# Browser benchmark (2026-09-23T08:41:45.607Z)

Chromium 131.0.6778.33 (headless=true) · Apple M4 Max · samples=3 · medians · interleaved=true

- **baseline**: `/Users/blamy/Documents/Codex/wasm-vm-base/web` rev `8297850913` (+uncommitted changes) wasm sha256 `f09e025172e4` (1.61 MB)
- **candidate**: `/Users/blamy/Documents/Codex/wasm-vm-t-bench/web` rev `ce356fd482` wasm sha256 `97a93031f137` (1.53 MB)

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-jit | (a) cold boot: navigation -> shell prompt s | 13.51 [13.38–14.84] | 15.05 [14.83–15.38] | 0.90x (paired 0.90x) | 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (boot span, wall) | 27.4 [24.8–27.5] | 24.4 [23.9–24.7] | 0.89x (paired 0.90x) | 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (inside runChunk) | 27.5 [24.7–27.5] | 24.4 [23.9–24.8] | 0.89x (paired 0.90x) | 3/3 · 3/3 |
| busybox-jit | (a) boot JIT-retired fraction | 0.705 | 0.705 | 1.00x | 3/3 · 3/3 |
| busybox-jit | (b) shell loop x10000: Enter -> done s | 11.26 [10.81–12.09] | 12.56 [10.99–12.70] | 0.90x (paired 0.95x) | 3/3 · 3/3 |
| busybox-jit | (b) shell loop MIPS (wall) | 14.7 [13.7–15.4] | 13.2 [13.1–15.1] | 0.90x (paired 0.95x) | 3/3 · 3/3 |
| busybox-jit | (b) shell loop JIT-retired fraction | 0.532 | 0.537 | 1.01x | 3/3 · 3/3 |
| busybox-nojit | (a) cold boot: navigation -> shell prompt s | 23.77 [22.26–26.15] | 25.19 [23.27–26.97] | 0.94x (paired 0.96x) | 3/3 · 3/3 |
| busybox-nojit | (a) boot MIPS (boot span, wall) | 15.2 [13.8–16.2] | 14.3 [13.4–15.5] | 0.94x (paired 0.95x) | 3/3 · 3/3 |
| busybox-nojit | (a) boot MIPS (inside runChunk) | 15.2 [13.8–16.3] | 14.4 [13.4–15.5] | 0.95x (paired 0.95x) | 3/3 · 3/3 |
| busybox-nojit | (b) shell loop x10000: Enter -> done s | 16.55 [14.59–17.30] | 16.37 [15.52–17.81] | 1.01x (paired 0.97x) | 3/3 · 3/3 |
| busybox-nojit | (b) shell loop MIPS (wall) | 10.0 [9.6–11.4] | 10.1 [9.3–10.7] | 1.01x (paired 0.97x) | 3/3 · 3/3 |
| node-jit | (c) snapshot restore: navigation -> prompt s | 1.25 [1.25–1.49] | 1.26 [1.25–1.33] | 0.99x (paired 1.00x) | 3/3 · 3/3 |
| node-jit | (c) node -e script: Enter -> done s | 36.19 [35.45–37.73] | 36.99 [35.29–38.93] | 0.98x (paired 0.98x) | 3/3 · 3/3 |
| node-jit | (c) node -e MIPS (wall) | 12.9 [12.3–13.1] | 12.5 [11.9–13.2] | 0.98x (paired 0.98x) | 3/3 · 3/3 |
| node-jit | (c) node -e JIT-retired fraction | 0.484 | 0.477 | 0.99x | 3/3 · 3/3 |
| node-nojit | (c) snapshot restore: navigation -> prompt s | 1.28 [1.28–1.47] | 1.51 [1.31–1.52] | 0.85x (paired 0.98x) | 3/3 · 3/3 |
| node-nojit | (c) node -e script: Enter -> done s | 58.41 [55.02–59.70] | 58.37 [57.08–63.97] | 1.00x (paired 0.96x) | 3/3 · 3/3 |
| node-nojit | (c) node -e MIPS (wall) | 7.9 [7.8–8.4] | 8.0 [7.3–8.1] | 1.00x (paired 0.96x) | 3/3 · 3/3 |

Cells: median [min–max over samples]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back).

All times are host clock (page performance.now()); MIPS = worker retired-instruction counter delta / host time. 'boot span' runs from the page's guest-booting event (includes kernel fetch + worker/wasm start) to the prompt; 'inside runChunk' divides by the worker's summed slice time (excludes scheduler yields and idle).

Median 1-minute load average: busybox-jit/baseline=14.5, busybox-jit/candidate=14.1, busybox-nojit/baseline=37.3, busybox-nojit/candidate=47.2, node-jit/baseline=42.4, node-jit/candidate=30.6, node-nojit/baseline=19.6, node-nojit/candidate=19.6
