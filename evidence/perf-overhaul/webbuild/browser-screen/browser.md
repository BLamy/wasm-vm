# Browser benchmark (2026-09-27T14:39:18.974Z)

Chromium 131.0.6778.33 (headless=true) · Apple M4 Max · samples=5 · medians · interleaved=true

- **A_O**: `/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/c38a19b9-ce95-4fcc-b09d-e4bcfb239086/scratchpad/webbuild/roots/A_O` rev `?` wasm sha256 `56dd2abd537f` (1.60 MB)
- **B_O3**: `/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/c38a19b9-ce95-4fcc-b09d-e4bcfb239086/scratchpad/webbuild/roots/B_O3` rev `?` wasm sha256 `97a93031f137` (1.53 MB)
- **A_O3**: `/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/c38a19b9-ce95-4fcc-b09d-e4bcfb239086/scratchpad/webbuild/roots/A_O3` rev `?` wasm sha256 `ffb5e4db26cf` (1.60 MB)
- **RFAT16_O3**: `/private/tmp/claude-501/-Users-blamy-Documents-Codex-wasm-vm/c38a19b9-ce95-4fcc-b09d-e4bcfb239086/scratchpad/webbuild/roots/RFAT16_O3` rev `?` wasm sha256 `8bf3ad5a33a6` (1.61 MB)

| case | metric | A_O | B_O3 | A_O3 | RFAT16_O3 | speedup B_O3 vs A_O | speedup A_O3 vs A_O | speedup RFAT16_O3 vs A_O | ok |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| busybox-jit | (a) cold boot: navigation -> shell prompt s | 12.73 [12.55–13.14] | 12.80 [12.72–12.91] | 12.97 [12.54–13.67] | 12.38 [12.19–12.76] | 0.99x (paired 0.99x) | 0.98x (paired 0.98x) | 1.03x (paired 1.02x) | 5/5 · 5/5 · 5/5 · 5/5 |
| busybox-jit | (a) boot MIPS (boot span, wall) | 29.1 [28.1–29.4] | 28.8 [28.5–29.1] | 28.5 [27.0–29.5] | 29.8 [28.9–30.3] | 0.99x (paired 0.98x) | 0.98x (paired 0.97x) | 1.03x (paired 1.01x) | 5/5 · 5/5 · 5/5 · 5/5 |
| busybox-jit | (a) boot MIPS (inside runChunk) | 29.1 [28.0–29.3] | 28.8 [28.5–29.2] | 28.6 [26.9–29.6] | 29.9 [28.9–30.2] | 0.99x (paired 0.98x) | 0.98x (paired 0.97x) | 1.03x (paired 1.02x) | 5/5 · 5/5 · 5/5 · 5/5 |
| busybox-jit | (a) boot JIT-retired fraction | 0.703 | 0.704 | 0.705 | 0.704 | 1.00x | 1.00x | 1.00x | 5/5 · 5/5 · 5/5 · 5/5 |
| busybox-jit | (b) shell loop x10000: Enter -> done s | 10.44 [10.29–10.68] | 10.54 [10.48–10.74] | 10.74 [10.27–12.22] | 10.07 [9.82–11.68] | 0.99x (paired 0.99x) | 0.97x (paired 0.99x) | 1.04x (paired 1.05x) | 5/5 · 5/5 · 5/5 · 5/5 |
| busybox-jit | (b) shell loop MIPS (wall) | 15.9 [15.5–16.1] | 15.8 [15.5–15.8] | 15.5 [13.6–16.2] | 16.5 [14.2–16.9] | 0.99x (paired 0.99x) | 0.97x (paired 0.99x) | 1.04x (paired 1.05x) | 5/5 · 5/5 · 5/5 · 5/5 |
| busybox-jit | (b) shell loop JIT-retired fraction | 0.535 | 0.530 | 0.535 | 0.533 | 0.99x | 1.00x | 1.00x | 5/5 · 5/5 · 5/5 · 5/5 |
| busybox-nojit | (a) cold boot: navigation -> shell prompt s | 21.66 [21.35–23.73] | 22.09 [21.96–22.53] | 21.46 [21.33–22.05] | 21.16 [21.01–21.59] | 0.98x (paired 0.98x) | 1.01x (paired 1.01x) | 1.02x (paired 1.01x) | 5/5 · 5/5 · 5/5 · 5/5 |
| busybox-nojit | (a) boot MIPS (boot span, wall) | 16.8 [15.2–17.0] | 16.4 [16.0–16.5] | 16.8 [16.4–16.9] | 17.1 [16.8–17.2] | 0.97x (paired 0.97x) | 1.00x (paired 1.00x) | 1.01x (paired 1.01x) | 5/5 · 5/5 · 5/5 · 5/5 |
| busybox-nojit | (a) boot MIPS (inside runChunk) | 16.9 [15.3–17.0] | 16.3 [16.0–16.5] | 16.8 [16.4–16.9] | 17.1 [16.8–17.2] | 0.97x (paired 0.97x) | 1.00x (paired 1.00x) | 1.01x (paired 1.01x) | 5/5 · 5/5 · 5/5 · 5/5 |
| busybox-nojit | (b) shell loop x10000: Enter -> done s | 14.52 [14.28–15.82] | 15.32 [14.62–16.22] | 14.45 [14.37–15.30] | 13.98 [13.91–14.85] | 0.95x (paired 0.98x) | 1.01x (paired 1.00x) | 1.04x (paired 1.03x) | 5/5 · 5/5 · 5/5 · 5/5 |
| busybox-nojit | (b) shell loop MIPS (wall) | 11.4 [10.5–11.6] | 10.8 [10.2–11.4] | 11.5 [10.8–11.6] | 11.9 [11.2–11.9] | 0.95x (paired 0.98x) | 1.01x (paired 1.00x) | 1.04x (paired 1.03x) | 5/5 · 5/5 · 5/5 · 5/5 |

Cells: median [min–max over samples]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back).

All times are host clock (page performance.now()); MIPS = worker retired-instruction counter delta / host time. 'boot span' runs from the page's guest-booting event (includes kernel fetch + worker/wasm start) to the prompt; 'inside runChunk' divides by the worker's summed slice time (excludes scheduler yields and idle).

Median 1-minute load average: busybox-jit/A_O=8.3, busybox-jit/B_O3=7.4, busybox-jit/A_O3=9.0, busybox-jit/RFAT16_O3=8.2, busybox-nojit/A_O=7.3, busybox-nojit/B_O3=6.9, busybox-nojit/A_O3=7.7, busybox-nojit/RFAT16_O3=10.1
