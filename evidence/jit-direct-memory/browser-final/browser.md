# Browser benchmark (2026-10-03T01:35:00.778Z)

Chromium 154.0.8037.93 (headless=true) · Apple M4 Max · samples=5 · medians · interleaved=true

- **baseline**: `/tmp/wasm-vm-direct-memory-baseline/web` rev `?` wasm sha256 `70de75fd1a2c` (1.63 MB)
- **candidate**: `/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm/web` rev `7e51177d96` wasm sha256 `4f1005a174e6` (1.63 MB)

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-jit | (a) cold boot: navigation -> shell prompt s | 4.87 [4.46–4.98] | 4.78 [4.50–4.89] | 1.02x (paired 1.02x) | 5/5 · 5/5 |
| busybox-jit | (a) boot MIPS (boot span, wall) | 82.5 [80.5–89.4] | 83.8 [81.0–89.4] | 1.02x (paired 1.01x) | 5/5 · 5/5 |
| busybox-jit | (a) boot MIPS (inside runChunk) | 82.9 [81.4–91.3] | 84.2 [82.4–89.3] | 1.02x (paired 1.01x) | 5/5 · 5/5 |
| busybox-jit | (a) boot JIT-retired fraction | 0.710 | 0.709 | 1.00x | 5/5 · 5/5 |
| busybox-jit | (b) shell loop x10000: Enter -> done s | 3.92 [3.60–4.03] | 3.87 [3.64–3.93] | 1.01x (paired 1.01x) | 5/5 · 5/5 |
| busybox-jit | (b) shell loop MIPS (wall) | 42.3 [41.2–46.1] | 42.9 [42.2–45.6] | 1.01x (paired 1.01x) | 5/5 · 5/5 |
| busybox-jit | (b) shell loop JIT-retired fraction | 0.522 | 0.527 | 1.01x | 5/5 · 5/5 |
| busybox-nojit | (a) cold boot: navigation -> shell prompt s | 4.68 [4.52–4.87] | 4.72 [4.52–4.92] | 0.99x (paired 0.99x) | 5/5 · 5/5 |
| busybox-nojit | (a) boot MIPS (boot span, wall) | 85.8 [81.8–88.8] | 84.7 [81.6–88.8] | 0.99x (paired 0.99x) | 5/5 · 5/5 |
| busybox-nojit | (a) boot MIPS (inside runChunk) | 85.3 [82.8–89.5] | 85.0 [81.6–88.9] | 1.00x (paired 0.99x) | 5/5 · 5/5 |
| busybox-nojit | (b) shell loop x10000: Enter -> done s | 2.86 [2.73–2.96] | 2.87 [2.72–2.96] | 1.00x (paired 1.00x) | 5/5 · 5/5 |
| busybox-nojit | (b) shell loop MIPS (wall) | 58.1 [56.1–60.8] | 57.9 [56.0–61.0] | 1.00x (paired 1.00x) | 5/5 · 5/5 |

Cells: median [min–max over samples]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back).

All times are host clock (page performance.now()); MIPS = worker retired-instruction counter delta / host time. 'boot span' runs from the page's guest-booting event (includes kernel fetch + worker/wasm start) to the prompt; 'inside runChunk' divides by the worker's summed slice time (excludes scheduler yields and idle).

Median 1-minute load average: busybox-jit/baseline=7.0, busybox-jit/candidate=7.6, busybox-nojit/baseline=6.7, busybox-nojit/candidate=6.7
