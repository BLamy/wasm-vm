# Browser benchmark (2026-10-02T00:12:33.528Z)

Chromium 154.0.8037.93 (headless=true) · Apple M4 Max · samples=5 · medians · interleaved=true

- **baseline**: `/tmp/wasm-vm-current-speed-work/web` rev `ec178d579a` wasm sha256 `f8b40d93039a` (1.63 MB)
- **candidate**: `/Users/blamy/.codex/worktrees/emulator-speed-next/wasm-vm/web` rev `6fb20757eb` wasm sha256 `10bfb9c87f14` (1.63 MB)

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-jit | (a) cold boot: navigation -> shell prompt s | 4.90 [4.84–5.05] | 4.91 [4.84–4.92] | 1.00x (paired 1.00x) | 5/5 · 5/5 |
| busybox-jit | (a) boot MIPS (boot span, wall) | 82.1 [81.5–83.1] | 81.6 [80.9–82.5] | 0.99x (paired 0.99x) | 5/5 · 5/5 |
| busybox-jit | (a) boot MIPS (inside runChunk) | 82.9 [82.7–83.2] | 82.6 [82.1–83.1] | 1.00x (paired 1.00x) | 5/5 · 5/5 |
| busybox-jit | (a) boot JIT-retired fraction | 0.710 | 0.710 | 1.00x | 5/5 · 5/5 |
| busybox-jit | (b) shell loop x10000: Enter -> done s | 3.90 [3.72–3.94] | 3.76 [3.67–3.86] | 1.04x (paired 1.03x) | 5/5 · 5/5 |
| busybox-jit | (b) shell loop MIPS (wall) | 42.6 [42.2–44.6] | 44.1 [43.0–45.3] | 1.04x (paired 1.03x) | 5/5 · 5/5 |
| busybox-jit | (b) shell loop JIT-retired fraction | 0.525 | 0.530 | 1.01x | 5/5 · 5/5 |
| busybox-nojit | (a) cold boot: navigation -> shell prompt s | 5.17 [5.16–5.24] | 5.20 [5.19–5.35] | 0.99x (paired 0.99x) | 5/5 · 5/5 |
| busybox-nojit | (a) boot MIPS (boot span, wall) | 77.0 [76.7–77.6] | 76.2 [75.8–76.4] | 0.99x (paired 0.99x) | 5/5 · 5/5 |
| busybox-nojit | (a) boot MIPS (inside runChunk) | 77.1 [76.7–77.4] | 76.8 [75.8–76.8] | 1.00x (paired 1.00x) | 5/5 · 5/5 |
| busybox-nojit | (b) shell loop x10000: Enter -> done s | 2.95 [2.93–2.98] | 2.99 [2.93–3.03] | 0.99x (paired 0.99x) | 5/5 · 5/5 |
| busybox-nojit | (b) shell loop MIPS (wall) | 56.3 [55.8–56.6] | 55.5 [54.8–56.7] | 0.99x (paired 0.99x) | 5/5 · 5/5 |

Cells: median [min–max over samples]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back).

All times are host clock (page performance.now()); MIPS = worker retired-instruction counter delta / host time. 'boot span' runs from the page's guest-booting event (includes kernel fetch + worker/wasm start) to the prompt; 'inside runChunk' divides by the worker's summed slice time (excludes scheduler yields and idle).

Median 1-minute load average: busybox-jit/baseline=7.5, busybox-jit/candidate=7.6, busybox-nojit/baseline=7.3, busybox-nojit/candidate=7.6
