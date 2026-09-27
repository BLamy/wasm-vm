# Browser benchmark (2026-09-27T20:13:16.667Z)

Chromium 131.0.6778.33 (headless=true) · Apple M4 Max · samples=3 · medians · interleaved=true

- **baseline**: `/Users/blamy/Documents/Codex/wasm-vm-base/web` rev `8297850913` (+uncommitted changes) wasm sha256 `f09e025172e4` (1.61 MB)
- **candidate**: `/Users/blamy/Documents/Codex/wasm-vm-perf/web` rev `fe98912fa2` wasm sha256 `f8b40d93039a` (1.63 MB)

| case | metric | baseline | candidate | speedup candidate vs baseline | ok |
|---|---|---:|---:|---:|---:|
| busybox-jit | (a) cold boot: navigation -> shell prompt s | 12.36 [12.34–12.87] | 4.73 [4.72–4.75] | 2.61x (paired 2.61x) | 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (boot span, wall) | 29.9 [29.1–29.9] | 84.4 [84.1–84.6] | 2.83x (paired 2.83x) | 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (inside runChunk) | 29.8 [29.2–29.9] | 84.3 [84.1–84.5] | 2.83x (paired 2.82x) | 3/3 · 3/3 |
| busybox-jit | (a) boot JIT-retired fraction | 0.704 | 0.707 | 1.00x | 3/3 · 3/3 |
| busybox-jit | (b) shell loop x10000: Enter -> done s | 10.26 [10.03–10.43] | 3.88 [3.53–3.92] | 2.65x (paired 2.66x) | 3/3 · 3/3 |
| busybox-jit | (b) shell loop MIPS (wall) | 16.2 [15.9–16.5] | 42.8 [42.4–47.1] | 2.65x (paired 2.66x) | 3/3 · 3/3 |
| busybox-jit | (b) shell loop JIT-retired fraction | 0.529 | 0.529 | 1.00x | 3/3 · 3/3 |
| busybox-nojit | (a) cold boot: navigation -> shell prompt s | 21.20 [21.15–21.61] | 5.33 [5.33–5.37] | 3.98x (paired 3.98x) | 3/3 · 3/3 |
| busybox-nojit | (a) boot MIPS (boot span, wall) | 17.1 [16.8–17.1] | 73.6 [73.2–73.9] | 4.30x (paired 4.30x) | 3/3 · 3/3 |
| busybox-nojit | (a) boot MIPS (inside runChunk) | 17.1 [16.7–17.1] | 73.6 [73.3–74.4] | 4.30x (paired 4.35x) | 3/3 · 3/3 |
| busybox-nojit | (b) shell loop x10000: Enter -> done s | 14.29 [14.14–14.31] | 2.99 [2.96–3.02] | 4.78x (paired 4.78x) | 3/3 · 3/3 |
| busybox-nojit | (b) shell loop MIPS (wall) | 11.6 [11.6–11.7] | 55.6 [55.0–56.0] | 4.78x (paired 4.78x) | 3/3 · 3/3 |
| node-jit | (c) snapshot restore: navigation -> prompt s | 1.27 [1.25–1.27] | 1.27 [1.26–1.27] | 1.00x (paired 1.00x) | 3/3 · 3/3 |
| node-jit | (c) node -e script: Enter -> done s | 32.87 [32.83–33.25] | 18.49 [18.44–18.52] | 1.78x (paired 1.78x) | 3/3 · 3/3 |
| node-jit | (c) node -e MIPS (wall) | 14.2 [14.0–14.2] | 25.1 [25.1–25.2] | 1.77x (paired 1.78x) | 3/3 · 3/3 |
| node-jit | (c) node -e JIT-retired fraction | 0.484 | 0.562 | 1.16x | 3/3 · 3/3 |
| node-nojit | (c) snapshot restore: navigation -> prompt s | 1.28 [1.26–1.29] | 1.29 [1.27–1.30] | 0.99x (paired 0.99x) | 3/3 · 3/3 |
| node-nojit | (c) node -e script: Enter -> done s | 50.42 [50.24–51.76] | 31.45 [31.42–32.03] | 1.60x (paired 1.60x) | 3/3 · 3/3 |
| node-nojit | (c) node -e MIPS (wall) | 9.2 [9.0–9.2] | 14.7 [14.5–14.8] | 1.60x (paired 1.60x) | 3/3 · 3/3 |

Cells: median [min–max over samples]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back).

All times are host clock (page performance.now()); MIPS = worker retired-instruction counter delta / host time. 'boot span' runs from the page's guest-booting event (includes kernel fetch + worker/wasm start) to the prompt; 'inside runChunk' divides by the worker's summed slice time (excludes scheduler yields and idle).

Median 1-minute load average: busybox-jit/baseline=2.5, busybox-jit/candidate=2.4, busybox-nojit/baseline=2.4, busybox-nojit/candidate=3.5, node-jit/baseline=3.3, node-jit/candidate=3.3, node-nojit/baseline=3.2, node-nojit/candidate=3.6
