# Browser benchmark (2026-10-03T01:16:19.927Z)

Chromium 154.0.8037.93 (headless=true) · Apple M4 Max · samples=3 · medians · interleaved=true

- **baseline**: `/tmp/wasm-vm-direct-memory-baseline/web` rev `?` wasm sha256 `70de75fd1a2c` (1.63 MB)
- **candidate**: `/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm/web` rev `0447e1c206` (+uncommitted changes) wasm sha256 `4f1005a174e6` (1.63 MB)

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-jit | (a) cold boot: navigation -> shell prompt s | 4.75 [4.74–4.88] | 4.72 [4.71–4.74] | 1.01x (paired 1.01x) | 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (boot span, wall) | 83.9 [83.5–84.3] | 84.7 [84.6–85.0] | 1.01x (paired 1.01x) | 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (inside runChunk) | 84.9 [84.7–85.0] | 85.3 [84.9–85.5] | 1.00x (paired 1.00x) | 3/3 · 3/3 |
| busybox-jit | (a) boot JIT-retired fraction | 0.710 | 0.709 | 1.00x | 3/3 · 3/3 |
| busybox-jit | (b) shell loop x10000: Enter -> done s | 3.70 [3.65–3.75] | 3.82 [3.67–3.82] | 0.97x (paired 0.98x) | 3/3 · 3/3 |
| busybox-jit | (b) shell loop MIPS (wall) | 44.8 [44.3–45.4] | 43.4 [43.4–45.2] | 0.97x (paired 0.98x) | 3/3 · 3/3 |
| busybox-jit | (b) shell loop JIT-retired fraction | 0.532 | 0.523 | 0.98x | 3/3 · 3/3 |

Cells: median [min–max over samples]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back).

All times are host clock (page performance.now()); MIPS = worker retired-instruction counter delta / host time. 'boot span' runs from the page's guest-booting event (includes kernel fetch + worker/wasm start) to the prompt; 'inside runChunk' divides by the worker's summed slice time (excludes scheduler yields and idle).

Median 1-minute load average: busybox-jit/baseline=6.3, busybox-jit/candidate=6.9
