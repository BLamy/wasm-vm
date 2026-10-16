# Browser benchmark (2026-10-02T20:05:54.262Z)

Chromium 154.0.8037.93 (headless=true) · Apple M4 Max · samples=3 · medians · interleaved=true

- **baseline**: `/Users/blamy/.codex/worktrees/emulator-speed-next/wasm-vm/web` rev `a6ae84fd1c` wasm sha256 `f8b40d93039a` (1.63 MB)
- **candidate**: `/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm/web` rev `87d6bc0519` (+uncommitted changes) wasm sha256 `70de75fd1a2c` (1.63 MB)

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-jit | (a) cold boot: navigation -> shell prompt s | 4.90 [4.80–4.91] | 4.68 [4.65–4.76] | 1.05x (paired 1.05x) | 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (boot span, wall) | 83.0 [81.1–83.0] | 86.1 [84.0–86.1] | 1.04x (paired 1.04x) | 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (inside runChunk) | 83.0 [81.0–84.6] | 85.8 [85.1–87.2] | 1.03x (paired 1.03x) | 3/3 · 3/3 |
| busybox-jit | (a) boot JIT-retired fraction | 0.709 | 0.711 | 1.00x | 3/3 · 3/3 |
| busybox-jit | (b) shell loop x10000: Enter -> done s | 3.78 [3.76–3.79] | 3.82 [3.68–3.93] | 0.99x (paired 0.99x) | 3/3 · 3/3 |
| busybox-jit | (b) shell loop MIPS (wall) | 43.9 [43.8–44.1] | 43.5 [42.3–45.1] | 0.99x (paired 0.99x) | 3/3 · 3/3 |
| busybox-jit | (b) shell loop JIT-retired fraction | 0.519 | 0.532 | 1.02x | 3/3 · 3/3 |
| busybox-nojit | (a) cold boot: navigation -> shell prompt s | 5.10 [5.07–5.18] | 4.73 [4.68–5.17] | 1.08x (paired 1.08x) | 3/3 · 3/3 |
| busybox-nojit | (a) boot MIPS (boot span, wall) | 77.9 [76.1–78.2] | 84.7 [76.4–84.8] | 1.09x (paired 1.08x) | 3/3 · 3/3 |
| busybox-nojit | (a) boot MIPS (inside runChunk) | 77.7 [77.4–78.5] | 84.7 [77.1–86.2] | 1.09x (paired 1.09x) | 3/3 · 3/3 |
| busybox-nojit | (b) shell loop x10000: Enter -> done s | 2.92 [2.92–2.94] | 2.83 [2.82–3.00] | 1.03x (paired 1.04x) | 3/3 · 3/3 |
| busybox-nojit | (b) shell loop MIPS (wall) | 56.8 [56.4–56.8] | 58.6 [55.4–58.8] | 1.03x (paired 1.04x) | 3/3 · 3/3 |

Cells: median [min–max over samples]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back).

All times are host clock (page performance.now()); MIPS = worker retired-instruction counter delta / host time. 'boot span' runs from the page's guest-booting event (includes kernel fetch + worker/wasm start) to the prompt; 'inside runChunk' divides by the worker's summed slice time (excludes scheduler yields and idle).

Median 1-minute load average: busybox-jit/baseline=7.4, busybox-jit/candidate=7.1, busybox-nojit/baseline=7.0, busybox-nojit/candidate=7.1
