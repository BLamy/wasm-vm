# Browser benchmark (2026-10-02T20:28:21.906Z)

Chromium 154.0.8037.93 (headless=true) · Apple M4 Max · samples=5 · medians · interleaved=true

- **baseline**: `/Users/blamy/.codex/worktrees/emulator-speed-next/wasm-vm/web` rev `a6ae84fd1c` wasm sha256 `f8b40d93039a` (1.63 MB)
- **candidate**: `/Users/blamy/.codex/worktrees/mips-throughput/wasm-vm/web` rev `ee7ed352da` wasm sha256 `70de75fd1a2c` (1.63 MB)

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-jit | (a) cold boot: navigation -> shell prompt s | 4.69 [4.56–4.87] | 4.64 [4.45–4.71] | 1.01x (paired 1.02x) | 5/5 · 5/5 |
| busybox-jit | (a) boot MIPS (boot span, wall) | 84.9 [83.3–87.5] | 85.7 [84.8–89.8] | 1.01x (paired 1.02x) | 5/5 · 5/5 |
| busybox-jit | (a) boot MIPS (inside runChunk) | 84.9 [84.1–88.8] | 87.0 [85.3–91.1] | 1.02x (paired 1.02x) | 5/5 · 5/5 |
| busybox-jit | (a) boot JIT-retired fraction | 0.710 | 0.710 | 1.00x | 5/5 · 5/5 |
| busybox-jit | (b) shell loop x10000: Enter -> done s | 3.60 [3.54–3.77] | 3.65 [3.50–3.85] | 0.98x (paired 1.01x) | 5/5 · 5/5 |
| busybox-jit | (b) shell loop MIPS (wall) | 46.1 [44.1–46.9] | 45.4 [43.2–47.4] | 0.98x (paired 1.01x) | 5/5 · 5/5 |
| busybox-jit | (b) shell loop JIT-retired fraction | 0.531 | 0.518 | 0.98x | 5/5 · 5/5 |
| busybox-nojit | (a) cold boot: navigation -> shell prompt s | 5.01 [4.89–5.06] | 4.67 [4.48–4.77] | 1.07x (paired 1.08x) | 5/5 · 5/5 |
| busybox-nojit | (a) boot MIPS (boot span, wall) | 79.1 [78.1–81.3] | 85.3 [83.3–90.0] | 1.08x (paired 1.09x) | 5/5 · 5/5 |
| busybox-nojit | (a) boot MIPS (inside runChunk) | 79.1 [78.8–81.7] | 86.4 [84.5–89.5] | 1.09x (paired 1.09x) | 5/5 · 5/5 |
| busybox-nojit | (b) shell loop x10000: Enter -> done s | 2.84 [2.83–2.94] | 2.79 [2.72–2.92] | 1.02x (paired 1.04x) | 5/5 · 5/5 |
| busybox-nojit | (b) shell loop MIPS (wall) | 58.4 [56.4–58.7] | 59.4 [56.9–61.0] | 1.02x (paired 1.04x) | 5/5 · 5/5 |

Cells: median [min–max over samples]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back).

All times are host clock (page performance.now()); MIPS = worker retired-instruction counter delta / host time. 'boot span' runs from the page's guest-booting event (includes kernel fetch + worker/wasm start) to the prompt; 'inside runChunk' divides by the worker's summed slice time (excludes scheduler yields and idle).

Median 1-minute load average: busybox-jit/baseline=4.4, busybox-jit/candidate=4.1, busybox-nojit/baseline=4.4, busybox-nojit/candidate=3.9
