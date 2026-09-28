# Browser benchmark (2026-09-27T15:14:08.163Z)

Chromium 131.0.6778.33 (headless=true) · Apple M4 Max · samples=3 · medians · interleaved=true

- **base**: `/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/c38a19b9-ce95-4fcc-b09d-e4bcfb239086/scratchpad/webbuild/roots/base` rev `?` wasm sha256 `f09e025172e4` (1.61 MB)
- **lto-head**: `/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/c38a19b9-ce95-4fcc-b09d-e4bcfb239086/scratchpad/webbuild/roots/B_O3` rev `?` wasm sha256 `97a93031f137` (1.53 MB)
- **wasm-release**: `/Users/blamy/Documents/Codex/wasm-vm-t-webbuild/web` rev `6a5428f4a8` wasm sha256 `43d1dae42a10` (1.61 MB)

| case | metric | base | lto-head | wasm-release | speedup lto-head vs base | speedup wasm-release vs base | ok |
|---|---|---:|---:|---:|---:|---:|---:|
| busybox-jit | (a) cold boot: navigation -> shell prompt s | 12.85 [12.65–12.87] | 12.93 [12.78–12.94] | 12.30 [12.04–12.45] | 0.99x (paired 0.99x) | 1.04x (paired 1.05x) | 3/3 · 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (boot span, wall) | 28.8 [28.8–29.1] | 28.5 [28.4–28.8] | 30.1 [29.9–30.8] | 0.99x (paired 0.99x) | 1.04x (paired 1.04x) | 3/3 · 3/3 · 3/3 |
| busybox-jit | (a) boot MIPS (inside runChunk) | 28.9 [28.7–29.1] | 28.5 [28.2–28.8] | 30.0 [29.8–30.7] | 0.98x (paired 0.99x) | 1.04x (paired 1.04x) | 3/3 · 3/3 · 3/3 |
| busybox-jit | (a) boot JIT-retired fraction | 0.704 | 0.704 | 0.705 | 1.00x | 1.00x | 3/3 · 3/3 · 3/3 |
| busybox-jit | (b) shell loop x10000: Enter -> done s | 10.75 [10.50–10.76] | 10.54 [10.40–10.81] | 10.23 [10.05–10.29] | 1.02x (paired 1.02x) | 1.05x (paired 1.05x) | 3/3 · 3/3 · 3/3 |
| busybox-jit | (b) shell loop MIPS (wall) | 15.4 [15.4–15.8] | 15.8 [15.4–16.0] | 16.2 [16.1–16.5] | 1.02x (paired 1.02x) | 1.05x (paired 1.05x) | 3/3 · 3/3 · 3/3 |
| busybox-jit | (b) shell loop JIT-retired fraction | 0.523 | 0.532 | 0.529 | 1.02x | 1.01x | 3/3 · 3/3 · 3/3 |
| busybox-nojit | (a) cold boot: navigation -> shell prompt s | 21.43 [21.09–21.61] | 22.12 [21.89–23.53] | 21.05 [20.96–21.21] | 0.97x (paired 0.96x) | 1.02x (paired 1.02x) | 3/3 · 3/3 · 3/3 |
| busybox-nojit | (a) boot MIPS (boot span, wall) | 16.9 [16.7–17.2] | 16.3 [15.3–16.5] | 17.1 [17.1–17.3] | 0.97x (paired 0.96x) | 1.02x (paired 1.02x) | 3/3 · 3/3 · 3/3 |
| busybox-nojit | (a) boot MIPS (inside runChunk) | 16.9 [16.7–17.2] | 16.3 [15.3–16.5] | 17.2 [17.1–17.2] | 0.96x (paired 0.96x) | 1.01x (paired 1.01x) | 3/3 · 3/3 · 3/3 |
| busybox-nojit | (b) shell loop x10000: Enter -> done s | 14.44 [14.41–14.47] | 14.88 [14.80–15.45] | 13.93 [13.91–14.13] | 0.97x (paired 0.97x) | 1.04x (paired 1.04x) | 3/3 · 3/3 · 3/3 |
| busybox-nojit | (b) shell loop MIPS (wall) | 11.5 [11.5–11.5] | 11.2 [10.7–11.2] | 11.9 [11.8–11.9] | 0.97x (paired 0.97x) | 1.04x (paired 1.04x) | 3/3 · 3/3 · 3/3 |
| node-jit | (c) snapshot restore: navigation -> prompt s | 1.25 [1.24–1.30] | 1.25 [1.25–1.26] | 1.28 [1.25–1.32] | 1.00x (paired 1.00x) | 0.97x (paired 0.98x) | 3/3 · 3/3 · 3/3 |
| node-jit | (c) node -e script: Enter -> done s | 33.94 [33.83–34.15] | 34.64 [34.34–34.77] | 32.77 [32.08–34.42] | 0.98x (paired 0.98x) | 1.04x (paired 1.04x) | 3/3 · 3/3 · 3/3 |
| node-jit | (c) node -e MIPS (wall) | 13.7 [13.6–13.8] | 13.4 [13.4–13.6] | 14.2 [13.5–14.5] | 0.98x (paired 0.98x) | 1.04x (paired 1.04x) | 3/3 · 3/3 · 3/3 |
| node-jit | (c) node -e JIT-retired fraction | 0.484 | 0.484 | 0.489 | 1.00x | 1.01x | 3/3 · 3/3 · 3/3 |
| node-nojit | (c) snapshot restore: navigation -> prompt s | 1.27 [1.26–1.34] | 1.34 [1.26–1.44] | 1.28 [1.28–1.54] | 0.95x (paired 0.94x) | 0.99x (paired 0.99x) | 3/3 · 3/3 · 3/3 |
| node-nojit | (c) node -e script: Enter -> done s | 51.44 [50.87–55.91] | 53.56 [51.75–55.90] | 50.23 [49.87–57.95] | 0.96x (paired 0.98x) | 1.02x (paired 1.02x) | 3/3 · 3/3 · 3/3 |
| node-nojit | (c) node -e MIPS (wall) | 9.0 [8.3–9.1] | 8.7 [8.3–9.0] | 9.2 [8.0–9.3] | 0.96x (paired 0.98x) | 1.02x (paired 1.02x) | 3/3 · 3/3 · 3/3 |

Cells: median [min–max over samples]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back).

All times are host clock (page performance.now()); MIPS = worker retired-instruction counter delta / host time. 'boot span' runs from the page's guest-booting event (includes kernel fetch + worker/wasm start) to the prompt; 'inside runChunk' divides by the worker's summed slice time (excludes scheduler yields and idle).

Median 1-minute load average: busybox-jit/base=6.6, busybox-jit/lto-head=6.4, busybox-jit/wasm-release=6.1, busybox-nojit/base=6.4, busybox-nojit/lto-head=5.2, busybox-nojit/wasm-release=4.4, node-jit/base=5.2, node-jit/lto-head=5.0, node-jit/wasm-release=4.9, node-nojit/base=8.2, node-nojit/lto-head=4.6, node-nojit/wasm-release=4.5
